#!/usr/bin/env node
'use strict';

// The pinned older checkers supply only reviewed path/Web inventory routines,
// runtime inspection; their release installers are
// never invoked. Production SQLite is read only for a consistent backup; no
// secret configuration import, dependency installation or Nginx changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const RELEASE = 'activity-advice-account-deletion-20260923';
const PAYLOAD = ['app.js', 'appTextCatalog.json'];
const BASELINES = ['admin-text-registration-research-20260923'];
const PINNED = {
  'verify-contact-feedback-release.cjs': '2f2b53e730af4828a8e87263be38a4e646a424d5d1ee57dcf2f9d498c10ecf73',
  'verify-ai-chatbox-guide-backend-patch.cjs': '21ba5dcd319ab430b716dbdc19c6a51792af122e064e57e06aa2c4a55927bcf9',
  'verify-participant-facility-learning-release.cjs': '80a5ffcbb88b32ef97575741c1f1fde37d8fc396c19886bc0c6afc40020a186c',
};
const MEMBERS = [...PAYLOAD, `install-${RELEASE}.sh`, 'verify-activity-advice-account-deletion-release.cjs', ...Object.keys(PINNED), 'release-manifest.json', 'README.md'];
const MAX = 64 * 1024 * 1024, MAX_ROOT = 8 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function exact(value, fields, label) { check(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value), fields), `${label}: unexpected fields`); }
// Validate helper bytes before require, including the transitive dependency.
for (const [name, digest] of Object.entries(PINNED)) {
  const target = path.join(__dirname, name), stat = fs.lstatSync(target);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_ROOT, 'Pinned helper type/size rejected');
  check(hash(fs.readFileSync(target)) === digest, `Pinned helper changed: ${name}`);
}
const { safePath, validWebPath, webInventory } = require('./verify-contact-feedback-release.cjs');
const { runtime } = require('./verify-participant-facility-learning-release.cjs');
const { createRequire } = require('node:module');
function read(file, limit = MAX_ROOT) {
  const fd = fs.openSync(safePath(file), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd); check(stat.isFile() && stat.nlink === 1 && stat.size <= limit, 'File type/size rejected');
    const data = fs.readFileSync(fd); check(data.length === stat.size, 'File changed during read'); return data;
  } finally { fs.closeSync(fd); }
}
function optionalHash(file, limit) { safePath(file, 'file', true); return fs.existsSync(file) ? hash(read(file, limit)) : null; }
function packageFiles(stage) {
  safePath(stage, 'directory');
  check(same(fs.readdirSync(stage), [...MEMBERS, 'web']), 'Unexpected package members');
  const bytes = Object.fromEntries(MEMBERS.map(name => [name, read(path.join(stage, name))]));
  for (const [name, digest] of Object.entries(PINNED)) check(hash(bytes[name]) === digest, 'Packaged helper hash mismatch');
  const manifest = JSON.parse(bytes['release-manifest.json']);
  exact(manifest, ['version', 'release', 'files', 'baselines', 'web'], 'Manifest');
  check(manifest.version === 1 && manifest.release === RELEASE, 'Unsupported release');
  check(Array.isArray(manifest.files) && manifest.files.length === PAYLOAD.length, 'Exactly two source payloads required');
  const target = {};
  for (const item of manifest.files) {
    exact(item, ['path', 'archive', 'sha256'], 'Payload');
    check(PAYLOAD.includes(item.archive) && item.path === `src/${item.archive}` && !Object.hasOwn(target, item.path), 'Unsafe/duplicate payload');
    check(isHash(item.sha256) && hash(bytes[item.archive]) === item.sha256, 'Payload checksum mismatch'); target[item.path] = item.sha256;
  }
  check(Array.isArray(manifest.baselines) && manifest.baselines.length === 1 && same(manifest.baselines.map(v => v.release), BASELINES), 'Approved baseline required');
  const baseline = manifest.baselines[0];
  exact(baseline, ['release', 'files'], 'Baseline');
  const newer = baseline.files;
  check(newer && typeof newer === 'object' && !Array.isArray(newer), 'Invalid baseline inventory');
  for (const name of ['src/app.js', 'src/database.js', 'src/registrationCodes.js', 'src/security.js', 'src/index.js', 'src/assistantSymptomRecommendations.js', 'src/learningProgress.js', 'src/appTexts.js', 'src/appTextCatalog.json', 'src/researchContentLabels.js', 'package.json', 'package-lock.json']) check(Object.hasOwn(newer, name), 'Required baseline file missing: ' + name);
  for (const [name, digest] of Object.entries(newer)) check(/^(src\/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$/.test(name) && isHash(digest), 'Unsafe baseline path/hash');
  check(Array.isArray(manifest.web) && manifest.web.length > 0 && manifest.web.length <= 10000, 'Invalid Web inventory');
  for (const item of manifest.web) {
    exact(item, ['path', 'sha256', 'bytes'], 'Web entry');
    check(validWebPath(item.path) && isHash(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= MAX, 'Invalid Web entry');
  }
  const sort = items => [...items].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  check(JSON.stringify(sort(manifest.web)) === JSON.stringify(sort(webInventory(path.join(stage, 'web')))), 'Web inventory/hash mismatch');
  const expected = MEMBERS.filter(name => name !== `install-${RELEASE}.sh`), seen = new Set();
  const block = bytes[`install-${RELEASE}.sh`].toString('utf8').match(/<<'EMBEDDED_CHECKSUMS'\r?\n([\s\S]*?)\r?\nEMBEDDED_CHECKSUMS/);
  check(block, 'Missing embedded checksums');
  for (const line of block[1].trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    check(match && expected.includes(match[2]) && !seen.has(match[2]), 'Unsafe/duplicate embedded checksum');
    check(hash(bytes[match[2]]) === match[1], 'Package checksum mismatch'); seen.add(match[2]);
  }
  check(same(seen, expected), 'Incomplete embedded checksums');
  return { manifest, target, installed: { ...newer, ...target } };
}
function state(api, stage, mixed = false) {
  const { manifest, installed } = packageFiles(stage);
  safePath(api, 'directory'); safePath(path.join(api, 'src'), 'directory');
  const actual = fs.readdirSync(path.join(api, 'src')).map(name => `src/${name}`);
  check(actual.every(name => Object.hasOwn(installed, name)), 'Unexpected source inventory');
  const current = {};
  for (const name of [...actual, 'package.json', 'package-lock.json']) current[name] = hash(read(path.join(api, name)));
  const candidates = [...manifest.baselines, { release: RELEASE, files: installed }];
  const match = candidates.find(v => same(Object.keys(current), Object.keys(v.files)) && Object.entries(v.files).every(([name, digest]) => current[name] === digest));
  if (match) return { state: match.release === RELEASE ? 'installed' : 'baseline', release: match.release };
  if (mixed) {
    for (const name of Object.keys(installed)) {
      check(candidates.some(v => (v.files[name] || null) === (current[name] || null)), `Unknown source/dependency change: ${name}`);
    }
    return { state: 'mixed' };
  }
  throw new Error('Unknown or mixed backend baseline; no overwrite allowed');
}
function webTarget(web, stage) {
  safePath(web, 'directory'); const { manifest } = packageFiles(stage);
  for (const item of manifest.web) {
    const existing = optionalHash(path.join(web, item.path), MAX);
    if (existing && /^(?:assets|_expo)\//.test(item.path)) check(existing === item.sha256, 'Immutable Web asset collision');
  }
  return { webTarget: 'verified', files: manifest.web.length };
}
function installedWeb(web, stage) {
  const { manifest } = packageFiles(stage);
  for (const item of manifest.web) check(optionalHash(path.join(web, item.path), MAX) === item.sha256, 'Installed Web hash mismatch');
  return { installedWeb: 'verified', files: manifest.web.length };
}
function separateRoots(roots) {
  const resolved = roots.map(v => safePath(v, 'directory'));
  for (let a = 0; a < resolved.length; a++) for (let b = a + 1; b < resolved.length; b++) {
    const relative = path.relative(resolved[a], resolved[b]), reverse = path.relative(resolved[b], resolved[a]);
    const outside = v => v === '..' || v.startsWith(`..${path.sep}`) || path.isAbsolute(v);
    check(outside(relative) && outside(reverse), 'Deployment roots must not overlap');
  }
}
function ensureDirectory(directory, owner) {
  safePath(directory, 'directory', true); const missing = [];
  for (let current = path.resolve(directory); !fs.existsSync(current); current = path.dirname(current)) missing.push(current);
  for (const item of missing.reverse()) {
    fs.mkdirSync(item, { mode: owner ? 0o755 : 0o700 }); fs.chmodSync(item, owner ? 0o755 : 0o700);
    if (owner && process.platform !== 'win32') fs.chownSync(item, owner.uid, owner.gid);
  }
}
function atomicFile(target, bytes, mode, owner) {
  safePath(target, 'file', true); ensureDirectory(path.dirname(target), owner);
  const temp = path.join(path.dirname(target), `.activity-advice-${crypto.randomUUID()}.tmp`), fd = fs.openSync(temp, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); if (process.platform !== 'win32') fs.fchownSync(fd, owner.uid, owner.gid); }
  finally { fs.closeSync(fd); }
  safePath(target, 'file', true); fs.renameSync(temp, target);
}
function backup(api, web, stage, destination) {
  separateRoots([api, web, stage, destination]); state(api, stage); webTarget(web, stage);
  check(fs.readdirSync(destination).length === 0, 'Backup directory must be empty');
  const { manifest } = packageFiles(stage), entries = [];
  for (const [kind, root, names] of [['api', api, PAYLOAD.map(v => `src/${v}`)], ['web', web, manifest.web.map(v => v.path)]]) {
    for (const name of names) {
      const source = safePath(path.join(root, name), 'file', true), exists = fs.existsSync(source), item = { kind, path: name, exists };
      if (exists) {
        const bytes = read(source, kind === 'web' ? MAX : MAX_ROOT), stat = fs.statSync(source), saved = path.join(destination, kind, name);
        ensureDirectory(path.dirname(saved)); fs.writeFileSync(saved, bytes, { flag: 'wx', mode: 0o600 });
        Object.assign(item, { sha256: hash(bytes), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid });
      }
      entries.push(item);
    }
  }
  fs.writeFileSync(path.join(destination, 'recovery.json'), JSON.stringify({ release: RELEASE, api: path.resolve(api), web: path.resolve(web), entries }), { flag: 'wx', mode: 0o600 });
  return { backup: 'complete', files: entries.length, database: 'untouched', uploads: 'untouched' };
}
function recoveryPlan(api, web, stage, destination) {
  separateRoots([api, web, stage, destination]);
  const { manifest, target } = packageFiles(stage), plan = JSON.parse(read(path.join(destination, 'recovery.json')));
  exact(plan, ['release', 'api', 'web', 'entries'], 'Recovery');
  check(plan.release === RELEASE && plan.api === path.resolve(api) && plan.web === path.resolve(web), 'Recovery roots differ');
  const expected = [...PAYLOAD.map(v => `api:src/${v}`), ...manifest.web.map(v => `web:${v.path}`)];
  check(Array.isArray(plan.entries) && same(plan.entries.map(v => `${v.kind}:${v.path}`), expected), 'Recovery inventory mismatch');
  const replacements = { ...Object.fromEntries(Object.entries(target).map(([name, value]) => [`api:${name}`, value])), ...Object.fromEntries(manifest.web.map(v => [`web:${v.path}`, v.sha256])) };
  for (const entry of plan.entries) {
    exact(entry, entry.exists ? ['kind', 'path', 'exists', 'sha256', 'mode', 'uid', 'gid'] : ['kind', 'path', 'exists'], 'Recovery entry');
    check(typeof entry.exists === 'boolean', 'Invalid recovery entry');
    safePath(path.join(entry.kind === 'api' ? api : web, entry.path), 'file', true);
    if (entry.exists) {
      check(isHash(entry.sha256) && [entry.mode, entry.uid, entry.gid].every(Number.isSafeInteger) && entry.mode >= 0 && entry.mode <= 0o777 && entry.uid >= 0 && entry.gid >= 0, 'Invalid recovery metadata');
      check(hash(read(path.join(destination, entry.kind, entry.path), entry.kind === 'web' ? MAX : MAX_ROOT)) === entry.sha256, 'Backup checksum mismatch');
    }
  }
  return { plan, replacements };
}
const ordered = entries => [...entries].sort((a, b) => Number(a.kind === 'web') - Number(b.kind === 'web') || Number(a.path.endsWith('.html')) - Number(b.path.endsWith('.html')));
function apply(api, web, stage, destination) {
  state(api, stage); webTarget(web, stage);
  const { plan } = recoveryPlan(api, web, stage, destination);
  for (const item of plan.entries) check(optionalHash(path.join(item.kind === 'api' ? api : web, item.path), item.kind === 'web' ? MAX : MAX_ROOT) === (item.sha256 || null), 'Target changed after backup');
  for (const item of ordered(plan.entries)) {
    const root = item.kind === 'api' ? api : web, source = item.kind === 'api' ? path.join(stage, path.basename(item.path)) : path.join(stage, 'web', item.path);
    const owner = fs.statSync(item.kind === 'api' ? path.join(api, 'src', 'app.js') : web);
    atomicFile(path.join(root, item.path), read(source, item.kind === 'web' ? MAX : MAX_ROOT), 0o644, owner);
  }
  state(api, stage); installedWeb(web, stage);
  return { applied: RELEASE, backendFiles: PAYLOAD.length, webFiles: plan.entries.length - PAYLOAD.length };
}
function rollback(api, web, stage, destination) {
  state(api, stage, true); const { plan, replacements } = recoveryPlan(api, web, stage, destination);
  // Never overwrite edits made after this installer: every current file must be
  // either the exact backed-up version or this release's known replacement.
  for (const item of plan.entries) {
    const value = optionalHash(path.join(item.kind === 'api' ? api : web, item.path), item.kind === 'web' ? MAX : MAX_ROOT);
    check(value === (item.sha256 || null) || value === replacements[`${item.kind}:${item.path}`], 'Concurrent target change prevents automatic rollback');
  }
  for (const item of ordered(plan.entries)) {
    const target = path.join(item.kind === 'api' ? api : web, item.path), limit = item.kind === 'web' ? MAX : MAX_ROOT;
    if (item.exists) atomicFile(target, read(path.join(destination, item.kind, item.path), limit), item.mode, item);
    else if (fs.existsSync(target)) {
      const retained = path.join(destination, 'failed-release', item.kind, item.path), bytes = read(target, limit);
      ensureDirectory(path.dirname(retained)); fs.writeFileSync(retained, bytes, { flag: 'wx', mode: 0o600 });
      check(hash(read(retained, limit)) === hash(bytes), 'Failed payload retention failed'); fs.unlinkSync(safePath(target));
    }
  }
  for (const item of plan.entries) check(optionalHash(path.join(item.kind === 'api' ? api : web, item.path), item.kind === 'web' ? MAX : MAX_ROOT) === (item.sha256 || null), 'Rollback verification failed');
  state(api, stage); return { rollback: 'source-and-web-only', database: 'untouched', uploads: 'untouched' };
}

function digestFile(file) {
  const fd = fs.openSync(safePath(file), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), digest = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
async function databaseSnapshot(api, destination, runtimeFile) {
  separateRoots([api, destination]);
  const settings = JSON.parse(read(runtimeFile));
  exact(settings, ['dbPath', 'port'], 'Runtime snapshot settings');
  const dbPath = safePath(settings.dbPath), dataRoot = safePath(path.join(api, 'data'), 'directory');
  const relative = path.relative(dataRoot, dbPath);
  check(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) && settings.port === 3000, 'Unapproved runtime database path');
  const folder = path.join(destination, 'database');
  check(!fs.existsSync(folder), 'Snapshot already exists');
  ensureDirectory(folder);
  const file = path.join(folder, 'database.sqlite');
  const fd = fs.openSync(file, 'wx', 0o600); fs.closeSync(fd);
  const Database = createRequire(safePath(path.join(api, 'package.json')))('better-sqlite3');
  let source, copy;
  try {
    source = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 10000 });
    // SQLite's backup API includes committed WAL pages in one consistent view.
    // Only call after systemd has stopped the API; never reopen its config.
    await source.backup(file);
    copy = new Database(file, { readonly: true, fileMustExist: true });
    check(copy.pragma('quick_check', { simple: true }) === 'ok', 'Database snapshot integrity failed');
  } finally { copy?.close(); source?.close(); }
  fs.chmodSync(file, 0o600);
  const snapshot = { source: dbPath, file: 'database/database.sqlite', bytes: fs.statSync(file).size, sha256: digestFile(file), method: 'sqlite-backup', restore: 'manual-only' };
  fs.writeFileSync(path.join(destination, 'database-snapshot.json'), JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
  return { snapshot: 'verified', bytes: snapshot.bytes, sha256: snapshot.sha256, restore: 'manual-only' };
}
async function smoke(api, scratch) {
  safePath(api, 'directory'); safePath(scratch, 'directory');
  separateRoots([api, scratch]);
  check(fs.readdirSync(scratch).length === 0, 'Smoke scratch must be empty');
  const load = name => import(pathToFileURL(safePath(path.join(api, 'src', name))).href);
  const [{ createApp }, { createDatabase }, { signToken }, { generateRegistrationCode }, { createResearchContentResolver }] = await Promise.all(['app.js', 'database.js', 'security.js', 'registrationCodes.js', 'researchContentLabels.js'].map(load));
  check(/^[A-HJ-NP-Z2-9]{8}$/.test(generateRegistrationCode()), 'Short invitation generator missing');
  const catalog = JSON.parse(read(path.join(api, 'src', 'appTextCatalog.json'))).items;
  const text = catalog.find(v => v.kind === 'text' && typeof v.zh === 'string' && typeof v.en === 'string' && !v.zh.includes('%{') && !v.en.includes('%{'));
  check(text, 'No bilingual catalog item');
  const database = createDatabase(':memory:'), secret = 'isolated-admin-text-smoke-only', now = new Date().toISOString();
  let server, requests = 0;
  try {
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('smoke-admin','Synthetic administrator','+85269708881','staff','unused','unused',?,?)").run(now, now);
    database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('smoke-admin','operator',?,1,?,?)").run(JSON.stringify(['app_maintenance.text.manage', 'users.edit']), now, now);
    const token = signToken({ id: 'smoke-admin', profile_role: 'staff' }, secret);
    server = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, 'equipment'), mediaUploadDir: path.join(scratch, 'media'), mediaSeedDir: null }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const request = async (route, method = 'GET', body, authorized = true) => {
      requests++;
      const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method, headers: { ...(authorized ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      return { status: response.status, body: await response.json() };
    };
    check((await request('/api/admin/app-texts', 'GET', undefined, false)).status === 401, 'Anonymous text admin access');
    const list = await request('/api/admin/app-texts?pageSize=2&page=2');
    check(list.status === 200 && list.body.items.length === 2 && list.body.page === 2 && list.body.totalPages > 1, 'Admin text pagination failed');
    const route = '/api/admin/app-texts/' + encodeURIComponent(text.key);
    const changed = await request(route, 'PATCH', { revision: 0, zh: '部署隔離測試', en: 'Isolated deployment check' });
    check(changed.status === 200 && changed.body.item.revision === 1 && !JSON.stringify(changed.body).includes('smoke-admin'), 'Text update/privacy failed');
    check((await request(route, 'PATCH', { revision: 0, zh: null, en: null })).status === 409, 'Stale text update not rejected');
    const published = await request('/api/app-texts', 'GET', undefined, false);
    check(published.status === 200 && published.body.overrides[text.key].en === 'Isolated deployment check', 'Public text update missing');
    check((await request(route, 'PATCH', { revision: 1, zh: null, en: null })).status === 200, 'Text restore failed');
    check(Object.keys((await request('/api/app-texts', 'GET', undefined, false)).body.overrides).length === 0, 'Restored overrides still published');
    const code = await request('/api/admin/registration-codes', 'POST', { name: 'Synthetic invite', phone: '69708882', countryCode: '+852', profileRole: 'participant' });
    check(code.status === 201 && /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code.body.code), 'Short invitation HTTP contract failed');
    const resolver = createResearchContentResolver(database);
    const labeled = resolver.event({ metadata: { equipmentId: '0', screen: 'outdoor.detail' } });
    check(labeled.contentKind === 'equipment' && (labeled.contentNameZh || labeled.contentNameEn), 'Research content label unavailable');
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('smoke-deleted','Synthetic account','+85269708883','participant','unused','unused',?,?)").run(now, now);
    const userToken = signToken({ id: 'smoke-deleted', profile_role: 'participant' }, secret);
    const userStatus = async () => {
      requests++;
      const result = await fetch('http://127.0.0.1:' + server.address().port + '/api/users/me', { headers: { authorization: 'Bearer ' + userToken }, signal: AbortSignal.timeout(10000) });
      return { status: result.status, body: await result.json() };
    };
    check((await userStatus()).status === 200, 'Valid smoke session refused');
    check((await request('/api/admin/users/smoke-deleted', 'DELETE')).status === 200, 'Admin account deletion failed');
    const removed = await userStatus();
    check(removed.status === 401 && removed.body.error === 'accountDeleted', 'Deleted session not revoked explicitly');
    check(database.pragma('integrity_check', { simple: true }) === 'ok', 'In-memory schema integrity failed');
    return { smoke: 'verified', requests, database: 'isolated-memory', externalCalls: 0, checks: ['short-invitation', 'text-permission', 'text-pagination', 'text-update-restore', 'conflict', 'research-label', 'deleted-session-revoked'] };
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); }
}

