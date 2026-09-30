const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateMerge } = require('../validate-media-deploy-paths.cjs');

test('deployment validator preserves unrelated files and rejects destination type mismatches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-deploy-validation-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, 'index.html'), 'new'); fs.writeFileSync(path.join(target, 'private'), 'retain');
  assert.doesNotThrow(() => validateMerge(source, target));
  assert.equal(fs.readFileSync(path.join(target, 'private'), 'utf8'), 'retain');
  fs.mkdirSync(path.join(target, 'index.html'));
  assert.throws(() => validateMerge(source, target), /type mismatch/);
  // This test owns a uniquely-created fixture directory and no other files.
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('media-deploy-validation-'));
  fs.rmSync(root, { recursive: true });
});
