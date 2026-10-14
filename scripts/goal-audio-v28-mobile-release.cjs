// Prepare and verify frozen, platform-specific OTA exports. This helper never publishes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sourceAudit = require('./ios-ui-liveactivity-v27-release.cjs');
const ROOT = path.resolve(__dirname, '..');
const RELEASE = 'goal-audio-20261014-v28';
const API = 'https://api.outdoorfit.hk/api';
const TARGETS = Object.freeze({
  android: { platform: 'android', projectId: 'bcee8c37-e833-4f4d-b660-aa457accd96d', owner: 'dky2004',
    version: '1.2.3', runtimeVersion: '1.2.3', channel: 'preview', installedBuild: 17, identifier: 'com.maxcch.c.outdoorrehabfit' },
  ios: { platform: 'ios', projectId: '1d1f05e7-ef12-456a-9c53-31bce530f5b3', owner: 'maxcch.c',
    version: '1.2.4', runtimeVersion: '1.2.4', channel: 'production', installedBuild: 19, identifier: 'com.polyu.rs.outdoorrehabfit' },
});
const TOOLS = ['scripts/goal-audio-v28-mobile-release.cjs', 'scripts/goal-audio-v28-mobile-ota.ps1', 'scripts/ios-ui-liveactivity-v27-release.cjs'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const fail = code => { throw new Error(code); };
const check = (value, code) => { if (!value) fail(code); };
function target(platform) { check(TARGETS[platform], 'OTA_PLATFORM_INVALID'); return TARGETS[platform]; }
function paths(platform) {
  target(platform);
  const artifact = path.join(ROOT, 'workspace-artifacts', `${RELEASE}-${platform}`);
  return { artifact, project: path.join(artifact, 'project'), output: path.join(artifact, 'export'), manifest: path.join(artifact, 'release-manifest.json') };
}
function record(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink(), 'OTA_NONREGULAR_FILE');
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: hash(bytes) };
}
function inventory(directory, ignoreCache = false) {
  const result = {};
  function visit(current) {
    check(!fs.lstatSync(current).isSymbolicLink(), 'OTA_LINK_REFUSED');
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      check(!item.isSymbolicLink(), 'OTA_LINK_REFUSED');
      const file = path.join(current, item.name), name = path.relative(directory, file).split(path.sep).join('/');
      if (ignoreCache && /^\.expo(?:\/|$)/.test(name)) continue;
      if (item.isDirectory()) visit(file); else result[name] = record(file);
    }
  }
  visit(directory);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
