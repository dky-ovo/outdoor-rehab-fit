import mysql from "mysql2/promise";
import { checkServerIdentity } from "node:tls";
import { pathToFileURL } from "node:url";
import { readMysqlConfig } from "../src/mysqlConfig.js";
import { createMysqlDatabase, initializeMysqlSession } from "../src/mysqlDatabase.js";

const SAFE_ERROR_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE",
  "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_CON_COUNT_ERROR",
  "ER_NOT_SUPPORTED_AUTH_MODE", "ER_SERVER_SHUTDOWN", "PROTOCOL_CONNECTION_LOST",
  "ERR_OUT_OF_RANGE", "HANDSHAKE_NO_SSL_SUPPORT", "HANDSHAKE_UNKNOWN_ERROR", "PROTOCOL_ERROR",
  "AUTH_SWITCH_PLUGIN_ERROR", "MYSQL_CLEAR_PASSWORD_NOT_ENABLED", "ER_PLUGIN_IS_NOT_LOADED",
  "ER_UNKNOWN_CHARACTER_SET", "ER_UNKNOWN_COLLATION", "ER_COLLATION_CHARSET_MISMATCH",
  "ER_DBACCESS_DENIED_ERROR", "ER_HOST_IS_BLOCKED", "ER_HOST_NOT_PRIVILEGED",
  "ER_TOO_MANY_USER_CONNECTIONS", "ER_MUST_CHANGE_PASSWORD_LOGIN", "ER_SECURE_TRANSPORT_REQUIRED",
  "EHOSTUNREACH", "ENETUNREACH", "EACCES", "EPROTO",
  "HANDSHAKE_SSL_ERROR", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "MYSQL_COMMIT_OUTCOME_UNKNOWN", "MYSQL_OPERATION_FAILED",
  "PROBE_CONFIG_INVALID", "PROBE_CONNECT_FAILED", "PROBE_TLS_FAILED",
  "PROBE_IDENTITY_FAILED", "PROBE_SESSION_SETUP_FAILED", "PROBE_METADATA_FAILED", "PROBE_BINDING_FAILED",
  "PROBE_TRANSACTION_FAILED", "PROBE_CLOSE_FAILED",
]);

