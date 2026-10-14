'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED: e, validateChannel, validateUpdate, parseManifest, validateManifest,
  republishArgs, verifyRemote } = require('../android-build17-rollback-v22.cjs');

const channel = () => ({ currentPage: { id: e.channel, name: 'preview', isPaused: false,
  branchMapping: JSON.stringify({ version: 0, data: [{ branchId: e.branch, branchMappingLogic: 'true' }] }),
  updateBranches: [{ id: e.branch, name: 'preview' }] } });
const update = (group, id) => ({ group, id, branch: 'preview', platform: 'android',
  runtimeVersion: e.runtime, isRollBackToEmbedded: false, manifestPermalink: 'https://u.expo.dev/update/' + id });
const manifest = u => ({ id: u.id, runtimeVersion: e.runtime,
  extra: { expoClient: { extra: { eas: { projectId: e.project } }, android: { package: e.package } } },
  launchAsset: { hash: u.group === e.targetGroup ? e.targetHash : e.currentHash } });

function fakeRemote({ latestGroup = e.currentGroup, latestHash = e.currentHash, targetHash = e.targetHash } = {}) {
  const calls = [];
  const cli = args => {
    calls.push(args);
    if (args[0] === 'channel:view') return channel();
    if (args[0] === 'update:list') return { id: e.branch, name: 'preview', currentPage: [
      { group: latestGroup }, { group: e.targetGroup }] };
    if (args[0] === 'update:view') return [update(args[1], args[1] === e.targetGroup ? e.targetUpdate : e.currentUpdate)];
    throw new Error('Mutation not permitted during verification');
  };
  const load = async u => ({ group: u.group, launchHash: u.group === e.targetGroup ? targetHash : latestHash });
  return { calls, cli, load };
}

test('Verify checks current v22 and exact previous v21 without any mutation', async () => {
  const r = fakeRemote(); const result = await verifyRemote(r.cli, r.load);
  assert.equal(result.alreadyRestored, false);
  assert.equal(result.target.group, e.targetGroup);
  assert.equal(r.calls.some(args => args[0] === 'update:republish'), false);
  assert.deepEqual(r.calls[1].slice(0, 7), ['update:list', '--branch', 'preview', '--platform', 'android', '--runtime-version', '1.2.3']);
});
test('Verify refuses a newer unknown update or changed target bundle', async () => {
  for (const options of [{ latestGroup: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { targetHash: e.currentHash }]) {
    const r = fakeRemote(options); await assert.rejects(verifyRemote(r.cli, r.load), /ROLLBACK_/);
  }
});
test('A verified republished v21 bundle is idempotently recognized', async () => {
  const r = fakeRemote({ latestGroup: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', latestHash: e.targetHash });
  assert.equal((await verifyRemote(r.cli, r.load)).alreadyRestored, true);
});
test('Channel guard refuses paused channel or rollout/change in branch mapping', () => {
  validateChannel(channel());
  const paused = channel(); paused.currentPage.isPaused = true;
  assert.throws(() => validateChannel(paused), /CHANNEL_MISMATCH/);
  const remapped = channel(); remapped.currentPage.branchMapping = JSON.stringify({ version: 0, data: [] });
  assert.throws(() => validateChannel(remapped), /CHANNEL_MAPPING_CHANGED/);
});
test('Update identity requires Android runtime, expected branch and Expo manifest host', () => {
  const u = update(e.targetGroup, e.targetUpdate);
  validateUpdate([u], e.targetGroup);
  for (const override of [{ platform: 'ios' }, { runtimeVersion: '1.2.4' }, { branch: 'production' },
    { manifestPermalink: 'https://example.com/manifest' }, { isRollBackToEmbedded: true }]) {
    assert.throws(() => validateUpdate([{ ...u, ...override }], e.targetGroup), /ROLLBACK_/);
  }
});
test('Public manifest is matched to project, package, runtime and update identity', () => {
  const u = update(e.targetGroup, e.targetUpdate); const m = manifest(u);
  assert.equal(validateManifest(m, u).launchHash, e.targetHash);
  m.extra.expoClient.extra.eas.projectId = 'wrong';
  assert.throws(() => validateManifest(m, u), /IDENTITY_MISMATCH/);
});
test('Parses the protocol 1 multipart manifest without retaining unrelated asset data', () => {
  const m = { id: 'test' }; const body = '--abc\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(m) + '\r\n--abc--\r\n';
  assert.deepEqual(parseManifest(body, 'multipart/mixed; boundary="abc"'), m);
  assert.deepEqual(parseManifest(JSON.stringify(m), 'application/expo+json'), m);
});
test('Publish arguments target only verified v21 on the existing Android preview branch', () => {
  assert.deepEqual(republishArgs(), ['update:republish', '--group', e.targetGroup,
    '--destination-branch', 'preview', '--platform', 'android', '--message',
    'Rollback Android v22 to verified v21', '--json', '--non-interactive']);
  assert.equal(republishArgs().includes('--destination-channel'), false);
});
