const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSizes, verifyStagedSizes, requirements, checkRequirements } = require('../check-media-deploy-space.cjs');
const { validStageRoots } = require('../validate-media-deploy-paths.cjs');
const release = 'pdf-app-timer-20260911';
const priorRelease = 'file-explorer-video-20260910';
const stage = `/home/dukaiyu2004/.outdoor-fit-deploy/${release}.abc123`;
const sizesFor = slug => ({ version: 1, apiArchive: `outdoor-fit-api-${slug}.tar.gz`, webArchive: `outdoor-fit-web-${slug}.zip`, apiArchiveBytes: 40, webArchiveBytes: 50, apiExpandedBytes: 80, webExpandedBytes: 90 });
const sizes = sizesFor(release);
const root = path.join(__dirname, '../..');
const installer = fs.readFileSync(path.join(root, `deploy/2026-09-11/install-${release}.sh`), 'utf8');
const packager = fs.readFileSync(path.join(root, 'scripts/package-pdf-app-timer.ps1'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'scripts/verify-pdf-app-timer-package.py'), 'utf8');

test('reviewed new and prior API/Web pairs are accepted, but mixed or arbitrary archive names are rejected', () => {
  assert.equal(validateSizes(sizes), sizes);
  assert.doesNotThrow(() => validateSizes(sizesFor(priorRelease)));
  for (const item of [
    { ...sizes, apiArchive: sizesFor(priorRelease).apiArchive },
    { ...sizes, webArchive: sizesFor(priorRelease).webArchive },
    { ...sizes, apiArchive: '../' + sizes.apiArchive },
    { ...sizes, apiArchive: '/tmp/' + sizes.apiArchive },
    sizesFor('pdf-app-timer-20260912'),
    sizesFor('anything'),
    { ...sizes, version: 2 },
  ]) assert.throws(() => validateSizes(item), /Unexpected deployment size manifest/);
  for (const value of [0, -1, Infinity, '100', 101 * 1024 ** 3]) assert.throws(() => validateSizes({ ...sizes, webExpandedBytes: value }), /Invalid payload size/);
});

test('only the precise new stage prefix joins the existing stage whitelist', () => {
  assert.equal(validStageRoots(`${stage}/api`, `${stage}/web`), true);
  for (const candidate of [stage.replace('20260911', '20260912'), stage + '/../../escape', stage + '-x', stage.replace('/home/dukaiyu2004/', '/home/other/'), stage.replace('.abc123', '.')]) {
    assert.equal(validStageRoots(`${candidate}/api`, `${candidate}/web`), false);
  }
  assert.equal(validStageRoots(`${stage}/api`, `${stage.replace('abc123', 'def456')}/web`), false);
  assert.equal(validStageRoots(`${stage}/web`, `${stage}/api`), false);
});