function toolRecords() { return Object.fromEntries(TOOLS.map(name => [name, record(path.join(ROOT, name))])); }
function validateConfig(config, platform) {
  const t = target(platform), app = config.expo || config;
  const identifier = platform === 'android' ? app.android?.package : app.ios?.bundleIdentifier;
  const runtime = app[platform]?.runtimeVersion ?? app.runtimeVersion;
  check(app.owner === t.owner && app.extra?.eas?.projectId === t.projectId && app.version === t.version &&
    runtime === t.runtimeVersion && identifier === t.identifier && app.updates?.url === `https://u.expo.dev/${t.projectId}`, 'OTA_RESOLVED_TARGET_MISMATCH');
  return { platform, runtimeVersion: runtime, projectId: t.projectId, channel: t.channel };
}
function resolvedConfig(platform) {
  return validateConfig(require('@expo/config').getConfig(paths(platform).project, { skipSDKVersionRequirement: true, isPublicConfig: true }).exp, platform);
}
function checkPrepared(platform) {
  const p = paths(platform), m = read(path.join(p.artifact, 'prepared-manifest.json'));
  check(m.release === RELEASE && same(m.target, target(platform)), 'OTA_PREPARED_TARGET_MISMATCH');
  check(same(m.tools, toolRecords()), 'OTA_RELEASE_TOOL_CHANGED');
  check(same(m.projectFiles, inventory(p.project, true)), 'OTA_FROZEN_SOURCE_CHANGED');
  resolvedConfig(platform);
  return m;
}
function prepare(platform) {
  const t = target(platform), p = paths(platform);
  check(!fs.existsSync(p.artifact), 'OTA_OUTPUT_ALREADY_EXISTS');
  const audit = sourceAudit.audit(ROOT);
  const qa = read(path.join(ROOT, 'workspace-artifacts/goal-audio-20261014-qa/source-manifest.json'));
  for (const item of qa) check(record(path.join(ROOT, item.path)).sha256 === item.sha256, 'OTA_REVIEWED_SOURCE_CHANGED');
  const baseline = read(path.join(ROOT, 'workspace-artifacts/ios-ui-liveactivity-20261012-v27/source-manifest.json'));
  const nativeFiles = Object.keys(audit.files).filter(name => /^(?:plugins|modules)\//.test(name));
  for (const name of ['app.json', 'package.json', 'package-lock.json', 'app.config.js', 'metro.config.js', ...nativeFiles]) {
    check(audit.files[name]?.sha256 === baseline.sourceFiles[name]?.sha256, 'OTA_NATIVE_DEPENDENCIES_CHANGED');
  }
  fs.mkdirSync(p.project, { recursive: true });
  for (const name of Object.keys(audit.files)) {
    const destination = path.join(p.project, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), destination, fs.constants.COPYFILE_EXCL);
  }
  const config = read(path.join(p.project, 'app.json'));
  Object.assign(config.expo, { owner: t.owner, version: t.version, runtimeVersion: t.runtimeVersion });
  config.expo.extra.eas.projectId = t.projectId;
  config.expo.updates.url = `https://u.expo.dev/${t.projectId}`;
  if (config.expo[platform]?.runtimeVersion) config.expo[platform].runtimeVersion = t.runtimeVersion;
  fs.writeFileSync(path.join(p.project, 'app.json'), JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(path.join(p.project, 'metro.config.js'), path.join(p.project, 'metro.base.cjs'));
  const modules = path.join(ROOT, 'node_modules');
  fs.writeFileSync(path.join(p.project, 'metro.config.js'),
    `const config = require('./metro.base.cjs');\nconst modules = ${JSON.stringify(modules)};\n` +
    `config.projectRoot = __dirname;\nconfig.watchFolders = [...new Set([...(config.watchFolders || []), modules])];\n` +
    `config.resolver.nodeModulesPaths = [...new Set([...(config.resolver.nodeModulesPaths || []), modules])];\nmodule.exports = config;\n`, { flag: 'wx' });
  const ignore = 'node_modules/\n.expo/\n.git/\n.env\n.env.*\ncredentials.json\n*.p8\n*.p12\n*.pem\n*.key\n*.mobileprovision\n';
  fs.writeFileSync(path.join(p.project, '.easignore'), ignore, { flag: 'wx' });
  fs.writeFileSync(path.join(p.project, '.gitignore'), ignore, { flag: 'wx' });
  check(same(audit.files, sourceAudit.audit(ROOT).files), 'OTA_SOURCE_CHANGED_DURING_PREPARE');
  const result = { release: RELEASE, target: t, apiBaseUrl: API, sources: audit.files,
    reviewedSource: qa, tools: toolRecords(), projectFiles: inventory(p.project, true) };
  write(path.join(p.artifact, 'prepared-manifest.json'), result);
  checkPrepared(platform);
  return { status: 'PASS', action: 'prepare', ...resolvedConfig(platform), artifact: p.artifact };
}
function exportFiles(platform) {
  const p = paths(platform), records = inventory(p.output), m = read(path.join(p.output, 'metadata.json'));
  check(m.bundler === 'metro' && same(Object.keys(m.fileMetadata || {}), [platform]), 'OTA_EXPORT_PLATFORM_MISMATCH');
  const metadata = m.fileMetadata[platform];
  for (const name of [metadata.bundle, ...(metadata.assets || []).map(item => item.path)]) {
    check(typeof name === 'string' && !path.isAbsolute(name) && !name.replace(/\\/g, '/').split('/').includes('..'), 'OTA_EXPORT_REFERENCE_INVALID');
    check(records[name.replace(/\\/g, '/')], 'OTA_EXPORT_REFERENCE_MISSING');
  }
  const bytes = fs.readFileSync(path.join(p.output, metadata.bundle));
  check(bytes.includes(Buffer.from(API)), 'OTA_API_URL_NOT_IN_BUNDLE');
  return records;
}
function seal(platform) {
  const prepared = checkPrepared(platform), p = paths(platform);
  write(p.manifest, { formatVersion: 1, ...prepared, exportedFiles: exportFiles(platform), sealedAt: new Date().toISOString() });
  return verify(platform);
}
function verify(platform) {
  const p = paths(platform), m = read(p.manifest), prepared = checkPrepared(platform);
  check(m.formatVersion === 1 && m.release === RELEASE && same(m.target, target(platform)), 'OTA_MANIFEST_TARGET_MISMATCH');
  for (const key of Object.keys(prepared)) check(same(m[key], prepared[key]), 'OTA_MANIFEST_CHANGED');
  check(same(m.exportedFiles, exportFiles(platform)), 'OTA_EXPORT_CHANGED');
  return { status: 'PASS', ...resolvedConfig(platform), artifact: p.artifact, files: Object.keys(m.exportedFiles).length,
    bytes: Object.values(m.exportedFiles).reduce((sum, item) => sum + item.bytes, 0), manifestSha256: record(p.manifest).sha256 };
}
function exportPlatform(platform) {
  const p = paths(platform);
  checkPrepared(platform);
  check(!fs.existsSync(p.output), 'OTA_EXPORT_OUTPUT_ALREADY_EXISTS');
  const env = { ...process.env, EXPO_NO_DOTENV: '1', EXPO_OFFLINE: '1', CI: '1', EXPO_PUBLIC_API_BASE_URL: API };
  delete env.EXPO_OVERRIDE_METRO_CONFIG;
  env.EAS_PROJECT_ROOT = p.project;
  const result = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/expo/bin/cli'), 'export', p.project,
    '--platform', platform, '--max-workers', '2', '--output-dir', p.output], { cwd: p.project, env, stdio: 'inherit' });
  check(result.status === 0, 'OTA_EXPORT_FAILED');
  return seal(platform);
}
module.exports = { TARGETS, validateConfig, prepare, checkPrepared, verify, exportFiles, paths };
if (require.main === module) {
  try {
    const [action, platform] = process.argv.slice(2);
    const result = action === 'prepare' ? prepare(platform) : action === 'export' ? exportPlatform(platform) :
      action === 'verify' ? verify(platform) : action === 'seal' ? seal(platform) : fail('OTA_ACTION_INVALID');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(/^OTA_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'OTA_RELEASE_CHECK_FAILED'); process.exitCode = 1; }
}
