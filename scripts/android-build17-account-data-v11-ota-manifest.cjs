#!/usr/bin/env node
// This release is deliberately separate from the iOS/default Expo project.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const artifact = path.join(root, 'workspace-artifacts/android-build17-account-data-20260930-v11');
const output = path.join(artifact, 'export');
const target = Object.freeze({
  release: 'android-build17-account-data-20260930-v11',
  projectId: 'bcee8c37-e833-4f4d-b660-aa457accd96d', owner: 'dky2004',
  package: 'com.maxcch.c.outdoorrehabfit', version: '1.2.3', runtimeVersion: '1.2.3',
  installedBuild: 17, platform: 'android', channel: 'preview', easCli: '24.7.0',
  apiBaseUrl: 'https://api.outdoorfit.hk/api',
});
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const fail = code => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fileRecord(file) {
  const info = fs.lstatSync(file);
  requireValue(info.isFile() && !info.isSymbolicLink(), 'OTA_NONREGULAR_FILE');
  const data = fs.readFileSync(file);
  return { size: data.length, sha256: hash(data) };
}

function walk(directory, accept = () => true) {
  const result = {};
  function visit(current) {
    requireValue(fs.lstatSync(current).isDirectory() && !fs.lstatSync(current).isSymbolicLink(), 'OTA_LINK_REFUSED');
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      requireValue(!item.isSymbolicLink(), 'OTA_LINK_REFUSED');
      const file = path.join(current, item.name);
      if (item.isDirectory()) visit(file);
      else {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        if (accept(relative)) result[relative] = fileRecord(file);
      }
    }
  }
  visit(directory);
  return result;
}

function sources() {
  const result = {};
  for (const name of ['app.json', 'app.config.js', 'eas.json', 'metro.config.js', 'package.json', 'package-lock.json',
    'scripts/android-build17-account-data-v11-ota.ps1', 'scripts/android-build17-account-data-v11-ota-manifest.cjs', 'docs/android-build17-account-data-v11-ota.md']) {
    result[name] = fileRecord(path.join(root, name));
  }
  // Bind Favorites navigation, committed bookmarks, local preview preparation and dependencies.
  for (const directory of ['app', 'components', 'constants', 'contexts', 'hooks', 'utils', 'plugins']) {
    for (const [name, record] of Object.entries(walk(path.join(root, directory), name =>
      /\.(?:js|jsx|ts|tsx|json)$/.test(name) && !name.split('/').includes('__tests__')))) {
      result[directory + '/' + name] = record;
    }
  }
  return result;
}

function assertConfig() {
  const { exp } = require('@expo/config').getConfig(root);
  requireValue(exp.owner === target.owner && exp.extra?.eas?.projectId === target.projectId
    && exp.updates?.url === 'https://u.expo.dev/' + target.projectId
    && exp.android?.package === target.package && exp.version === target.version
    && (exp.android?.runtimeVersion ?? exp.runtimeVersion) === target.runtimeVersion, 'OTA_ANDROID_CONFIG_MISMATCH');
  console.log('ANDROID_CONFIG=PASS');
}

function exportedFiles() {
  const records = walk(output);
  requireValue(records['metadata.json'], 'OTA_METADATA_MISSING');
  const metadata = json(path.join(output, 'metadata.json'));
  requireValue(metadata.bundler === 'metro' && equal(Object.keys(metadata.fileMetadata || {}), ['android']), 'OTA_ANDROID_ONLY_REQUIRED');
  const android = metadata.fileMetadata.android;
  const references = [android.bundle, ...(android.assets || []).map(asset => asset.path)];
  for (const name of references) {
    requireValue(typeof name === 'string', 'OTA_EXPORT_REFERENCE_INVALID');
    const normal = name.replace(/\\/g, '/');
    requireValue(!normal.startsWith('/') && !normal.split('/').includes('..') && records[normal], 'OTA_EXPORT_REFERENCE_INVALID');
  }
  const bundle = fs.readFileSync(path.join(output, android.bundle.replace(/\\/g, '/')));
  requireValue(bundle.includes(Buffer.from(target.apiBaseUrl)), 'OTA_API_URL_NOT_IN_BUNDLE');
  return records;
}

function manifestPath() { return path.join(artifact, 'release-manifest.json'); }
function writeNew(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }

function run(action) {
  if (action === 'assert-config') return assertConfig();
  if (action === 'init') {
    requireValue(!fs.existsSync(artifact), 'OTA_OUTPUT_ALREADY_EXISTS');
    const snapshot = sources();
    fs.mkdirSync(artifact, { mode: 0o700 });
    writeNew(path.join(artifact, 'source-snapshot.json'), snapshot);
    return console.log('OTA_EXPORT_PREPARED=YES');
  }
  if (action === 'seal') {
    const snapshot = json(path.join(artifact, 'source-snapshot.json'));
    requireValue(equal(snapshot, sources()), 'OTA_SOURCE_CHANGED_DURING_EXPORT');
    const files = exportedFiles();
    writeNew(manifestPath(), { formatVersion: 1, target, sources: snapshot, files });
  } else requireValue(action === 'verify', 'OTA_ACTION_INVALID');
  const manifest = json(manifestPath());
  requireValue(manifest.formatVersion === 1 && equal(manifest.target, target), 'OTA_MANIFEST_TARGET_MISMATCH');
  requireValue(equal(manifest.sources, sources()), 'OTA_SOURCE_OR_TOOL_CHANGED');
  requireValue(equal(manifest.files, exportedFiles()), 'OTA_EXPORT_CHANGED');
  console.log('OTA_MANIFEST=PASS');
  console.log('OTA_FILES=' + Object.keys(manifest.files).length);
  console.log('OTA_BYTES=' + Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0));
  console.log('OTA_MANIFEST_SHA256=' + hash(fs.readFileSync(manifestPath())));
  console.log('OTA_ARTIFACT=' + artifact);
}

if (require.main === module) {
  try { run(process.argv[2]); }
  catch (error) { console.error(/^OTA_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'OTA_VERIFICATION_FAILED'); process.exitCode = 1; }
}
module.exports = { target, run, assertConfig, exportedFiles };
