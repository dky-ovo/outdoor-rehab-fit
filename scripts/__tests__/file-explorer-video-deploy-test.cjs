const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSizes, requirements, checkRequirements, requireAtomicDeploymentMoves } = require('../check-media-deploy-space.cjs');
const { validStageRoots } = require('../validate-media-deploy-paths.cjs');
const source = fs.readFileSync(path.join(__dirname, '../../deploy/2026-09-10/install-file-explorer-video-20260910.sh'), 'utf8');
const GiB = 1024 ** 3;
const sizes = { version: 1, apiArchive: 'outdoor-fit-api-file-explorer-video-20260910.tar.gz', webArchive: 'outdoor-fit-web-file-explorer-video-20260910.zip', apiArchiveBytes: 400, webArchiveBytes: 500, apiExpandedBytes: 800, webExpandedBytes: 900 };
const runtime = { databasePath: '/data/custom.sqlite', mediaUploadDir: '/uploads' };
const existing = { apiCode: 100, web: 200, seed: 300, apiData: 400, database: 500, oldDependencies: 600, newDependencies: 700 };

test('only the current explicit payload names and finite positive byte counts are accepted', () => {
  assert.equal(validateSizes(sizes), sizes);
  for (const value of [0, -1, Infinity, NaN, '1000', 101 * GiB]) assert.throws(() => validateSizes({ ...sizes, apiExpandedBytes: value }), /Invalid payload size/);
  assert.throws(() => validateSizes({ ...sizes, apiArchive: 'old.tar.gz' }), /Unexpected/);
  assert.throws(() => validateSizes({ ...sizes, version: 2 }), /Unexpected/);
});

test('initial space estimate includes staging, existing API data and DB backups, dependencies and media imports', () => {
  const entries = requirements(sizes, runtime, existing, 'initial');
  assert.equal(entries.find(item => item.target.endsWith('/.outdoor-fit-deploy')).bytes, 300 + 400 + 500 + 800 + 900 + 2 * GiB);
  assert.equal(entries.find(item => item.target.endsWith('/outdoor-fit-backups')).bytes, 100 + 200 + 300 + 400 + 500 + 600);
  assert.equal(entries.find(item => item.target === '/uploads').bytes, 800);
  assert.equal(entries.find(item => item.target === '/data').bytes, 64 * 1024 ** 2);
  assert.equal(entries.find(item => item.target.endsWith('/.npm')).bytes, 2 * GiB);
});

test('remaining preflight uses actual installed dependencies and does not charge for payload already staged', () => {
  const entries = requirements(sizes, runtime, existing, 'remaining');
  assert.equal(entries.find(item => item.target.endsWith('/.outdoor-fit-deploy')).bytes, 300);
  assert.equal(entries.find(item => item.target.endsWith('/outdoor-fit-api')).bytes, 800 + 700);
  assert.equal(entries.some(item => item.target.endsWith('/.npm')), false);
});

test('a full filesystem fails before any writer and requires 2 GiB plus 10 percent overhead', () => {
  const items = [{ target: '/home', bytes: GiB }];
  assert.throws(() => checkRequirements(items, () => ({ id: 'one', path: '/', available: 0 })), /Insufficient disk space/);
  assert.throws(() => checkRequirements(items, () => ({ id: 'one', path: '/', available: 3 * GiB })), /Insufficient disk space/);
  const report = checkRequirements(items, () => ({ id: 'one', path: '/', available: 4 * GiB }));
  assert.equal(report[0].requiredBytes, Math.ceil(GiB * 1.1) + 2 * GiB);
});

test('multiple directories on one disk are summed and a separate upload disk is checked separately', () => {
  const items = [{ target: '/home', bytes: GiB }, { target: '/var', bytes: GiB }, { target: '/uploads', bytes: GiB }];
  const inspect = target => ({ id: target === '/uploads' ? 'media' : 'root', path: target, available: 8 * GiB });
  const report = checkRequirements(items, inspect);
  assert.equal(report.length, 2);
  assert.equal(report[0].estimatedBytes, 2 * GiB);
  assert.equal(report[1].estimatedBytes, GiB);
  assert.throws(() => checkRequirements(items, target => ({ ...inspect(target), available: target === '/uploads' ? 0 : 8 * GiB })), /Insufficient disk space/);
});

