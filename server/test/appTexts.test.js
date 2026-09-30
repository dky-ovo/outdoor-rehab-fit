import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { APP_TEXT_SCHEMA } from '../src/appTexts.js';
import { signToken } from '../src/security.js';

const SECRET = 'app-text-http-tests-only-not-a-production-secret';
const catalog = JSON.parse(fs.readFileSync(new URL('../src/appTextCatalog.json', import.meta.url), 'utf8')).items;
const plain = catalog.find(item => item.kind === 'text' && typeof item.zh === 'string' && typeof item.en === 'string' && !item.zh.includes('%{') && !item.en.includes('%{'));
const interpolation = catalog.find(item => item.key === 'copy.codeSentTo');
const urlEntry = catalog.find(item => item.kind === 'url' && item.zh && item.en);
const EDITOR = 'text-editor-private-account';
const payload = (overrides = {}) => ({ revision: 0, zh: '本地測試說明', en: 'Local test explanation', ...overrides });

test('about team roster has bilingual editable fields and authorized overrides stay separate from the app introduction', async () => fixture(async ({ list, patch, read }) => {
  const response = await list(`?group=${encodeURIComponent('关于我们（团队）')}&pageSize=50`);
  assert.equal(response.status, 200);
  const expected = catalog.filter(item => item.key.startsWith('teamInfo.'));
  assert.ok(expected.length > 40);
  assert.equal(response.data.total, expected.length);
  assert.deepEqual(response.data.items.map(item => item.key), expected.map(item => item.key));
  for (const item of response.data.items) {
    assert.equal(typeof item.zh, 'string'); assert.equal(typeof item.en, 'string');
    assert.ok(item.zh && item.en);
  }
  const key = 'teamInfo.sections.0.members.0.name';
  assert.equal((await patch(payload(), key, 'equipment-editor')).status, 403);
  assert.equal((await patch(payload(), key)).status, 200);
  assert.equal((await patch(payload({ zh: '應用程式介紹', en: 'Application introduction' }), 'copy.intro')).status, 200);
  const published = (await read()).data.overrides;
  assert.deepEqual(published[key], { zh: '本地測試說明', en: 'Local test explanation' });
  assert.deepEqual(published['copy.intro'], { zh: '應用程式介紹', en: 'Application introduction' });
  assert.equal((await patch(payload({ revision: 1, zh: null, en: null }), key)).status, 200);
  const reset = (await read()).data.overrides;
  assert.equal(reset[key], undefined);
  assert.deepEqual(reset['copy.intro'], published['copy.intro']);
}));

test('privacy policy is bilingual and editable with existing text permissions, publishes overrides and can restore defaults', async () => fixture(async ({ list, patch, read }) => {
  const response = await list(`?group=${encodeURIComponent('隐私政策声明')}&pageSize=50`);
  assert.equal(response.status, 200);
  const expected = catalog.filter(item => item.key.startsWith('privacy.'));
  assert.ok(expected.length > 20);
  assert.equal(response.data.total, expected.length);
  assert.deepEqual(response.data.items.map(item => item.key), expected.map(item => item.key));
  for (const item of response.data.items) {
    assert.equal(typeof item.zh, 'string'); assert.equal(typeof item.en, 'string');
    assert.ok(item.zh && item.en);
  }
  const key = 'privacy.sections.0.blocks.0.text';
  assert.equal((await patch(payload(), key, 'equipment-editor')).status, 403);
  const saved = await patch(payload(), key);
  assert.equal(saved.status, 200);
  assert.deepEqual((await read()).data.overrides[key], { zh: '本地測試說明', en: 'Local test explanation' });
  assert.equal((await patch(payload({ revision: 1, zh: null, en: null }), key)).status, 200);
  assert.equal((await read()).data.overrides[key], undefined);
}));

