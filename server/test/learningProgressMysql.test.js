import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createMysqlDatabase } from '../src/mysqlDatabase.js';
import { LEARNING_PROGRESS_SCHEMA, saveLearningProgress, participantLearningProgress } from '../src/learningProgress.js';

const day = '2026-09-21';
const evidence = (start = 0, end = 50, total = 100) => ({ version: 2, evidence: { read: { 'zh:text:revision': { parts: [{ key: 'details', total }], ranges: { details: [[start, end]] } } } } });
const record = (equipmentId = '0', entry = evidence(), date = day) => ({ equipmentId, entry, date });
const rowKey = (userId, equipmentId, date) => JSON.stringify([userId, equipmentId, date]);

function fixture(options = {}) {
  const state = {
    progress: new Map(),
    users: new Map([['p', { id: 'p', deleted_at: null }], ['other', { id: 'other', deleted_at: null }]]),
    equipment: new Set(['0', '1', '2', '3']),
  };
  const calls = [];
  let connectionCount = 0, writeCount = 0;
  const pool = {
    async getConnection() {
      const id = ++connectionCount;
      let working;
      return {
        async query(sql) { calls.push({ id, kind: 'setup', sql }); },
        async beginTransaction() {
          calls.push({ id, kind: 'begin' });
          working = structuredClone(state.progress);
        },
        async commit() { calls.push({ id, kind: 'commit' }); state.progress = working; },
        async rollback() { calls.push({ id, kind: 'rollback' }); working = null; },
        release() { calls.push({ id, kind: 'release' }); },
        destroy() { calls.push({ id, kind: 'destroy' }); },
        async execute(sql, values) {
          calls.push({ id, kind: 'execute', sql, values });
          assert.ok(working, 'business queries must use the transaction connection');
          if (sql.includes('FROM users')) return [[state.users.get(values[0])].filter(Boolean), []];
          if (sql.includes('FROM app_equipment_items')) return [state.equipment.has(values[0]) ? [{ id: values[0] }] : [], []];
          if (/^(INSERT|UPDATE) facility_learning_progress/.test(sql) || sql.startsWith('INSERT INTO facility_learning_progress')) {
            writeCount++;
            if (writeCount === options.failWriteAt) throw Object.assign(new Error('private driver SQL and values'), { code: 'ER_DATA_TOO_LONG', sql, sqlMessage: 'private driver values' });
            const [userId, equipmentId, date, entryJson, updatedAt] = sql.startsWith('UPDATE')
              ? [values[2], values[3], values[4], values[0], values[1]] : values;
            const key = rowKey(userId, equipmentId, date);
            if (sql.startsWith('INSERT')) assert.equal(working.has(key), false, 'a missing row uses a plain INSERT');
            else assert.equal(working.has(key), true, 'an existing row uses an UPDATE');
            working.set(key, { user_id: userId, equipment_id: equipmentId, learning_date: date, entry_json: entryJson, updated_at: updatedAt });
            return [{ affectedRows: 1, warningStatus: writeCount === options.warningAt ? 1 : 0, insertId: 0 }, []];
          }
          assert.ok(sql.includes('FROM facility_learning_progress'));
          const conditions = [...sql.matchAll(/(user_id|equipment_id|learning_date) = \?/g)].map(match => match[1]);
          const rows = [...working.values()].filter(row => conditions.every((name, index) => row[name] === values[index]));
          if (sql.startsWith('SELECT COUNT')) return [[{ count: options.countValue ?? String(new Set(rows.map(row => row.equipment_id)).size) }], []];
          if (sql.startsWith('SELECT equipment_id, MAX')) {
            const groups = new Map();
            for (const row of rows) {
              const previous = groups.get(row.equipment_id);
              if (!previous || previous.updatedAt < row.updated_at) groups.set(row.equipment_id, { equipment_id: row.equipment_id, updatedAt: row.updated_at });
            }
            const [, limit, offset] = /LIMIT (\d+) OFFSET (\d+)/.exec(sql);
            return [[...groups.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.equipment_id.localeCompare(b.equipment_id)).slice(Number(offset), Number(offset) + Number(limit)), []];
          }
          rows.sort((a, b) => a.learning_date.localeCompare(b.learning_date));
          return [rows.map(row => sql.startsWith('SELECT learning_date') ? { learning_date: row.learning_date, entry_json: row.entry_json } : { entry_json: row.entry_json }), []];
        },
      };
    },
    async end() {},
  };
  const database = createMysqlDatabase({ ssl: { ca: 'fake-pool-only', rejectUnauthorized: true, verifyIdentity: true } }, { poolFactory: () => pool });
  const seed = (userId, equipmentId, date, entry, updatedAt = '2026-09-21T00:00:00.000Z') => state.progress.set(rowKey(userId, equipmentId, date), {
    user_id: userId, equipment_id: equipmentId, learning_date: date, entry_json: JSON.stringify(entry), updated_at: updatedAt,
  });
  return { database, state, calls, seed };
}

