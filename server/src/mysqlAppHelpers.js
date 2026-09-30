export async function eachAsync(items, callback) {
  for (let index = 0; index < items.length; index++) await callback(items[index], index);
}

export function mysqlLimit(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) {
    throw new TypeError("Invalid pagination bound");
  }
  return value;
}

export const asciiFold = value => String(value).replace(/[A-Z]/g, letter => letter.toLowerCase());

// SQLite LIKE folds ASCII only. Preserve that behavior without broadening
// Unicode comparisons or the binary uniqueness rules of the imported schema.
export function asciiLike(expression) {
  const allowed = new Set(["u.name", "u.phone", "COALESCE(u.email, '')", "name", "phone", "COALESCE(email, '')", "name_zh", "name_en", "address_zh", "address_en"]);
  if (!allowed.has(expression)) throw new TypeError("Unreviewed search expression");
  for (let code = 65; code <= 90; code++) expression = `REPLACE(${expression}, '${String.fromCharCode(code)}', '${String.fromCharCode(code + 32)}')`;
  return `${expression} LIKE ? ESCAPE '='`;
}

export const searchPattern = value => `%${asciiFold(value).replace(/[%_]/g, "").replace(/=/g, "==")}%`;

// This binds named application values only; it does not translate SQL dialects.
// Callers supply fixed INSERT statements with @name in their VALUES list.
export async function namedMysqlRun(database, sql, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Named values required");
  const parameters = [];
  const query = sql.replace(/@([A-Za-z][A-Za-z0-9_]*)/g, (_match, key) => {
    if (!Object.hasOwn(values, key) || values[key] === undefined) throw new TypeError("Missing named value");
    parameters.push(values[key]);
    return "?";
  });
  return database.run(query, parameters);
}

export async function insertIfAbsent(database, sql, values, lookupSql, lookupValues) {
  try { return await database.run(sql, values); }
  catch (error) {
    if (error?.code !== "ER_DUP_ENTRY" || !await database.get(lookupSql, lookupValues)) throw error;
    return { affectedRows: 0, warningStatus: 0, insertId: 0 };
  }
}
