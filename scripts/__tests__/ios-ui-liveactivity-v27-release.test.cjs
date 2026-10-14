const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const release = require('../ios-ui-liveactivity-v27-release.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outdoor-fit-ios-v27-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const name of [...release.ROOT_FILES, ...release.SHARED_SERVER, ...release.REQUIRED_NATIVE]) put(name, '// fixture');
  put('app.json', { expo: { owner: release.OWNER, slug: 'outdoor-rehab-fit', version: '1.1.1',
    runtimeVersion: { policy: 'appVersion' }, ios: { bundleIdentifier: release.BUNDLE, buildNumber: '17' },
    extra: { eas: { projectId: release.PROJECT_ID } }, updates: { url: `https://u.expo.dev/${release.PROJECT_ID}` } } });
  put('eas.json', { cli: { appVersionSource: 'remote' }, build: { production: { autoIncrement: true, channel: 'production' } },
    submit: { production: { ios: { ascAppId: release.ASC_APP_ID } } } });
  put('app/index.js', "import { helper } from '../server/src/assistantLanguage'; export default helper;");
  put('server/src/assistantLanguage.js', "export { helper } from './assistantContentPolicy.js';");
  put('server/src/assistantContentPolicy.js', 'export const helper = 1;');
  put('assets/images/example.png', 'image fixture');
  put('.env', 'TEST_SECRET=do-not-upload');
  put('server/data/users.sqlite', 'private fixture');
  put('models/training.jsonl', 'private training fixture');
  put('.tmp/credentials.json', 'private fixture');
  put('app.dky2004.backup.json', 'old app config');
  put('components/__tests__/fixture.js', 'not app source');
  put('modules/offline-assistant-voice/ios/OASenseVoiceEngine.mm', 'retired large native dependency');
  return { root, put, project: path.join(root, 'workspace-artifacts', release.RELEASE, 'project') };
}
test('isolated source contains required pure dependencies, native targets and assets without private server files', t => {
  const f = fixture(t), originalApp = fs.readFileSync(path.join(f.root, 'app.json'));
  const result = release.prepare(f.root);
  assert.equal(result.status, 'PASS');
  for (const name of [...release.SHARED_SERVER, ...release.REQUIRED_NATIVE]) assert.equal(fs.existsSync(path.join(f.project, name)), true, name);
  for (const name of ['.env', 'server/data/users.sqlite', 'models/training.jsonl', '.tmp/credentials.json', 'app.dky2004.backup.json',
    'components/__tests__/fixture.js', 'modules/offline-assistant-voice/ios/OASenseVoiceEngine.mm']) assert.equal(fs.existsSync(path.join(f.project, name)), false, name);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'app.json')), originalApp);
  const app = JSON.parse(fs.readFileSync(path.join(f.project, 'app.json'), 'utf8')).expo;
  assert.equal(app.version, '1.2.4'); assert.equal(app.runtimeVersion, '1.2.4'); assert.equal(app.ios.buildNumber, undefined);
  const eas = JSON.parse(fs.readFileSync(path.join(f.project, 'eas.json'), 'utf8'));
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL, release.API_URL);
  assert.equal(eas.build.production.ios.image, 'macos-sequoia-15.6-xcode-26.2');
  assert.equal(eas.build.production.autoIncrement, true);
  assert.doesNotMatch(fs.readFileSync(path.join(f.project, '.easignore'), 'utf8'), /^server\//m);
  assert.throws(() => release.prepare(f.root), /IOS_STAGE_ALREADY_EXISTS/);
});
test('a newly introduced server dependency cannot be silently omitted', t => {
  const f = fixture(t);
  f.put('server/src/assistantLanguage.js', "export { password } from './mysqlConfig.js';");
  assert.throws(() => release.audit(f.root), /IOS_SHARED_SERVER_DEPENDENCY_MISSING/);
});
test('a pure server module cannot acquire a Node-only import unnoticed', t => {
  const f = fixture(t); f.put('server/src/assistantLanguage.js', "import fs from 'node:fs';");
  assert.throws(() => release.audit(f.root), /IOS_SHARED_SERVER_EXTERNAL_DEPENDENCY/);
});
test('credentials injected into an allowed source tree stop preparation', t => {
  const f = fixture(t); f.put('assets/leaked.p8', 'private');
  assert.throws(() => release.audit(f.root), /IOS_PRIVATE_FILE_REFUSED/);
});
test('private key body cannot hide inside allowed JSON', t => {
  const f = fixture(t); f.put('constants/hidden.json', { key: '-----BEGIN PRIVATE KEY-----\nfixture' });
  assert.throws(() => release.audit(f.root), /IOS_PRIVATE_KEY_CONTENT_REFUSED/);
});
test('verify rejects changed source and changed or additional staged files', t => {
  const f = fixture(t); release.prepare(f.root);
  const source = fs.readFileSync(path.join(f.root, 'app/index.js'));
  f.put('app/index.js', 'changed');
  assert.throws(() => release.verify(f.root), /IOS_SOURCE_CHANGED_AFTER_STAGE/);
  fs.writeFileSync(path.join(f.root, 'app/index.js'), source);
  fs.writeFileSync(path.join(f.project, 'injected.json'), '{}');
  assert.throws(() => release.verify(f.root), /IOS_STAGE_FILE_SET_OR_HASH_CHANGED/);
});
test('wrong Android project selection stops before creating an iOS stage', t => {
  const f = fixture(t), app = JSON.parse(fs.readFileSync(path.join(f.root, 'app.json'), 'utf8'));
  app.expo.extra.eas.projectId = 'bcee8c37-e833-4f4d-b660-aa457accd96d'; f.put('app.json', app);
  assert.throws(() => release.prepare(f.root), /IOS_ROOT_PROJECT_MISMATCH/);
  assert.equal(fs.existsSync(f.project), false);
});
test('resolved Expo config must contain the same widget and isolated runtime', () => {
  const config = { version: release.VERSION, runtimeVersion: release.VERSION, owner: release.OWNER,
    updates: { url: `https://u.expo.dev/${release.PROJECT_ID}` },
    ios: { bundleIdentifier: release.BUNDLE, infoPlist: { NSSupportsLiveActivities: true } },
    extra: { eas: { projectId: release.PROJECT_ID, build: { experimental: { ios: { appExtensions: [
      { targetName: 'OutdoorFitTimerWidget', bundleIdentifier: `${release.BUNDLE}.timer-widget` },
    ] } } } } } };
  assert.equal(release.validateResolvedConfig(config).status, 'PASS');
  config.runtimeVersion = '1.2.2';
  assert.throws(() => release.validateResolvedConfig(config), /IOS_RESOLVED_CONFIG_MISMATCH/);
});
test('exact-ID submission guard rejects other builds, platforms, owners and unfinished builds', () => {
  const id = 'e5cf2a77-9b64-4a0e-9918-4d11e5a5d51d';
  const build = { id, status: 'FINISHED', platform: 'IOS', distribution: 'STORE', project: { id: release.PROJECT_ID, ownerAccount: { name: release.OWNER } },
    appVersion: release.VERSION, runtimeVersion: release.VERSION, appIdentifier: release.BUNDLE, buildProfile: 'production', channel: 'production', appBuildVersion: '18', artifacts: { buildUrl: 'https://expo.dev/artifacts/test.ipa' } };
  assert.equal(release.validateBuild(build, id).buildId, id);
  for (const altered of [{ ...build, id: 'another' }, { ...build, status: 'IN_PROGRESS' }, { ...build, platform: 'ANDROID' },
    { ...build, appVersion: '1.1.8' }, { ...build, runtimeVersion: '1.2.2' }, { ...build, project: { id: 'android-project', ownerAccount: { name: release.OWNER } } }]) {
    assert.throws(() => release.validateBuild(altered, id), /IOS_FINISHED_BUILD_MISMATCH/);
  }
});
test('CLI 24.7 GraphQL build fields and one-item launch arrays preserve runtime, channel and exact bundle validation', () => {
  const id = 'f9b0a113-c299-4870-b0cb-ca0cdf6be745';
  const build = { id, status: 'FINISHED', platform: 'IOS', distribution: 'STORE',
    app: { id: release.PROJECT_ID, ownerAccount: { name: release.OWNER } },
    runtime: { version: release.VERSION }, updateChannel: { name: 'production' }, appIdentifier: release.BUNDLE,
    appVersion: release.VERSION, appBuildVersion: '19', buildProfile: 'production',
    artifacts: { buildUrl: 'https://expo.dev/artifacts/test.ipa' }, isForIosSimulator: false, error: null };
  assert.equal(release.validateBuild(build, id).runtimeVersion, '1.2.4');
  assert.equal(release.validateBuild([build], id).channel, 'production');
  for (const altered of [{ ...build, status: 'IN_PROGRESS' }, { ...build, appIdentifier: `${release.BUNDLE}.wrong` },
    { ...build, appIdentifier: undefined }, { ...build, runtimeVersion: '1.1.8' }, { ...build, channel: 'preview' },
    { ...build, project: { id: 'other-project' } }, { ...build, isForIosSimulator: true },
    { ...build, app: { ...build.app, ownerAccount: { name: 'wrong-owner' } } }, [build, build]]) {
    assert.throws(() => release.validateBuild(altered, id), /IOS_FINISHED_BUILD_MISMATCH/);
  }
});
