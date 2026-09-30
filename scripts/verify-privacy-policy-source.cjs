const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const SOURCE_SHA256 = '418E64A40766E1F5D16BE6F571514250799A3E56953565DC044FD700DF596E83';
const root = path.resolve(__dirname, '..');
function staticValue(node) {
  if (node?.type === 'StringLiteral' || node?.type === 'BooleanLiteral') return node.value;
  if (node?.type === 'ArrayExpression') return node.elements.map(staticValue);
  if (node?.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(p => {
    assert.equal(p.type, 'ObjectProperty');
    return [p.key.name || p.key.value, staticValue(p.value)];
  }));
  throw new Error(`Unsupported policy expression ${node?.type}`);
}
function readPolicy() {
  const ast = parser.parse(fs.readFileSync(path.join(root, 'constants/PrivacyPolicy.js'), 'utf8'), { sourceType: 'module' });
  const declaration = ast.program.body.find(s => s.type === 'ExportNamedDeclaration')?.declaration?.declarations?.find(d => d.id.name === 'privacyPolicy');
  assert.ok(declaration, 'Static policy export required');
  return staticValue(declaration.init);
}
const text = value => value.replace(/\s+/g, ' ').trim();
function verifyPrivacyPolicy(policy, source = JSON.parse(fs.readFileSync(path.join(root, 'components/__tests__/fixtures/privacy-policy-20260924.json'), 'utf8'))) {
  assert.equal(source.sourceSha256, SOURCE_SHA256);
  assert.equal(source.trackedChanges, 0);
  const markers = ['中文版', 'English Version'];
  const boundaries = markers.map(marker => source.blocks.findIndex(b => b.text === marker));
  assert.equal(boundaries[0], 0); assert.ok(boundaries[1] > boundaries[0]);
  for (const [language, start, end] of [['zh', boundaries[0] + 1, boundaries[1]], ['en', boundaries[1] + 1, source.blocks.length]]) {
    const blocks = source.blocks.slice(start, end).filter(b => b.text.trim());
    assert.equal(policy[language].title, blocks[0].text);
    const sections = [];
    for (const block of blocks.slice(1)) {
      if (block.style === 'Heading 3') sections.push({ title: block.text, blocks: [] });
      else sections.at(-1).blocks.push(block);
    }
    assert.equal(sections.length, 7);
    assert.equal(policy[language].sections.length, 7);
    sections.forEach((section, i) => {
      const actual = policy[language].sections[i];
      assert.equal(actual.title, section.title, `${language} heading ${i}`);
      assert.equal(text(actual.blocks.map(b => b.text).join('\n')), text(section.blocks.map(b => b.text).join('\n')), `${language} policy text differs in section ${i}`);
      assert.deepEqual(actual.blocks.filter(b => b.bullet).map(b => b.text), section.blocks.filter(b => b.style === 'List Paragraph').map(b => b.text), `${language} bullets differ in section ${i}`);
    });
  }
  return { sourceSha256: SOURCE_SHA256, languages: 2, sections: 14, excludedReviewerComments: source.excludedReviewerComments };
}
if (require.main === module) console.log(JSON.stringify(verifyPrivacyPolicy(readPolicy()), null, 2));
module.exports = { readPolicy, verifyPrivacyPolicy };