test('API, staging and backups must allow same-filesystem recovery moves; uploads need not share that disk', () => {
  assert.doesNotThrow(() => requireAtomicDeploymentMoves(() => ({ id: 'root' })));
  for (const other of ['/.outdoor-fit-deploy', '/outdoor-fit-backups', '/src', '/node_modules', '/media-seed']) {
    assert.throws(() => requireAtomicDeploymentMoves(target => ({ id: target.endsWith(other) ? 'other' : 'root' })), /same filesystem/);
  }
  const visited = [];
  requireAtomicDeploymentMoves(target => { visited.push(target); return { id: 'root' }; });
  assert.equal(visited.includes('/uploads'), false);
  for (const name of ['src', 'node_modules', 'media-seed']) assert.ok(visited.some(candidate => candidate.endsWith(`/${name}`)));
});

test('only the new narrow staging prefix and the two prior reviewed versions are accepted', () => {
  const root = '/home/dukaiyu2004/.outdoor-fit-deploy/';
  for (const prefix of ['timer-media-library-20260909', 'file-storage-bilingual-registration-20260910', 'file-explorer-video-20260910']) {
    assert.equal(validStageRoots(`${root}${prefix}.abc123/api`, `${root}${prefix}.abc123/web`), true);
  }
  for (const bad of ['file-explorer-video-20260911.x', 'file-explorer-video-20260910.', 'file-explorer-video-20260910.x/../other', 'file-explorer-video-20260910.x-y']) assert.equal(validStageRoots(`${root}${bad}/api`, `${root}${bad}/web`), false);
  assert.equal(validStageRoots(`${root}file-explorer-video-20260910.x/api`, `${root}file-explorer-video-20260910.y/web`), false);
  assert.equal(validStageRoots(`${root}file-explorer-video-20260910.x/web`, `${root}file-explorer-video-20260910.x/api`), false);
});

test('bootstrap is bounded in /run, each helper is checksummed before execution, and low disk stops before large mkdir', () => {
  assert.match(source, /df -PT \/run/);
  assert.match(source, /RUN_AVAILABLE.*-lt 16777216/);
  assert.match(source, /head -c 1048577/);
  assert.match(source, /-le 1048576/);
  assert.match(source, /flock -n 9/);
  const firstRun = source.indexOf('node "$BOOTSTRAP_DIR/verify-file-storage-install.cjs"');
  assert.ok(source.indexOf('sha256sum -c -') < firstRun);
  const preflight = source.indexOf('node "$BOOTSTRAP_DIR/check-media-deploy-space.cjs" initial');
  assert.ok(preflight > firstRun);
  assert.ok(preflight < source.indexOf('mkdir -p "$BACKUP_ROOT"'));
  assert.ok(preflight < source.indexOf('head -c "$((EXPECTED_ARCHIVE_BYTES + 1))"'));
  assert.ok(preflight < source.indexOf('sudo -u dukaiyu2004 npm ci'));
});

test('disk checks repeat before backups; payload and runtime checks, TLS scope, recovery and interrupts remain guarded', () => {
  const remaining = source.indexOf('node "$WORK_DIR/check-media-deploy-space.cjs" remaining');
  assert.ok(remaining > source.indexOf('sudo -u dukaiyu2004 npm ci'));
  assert.ok(remaining < source.indexOf('cp -a "$API_DIR/src" "$API_DIR/package.json"'));
  assert.ok(source.indexOf('sha256sum -c runtime-checksums.sha256') < source.indexOf('tar --no-same-owner -xzf'));
  assert.match(source, /stat -c %s "\$WORK_DIR\/\$artifact"\)" -eq "\$EXPECTED_ARCHIVE_BYTES"/);
  assert.match(source, /trap 'recover 130' INT/);
  assert.match(source, /trap 'recover 143' TERM/);
  assert.match(source, /if \[ "\$APP_TOUCHED" -eq 1 \]/);
  assert.ok(source.indexOf('DATABASE_BACKED_UP=1') > source.indexOf('cp -a "$DATABASE_PATH" "$BACKUP_DIR/database/"'));
  assert.match(source, /This installer does not upgrade Node/);
  assert.match(source, /cmp -s "\$WORK_DIR\/runtime-before.json" "\$WORK_DIR\/runtime-recheck.json"/);
  assert.doesNotMatch(source, /EXPECTED_ORIGINAL_SHA|PATCH_DIR|patch-checksums|\brm\s+-|\bapt(?:-get)?\s|npm\s+audit\s+fix/);
});
