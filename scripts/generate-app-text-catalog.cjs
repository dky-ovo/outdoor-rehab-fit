const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(name) {
  if (name === 'Equipments') return { equipmentTranslations: { zh: {}, en: {} } };
  if (!['Languages', 'LoginLanguages', 'UpgradeLanguages', 'PhysicalActivityAdvice', 'PrivacyPolicy', 'OurTeam'].includes(name)) throw Error(`Unexpected data module ${name}`);
  if (cache.has(name)) return cache.get(name);
  const filename = path.join(root, 'constants', `${name}.js`);
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: request => load(request.replace(/^\.\//, '').replace(/\.js$/, '')) }, { filename, timeout: 5000 });
  cache.set(name, module.exports); return module.exports;
}
function leaves(value, prefix = '', output = {}) {
  if (typeof value === 'string') output[prefix] = value;
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key, output));
  return output;
}
function groupFor(key) {
  if (/^(intro$|team$|disclaimer$|setting|about|contact|privacy|profile|password|username|image|camera)/i.test(key)) return '设置、联络与关于';
  if (/^(questionnaire|safety|sprm|parq|agree|disagree|risk)/i.test(key)) return '风险管理与首次使用';
  if (/(goal|smart|target)/i.test(key)) return '目标设置与说明';
  if (/(assistant|chat|conversation|speech|voice|tcm)/i.test(key)) return 'AI 助手';
  if (/(session|timer|countdown|countup|mood|effort|exercise|duration)/i.test(key)) return '计时、运动记录与总结';
  if (/(participant|usage|statistics|volunteer|staff|research)/i.test(key)) return '参与者与使用数据';
  if (/(^auth\.|login|register|guest|sms|phone|country|verification|invite|code|logout)/i.test(key)) return '登录、注册与访客';
  if (/(equipment|outdoor|facility|location|map|favorite|audio|video|practice|tip)/i.test(key)) return '设施教学与地图';
  return '通用、主页与导航';
}
const entries = new Map();
function add(entry) {
  const old = entries.get(entry.key);
  if (old && (old.zh !== entry.zh || old.en !== entry.en)) throw Error(`Conflicting defaults for ${entry.key}`);
  if (old) { old.sources = [...new Set([...old.sources, ...entry.sources])]; return; }
  entries.set(entry.key, entry);
}
function dataset(prefix, data, group) {
  const zh = leaves(data.zh), en = leaves(data.en);
  for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
    // Runtime/data-source configuration is deliberately not a text editor.
    if (prefix === 'copy' && /(?:^|\.)(?:url|uri|id|route|key)$/i.test(key)) continue;
    const label = prefix === 'copy' && key === 'intro' ? '关于此程序：程序介绍' : prefix === 'copy' && key === 'team' ? '旧版团队介绍（仅旧版 APP 使用）' : (zh[key] || en[key] || key).split('\n')[0].slice(0, 72);
    add({ key: `${prefix}.${key}`, group: group || groupFor(key), label, kind: /(?:^|\.)url$/.test(key) ? 'url' : 'text', zh: zh[key] ?? null, en: en[key] ?? null, sources: [prefix === 'copy' ? 'APP 双语文字' : prefix === 'privacy' ? '隐私政策声明' : prefix === 'teamInfo' ? '关于我们（团队）' : '体能活动建议'] });
  }
}
dataset('copy', load('Languages').translations);
dataset('activity', load('PhysicalActivityAdvice').physicalActivityAdvice, '体能活动建议与文献');
dataset('privacy', load('PrivacyPolicy').privacyPolicy, '隐私政策声明');
dataset('teamInfo', load('OurTeam').ourTeam, '关于我们（团队）');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.name === '__tests__' ? [] : item.isDirectory() ? walk(path.join(directory, item.name)) : /\.[jt]sx?$/.test(item.name) ? [path.join(directory, item.name)] : []);
}
for (const file of [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')), ...walk(path.join(root, 'utils'))]) {
  if (/[/\\]Admin|[/\\]admin\.js$|[/\\]appText\.js$/.test(file)) continue;
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  traverse(ast, { CallExpression(p) {
    if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 'appText') return;
    const [, key, defaults] = p.node.arguments;
    if (key?.type !== 'StringLiteral' || defaults?.type !== 'ObjectExpression') return;
    const values = {};
    for (const prop of defaults.properties) if (prop.type === 'ObjectProperty' && prop.value.type === 'StringLiteral') values[prop.key.name || prop.key.value] = prop.value.value;
    if (!('zh' in values) || !('en' in values)) throw Error(`Both languages required: ${key.value}`);
    const source = path.relative(root, file).replace(/\\/g, '/');
    add({ key: key.value, group: groupFor(key.value.replace(/^inline\./, '')), label: values.zh.split('\n')[0].slice(0, 72), kind: /Url$/.test(key.value) ? 'url' : 'text', zh: values.zh, en: values.en, sources: [source] });
  } });
}
const catalog = { version: 1, items: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key, 'en')) };
const data = JSON.stringify(catalog, null, 2) + '\n';
for (const output of ['constants/AppTextCatalog.json', 'server/src/appTextCatalog.json']) {
  if (process.argv.includes('--check')) { if (fs.readFileSync(path.join(root, output), 'utf8') !== data) throw Error(`Regenerate stale text catalog: ${output}`); }
  else fs.writeFileSync(path.join(root, output), data, 'utf8');
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${catalog.items.length} editable bilingual text entries (no equipment/user data).`);