test('SQLite save and participant read retain synchronous result contracts', () => {
  const database = new Database(':memory:');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE app_equipment_items (id TEXT PRIMARY KEY);');
    database.exec(LEARNING_PROGRESS_SCHEMA);
    database.prepare('INSERT INTO users VALUES (?)').run('p');
    database.prepare('INSERT INTO app_equipment_items VALUES (?)').run('0');
    const saved = saveLearningProgress(database, 'p', { records: [record()] });
    assert.deepEqual(saved, { ok: true, saved: 1 });
    assert.equal(saved.then, undefined);
    const result = participantLearningProgress(database, 'p', {});
    assert.equal(result.then, undefined);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].entry.read, false);
  } finally { database.close(); }
});

test('MySQL save locks the active owner first and merges existing and initially absent rows on one connection', async () => {
  const { database, state, calls, seed } = fixture();
  try {
    seed('p', '0', day, evidence(0, 50));
    assert.deepEqual(await saveLearningProgress(database, 'p', { records: [record('1', evidence(0, 80)), record('0', evidence(40, 75))] }), { ok: true, saved: 2 });
    const queries = calls.filter(call => call.kind === 'execute');
    assert.equal(queries[0].sql, 'SELECT id, deleted_at FROM users WHERE id = ? FOR UPDATE');
    assert.equal(new Set(queries.map(call => call.id)).size, 1);
    assert.deepEqual(queries.filter(call => call.sql.startsWith('SELECT learning_date')).map(call => call.values[1]), ['0', '1']);
    assert.ok(queries.filter(call => call.sql.startsWith('SELECT learning_date')).every(call => call.sql.endsWith('FOR UPDATE')));
    assert.deepEqual(JSON.parse(state.progress.get(rowKey('p', '0', day)).entry_json).evidence.read['zh:text:revision'].ranges.details, [[0, 75]]);
    assert.equal(state.progress.has(rowKey('p', '1', day)), true);
    assert.equal(calls.filter(call => call.kind === 'commit').length, 1);
  } finally { await database.close(); }
});

test('equipment and date ordering is stable; replay preserves timestamps and reports zero changes', async () => {
  const { database, state, calls } = fixture();
  try {
    await saveLearningProgress(database, 'p', { records: [record('2'), record('0'), record('0', evidence(), null), record('0', evidence(), '2026-09-20')] });
    const writes = calls.filter(call => call.sql?.startsWith('INSERT INTO'));
    assert.deepEqual(writes.map(call => [call.values[1], call.values[2]]), [['0', ''], ['0', '2026-09-20'], ['0', day], ['2', day]]);
    for (const row of state.progress.values()) row.updated_at = '2000-01-01T00:00:00.000Z';
    assert.deepEqual(await saveLearningProgress(database, 'p', { records: [record('0'), record('0')] }), { ok: true, saved: 0 });
    assert.equal(state.progress.get(rowKey('p', '0', day)).updated_at, '2000-01-01T00:00:00.000Z');
  } finally { await database.close(); }
});

test('cross-date denominator conflict rolls back an earlier write in the same request', async () => {
  const { database, state, calls, seed } = fixture();
  try {
    seed('p', '2', day, evidence());
    const before = structuredClone(state.progress);
    await assert.rejects(saveLearningProgress(database, 'p', { records: [record('0'), record('2', evidence(50, 100, 200), '2026-09-20')] }), { code: 'learningPartsConflict', status: 409 });
    assert.deepEqual(state.progress, before);
    assert.equal(calls.filter(call => call.sql?.startsWith('INSERT INTO')).length, 1);
    assert.equal(calls.filter(call => call.kind === 'rollback').length, 1);
    assert.equal(calls.some(call => call.kind === 'commit'), false);
  } finally { await database.close(); }
});

test('statement failure or warning rolls back preceding writes without leaking driver values', async () => {
  for (const options of [{ failWriteAt: 2 }, { warningAt: 2 }]) {
    const { database, state, calls } = fixture(options);
    try {
      await assert.rejects(saveLearningProgress(database, 'p', { records: [record('0'), record('1')] }), error => {
        assert.equal(error.code, options.failWriteAt ? 'ER_DATA_TOO_LONG' : 'learningProgressFailed');
        assert.doesNotMatch(error.message + JSON.stringify(error), /private driver/);
        return true;
      });
      assert.equal(state.progress.size, 0);
      assert.equal(calls.filter(call => call.kind === 'rollback').length, 1);
      assert.equal(calls.some(call => call.kind === 'commit'), false);
    } finally { await database.close(); }
  }
});