module.exports = { RELEASE, PAYLOAD, BASELINES, PINNED, MEMBERS, packageFiles, state, webTarget, installedWeb, backup, apply, rollback, runtime, smoke, webInventory, databaseSnapshot };
if (require.main === module) {
  const watchdog = setTimeout(() => { process.stderr.write('Release verification timed out\n'); process.exit(1); }, 120000); watchdog.unref();
  (async () => {
    const [command, ...args] = process.argv.slice(2); let result;
    if (command === 'package' && args.length === 1) { packageFiles(...args); result = { package: 'verified', release: RELEASE }; }
    else if (command === 'baseline' && args.length === 2) result = state(...args);
    else if (command === 'web-inventory' && args.length === 1) result = webInventory(...args);
    else if (command === 'web-target' && args.length === 2) result = webTarget(...args);
    else if (command === 'web-installed' && args.length === 2) result = installedWeb(...args);
    else if (command === 'runtime' && args.length === 1) result = runtime(...args);
    else if (command === 'smoke' && args.length === 2) result = await smoke(...args);
    else if (command === 'backup' && args.length === 4) result = backup(...args);
    else if (command === 'snapshot' && args.length === 3) result = await databaseSnapshot(...args);
    else if (command === 'apply' && args.length === 4) result = apply(...args);
    else if (command === 'rollback' && args.length === 4) result = rollback(...args);
    else throw new Error('Unsupported release command/arguments');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Release verification failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
