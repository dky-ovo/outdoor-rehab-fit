const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../deploy/2026-09-10/install-file-storage-certbot-fix-20260910.sh'), 'utf8');

test('Certbot patch is bound to the immutable reviewed large archive and validates both packages', () => {
  assert.match(source, /EXPECTED_ORIGINAL_SHA="5573d56f81c701d657bd0dc01c9646949b20cbc4ad870e23cd53bfa1a12e47f2"/);
  assert.ok(source.indexOf('sha256sum -c patch-checksums.sha256') < source.indexOf('WORK_DIR='));
  assert.ok(source.indexOf('sha256sum -c runtime-checksums.sha256') < source.indexOf('cp "$PATCH_DIR/configure-media-upload-proxy.cjs"'));
  assert.doesNotMatch(source, /(?:zip\s+-[uf]|rm\s+-|npm\s+audit\s+fix|apt(?:-get)?\s|curl[^\n]+\|\s*(?:sudo\s+)?bash)/);
});

test('read-only TLS inspection precedes dependency installation and production mutations', () => {
  const check = source.indexOf('node "$WORK_DIR/configure-media-upload-proxy.cjs" --check');
  assert.ok(check > source.indexOf('cp "$PATCH_DIR/configure-media-upload-proxy.cjs"'));
  assert.ok(check < source.indexOf('sudo -u dukaiyu2004 npm ci'));
  assert.ok(check < source.indexOf('APP_TOUCHED=1'));
  assert.ok(check < source.lastIndexOf('systemctl stop outdoor-fit-api'));
});

test('staging remains compatible with the unchanged original path validator', () => {
  assert.match(source, /WORK_DIR="\$\(mktemp -d "\$DEPLOY_ROOT\/file-storage-bilingual-registration-20260910\.XXXXXX"\)"/);
  assert.match(source, /BACKUP_DIR=.*file-storage-certbot-fix-20260910-/);
  assert.match(source, /API_ARCHIVE="outdoor-fit-api-file-storage-bilingual-registration-20260910.tar.gz"/);
  assert.match(source, /WEB_ARCHIVE="outdoor-fit-web-file-storage-bilingual-registration-20260910.zip"/);
});

test('failure messages distinguish pre-mutation failures from actual stopped-database backup', () => {
  assert.match(source, /DATABASE_BACKED_UP=0/);
  assert.match(source, /if \[ "\$DATABASE_BACKED_UP" -eq 1 \]/);
  assert.ok(source.indexOf('DATABASE_BACKED_UP=1') > source.indexOf('cp -a "$DATABASE_PATH" "$BACKUP_DIR/database/"'));
  assert.match(source, /This attempt did not reach the stopped-database backup step/);
  assert.match(source, /Deployment stopped before replacing application files or stopping the API service/);
  assert.match(source, /This Nginx patch does not upgrade Node/);
});
