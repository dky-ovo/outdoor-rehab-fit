const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('v22 OTA refuses export reuse, changed shared language source, changed bundles and non-Android metadata', () => {
  const fixturePrefix = path.join(os.tmpdir(), 'outdoor-fit-v22-ota-test-');
  const root = fs.mkdtempSync(fixturePrefix);
  const helperName = 'scripts/android-build17-ai-providers-v22-ota-manifest.cjs';
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
      'scripts/android-build17-ai-providers-v22-ota.ps1', 'docs/release-delivery-preferences.md', 'server/src/assistant.js', 'server/src/assistantGuideAnswers.js', 'server/src/assistantSymptomEvidence.js', 'server/src/assistantTcm.js', 'server/src/assistantFaqKnowledge.js', 'server/src/assistantContentPolicy.js', 'server/src/assistantLanguage.js', 'server/src/equipmentCatalog.js', 'server/src/assistantBailianPolicy.js']) write(name);
    for (const directory of ['app', 'components', 'constants', 'contexts', 'hooks', 'utils', 'plugins', 'assets', 'workspace-artifacts']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    write('server/src/assistantLanguage.js', 'export const scheduler = true;');
    write('assets/example.png', 'original asset');
    write(helperName, fs.readFileSync(path.resolve(__dirname, '../android-build17-ai-providers-v22-ota-manifest.cjs')));
    run('init');
    assert.throws(() => run('init'), /OTA_OUTPUT_ALREADY_EXISTS/);
    const output = 'workspace-artifacts/android-build17-ai-providers-20261008-v22/export/';
    const metadata = JSON.stringify({ bundler: 'metro', fileMetadata: { android: { bundle: 'bundle.js', assets: [] } } });
    write(output + 'metadata.json', metadata);
    write(output + 'bundle.js', 'https://api.outdoorfit.hk/api');
    run('seal'); run('verify');
    for (const name of ['server/src/assistantBailianPolicy.js', 'server/src/assistantGuideAnswers.js', 'server/src/assistantTcm.js', 'server/src/assistant.js', 'server/src/assistantSymptomEvidence.js']) {
      write(name, 'changed guide dependency');
      assert.throws(() => run('verify'), /OTA_SOURCE_OR_TOOL_CHANGED/);
      write(name);
    }
    write('server/src/assistantLanguage.js', 'changed shared language source');
    assert.throws(() => run('verify'), /OTA_SOURCE_OR_TOOL_CHANGED/);
    write('server/src/assistantLanguage.js', 'export const scheduler = true;');
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
