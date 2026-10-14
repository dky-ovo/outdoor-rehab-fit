const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('v26 web seal rejects source changes, export changes and reuse', () => {
  const prefix = path.join(os.tmpdir(), 'outdoor-fit-v26-web-test-');
  const root = fs.mkdtempSync(prefix);
  const helper = 'scripts/exercise-video-categories-web-release-manifest-v26.cjs';
  const write = (name, content = '{}') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  try {
    for (const name of ['app.json', 'app.config.js', 'eas.json', 'package.json', 'package-lock.json', 'metro.config.js', 'server/src/exerciseVideoMetadata.js', 'server/src/assistant.js', 'server/src/assistantGuideAnswers.js', 'server/src/assistantSymptomEvidence.js', 'server/src/assistantTcm.js', 'server/src/assistantFaqKnowledge.js', 'server/src/assistantContentPolicy.js', 'server/src/assistantLanguage.js', 'server/src/equipmentCatalog.js', 'server/src/assistantBailianPolicy.js']) write(name);
    for (const name of ['app', 'components', 'hooks', 'utils', 'constants', 'contexts', 'assets', 'plugins']) fs.mkdirSync(path.join(root, name));
    write('utils/bookmarks.js', 'original');
    write(helper, fs.readFileSync(path.resolve(__dirname, '../exercise-video-categories-web-release-manifest-v26.cjs')));
    const { run } = require(path.join(root, helper));
    run('capture');
    assert.throws(() => run('capture'), /WEB_OUTPUT_ALREADY_EXISTS/);
    const output = 'workspace-artifacts/exercise-video-categories-20261012-v26-web/export/index.html';
    write(output, '<html>application</html>');
    write('utils/bookmarks.js', 'changed');
    assert.throws(() => run('seal'), /WEB_SOURCE_CHANGED_DURING_BUILD/);
    write('utils/bookmarks.js', 'original');
    run('seal'); run('verify');
    for (const name of ['server/src/assistantBailianPolicy.js', 'server/src/assistantGuideAnswers.js', 'server/src/assistantTcm.js', 'server/src/exerciseVideoMetadata.js', 'server/src/assistant.js', 'server/src/assistantSymptomEvidence.js']) {
      write(name, 'changed guide dependency');
      assert.throws(() => run('verify'), /WEB_SOURCE_CHANGED/);
      write(name);
    }
    write(output, '<html>changed</html>');
    assert.throws(() => run('verify'), /WEB_EXPORT_CHANGED/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(prefix)) && path.dirname(root) === path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
