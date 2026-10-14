const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : value;

// Never silently complete a partial or differently typed prior manual change.
export function equipmentExtensionState(rows) {
  if (!Array.isArray(rows)) throw Error('EQUIPMENT_EXTENSION_COLUMNS_INVALID');
  if (!rows.length) return 'missing';
  const expected = ['additional_videos_json', 'teaching_sections_json'];
  const columns = rows.map(row => [text(row.name), String(text(row.type)).toLowerCase(), text(row.nullable)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (JSON.stringify(columns) !== JSON.stringify(expected.map(name => [name, 'json', 'YES']))) {
    throw Error('EQUIPMENT_EXTENSION_COLUMNS_MISMATCH');
  }
  return 'ready';
}

export function assertMigrationBaseline(count) {
  const tables = Number(count.n), documents = Number(count.documents), batches = Number(count.batches);
  if (!((tables === 40 && documents === 0 && batches === 0)
    || (tables === 41 && documents === 1 && batches === 0)
    || (tables === 42 && documents === 1 && batches === 1))) throw Error('MIGRATION_BASELINE_TABLES');
}

export function testUserBatchState({ columns, indexes, table }) {
  if (!table && !columns.length && !indexes.length) return 'missing';
  const expected = [['id', 'varchar(36)', 'NO', ''], ['actor_id', 'varchar(128)', 'NO', ''],
    ['credentials_hash', 'char(64)', 'NO', ''], ['accounts_json', 'json', 'NO', ''],
    ['created_at', 'varchar(32)', 'NO', ''], ['disabled_at', 'varchar(32)', 'YES', '']];
  const found = columns.map(row => [text(row.name), String(text(row.type)).toLowerCase(), text(row.nullable), text(row.extra)]);
  if (JSON.stringify(found) !== JSON.stringify(expected)) throw Error('TEST_USER_BATCH_COLUMNS_MISMATCH');
  const keys = indexes.map(row => [text(row.name), text(row.col), Number(row.nonUnique)]);
  const expectedKeys = [['PRIMARY', 'id', 0], ['test_user_batches_actor_created', 'actor_id', 1], ['test_user_batches_actor_created', 'created_at', 1]];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw Error('TEST_USER_BATCH_INDEXES_MISMATCH');
  if (text(table?.engine) !== 'InnoDB' || text(table?.collation) !== 'utf8mb4_0900_bin') throw Error('TEST_USER_BATCH_STORAGE_MISMATCH');
  return 'ready';
}
