import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeExerciseVideoMetadataSqlite, publicContentMetadata } from '../src/exerciseVideoMetadata.js';
import { applyExerciseVideoMetadataSchema, inspectExerciseVideoMetadataSchema } from '../src/exerciseVideoMetadataSchema.js';

function column(name, type, nullable = 'YES', value = null) {
  return { COLUMN_NAME: name, COLUMN_TYPE: type, IS_NULLABLE: nullable, COLUMN_DEFAULT: value, CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_0900_bin', EXTRA: '', GENERATION_EXPRESSION: '' };
}
const idColumn = () => column('id', 'varchar(100)', 'NO');
const categoryColumn = () => column('video_category', 'varchar(16)', 'NO', '');
const idsColumn = () => column('equipment_ids_json', 'mediumtext');

function mysqlSchema(columns = [idColumn()], { database = 'outdoor_fit_prod', engine = 'InnoDB', collation = 'utf8mb4_0900_bin', failAlter = false } = {}) {
  const calls = [];
  return { calls, columns, async query(sql) {
    calls.push(sql);
    if (sql === 'SELECT DATABASE() AS name') return [[{ name: database }]];
    if (sql.includes('information_schema.tables')) return [[{ ENGINE: engine, TABLE_COLLATION: collation }]];
    if (sql.includes('information_schema.columns')) return [[...columns]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SET SESSION')) return [{}];
    if (sql.startsWith('ALTER TABLE')) {
      if (failAlter) throw Object.assign(new Error('synthetic DDL rejected'), { code: 'ER_NOT_SUPPORTED_YET' });
      if (sql.includes('`video_category`')) columns.push(categoryColumn());
      if (sql.includes('`equipment_ids_json`')) columns.push(idsColumn());
      return [{}];
    }
    throw new Error('Unexpected query: ' + sql);
  } };
}

test('read-only MySQL inspection reports missing columns without SET, locks or writes', async () => {
  const db = mysqlSchema();
  assert.deepEqual(await inspectExerciseVideoMetadataSchema(db), { status: 'missing', missingColumns: ['video_category','equipment_ids_json'] });
  assert.ok(db.calls.every(sql => sql.startsWith('SELECT ') && !sql.includes('GET_LOCK')));
});

test('MySQL adds only missing compatible columns in one INSTANT DDL and remains replayable', async () => {
  for (const columns of [[idColumn()], [idColumn(),categoryColumn()], [idColumn(),idsColumn()]]) {
    const db = mysqlSchema(columns);
    assert.equal((await applyExerciseVideoMetadataSchema(db)).status, 'ready');
    assert.equal((await applyExerciseVideoMetadataSchema(db)).status, 'ready');
    const ddl = db.calls.filter(sql => sql.startsWith('ALTER'));
    assert.equal(ddl.length, 1); assert.match(ddl[0], /ALGORITHM=INSTANT$/);
    assert.ok(db.calls.every(sql => !/\b(?:UPDATE|INSERT|DELETE|DROP|CREATE TABLE)\b/.test(sql)));
    assert.equal(db.calls.filter(sql => sql.includes('RELEASE_LOCK')).length, 2);
  }
});

test('schema or target mismatch fails before any mutation instead of repairing unknown columns', async () => {
  const variants = [
    mysqlSchema([idColumn()], { database: 'outdoor_fit_test' }),
    mysqlSchema([idColumn()], { engine: 'MyISAM' }),
    mysqlSchema([idColumn()], { collation: 'utf8mb4_0900_ai_ci' }),
    mysqlSchema([column('id', 'varchar(200)', 'NO')]),
    mysqlSchema([idColumn(),column('video_category', 'text', 'NO', '')]),
    mysqlSchema([idColumn(),{ ...categoryColumn(), COLLATION_NAME: 'utf8mb4_bin' }]),
    mysqlSchema([idColumn(),{ ...categoryColumn(), COLUMN_DEFAULT: 'indoor' }]),
    mysqlSchema([idColumn(),{ ...idsColumn(), EXTRA: 'STORED GENERATED' }]),
  ];
  for (const db of variants) {
    await assert.rejects(applyExerciseVideoMetadataSchema(db), /EXERCISE_VIDEO_(?:DATABASE_REFUSED|PARENT_SCHEMA_MISMATCH|SCHEMA_MISMATCH)/);
    assert.ok(db.calls.every(sql => sql.startsWith('SELECT ') && !sql.includes('GET_LOCK')));
  }
});

test('a refused INSTANT ALTER releases the lock and never retries with a blocking table rebuild', async () => {
  const db = mysqlSchema([idColumn()], { failAlter: true });
  await assert.rejects(applyExerciseVideoMetadataSchema(db), /synthetic DDL rejected/);
  assert.equal(db.calls.filter(sql => sql.startsWith('ALTER')).length, 1);
  assert.match(db.calls.at(-1), /RELEASE_LOCK/);
});

test('SQLite migration preserves legacy rows and old INSERT shape, has no new tables and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE content_items(id TEXT PRIMARY KEY,page_key TEXT,content_type TEXT,title TEXT); INSERT INTO content_items VALUES('a','exercise_videos','video','Old title')");
    initializeExerciseVideoMetadataSqlite(db);
    db.prepare("UPDATE content_items SET video_category='indoor',equipment_ids_json='[\"6\"]' WHERE id='a'").run();
    initializeExerciseVideoMetadataSqlite(db);
    db.prepare("INSERT INTO content_items(id,page_key,content_type,title) VALUES('b','exercise_videos','video','Another old client')").run();
    const rows = db.prepare('SELECT * FROM content_items ORDER BY id').all().map(publicContentMetadata);
    assert.equal(rows[0].title, 'Old title'); assert.equal(rows[0].videoCategory, 'indoor'); assert.deepEqual(rows[0].equipmentIds, ['6']);
    assert.equal(rows[1].videoCategory, ''); assert.deepEqual(rows[1].equipmentIds, []);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 1);
  } finally { db.close(); }
});

test('migration CLI refuses malformed secret input with a fixed code and no secret echo', () => {
  const cli = new URL('../scripts/migrate-exercise-video-metadata.js', import.meta.url);
  for (const input of ['{"password":"SENSITIVE-DO-NOT-ECHO","unexpected":true}', 'SENSITIVE-DO-NOT-ECHO', '{"password":"SENSITIVE-DO-NOT-ECHO\\n"}']) {
    const result = spawnSync(process.execPath, [fileURLToPath(cli), '--apply'], { input, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR_CODE=EXERCISE_VIDEO_SCHEMA_(?:INPUT|PASSWORD)_INVALID\r?\n$/);
    assert.equal(result.stdout, ''); assert.doesNotMatch(result.stderr, /SENSITIVE-DO-NOT-ECHO/);
  }
});
