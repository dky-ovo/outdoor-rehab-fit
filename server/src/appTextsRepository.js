const COLUMNS = 'text_key,zh,en,revision,updated_at,updated_by';
const SQL = Object.freeze({
  public: 'SELECT text_key,zh,en FROM app_text_overrides',
  all: `SELECT ${COLUMNS} FROM app_text_overrides`,
  get: `SELECT ${COLUMNS} FROM app_text_overrides WHERE text_key=?`,
  insert: 'INSERT INTO app_text_overrides (text_key,zh,en,revision,updated_at,updated_by) VALUES (?,?,?,?,?,?)',
  update: 'UPDATE app_text_overrides SET zh=?,en=?,revision=?,updated_at=?,updated_by=? WHERE text_key=? AND revision=?',
});

export class AppTextConflictError extends Error {
  constructor() { super('appTextConflict'); this.code = 'APP_TEXT_CONFLICT'; }
}

function revision(value) {
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new TypeError('Stored app text revision is invalid'), { code: 'APP_TEXT_REVISION_INVALID' });
  }
  return value;
}

function row(value) { return value == null ? null : { ...value, revision: revision(value.revision) }; }

function validateWrite(input, hooks) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['key', 'zh', 'en', 'revision', 'updatedAt', 'updatedBy'].includes(key))
    || typeof input.key !== 'string' || !input.key
    || ![input.zh, input.en].every(value => value === null || typeof value === 'string')
    || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER
    || typeof input.updatedAt !== 'string' || !input.updatedAt
    || typeof input.updatedBy !== 'string' || !input.updatedBy
    || typeof hooks?.authorize !== 'function' || typeof hooks?.audit !== 'function') {
    throw new TypeError('Invalid app text write');
  }
}

function checkRevision(current, expected) {
  if ((current?.revision ?? 0) !== expected) throw new AppTextConflictError();
}

function writeQuery(input, exists) {
  const { key, zh, en, revision: previous, updatedAt, updatedBy } = input;
  return exists
    ? [SQL.update, [zh, en, previous + 1, updatedAt, updatedBy, key, previous]]
    : [SQL.insert, [key, zh, en, previous + 1, updatedAt, updatedBy]];
}

function checkWrite(count, exists) {
  if (count === 1) return;
  if (exists && count === 0) throw new AppTextConflictError();
  throw Object.assign(new Error('App text write did not affect one row'), { code: 'APP_TEXT_WRITE_FAILED' });
}

function savedRow(value, expected) {
  const result = row(value);
  if (!result || result.revision !== expected) {
    throw Object.assign(new Error('App text write could not be verified'), { code: 'APP_TEXT_WRITE_FAILED' });
  }
  return result;
}

function synchronous(value) {
  if (value != null && typeof value.then === 'function') {
    // A mistakenly asynchronous hook must not let better-sqlite3 commit early.
    Promise.resolve(value).catch(() => {});
    throw new TypeError('SQLite app text transaction hooks must be synchronous');
  }
}

/** SQLite methods stay synchronous. MySQL methods use the original adapter so
 * authorization, data changes and audit writes share its transaction context. */
export function createAppTextsRepository(database) {
  if (database?.dialect === 'mysql') {
    for (const name of ['all', 'get', 'run', 'transaction']) {
      if (typeof database[name] !== 'function') throw new TypeError(`MySQL app texts repository requires ${name}`);
    }
    return Object.freeze({
      dialect: 'mysql',
      listPublic: () => database.all(SQL.public),
      async listAll() { return (await database.all(SQL.all)).map(row); },
      async update(input, hooks) {
        validateWrite(input, hooks);
        return database.transaction(async () => {
          await hooks.authorize();
          // This snapshot read intentionally takes no gap lock for a missing
          // key. The primary key INSERT / conditional UPDATE decides the winner.
          const current = row(await database.get(SQL.get, [input.key]));
          checkRevision(current, input.revision);
          const [sql, values] = writeQuery(input, current !== null);
          let result;
          try { result = await database.run(sql, values); }
          catch (error) {
            // Only a failed first INSERT can represent this race. Never turn
            // audit, connection, deadlock or uncertain COMMIT errors into 409.
            if (current === null && error?.code === 'ER_DUP_ENTRY') throw new AppTextConflictError();
            throw error;
          }
          if (result?.warningStatus !== 0) {
            throw Object.assign(new Error('App text write reported a warning'), { code: 'APP_TEXT_WRITE_FAILED' });
          }
          checkWrite(result?.affectedRows, current !== null);
          await hooks.audit();
          return savedRow(await database.get(SQL.get, [input.key]), input.revision + 1);
        });
      },
    });
  }
  if (typeof database?.prepare !== 'function' || typeof database.transaction !== 'function') {
    throw new TypeError('SQLite app texts repository requires prepare and transaction');
  }
  const statements = Object.fromEntries(Object.entries(SQL).map(([key, sql]) => [key, database.prepare(sql)]));
  return Object.freeze({
    dialect: 'sqlite',
    listPublic: () => statements.public.all(),
    listAll: () => statements.all.all().map(row),
    update(input, hooks) {
      validateWrite(input, hooks);
      return database.transaction(() => {
        synchronous(hooks.authorize());
        const current = row(statements.get.get(input.key));
        checkRevision(current, input.revision);
        const [, values] = writeQuery(input, current !== null);
        const result = (current === null ? statements.insert : statements.update).run(...values);
        checkWrite(result.changes, current !== null);
        synchronous(hooks.audit());
        return savedRow(statements.get.get(input.key), input.revision + 1);
      }).immediate();
    },
  });
}
