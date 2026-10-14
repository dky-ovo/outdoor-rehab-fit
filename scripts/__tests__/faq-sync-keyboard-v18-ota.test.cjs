const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('v18 OTA refuses export reuse, changed sync source, changed bundles and non-Android metadata', () => {
  const fixturePrefix = path.join(os.tmpdir(), 'outdoor-fit-v18-ota-test-');
  const root = fs.mkdtempSync(fixturePrefix);
  const helperName = 'scripts/android-build17-faq-sync-keyboard-v18-ota-manifest.cjs';
  const write = (name, content = '{}') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const run = action => {
    const original = console.log;
    try { console.log = () => {}; require(path.join(root, helperName)).run(action); }
    finally { console.log = original; }
  };
  try {
    for (const name of ['app.json', 'app.config.js', 'eas.json', 'metro.config.js', 'package.json', 'package-lock.json',
      'scripts/android-build17-faq-sync-keyboard-v18-ota.ps1', 'docs/release-delivery-preferences.md', 'server/src/assistantFaqKnowledge.js', 'server/src/assistantContentPolicy.js', 'server/src/equipmentCatalog.js']) write(name);
    for (const directory of ['app', 'components', 'constants', 'contexts', 'hooks', 'utils', 'plugins', 'assets', 'workspace-artifacts']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    write('utils/accountSyncScheduler.js', 'export const scheduler = true;');
    write('assets/example.png', 'original asset');
    write(helperName, fs.readFileSync(path.resolve(__dirname, '../android-build17-faq-sync-keyboard-v18-ota-manifest.cjs')));
    run('init');
    assert.throws(() => run('init'), /OTA_OUTPUT_ALREADY_EXISTS/);
    const output = 'workspace-artifacts/android-build17-faq-sync-keyboard-20261007-v18/export/';
    const metadata = JSON.stringify({ bundler: 'metro', fileMetadata: { android: { bundle: 'bundle.js', assets: [] } } });
    write(output + 'metadata.json', metadata);
    write(output + 'bundle.js', 'https://api.outdoorfit.hk/api');
    run('seal'); run('verify');
    write('utils/accountSyncScheduler.js', 'changed sync source');
    assert.throws(() => run('verify'), /OTA_SOURCE_OR_TOOL_CHANGED/);
    write('utils/accountSyncScheduler.js', 'export const scheduler = true;');
    write('assets/example.png', 'changed asset');
    assert.throws(() => run('verify'), /OTA_SOURCE_OR_TOOL_CHANGED/);
    write('assets/example.png', 'original asset');
    write(output + 'bundle.js', 'https://api.outdoorfit.hk/api changed');
    assert.throws(() => run('verify'), /OTA_EXPORT_CHANGED/);
    write(output + 'bundle.js', 'https://api.outdoorfit.hk/api');
    write(output + 'metadata.json', JSON.stringify({ bundler: 'metro', fileMetadata: { ios: { bundle: 'bundle.js', assets: [] } } }));
    assert.throws(() => run('verify'), /OTA_ANDROID_ONLY_REQUIRED/);
    write(output + 'metadata.json', metadata);
    run('verify');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(fixturePrefix)) && path.dirname(root) === path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
