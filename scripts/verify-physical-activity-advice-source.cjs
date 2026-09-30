const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const SOURCE_SHA256 = 'BE143492CB8A25A50ED08B1BE6F195ED01E4454E4C4AA3764D9828107818E07B';
const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'components/__tests__/fixtures/physical-activity-advice-20260923.json');

function staticValue(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'ArrayExpression') return node.elements.map(staticValue);
  if (node?.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(property => {
    assert.equal(property.type, 'ObjectProperty', 'Content must remain static data');
    return [property.key.name || property.key.value, staticValue(property.value)];
  }));
  throw new Error(`Unsupported advice data expression: ${node?.type}`);
}

function readAdvice(file = path.join(root, 'constants/PhysicalActivityAdvice.js')) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module' });
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.declaration?.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declaration.declarations) {
      if (declaration.id.name === 'physicalActivityAdvice') return staticValue(declaration.init);
    }
  }
  throw new Error('Missing static physicalActivityAdvice export');
}

// Reconstruct the Word paragraph order, not the storage/object-key order.
// The WHO URL is its own paragraph; the TCM source shares a paragraph with its URL.
function adviceParagraphs(content) {
  assert.equal(content.references.length, 2, 'Keep the WHO and TCM reference slots');
  return [
    content.title, content.subtitle, ...content.introduction,
    ...content.sections.flatMap(section => [section.title, ...section.paragraphs]),
    content.activityReferencesTitle, content.references[0].text, content.references[0].url,
    content.tcmTitle, ...content.tcmSections.flatMap(section => [section.title, ...section.paragraphs]),
    content.referencesTitle, content.references[1].text + content.references[1].url,
  ];
}

function verifyPhysicalActivityAdvice(advice, source = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))) {
  assert.equal(source.blocks?.length, 67, 'Expected all 67 extracted Word blocks, including blanks');
  if (source.sourceSha256) assert.equal(source.sourceSha256, SOURCE_SHA256, 'Unexpected source Word revision');
  assert.equal(source.mediaCount ?? source.media?.length, 0, 'Unexpected media in source');
  assert.equal(source.trackedChanges, 0, 'Unexpected tracked changes in source');
  assert.deepEqual(Object.keys(advice).sort(), ['en', 'zh']);
  assert.equal(advice.zh.sections.length, 3, 'The Chinese source has three activity sections');
  assert.equal(advice.en.sections.length, 4, 'The English source has four activity sections');
  assert.equal(advice.zh.tcmSections.length, 3);
  assert.equal(advice.en.tcmSections.length, 3);
  const languageBlocks = {};
  for (const [language, start, end] of [['zh', 0, 32], ['en', 32, 67]]) {
    const expected = source.blocks.slice(start, end).filter(block => block.text.trim());
    const actual = adviceParagraphs(advice[language]);
    assert.equal(actual.length, expected.length, `${language}: paragraph count differs from source`);
    actual.forEach((text, index) => {
      // Trim only Word paragraph-edge whitespace. Interior punctuation, spaces,
      // spelling, footnote numbers, and bibliographic details remain exact.
      assert.equal(text, expected[index].text.trim(), `${language}: differs at Word block ${expected[index].index ?? source.blocks.indexOf(expected[index])}`);
    });
    languageBlocks[language] = actual.length;
  }
  const urls = ['zh', 'en'].flatMap(language => advice[language].references.map(reference => reference.url));
  assert.equal(urls.length, 4, 'Each language retains both clickable references');
  assert.equal(new Set(urls).size, 2, 'Shared reference URLs must not remove language-specific entries');
  urls.forEach(url => assert.equal(new URL(url).protocol, 'https:'));
  return { sourceSha256: SOURCE_SHA256, extractedBlocks: 67, verifiedNonemptyParagraphs: languageBlocks.zh + languageBlocks.en, languageBlocks, referenceLinks: urls.length, uniqueUrls: new Set(urls).size };
}

if (require.main === module) {
  // Optional argument accepts the extraction JSON without reading the Word or
  // requiring its author-specific local path. No network requests are made.
  const source = process.argv[2] ? JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8')) : undefined;
  console.log(JSON.stringify(verifyPhysicalActivityAdvice(readAdvice(), source), null, 2));
}

module.exports = { SOURCE_SHA256, readAdvice, adviceParagraphs, verifyPhysicalActivityAdvice };
