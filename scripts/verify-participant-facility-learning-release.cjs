#!/usr/bin/env node
'use strict';

// Local, bounded deployment checks. Never imports index.js, production config,
// API keys or the production database; smoke uses an isolated in-memory SQLite DB.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const RELEASE = 'participant-facility-learning-20260922';
const BASELINE = 'admin-document-voice-20260921';
const API_DIR = '/home/dukaiyu2004/outdoor-fit-api';
const PAYLOAD = ['app.js', 'database.js', 'learningProgress.js'];
const MEMBERS = [...PAYLOAD, `install-${RELEASE}.sh`, 'verify-participant-facility-learning-release.cjs', 'release-manifest.json', 'README.md'];
const MAX_BYTES = 2 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const check = (value, message) => { if (!value) throw new Error(message); };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function keys(value, expected, label) {
  check(isObject(value) && same(Object.keys(value).sort(), [...expected].sort()), `${label} has unexpected fields`);
}
function safePath(target, directory = false) {
  const full = path.resolve(target), volume = path.parse(full).root;
  const parts = full.slice(volume.length).split(path.sep).filter(Boolean);
  check(parts.length > 0, 'Filesystem roots are not accepted');
  let current = volume;
  parts.forEach((part, index) => {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    check(!stat.isSymbolicLink(), `Symlink target rejected: ${part}`);
    check(index < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile(), `Unexpected path type: ${part}`);
  });
  return full;
}
function read(target) {
  const full = safePath(target);
  const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= MAX_BYTES, 'File size/type rejected');
    const bytes = Buffer.alloc(stat.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (!count) break;
      used += count;
    }
    check(used === stat.size, 'File changed during read');
    return bytes.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