async function fixture(run) {
  let database = createDatabase(':memory:'), server;
  const tokens = {}, now = new Date().toISOString();
  const accounts = [
    [EDITOR, 'operator', ['app_maintenance.text.manage'], 1],
    ['super', 'super_admin', [], 1], ['admin', 'admin', [], 1],
    ['legacy-maintainer', 'operator', ['app_maintenance.manage'], 1],
    ['equipment-editor', 'operator', ['app_maintenance.equipment.manage'], 1],
    ['ai-editor', 'operator', ['app_maintenance.ai.manage'], 1],
    ['reader', 'operator', ['users.read', 'dashboard.read'], 1],
    ['inactive', 'operator', ['app_maintenance.text.manage'], 0],
    ['ordinary', null, [], 1], ['deleted', 'admin', [], 1],
  ];
  for (const [index, [id, role, permissions, active]] of accounts.entries()) {
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)")
      .run(id, `Test ${id}`, `+8526555000${index}`, now, now);
    if (role) database.prepare('INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, role, JSON.stringify(permissions), active, now, now);
    tokens[id] = signToken({ id, profile_role: 'staff' }, SECRET);
  }
  database.prepare("UPDATE users SET deleted_at=? WHERE id='deleted'").run(now);
  const start = async () => {
    server = createApp({ database, jwtSecret: SECRET }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  const request = async (path, { actor = null, method = 'GET', body, rawBody, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text, headers: response.headers };
  };
  const list = (query = '', actor = EDITOR) => request(`/api/admin/app-texts${query}`, { actor });
  const patch = (body = payload(), key = plain.key, actor = EDITOR) => request(`/api/admin/app-texts/${encodeURIComponent(key)}`, { method: 'PATCH', actor, body });
  const read = () => request('/api/app-texts');
  const restart = async () => {
    await stop();
    const bytes = database.serialize(); database.close();
    database = new Database(bytes); database.pragma('foreign_keys = ON'); database.exec(APP_TEXT_SCHEMA);
    await start();
  };
  try { await run({ get database() { return database; }, request, list, patch, read, restart }); }
  finally { await stop(); database.close(); }
}

test('public APP text endpoint exposes only approved overrides without admin identity', async () => fixture(async ({ read, patch, database }) => {
  const empty = await read();
  assert.equal(empty.status, 200); assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.deepEqual(empty.data, { version: 1, overrides: {} });
  assert.equal((await patch()).status, 200);
  database.prepare('INSERT INTO app_text_overrides (text_key,zh,en,revision,updated_at,updated_by) VALUES (?,?,?,?,?,?)')
    .run('__proto__', 'unapproved private row', null, 1, new Date().toISOString(), EDITOR);
  const result = await read();
  assert.deepEqual(result.data, { version: 1, overrides: { [plain.key]: { zh: '本地測試說明', en: 'Local test explanation' } } });
  assert.ok(!JSON.stringify(result.data).includes(EDITOR));
  assert.ok(!JSON.stringify(result.data).includes('unapproved private row'));
}));

test('text maintenance requires its dedicated permission and active authenticated administration', async () => fixture(async ({ list, patch, database, request }) => {
  for (const [actor, status] of [[null, 401], ['ordinary', 403], ['reader', 403], ['equipment-editor', 403], ['ai-editor', 403], ['inactive', 403], ['deleted', 401]]) {
    assert.equal((await list('', actor)).status, status, `list ${actor}`);
    assert.equal((await patch(payload(), plain.key, actor)).status, status, `patch ${actor}`);
  }
  for (const actor of [EDITOR, 'super', 'admin', 'legacy-maintainer']) assert.equal((await list('', actor)).status, 200, actor);
  for (const token of ['invalid', signToken({ id: EDITOR }, 'wrong-secret'), signToken({ id: EDITOR }, SECRET, Date.now() - 8 * 86400000)]) {
    const result = await request('/api/admin/app-texts', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 401);
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
}));

test('text permission revocation is enforced on the next request without trusting an old token', async () => fixture(async ({ list, patch, database }) => {
  assert.equal((await list()).status, 200);
  database.prepare('UPDATE admin_accounts SET permissions_json=? WHERE user_id=?').run('[]', EDITOR);
  assert.equal((await list()).status, 403); assert.equal((await patch()).status, 403);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
}));

test('admin text list provides bounded stable pagination, search, groups and empty filters', async () => fixture(async ({ list }) => {
  const first = await list(), second = await list('?page=2');
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.data.page, 1); assert.equal(first.data.pageSize, 20);
  assert.equal(first.data.total, catalog.length); assert.equal(first.data.totalPages, Math.ceil(catalog.length / 20));
  assert.equal(first.data.items.length, 20); assert.equal(second.data.items.length, 20);
  assert.equal(new Set([...first.data.items, ...second.data.items].map(item => item.key)).size, 40);
  assert.deepEqual(first.data.items.map(item => item.key), catalog.slice(0, 20).map(item => item.key));
  const bounded = (await list('?page=999999&pageSize=999999')).data;
  assert.equal(bounded.pageSize, 50); assert.ok(bounded.items.length <= bounded.pageSize);
  assert.equal(bounded.page, bounded.totalPages);
  for (const query of ['?page=-1&pageSize=-1', '?page=Infinity&pageSize=Infinity', '?page=1.5&pageSize=1.5', '?page[]=2&pageSize[]=3']) {
    const invalid = (await list(query)).data;
    assert.equal(invalid.page, 1); assert.equal(invalid.pageSize, 20); assert.equal(invalid.items.length, 20);
  }
  const group = (await list(`?group=${encodeURIComponent(plain.group)}`)).data;
  assert.equal(group.total, catalog.filter(item => item.group === plain.group).length);
  assert.ok(group.items.every(item => item.group === plain.group));
  assert.deepEqual([...first.data.groups].sort(), [...new Set(catalog.map(item => item.group))].sort());
  const empty = (await list('?search=unique-absent-catalog-text-72091')).data;
  assert.deepEqual(empty.items, []); assert.equal(empty.total, 0); assert.equal(empty.totalPages, 1); assert.equal(empty.page, 1);
}));

test('bilingual text changes preserve defaults and expose revision but never updated_by', async () => fixture(async ({ patch, list, database, read }) => {
  const result = await patch();
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  const item = result.data.item;
  assert.equal(item.key, plain.key); assert.equal(item.zh, '本地測試說明'); assert.equal(item.en, 'Local test explanation');
  assert.equal(item.defaultZh, plain.zh); assert.equal(item.defaultEn, plain.en);
  assert.equal(item.customZh, true); assert.equal(item.customEn, true); assert.equal(item.revision, 1);
  assert.ok(Number.isFinite(Date.parse(item.updatedAt)));
  const stored = database.prepare('SELECT * FROM app_text_overrides WHERE text_key=?').get(plain.key);
  assert.equal(stored.updated_by, EDITOR); assert.equal(stored.revision, 1);
  const filtered = await list('?modified=1&search=LOCAL%20TEST%20EXPLANATION');
  assert.equal(filtered.data.total, 1); assert.deepEqual(filtered.data.items[0], item);
  for (const value of [result.data, filtered.data, (await read()).data]) {
    assert.ok(!JSON.stringify(value).includes(EDITOR)); assert.ok(!JSON.stringify(value).includes('updated_by'));
  }
  const log = database.prepare("SELECT * FROM system_logs WHERE action='app_text.update'").get();
  assert.equal(log.target_id, plain.key); assert.equal(log.actor_user_id, EDITOR);
  assert.deepEqual(JSON.parse(log.metadata_json), { revision: 1, restored: false });
  assert.ok(!log.metadata_json.includes(item.zh)); assert.ok(!log.metadata_json.includes(item.en));
}));

test('per-language null restores defaults and restoring both keeps conflict history without publishing defaults', async () => fixture(async ({ patch, read, list, database }) => {
  await patch();
  const half = await patch(payload({ revision: 1, zh: null }));
  assert.equal(half.status, 200); assert.equal(half.data.item.zh, plain.zh); assert.equal(half.data.item.customZh, false);
  assert.equal(half.data.item.en, 'Local test explanation'); assert.equal(half.data.item.customEn, true);
  assert.deepEqual((await read()).data.overrides, { [plain.key]: { en: 'Local test explanation' } });
  const reset = await patch({ revision: 2, zh: null, en: null });
  assert.equal(reset.status, 200); assert.equal(reset.data.item.revision, 3);
  assert.equal(reset.data.item.zh, plain.zh); assert.equal(reset.data.item.en, plain.en);
  assert.deepEqual((await read()).data.overrides, {}); assert.equal((await list('?modified=1')).data.total, 0);
  assert.equal(database.prepare('SELECT revision FROM app_text_overrides WHERE text_key=?').get(plain.key).revision, 3);
  assert.equal((await patch()).status, 409);
  assert.deepEqual(JSON.parse(database.prepare("SELECT metadata_json FROM system_logs WHERE action='app_text.update' ORDER BY rowid DESC").get().metadata_json), { revision: 3, restored: true });
}));

test('overrides and revision survive reopening serialized SQLite and restarting the API', async () => fixture(async ({ patch, restart, list, read }) => {
  assert.equal((await patch()).status, 200);
  await restart();
  const stored = (await list('?modified=1')).data.items[0];
  assert.equal(stored.key, plain.key); assert.equal(stored.revision, 1); assert.equal(stored.zh, '本地測試說明');
  assert.equal((await read()).data.overrides[plain.key].en, 'Local test explanation');
  assert.equal((await patch()).status, 409);
  assert.equal((await patch({ revision: 1, zh: null, en: null })).status, 200);
}));

test('blank, control, oversize, missing and unexpected fields cannot overwrite existing text', async () => fixture(async ({ patch, database }) => {
  const invalid = [null, [], {}, { revision: 0, zh: 'text' }, { revision: 0, en: 'text' },
    ...['', ' \n\t ', 5, false, {}, [], 'bad\u0000value', 'bad\u007fvalue', 'x'.repeat(20001)].map(zh => payload({ zh })),
    ...[-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(revision => payload({ revision })),
    payload({ en: ' ' }), payload({ en: 'x'.repeat(20001) }), payload({ en: 12 }),
    payload({ unknown: 'private' }), payload({ updated_by: 'forged' }), payload({ defaultZh: 'forged' }),
  ];
  for (const body of invalid) {
    const result = await patch(body);
    assert.equal(result.status, 400, JSON.stringify(body)?.slice(0, 100)); assert.equal(result.data.error, 'invalidAppText');
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM system_logs WHERE action='app_text.update'").get().n, 0);
  assert.equal((await patch(payload({ zh: '有效\n多行\t文字', en: 'x'.repeat(20000) }))).status, 200);
  assert.equal((await patch(payload({ revision: 1, zh: '' }))).status, 400);
  const stored = database.prepare('SELECT zh,en,revision FROM app_text_overrides WHERE text_key=?').get(plain.key);
  assert.deepEqual(stored, { zh: '有效\n多行\t文字', en: 'x'.repeat(20000), revision: 1 });
}));

test('malformed and excessive JSON returns bounded validation errors without reflecting submitted contents', async () => fixture(async ({ request, database }) => {
  const route = `/api/admin/app-texts/${encodeURIComponent(plain.key)}`;
  const malformed = await request(route, { actor: EDITOR, method: 'PATCH', rawBody: '{"revision":0,"zh":"private malformed text"' });
  assert.equal(malformed.status, 400); assert.deepEqual(malformed.data, { error: 'invalidAppText' });
  const excessive = await request(route, { actor: EDITOR, method: 'PATCH', body: payload({ zh: 'x'.repeat(140000) }) });
  assert.equal(excessive.status, 413); assert.deepEqual(excessive.data, { error: 'invalidAppText' });
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
}));

test('placeholder names and counts are preserved in both languages while order can change', async () => fixture(async ({ patch }) => {
  const valid = { revision: 0, zh: '%{target}：已發送到%{channel}', en: '%{target}: sent to %{channel}' };
  assert.ok(interpolation);
  for (const changed of [
    { zh: '沒有變量' }, { en: 'Sent to %{channel}' }, { zh: '%{target} %{channel} %{channel}' },
    { en: '%{target} %{wrong}' }, { zh: '%{target} %{channel} %{new}' },
  ]) assert.equal((await patch({ ...valid, ...changed }, interpolation.key)).status, 400);
  const result = await patch(valid, interpolation.key);
  assert.equal(result.status, 200); assert.equal(result.data.item.zh, valid.zh); assert.equal(result.data.item.en, valid.en);
}));

test('reference links accept HTTPS only and never credentials or executable schemes', async () => fixture(async ({ patch, database }) => {
  for (const link of ['http://example.org/', 'javascript:alert(1)', 'data:text/html,<script/>', '//example.org/', 'file:///test', 'https://user:password@example.org/', 'https://user@example.org/', 'not a url', `https://example.org/${'a'.repeat(2049)}`]) {
    assert.equal((await patch({ revision: 0, zh: link, en: urlEntry.en }, urlEntry.key)).status, 400, link.slice(0, 70));
  }
  const result = await patch({ revision: 0, zh: 'https://example.org/reference?language=zh#section', en: 'https://example.org/reference?language=en' }, urlEntry.key);
  assert.equal(result.status, 200);
  assert.equal(database.prepare('SELECT zh FROM app_text_overrides WHERE text_key=?').get(urlEntry.key).zh, result.data.item.zh);
}));

test('unknown keys and prototype-shaped input cannot create arbitrary text records', async () => fixture(async ({ patch, request, database }) => {
  for (const key of ['unknown', '__proto__', 'constructor', 'prototype', 'copy.__proto__.polluted', 'copy.constructor.prototype']) {
    const result = await patch(payload(), key); assert.equal(result.status, 404); assert.equal(result.data.error, 'appTextNotFound');
  }
  const result = await request(`/api/admin/app-texts/${encodeURIComponent(plain.key)}`, { actor: EDITOR, method: 'PATCH', rawBody: '{"revision":0,"zh":"text","en":"text","__proto__":{"polluted":true}}' });
  assert.equal(result.status, 400); assert.equal(result.data.error, 'invalidAppText');
  assert.equal({}.polluted, undefined);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
}));

test('simultaneous editors cannot overwrite each other and a fresh revision permits a deliberate update', async () => fixture(async ({ patch, list, database }) => {
  const responses = await Promise.all([patch(payload({ zh: '第一份' })), patch(payload({ zh: '第二份' }))]);
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
  const winner = responses.find(result => result.status === 200).data.item;
  assert.equal((await list('?modified=1')).data.items[0].zh, winner.zh);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM system_logs WHERE action='app_text.update'").get().n, 1);
  assert.equal((await patch(payload({ revision: 1, zh: '確認後修改' }))).status, 200);
  assert.equal((await list('?modified=1')).data.items[0].revision, 2);
}));

test('a catalog language without a default remains absent unless explicitly supported', async () => fixture(async ({ patch, read }) => {
  const sparse = catalog.find(item => item.zh !== null && item.en === null);
  assert.ok(sparse);
  assert.equal((await patch({ revision: 0, zh: '更新已存在的中文', en: null }, sparse.key)).status, 200);
  assert.equal((await patch({ revision: 1, zh: '更新已存在的中文', en: 'Do not invent an absent content slot' }, sparse.key)).status, 400);
  assert.deepEqual((await read()).data.overrides[sparse.key], { zh: '更新已存在的中文' });
}));

test('audit-log storage failure rolls back text and revision before allowing a later retry', async (t) => fixture(async ({ database, patch, read }) => {
  t.mock.method(console, 'error', () => {});
  database.exec("CREATE TRIGGER fail_app_text_audit BEFORE INSERT ON system_logs WHEN NEW.action='app_text.update' BEGIN SELECT RAISE(ABORT,'app text audit storage unavailable'); END");
  assert.equal((await patch()).status, 500);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
  assert.deepEqual((await read()).data.overrides, {});
  database.exec('DROP TRIGGER fail_app_text_audit');
  const retried = await patch();
  assert.equal(retried.status, 200); assert.equal(retried.data.item.revision, 1);
}));
