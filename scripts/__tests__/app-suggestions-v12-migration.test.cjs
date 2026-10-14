const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const checks = import(pathToFileURL(path.resolve(__dirname, '../../deploy/app-suggestions-20261002-v12/migration-checks.mjs')));

test('only known additive table states can migrate', async () => {
  const { assertMigrationBaseline } = await checks;
  for (const count of [{ n: 40, documents: 0, batches: 0 }, { n: 41, documents: 1, batches: 0 }, { n: 42, documents: 1, batches: 1 }]) assert.doesNotThrow(() => assertMigrationBaseline(count));
  for (const count of [{ n: 41, documents: 0, batches: 1 }, { n: 42, documents: 1, batches: 0 }, { n: 43, documents: 1, batches: 1 }]) assert.throws(() => assertMigrationBaseline(count), /MIGRATION_BASELINE_TABLES/);
});

test('equipment extension migration skips verified columns and refuses partial or mismatched state', async () => {
  const { equipmentExtensionState } = await checks;
  const rows = ['additional_videos_json', 'teaching_sections_json'].map(name => ({ name, type: 'json', nullable: 'YES' }));
  assert.equal(equipmentExtensionState([]), 'missing');
  assert.equal(equipmentExtensionState(rows), 'ready');
  assert.equal(equipmentExtensionState(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.from(value)])))), 'ready');
  for (const mismatch of [rows.slice(0, 1), [{ ...rows[0], type: 'text' }, rows[1]], [{ ...rows[0], nullable: 'NO' }, rows[1]]]) assert.throws(() => equipmentExtensionState(mismatch), /COLUMNS_MISMATCH/);
});

test('test-account audit schema validates columns, indexes and storage without changing data', async () => {
  const { testUserBatchState } = await checks;
  const schema = {
    columns: [['id', 'varchar(36)', 'NO'], ['actor_id', 'varchar(128)', 'NO'], ['credentials_hash', 'char(64)', 'NO'], ['accounts_json', 'json', 'NO'], ['created_at', 'varchar(32)', 'NO'], ['disabled_at', 'varchar(32)', 'YES']].map(([name, type, nullable]) => ({ name, type, nullable, extra: '' })),
    indexes: [['PRIMARY', 'id', 0], ['test_user_batches_actor_created', 'actor_id', 1], ['test_user_batches_actor_created', 'created_at', 1]].map(([name, col, nonUnique]) => ({ name, col, nonUnique })),
    table: { engine: 'InnoDB', collation: 'utf8mb4_0900_bin' },
  };
  assert.equal(testUserBatchState({ columns: [], indexes: [] }), 'missing');
  const before = JSON.stringify(schema);
  assert.equal(testUserBatchState(schema), 'ready');
  assert.equal(JSON.stringify(schema), before);
  assert.throws(() => testUserBatchState({ ...schema, columns: schema.columns.slice(1) }), /COLUMNS_MISMATCH/);
  assert.throws(() => testUserBatchState({ ...schema, indexes: [] }), /INDEXES_MISMATCH/);
  assert.throws(() => testUserBatchState({ ...schema, table: { ...schema.table, collation: 'utf8mb4_general_ci' } }), /STORAGE_MISMATCH/);
});
