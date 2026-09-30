const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const release = require('../verify-ai-recommendation-context-release.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t, learning = false) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'ai-context-release-test-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('ai-context-release-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  const api = path.join(root, 'api'), web = path.join(root, 'web'), stage = path.join(root, 'stage'), backup = path.join(root, 'backup');
  for (const dir of [path.join(api, 'src'), path.join(api, 'data'), path.join(api, 'uploads'), path.join(web, 'assets'), path.join(stage, 'web', 'assets'), backup]) fs.mkdirSync(dir, { recursive: true });
  const older = {};
  for (const name of ['src/app.js', 'src/database.js', 'src/security.js', 'src/index.js', 'src/assistantSymptomEvidence.js', 'package.json', 'package-lock.json']) {
    const value = `old:${name}`; older[name] = hash(value); fs.writeFileSync(path.join(api, name), value);
  }
  const newer = { ...older, 'src/app.js': hash('learning-app'), 'src/database.js': hash('learning-db'), 'src/learningProgress.js': hash('learning-progress') };
  if (learning) for (const [name, text] of [['app.js', 'learning-app'], ['database.js', 'learning-db'], ['learningProgress.js', 'learning-progress']]) fs.writeFileSync(path.join(api, 'src', name), text);
  const values = { 'app.js': 'new-app', 'database.js': 'learning-db', 'learningProgress.js': 'learning-progress', 'assistantSymptomEvidence.js': 'new-evidence', 'assistantSymptomRecommendations.js': 'new-ai' };
  for (const name of release.MEMBERS) fs.writeFileSync(path.join(stage, name), values[name] || `release:${name}`);
  for (const name of Object.keys(release.PINNED)) fs.copyFileSync(path.resolve(__dirname, '..', name), path.join(stage, name));
  fs.writeFileSync(path.join(stage, 'web', 'index.html'), '<html>new assets/new.js</html>');
  fs.writeFileSync(path.join(stage, 'web', 'assets', 'new.js'), 'new web');
  fs.writeFileSync(path.join(web, 'index.html'), '<html>old assets/old.js</html>');
  fs.writeFileSync(path.join(web, 'assets', 'old.js'), 'older web');
  fs.writeFileSync(path.join(api, 'data', 'sentinel.sqlite'), 'database must survive');
  fs.writeFileSync(path.join(api, 'uploads', 'sentinel.mp4'), 'uploads must survive');
  fs.writeFileSync(path.join(api, '.env'), 'secret must survive');
  const manifest = { version: 1, release: release.RELEASE, files: release.PAYLOAD.map(name => ({ path: `src/${name}`, archive: name, sha256: hash(values[name]) })),
    baselines: [{ release: release.BASELINES[0], files: older }, { release: release.BASELINES[1], files: newer }], web: release.webInventory(path.join(stage, 'web')) };
  const save = () => fs.writeFileSync(path.join(stage, 'release-manifest.json'), JSON.stringify(manifest)); save();
  return { root, api, web, stage, backup, manifest, save, args: [api, web, stage, backup] };
}
for (const learning of [false, true]) test(`accepts reviewed ${learning ? 'learning' : 'September 21'} baseline`, t => {
  const f = fixture(t, learning); release.packageFiles(f.stage);
  assert.equal(release.state(f.api, f.stage).release, release.BASELINES[Number(learning)]);
});
for (const learning of [false, true]) test(`apply + rollback preserve production data and prior assets (${learning})`, t => {
  const f = fixture(t, learning); release.backup(...f.args); release.apply(...f.args);
  assert.equal(release.state(f.api, f.stage).state, 'installed'); release.installedWeb(f.web, f.stage);
  assert.equal(fs.readFileSync(path.join(f.web, 'assets', 'old.js'), 'utf8'), 'older web');
  release.rollback(...f.args);
  assert.equal(release.state(f.api, f.stage).release, release.BASELINES[Number(learning)]);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), '<html>old assets/old.js</html>');
  assert.equal(fs.existsSync(path.join(f.web, 'assets', 'new.js')), false);
  assert.equal(fs.readFileSync(path.join(f.backup, 'failed-release', 'web', 'assets', 'new.js'), 'utf8'), 'new web');
  assert.equal(fs.readFileSync(path.join(f.api, 'data', 'sentinel.sqlite'), 'utf8'), 'database must survive');
  assert.equal(fs.readFileSync(path.join(f.api, 'uploads', 'sentinel.mp4'), 'utf8'), 'uploads must survive');
  assert.equal(fs.readFileSync(path.join(f.api, '.env'), 'utf8'), 'secret must survive');
  assert.equal(fs.existsSync(path.join(f.backup, 'database')), false);
});
test('rejects mixed source versions, dependency drift and unexpected helpers', t => {
  const f = fixture(t); fs.copyFileSync(path.join(f.stage, 'app.js'), path.join(f.api, 'src', 'app.js'));
  assert.throws(() => release.state(f.api, f.stage), /mixed backend/); assert.equal(release.state(f.api, f.stage, true).state, 'mixed');
  fs.writeFileSync(path.join(f.api, 'package-lock.json'), 'changed');
  assert.throws(() => release.state(f.api, f.stage, true), /dependency change/);
  fs.writeFileSync(path.join(f.api, 'src', 'extra.js'), 'operator file'); assert.throws(() => release.state(f.api, f.stage), /source inventory/);
});
test('payload checksum, inventory, pinned helper and Web integrity tampering rejected', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.stage, 'app.js'), 'changed'); assert.throws(() => release.packageFiles(f.stage), /checksum mismatch/);
  fs.writeFileSync(path.join(f.stage, 'app.js'), 'new-app');
  fs.appendFileSync(path.join(f.stage, Object.keys(release.PINNED)[0]), 'changed'); assert.throws(() => release.packageFiles(f.stage), /helper hash mismatch/);
  fs.copyFileSync(path.resolve(__dirname, '..', Object.keys(release.PINNED)[0]), path.join(f.stage, Object.keys(release.PINNED)[0]));
  fs.appendFileSync(path.join(f.stage, 'web', 'index.html'), 'changed'); assert.throws(() => release.packageFiles(f.stage), /Web inventory/);
  fs.writeFileSync(path.join(f.stage, 'secret.env'), 'unexpected'); assert.throws(() => release.packageFiles(f.stage), /package members/);
});
test('Web immutable collision blocks install; old assets otherwise retained', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.web, 'assets', 'new.js'), 'collision');
  assert.throws(() => release.webTarget(f.web, f.stage), /Immutable/); assert.throws(() => release.backup(...f.args), /Immutable/);
});
test('target changes after backup block apply before replacing source', t => {
  const f = fixture(t); release.backup(...f.args); fs.writeFileSync(path.join(f.web, 'index.html'), 'operator edit');
  assert.throws(() => release.apply(...f.args), /Target changed after backup/);
  assert.equal(release.state(f.api, f.stage).state, 'baseline');
});
test('concurrent Web change blocks rollback without overwriting operator work', t => {
  const f = fixture(t); release.backup(...f.args); release.apply(...f.args); fs.writeFileSync(path.join(f.web, 'index.html'), 'operator edit');
  assert.throws(() => release.rollback(...f.args), /Concurrent target change/);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'operator edit');
  assert.equal(release.state(f.api, f.stage).state, 'installed');
});
test('backup corruption and recovery traversal block rollback', t => {
  const f = fixture(t); release.backup(...f.args); release.apply(...f.args);
  fs.writeFileSync(path.join(f.backup, 'web', 'index.html'), 'tampered'); assert.throws(() => release.rollback(...f.args), /Backup checksum/);
  const plan = JSON.parse(fs.readFileSync(path.join(f.backup, 'recovery.json'))); plan.entries[0].path = '../.env'; fs.writeFileSync(path.join(f.backup, 'recovery.json'), JSON.stringify(plan));
  assert.throws(() => release.rollback(...f.args), /Recovery inventory/);
});
test('learning source must match previous release and baseline inventory cannot expand', t => {
  const f = fixture(t); f.manifest.files.find(v => v.archive === 'learningProgress.js').sha256 = hash('changed'); fs.writeFileSync(path.join(f.stage, 'learningProgress.js'), 'changed'); f.save();
  assert.throws(() => release.packageFiles(f.stage), /preserved byte-for-byte/);
});
test('source symlinks and overlapping backup roots are rejected', t => {
  const f = fixture(t), alias = path.join(f.root, 'linked-api'); fs.symlinkSync(f.api, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => release.state(alias, f.stage), /Symlink/);
  assert.throws(() => release.backup(f.api, f.web, f.stage, path.join(f.api, 'data')), /must not overlap/);
});
test('installer fixed scope, embedded hashes, shared deployment lock and no dependency/Nginx/data changes', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../install-ai-recommendation-context-20260922.sh.in'), 'utf8');
  assert.match(text, /WEB_DIR="\/var\/www\/outdoor-fit"/); assert.match(text, /FILES=\(app\.js database\.js learningProgress\.js assistantSymptomEvidence\.js assistantSymptomRecommendations\.js\)/);
  assert.match(text, /sha256sum -c - <<'EMBEDDED_CHECKSUMS'/); assert.match(text, /rollback "\$API_DIR" "\$WEB_DIR"/);
  assert.match(text, /outdoor-fit-file-explorer-deploy\.lock/); assert.doesNotMatch(text, /^\s*(?:sudo\s+)?(?:npm|npx|rm|gcloud|nginx|sqlite3)\s/m);
  assert.equal((text.match(/@@EMBEDDED_CHECKSUMS@@/g) || []).length, 1);
});
