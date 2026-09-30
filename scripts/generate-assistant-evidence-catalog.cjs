const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'server', 'src', 'equipmentGuideEvidence.json');
const sources = new Set(['Equipments.js', 'TraditionalChineseMedicine.js', 'NewMachines.js']);
const fields = ['details', 'kinesiologyTip', 'ptTip', 'otTip', 'tcmTip', 'tcmEnabled', 'careTip'];

// Read the same three data modules as the APP. Media requires are inert stubs;
// this loader has no access to application services, credentials or databases.
function loadEquipmentTranslations() {
  const cache = new Map();
  function load(name) {
    if (!sources.has(name)) throw new Error(`Unexpected content module: ${name}`);
    if (cache.has(name)) return cache.get(name);
    const filename = path.join(root, 'constants', name);
    const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const module = { exports: {} };
    const requireContent = (request) => {
      if (/\.(?:jpe?g|png|gif|mp3|wav)$/i.test(request)) return null;
      if (/^\.\/[A-Za-z]+(?:\.js)?$/.test(request)) return load(`${path.basename(request).replace(/\.js$/, '')}.js`);
      throw new Error(`Unexpected dependency in ${name}: ${request}`);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: requireContent }, { filename, timeout: 5000 });
    cache.set(name, module.exports);
    return module.exports;
  }
  return load('Equipments.js').equipmentTranslations;
}

function generateEvidenceCatalog() {
  const translations = loadEquipmentTranslations();
  const catalog = {};
  let referenceIds;
  for (const locale of ['zh', 'en']) {
    const items = translations[locale]?.equipmentList;
    if (!Array.isArray(items) || !items.length) throw new Error(`No ${locale} equipment content`);
    const ids = items.map((item) => String(item.id)).sort((a, b) => Number(a) - Number(b));
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${locale} equipment IDs`);
    if (referenceIds && JSON.stringify(referenceIds) !== JSON.stringify(ids)) throw new Error('English and Chinese IDs differ');
    referenceIds = ids;
    for (const item of items) {
      const id = String(item.id);
      catalog[id] ||= {};
      catalog[id][locale] = Object.fromEntries(fields.map((field) => [field,
        field === 'tcmEnabled' ? Boolean(item[field]) : String(item[field] || ''),
      ]));
    }
  }
  return catalog;
}

if (require.main === module) {
  const catalog = generateEvidenceCatalog();
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  if (process.argv.slice(2).includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== serialized) {
      throw new Error('Evidence catalog is out of date. Run node scripts/generate-assistant-evidence-catalog.cjs');
    }
    process.stdout.write(`Evidence catalog matches APP content: ${Object.keys(catalog).length} equipment items, 2 languages.\n`);
  } else {
    fs.writeFileSync(target, serialized, 'utf8');
    process.stdout.write(`Generated server/src/equipmentGuideEvidence.json: ${Object.keys(catalog).length} equipment items, 2 languages.\n`);
  }
}

module.exports = { generateEvidenceCatalog };
