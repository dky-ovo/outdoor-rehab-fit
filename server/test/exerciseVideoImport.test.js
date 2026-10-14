import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createApp } from '../src/app.js';
import { createMysqlApp } from '../src/appMysql.js';
import { createDatabase } from '../src/database.js';
import { signToken } from '../src/security.js';

const KEY = '92f01f12-c837-4cc1-a65e-0f03dd17f424';
const VIDEO = '/api/media/a/a.mp4';
const INPUT = { pageKey: 'exercise_videos', contentType: 'video', title: '坐姿伸展', value: VIDEO, sortOrder: 8, isActive: true, clientRequestId: KEY };

async function fixture(t, dialect) {
  const sqlite = createDatabase(':memory:');
  const now = new Date().toISOString(), secret = 'synthetic-video-import-signing-secret';
  const tokens = {};
  for (const [n, actor] of ['editor', 'other', 'viewer'].entries()) {
    sqlite.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at,last_seen_at) VALUES(?,?,?,'staff','salt','hash',?,?,?)")
      .run(actor, actor, '+8526999090' + n, now, now, now);
    if (actor !== 'viewer') sqlite.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES(?,'operator',?,1,?,?)")
      .run(actor, JSON.stringify(['app_maintenance.home.manage']), now, now);
    tokens[actor] = signToken({ id: actor, profile_role: 'staff' }, secret);
  }
  sqlite.exec('ALTER TABLE media_files ADD COLUMN __url_sha256 BLOB');
  for (const [id, kind, archived, deleted] of [['a','video',0,null],['b','video',1,null],['c','video',0,now],['d','image',0,null]]) {
    const url = `/api/media/${id}/${id}.mp4`;
    sqlite.prepare("INSERT INTO media_files(id,url,name,storage_name,mime_type,kind,category_id,source,archived,deleted_at,created_at,updated_at,__url_sha256) VALUES(?,?,?,?,?,?,'videos','upload',?,?,?,?,?)")
      .run(id, url, '坐姿伸展.mp4', id + '.mp4', kind === 'video' ? 'video/mp4' : 'image/png', kind, archived, deleted, now, now, crypto.createHash('sha256').update(url).digest());
  }
  let database = sqlite;
  if (dialect === 'mysql') {
    const context = new AsyncLocalStorage(); let queue = Promise.resolve();
    const clean = sql => sql.replace(/ FOR (?:UPDATE|SHARE)\b/g, '');
    const execute = async fn => { if (!context.getStore()) await queue; return fn(); };
    database = {
      dialect: 'mysql', get inTransaction() { return Boolean(context.getStore()); },
      get: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).get(...values)),
      all: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).all(...values)),
      run: (sql, values = []) => execute(() => ({ affectedRows: sqlite.prepare(clean(sql)).run(...values).changes, warningStatus: 0 })),
      transaction(fn) {
        const operation = queue.then(async () => {
          sqlite.exec('BEGIN');
          try { const value = await context.run(true, () => fn(database)); sqlite.exec('COMMIT'); return value; }
          catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        });
        queue = operation.catch(() => {}); return operation;
      },
    };
  }
  const options = { database, jwtSecret: secret };
  const app = dialect === 'mysql' ? await createMysqlApp(options) : createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const request = async (input = INPUT, actor = 'editor') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/content`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    await app.locals.accountContinuity?.stop(); await app.locals.imageRetirement?.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); sqlite.close();
  });
  const api = async (method, route, input, actor = 'editor') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  };
  return { sqlite, request, api };
}

for (const dialect of ['sqlite', 'mysql']) {
  test(`${dialect}: retries after a lost acknowledgement create one video and one audit entry`, async t => {
    const f = await fixture(t, dialect);
    const responses = await Promise.all([f.request(), f.request(), f.request({ ...INPUT, clientRequestId: KEY.toUpperCase() })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200,200,201]);
    assert.ok(responses.every(r => r.body.id === KEY));
    const replay = await f.request({ ...INPUT, title: '  坐姿伸展  ' });
    assert.deepEqual(replay, { status: 200, body: { id: KEY, replayed: true } });
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM content_items').get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM system_logs WHERE action='content.create' AND target_id=?").get(KEY).n, 1);
  });

  test(`${dialect}: retry cannot overwrite changed payload, another editor or an already edited item`, async t => {
    const f = await fixture(t, dialect); assert.equal((await f.request()).status, 201);
    const original = f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY);
    for (const change of [{ title: 'Different' }, { sortOrder: 9 }, { isActive: false }, { value: '/api/media/b/b.mp4' }, { pageKey: 'home' }]) {
      const r = await f.request({ ...INPUT, ...change });
      assert.equal(r.status, change.pageKey ? 400 : 409);
    }
    assert.equal((await f.request(INPUT, 'other')).status, 409);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY), original);
    f.sqlite.prepare('UPDATE content_items SET title=? WHERE id=?').run('Edited after import', KEY);
    assert.deepEqual(await f.request(), { status: 409, body: { error: 'contentRequestConflict' } });
    assert.equal(f.sqlite.prepare('SELECT title FROM content_items WHERE id=?').get(KEY).title, 'Edited after import');
  });

  test(`${dialect}: invalid keys, unavailable files and unauthorized users never create batch rows`, async t => {
    const f = await fixture(t, dialect);
    for (const key of ['', 'not-a-uuid', null, [], KEY.replace('-4cc1-', '-1cc1-')]) {
      const r = await f.request({ ...INPUT, clientRequestId: key });
      assert.deepEqual(r, { status: 400, body: { error: 'invalidContentRequestId' } });
    }
    for (const value of ['/api/media/b/b.mp4','/api/media/c/c.mp4','/api/media/d/d.mp4','/api/media/e/e.mp4','https://example.com/a.mp4']) {
      assert.equal((await f.request({ ...INPUT, value })).status, 400);
    }
    assert.equal((await f.request(INPUT, 'viewer')).status, 403);
    assert.equal((await f.request(INPUT, null)).status, 401);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM content_items').get().n, 0);
  });

  test(`${dialect}: independent selected files append in order and old clients need no request ID`, async t => {
    const f = await fixture(t, dialect);
    assert.equal((await f.request()).status, 201);
    const second = await f.request({ ...INPUT, title: 'Second title', sortOrder: 9, clientRequestId: crypto.randomUUID() });
    assert.equal(second.status, 201);
    const legacy = { ...INPUT, pageKey: 'home', clientRequestId: undefined };
    assert.equal((await f.request(legacy)).status, 201);
    assert.equal((await f.request(legacy)).status, 201);
    const rows = f.sqlite.prepare("SELECT title,sort_order FROM content_items WHERE page_key='exercise_videos' ORDER BY sort_order").all();
    assert.deepEqual(rows, [{ title: '坐姿伸展', sort_order: 8 }, { title: 'Second title', sort_order: 9 }]);
  });

  test(`${dialect}: legacy rows remain public and an omitted PATCH preserves video metadata`, async t => {
    const f = await fixture(t, dialect);
    assert.equal((await f.request()).status, 201);
    let publicItem = (await f.api('GET', '/api/content?pageKey=exercise_videos', undefined, null)).body.items[0];
    assert.equal(publicItem.videoCategory, ''); assert.deepEqual(publicItem.equipmentIds, []);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { videoCategory: 'indoor', equipmentIds: ['6','0','6'] })).status, 200);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { title: 'New editable title' })).status, 200);
    for (const route of ['/api/content?pageKey=exercise_videos', '/api/admin/content']) {
      publicItem = (await f.api('GET', route)).body.items[0];
      assert.equal(publicItem.title, 'New editable title'); assert.equal(publicItem.videoCategory, 'indoor');
      assert.deepEqual(publicItem.equipmentIds, ['0','6']); assert.equal('equipmentIdsJson' in publicItem, false);
    }
    assert.deepEqual(await f.request(), { status: 409, body: { error: 'contentRequestConflict' } });
  });

  test(`${dialect}: normalized metadata participates in batch retry identity`, async t => {
    const f = await fixture(t, dialect);
    const input = { ...INPUT, videoCategory: 'indoor', equipmentIds: ['4','10','4'] };
    assert.equal((await f.request(input)).status, 201);
    assert.deepEqual(await f.request({ ...input, equipmentIds: ['10','4'] }), { status: 200, body: { id: KEY, replayed: true } });
    for (const metadata of [{ videoCategory: 'outdoor', equipmentIds: [] }, { videoCategory: 'indoor', equipmentIds: ['6'] }, { videoCategory: '', equipmentIds: [] }]) {
      assert.deepEqual(await f.request({ ...input, ...metadata }), { status: 409, body: { error: 'contentRequestConflict' } });
    }
    f.sqlite.prepare("UPDATE app_equipment_items SET is_active=0 WHERE id='4'").run();
    assert.equal((await f.request(input)).status, 200, 'retry must work after equipment is retired');
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM content_items').get().n, 1);
  });

  test(`${dialect}: new selections require live equipment; retired selections survive title edits but cannot be re-added`, async t => {
    const f = await fixture(t, dialect);
    assert.equal((await f.request({ ...INPUT, videoCategory: 'indoor', equipmentIds: ['6'] })).status, 201);
    f.sqlite.prepare("UPDATE app_equipment_items SET is_active=0,deleted_at='retired' WHERE id='6'").run();
    f.sqlite.prepare("UPDATE app_equipment_items SET is_active=0 WHERE id='4'").run();
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { title: 'Retain retired', equipmentIds: ['6','0'] })).status, 200);
    for (const equipmentIds of [['6','4'], ['6','missing-id'], [6], [''], [' 0'], ['0\n'], null, '0', Array(101).fill('0')]) {
      assert.deepEqual(await f.api('PATCH', `/api/admin/content/${KEY}`, { equipmentIds }), { status: 400, body: { error: 'invalidVideoEquipmentIds' } });
    }
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { equipmentIds: [] })).status, 200);
    assert.deepEqual(await f.api('PATCH', `/api/admin/content/${KEY}`, { equipmentIds: ['6'] }), { status: 400, body: { error: 'invalidVideoEquipmentIds' } });
    assert.equal((await f.request({ ...INPUT, clientRequestId: crypto.randomUUID(), videoCategory: 'indoor', equipmentIds: ['4'] })).status, 400);
  });

  test(`${dialect}: category changes clear associations explicitly and non-video fields are refused`, async t => {
    const f = await fixture(t, dialect);
    for (const videoCategory of ['Indoor','unknown',null,0]) {
      assert.deepEqual(await f.request({ ...INPUT, videoCategory }), { status: 400, body: { error: 'invalidVideoCategory' } });
    }
    assert.deepEqual(await f.request({ ...INPUT, videoCategory: 'outdoor', equipmentIds: ['0'] }), { status: 400, body: { error: 'invalidVideoEquipmentIds' } });
    assert.equal((await f.request({ ...INPUT, videoCategory: 'indoor', equipmentIds: ['6'] })).status, 201);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { videoCategory: 'outdoor' })).status, 200);
    let item = (await f.api('GET', '/api/admin/content')).body.items[0];
    assert.equal(item.videoCategory, 'outdoor'); assert.deepEqual(item.equipmentIds, []);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { videoCategory: '' })).status, 200);
    item = (await f.api('GET', '/api/content')).body.items[0];
    assert.equal(item.videoCategory, ''); assert.deepEqual(item.equipmentIds, []);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { equipmentIds: ['0'] })).status, 400);
    for (const content of [{ pageKey: 'home', contentType: 'video' }, { pageKey: 'home', contentType: 'text' }]) {
      const input = { ...INPUT, ...content, clientRequestId: undefined };
      assert.deepEqual(await f.request({ ...input, videoCategory: '' }), { status: 400, body: { error: 'invalidExerciseVideoMetadata' } });
      const legacy = await f.request(input); assert.equal(legacy.status, 201);
      assert.deepEqual(await f.api('PATCH', `/api/admin/content/${legacy.body.id}`, { equipmentIds: [] }), { status: 400, body: { error: 'invalidExerciseVideoMetadata' } });
    }
  });

  test(`${dialect}: unauthorized and rejected metadata edits are atomic; delete removes the content and metadata together`, async t => {
    const f = await fixture(t, dialect);
    assert.equal((await f.request({ ...INPUT, videoCategory: 'indoor', equipmentIds: ['0'] })).status, 201);
    const before = f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { title: 'Unauthorized', equipmentIds: ['6'] }, 'viewer')).status, 403);
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { title: 'Invalid edit', equipmentIds: ['unknown'] })).status, 400);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY), before);
    f.sqlite.exec("CREATE TRIGGER reject_content_update_log BEFORE INSERT ON system_logs WHEN NEW.action='content.update' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    assert.equal((await f.api('PATCH', `/api/admin/content/${KEY}`, { title: 'Must roll back', equipmentIds: ['6'] })).status, 500);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY), before);
    assert.equal((await f.api('DELETE', `/api/admin/content/${KEY}`)).status, 200);
    assert.equal(f.sqlite.prepare('SELECT * FROM content_items WHERE id=?').get(KEY), undefined);
  });
}
