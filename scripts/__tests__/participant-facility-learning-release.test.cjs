const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { packageFiles, state, runtime, MEMBERS } = require('../verify-participant-facility-learning-release.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'pfl-release-test-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), temporaryRoot);
    assert.ok(path.basename(actual).startsWith('pfl-release-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  const api = path.join(root, 'api'), stage = path.join(root, 'package');
  fs.mkdirSync(path.join(api, 'src'), { recursive: true }); fs.mkdirSync(stage);
  const old = Object.fromEntries(['src/app.js', 'src/database.js', 'src/security.js', 'src/index.js', 'package.json', 'package-lock.json'].map(name => {
    const text = `old:${name}`; fs.writeFileSync(path.join(api, name), text); return [name, hash(text)];
  }));
  for (const name of MEMBERS) fs.writeFileSync(path.join(stage, name), `new:${name}`);
  const manifest = { version: 1, release: 'participant-facility-learning-20260922',
    files: ['app.js', 'database.js', 'learningProgress.js'].map(name => ({ path: `src/${name}`, archive: name, sha256: hash(`new:${name}`) })),
    baseline: { release: 'admin-document-voice-20260921', files: old } };
  const saveManifest = () => fs.writeFileSync(path.join(stage, 'release-manifest.json'), JSON.stringify(manifest));
  saveManifest();
  return { root, api, stage, manifest, saveManifest };
}
test('verified package accepts exactly three payloads and recognizes the reviewed baseline', t => {
  const f = fixture(t); packageFiles(f.stage); assert.equal(state(f.api, f.stage).state, 'baseline');
});
test('complete installation is idempotently recognized', t => {
  const f = fixture(t);
  for (const item of f.manifest.files) fs.copyFileSync(path.join(f.stage, item.archive), path.join(f.api, item.path));
  assert.equal(state(f.api, f.stage).state, 'installed');
});
test('partial replacements are rejected for install but accepted only for guarded rollback preflight', t => {
  const f = fixture(t); fs.copyFileSync(path.join(f.stage, 'app.js'), path.join(f.api, 'src/app.js'));
  assert.throws(() => state(f.api, f.stage), /Mixed backend/);
  assert.equal(state(f.api, f.stage, true).state, 'mixed');
});
test('unexpected source edits block installation and rollback rather than overwrite work', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.api, 'src/app.js'), 'unrelated operator edit');
  assert.throws(() => state(f.api, f.stage), /Unknown source/);
  assert.throws(() => state(f.api, f.stage, true), /Unknown source/);
});
test('dependency drift and unexpected source inventory are rejected', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.api, 'package-lock.json'), 'different lock');
  assert.throws(() => state(f.api, f.stage), /dependency change/);
  fs.writeFileSync(path.join(f.api, 'src/unrelated.js'), 'unexpected');
  assert.throws(() => state(f.api, f.stage), /Source inventory/);
});
test('altered payload and unknown archive members fail package verification', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.stage, 'app.js'), 'tampered');
  assert.throws(() => packageFiles(f.stage), /integrity failed/);
  fs.writeFileSync(path.join(f.stage, 'secrets.env'), 'not allowed');
  assert.throws(() => packageFiles(f.stage), /package members/);
});
test('manifest traversal and dependency payloads are rejected', t => {
  const f = fixture(t); f.manifest.files[0].path = '../app.js'; f.saveManifest();
  assert.throws(() => packageFiles(f.stage), /payload path/);
  f.manifest.files[0].path = 'src/app.js'; f.manifest.files[0].archive = 'package.json'; f.saveManifest();
  assert.throws(() => packageFiles(f.stage), /payload path/);
});
test('baseline inventory cannot escape API tree or predeclare a new helper', t => {
  const f = fixture(t); f.manifest.baseline.files['../private.json'] = hash('private'); f.saveManifest();
  assert.throws(() => packageFiles(f.stage), /Unsafe baseline/);
  delete f.manifest.baseline.files['../private.json']; f.manifest.baseline.files['src/learningProgress.js'] = hash('old helper'); f.saveManifest();
  assert.throws(() => packageFiles(f.stage), /unexpectedly appears/);
});
test('unexpected existing learning helper cannot be replaced or removed', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.api, 'src/learningProgress.js'), 'operator version');
  assert.throws(() => state(f.api, f.stage, true), /Unexpected existing learning helper/);
});
test('API source junction is rejected without reading through it', t => {
  const f = fixture(t), alias = path.join(f.root, 'linked-api');
  fs.symlinkSync(f.api, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => state(alias, f.stage), /Symlink target rejected/);
});
test('runtime verification rejects invalid PIDs before opening process metadata', () => {
  assert.throws(() => runtime('../1'), /Linux service PID/);
  assert.throws(() => runtime('0'), /Linux service PID/);
});
test('installer has fixed three-file scope and no production data/dependency/Web changes', () => {
  const installer = fs.readFileSync(path.resolve(__dirname, '../install-participant-facility-learning-20260922.sh.in'), 'utf8');
  assert.match(installer, /FILES=\(app\.js database\.js learningProgress\.js\)/);
  assert.match(installer, /sha256sum -c - <<'EMBEDDED_CHECKSUMS'/);
  assert.match(installer, /restore-preflight/);
  assert.match(installer, /systemctl stop "\$SERVICE"/);
  assert.match(installer, /healthy\nNEW_PID=/);
  assert.doesNotMatch(installer, /^\s*(?:sudo\s+)?(?:npm|npx|rm|gcloud|nginx|sqlite3)\s/m);
  assert.doesNotMatch(installer, /cp[^\n]*\.(?:sqlite|env)|mv[^\n]*uploads/);
  assert.equal((installer.match(/@@EMBEDDED_CHECKSUMS@@/g) || []).length, 1);
});
