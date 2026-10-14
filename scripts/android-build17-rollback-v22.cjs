'use strict';
// Republishes an already verified cloud update. Never exports or edits app.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const EXPECTED = Object.freeze({
  project: 'bcee8c37-e833-4f4d-b660-aa457accd96d',
  branch: '01a0298f-75ea-75a6-965e-ca3e82133bf6',
  channel: '01a0298f-786c-72fe-90a9-35185d7f8770',
  runtime: '1.2.3', package: 'com.maxcch.c.outdoorrehabfit',
  currentGroup: '3aab7849-8512-446d-be4f-27aedd097694',
  currentUpdate: '01a119ce-68e7-761a-87f3-0f56e18f286e',
  currentHash: 'PpTHwjEf73bshCobFUOIERXcaX4jzHZCkmhIzjoEqlc',
  targetGroup: '6185da0b-673b-46e9-8d25-5bc31ee7e116',
  targetUpdate: '01a11509-5aa6-7315-8bc6-d3afd66c8bdc',
  targetHash: 'Q8Ih_CrAUPyhrFyqdfbmMsMg2MJ74fmJ2lwKo01YHK4',
});
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code) => { if (!ok) fail(code); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateChannel(value) {
  const c = value?.currentPage;
  check(c?.id === EXPECTED.channel && c.name === 'preview' && c.isPaused === false,
    'ROLLBACK_CHANNEL_MISMATCH');
  let mapping;
  try { mapping = JSON.parse(c.branchMapping); } catch { fail('ROLLBACK_CHANNEL_MAPPING_INVALID'); }
  check(mapping.version === 0 && mapping.data?.length === 1 &&
    mapping.data[0].branchId === EXPECTED.branch && mapping.data[0].branchMappingLogic === 'true',
  'ROLLBACK_CHANNEL_MAPPING_CHANGED');
  check(c.updateBranches?.some(b => b.id === EXPECTED.branch && b.name === 'preview'),
    'ROLLBACK_BRANCH_MISMATCH');
}

function validateUpdate(value, group) {
  check(Array.isArray(value), 'ROLLBACK_UPDATE_RESPONSE_INVALID');
  const android = value.filter(u => u.platform === 'android' && u.runtimeVersion === EXPECTED.runtime);
  check(android.length === 1, 'ROLLBACK_ANDROID_UPDATE_NOT_UNIQUE');
  const u = android[0];
  check(u.group === group && u.branch === 'preview' && u.isRollBackToEmbedded === false,
    'ROLLBACK_UPDATE_IDENTITY_MISMATCH');
  check(/^[a-f0-9-]{36}$/.test(u.id) &&
    u.manifestPermalink === 'https://u.expo.dev/update/' + u.id, 'ROLLBACK_MANIFEST_URL_INVALID');
  return u;
}

function parseManifest(body, contentType) {
  if (/^application\/(?:expo\+)?json\b/i.test(contentType)) return JSON.parse(body);
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  check(/^multipart\/mixed\b/i.test(contentType) && boundary, 'ROLLBACK_MANIFEST_FORMAT_INVALID');
  const parts = body.split('--' + (boundary[1] || boundary[2]));
  const matches = parts.filter(part => /Content-Disposition:[^\r\n]*name="manifest"/i.test(part));
  check(matches.length === 1, 'ROLLBACK_MANIFEST_PART_INVALID');
  const offset = matches[0].indexOf('\r\n\r\n');
  check(offset >= 0, 'ROLLBACK_MANIFEST_PART_INVALID');
  return JSON.parse(matches[0].slice(offset + 4).trim());
}

function validateManifest(m, update) {
  check(m?.id === update.id && m.runtimeVersion === EXPECTED.runtime &&
    m.extra?.expoClient?.extra?.eas?.projectId === EXPECTED.project &&
    m.extra?.expoClient?.android?.package === EXPECTED.package &&
    /^[A-Za-z0-9_-]{43}$/.test(m.launchAsset?.hash || ''), 'ROLLBACK_MANIFEST_IDENTITY_MISMATCH');
  return { group: update.group, updateId: update.id, createdAt: update.createdAt,
    runtime: m.runtimeVersion, project: EXPECTED.project, launchHash: m.launchAsset.hash };
}

async function fetchManifest(update) {
  const r = await fetch(update.manifestPermalink, { headers: {
    'expo-platform': 'android', 'expo-runtime-version': EXPECTED.runtime,
    'expo-protocol-version': '1', accept: 'multipart/mixed, application/expo+json, application/json',
  }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  check(r.ok, 'ROLLBACK_MANIFEST_FETCH_FAILED');
  const chunks = []; let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    check(size <= 2 * 1024 * 1024, 'ROLLBACK_MANIFEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return validateManifest(parseManifest(Buffer.concat(chunks).toString('utf8'),
    r.headers.get('content-type') || ''), update);
}

function findCli() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (fs.existsSync(cache)) {
    for (const name of fs.readdirSync(cache).sort()) {
      const cli = path.join(cache, name, 'node_modules', 'eas-cli');
      try {
        if (JSON.parse(fs.readFileSync(path.join(cli, 'package.json'), 'utf8')).version === '24.7.0') {
          return path.join(cli, 'bin', 'run');
        }
      } catch { /* Other cached tools are irrelevant. */ }
    }
  }
  fail('ROLLBACK_EAS_CLI_24_7_0_REQUIRED');
}

function republishArgs() {
  return ['update:republish', '--group', EXPECTED.targetGroup,
    '--destination-branch', 'preview', '--platform', 'android',
    '--message', 'Rollback Android v22 to verified v21', '--json', '--non-interactive'];
}

async function verifyRemote(cli, manifest = fetchManifest) {
  validateChannel(cli(['channel:view', 'preview', '--json', '--non-interactive', '--limit', '5']));
  const list = cli(['update:list', '--branch', 'preview', '--platform', 'android',
    '--runtime-version', EXPECTED.runtime, '--limit', '5', '--json', '--non-interactive']);
  check(list?.id === EXPECTED.branch && list.name === 'preview' && list.currentPage?.length,
    'ROLLBACK_UPDATE_LIST_INVALID');
  const target = validateUpdate(cli(['update:view', EXPECTED.targetGroup, '--json']), EXPECTED.targetGroup);
  check(target.id === EXPECTED.targetUpdate, 'ROLLBACK_TARGET_UPDATE_CHANGED');
  const verifiedTarget = await manifest(target);
  check(verifiedTarget.launchHash === EXPECTED.targetHash, 'ROLLBACK_TARGET_BUNDLE_CHANGED');
  const latestGroup = list.currentPage[0].group;
  const current = validateUpdate(cli(['update:view', latestGroup, '--json']), latestGroup);
  const verifiedCurrent = await manifest(current);
  const alreadyRestored = verifiedCurrent.launchHash === EXPECTED.targetHash;
  if (!alreadyRestored) {
    check(latestGroup === EXPECTED.currentGroup && current.id === EXPECTED.currentUpdate &&
      verifiedCurrent.launchHash === EXPECTED.currentHash, 'ROLLBACK_NEWER_OR_UNKNOWN_UPDATE');
    check(list.currentPage[1]?.group === EXPECTED.targetGroup, 'ROLLBACK_PREVIOUS_GROUP_CHANGED');
  }
  return { current: verifiedCurrent, target: verifiedTarget, alreadyRestored };
}

async function main(action) {
  check(action === 'Verify' || action === 'Publish', 'ROLLBACK_ACTION_REQUIRED');
  const root = path.resolve(__dirname, '..');
  const rootConfig = path.join(root, 'app.json');
  const before = hash(fs.readFileSync(rootConfig));
  const cliPath = findCli();
  const parent = path.join(root, 'workspace-artifacts', 'android-rollback-20261008-v22');
  fs.mkdirSync(parent, { recursive: true });
  const runDir = fs.mkdtempSync(path.join(parent, 'run-'));
  const project = path.join(runDir, 'project'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify({ expo: {
    name: 'OUTDOOR-FIT', slug: 'outdoor-rehab-fit', owner: 'dky2004', sdkVersion: '54.0.0',
    version: EXPECTED.runtime, runtimeVersion: EXPECTED.runtime,
    android: { package: EXPECTED.package }, extra: { eas: { projectId: EXPECTED.project } },
    updates: { url: 'https://u.expo.dev/' + EXPECTED.project },
  } }));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'outdoor-fit-android-rollback',
    private: true, version: '1.0.0' }));
  fs.writeFileSync(path.join(project, 'eas.json'), JSON.stringify({ cli: { version: '24.7.0' } }));
  const report = { action, checkedAt: new Date().toISOString(), rootConfigBefore: before };
  const cli = args => {
    const out = spawnSync(process.execPath, [cliPath, ...args], { cwd: project, encoding: 'utf8',
      windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, EAS_NO_VCS: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', CI: '1' },
    });
    check(!out.error && out.status === 0, args[0] === 'update:republish' ?
      'ROLLBACK_PUBLISH_OUTCOME_UNKNOWN_RUN_VERIFY' : 'ROLLBACK_CLI_QUERY_FAILED');
    try { return JSON.parse(out.stdout); } catch { fail('ROLLBACK_CLI_RESPONSE_INVALID'); }
  };
  try {
    console.log('ROLLBACK_CHECKING_CLOUD=YES');
    report.before = await verifyRemote(cli);
    if (action === 'Publish' && !report.before.alreadyRestored) {
      // Repeat immediately before the only write; refuse changed channel/update state.
      const fresh = await verifyRemote(cli);
      if (!fresh.alreadyRestored) {
        check(hash(fs.readFileSync(rootConfig)) === before, 'ROLLBACK_ROOT_CONFIG_CHANGED');
        report.publishAttempted = true;
        console.log('ROLLBACK_REPUBLISHING_VERIFIED_V21=YES');
        cli(republishArgs());
      }
      report.after = await verifyRemote(cli);
      check(report.after.alreadyRestored, 'ROLLBACK_POST_PUBLISH_NOT_CONFIRMED_RUN_VERIFY');
      report.status = 'PUBLISHED_AND_VERIFIED';
    } else report.status = report.before.alreadyRestored ? 'ALREADY_RESTORED' : 'VERIFIED_READY';
    console.log('ANDROID_ROLLBACK=' + report.status);
    console.log('ANDROID_ROLLBACK_TARGET_GROUP=' + EXPECTED.targetGroup);
    console.log('ANDROID_ROLLBACK_RUNTIME=' + EXPECTED.runtime);
  } catch (error) {
    report.status = 'FAILED'; report.errorCode = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ROLLBACK_CHECK_FAILED';
    throw error;
  } finally {
    report.rootConfigAfter = hash(fs.readFileSync(rootConfig));
    report.rootConfigUnchanged = report.rootConfigAfter === before;
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('ANDROID_ROLLBACK_REPORT=' + path.join(runDir, 'report.json'));
    check(report.rootConfigUnchanged, 'ROLLBACK_ROOT_CONFIG_CHANGED');
    console.log('ROOT_APP_CONFIG_UNCHANGED=YES');
  }
}

module.exports = { EXPECTED, validateChannel, validateUpdate, parseManifest,
  validateManifest, republishArgs, verifyRemote, main };
if (require.main === module) main(process.argv[2]).catch(error => {
  console.error('ERROR_CODE=' + (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ROLLBACK_CHECK_FAILED'));
  process.exitCode = 1;
});
