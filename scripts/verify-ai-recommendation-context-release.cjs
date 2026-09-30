#!/usr/bin/env node
'use strict';

// The pinned older checkers supply only reviewed path/Web inventory routines,
// runtime inspection and isolated learning smoke; their release installers are
// never invoked. No production database, secrets, dependency install or Nginx.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const RELEASE = 'ai-recommendation-context-20260922';
const PAYLOAD = ['app.js', 'database.js', 'learningProgress.js', 'assistantSymptomEvidence.js', 'assistantSymptomRecommendations.js'];
const BASELINES = ['admin-document-voice-20260921', 'participant-facility-learning-20260922'];
const PINNED = {
  'verify-contact-feedback-release.cjs': '2f2b53e730af4828a8e87263be38a4e646a424d5d1ee57dcf2f9d498c10ecf73',
  'verify-ai-chatbox-guide-backend-patch.cjs': '21ba5dcd319ab430b716dbdc19c6a51792af122e064e57e06aa2c4a55927bcf9',
  'verify-participant-facility-learning-release.cjs': '80a5ffcbb88b32ef97575741c1f1fde37d8fc396c19886bc0c6afc40020a186c',
};
const MEMBERS = [...PAYLOAD, `install-${RELEASE}.sh`, 'verify-ai-recommendation-context-release.cjs', ...Object.keys(PINNED), 'release-manifest.json', 'README.md'];
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
const { runtime, smoke: learningSmoke } = require('./verify-participant-facility-learning-release.cjs');
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
  check(Array.isArray(manifest.files) && manifest.files.length === PAYLOAD.length, 'Exactly five source payloads required');
  const target = {};
  for (const item of manifest.files) {
    exact(item, ['path', 'archive', 'sha256'], 'Payload');
    check(PAYLOAD.includes(item.archive) && item.path === `src/${item.archive}` && !Object.hasOwn(target, item.path), 'Unsafe/duplicate payload');
    check(isHash(item.sha256) && hash(bytes[item.archive]) === item.sha256, 'Payload checksum mismatch'); target[item.path] = item.sha256;
  }
  check(Array.isArray(manifest.baselines) && manifest.baselines.length === 2 && same(manifest.baselines.map(v => v.release), BASELINES), 'Two approved baselines required');
  for (const item of manifest.baselines) {
    exact(item, ['release', 'files'], 'Baseline');
    check(item.files && typeof item.files === 'object' && !Array.isArray(item.files), 'Invalid baseline inventory');
    for (const name of ['src/app.js', 'src/database.js', 'src/security.js', 'src/index.js', 'src/assistantSymptomEvidence.js', 'package.json', 'package-lock.json']) check(Object.hasOwn(item.files, name), `Baseline missing ${name}`);
    for (const [name, digest] of Object.entries(item.files)) check(/^(src\/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$/.test(name) && isHash(digest), 'Unsafe baseline path/hash');
    check(!Object.hasOwn(item.files, 'src/assistantSymptomRecommendations.js'), 'New recommendation helper is not a baseline file');
  }
  const older = manifest.baselines.find(v => v.release === BASELINES[0]).files;
  const newer = manifest.baselines.find(v => v.release === BASELINES[1]).files;
  check(!Object.hasOwn(older, 'src/learningProgress.js') && Object.hasOwn(newer, 'src/learningProgress.js'), 'Invalid learning baseline inventory');
  check(same(Object.keys(newer), [...Object.keys(older), 'src/learningProgress.js']), 'Unrelated baseline inventory drift');
  for (const name of Object.keys(older).filter(v => !['src/app.js', 'src/database.js'].includes(v))) check(older[name] === newer[name], `Unrelated baseline change: ${name}`);
  for (const name of ['src/database.js', 'src/learningProgress.js']) check(target[name] === newer[name], 'Existing learning functionality must be preserved byte-for-byte');
  check(Array.isArray(manifest.web) && manifest.web.length > 0 && manifest.web.length <= 10000, 'Invalid Web inventory');
  for (const item of manifest.web) {
    exact(item, ['path', 'sha256', 'bytes'], 'Web entry');
    check(validWebPath(item.path) && isHash(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= MAX, 'Invalid Web entry');
  }
  const sort = items => [...items].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  check(JSON.stringify(sort(manifest.web)) === JSON.stringify(sort(webInventory(path.join(stage, 'web')))), 'Web inventory/hash mismatch');
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
  const temp = path.join(path.dirname(target), `.ai-context-${crypto.randomUUID()}.tmp`), fd = fs.openSync(temp, 'wx', mode);
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
async function smoke(api, scratch) {
  const learning = await learningSmoke(api, scratch);
  const load = name => import(pathToFileURL(safePath(path.join(api, 'src', name))).href);
  const [{ symptomConcern, symptomGuideCandidates }, { deepSeekSymptomRecommendations }] = await Promise.all([
    load('assistantSymptomEvidence.js'), load('assistantSymptomRecommendations.js'),
  ]);
  const question = '走路痛', history = [{ role: 'user', content: '腿痛推薦器材' }, { role: 'user', content: '膝蓋' }];
  const catalog = [{ id: '4', name: '斜坡', ptTip: '可以減輕膝部疼痛。' }, { id: '9', name: '手部伸展', ptTip: '伸展手部肌肉。' }];
  const concern = symptomConcern(question, history);
  const candidates = symptomGuideCandidates(question, catalog, 'zh', history, { requireRequest: false });
  check(candidates.length === 1 && candidates[0].id === '4' && candidates[0].evidence.targets.includes('knee'), 'Symptom follow-up/context candidate contract failed');
  let mockCalls = 0;
  const client = { chat: { completions: { create: async body => {
    mockCalls++;
    const context = JSON.parse(body.messages.find(v => v.role === 'user').content);
    check(context.candidates.length === 1 && context.candidates[0].id === '4', 'Unrelated equipment leaked into mock model context');
    check(context.previousUserQuestions.length === 2, 'Follow-up question context was lost');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ style: 'follow_up', recommendations: context.candidates.map(({ id, evidence }) => ({ id, evidence })) }) } }] };
  } } } };
  const args = { client, model: 'mock-no-network', question, history, locale: 'zh', concern, catalog, getCatalog: () => catalog, timeoutMs: 1000 };
  const answer = await deepSeekSymptomRecommendations(args);
  check(mockCalls === 1 && answer.deepSeekUsed === true && answer.evidencePolicy === 'app-symptom-deepseek-v2' && answer.recommendations.length === 1 && answer.recommendations[0].id === '4', 'Verified model selection contract failed');
  let rejected = false;
  try {
    await deepSeekSymptomRecommendations({ ...args, client: { chat: { completions: { create: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ recommendations: [{ id: '9', evidence: candidates[0].evidence }] }) } }] }) } } } });
  } catch (error) { rejected = error.code === 'deepSeekInvalidResponse'; }
  check(rejected, 'Unsupported model equipment selection was not rejected');
  const [{ createApp }, { createDatabase }, { signToken }] = await Promise.all([load('app.js'), load('database.js'), load('security.js')]);
  const database = createDatabase(':memory:'), secret = 'isolated-ai-context-smoke-only', now = new Date().toISOString();
  let server;
  try {
    database.prepare('INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('smoke-reader', 'PRIVATE_SMOKE_ACCOUNT', '+85269709991', 'participant', 'PRIVATE_SMOKE_SALT', 'PRIVATE_SMOKE_HASH', now, now);
    database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'").run('PRIVATE_SMOKE_KEY');
    const calls = [];
    server = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, 'symptom-equipment'), mediaUploadDir: path.join(scratch, 'symptom-media'), mediaSeedDir: null,
      deepSeekClientFactory: () => ({ chat: { completions: { create: async body => {
        calls.push(body); const context = JSON.parse(body.messages.find(v => v.role === 'user').content);
        check(Array.isArray(context.candidates), 'HTTP recommendation bypassed the supplied evidence contract');
        for (const privateText of ['PRIVATE_SMOKE_ACCOUNT', 'PRIVATE_SMOKE_SALT', 'PRIVATE_SMOKE_HASH', 'PRIVATE_SMOKE_KEY']) check(!JSON.stringify(body).includes(privateText), 'Private synthetic account fields leaked into provider context');
        return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ style: 'follow_up', recommendations: context.candidates.slice(0, 3).map(({ id, evidence }) => ({ id, evidence })) }) } }] };
      } } } }),
    }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const conversation = [];
    for (const message of ['我现在腿痛建议使用什么器械', '膝盖', '走路痛']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken({ id: 'smoke-reader' }, secret)}` }, body: JSON.stringify({ message, locale: 'zh', history: conversation }), signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      check(response.status === 200 && body.deepSeekUsed === true && body.evidencePolicy === 'app-symptom-deepseek-v2', 'HTTP symptom query did not use the provider selection contract');
      check(Array.isArray(body.recommendations) && body.recommendations.length > 0 && !body.recommendations.some(item => item.id === '28'), 'HTTP symptom result lost guide links or included unsupported Foot Massage Path');
      conversation.push({ role: 'user', content: message }, { role: 'assistant', content: body.reply });
    }
    check(calls.length === 3 && JSON.parse(calls[2].messages.find(v => v.role === 'user').content).concern.targets.join(',') === 'knee', 'Three-turn symptom context was not preserved');
    return { ...learning, requests: learning.requests + 3, symptomContext: 'three HTTP turns + model-selection/unrelated-ID rejection verified', mockAiCalls: mockCalls + calls.length, externalAiCalls: 0 };
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); }
}
module.exports = { RELEASE, PAYLOAD, BASELINES, PINNED, MEMBERS, packageFiles, state, webTarget, installedWeb, backup, apply, rollback, runtime, smoke, webInventory };
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
    else if (command === 'apply' && args.length === 4) result = apply(...args);
    else if (command === 'rollback' && args.length === 4) result = rollback(...args);
    else throw new Error('Unsupported release command/arguments');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Release verification failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