test('staged-size verification reads the validated release filenames and independently rejects swapped manifests', () => {
  const inspected = [];
  const normalize = value => String(value).replaceAll('\\', '/');
  const contents = new Map([
    [`${stage}/${sizes.apiArchive}`, sizes.apiArchiveBytes], [`${stage}/${sizes.webArchive}`, sizes.webArchiveBytes],
    [`${stage}/api/app.js`, sizes.apiExpandedBytes], [`${stage}/web/index.html`, sizes.webExpandedBytes],
  ]);
  const lstat = mock.method(fs, 'lstatSync', filename => {
    const name = normalize(filename); inspected.push(name);
    if (contents.has(name)) return { size: contents.get(name), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    if (name === `${stage}/api` || name === `${stage}/web`) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    throw new Error('Unexpected fixture access: ' + name);
  });
  const readdir = mock.method(fs, 'readdirSync', filename => normalize(filename) === `${stage}/api` ? ['app.js', 'node_modules'] : ['index.html']);
  try {
    assert.doesNotThrow(() => verifyStagedSizes(stage, sizes));
    assert.ok(inspected.includes(`${stage}/${sizes.apiArchive}`));
    assert.ok(inspected.includes(`${stage}/${sizes.webArchive}`));
    const reads = inspected.length;
    assert.throws(() => verifyStagedSizes(stage, { ...sizes, webArchive: sizesFor(priorRelease).webArchive }), /Unexpected deployment size manifest/);
    assert.throws(() => verifyStagedSizes(stage, sizesFor(priorRelease)), /Unexpected staging directory/);
    assert.equal(inspected.length, reads, 'unreviewed pairs are rejected before reading files');
    contents.set(`${stage}/${sizes.apiArchive}`, sizes.apiArchiveBytes + 1);
    assert.throws(() => verifyStagedSizes(stage, sizes), /Staged archive size/);
    contents.set(`${stage}/${sizes.apiArchive}`, sizes.apiArchiveBytes);
    contents.set(`${stage}/api/app.js`, sizes.apiExpandedBytes + 1);
    assert.throws(() => verifyStagedSizes(stage, sizes), /Expanded payload size/);
  } finally { lstat.mock.restore(); readdir.mock.restore(); }
});

test('new installer, packager and verifier agree on release pair, report, export and deployment date', () => {
  for (const name of [sizes.apiArchive, sizes.webArchive, `install-${release}.sh`]) {
    assert.ok(packager.includes(name)); assert.ok(verifier.includes(name));
  }
  assert.ok(installer.includes(`UPDATE_ZIP="\${1:-/home/dukaiyu2004/outdoor-fit-${release}-update.zip}"`));
  assert.ok(installer.includes(`API_ARCHIVE="${sizes.apiArchive}"`));
  assert.ok(installer.includes(`WEB_ARCHIVE="${sizes.webArchive}"`));
  assert.ok(installer.includes(`$DEPLOY_ROOT/${release}.XXXXXX`));
  assert.ok(installer.includes(`$BACKUP_ROOT/${release}-$(date`));
  assert.ok(packager.includes(`workspace-artifacts\\exports\\${release}`));
  assert.ok(verifier.includes(`'exports' / '${release}'`));
  assert.ok(packager.includes(`'${release}.md'`)); assert.ok(verifier.includes(`'${release}.md'`));
  assert.ok(packager.includes("'deploy\\2026-09-11'")); assert.ok(verifier.includes("'deploy' / '2026-09-11'"));
  for (const source of [installer, packager, verifier]) assert.equal(source.includes(`outdoor-fit-api-${priorRelease}`), false);
  // This deliberately remains shared: old/new installers must exclude one another.
  assert.ok(installer.includes('/run/outdoor-fit-file-explorer-deploy.lock'));
});

test('new installer authenticates small helpers then preflights disk before staging, extraction or stopping API', () => {
  const initial = installer.indexOf('node "$BOOTSTRAP_DIR/check-media-deploy-space.cjs" initial');
  const remaining = installer.indexOf('node "$WORK_DIR/check-media-deploy-space.cjs" remaining');
  const successPath = installer.slice(installer.indexOf('test "$(id -u)"'));
  assert.ok(initial > installer.indexOf('sha256sum -c -'));
  for (const writer of ['mkdir -p "$BACKUP_ROOT"', 'head -c "$((EXPECTED_ARCHIVE_BYTES + 1))"', 'sudo -u dukaiyu2004 npm ci']) assert.ok(initial < installer.indexOf(writer));
  assert.ok(remaining > installer.indexOf('sudo -u dukaiyu2004 npm ci'));
  assert.ok(remaining < installer.indexOf('cp -a "$API_DIR/src" "$API_DIR/package.json"'));
  assert.ok(successPath.indexOf('remaining "$WORK_DIR/deployment-sizes.json"') < successPath.indexOf('systemctl stop outdoor-fit-api'));
  assert.ok(installer.indexOf('sha256sum -c runtime-checksums.sha256') < installer.indexOf('tar --no-same-owner -xzf'));
  assert.ok(installer.indexOf('validate-media-deploy-archives.cjs" "$WORK_DIR/$API_ARCHIVE"') < installer.indexOf('tar --no-same-owner -xzf'));
  for (const guard of ['head -c 1048577', '-le 1048576', 'flock -n 9', 'cmp -s "$WORK_DIR/runtime-before.json" "$WORK_DIR/runtime-recheck.json"', 'Runtime database, uploads and new registrations are NOT rolled back or deleted automatically.']) assert.ok(installer.includes(guard));
  assert.ok(packager.includes("@($apiArchiveName,$webArchiveName,'deployment-sizes.json') + $helpers"));
  assert.ok(verifier.includes("runtime_names = {API_NAME, WEB_NAME, *HELPERS, 'deployment-sizes.json'}"));
  assert.ok(verifier.includes("Packaged helper differs from current source"));
  assert.doesNotMatch(installer, /\brm\s+-|\bapt(?:-get)?\s|npm\s+audit\s+fix/);
});

test('new release estimates still include backups, dependencies, ten percent overhead and two GiB reserve', () => {
  const entries = requirements(sizes, { databasePath: '/data/app.sqlite', mediaUploadDir: '/uploads' }, { apiCode: 1, web: 2, seed: 3, apiData: 4, database: 5, oldDependencies: 6, newDependencies: 7 }, 'initial');
  assert.equal(entries.find(item => item.target.endsWith('/outdoor-fit-backups')).bytes, 21);
  assert.ok(entries.some(item => item.target.endsWith('/.npm') && item.bytes === 2 * 1024 ** 3));
  assert.throws(() => checkRequirements(entries, () => ({ id: 'root', path: '/', available: 0 })), /Insufficient disk space/);
  const report = checkRequirements(entries, () => ({ id: 'root', path: '/', available: 20 * 1024 ** 3 }));
  assert.equal(report[0].requiredBytes, Math.ceil(report[0].estimatedBytes * 1.1) + 2 * 1024 ** 3);
});
