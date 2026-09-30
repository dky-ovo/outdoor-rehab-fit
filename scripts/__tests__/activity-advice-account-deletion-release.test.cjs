const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const release = require('../verify-activity-advice-account-deletion-release.cjs');
const project = path.resolve(__dirname, '../..');
const Database = createRequire(path.join(project, 'server/package.json'))('better-sqlite3');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'activity-advice-release-test-'));
  const close = [];
  t.after(() => {
    for (const cleanup of close) cleanup();
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('activity-advice-release-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  const api = path.join(root, 'api'), web = path.join(root, 'web'), stage = path.join(root, 'stage'), backup = path.join(root, 'backup');
  for (const dir of [path.join(api, 'src'), path.join(api, 'data'), path.join(api, 'uploads'), path.join(web, 'assets'), path.join(stage, 'web', 'assets'), backup]) fs.mkdirSync(dir, { recursive: true });
  const baseline = {};
  for (const name of ['src/app.js', 'src/database.js', 'src/registrationCodes.js', 'src/security.js', 'src/index.js', 'src/assistantSymptomRecommendations.js', 'src/learningProgress.js', 'src/appTexts.js', 'src/appTextCatalog.json', 'src/researchContentLabels.js', 'package.json', 'package-lock.json']) {
    const value = 'old:' + name; baseline[name] = hash(value); fs.writeFileSync(path.join(api, name), value);
  }
  const values = Object.fromEntries(release.PAYLOAD.map(name => [name, 'new:' + name]));
  for (const name of release.MEMBERS) fs.writeFileSync(path.join(stage, name), values[name] || 'release:' + name);
  for (const name of Object.keys(release.PINNED)) fs.copyFileSync(path.resolve(__dirname, '..', name), path.join(stage, name));
  fs.writeFileSync(path.join(stage, 'web/index.html'), '<html>new assets/new.js</html>');
  fs.writeFileSync(path.join(stage, 'web/assets/new.js'), 'new web');
  fs.writeFileSync(path.join(web, 'index.html'), '<html>old assets/old.js</html>');
  fs.writeFileSync(path.join(web, 'assets/old.js'), 'older web');
  fs.writeFileSync(path.join(api, 'data/sentinel.sqlite'), 'database must survive');
  fs.writeFileSync(path.join(api, 'uploads/sentinel.mp4'), 'uploads must survive');
  fs.writeFileSync(path.join(api, '.env'), 'secret must survive');
  const manifest = { version: 1, release: release.RELEASE, files: release.PAYLOAD.map(name => ({ path: 'src/' + name, archive: name, sha256: hash(values[name]) })),
    baselines: [{ release: release.BASELINES[0], files: baseline }], web: release.webInventory(path.join(stage, 'web')) };
  const saveChecksums = () => {
    const names = release.MEMBERS.filter(name => !name.startsWith('install-'));
    const lines = names.map(name => hash(fs.readFileSync(path.join(stage, name))) + '  ' + name);
    fs.writeFileSync(path.join(stage, 'install-' + release.RELEASE + '.sh'), "#!/bin/bash\nsha256sum -c - <<'EMBEDDED_CHECKSUMS'\n" + lines.join('\n') + '\nEMBEDDED_CHECKSUMS\n');
  };
  const save = () => { fs.writeFileSync(path.join(stage, 'release-manifest.json'), JSON.stringify(manifest)); saveChecksums(); }; save();
  return { root, api, web, stage, backup, manifest, save, saveChecksums, close, args: [api, web, stage, backup] };
}
test('accepts approved baseline; source and Web apply/rollback preserve user data', t => {
  const f = fixture(t); release.packageFiles(f.stage);
  assert.equal(release.state(f.api, f.stage).release, release.BASELINES[0]);
  release.backup(...f.args); release.apply(...f.args);
  assert.equal(release.state(f.api, f.stage).state, 'installed'); release.installedWeb(f.web, f.stage);
  assert.equal(fs.readFileSync(path.join(f.web, 'assets/old.js'), 'utf8'), 'older web');
  release.rollback(...f.args);
  assert.equal(release.state(f.api, f.stage).state, 'baseline');
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), '<html>old assets/old.js</html>');
  assert.equal(fs.readFileSync(path.join(f.api, 'src/appTexts.js'), 'utf8'), 'old:src/appTexts.js');
  assert.equal(fs.existsSync(path.join(f.web, 'assets/new.js')), false);
  assert.equal(fs.readFileSync(path.join(f.backup, 'failed-release/web/assets/new.js'), 'utf8'), 'new web');
  assert.equal(fs.readFileSync(path.join(f.api, 'data/sentinel.sqlite'), 'utf8'), 'database must survive');
  assert.equal(fs.readFileSync(path.join(f.api, 'uploads/sentinel.mp4'), 'utf8'), 'uploads must survive');
  assert.equal(fs.readFileSync(path.join(f.api, '.env'), 'utf8'), 'secret must survive');
});
test('repeat install has verified installed state and a fresh backup', t => {
  const f = fixture(t); release.backup(...f.args); release.apply(...f.args);
  const next = path.join(f.root, 'backup2'); fs.mkdirSync(next);
  release.backup(f.api, f.web, f.stage, next); release.apply(f.api, f.web, f.stage, next);
  release.rollback(f.api, f.web, f.stage, next);
  assert.equal(release.state(f.api, f.stage).state, 'installed');
});
test('rejects mixed sources, dependencies and unexpected files', t => {
  const f = fixture(t); fs.copyFileSync(path.join(f.stage, 'app.js'), path.join(f.api, 'src/app.js'));
  assert.throws(() => release.state(f.api, f.stage), /mixed backend/);
  assert.equal(release.state(f.api, f.stage, true).state, 'mixed');
  fs.writeFileSync(path.join(f.api, 'package-lock.json'), 'changed');
  assert.throws(() => release.state(f.api, f.stage, true), /dependency change/);
  fs.writeFileSync(path.join(f.api, 'src/extra.js'), 'operator file');
  assert.throws(() => release.state(f.api, f.stage), /source inventory/);
});
test('tampered payload/helper/Web and extra roots are rejected', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.stage, 'app.js'), 'changed');
  assert.throws(() => release.packageFiles(f.stage), /checksum mismatch/);
  fs.writeFileSync(path.join(f.stage, 'app.js'), 'new:app.js');
  const helper = Object.keys(release.PINNED)[0]; fs.appendFileSync(path.join(f.stage, helper), 'changed');
  assert.throws(() => release.packageFiles(f.stage), /helper hash mismatch/);
  fs.copyFileSync(path.resolve(__dirname, '..', helper), path.join(f.stage, helper));
  fs.appendFileSync(path.join(f.stage, 'web/index.html'), 'changed');
  assert.throws(() => release.packageFiles(f.stage), /Web inventory/);
  fs.writeFileSync(path.join(f.stage, 'secret.env'), 'unexpected');
  assert.throws(() => release.packageFiles(f.stage), /package members/);
});
test('embedded checksums reject omitted entries, duplicates and modified README', t => {
  const f = fixture(t), installer = path.join(f.stage, 'install-' + release.RELEASE + '.sh');
  fs.appendFileSync(path.join(f.stage, 'README.md'), 'tampered');
  assert.throws(() => release.packageFiles(f.stage), /Package checksum/); f.saveChecksums();
  const text = fs.readFileSync(installer, 'utf8'), lines = text.split('\n');
  fs.writeFileSync(installer, lines.filter(line => !line.endsWith('  README.md')).join('\n'));
  assert.throws(() => release.packageFiles(f.stage), /Incomplete embedded/);
  fs.writeFileSync(installer, text.replace('\nEMBEDDED_CHECKSUMS', '\n' + lines[2] + '\nEMBEDDED_CHECKSUMS'));
  assert.throws(() => release.packageFiles(f.stage), /duplicate embedded/);
});
test('baseline traversal, unknown versions and payload duplication rejected', t => {
  const f = fixture(t); f.manifest.baselines[0].files['../.env'] = hash('x'); f.save();
  assert.throws(() => release.packageFiles(f.stage), /Unsafe baseline/);
  delete f.manifest.baselines[0].files['../.env']; f.manifest.baselines[0].release = 'old-unknown'; f.save();
  assert.throws(() => release.packageFiles(f.stage), /Approved baseline/);
  f.manifest.baselines[0].release = release.BASELINES[0]; f.manifest.files[1] = f.manifest.files[0]; f.save();
  assert.throws(() => release.packageFiles(f.stage), /duplicate payload/);
});
test('immutable collisions, concurrent writes and corrupt backups are protected', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.web, 'assets/new.js'), 'collision');
  assert.throws(() => release.backup(...f.args), /Immutable/);
  fs.unlinkSync(path.join(f.web, 'assets/new.js')); release.backup(...f.args);
  fs.writeFileSync(path.join(f.web, 'index.html'), 'operator edit');
  assert.throws(() => release.apply(...f.args), /Target changed after backup/);
  fs.copyFileSync(path.join(f.backup, 'web/index.html'), path.join(f.web, 'index.html')); release.apply(...f.args);
  fs.writeFileSync(path.join(f.web, 'index.html'), 'operator edit');
  assert.throws(() => release.rollback(...f.args), /Concurrent target change/);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'operator edit');
  fs.copyFileSync(path.join(f.stage, 'web/index.html'), path.join(f.web, 'index.html'));
  fs.writeFileSync(path.join(f.backup, 'web/index.html'), 'tampered');
  assert.throws(() => release.rollback(...f.args), /Backup checksum/);
});
test('symlinks, hard links and overlapping roots rejected', t => {
  const f = fixture(t), alias = path.join(f.root, 'linked-api');
  fs.symlinkSync(f.api, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => release.state(alias, f.stage), /Symlink/);
  assert.throws(() => release.backup(f.api, f.web, f.stage, path.join(f.api, 'data')), /must not overlap/);
  fs.linkSync(path.join(f.stage, 'app.js'), path.join(f.root, 'hard-linked-source'));
  assert.throws(() => release.packageFiles(f.stage), /hard|type\/size/i);
});
function databaseFixture(t) {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.api, 'package.json'), '{"name":"isolated-snapshot-test"}');
  fs.symlinkSync(path.join(project, 'server/node_modules'), path.join(f.api, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  f.dbPath = path.join(f.api, 'data/runtime.sqlite');
  f.runtimeFile = path.join(f.root, 'runtime.json');
  fs.writeFileSync(f.runtimeFile, JSON.stringify({ dbPath: f.dbPath, port: 3000 }));
  f.db = new Database(f.dbPath); f.close.push(() => f.db.open && f.db.close());
  f.db.pragma('journal_mode=WAL'); f.db.pragma('wal_autocheckpoint=0');
  f.db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('committed in WAL')");
  return f;
}
test('SQLite backup includes committed WAL rows and validates an independent consistent snapshot', async t => {
  const f = databaseFixture(t); assert.ok(fs.statSync(f.dbPath + '-wal').size > 0);
  const result = await release.databaseSnapshot(f.api, f.backup, f.runtimeFile);
  assert.equal(result.snapshot, 'verified'); assert.equal(result.restore, 'manual-only');
  f.db.prepare('INSERT INTO example VALUES (?)').run('after backup');
  const snapshot = new Database(path.join(f.backup, 'database/database.sqlite'), { readonly: true });
  try {
    assert.deepEqual(snapshot.prepare('SELECT value FROM example').all(), [{ value: 'committed in WAL' }]);
    assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
  } finally { snapshot.close(); }
  const meta = JSON.parse(fs.readFileSync(path.join(f.backup, 'database-snapshot.json')));
  assert.equal(meta.sha256, hash(fs.readFileSync(path.join(f.backup, 'database/database.sqlite'))));
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM example').get().count, 2);
  await assert.rejects(release.databaseSnapshot(f.api, f.backup, f.runtimeFile), /Snapshot already exists/);
});
test('snapshot cannot read a database outside the API data directory or an unknown runtime', async t => {
  const f = databaseFixture(t);
  fs.writeFileSync(f.runtimeFile, JSON.stringify({ dbPath: path.join(f.api, '.env'), port: 3000 }));
  await assert.rejects(release.databaseSnapshot(f.api, f.backup, f.runtimeFile), /Unapproved runtime/);
  assert.equal(fs.existsSync(path.join(f.backup, 'database')), false);
  fs.writeFileSync(f.runtimeFile, JSON.stringify({ dbPath: f.dbPath, port: 1234 }));
  await assert.rejects(release.databaseSnapshot(f.api, f.backup, f.runtimeFile), /Unapproved runtime/);
});
test('snapshot corruption fails without reporting success or altering the source', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.api, 'package.json'), '{}');
  fs.symlinkSync(path.join(project, 'server/node_modules'), path.join(f.api, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const runtimeFile = path.join(f.root, 'runtime.json');
  fs.writeFileSync(runtimeFile, JSON.stringify({ dbPath: path.join(f.api, 'data/sentinel.sqlite'), port: 3000 }));
  await assert.rejects(release.databaseSnapshot(f.api, f.backup, runtimeFile), /database|file/i);
  assert.equal(fs.existsSync(path.join(f.backup, 'database-snapshot.json')), false);
  assert.equal(fs.readFileSync(path.join(f.api, 'data/sentinel.sqlite'), 'utf8'), 'database must survive');
});
test('isolated current-source HTTP smoke exercises text/invitation/research without production writes', async t => {
  const f = fixture(t), scratch = path.join(f.root, 'smoke'); fs.mkdirSync(scratch);
  const result = await release.smoke(path.join(project, 'server'), scratch);
  assert.equal(result.smoke, 'verified'); assert.equal(result.externalCalls, 0); assert.equal(result.requests, 11);
});
test('installer snapshot precedes replacement and retains fixed safe scope', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../install-activity-advice-account-deletion-20260923.sh.in'), 'utf8');
  assert.match(text, /FILES=\(app\.js appTextCatalog\.json\)/);
  assert.match(text, /sha256sum -c - <<'EMBEDDED_CHECKSUMS'/);
  assert.ok(text.indexOf('systemctl stop "$SERVICE"', text.indexOf('BACKUP_DIR="$(mktemp')) < text.indexOf('"$CHECKER" snapshot'));
  assert.ok(text.indexOf('"$CHECKER" snapshot') < text.indexOf('TOUCHED=1'));
  assert.match(text, /2 \* db_bytes/); assert.match(text, /outdoor-fit-file-explorer-deploy\.lock/);
  assert.doesNotMatch(text, /^\s*(?:sudo\s+)?(?:npm|npx|rm|gcloud|nginx|sqlite3)\s/m);
  assert.equal((text.match(/@@EMBEDDED_CHECKSUMS@@/g) || []).length, 1);
});