test('missing or deleted users are rejected at the parent lock before evidence access', async () => {
  for (const deleted of [false, true]) {
    const { database, state, calls } = fixture();
    try {
      if (deleted) state.users.get('p').deleted_at = '2026-09-21T00:00:00.000Z';
      else state.users.delete('p');
      await assert.rejects(saveLearningProgress(database, 'p', { records: [record()] }), { code: deleted ? 'accountDeleted' : 'unauthorized', status: 401 });
      assert.equal(calls.filter(call => call.kind === 'execute').length, 1);
      assert.equal(state.progress.size, 0);
      assert.equal(calls.filter(call => call.kind === 'rollback').length, 1);
    } finally { await database.close(); }
  }
});

test('missing equipment fails inside the transaction and rolls back earlier equipment progress', async () => {
  const { database, state } = fixture();
  try {
    await assert.rejects(saveLearningProgress(database, 'p', { records: [record('0'), record('missing')] }), { code: 'invalidLearningEquipment', status: 400 });
    assert.equal(state.progress.size, 0);
  } finally { await database.close(); }
});

test('a missing or deleted participant is rejected after the shared parent lock before progress is read', async () => {
  for (const deleted of [false, true]) {
    const { database, state, calls, seed } = fixture();
    try {
      seed('p', '0', day, evidence());
      if (deleted) state.users.get('p').deleted_at = '2026-09-21T00:00:00.000Z';
      else state.users.delete('p');
      await assert.rejects(participantLearningProgress(database, 'p', {}), { code: 'participantNotLinked', status: 404 });
      const queries = calls.filter(call => call.kind === 'execute');
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /deleted_at FROM users.*FOR SHARE$/);
      assert.equal(calls.filter(call => call.kind === 'rollback').length, 1);
    } finally { await database.close(); }
  }
});

test('participant pagination returns numeric counts, cumulative JSON and stable bounds without mixing owners', async () => {
  const { database, state, calls, seed } = fixture();
  try {
    seed('p', '0', '', evidence(0, 40), '2026-09-20T00:00:00.000Z');
    seed('p', '0', day, evidence(40, 80), '2026-09-23T00:00:00.000Z');
    seed('p', '1', day, evidence(0, 50), '2026-09-22T00:00:00.000Z');
    seed('p', '2', day, evidence(0, 60), '2026-09-21T00:00:00.000Z');
    seed('other', '3', day, evidence(0, 100));
    state.equipment.delete('0');
    const first = await participantLearningProgress(database, 'p', { pageSize: '2' });
    assert.deepEqual([first.page, first.pageSize, first.total, first.totalPages, first.date], [1, 2, 3, 2, null]);
    assert.deepEqual(first.items.map(item => item.equipmentId), ['0', '1']);
    assert.equal(first.items[0].entry.read, true);
    assert.deepEqual(first.items[0].entry.evidence.read['zh:text:revision'].ranges.details, [[0, 80]]);
    const last = await participantLearningProgress(database, 'p', { page: '999', pageSize: '2' });
    assert.equal(last.page, 2); assert.deepEqual(last.items.map(item => item.equipmentId), ['2']);
    const daily = await participantLearningProgress(database, 'p', { date: day, equipmentId: '0' });
    assert.equal(daily.date, day); assert.equal(daily.total, 1); assert.equal(daily.items[0].entry.read, false);
    assert.deepEqual((await participantLearningProgress(database, 'p', { equipmentId: 'missing' })).items, []);
    assert.ok(calls.filter(call => call.kind === 'execute' && call.sql.includes('FROM users')).every(call => call.sql.endsWith('FOR SHARE')));
    assert.ok(calls.filter(call => call.kind === 'execute' && call.sql.includes('FROM facility_learning_progress')).every(call => call.values[0] === 'p'));
  } finally { await database.close(); }
});

test('malformed requests fail before MySQL checkout and unsafe COUNT never leaks into the API', async () => {
  const { database, calls } = fixture({ countValue: '9007199254740992' });
  try {
    assert.throws(() => saveLearningProgress(database, 'p', { records: [record('0', { read: true })] }), { code: 'invalidLearningProgress' });
    assert.throws(() => participantLearningProgress(database, 'p', { pageSize: '2;DROP TABLE users' }), { code: 'invalidPagination' });
    assert.throws(() => participantLearningProgress(database, 'p', { date: '2026-02-30' }), { code: 'invalidLearningDate' });
    assert.equal(calls.length, 0);
    await assert.rejects(participantLearningProgress(database, 'p', {}), { code: 'learningProgressFailed', status: 500 });
    assert.equal(calls.filter(call => call.kind === 'rollback').length, 1);
  } finally { await database.close(); }
});
