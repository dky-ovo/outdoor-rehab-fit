/* Local-only release preparation. This tool never runs EAS, uploads, or edits root configuration. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RELEASE = 'ios-ui-liveactivity-20261012-v27';
const VERSION = '1.2.4';
const PROJECT_ID = '1d1f05e7-ef12-456a-9c53-31bce530f5b3';
const OWNER = 'maxcch.c';
const BUNDLE = 'com.polyu.rs.outdoorrehabfit';
const ASC_APP_ID = '6742685136';
const API_URL = 'https://api.outdoorfit.hk/api';
const IMAGE = 'macos-sequoia-15.6-xcode-26.2';
const TREES = ['app', 'assets', 'components', 'constants', 'contexts', 'hooks', 'plugins', 'shared', 'types', 'utils'];
const ROOT_FILES = ['app.json', 'app.config.js', 'eas.json', 'package.json', 'package-lock.json', 'metro.config.js', 'tsconfig.json'];
const SHARED_SERVER = [
  'assistant.js', 'assistantBailianPolicy.js', 'assistantContentPolicy.js', 'assistantFaqKnowledge.js',
  'assistantGuideAnswers.js', 'assistantLanguage.js', 'assistantSymptomEvidence.js', 'assistantTcm.js', 'equipmentCatalog.js',
].map(name => `server/src/${name}`);
const NATIVE_MODULES = ['session-timer-notification', 'offline-assistant-voice'];
const REQUIRED_NATIVE = [
  'plugins/withSessionTimerLiveActivity.js',
  'modules/session-timer-notification/expo-module.config.json',
  'modules/session-timer-notification/ios/SessionTimerNotification.podspec',
  'modules/session-timer-notification/ios/SessionTimerNotificationModule.swift',
  'modules/session-timer-notification/ios/SessionTimerLiveActivityController.swift',
  'modules/session-timer-notification/ios/PrivacyInfo.xcprivacy',
  'modules/session-timer-notification/ios/LiveActivity/OutdoorFitTimerAttributes.swift',
  'modules/session-timer-notification/ios/LiveActivity/OutdoorFitTimerWidget.swift',
  'modules/offline-assistant-voice/ios/OfflineAssistantVoice.podspec',
  'modules/offline-assistant-voice/ios/OfflineAssistantVoiceModule.swift',
  'modules/offline-assistant-voice/ios/OfflineReplySpeaker.swift',
];
const FORBIDDEN_PART = /^(?:\.env(?:\..*)?|credentials(?:\..*)?|\.git|node_modules|__pycache__|secrets?|private_keys?)$/i;
const FORBIDDEN_EXT = /\.(?:pem|p8|p12|key|jks|mobileprovision|sqlite(?:-wal|-shm)?|db|apk|aab|ipa|zip|tar|gz)$/i;
const OMIT_PART = /^(?:__tests__|__mocks__|vendor|licenses|scripts|native-tests)$/;
const OMIT_FILE = /(?:\.(?:test|spec)\.[^.]+|[-_]test\.[^.]+|\.backup\.json|\.orig\..*|\.map)$/i;
const EAS_IGNORE = '# This directory is already an explicit source allowlist. Do not ignore shared server/src modules.\nnode_modules/\n.expo/\n.git/\n.env\n.env.*\ncredentials.json\n*.p8\n*.p12\n*.pem\n*.key\n*.mobileprovision\n';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en')));
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function fail(code) { throw new Error(code); }
function assertChild(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('IOS_PATH_OUTSIDE_RELEASE_ROOT');
}
function safeBytes(root, file) {
  assertChild(root, file);
  for (let current = file; path.resolve(current) !== path.resolve(root); current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) fail('IOS_SOURCE_LINK_REFUSED');
  }
  if (!fs.lstatSync(file).isFile()) fail('IOS_SOURCE_NOT_REGULAR_FILE');
  const name = relative(root, file);
  if (name.split('/').some(part => FORBIDDEN_PART.test(part)) || FORBIDDEN_EXT.test(name)) fail('IOS_PRIVATE_FILE_REFUSED');
  const bytes = fs.readFileSync(file);
  if (/\.(?:[cm]?js|jsx|tsx?|json|swift|plist|xcprivacy|podspec)$/.test(name) &&
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(bytes.toString('utf8'))) fail('IOS_PRIVATE_KEY_CONTENT_REFUSED');
  return bytes;
}
function walk(root, directory, files, filter = () => true) {
  if (!fs.existsSync(directory)) return;
  if (fs.lstatSync(directory).isSymbolicLink()) fail('IOS_SOURCE_LINK_REFUSED');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name), name = relative(root, full);
    if (entry.isSymbolicLink()) fail('IOS_SOURCE_LINK_REFUSED');
    if (!filter(name, entry)) continue;
    if (entry.isDirectory()) walk(root, full, files, filter);
    else if (entry.isFile()) files.add(name);
    else fail('IOS_SOURCE_NOT_REGULAR_FILE');
  }
}
function sourceNames(root) {
  const files = new Set([...ROOT_FILES, ...SHARED_SERVER]);
  const filter = (name, entry) => !name.split('/').some(part => OMIT_PART.test(part)) &&
    !OMIT_FILE.test(name) && (!entry.isFile() || !/\.md$/i.test(name));
  for (const name of TREES) walk(root, path.join(root, name), files, filter);
  for (const name of NATIVE_MODULES) {
    const base = `modules/${name}`;
    for (const file of ['index.js', 'package.json', 'expo-module.config.json', 'LICENSE']) {
      if (fs.existsSync(path.join(root, base, file))) files.add(`${base}/${file}`);
    }
    walk(root, path.join(root, base, 'ios'), files, (name, entry) => filter(name, entry) && !/OASenseVoiceEngine\.(?:h|mm)$/.test(name));
  }
  for (const name of REQUIRED_NATIVE) if (!files.has(name) || !fs.existsSync(path.join(root, name))) fail('IOS_NATIVE_SOURCE_MISSING');
  return [...files].sort();
}
function inventory(root, names) {
  const files = {};
  for (const name of names) {
    const bytes = safeBytes(root, path.join(root, name));
    files[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  return sorted(files);
}
function validateSharedClosure(root, files) {
  const allowed = new Set(files);
  // Only these deliberately shared, pure modules may cross from the client into server/.
  for (const file of files.filter(file => /\.[cm]?[jt]sx?$/.test(file))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const spec of imports.filter(spec => spec.startsWith('.'))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!target.startsWith('server/')) continue;
      if (![target, `${target}.js`, `${target}.json`].some(name => allowed.has(name))) fail('IOS_SHARED_SERVER_DEPENDENCY_MISSING');
    }
    if (file.startsWith('server/') && imports.some(spec => !spec.startsWith('.'))) fail('IOS_SHARED_SERVER_EXTERNAL_DEPENDENCY');
  }
}
function validateRootConfig(root) {
  const app = readJson(path.join(root, 'app.json')).expo;
  const eas = readJson(path.join(root, 'eas.json'));
  if (app.owner !== OWNER || app.slug !== 'outdoor-rehab-fit' || app.extra?.eas?.projectId !== PROJECT_ID ||
      app.ios?.bundleIdentifier !== BUNDLE || app.updates?.url !== `https://u.expo.dev/${PROJECT_ID}` ||
      eas.submit?.production?.ios?.ascAppId !== ASC_APP_ID || eas.cli?.appVersionSource !== 'remote') fail('IOS_ROOT_PROJECT_MISMATCH');
  return { app, eas };
}
function generatedConfig(root) {
  const { app, eas } = validateRootConfig(root);
  const config = structuredClone(app);
  config.version = VERSION;
  config.runtimeVersion = VERSION;
  // EAS remote autoIncrement is authoritative. Do not pin or reset the build number locally.
  delete config.ios.buildNumber;
  const profile = {
    ...eas.build.production, distribution: 'store', developmentClient: false,
    channel: 'production', environment: 'production', autoIncrement: true,
    env: { EXPO_PUBLIC_API_BASE_URL: API_URL, EXPO_NO_DOTENV: '1' },
    ios: { image: IMAGE, credentialsSource: 'remote' },
  };
  return {
    'app.json': Buffer.from(json({ expo: config })),
    'eas.json': Buffer.from(json({ cli: eas.cli, build: { production: profile }, submit: { production: { ios: { ascAppId: ASC_APP_ID } } } })),
    '.easignore': Buffer.from(EAS_IGNORE),
    '.gitignore': Buffer.from(EAS_IGNORE),
  };
}
function audit(root) {
  validateRootConfig(root);
  const names = sourceNames(root);
  const files = inventory(root, names);
  validateSharedClosure(root, names);
  return { release: RELEASE, version: VERSION, runtimeVersion: VERSION, projectId: PROJECT_ID, owner: OWNER,
    bundleIdentifier: BUNDLE, ascAppId: ASC_APP_ID, apiBaseUrl: API_URL, image: IMAGE,
    files, fileCount: names.length, bytes: Object.values(files).reduce((sum, item) => sum + item.bytes, 0) };
}
function artifactRoot(root) { return path.join(root, 'workspace-artifacts', RELEASE); }
function prepare(root) {
  const before = audit(root), out = artifactRoot(root), project = path.join(out, 'project');
  assertChild(root, out);
  if (fs.existsSync(project) || fs.existsSync(path.join(out, 'source-manifest.json'))) fail('IOS_STAGE_ALREADY_EXISTS');
  fs.mkdirSync(project, { recursive: true });
  const generated = generatedConfig(root);
  for (const name of Object.keys(before.files)) {
    const destination = path.join(project, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, generated[name] || safeBytes(root, path.join(root, name)), { flag: 'wx' });
  }
  for (const name of ['.easignore', '.gitignore']) fs.writeFileSync(path.join(project, name), generated[name], { flag: 'wx' });
  const after = audit(root);
  if (!same(before, after)) fail('IOS_SOURCE_CHANGED_DURING_STAGE');
  const stageFiles = inventory(project, [...Object.keys(before.files), '.easignore', '.gitignore'].sort());
  const manifest = { ...before, sourceFiles: before.files, files: stageFiles, createdAt: new Date().toISOString(),
    rootAppJsonSha256: before.files['app.json'].sha256, buildStarted: false, submitted: false };
  fs.writeFileSync(path.join(out, 'source-manifest.json'), json(manifest), { flag: 'wx' });
  return verify(root);
}
function verify(root) {
  const out = artifactRoot(root), project = path.join(out, 'project');
  const manifest = readJson(path.join(out, 'source-manifest.json'));
  if (manifest.release !== RELEASE || manifest.version !== VERSION || manifest.projectId !== PROJECT_ID) fail('IOS_STAGE_MANIFEST_MISMATCH');
  const current = audit(root);
  if (!same(current.files, manifest.sourceFiles)) fail('IOS_SOURCE_CHANGED_AFTER_STAGE');
  const names = new Set();
  // Local CLI cache/dependencies are never part of the upload. Generated native trees are NOT ignored here.
  walk(project, project, names, name => !/^(?:node_modules|\.expo)(?:\/|$)/.test(name));
  const actual = inventory(project, [...names].sort());
  if (!same(actual, manifest.files)) fail('IOS_STAGE_FILE_SET_OR_HASH_CHANGED');
  validateSharedClosure(project, [...names]);
  for (const [name, bytes] of Object.entries(generatedConfig(root))) if (hash(bytes) !== actual[name]?.sha256) fail('IOS_STAGE_CONFIG_CHANGED');
  return { status: 'PASS', release: RELEASE, project, version: VERSION, runtimeVersion: VERSION,
    fileCount: names.size, bytes: Object.values(actual).reduce((sum, item) => sum + item.bytes, 0),
    manifestSha256: hash(fs.readFileSync(path.join(out, 'source-manifest.json'))), rootConfigUnchanged: true };
}
function validateResolvedConfig(config) {
  const expo = config.expo || config;
  const extensions = expo.extra?.eas?.build?.experimental?.ios?.appExtensions || [];
  if (expo.version !== VERSION || expo.runtimeVersion !== VERSION || expo.owner !== OWNER ||
      expo.extra?.eas?.projectId !== PROJECT_ID || expo.ios?.bundleIdentifier !== BUNDLE ||
      expo.updates?.url !== `https://u.expo.dev/${PROJECT_ID}` || !expo.ios?.infoPlist?.NSSupportsLiveActivities ||
      !extensions.some(item => item.targetName === 'OutdoorFitTimerWidget' && item.bundleIdentifier === `${BUNDLE}.timer-widget`)) fail('IOS_RESOLVED_CONFIG_MISMATCH');
  return { status: 'PASS', version: VERSION, projectId: PROJECT_ID, widget: `${BUNDLE}.timer-widget` };
}
function resolveLocal(root) {
  const verified = verify(root), out = artifactRoot(root);
  // Node resolves the installed dependencies from this helper's project root; no symlink is created.
  const { getConfig } = require('@expo/config');
  const config = getConfig(verified.project, { skipSDKVersionRequirement: true, isPublicConfig: true }).exp;
  const result = validateResolvedConfig(config);
  const save = (name, contents) => {
    const file = path.join(out, name);
    if (fs.existsSync(file)) {
      if (fs.readFileSync(file, 'utf8') !== contents) fail('IOS_LOCAL_VALIDATION_FILE_CHANGED');
    } else fs.writeFileSync(file, contents, { flag: 'wx' });
    return file;
  };
  const resolvedConfig = save('resolved-config.json', json(config));
  // Metro's file map needs dependencies outside projectRoot explicitly visible. Only node_modules
  // is watched, never the dirty parent app/server/workspace. This wrapper stays OUTSIDE the upload.
  const wrapper = `const path = require('node:path');\nconst config = require(${JSON.stringify(path.join(verified.project, 'metro.config.js'))});\n` +
    `const modules = ${JSON.stringify(path.join(root, 'node_modules'))};\n` +
    `config.projectRoot = ${JSON.stringify(verified.project)};\n` +
    `config.watchFolders = [...new Set([...(config.watchFolders || []), modules])];\n` +
    `config.resolver.nodeModulesPaths = [...new Set([path.join(config.projectRoot, 'node_modules'), modules])];\n` +
    `module.exports = config;\n`;
  const localMetroConfig = save('local-metro.cjs', wrapper);
  verify(root);
  return { ...result, resolvedConfig, localMetroConfig, rootConfigUnchanged: true, stageUnchanged: true };
}
function validateBuild(build, id) {
  // CLI 24.7 uses the GraphQL BuildFragment (app/runtime/updateChannel). Also accept the
  // explicitly normalized, redacted status report, but never silently accept conflicting fields.
  if (Array.isArray(build)) {
    if (build.length !== 1) fail('IOS_FINISHED_BUILD_MISMATCH');
    build = build[0];
  }
  if (!build || typeof build !== 'object') fail('IOS_FINISHED_BUILD_MISMATCH');
  const consistent = (...values) => {
    const present = values.filter(value => value !== null && value !== undefined);
    if (present.some(value => value !== present[0])) fail('IOS_FINISHED_BUILD_MISMATCH');
    return present[0];
  };
  const projectId = consistent(build.app?.id, build.project?.id);
  const owner = consistent(build.app?.ownerAccount?.name, build.project?.ownerAccount?.name);
  const runtimeVersion = consistent(build.runtime?.version, build.runtimeVersion);
  const channel = consistent(build.updateChannel?.name, build.channel);
  const bundle = consistent(build.appIdentifier, build.bundleIdentifier);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) || build.id !== id || build.status !== 'FINISHED' || build.platform !== 'IOS' ||
      build.distribution !== 'STORE' || projectId !== PROJECT_ID || owner !== OWNER || bundle !== BUNDLE ||
      build.appVersion !== VERSION || runtimeVersion !== VERSION || build.buildProfile !== 'production' ||
      channel !== 'production' || build.isForIosSimulator === true || build.error || !/^\d+$/.test(String(build.appBuildVersion || '')) ||
      !String(build.artifacts?.buildUrl || '').startsWith('https://')) fail('IOS_FINISHED_BUILD_MISMATCH');
  return { status: 'PASS', buildId: id, version: build.appVersion, buildNumber: String(build.appBuildVersion),
    runtimeVersion, channel, bundleIdentifier: bundle, ascAppId: ASC_APP_ID, submissionMustUseExactId: true };
}
module.exports = { RELEASE, VERSION, PROJECT_ID, OWNER, BUNDLE, ASC_APP_ID, API_URL, IMAGE,
  ROOT_FILES, SHARED_SERVER, REQUIRED_NATIVE, audit, prepare, verify, resolveLocal, validateResolvedConfig, validateBuild };
if (require.main === module) {
  try {
    const [command, arg, id] = process.argv.slice(2), root = path.resolve(__dirname, '..');
    const result = command === 'audit' ? audit(root) : command === 'prepare' ? prepare(root) : command === 'verify' ? verify(root) : command === 'resolve-local' ? resolveLocal(root) :
      command === 'validate-config' ? validateResolvedConfig(readJson(arg)) : command === 'validate-build' ? validateBuild(readJson(arg), id) : fail('IOS_UNKNOWN_LOCAL_COMMAND');
    if (command === 'audit') delete result.files;
    console.log(json(result));
  } catch (error) {
    console.error(/^IOS_[A-Z_]+$/.test(error.message) ? error.message : 'IOS_RELEASE_CHECK_FAILED');
    process.exitCode = 1;
  }
}
