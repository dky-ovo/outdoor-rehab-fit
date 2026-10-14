// MySQL-only additive migration. It never changes existing content or table count.
// MEDIUMTEXT NULL permits the previous production image's explicit INSERTs;
// the current API interprets legacy NULL as an empty list.
export const EXERCISE_VIDEO_METADATA_DDL = Object.freeze({
  video_category: "ADD COLUMN `video_category` VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ''",
  equipment_ids_json: 'ADD COLUMN `equipment_ids_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL DEFAULT NULL',
});
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const compatible = (column, type, nullable, defaultValue) =>
  text(column.COLUMN_TYPE).toLowerCase() === type && text(column.IS_NULLABLE) === nullable &&
  text(column.CHARACTER_SET_NAME) === 'utf8mb4' && text(column.COLLATION_NAME) === 'utf8mb4_0900_bin' &&
  !text(column.EXTRA) && !text(column.GENERATION_EXPRESSION) &&
  (defaultValue === null ? column.COLUMN_DEFAULT === null : column.COLUMN_DEFAULT !== null && text(column.COLUMN_DEFAULT) === defaultValue);

export async function inspectExerciseVideoMetadataSchema(connection) {
  const [[database]] = await connection.query('SELECT DATABASE() AS name');
  if (text(database?.name) !== 'outdoor_fit_prod') fail('EXERCISE_VIDEO_DATABASE_REFUSED');
  const [[table]] = await connection.query("SELECT ENGINE,TABLE_COLLATION FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='content_items' AND table_type='BASE TABLE'");
  if (text(table?.ENGINE).toLowerCase() !== 'innodb' || text(table?.TABLE_COLLATION) !== 'utf8mb4_0900_bin') fail('EXERCISE_VIDEO_PARENT_SCHEMA_MISMATCH');
  const [columns] = await connection.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='content_items'");
  const byName = new Map(columns.map(column => [text(column.COLUMN_NAME), column]));
  if (!byName.has('id') || !compatible(byName.get('id'), 'varchar(100)', 'NO', null)) fail('EXERCISE_VIDEO_PARENT_SCHEMA_MISMATCH');
  for (const [name, type, nullable, value] of [['video_category', 'varchar(16)', 'NO', ''], ['equipment_ids_json', 'mediumtext', 'YES', null]]) {
    if (byName.has(name) && !compatible(byName.get(name), type, nullable, value)) fail('EXERCISE_VIDEO_SCHEMA_MISMATCH');
  }
  const missingColumns = Object.keys(EXERCISE_VIDEO_METADATA_DDL).filter(name => !byName.has(name));
  return { status: missingColumns.length ? 'missing' : 'ready', missingColumns };
}

export async function applyExerciseVideoMetadataSchema(connection) {
  let locked = false;
  try {
    // Check the target before taking the advisory lock or issuing any SET/DDL.
    await inspectExerciseVideoMetadataSchema(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK('outdoor_fit_prod.exercise_video_metadata_v26',10) AS acquired");
    if (Number(lock?.acquired) !== 1) fail('EXERCISE_VIDEO_SCHEMA_LOCK_UNAVAILABLE');
    locked = true;
    const before = await inspectExerciseVideoMetadataSchema(connection);
    if (before.missingColumns.length) {
      await connection.query('SET SESSION lock_wait_timeout=15');
      await connection.query('ALTER TABLE `content_items` ' + before.missingColumns.map(name => EXERCISE_VIDEO_METADATA_DDL[name]).join(', ') + ', ALGORITHM=INSTANT');
    }
    const result = await inspectExerciseVideoMetadataSchema(connection);
    if (result.status !== 'ready') fail('EXERCISE_VIDEO_SCHEMA_VERIFY_FAILED');
    return result;
  } finally {
    if (locked) {
      const [[lock]] = await connection.query("SELECT RELEASE_LOCK('outdoor_fit_prod.exercise_video_metadata_v26') AS released");
      if (Number(lock?.released) !== 1) fail('EXERCISE_VIDEO_SCHEMA_UNLOCK_FAILED');
    }
  }
}
