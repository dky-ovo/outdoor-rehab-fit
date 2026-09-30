const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const release = require('../verify-team-about-release.cjs');
const project = path.resolve(__dirname, '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const entry = (key, value = 'Original') => ({ key, group: 'Settings', label: value, kind: 'text', zh: value, en: value, sources: ['APP'] });
const legacyPackage = () => {
  const value = JSON.parse(fs.readFileSync(path.join(project, 'server/package.json'), 'utf8'));
  delete value.dependencies.mysql2;
  const bytes = JSON.stringify(value, null, 2) + '\n';
  assert.equal(hash(bytes), 'dba7e32f1722f1060d614ec705ce9314d73aa065852744b8680a2da1790b4600', 'Reviewed legacy package metadata changed');
  return bytes;
};

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'team-about-release-test-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent);
    assert.ok(path.basename(root).startsWith('team-about-release-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const api = path.join(root, 'api'), web = path.join(root, 'web'), stage = path.join(root, 'stage'), backup = path.join(root, 'backup');
  for (const directory of [path.join(api, 'src'), path.join(api, 'data'), path.join(api, 'uploads'), path.join(web, 'assets'), path.join(stage, 'web/assets'), backup]) fs.mkdirSync(directory, { recursive: true });
  for (const name of release.SUPPORT_FILES) fs.copyFileSync(path.join(project, 'server', name), path.join(api, name));
  fs.writeFileSync(path.join(api, release.CATALOG_PATH), JSON.stringify({ version: 1, items: [entry('copy.existing')] }));
  fs.writeFileSync(path.join(api, 'data/sentinel.sqlite'), 'preserve database');
  fs.writeFileSync(path.join(api, 'uploads/sentinel.png'), 'preserve upload');
  fs.writeFileSync(path.join(api, 'other-source.js'), 'preserve unrelated source');
  fs.writeFileSync(path.join(web, 'index.html'), 'old html');
  fs.writeFileSync(path.join(web, 'assets/old.js'), 'old asset');
  fs.writeFileSync(path.join(stage, 'web/index.html'), 'new html');
  fs.writeFileSync(path.join(stage, 'web/assets/new.js'), 'new asset');
  for (const name of release.ROOT_FILES) if (!name.startsWith('install-')) fs.writeFileSync(path.join(stage, name), name);
  fs.copyFileSync(path.join(project, 'scripts/verify-team-about-release.cjs'), path.join(stage, 'verify-team-about-release.cjs'));
  fs.writeFileSync(path.join(stage, 'appTextCatalog.json'), JSON.stringify({ version: 1, items: [entry('copy.existing'), entry('privacy.title', 'Privacy policy'), entry('teamInfo.title', 'Our Team')] }));
  const manifest = { version: 1, release: release.RELEASE, web: release.webInventory(path.join(stage, 'web')), catalog: {}, support: release.supportInventory(api) };
  const seal = () => {
    const bytes = fs.readFileSync(path.join(stage, 'appTextCatalog.json'));
    manifest.catalog = { path: release.CATALOG_PATH, archive: 'appTextCatalog.json', sha256: hash(bytes), bytes: bytes.length };
    fs.writeFileSync(path.join(stage, 'release-manifest.json'), JSON.stringify(manifest));
    const sums = release.ROOT_FILES.filter(name => name !== release.INSTALLER).map(name => hash(fs.readFileSync(path.join(stage, name))) + '  ' + name).join('\n');
    const template = fs.readFileSync(path.join(project, 'scripts', release.INSTALLER + '.in'), 'utf8');
    fs.writeFileSync(path.join(stage, release.INSTALLER), template.replace('@@EMBEDDED_CHECKSUMS@@', sums));
  };
  seal();
  return { root, api, web, stage, backup, manifest, seal, args: [api, web, stage, backup] };
}

test('complete Web and one catalog apply/rollback preserve other source and user data', t => {
  const f = fixture(t), before = release.supportInventory(f.api);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  release.backup(...f.args); release.apply(...f.args);
  assert.equal(release.installed(f.api, f.web, f.stage).catalogFiles, 1);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'new html');
  assert.equal(fs.readFileSync(path.join(f.web, 'assets/old.js'), 'utf8'), 'old asset');
  release.rollback(...f.args);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'old html');
  assert.equal(fs.existsSync(path.join(f.web, 'assets/new.js')), false);
  assert.equal(fs.readFileSync(path.join(f.backup, 'web-deployment/failed-release/assets/new.js'), 'utf8'), 'new asset');
  assert.deepEqual(release.supportInventory(f.api), before);
  for (const [file, expected] of [['data/sentinel.sqlite', 'preserve database'], ['uploads/sentinel.png', 'preserve upload'], ['other-source.js', 'preserve unrelated source']]) assert.equal(fs.readFileSync(path.join(f.api, file), 'utf8'), expected);
});
test('repeat install and rollback retain the already installed catalog', t => {
  const f = fixture(t); release.backup(...f.args); release.apply(...f.args);
  const again = path.join(f.root, 'again'); fs.mkdirSync(again);
  release.backup(f.api, f.web, f.stage, again); release.apply(f.api, f.web, f.stage, again); release.rollback(f.api, f.web, f.stage, again);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'installed');
});
test('incompatible backend fails before backup or target changes', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.api, 'src/appTexts.js'), '\n// locally edited');
  assert.throws(() => release.backup(...f.args), /Unsupported backend source/);
  assert.deepEqual(fs.readdirSync(f.backup), []);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'old html');
});
test('reviewed legacy production package metadata is accepted without changing dependencies', t => {
  const f = fixture(t), file = path.join(f.api, 'package.json'), bytes = legacyPackage();
  fs.writeFileSync(file, bytes);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  release.backup(...f.args); release.apply(...f.args); release.rollback(...f.args);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});
