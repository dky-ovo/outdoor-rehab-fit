const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tar = require('tar');
const { compileModsAsync, withAppBuildGradle } = require('@expo/config-plugins');
const packaging = require('../withOfflineVoicePackaging');
const configure = require('../../app.config');

const root = path.resolve(__dirname, '../..');
const parent = path.join(root, 'workspace-artifacts/offline-voice-packaging-mod-tests');
const originalRootConfig = fs.readFileSync(path.join(root, 'app.json'));
const rootConfigHash = crypto.createHash('sha256').update(originalRootConfig).digest('hex');
const config = () => ({ name: 'OfflinePackagingFixture', slug: 'offline-packaging-fixture', version: '1.2.1', android: { package: 'com.example.offlinefixture' } });
const chunks = [];
tar.t({ file: path.join(root, 'node_modules/expo/template.tgz'), sync: true, onReadEntry(entry) {
  if (entry.path === 'package/android/app/build.gradle') entry.on('data', chunk => chunks.push(chunk));
  else entry.resume();
} });
const template = Buffer.concat(chunks).toString('utf8');
assert.ok(template.includes('com.android.application'), 'Use the actual installed Expo Android app template');

function fixture(contents = template, suffix = '') {
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'case-'));
  const app = path.join(directory, 'android/app');
  fs.mkdirSync(app, { recursive: true });
  const file = path.join(app, `build.gradle${suffix}`);
  fs.writeFileSync(file, contents);
  return { directory, file };
}

async function compile(f, cfg = packaging(config())) {
  return compileModsAsync(cfg, { projectRoot: f.directory, platforms: ['android'] });
}

test('real Expo Android mod provider writes the final :app Gradle, preserves template and is idempotent', async () => {
  const f = fixture();
  const generated = await compile(f);
  assert.equal(generated.android.package, 'com.example.offlinefixture');
  const first = fs.readFileSync(f.file, 'utf8');
  assert.ok(first.startsWith(template.trimEnd()), 'Existing Expo app build configuration must be preserved');
  assert.match(first, /android\s*\{\s*androidResources\s*\{\s*noCompress \+= \['onnx'\]/);
  assert.match(first, /task\.doLast/);
  assert.match(first, /model\.method != java\.util\.zip\.ZipEntry\.STORED/);
  await compile(f);
  assert.equal(fs.readFileSync(f.file, 'utf8'), first);
  assert.equal((first.match(/BEGIN outdoor-fit offline model packaging/g) || []).length, 1);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app.json'))).digest('hex'), rootConfigHash);
  console.log(`Verified real Expo Android appBuildGradle mod fixture: ${f.directory}`);
});

test('another Expo appBuildGradle mod composes with packaging without replacing either output', async () => {
  const f = fixture();
  let cfg = packaging(config());
  cfg = withAppBuildGradle(cfg, current => {
    current.modResults.contents += '\n// integration fixture: another app mod\n';
    return current;
  });
  await compile(f, cfg);
  const result = fs.readFileSync(f.file, 'utf8');
  assert.ok(result.includes('// integration fixture: another app mod'));
  assert.ok(result.includes("noCompress += ['onnx']"));
  assert.ok(result.includes('apply plugin: "com.android.application"'));
});

test('actual Expo Kotlin provider fails safely without writing a Groovy block into .kts', async () => {
  const original = 'plugins { id("com.android.application") }\n';
  const f = fixture(original, '.kts');
  await assert.rejects(() => compile(f), /non-Groovy/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});

test('actual Expo mod rejects an incomplete owned marker without partially writing its target', async () => {
  const original = template + '\n// BEGIN outdoor-fit offline model packaging\n';
  const f = fixture(original);
  await assert.rejects(() => compile(f), /Incomplete offline voice Gradle marker/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});

test('retiring the model plugin keeps publishing identities and advances reply-only runtime', () => {
  for (const version of ['1.1.1', '1.1.9', '1.2.0', '1.2.1', '1.2.2', '1.3.0', '2.0.0']) {
    const original = { version, owner: 'dky2004', runtimeVersion: { policy: 'appVersion' },
      updates: { url: 'https://u.expo.dev/fixed-fixture-project' }, extra: { eas: { projectId: 'fixed-fixture-project' } },
      ios: { bundleIdentifier: 'com.example.ios' }, android: { package: 'com.example.android' },
      plugins: ['./plugins/withOfflineVoicePackaging'] };
    const after = configure({ config: original });
    assert.equal(after.version, ['1.1.1', '1.1.9', '1.2.0', '1.2.1'].includes(version) ? '1.2.2' : version);
    assert.equal(after.owner, original.owner);
    assert.deepEqual(after.updates, original.updates);
    assert.deepEqual(after.extra, original.extra);
    assert.deepEqual(after.runtimeVersion, original.runtimeVersion);
    assert.equal(after.android.package, original.android.package);
    assert.equal(after.ios.bundleIdentifier, original.ios.bundleIdentifier);
    assert.equal(after.plugins.filter(item => (Array.isArray(item) ? item[0] : item) === './plugins/withOfflineVoicePackaging').length, 0);
    assert.deepEqual(configure({ config: after }), after);
  }
});
