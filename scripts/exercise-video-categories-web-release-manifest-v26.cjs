'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'workspace-artifacts/exercise-video-categories-20261012-v26-web');
const RELEASE = 'exercise-video-categories-20261012-v26-web';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function walk(root) {
  const rows = {};
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('WEB_SOURCE_LINK_REFUSED');
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw Error('WEB_SOURCE_LINK_REFUSED');
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      for (const [name, row] of Object.entries(walk(full))) rows[entry.name + '/' + name] = row;
    } else if (entry.isFile() && !entry.name.endsWith('.map')) {
      const data = fs.readFileSync(full); rows[entry.name] = { sha256: hash(data), bytes: data.length };
    }
  }
  return rows;
}
function sources() {
  const rows = {};
  for (const directory of ['app', 'components', 'hooks', 'utils', 'constants', 'contexts', 'assets', 'plugins']) {
    for (const [name, row] of Object.entries(walk(path.join(ROOT, directory)))) rows[directory + '/' + name] = row;
  }
  for (const name of ['app.json', 'app.config.js', 'eas.json', 'package.json', 'package-lock.json', 'metro.config.js',
    'server/src/exerciseVideoMetadata.js', 'server/src/assistant.js', 'server/src/assistantGuideAnswers.js', 'server/src/assistantSymptomEvidence.js', 'server/src/assistantTcm.js', 'server/src/assistantFaqKnowledge.js', 'server/src/assistantContentPolicy.js', 'server/src/assistantLanguage.js', 'server/src/equipmentCatalog.js', 'server/src/assistantBailianPolicy.js', 'scripts/exercise-video-categories-web-release-manifest-v26.cjs']) {
    const data = fs.readFileSync(path.join(ROOT, name)); rows[name] = { sha256: hash(data), bytes: data.length };
  }
  return rows;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function run(action) {
  const capture = path.join(OUT, 'source-before-build.json'), manifest = path.join(OUT, 'release-manifest.json');
  if (action === 'capture') {
    if (fs.existsSync(OUT)) throw Error('WEB_OUTPUT_ALREADY_EXISTS');
    const sourceFiles = sources(); fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(capture, JSON.stringify({ release: RELEASE, files: sourceFiles }, null, 2), { flag: 'wx' });
    return console.log('V26_WEB_SOURCE_CAPTURED=PASS');
  }
  if (action === 'seal') {
    const before = read(capture), sourceFiles = sources();
    if (before.release !== RELEASE || !same(before.files, sourceFiles)) throw Error('WEB_SOURCE_CHANGED_DURING_BUILD');
    const files = walk(path.join(OUT, 'export'));
    if (!files['index.html']) throw Error('WEB_INDEX_MISSING');
    fs.writeFileSync(manifest, JSON.stringify({ release: RELEASE, sourceFiles, files, apiBaseUrl: '/api' }, null, 2), { flag: 'wx' });
  } else if (action !== 'verify') throw Error('WEB_ACTION_INVALID');
  const saved = read(manifest);
  if (saved.release !== RELEASE || !same(saved.sourceFiles, sources())) throw Error('WEB_SOURCE_CHANGED');
  if (!same(saved.files, walk(path.join(OUT, 'export')))) throw Error('WEB_EXPORT_CHANGED');
  console.log('V26_WEB_MANIFEST=PASS');
}
if (require.main === module) run(process.argv[2]);
module.exports = { sources, walk, run, ROOT, OUT, RELEASE };
