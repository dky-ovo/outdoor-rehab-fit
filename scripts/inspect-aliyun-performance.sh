#!/usr/bin/env bash
# Read-only, bounded diagnostics for the existing production container.
# No service start/stop, application imports, configuration changes or SQL writes.
set -u
set -o pipefail
export LC_ALL=C
umask 077

readonly API_CONTAINER='outdoor-fit-production-api-1'
readonly PUBLIC_ORIGIN='https://api.outdoorfit.hk'
readonly IMAGE_ONE='/api/equipment-images/4bb78628-81cb-4ea6-b4ee-c09da0539bd7.jpg'
readonly IMAGE_TWO='/api/equipment-images/a4979c35-5636-45a7-bb75-3407d2741152.jpg'
failed=0

for required in docker curl timeout; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'DIAGNOSTICS=FAIL\nERROR_CODE=REQUIRED_COMMAND_MISSING\n'
    exit 1
  fi
done
running=$(timeout --kill-after=2s 8s docker inspect --format '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null) || running=''
if [[ "$running" != 'true' ]]; then
  printf 'DIAGNOSTICS=FAIL\nERROR_CODE=EXPECTED_CONTAINER_NOT_RUNNING\n'
  exit 1
fi

printf 'FORMAT_VERSION=1\nPHASE=PUBLIC_HTTP\n'
public_get() {
  local label="$1" request_path="$2" result exit_code
  # Each curl is a fresh process/connection. Bodies are discarded, never logged.
  # No redirects, credentials, retries or concurrent traffic are introduced.
  result=$(curl --silent --output /dev/null --proto '=https' --noproxy '*' \
    --connect-timeout 8 --max-time 20 --max-filesize 16777216 \
    --write-out "${label}_HTTP_CODE=%{http_code}\n${label}_DNS_SECONDS=%{time_namelookup}\n${label}_TCP_READY_SECONDS=%{time_connect}\n${label}_TLS_READY_SECONDS=%{time_appconnect}\n${label}_TTFB_SECONDS=%{time_starttransfer}\n${label}_TOTAL_SECONDS=%{time_total}\n${label}_BODY_BYTES=%{size_download}\n${label}_BYTES_PER_SECOND=%{speed_download}\n" \
    "${PUBLIC_ORIGIN}${request_path}" 2>/dev/null)
  exit_code=$?
  printf '%s\n%s_CURL_EXIT=%d\n' "$result" "$label" "$exit_code"
  if [[ "$exit_code" != 0 || "$result" != *"${label}_HTTP_CODE=200"* ]]; then
    failed=1
  fi
}
public_get PUBLIC_HEALTH /api/health
public_get PUBLIC_CATALOG /api/equipment-catalog
public_get PUBLIC_IMAGE_ONE "$IMAGE_ONE"
public_get PUBLIC_IMAGE_TWO "$IMAGE_TWO"

printf 'PHASE=CONTAINER_READ_ONLY\n'
# Node has its own 29-second deadline. The outer timeout also bounds Docker CLI
# failures; it does not stop or restart the application container.
timeout --signal=TERM --kill-after=2s 35s docker exec -i --workdir /app "$API_CONTAINER" node --input-type=module 2>/dev/null <<'NODE'
import fs from 'node:fs';
import { lookup } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import { checkServerIdentity } from 'node:tls';

const output = (key, value) => console.log(`${key}=${value}`);
const elapsed = start => Number((performance.now() - start).toFixed(3));
const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_USER_LIMIT_REACHED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ER_UNKNOWN_COLLATION',
  'DIAG_CONFIG_INVALID', 'DIAG_TLS_NOT_VERIFIED', 'DIAG_SELECT_INVALID',
  'DIAG_HTTP_STATUS', 'DIAG_HTTP_TOO_LARGE', 'DIAG_TIMEOUT']);
