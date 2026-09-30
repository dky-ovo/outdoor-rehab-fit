import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAdminUsabilityAudit, installQaFetchGuard, QA_ACCOUNTS, QA_PASSWORD, QA_HOST, QA_PORT } from '../local-admin-usability-audit.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t) {
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-usability-web-test-'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Local synthetic QA</title>');
  const audit = await createAdminUsabilityAudit(web);
  t.after(() => {
    audit.close();
    assert.equal(path.dirname(audit.scratch), path.join(projectRoot, 'workspace-artifacts'));
    assert.match(path.basename(audit.scratch), /^admin-usability-audit-/);
    assert.equal(path.dirname(web), path.resolve(os.tmpdir()));
    assert.match(path.basename(web), /^admin-usability-web-test-/);
    fs.rmSync(audit.scratch, { recursive: true, force: true });
    fs.rmSync(web, { recursive: true, force: true });
  });
  return audit;
}

test('audit seeds only memory-backed synthetic data and harmless local text', async t => {
  const audit = await fixture(t);
  assert.equal(audit.database.pragma('database_list')[0].file, '');
  assert.equal(audit.database.prepare('SELECT COUNT(*) n FROM users').get().n, 25);
  assert.equal(audit.database.prepare('SELECT COUNT(*) n FROM feedback').get().n, 23);
  assert.equal(audit.database.prepare('SELECT COUNT(*) n FROM app_equipment_items WHERE is_custom=1').get().n, 2);
  assert.equal(audit.database.prepare('SELECT COUNT(*) n FROM media_files').get().n, 6);
  assert.equal(audit.database.prepare('SELECT COUNT(*) n FROM media_folders').get().n, 2);
  assert.equal(audit.database.prepare("SELECT COUNT(*) n FROM users WHERE email NOT LIKE '%@example.invalid'").get().n, 0);
  for (const entry of audit.database.prepare('SELECT * FROM media_files').all()) {
    assert.equal(entry.kind, 'file');
    assert.match(fs.readFileSync(path.join(audit.scratch, 'media', entry.storage_name), 'utf8'), /Harmless synthetic text fixture/);
    assert.ok(entry.url.startsWith('/api/media/'));
  }
  assert.match(fs.readFileSync(audit.uploadSample, 'utf8'), /No personal or production/);
  const operator = audit.database.prepare('SELECT * FROM admin_accounts WHERE user_id=?').get(QA_ACCOUNTS[1].id);
  assert.equal(operator.system_role, 'operator');
  assert.deepEqual(JSON.parse(operator.permissions_json), ['app_maintenance.equipment.manage', 'feedback.read']);
  assert.deepEqual(audit.stats(), { database: 'memory', users: 25, feedback: 23, customEquipment: 2, syntheticFiles: 6, mockAiCalls: 0, externalAiCalls: 0 });
});

test('external fetch guard rejects remote AI, LAN and non-QA URLs without calling transport', async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true }; };
  const restore = installQaFetchGuard();
  try {
    for (const url of ['https://api.deepseek.com/chat/completions', 'http://192.168.1.1/', 'http://127.0.0.1:3000/api', 'https://127.0.0.1:4193/api']) {
      await assert.rejects(fetch(url), /External requests are disabled/);
    }
    assert.equal(calls, 0);
    assert.equal((await fetch(`http://${QA_HOST}:${QA_PORT}/api/health`)).ok, true);
    assert.equal(calls, 1);
  } finally { restore(); globalThis.fetch = nativeFetch; }
});

test('HTTP fixture verifies both logins, restricted permissions, fake AI and static isolation', async t => {
  const audit = await fixture(t);
  // A short-lived ephemeral test socket is not the persistent visual-QA service.
  const server = audit.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = (route, { method = 'GET', body, token, host = `${QA_HOST}:${QA_PORT}` } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const incoming = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { host, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, text, json: response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : null });
      });
    });
    incoming.on('error', reject); incoming.end(bytes);
  });
  const tokens = [];
  for (const account of QA_ACCOUNTS) {
    const login = await request('/api/auth/login', { method: 'POST', body: { identifier: account.phone, countryCode: '+852', password: QA_PASSWORD } });
    assert.equal(login.status, 200, login.text); tokens.push(login.json.token);
  }
  const [admin, operator] = tokens;
  const me = await request('/api/admin/me', { token: admin });
  assert.equal(me.json.admin.systemRole, 'super_admin');
  assert.ok(me.json.admin.permissions.includes('operators.manage'));
  assert.equal((await request('/api/admin/users', { token: admin })).status, 200);
  assert.equal((await request('/api/admin/users', { token: operator })).status, 403);
  assert.equal((await request('/api/admin/equipment', { token: operator })).status, 200);
  const feedback = await request('/api/admin/feedback', { token: operator });
  assert.equal(feedback.status, 200); assert.equal(feedback.json.pagination.total, 23);
  assert.equal((await request('/api/admin/feedback/qa-feedback-1', { method: 'PATCH', token: operator, body: { status: 'resolved', notes: '', expectedUpdatedAt: new Date().toISOString() } })).status, 403);
  assert.equal((await request('/api/admin/media-download/qa-text-1', { token: operator })).status, 403);
  const harmlessDownload = await request('/api/admin/media-download/qa-text-1', { token: admin });
  assert.equal(harmlessDownload.status, 200); assert.match(harmlessDownload.text, /Harmless synthetic/);
  const fakeAi = await request('/api/admin/ai-configuration/test', { method: 'POST', token: admin, body: {} });
  assert.equal(fakeAi.status, 200, fakeAi.text); assert.equal(audit.stats().mockAiCalls, 1); assert.equal(audit.stats().externalAiCalls, 0);
  const page = await request('/admin');
  assert.equal(page.status, 200); assert.match(page.text, /Local synthetic QA/);
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal((await request('/admin', { host: 'external.invalid' })).status, 403);
  assert.equal((await request('/api/missing')).status, 404);
});
