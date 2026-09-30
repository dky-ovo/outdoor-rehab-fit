// Build-time verifier: no downloads, no shell interpolation, no file writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const platform = process.argv[process.argv.indexOf('--platform') + 1];
const wanted = ['android', 'ios'].includes(platform) ? platform : 'all';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = path.join(root, 'native-artifacts.json');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'native-file-inventory.json'), 'utf8'));
if (hash(manifest) !== inventory.manifestSha256) throw new Error('Offline voice upstream manifest has changed. Review and prepare the pinned artifacts again.');
let count = 0;
for (const entry of inventory.files) {
  if (wanted !== 'all' && entry.platform !== 'all' && entry.platform !== wanted) continue;
  if (!/^(vendor|assets)\//.test(entry.path) || entry.path.includes('..') || entry.path.includes('\\')) throw new Error('Invalid offline artifact inventory path');
  let current = root;
  for (const segment of entry.path.split('/')) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Offline voice artifacts must not be symlinks');
  }
  if (!fs.statSync(current).isFile() || hash(current) !== entry.sha256) throw new Error(`Offline voice integrity check failed: ${entry.path}`);
  count++;
}
if (!count) throw new Error('Offline voice inventory is empty');
const licenses = JSON.parse(fs.readFileSync(path.join(root, 'licenses/sources.json'), 'utf8'));
for (const source of licenses.sources) {
  if (path.basename(source.file) !== source.file || /[\\/]/.test(source.file)) throw new Error('Invalid license path');
  const file = path.join(root, 'licenses', source.file);
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== source.size || hash(file) !== source.sha256) {
    throw new Error(`Offline voice license integrity check failed: ${source.file}`);
  }
}
for (const notice of ['LICENSE', 'NOTICES.md']) {
  if (!fs.statSync(path.join(root, notice)).isFile()) throw new Error(`Missing ${notice}`);
}
console.log(`Offline voice: ${count} ${wanted} artifact files and ${licenses.sources.length} licenses verified.`);