test('reviewed newer package metadata is accepted by a legacy-built manifest', t => {
  const f = fixture(t);
  f.manifest.support['package.json'] = hash(legacyPackage()); f.seal();
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  release.backup(...f.args); release.apply(...f.args); release.rollback(...f.args);
});
test('unreviewed package metadata is rejected and changes between reviewed variants after backup fail closed', t => {
  const f = fixture(t), file = path.join(f.api, 'package.json');
  fs.appendFileSync(file, '\n');
  assert.throws(() => release.backup(...f.args), /Unsupported backend source: package.json/);
  assert.deepEqual(fs.readdirSync(f.backup), []);
  fs.writeFileSync(file, legacyPackage());
  release.backup(...f.args);
  fs.copyFileSync(path.join(project, 'server/package.json'), file);
  assert.throws(() => release.apply(...f.args), /Backend changed during deployment: package.json/);
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'old html');
});
test('identical unknown package metadata in both manifest and backend is not implicitly approved', t => {
  const f = fixture(t), file = path.join(f.api, 'package.json');
  fs.appendFileSync(file, '\n');
  f.manifest.support['package.json'] = hash(fs.readFileSync(file)); f.seal();
  assert.throws(() => release.backup(...f.args), /Unsupported backend source: package.json/);
  assert.deepEqual(fs.readdirSync(f.backup), []);
});
test('missing catalog API registration is rejected', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.api, 'src/app.js'), 'export const unrelated = true;');
  assert.throws(() => release.supportInventory(f.api), /does not register/);
});
test('changed or removed existing catalog defaults are rejected', t => {
  for (const items of [[entry('copy.existing', 'locally maintained')], [entry('copy.newer')]]) {
    const f = fixture(t); fs.writeFileSync(path.join(f.api, release.CATALOG_PATH), JSON.stringify({ version: 1, items }));
    assert.throws(() => release.backup(...f.args), /differs or would be removed/);
    assert.deepEqual(fs.readdirSync(f.backup), []);
  }
});
test('retained legacy labels and source descriptions may change without replacing defaults', t => {
  const f = fixture(t);
  const catalog = JSON.parse(fs.readFileSync(path.join(f.stage, 'appTextCatalog.json'), 'utf8'));
  const old = catalog.items.find(item => item.key === 'copy.existing');
  Object.assign(old, { group: 'Legacy team', label: 'Older APP team copy only', sources: ['Legacy about route'] });
  fs.writeFileSync(path.join(f.stage, 'appTextCatalog.json'), JSON.stringify(catalog)); f.seal();
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  release.backup(...f.args); release.apply(...f.args);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'installed');
});
test('backends with or without the prior privacy catalog are supported', t => {
  for (const withPrivacy of [false, true]) {
    const f = fixture(t);
    const items = [entry('copy.existing')];
    if (withPrivacy) items.push(entry('privacy.title', 'Privacy policy'));
    fs.writeFileSync(path.join(f.api, release.CATALOG_PATH), JSON.stringify({ version: 1, items }));
    assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
    release.backup(...f.args); release.apply(...f.args);
    const installed = release.validateCatalog(fs.readFileSync(path.join(f.api, release.CATALOG_PATH)), true);
    assert.ok(installed.has('privacy.title')); assert.ok(installed.has('teamInfo.title'));
  }
});
test('changed field types or either language default fail before any deployment writes', t => {
  for (const delta of [{kind: 'url'}, {zh: 'changed'}, {en: 'changed'}, {en: null}]) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.api, release.CATALOG_PATH), JSON.stringify({version: 1, items: [{...entry('copy.existing'), ...delta}]}));
    assert.throws(() => release.backup(...f.args), /differs or would be removed/);
    assert.deepEqual(fs.readdirSync(f.backup), []);
    assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'old html');
  }
});
test('exact package inventory rejects additional backend, altered Web and wrong catalog path', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.stage, 'app.js'), 'unexpected');
  assert.throws(() => release.verifyPackage(f.stage), /Unexpected package/);
  fs.unlinkSync(path.join(f.stage, 'app.js')); fs.appendFileSync(path.join(f.stage, 'web/index.html'), 'altered');
  assert.throws(() => release.verifyPackage(f.stage), /inventory\/hash/);
});
test('mixed native exports and incomplete bilingual team catalogs are rejected', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.stage, 'web/metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { android: {} } }));
  assert.throws(() => release.webInventory(path.join(f.stage, 'web')), /Mixed native/);
  assert.throws(() => release.validateCatalog(JSON.stringify({ version: 1, items: [entry('copy.only')] }), true), /privacy\. catalog missing/);
  assert.throws(() => release.validateCatalog(JSON.stringify({ version: 1, items: [entry('privacy.title'), entry('privacy.title')] }), true), /duplicate/);
  assert.throws(() => release.validateCatalog(JSON.stringify({ version: 1, items: [entry('privacy.title')] }), true), /teamInfo\. catalog missing/);
  assert.throws(() => release.validateCatalog(JSON.stringify({ version: 1, items: [entry('privacy.title'), {...entry('teamInfo.title'), en: null}] }), true), /teamInfo\. catalog missing/);
});
test('linked catalog targets are rejected', t => {
  const f = fixture(t); fs.linkSync(path.join(f.api, release.CATALOG_PATH), path.join(f.root, 'catalog-link.json'));
  assert.throws(() => release.verifyBackend(f.api, f.stage), /hard links/);
});
test('immutable Web asset collision stops all writes', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.web, 'assets/new.js'), 'collision');
  assert.throws(() => release.backup(...f.args), /Immutable/);
  assert.deepEqual(fs.readdirSync(f.backup), []);
});
test('partial Web failure restores catalog and all changed Web files', t => {
  const f = fixture(t); release.backup(...f.args);
  const rename = fs.renameSync; let writes = 0;
  fs.renameSync = (source, target) => { if (++writes === 3) throw Error('simulated third replacement failure'); return rename(source, target); };
  try { assert.throws(() => release.apply(...f.args), /simulated/); } finally { fs.renameSync = rename; }
  release.rollback(...f.args);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'compatible');
  assert.equal(fs.readFileSync(path.join(f.web, 'index.html'), 'utf8'), 'old html');
});
test('concurrent changes after backup or install are not overwritten', t => {
  for (const target of ['catalog', 'web']) {
    const f = fixture(t); release.backup(...f.args); release.apply(...f.args);
    const file = target === 'catalog' ? path.join(f.api, release.CATALOG_PATH) : path.join(f.web, 'index.html');
    fs.writeFileSync(file, 'concurrent operator edit');
    assert.throws(() => release.rollback(...f.args), /Concurrent/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent operator edit');
  }
});
test('corrupt backup and mismatched recovery roots fail closed', t => {
  const f = fixture(t); release.backup(...f.args); release.apply(...f.args);
  fs.writeFileSync(path.join(f.backup, 'appTextCatalog.json'), 'corrupt');
  assert.throws(() => release.rollback(...f.args), /checksum/);
  assert.equal(release.verifyBackend(f.api, f.stage).state, 'installed');
});
test('public file modes and catalog ownership survive restrictive umask', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), previous = process.umask(0o077);
  try {
    release.backup(...f.args); release.apply(...f.args);
    assert.equal(fs.statSync(path.join(f.web, 'assets/new.js')).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(f.web, 'assets')).mode & 0o777, 0o755);
  } finally { process.umask(previous); }
});
test('installer preflights backend before stopping and updates no other source or data', () => {
  const source = fs.readFileSync(path.join(project, 'scripts', release.INSTALLER + '.in'), 'utf8');
  const main = source.slice(source.indexOf('[ "$(id -u)"'));
  assert.ok(main.indexOf('backend "$API_DIR"') < main.indexOf('systemctl stop'));
  assert.ok(main.indexOf('text_api_healthy') < main.indexOf('systemctl stop'));
  assert.doesNotMatch(source, /npm\s|sqlite|DATABASE_PATH|\/environ|\brm\s+-|\bnginx\s|cp -a|\.env/);
  assert.match(source, /flock -n 9/);
  assert.match(source, /runtime-after.json/);
  assert.match(source, /sha256sum -c -/);
});
test('packager uses complete fresh Web and current support inventory without historical ZIPs', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/package-team-about.ps1'), 'utf8');
  assert.match(source, /\[string\]\$WebDirectory/);
  assert.match(source, /support-inventory \$apiRoot/);
  assert.match(source, /appTextCatalog\.json/);
  assert.match(source, /\[IO.FileMode\]::CreateNew/);
  assert.match(source, /\[IO.File\]::Move\(\$stagedZip,\$outputZip\)/);
  assert.doesNotMatch(source, /Read-VerifiedManifest|ZipFile\]::OpenRead\(|\.zip\.sha256|eas update|gcloud/);
});
