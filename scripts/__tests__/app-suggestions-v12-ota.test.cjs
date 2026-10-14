const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('v12 OTA locks FAQ and Android-only export bytes, refusing reuse or later source changes', () => {
  const fixturePrefix = path.join(os.tmpdir(), 'outdoor-fit-v12-ota-test-');
  const root = fs.mkdtempSync(fixturePrefix);
  const helperName = 'scripts/android-build17-app-suggestions-v12-ota-manifest.cjs';
  const write = (name, content = '{}') => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  const run = action => {
    const original = console.log;
    try { console.log = () => {}; require(path.join(root, helperName)).run(action); return { status: 0, stderr: '' }; }
    catch (error) { return { status: 1, stderr: error.message }; }
    finally { console.log = original; }
  };
  try {
    for (const name of ['app.json', 'app.config.js', 'eas.json', 'metro.config.js', 'package.json', 'package-lock.json', 'scripts/android-build17-app-suggestions-v12-ota.ps1', 'docs/android-build17-app-suggestions-v12-ota.md', 'server/src/assistantFaqKnowledge.js']) write(name);
    for (const directory of ['app', 'components', 'constants', 'contexts', 'hooks', 'utils', 'plugins', 'workspace-artifacts']) fs.mkdirSync(path.join(root, directory), { recursive: true });
    write(helperName, fs.readFileSync(path.resolve(__dirname, '../android-build17-app-suggestions-v12-ota-manifest.cjs')));
    assert.equal(run('init').status, 0);
    const reused = run('init');
    assert.notEqual(reused.status, 0); assert.match(reused.stderr, /OTA_OUTPUT_ALREADY_EXISTS/);
    const output = 'workspace-artifacts/android-build17-app-suggestions-20261002-v12/export/';
    write(output + 'metadata.json', JSON.stringify({ bundler: 'metro', fileMetadata: { android: { bundle: 'bundle.js', assets: [] } } }));
    write(output + 'bundle.js', 'https://api.outdoorfit.hk/api');
    assert.equal(run('seal').status, 0);
    assert.equal(run('verify').status, 0);
    write('server/src/assistantFaqKnowledge.js', 'changed public FAQ');
    const changed = run('verify');
    assert.notEqual(changed.status, 0); assert.match(changed.stderr, /OTA_SOURCE_OR_TOOL_CHANGED/);
    write('server/src/assistantFaqKnowledge.js');
    write(output + 'metadata.json', JSON.stringify({ bundler: 'metro', fileMetadata: { ios: { bundle: 'bundle.js', assets: [] } } }));
    const ios = run('verify');
    assert.notEqual(ios.status, 0); assert.match(ios.stderr, /OTA_ANDROID_ONLY_REQUIRED/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(fixturePrefix)) && path.dirname(root) === path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
