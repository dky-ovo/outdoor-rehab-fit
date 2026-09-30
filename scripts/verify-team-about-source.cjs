const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const sourceSha256 = '7748E292FB25556B73EF5425C171BD89533DBA990F5119497E06F78334DFE4F0';
function literal(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'ArrayExpression') return node.elements.map(literal);
  if (node?.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(p => {
    assert.equal(p.type, 'ObjectProperty');
    assert.ok(!p.computed);
    return [p.key.name || p.key.value, literal(p.value)];
  }));
  throw Error(`Unsupported roster expression: ${node?.type}`);
}
function readTeam() {
  const ast = parser.parse(fs.readFileSync(path.join(root, 'constants/OurTeam.js'), 'utf8'), { sourceType: 'module' });
  const declaration = ast.program.body.find(n => n.type === 'ExportNamedDeclaration')?.declaration?.declarations?.find(n => n.id.name === 'ourTeam');
  assert.ok(declaration, 'Static ourTeam export is required');
  return literal(declaration.init);
}
const normalized = value => value.replace(/\s+/g, ' ').trim();
function verifyTeam(team, fixture = JSON.parse(fs.readFileSync(path.join(root, 'components/__tests__/fixtures/team-about-20260924.json'), 'utf8'))) {
  assert.equal(fixture.sourceSha256, sourceSha256);
  for (const property of ['trackedChanges', 'comments', 'media']) assert.equal(fixture[property], 0);
  assert.equal(fixture.blocks.length, 18);
  for (const [language, offset] of [['en', 0], ['zh', 9]]) {
    const blocks = fixture.blocks.slice(offset, offset + 9);
    assert.equal(team[language].title, blocks[0].text);
    assert.equal(team[language].sections.length, 4);
    team[language].sections.forEach((section, index) => {
      assert.equal(section.title, blocks[1 + index * 2].text);
      const table = blocks[2 + index * 2];
      assert.equal(table.type, 'table');
      const expectedMembers = index === 0 ? table.rows[0] : index === 3
        ? table.rows[0].map((role, column) => `${role}\n${table.rows[1][column]}`)
        : table.rows.map(row => row.join('\n'));
      assert.equal(section.members.length, [2, 8, 4, 2][index]);
      section.members.forEach((member, memberIndex) => {
        const actual = ['role', 'responsibility', 'name', 'position', 'affiliation'].map(key => member[key]).filter(Boolean).join('\n');
        assert.equal(normalized(actual), normalized(expectedMembers[memberIndex]), `${language} roster differs at section ${index}, member ${memberIndex}`);
      });
    });
  }
  return { sourceSha256, languages: 2, sectionsPerLanguage: 4, membersPerLanguage: 16 };
}
if (require.main === module) console.log(JSON.stringify(verifyTeam(readTeam()), null, 2));
module.exports = { readTeam, verifyTeam };