function requireCheck(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function safeErrorCode(error, fallback) {
  return SAFE_ERROR_CODES.has(error?.code) ? error.code : fallback;
}

// This probe reads only SELECT results. Direct and pooled connections also
// initialize their own session charset/time zone; the adapter opens/commits a
// transaction. No application startup, migrations, seeds or data writes run.
export async function runMysqlProbe({
  readConfig = readMysqlConfig,
  connect = (config) => mysql.createConnection(config),
  createDatabase = createMysqlDatabase,
  verifyIdentity = checkServerIdentity,
  write = (line) => console.log(line),
} = {}) {
  let direct;
  let database;
  let failure;
  let failureStage;
  let stage = "PROBE_CONFIG_INVALID";

  async function closeDirect() {
    if (!direct) return;
    const connection = direct;
    direct = undefined;
    try {
      await connection.end();
    } catch (error) {
      try { connection.destroy(); } catch { /* Preserve the closing error. */ }
      throw error;
    }
  }

  try {
    const config = readConfig();
    requireCheck(config?.ssl?.rejectUnauthorized === true && config?.ssl?.verifyIdentity === true &&
      Boolean(config.ssl.ca) && config.jsonStrings === true, "PROBE_CONFIG_INVALID");

    stage = "PROBE_CONNECT_FAILED";
    direct = await connect(config);
    const socket = direct.connection?.stream;
    stage = "PROBE_TLS_FAILED";
    requireCheck(socket?.encrypted === true && socket.authorized === true, stage);
    const protocol = socket.getProtocol();
    const cipher = socket.getCipher()?.name;
    requireCheck(["TLSv1.2", "TLSv1.3"].includes(protocol) &&
      typeof cipher === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(cipher), stage);
    write("CLIENT_TLS PASS");
    write(`TLS_PROTOCOL ${protocol}`);
    write(`TLS_CIPHER ${cipher}`);

    stage = "PROBE_IDENTITY_FAILED";
    const peerCertificate = socket.getPeerCertificate(true);
    requireCheck(peerCertificate && Object.keys(peerCertificate).length > 0 &&
      verifyIdentity(config.host, peerCertificate) === undefined, stage);
    write("IDENTITY_VERIFIED PASS");

    stage = "PROBE_SESSION_SETUP_FAILED";
    await initializeMysqlSession(direct);

    stage = "PROBE_METADATA_FAILED";
    const [rows] = await direct.execute(`SELECT VERSION() AS version, DATABASE() AS database_name,
      @@innodb_page_size AS innodb_page_size, @@collation_connection AS collation_connection,
      @@sql_mode AS sql_mode,
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE') AS table_count`, []);
    const metadata = rows?.[0];
    requireCheck(metadata && /^[0-9][A-Za-z0-9.+_-]{0,99}$/.test(metadata.version) &&
      metadata.database_name === config.database && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(metadata.database_name) &&
      typeof metadata.collation_connection === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(metadata.collation_connection) &&
      typeof metadata.sql_mode === "string" && /^(?:[A-Z0-9_]+(?:,[A-Z0-9_]+)*)?$/.test(metadata.sql_mode), stage);
    const pageSize = Number(metadata.innodb_page_size);
    const tableCount = Number(metadata.table_count);
    requireCheck(Number.isSafeInteger(pageSize) && pageSize > 0 &&
      Number.isSafeInteger(tableCount) && tableCount >= 0, stage);
    write(`VERSION ${metadata.version}`);
    write(`DATABASE ${metadata.database_name}`);
    write(`INNODB_PAGE_SIZE ${pageSize}`);
    write(`COLLATION_CONNECTION ${metadata.collation_connection}`);
    write(`SQL_MODE ${metadata.sql_mode}`);
    write(`TABLE_COUNT ${tableCount}`);

    stage = "PROBE_CLOSE_FAILED";
    await closeDirect();

    stage = "PROBE_TRANSACTION_FAILED";
    database = createDatabase(config);
    await database.transaction(async (tx) => {
      const first = await tx.get("SELECT CONNECTION_ID() AS connection_id");
      const milliseconds = 1_790_000_000_123;
      const text = "迁移检查 🏃";
      const json = JSON.stringify({ text, milliseconds, flags: [true, false] });
      const bound = await tx.get("SELECT CAST(? AS SIGNED) AS milliseconds, ? AS text_value, CAST(? AS JSON) AS json_value",
        [milliseconds, text, json]);
      requireCheck(typeof bound?.milliseconds === "number" && bound.milliseconds === milliseconds &&
        bound.text_value === text && typeof bound.json_value === "string", "PROBE_BINDING_FAILED");
      let parsed;
      try { parsed = JSON.parse(bound.json_value); } catch { requireCheck(false, "PROBE_BINDING_FAILED"); }
      requireCheck(parsed?.text === text && parsed.milliseconds === milliseconds &&
        Array.isArray(parsed.flags) && parsed.flags.length === 2 && parsed.flags[0] === true && parsed.flags[1] === false,
      "PROBE_BINDING_FAILED");
      const second = await tx.get("SELECT CONNECTION_ID() AS connection_id");
      requireCheck(first?.connection_id != null && String(first.connection_id) === String(second?.connection_id),
        "PROBE_TRANSACTION_FAILED");
    });
    write("TRANSACTION_CONNECTION PASS");
    write("MILLISECONDS_BINDING PASS");
    write("UTF8MB4_BINDING PASS");
    write("JSON_STRINGS_BINDING PASS");
  } catch (error) {
    failure = safeErrorCode(error, stage);
    failureStage = stage;
  } finally {
    try { await closeDirect(); } catch (error) {
      if (!failure) {
        failure = safeErrorCode(error, "PROBE_CLOSE_FAILED");
        failureStage = "PROBE_CLOSE_FAILED";
      }
    }
    if (database) {
      try { await database.close(); } catch (error) {
        if (!failure) {
          failure = safeErrorCode(error, "PROBE_CLOSE_FAILED");
          failureStage = "PROBE_CLOSE_FAILED";
        }
      }
    }
  }

  if (failure) {
    write("PROBE FAIL");
    write(`ERROR_STAGE ${failureStage}`);
    write(`ERROR_CODE ${failure}`);
    return 1;
  }
  write("PROBE PASS");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMysqlProbe();
}