const safeCode = error => codes.has(error?.code) ? error.code : 'DIAG_OPERATION_FAILED';
const fail = code => Object.assign(new Error(code), { code });
let connection, readOnlyTransaction = false, phase = 'START', failed = false;
const controllers = new Set();
const deadline = setTimeout(() => {
  for (const controller of controllers) controller.abort();
  try { connection?.destroy(); } catch { /* Exit closes this diagnostic socket. */ }
  output('ERROR_STAGE', phase);
  output('ERROR_CODE', 'DIAG_NODE_DEADLINE');
  output('CONTAINER_DIAGNOSTICS', 'FAIL');
  process.exit(1);
}, 29000);

async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('DIAG_TIMEOUT')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function timed(key, operation) {
  phase = key;
  const start = performance.now();
  try { return await operation(); }
  finally { output(`${key}_MS`, elapsed(start)); }
}
function processMemory() {
  phase = 'API_PROCESS_MEMORY';
  let matches = 0;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    try {
      const args = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
      if (!args.some(value => value === 'src/production.js' || value === '/app/src/production.js')) continue;
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      matches++;
      const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
      const threads = /^Threads:\s+(\d+)$/m.exec(status);
      if (rss) output(`API_PROCESS_${matches}_RSS_BYTES`, Number(rss[1]) * 1024);
      if (threads) output(`API_PROCESS_${matches}_THREADS`, Number(threads[1]));
    } catch { /* A process may exit while inspecting /proc. */ }
  }
  output('API_PROCESS_COUNT', matches);
  // This is the diagnostic process, not the running API's JS heap.
  output('DIAGNOSTIC_NODE_RSS_BYTES', process.memoryUsage().rss);
}
async function inspectDatabase() {
  try {
    phase = 'RDS_CONFIG';
    // Neither module imports production.js or starts any background workers.
    const [{ default: mysql }, { readMysqlConfig }, { initializeMysqlSession }] = await Promise.all([
      import('mysql2/promise'), import('./src/mysqlConfig.js'), import('./src/mysqlDatabase.js'),
    ]);
    const secretFile = process.env.MYSQL_PASSWORD_FILE;
    if (typeof secretFile !== 'string' || !secretFile.startsWith('/') || !fs.lstatSync(secretFile).isFile()) throw fail('DIAG_CONFIG_INVALID');
    const password = fs.readFileSync(secretFile, 'utf8');
    if (!password || /[\0\r\n]/.test(password)) throw fail('DIAG_CONFIG_INVALID');
    const config = readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password });
    if (config.database !== 'outdoor_fit_prod' || config.user !== 'outdoor_fit_app' || config.ssl?.rejectUnauthorized !== true || config.ssl?.verifyIdentity !== true) throw fail('DIAG_CONFIG_INVALID');
    await timed('RDS_DNS', () => bounded(lookup(config.host), 2500));
    const { waitForConnections, connectionLimit, queueLimit, ...directConfig } = config;
    // This measures one NEW connection including MySQL handshake and TLS. It
    // does not measure the API pool's checkout queue or isolate TLS duration.
    connection = await timed('RDS_CONNECT_INCLUDING_TLS', () => mysql.createConnection({ ...directConfig, connectTimeout: 6000 }));
    phase = 'RDS_TLS_VERIFY';
    const socket = connection.connection?.stream;
    if (!socket?.encrypted || socket.authorized !== true || typeof socket.getPeerCertificate !== 'function'
      || checkServerIdentity(config.host, socket.getPeerCertificate(true)) !== undefined) throw fail('DIAG_TLS_NOT_VERIFIED');
    output('RDS_TLS_VERIFIED', 1);
    await timed('RDS_SESSION_INIT', () => initializeMysqlSession({
      query: sql => connection.query({ sql, timeout: 2500 }),
    }));
    phase = 'RDS_READ_ONLY_BEGIN';
    await connection.query({ sql: 'START TRANSACTION READ ONLY', timeout: 2500 });
    readOnlyTransaction = true;
    for (let sample = 1; sample <= 3; sample++) {
      const [rows] = await timed(`RDS_SELECT_ONE_${sample}`, () => connection.execute({ sql: 'SELECT 1 AS ready', timeout: 2500 }));
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].ready !== 1) throw fail('DIAG_SELECT_INVALID');
    }
    output('RDS_READ_ONLY_CHECK', 'PASS');
  } catch (error) {
    failed = true;
    output('ERROR_STAGE', phase);
    output('ERROR_CODE', safeCode(error));
    output('RDS_READ_ONLY_CHECK', 'FAIL');
  } finally {
    phase = 'RDS_CLOSE';
    if (connection) {
      try {
        if (readOnlyTransaction) await connection.query({ sql: 'ROLLBACK', timeout: 1000 });
        await bounded(connection.end(), 1000);
      } catch {
        failed = true;
        output('RDS_CLOSE', 'DESTROYED');
        try { connection.destroy(); } catch { /* No business transaction exists. */ }
      }
      connection = undefined;
    }
  }
}
async function internalGet(label, requestPath) {
  phase = label;
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 3500);
  const start = performance.now();
  let reader, bytes = 0;
  try {
    const response = await fetch(`http://127.0.0.1:3000${requestPath}`, { signal: controller.signal, redirect: 'manual' });
    output(`${label}_HTTP_CODE`, response.status);
    output(`${label}_HEADERS_MS`, elapsed(start));
    reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const value = await reader.read();
        if (value.done) break;
        bytes += value.value.byteLength;
        if (bytes > 16 * 1024 * 1024) throw fail('DIAG_HTTP_TOO_LARGE');
      }
    }
    if (response.status !== 200) throw fail('DIAG_HTTP_STATUS');
  } catch (error) {
    failed = true;
    output('ERROR_STAGE', label);
    output('ERROR_CODE', controller.signal.aborted ? 'DIAG_TIMEOUT' : safeCode(error));
  } finally {
    controller.abort();
    clearTimeout(timer);
    controllers.delete(controller);
    try { await reader?.cancel(); } catch { /* Aborted streams may already be closed. */ }
    try { reader?.releaseLock(); } catch { /* Optional response body. */ }
    output(`${label}_TOTAL_MS`, elapsed(start));
    output(`${label}_BODY_BYTES`, bytes);
  }
}
try {
  processMemory();
  await inspectDatabase();
  await internalGet('LOCAL_HEALTH', '/api/health');
  await internalGet('LOCAL_CATALOG', '/api/equipment-catalog');
  await internalGet('LOCAL_IMAGE_ONE', '/api/equipment-images/4bb78628-81cb-4ea6-b4ee-c09da0539bd7.jpg');
  await internalGet('LOCAL_IMAGE_TWO', '/api/equipment-images/a4979c35-5636-45a7-bb75-3407d2741152.jpg');
} catch (error) {
  failed = true;
  output('ERROR_STAGE', phase);
  output('ERROR_CODE', safeCode(error));
} finally {
  clearTimeout(deadline);
  for (const controller of controllers) controller.abort();
  try { connection?.destroy(); } catch { /* Only our diagnostic connection. */ }
}
output('CONTAINER_DIAGNOSTICS', failed ? 'FAIL' : 'PASS');
// Explicitly close this short-lived diagnostic process, including fetch's idle
// keep-alive handles. The separate production Node process is untouched.
process.exit(failed ? 1 : 0);
NODE
node_exit=$?
printf 'CONTAINER_EXEC_EXIT=%d\n' "$node_exit"
if [[ "$node_exit" != 0 ]]; then failed=1; fi
if [[ "$failed" == 0 ]]; then
  printf 'DIAGNOSTICS=PASS\n'
else
  printf 'DIAGNOSTICS=PARTIAL_OR_FAILED\n'
fi
exit "$failed"
