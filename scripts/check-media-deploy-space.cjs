const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validStageRoots } = require('./validate-media-deploy-paths.cjs');

const GiB = 1024 ** 3;
const API = '/home/dukaiyu2004/outdoor-fit-api';
const WEB = '/var/www/outdoor-fit';
const STAGING = '/home/dukaiyu2004/.outdoor-fit-deploy';
const BACKUPS = '/home/dukaiyu2004/outdoor-fit-backups';
// Each reviewed release must supply its own complete API/Web pair. Never
// accept a user-provided filename pattern or combine payloads across releases.
const ARCHIVE_RELEASES = Object.freeze(['file-explorer-video-20260910', 'pdf-app-timer-20260911']);
const releaseForSizes = value => ARCHIVE_RELEASES.find(release =>
  value?.apiArchive === `outdoor-fit-api-${release}.tar.gz` && value?.webArchive === `outdoor-fit-web-${release}.zip`);

function validateSizes(value) {
  if (value?.version !== 1 || !releaseForSizes(value)) throw new Error('Unexpected deployment size manifest');
  for (const key of ['apiArchiveBytes', 'webArchiveBytes', 'apiExpandedBytes', 'webExpandedBytes']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 100 * GiB) throw new Error(`Invalid payload size: ${key}`);
  }
  return value;
}