function optionalHash(target) {
  try { fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return hash(read(target));
}
function packageFiles(stage) {
  safePath(stage, true);
  check(same(fs.readdirSync(stage).sort(), [...MEMBERS].sort()), 'Unexpected, missing or extra package members');
  for (const name of MEMBERS) read(path.join(stage, name));
  const manifest = JSON.parse(read(path.join(stage, 'release-manifest.json')));
  keys(manifest, ['version', 'release', 'files', 'baseline'], 'Release manifest');
  check(manifest.version === 1 && manifest.release === RELEASE, 'Unsupported release');
  check(Array.isArray(manifest.files) && manifest.files.length === PAYLOAD.length, 'Only three backend files are allowed');
  const target = {};
  for (const item of manifest.files) {
    keys(item, ['path', 'archive', 'sha256'], 'Payload');
    check(PAYLOAD.includes(item.archive) && item.path === `src/${item.archive}` && !Object.hasOwn(target, item.path), 'Invalid payload path');
    check(/^[a-f0-9]{64}$/.test(item.sha256) && hash(read(path.join(stage, item.archive))) === item.sha256, `Payload integrity failed: ${item.archive}`);
    target[item.path] = item.sha256;
  }
  keys(manifest.baseline, ['release', 'files'], 'Baseline');
  check(manifest.baseline.release === BASELINE && isObject(manifest.baseline.files), 'Unapproved baseline');
  const old = manifest.baseline.files;
  for (const name of ['src/app.js', 'src/database.js', 'src/security.js', 'src/index.js', 'package.json', 'package-lock.json']) check(Object.hasOwn(old, name), `Baseline missing ${name}`);
  check(!Object.hasOwn(old, 'src/learningProgress.js'), 'New learning helper unexpectedly appears in baseline');
  for (const [name, value] of Object.entries(old)) {
    check(/^(src\/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$/.test(name) && /^[a-f0-9]{64}$/.test(value), 'Unsafe baseline path or hash');
  }
  for (const name of ['src/app.js', 'src/database.js']) check(old[name] !== target[name], 'Payload still equals the old release');
  return { manifest, old, target };
}
function state(api, stage, mixed = false) {
  const { old, target } = packageFiles(stage);
  safePath(api, true);
  safePath(path.join(api, 'src'), true);
  const expected = [...new Set([...Object.keys(old), ...Object.keys(target)])].filter(name => name.startsWith('src/')).map(name => name.slice(4)).sort();
  const actual = fs.readdirSync(path.join(api, 'src')).sort();
  check(same(actual.filter(name => name !== 'learningProgress.js'), expected.filter(name => name !== 'learningProgress.js')), 'Source inventory differs from the reviewed baseline');
  const current = {};
  for (const name of Object.keys(old)) {
    current[name] = hash(read(path.join(api, name)));
    check(current[name] === old[name] || target[name] === current[name], `Unknown source/dependency change: ${name}`);
  }
  current['src/learningProgress.js'] = optionalHash(path.join(api, 'src/learningProgress.js'));
  check(current['src/learningProgress.js'] === null || current['src/learningProgress.js'] === target['src/learningProgress.js'], 'Unexpected existing learning helper');
  const baseline = ['src/app.js', 'src/database.js'].every(name => current[name] === old[name]);
  const installed = Object.keys(target).every(name => current[name] === target[name]);
  check(mixed || baseline || installed, 'Mixed backend version; no overwrite is allowed');
  return { state: installed ? 'installed' : baseline ? 'baseline' : 'mixed', payload: Object.fromEntries(Object.keys(target).map(name => [name, current[name]])) };
}
function runtime(pid) {
  check(process.platform === 'linux' && /^[1-9][0-9]*$/.test(String(pid)), 'Linux service PID required');
  const proc = `/proc/${pid}`;
  check(fs.readlinkSync(`${proc}/cwd`) === API_DIR, 'Running service cwd is not the approved API directory');
  const values = {};
  // Only these non-secret settings are retained/reported. Never print process environment.
  for (const entry of fs.readFileSync(`${proc}/environ`).toString('utf8').split('\0')) {
    const split = entry.indexOf('='), key = entry.slice(0, split);
    if (split < 0 || !['DATABASE_PATH', 'PORT'].includes(key)) continue;
    check(!Object.hasOwn(values, key), 'Duplicate runtime setting');
    values[key] = entry.slice(split + 1);
  }
  const port = Number(values.PORT || 3000);
  check(port === 3000, 'This patch is approved only for the existing API port 3000');
  const dbPath = path.resolve(API_DIR, values.DATABASE_PATH || './data/outdoor-fit.sqlite');
  check(dbPath.startsWith(`${API_DIR}/data/`), 'Runtime database is outside the approved data directory');
  safePath(dbPath);
  return { dbPath, port };
}
async function smoke(api, scratch) {
  const source = safePath(api, true), temporary = safePath(scratch, true);
  const relative = path.relative(source, temporary);
  check(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Smoke directory must be outside API source');
  check(fs.readdirSync(temporary).length === 0, 'Smoke scratch must be empty');
  const [{ createDatabase }, { createApp }, { signToken }] = await Promise.all(['database.js', 'app.js', 'security.js'].map(name => import(pathToFileURL(safePath(path.join(source, 'src', name))).href)));
  let database, server;
  try {
    database = createDatabase(':memory:');
    check(database.pragma('integrity_check', { simple: true }) === 'ok', 'In-memory schema check failed');
    const secret = 'isolated-learning-release-smoke-not-a-production-secret';
    const now = new Date().toISOString();
    for (const [index, id] of ['learning-release-owner', 'learning-release-other'].entries()) {
      database.prepare('INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, 'Synthetic release smoke account', `+8526970099${index}`, 'participant', 'unused', 'unused', now, now);
    }
    const app = createApp({ database, jwtSecret: secret,
      equipmentUploadDir: path.join(temporary, 'equipment'), mediaUploadDir: path.join(temporary, 'media'), mediaSeedDir: null,
      deepSeekClientFactory: () => { throw new Error('External AI calls forbidden during deployment smoke'); } });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { signal: AbortSignal.timeout(5000) });
    const answer = await response.json();
    check(response.status === 200 && answer.ok === true && answer.service === 'outdoor-fit-api', 'Isolated API health check failed');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, user, body) => {
      const headers = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${signToken({ id: user }, secret)}`;
      const result = await fetch(baseUrl + route, { method: body ? 'POST' : 'GET', headers,
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      return { status: result.status, body: await result.json(), cache: result.headers.get('cache-control') };
    };
    const progress = { records: [{ equipmentId: '0', date: null, entry: {
      version: 2, evidence: {
        read: { 'zh:release-smoke': { parts: [{ key: 'text', total: 100 }], ranges: { text: [[0, 75]] } } },
      },
    } }] };
    check((await request('/api/learning/progress', null, progress)).status === 401, 'Anonymous progress write was not rejected');
    check((await request('/api/learning/progress', 'learning-release-owner', progress)).status === 200, 'Synthetic progress write failed');
    const self = await request('/api/volunteer/participants/learning-release-owner/learning', 'learning-release-owner');
    check(self.status === 200 && self.body.items?.[0]?.entry?.read === true && self.cache === 'private, no-store', 'Self progress/private cache contract failed');
    check((await request('/api/volunteer/participants/learning-release-owner/learning', 'learning-release-other')).status === 404, 'Unlinked participant data access was not rejected');
    return { smoke: 'passed', requests: 5, database: 'memory', productionDatabaseAccess: false, externalAiCalls: 0 };
  } finally {
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    database?.close();
  }
}
module.exports = { packageFiles, state, runtime, smoke, MEMBERS, PAYLOAD, MAX_BYTES };
if (require.main === module) {
  const watchdog = setTimeout(() => { process.stderr.write('Release verification timed out\n'); process.exit(1); }, 45000);
  watchdog.unref();
  (async () => {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === 'package' && args.length === 1) { packageFiles(args[0]); result = { package: 'verified', release: RELEASE }; }
    else if (command === 'baseline' && args.length === 2) result = state(args[0], args[1]);
    else if (command === 'restore-preflight' && args.length === 2) result = state(args[0], args[1], true);
    else if (command === 'runtime' && args.length === 1) result = runtime(args[0]);
    else if (command === 'smoke' && args.length === 2) result = await smoke(args[0], args[1]);
    else throw new Error('Usage: package <stage> | baseline <api> <stage> | restore-preflight <api> <stage> | runtime <pid> | smoke <api> <empty-scratch>');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Verification failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
