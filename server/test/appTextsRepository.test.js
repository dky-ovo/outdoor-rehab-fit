import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { APP_TEXT_SCHEMA, registerAppTexts } from '../src/appTexts.js';
import { AppTextConflictError, createAppTextsRepository } from '../src/appTextsRepository.js';
import { createMysqlDatabase } from '../src/mysqlDatabase.js';
import { writeSystemLog } from '../src/systemLog.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/appTextCatalog.json', import.meta.url), 'utf8')).items;
const entry = catalog.find(item => item.kind === 'text' && item.zh && item.en && !item.zh.includes('%{') && !item.en.includes('%{'));
const input = (changes = {}) => ({ key: entry.key, zh: "中文 ' quote \\ text", en: 'English text', revision: 0,
  updatedAt: '2026-09-24T00:00:00.000Z', updatedBy: 'synthetic-editor', ...changes });
const body = (changes = {}) => ({ revision: 0, zh: '中文測試', en: 'English test', ...changes });
const waitTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function sqlite(t) {
  const database = new Database(':memory:');
  t.after(() => database.close());
  database.exec(APP_TEXT_SCHEMA);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT,phone TEXT,email TEXT,profile_role TEXT,
      avatar_data TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE admin_accounts (user_id TEXT PRIMARY KEY,system_role TEXT,permissions_json TEXT,
      is_active INTEGER,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE system_logs (id TEXT PRIMARY KEY,actor_user_id TEXT,actor_role TEXT,action TEXT,
      target_type TEXT,target_id TEXT,created_at TEXT,ip_address TEXT,metadata_json TEXT);
    INSERT INTO users (id,name,profile_role) VALUES ('synthetic-editor','Synthetic','staff');
    INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active)
      VALUES ('synthetic-editor','operator','["app_maintenance.text.manage"]',1);
  `);
  return database;
}

// Driver injection exercises the real async adapter/ALS and HTTP handlers. The
// SQL store is SQLite; this is not an InnoDB concurrency or live RDS test.
function injectedMysql(t, options = {}) {
  const store = sqlite(t), events = [], calls = [];
  const connection = {
    async query() { return [[], []]; },
    async beginTransaction() { events.push('begin'); store.exec('BEGIN'); },
    async execute(sql, values) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: compact, values });
      const kind = /^SELECT .* FROM users /.test(compact) ? 'user-lock'
        : /^SELECT .* FROM admin_accounts /.test(compact) ? 'admin-lock'
        : /^INSERT INTO system_logs /.test(compact) ? 'audit'
        : /^INSERT INTO app_text_overrides /.test(compact) ? 'insert'
        : /^UPDATE app_text_overrides /.test(compact) ? 'update'
        : /WHERE text_key=\?/.test(compact) ? 'get' : 'all';
      events.push(kind);
      await options.beforeExecute?.({ kind, sql: compact, values, store });
      const statement = store.prepare(compact.replace(/ FOR UPDATE$/, ''));
      if (/^SELECT /.test(compact)) {
        let rows = statement.all(...values);
        if (options.rows) rows = options.rows(rows, kind);
        else rows = rows.map(row => 'revision' in row ? { ...row, revision: String(row.revision) } : row);
        return [rows, []];
      }
      try {
        const result = statement.run(...values);
        return [{ affectedRows: result.changes, insertId: Number(result.lastInsertRowid), warningStatus: options.warningStatus ?? 0 }, []];
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') error.code = 'ER_DUP_ENTRY';
        throw error;
      }
    },
    async commit() {
      events.push('commit'); store.exec('COMMIT');
      if (options.commitUnknown) throw Object.assign(new Error('synthetic lost reply'), { code: 'ECONNRESET' });
    },
    async rollback() { events.push('rollback'); store.exec('ROLLBACK'); },
    release() { events.push('release'); },
    destroy() { events.push('destroy'); },
  };
  const database = createMysqlDatabase({ ssl: { ca: 'synthetic-ca', rejectUnauthorized: true, verifyIdentity: true } }, {
    poolFactory: () => ({ async getConnection() { return connection; }, async end() {} }),
  });
  t.after(() => database.close());
  return { database, store, events, calls, repository: createAppTextsRepository(database) };
}

function seed(store, revision = 1) {
  store.prepare('INSERT INTO app_text_overrides VALUES (?,?,?,?,?,?)')
    .run(entry.key, 'old zh', 'old en', revision, 'previous', 'synthetic-editor');
}

function hooks(fixture, changes = {}) {
  return {
    async authorize() {
      assert.equal(fixture.database.inTransaction, true);
      fixture.events.push('authorize'); await waitTurn(); fixture.events.push('authorized');
    },
    async audit() {
      assert.equal(fixture.database.inTransaction, true);
      fixture.events.push('audit-start'); await waitTurn(); fixture.events.push('audit-done');
    },
    ...changes,
  };
}

test('SQLite repository keeps reads and immediate write hooks synchronous and atomic', (t) => {
  const database = sqlite(t), repository = createAppTextsRepository(database), events = [];
  const checks = {
    authorize() { assert.equal(database.inTransaction, true); events.push('authorize'); },
    audit() { assert.equal(database.inTransaction, true); events.push('audit'); },
  };
  const result = repository.update(input(), checks);
  assert.ok(!(result instanceof Promise));
  assert.equal(result.revision, 1);
  assert.deepEqual(events, ['authorize', 'audit']);
  assert.equal(repository.listAll()[0].zh, input().zh);
  assert.equal(repository.listPublic()[0].text_key, entry.key);
  assert.throws(() => repository.update(input({ revision: 1 }), { ...checks, audit() { throw new Error('synthetic audit failure'); } }), /audit failure/);
  assert.equal(repository.listAll()[0].revision, 1);
  for (const hook of ['authorize', 'audit']) {
    assert.throws(() => repository.update(input({ revision: 1 }), { ...checks, [hook]: () => Promise.resolve() }), /must be synchronous/);
    assert.equal(repository.listAll()[0].revision, 1);
  }
});

test('MySQL repository awaits authorization, bound insert, audit and readback before COMMIT', async (t) => {
  const f = injectedMysql(t);
  const result = await f.repository.update(input(), hooks(f));
  assert.equal(result.revision, 1);
  assert.equal(result.zh, input().zh);
  assert.deepEqual(f.events, ['begin', 'authorize', 'authorized', 'get', 'insert', 'audit-start', 'audit-done', 'get', 'commit', 'release']);
  const insert = f.calls.find(call => /^INSERT/.test(call.sql));
  assert.deepEqual(insert.values, [entry.key, input().zh, input().en, 1, input().updatedAt, input().updatedBy]);
  assert.doesNotMatch(insert.sql, /IGNORE|ON DUPLICATE|ON CONFLICT|中文/);
  assert.equal((await f.repository.listAll())[0].revision, 1);
});

test('MySQL stale revision and a conditional UPDATE that loses its race roll back without audit', async (t) => {
  const f = injectedMysql(t, { beforeExecute({ kind, store }) {
    if (kind === 'update') store.prepare('UPDATE app_text_overrides SET revision=revision+1').run();
  } });
  seed(f.store, 1);
  await assert.rejects(f.repository.update(input(), hooks(f)), AppTextConflictError);
  assert.equal(f.calls.some(call => /^UPDATE|^INSERT/.test(call.sql)), false);
  f.events.length = 0;
  await assert.rejects(f.repository.update(input({ revision: 1 }), hooks(f)), AppTextConflictError);
  assert.deepEqual(f.events.slice(-3), ['update', 'rollback', 'release']);
  const update = f.calls.find(call => /^UPDATE/.test(call.sql));
  assert.match(update.sql, /WHERE text_key=\? AND revision=\?$/);
  assert.deepEqual(update.values.slice(-2), [entry.key, 1]);
  assert.equal(f.events.includes('audit-start'), false);
  assert.equal(f.store.prepare('SELECT revision FROM app_text_overrides').get().revision, 1);
});

test('MySQL first-insert duplicate is a conflict after rollback and never retries', async (t) => {
  const f = injectedMysql(t, { beforeExecute({ kind }) {
    if (kind === 'insert') throw Object.assign(new Error('synthetic simultaneous first insert'), { code: 'ER_DUP_ENTRY' });
  } });
  await assert.rejects(f.repository.update(input(), hooks(f)), AppTextConflictError);
  assert.deepEqual(f.events.slice(-3), ['insert', 'rollback', 'release']);
  assert.equal(f.calls.filter(call => /^INSERT/.test(call.sql)).length, 1);
  assert.equal(f.events.includes('audit-start'), false);
});

test('MySQL audit failure rolls back data; unrelated insert and audit errors are never conflicts', async (t) => {
  const f = injectedMysql(t);
  for (const code of ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'SYNTHETIC_AUDIT_FAILURE']) {
    await assert.rejects(f.repository.update(input(), hooks(f, {
      async audit() { await waitTurn(); throw Object.assign(new Error('synthetic audit failure'), { code }); },
    })), error => !(error instanceof AppTextConflictError) && error.code === code);
    assert.equal(f.store.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
    assert.equal(f.events.at(-2), 'rollback');
  }
  const g = injectedMysql(t, { beforeExecute({ kind }) {
    if (kind === 'insert') throw Object.assign(new Error('synthetic lost connection'), { code: 'ECONNRESET', fatal: true });
  } });
  await assert.rejects(g.repository.update(input(), hooks(g)), { code: 'ECONNRESET' });
  assert.equal(g.events.at(-1), 'destroy');
  assert.equal(g.calls.filter(call => /^INSERT/.test(call.sql)).length, 1);
});

test('MySQL uncertain COMMIT stays uncertain with no rollback or automatic retry', async (t) => {
  const f = injectedMysql(t, { commitUnknown: true });
  await assert.rejects(f.repository.update(input(), hooks(f)), { code: 'MYSQL_COMMIT_OUTCOME_UNKNOWN' });
  assert.deepEqual(f.events.slice(-2), ['commit', 'destroy']);
  assert.equal(f.events.includes('rollback'), false);
  assert.equal(f.events.filter(event => event === 'insert').length, 1);
  assert.equal(f.store.prepare('SELECT revision FROM app_text_overrides').get().revision, 1);
});

test('MySQL write warnings roll back without audit or conflict masking', async (t) => {
  const f = injectedMysql(t, { warningStatus: 1 });
  await assert.rejects(f.repository.update(input(), hooks(f)), { code: 'APP_TEXT_WRITE_FAILED' });
  assert.equal(f.events.includes('audit-start'), false);
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
  assert.equal(f.store.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
});

test('MySQL BIGINT revisions normalize exactly and unsafe or noncanonical stored values fail closed', async (t) => {
  for (const value of [0, '0', 0n, 1, '1', 1n, Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER)]) {
    const f = injectedMysql(t, { rows: rows => rows.map(row => ({ ...row, revision: value })) });
    seed(f.store);
    assert.equal((await f.repository.listAll())[0].revision, Number(value));
  }
  for (const value of [null, undefined, -1, '-1', '01', '1.0', '', true, 1.5, '9007199254740992', 9007199254740992n]) {
    const f = injectedMysql(t, { rows: rows => rows.map(row => ({ ...row, revision: value })) });
    seed(f.store);
    await assert.rejects(f.repository.listAll(), { code: 'APP_TEXT_REVISION_INVALID' });
    await assert.rejects(f.repository.update(input(), hooks(f)), { code: 'APP_TEXT_REVISION_INVALID' });
    assert.equal(f.events.includes('insert') || f.events.includes('update'), false);
  }
  const f = injectedMysql(t);
  seed(f.store, Number.MAX_SAFE_INTEGER - 1);
  assert.equal((await f.repository.update(input({ revision: Number.MAX_SAFE_INTEGER - 1 }), hooks(f))).revision, Number.MAX_SAFE_INTEGER);
  await assert.rejects(f.repository.update(input({ revision: Number.MAX_SAFE_INTEGER }), hooks(f)), /Invalid app text write/);
  await assert.rejects(f.repository.update({ ...input(), extra: 'unexpected' }, hooks(f)), /Invalid app text write/);
});

async function httpFixture(t, options = {}) {
  const f = injectedMysql(t, options), app = express();
  app.use(express.json());
  const requirePermission = permission => (request, _response, next) => {
    assert.equal(permission, 'app_maintenance.text.manage');
    request.admin = { user: { id: 'synthetic-editor' }, account: { system_role: 'operator' } };
    next();
  };
  registerAppTexts({ app, database: f.database, requirePermission, writeSystemLog });
  app.use((error, _request, response, _next) => {
    response.status(error.authorizationError ? error.status : 500)
      .json({ error: error.authorizationError || 'internalServerError' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = async (path, method = 'GET', data) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      ...(data !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
  };
  return { ...f, request, patch: (data = body(), key = entry.key) => request(`/api/admin/app-texts/${encodeURIComponent(key)}`, 'PATCH', data) };
}

test('injected MySQL HTTP reads wait for rows and retain public allowlist, locale and pagination contracts', async (t) => {
  const gate = deferred(), entered = deferred();
  const f = await httpFixture(t, { async beforeExecute({ kind }) {
    if (kind === 'all') { entered.resolve(); await gate.promise; }
  } });
  seed(f.store, 7);
  f.store.prepare('INSERT INTO app_text_overrides VALUES (?,?,?,?,?,?)').run('__proto__', 'private', null, 1, 'private', 'private');
  let finished = false;
  const pending = f.request('/api/app-texts').then(value => { finished = true; return value; });
  await entered.promise;
  assert.equal(finished, false);
  gate.resolve();
  const result = await pending;
  assert.equal(result.cache, 'no-store');
  assert.deepEqual(result.data, { version: 1, overrides: { [entry.key]: { zh: 'old zh', en: 'old en' } } });
  const listing = await f.request('/api/admin/app-texts?modified=1&pageSize=1000');
  assert.equal(listing.data.pageSize, 50);
  assert.equal(listing.data.total, 1);
  assert.equal(listing.data.items[0].revision, 7);
  assert.equal(listing.data.items[0].defaultZh, entry.zh);
  assert.equal(JSON.stringify(listing.data).includes('synthetic-editor'), false);
});

test('injected MySQL HTTP writes lock and revalidate current admin, await audit and commit, and preserve restores', async (t) => {
  const gate = deferred(), entered = deferred();
  const f = await httpFixture(t, { async beforeExecute({ kind }) {
    if (kind === 'audit') { entered.resolve(); await gate.promise; }
  } });
  let finished = false;
  const pending = f.patch().then(value => { finished = true; return value; });
  await entered.promise;
  assert.equal(finished, false);
  assert.equal(f.events.includes('commit'), false);
  gate.resolve();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.data.item.revision, 1);
  assert.deepEqual(f.events, ['begin', 'user-lock', 'admin-lock', 'get', 'insert', 'audit', 'get', 'commit', 'release']);
  assert.ok(f.calls.filter(call => /FROM (users|admin_accounts) /.test(call.sql)).every(call => call.sql.endsWith(' FOR UPDATE')));
  const log = f.store.prepare('SELECT * FROM system_logs').get();
  assert.equal(log.actor_user_id, 'synthetic-editor');
  assert.deepEqual(JSON.parse(log.metadata_json), { revision: 1, restored: false });
  assert.equal(log.metadata_json.includes(body().zh), false);
  assert.equal((await f.patch(body())).status, 409);
  const restored = await f.patch(body({ revision: 1, zh: null, en: null }));
  assert.equal(restored.status, 200);
  assert.equal(restored.data.item.zh, entry.zh);
  assert.equal(restored.data.item.revision, 2);
  assert.deepEqual((await f.request('/api/app-texts')).data.overrides, {});
});

test('injected MySQL HTTP rejects changed admin state inside transaction with no text or audit write', async (t) => {
  for (const [sql, status, code] of [
    ["UPDATE admin_accounts SET permissions_json='[]'", 403, 'permissionDenied'],
    ['UPDATE admin_accounts SET is_active=0', 403, 'adminRequired'],
    ["UPDATE users SET deleted_at='deleted'", 401, 'accountDeleted'],
  ]) {
    const f = await httpFixture(t, { beforeExecute({ kind, store }) { if (kind === 'user-lock') store.exec(sql); } });
    const result = await f.patch();
    assert.equal(result.status, status);
    assert.equal(result.data.error, code);
    assert.equal(f.events.includes('get') || f.events.includes('insert') || f.events.includes('audit'), false);
    assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
  }
});

test('injected MySQL HTTP preserves validation and maps only the first INSERT duplicate to conflict', async (t) => {
  const f = await httpFixture(t, { beforeExecute({ kind }) {
    if (kind === 'insert') throw Object.assign(new Error('synthetic first insert race'), { code: 'ER_DUP_ENTRY' });
  } });
  for (const invalid of [body({ extra: true }), body({ revision: '0' }), body({ revision: Number.MAX_SAFE_INTEGER }), body({ zh: '' }), { revision: 0, zh: 'missing en' }]) {
    assert.equal((await f.patch(invalid)).status, 400);
  }
  assert.equal((await f.patch(body(), 'unknown.key')).status, 404);
  const tokenKey = catalog.find(item => item.kind === 'text' && item.zh?.includes('%{'));
  assert.equal((await f.patch(body(), tokenKey.key)).status, 400);
  const urlKey = catalog.find(item => item.kind === 'url' && item.zh && item.en);
  assert.equal((await f.patch(body({ zh: 'http://example.test', en: urlKey.en }), urlKey.key)).status, 400);
  assert.equal(f.events.length, 0);
  const result = await f.patch();
  assert.equal(result.status, 409);
  assert.deepEqual(result.data, { error: 'appTextConflict' });
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
  assert.equal(f.events.filter(event => event === 'insert').length, 1);
});

test('injected MySQL HTTP audit failure rolls back and returns a bounded error without SQL or text', async (t) => {
  const f = await httpFixture(t, { beforeExecute({ kind }) {
    if (kind === 'audit') throw Object.assign(new Error('synthetic private SQL and text'), { code: 'ER_DUP_ENTRY' });
  } });
  const result = await f.patch();
  assert.equal(result.status, 500);
  assert.deepEqual(result.data, { error: 'internalServerError' });
  assert.equal(f.store.prepare('SELECT COUNT(*) AS n FROM app_text_overrides').get().n, 0);
  assert.equal(f.store.prepare('SELECT COUNT(*) AS n FROM system_logs').get().n, 0);
  assert.equal(f.events.filter(event => event === 'insert').length, 1);
});