function directoryBytes(candidate) {
  if (!fs.existsSync(candidate)) return 0;
  // Apparent size deliberately overestimates sparse files; no follow-links flag.
  const output = execFileSync('du', ['-s', '-b', '--', candidate], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const bytes = Number(output.match(/^([0-9]+)\s/)?.[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Could not measure existing deployment files');
  return bytes;
}

function sumFiles(candidate, excluded = new Set()) {
  const stat = fs.lstatSync(candidate);
  if (stat.isFile() && !stat.isSymbolicLink()) return stat.size;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Non-regular staged file while measuring payload');
  return fs.readdirSync(candidate).filter(name => !excluded.has(name)).reduce((sum, name) => sum + sumFiles(path.join(candidate, name)), 0);
}

function verifyStagedSizes(stage, sizes) {
  validateSizes(sizes);
  const api = path.posix.join(stage, 'api'), web = path.posix.join(stage, 'web');
  if (!validStageRoots(api, web) || !path.posix.basename(stage).startsWith(`${releaseForSizes(sizes)}.`)) throw new Error('Unexpected staging directory');
  for (const [name, expected] of [[sizes.apiArchive, sizes.apiArchiveBytes], [sizes.webArchive, sizes.webArchiveBytes]]) {
    const stat = fs.lstatSync(path.posix.join(stage, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected) throw new Error('Staged archive size differs from reviewed manifest');
  }
  if (sumFiles(api, new Set(['node_modules'])) !== sizes.apiExpandedBytes || sumFiles(web) !== sizes.webExpandedBytes) throw new Error('Expanded payload size differs from reviewed manifest');
}

function requirements(sizes, runtime, existing, phase) {
  validateSizes(sizes);
  if (!['initial', 'remaining'].includes(phase)) throw new Error('Unknown disk preflight phase');
  const dependencies = phase === 'initial' ? 2 * GiB : existing.newDependencies;
  const backup = existing.apiCode + existing.web + existing.seed + existing.apiData + existing.database + existing.oldDependencies;
  return [
    // Include moving the old seed into staging even if a cross-device move must copy it.
    { target: STAGING, bytes: existing.seed + (phase === 'initial' ? sizes.apiArchiveBytes + sizes.webArchiveBytes + sizes.apiExpandedBytes + sizes.webExpandedBytes + dependencies : 0) },
    { target: BACKUPS, bytes: backup },
    { target: API, bytes: sizes.apiExpandedBytes + dependencies },
    { target: WEB, bytes: sizes.webExpandedBytes },
    // New seed import may create a second copy on a separately configured upload disk.
    { target: runtime.mediaUploadDir, bytes: sizes.apiExpandedBytes },
    // Allow DB/WAL growth even if DATABASE_PATH resides on a separate volume.
    { target: path.dirname(runtime.databasePath), bytes: Math.max(existing.database, 64 * 1024 ** 2) },
    // npm's download cache lives outside staging; reserve it before npm ci.
    ...(phase === 'initial' ? [{ target: '/home/dukaiyu2004/.npm', bytes: 2 * GiB }] : []),
  ];
}

function filesystemFor(target) {
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('No existing ancestor for deployment path');
    existing = parent;
  }
  const stat = fs.statSync(existing), info = fs.statfsSync(existing);
  return { id: String(stat.dev), available: info.bavail * info.bsize, path: existing };
}

function checkRequirements(entries, inspect = filesystemFor) {
  const groups = new Map();
  for (const item of entries) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('Invalid disk estimate');
    const volume = inspect(item.target);
    if (!Number.isSafeInteger(volume.available) || volume.available < 0) throw new Error('Could not read filesystem available bytes');
    const group = groups.get(volume.id) || { filesystemPath: volume.path, availableBytes: volume.available, estimatedBytes: 0 };
    group.availableBytes = Math.min(group.availableBytes, volume.available);
    group.estimatedBytes += item.bytes;
    groups.set(volume.id, group);
  }
  const report = [...groups.values()].map(group => ({ ...group, requiredBytes: Math.ceil(group.estimatedBytes * 1.1) + 2 * GiB }));
  const insufficient = report.filter(group => group.availableBytes < group.requiredBytes);
  if (insufficient.length) throw new Error(`Insufficient disk space; no large payload should be written. Required includes copies, backups, dependencies, 10% overhead and 2 GiB free reserve per volume. ${JSON.stringify(insufficient)}`);
  return report;
}

function requireAtomicDeploymentMoves(inspect = filesystemFor) {
  const api = inspect(API).id;
  const movePaths = [STAGING, BACKUPS, ...['src', 'node_modules', 'media-seed'].map(name => path.posix.join(API, name))];
  if (movePaths.some(candidate => inspect(candidate).id !== api)) throw new Error('API, its src/node_modules/media-seed directories, staging and backup directories must be on the same filesystem for atomic recovery moves. Custom upload storage may remain on another filesystem.');
}

function main(args) {
  const [phase, sizesFile, runtimeFile, stage] = args;
  const sizes = validateSizes(JSON.parse(fs.readFileSync(sizesFile, 'utf8')));
  const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
  if (!path.isAbsolute(runtime.databasePath || '') || !path.isAbsolute(runtime.mediaUploadDir || '')) throw new Error('Validated runtime paths are required');
  requireAtomicDeploymentMoves();
  if (phase === 'remaining') verifyStagedSizes(stage, sizes);
  const existing = {
    apiCode: ['src', 'package.json', 'package-lock.json'].reduce((sum, name) => sum + directoryBytes(path.join(API, name)), 0),
    web: directoryBytes(WEB), seed: directoryBytes(path.join(API, 'media-seed')), apiData: directoryBytes(path.join(API, 'data')),
    database: ['', '-wal', '-shm'].reduce((sum, suffix) => sum + directoryBytes(runtime.databasePath + suffix), 0),
    oldDependencies: directoryBytes(path.join(API, 'node_modules')),
    newDependencies: phase === 'remaining' ? directoryBytes(path.join(stage, 'api/node_modules')) : 0,
  };
  const report = checkRequirements(requirements(sizes, runtime, existing, phase));
  console.log(JSON.stringify({ phase, sufficientSpace: true, reservePerFilesystemBytes: 2 * GiB, filesystems: report }));
}

module.exports = { validateSizes, requirements, checkRequirements, requireAtomicDeploymentMoves, verifyStagedSizes, sumFiles, main };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
