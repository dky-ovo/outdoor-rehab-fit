import { createHash } from "node:crypto";

export const MYSQL_SCHEMA_FORMAT_VERSION = 1;
export const MYSQL_CHARSET = "utf8mb4";
export const MYSQL_COLLATION = "utf8mb4_0900_bin";
// Binds generation to reviewed structural metadata, never to business values,
// row counts, backup location, backup hash or audit-generation timestamps.
export const REVIEWED_SOURCE_SCHEMA_HASH = "eb0a3714329b76a1cb66ed3acc8dfa0a80d0ce98fbe732eab6910ba035a96feb";

const TABLE_RULES = {
  admin_accounts: { ids: "user_id created_by", widths: { system_role: 32 } },
  ai_configuration: { ids: "id updated_by" },
  app_equipment_items: { ids: "created_by", widths: { id: 200 } },
  app_sessions: { ids: "id user_id" },
  app_text_overrides: { ids: "updated_by", widths: { text_key: 200 } },
  content_items: { ids: "id created_by", widths: { page_key: 80 } },
  conversation_members: { ids: "conversation_id user_id" },
  conversations: { ids: "id created_by" },
  equipment_categories: { ids: "id" },
  equipment_document_commits: { ids: "actor_id preview_id", widths: { idempotency_key: 36 } },
  equipment_document_previews: { ids: "id actor_id" },
  equipment_locations: { ids: "id created_by", widths: { equipment_id: 200 } },
  equipment_tcm_content_updates: { widths: { revision: 200 } },
  exercise_session_revisions: { ids: "id user_id session_id" },
  exercise_sessions: { ids: "id user_id" },
  facilities: { surrogate: true, digest: "source_id" },
  facility_learning_progress: { ids: "user_id", widths: { equipment_id: 200, learning_date: 10 } },
  facility_sources: { ids: "id updated_by" },
  facility_sync_runs: { ids: "id source_id triggered_by" },
  feedback: { ids: "id user_id", widths: { submission_id: 128, status: 32 } },
  guest_profiles: { ids: "id" },
  media_categories: { ids: "id", widths: { name: 80 } },
  media_files: { ids: "id category_id created_by folder_id", widths: { name: 200, kind: 16 }, digest: "url" },
  media_folders: { ids: "id parent_id", widths: { name: 200 } },
  media_seed_folders: { ids: "import_id folder_id", surrogate: true, digest: "folder_path", digestScope: ["import_id"] },
  media_seed_items: { ids: "import_id file_id", widths: { file_name: 255 } },
  media_seed_video_bindings: { ids: "import_id" },
  message_reactions: { ids: "message_id user_id", widths: { emoji: 32 } },
  messages: { ids: "id conversation_id sender_id" },
  push_tokens: { ids: "id user_id", digest: "expo_push_token" },
  registration_codes: { ids: "id created_by used_by revoked_by", widths: { code_hash: 64, phone: 64 } },
  research_consents: { ids: "id user_id" },
  research_events: { ids: "id participant_id" },
  schema_migrations: {},
  sms_verifications: { ids: "id", widths: { phone: 64 } },
  system_logs: { ids: "id actor_user_id" },
  users: { ids: "id", widths: { phone: 64 }, digest: "email" },
  volunteer_participants: { ids: "volunteer_user_id participant_user_id" },
};

// Explicit translations: no source DDL text is executed or interpolated.
const CHECKS = {
  admin_accounts: ["system_role IN ('super_admin', 'admin', 'operator')", "is_active IN (0, 1)"],
  ai_configuration: ["is_enabled IN (0, 1)"],
  app_equipment_items: ["is_custom IN (0, 1)", "is_active IN (0, 1)", "tcm_enabled IN (0, 1)", "video_localized IN (0, 1)"],
  content_items: ["content_type IN ('video', 'text', 'feature')"],
  conversation_members: ["member_role IN ('owner', 'moderator', 'member')"],
  conversations: ["type IN ('direct', 'group', 'support')"],
  equipment_locations: ["latitude >= -90 AND latitude <= 90", "longitude >= -180 AND longitude <= 180", "is_active IN (0, 1)"],
  exercise_sessions: ["mode IN ('outdoor', 'home')"],
  facilities: ["is_active IN (0, 1)"],
  facility_sources: ["is_active IN (0, 1)"],
  facility_sync_runs: ["status IN ('running', 'success', 'failed')"],
  feedback: ["submitter_type IN ('guest', 'registered')", "locale IN ('zh', 'en')", "status IN ('new', 'in_progress', 'resolved')"],
  guest_profiles: ["age BETWEEN 18 AND 120", "gender IN ('female', 'male', 'other')", "purpose IN ('personal', 'family', 'industry')"],
  media_files: ["kind IN ('image', 'video', 'file')", "source IN ('upload', 'legacy', 'external', 'youtube')"],
  messages: ["message_type IN ('text', 'image', 'system')"],
  registration_codes: ["profile_role IN ('participant', 'staff')"],
  research_consents: ["status IN ('granted', 'withdrawn')"],
};

function fail(code = "MYSQL_SOURCE_SCHEMA_UNREVIEWED") {
  throw Object.assign(new Error("SQLite schema does not match the reviewed MySQL migration contract"), { code });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const json = (value) => JSON.stringify(stable(value));
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function sourceSchemaFingerprint(audit) {
  try {
    if (audit?.format_version !== 1 || !Array.isArray(audit.tables) || !Array.isArray(audit.schema_objects)) fail();
    const tables = audit.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map(({ cid, name, type, notnull, dflt_value, pk, hidden }) => ({ cid, name, type, notnull, dflt_value, pk, hidden })).sort((a, b) => a.cid - b.cid),
      indexes: table.indexes.map((index) => ({
        name: index.name, unique: index.unique, origin: index.origin, partial: index.partial,
        columns: index.columns.filter((column) => column.key).map(({ seqno, name, desc, coll, key }) => ({ seqno, name, desc, coll, key })).sort((a, b) => a.seqno - b.seqno),
      })).sort(byName),
      foreignKeys: table.foreign_keys.map(({ seq, table: parent, from, to, on_update, on_delete, match }) => ({ seq, table: parent, from, to, on_update, on_delete, match })).sort((a, b) => json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0),
    })).sort(byName);
    const objects = audit.schema_objects.map(({ type, name, tbl_name, schema_sql }) => ({ type, name, tbl_name, schema_sql })).sort(byName);
    return hash(json({ userVersion: audit.user_version, tables, objects }));
  } catch (error) {
    if (error?.code === "MYSQL_SOURCE_SCHEMA_UNREVIEWED") throw error;
    fail();
  }
}

function quote(name) {
  if (typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,63}$/.test(name)) fail();
  return `\`${name}\``;
}

function constraintName(name) {
  return name.length <= 64 ? name : `${name.slice(0, 51)}_${hash(name).slice(0, 12)}`;
}

function literal(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && !/[\\\u0000-\u001f]/.test(value)) return `'${value.replaceAll("'", "''")}'`;
  fail();
}

function sourceDefault(source) {
  if (source === null) return null;
  if (typeof source !== "string") fail();
  if (/^-?\d+$/.test(source) && Number.isSafeInteger(Number(source))) return Number(source);
  if (/^'(?:[^']|'')*'$/.test(source)) return source.slice(1, -1).replaceAll("''", "'");
  fail();
}

function columnFromSource(source, rule) {
  let mysqlType;
  if (source.type === "INTEGER") mysqlType = "BIGINT";
  else if (source.type === "REAL") mysqlType = "DOUBLE";
  else if (source.type === "TEXT") {
    const width = rule.widths?.[source.name] ?? ((rule.ids || "").split(" ").includes(source.name) ? 100 : undefined)
      ?? (source.name.endsWith("_at") || source.name === "event_time" ? 32 : undefined);
    mysqlType = width ? `VARCHAR(${width})` : "MEDIUMTEXT";
  } else fail();
  const defaultValue = sourceDefault(source.dflt_value);
  return {
    name: source.name, sourceType: source.type, mysqlType,
    nullable: !source.notnull && !source.pk, sourcePrimaryKeyPosition: source.pk,
    charset: source.type === "TEXT" ? MYSQL_CHARSET : null,
    collation: source.type === "TEXT" ? MYSQL_COLLATION : null,
    defaultValue,
    defaultSql: source.dflt_value === null ? null : mysqlType === "MEDIUMTEXT" ? `(${literal(defaultValue)})` : literal(defaultValue),
    generatedExpression: null, autoIncrement: false,
    ...(mysqlType.startsWith("VARCHAR") ? { maxCharacters: Number(mysqlType.match(/\d+/)[0]) } : {}),
    ...(mysqlType === "MEDIUMTEXT" ? { maxBytes: 16777215 } : {}),
  };
}

function internalColumn(name, mysqlType, { nullable = true, generatedExpression = null, autoIncrement = false } = {}) {
  return {
    name, mysqlType, nullable, generatedExpression, autoIncrement,
    charset: mysqlType.startsWith("VARCHAR") ? MYSQL_CHARSET : null,
    collation: mysqlType.startsWith("VARCHAR") ? MYSQL_COLLATION : null,
    defaultValue: null, defaultSql: null,
  };
}

function part(name, descending = false, prefixLength = null) { return { name, descending, prefixLength }; }

function indexSql(index) {
  const keys = index.columns.map((column) => `${quote(column.name)}${column.prefixLength ? `(${column.prefixLength})` : ""}${column.descending ? " DESC" : " ASC"}`).join(", ");
  return `${index.primary ? "PRIMARY KEY" : `${index.unique ? "UNIQUE " : ""}KEY ${quote(index.name)}`} (${keys})`;
}

function columnSql(column) {
  let result = `${quote(column.name)} ${column.mysqlType}`;
  if (column.charset) result += ` CHARACTER SET ${column.charset} COLLATE ${column.collation}`;
  if (column.generatedExpression) result += ` GENERATED ALWAYS AS (${column.generatedExpression}) STORED`;
  result += column.nullable ? " NULL" : " NOT NULL";
  if (column.autoIncrement) result += " AUTO_INCREMENT";
  if (column.defaultSql !== null) result += ` DEFAULT ${column.defaultSql}`;
  return result;
}

function learningDateCheck() {
  // MySQL CHECK permits deterministic built-in functions. Avoid REGEXP/GLOB
  // dialect dependencies while preserving the original ASCII shape exactly.
  const digitPositions = [1, 2, 3, 4, 6, 7, 9, 10];
  const digits = "'0','1','2','3','4','5','6','7','8','9'";
  return `learning_date = '' OR (CHAR_LENGTH(learning_date) = 10 AND SUBSTRING(learning_date,5,1) = '-' AND SUBSTRING(learning_date,8,1) = '-' AND ${digitPositions.map((position) => `SUBSTRING(learning_date,${position},1) IN (${digits})`).join(" AND ")})`;
}

function createTable(source) {
  const rule = TABLE_RULES[source.name];
  if (!rule) fail();
  const columns = [...source.columns].sort((a, b) => a.cid - b.cid).map((column) => columnFromSource(column, rule));
  const sourcePrimaryKey = source.columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  const internalColumns = [];
  const digestKeys = [];
  const primaryColumns = rule.surrogate ? ["__mysql_row_id"] : sourcePrimaryKey;
  if (!primaryColumns.length) fail();
  if (rule.surrogate) internalColumns.push(internalColumn("__mysql_row_id", "BIGINT", { nullable: false, autoIncrement: true }));
  if (rule.digest) {
    const name = `__${rule.digest}_sha256`;
    internalColumns.push(internalColumn(name, "BINARY(32)", { generatedExpression: `UNHEX(SHA2(CAST(${quote(rule.digest)} AS BINARY),256))` }));
    digestKeys.push({ sourceColumn: rule.digest, digestColumn: name, scopeColumns: rule.digestScope || [], indexName: null });
  }
  if (source.name === "media_folders") internalColumns.push(internalColumn("__active_name", "VARCHAR(200)", { generatedExpression: "CASE WHEN `deleted_at` IS NULL THEN `name` ELSE NULL END" }));
  if (source.name === "registration_codes") internalColumns.push(internalColumn("__active_phone", "VARCHAR(64)", { generatedExpression: "CASE WHEN `used_at` IS NULL AND `revoked_at` IS NULL THEN `phone` ELSE NULL END" }));
  const indexes = [{ name: "PRIMARY", unique: true, primary: true, columns: primaryColumns.map((name) => part(name)), sourceName: source.indexes.find((index) => index.origin === "pk")?.name ?? null }];
  for (const original of [...source.indexes].sort(byName)) {
    if (original.origin === "pk") continue;
    let parts = original.columns.filter((column) => column.key).sort((a, b) => a.seqno - b.seqno).map((column) => part(column.name, Boolean(column.desc)));
    if (original.partial) {
      if (original.name === "media_folder_active_name") parts = [part("parent_id"), part("__active_name")];
      else if (original.name === "registration_codes_active_phone") parts = [part("__active_phone")];
      else fail();
    } else if (rule.digest && original.unique && parts.length === 1 && parts[0].name === rule.digest) {
      parts = [part(`__${rule.digest}_sha256`)];
    }
    if (source.name === "facilities" && !original.unique) {
      parts = parts.map((column) => ["name_zh", "district_zh"].includes(column.name) ? { ...column, prefixLength: 191 } : column);
    }
    const name = original.origin === "u" ? constraintName(`uq_${source.name}_${parts.map((column) => column.name.replace(/^__/, "")).join("_")}`) : original.name;
    indexes.push({ name, unique: Boolean(original.unique), primary: false, columns: parts, sourceName: original.name });
  }
  if (rule.surrogate) {
    indexes.push({ name: constraintName(`uq_${source.name}_${rule.digest}_sha256`), unique: true, primary: false,
      columns: [...(rule.digestScope || []).map((name) => part(name)), part(`__${rule.digest}_sha256`)],
      sourceName: source.indexes.find((index) => index.origin === "pk")?.name ?? null });
  }
  for (const digest of digestKeys) {
    digest.indexName = indexes.find((index) => index.unique && index.columns.some((column) => column.name === digest.digestColumn))?.name;
    if (!digest.indexName) fail();
  }
  const foreignKeys = [...source.foreign_keys].sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0).map((foreign) => {
    if (foreign.seq !== 0 || !["NO ACTION", "CASCADE", "RESTRICT", "SET NULL"].includes(foreign.on_delete) || foreign.on_update !== "NO ACTION") fail();
    return {
      name: constraintName(`fk_${source.name}_${foreign.from}_${foreign.table}`), columns: [foreign.from],
      referencedTable: foreign.table, referencedColumns: [foreign.to], onDelete: foreign.on_delete, onUpdate: foreign.on_update, sourceId: foreign.id,
    };
  });
  for (const foreign of foreignKeys) {
    const supported = indexes.some((index) => foreign.columns.every((name, position) => index.columns[position]?.name === name && !index.columns[position].prefixLength && !index.columns[position].descending));
    if (!supported) indexes.push({ name: constraintName(`fkidx_${source.name}_${foreign.columns.join("_")}`), unique: false, primary: false, columns: foreign.columns.map((name) => part(name)), sourceName: null });
  }
  const checks = [...(CHECKS[source.name] || []), ...(source.name === "facility_learning_progress" ? [learningDateCheck()] : [])]
    .map((expression, index) => ({ name: `ck_${source.name}_${index + 1}`, expression }));
  const allColumns = new Map([...columns, ...internalColumns].map((column) => [column.name, column]));
  if (allColumns.size !== columns.length + internalColumns.length) fail();
  const bytes = (key) => {
    const column = allColumns.get(key.name);
    if (!column) fail();
    if (key.prefixLength) {
      if (column.mysqlType !== "MEDIUMTEXT") fail();
      return key.prefixLength * 4;
    }
    if (column.mysqlType === "BIGINT" || column.mysqlType === "DOUBLE") return 8;
    const varchar = column.mysqlType.match(/^VARCHAR\((\d+)\)$/);
    if (varchar) return Number(varchar[1]) * 4;
    if (column.mysqlType === "BINARY(32)") return 32;
    fail("MYSQL_INDEX_TYPE_UNSUPPORTED");
  };
  for (const index of indexes) {
    index.keyBytes = index.columns.reduce((sum, key) => sum + bytes(key), 0);
    index.keyBytesWithPrimary = index.keyBytes + (index.primary ? 0 : indexes[0].columns.filter((key) => !index.columns.some((own) => own.name === key.name && !own.prefixLength)).reduce((sum, key) => sum + bytes(key), 0));
    if (index.keyBytes > 3072 || index.keyBytesWithPrimary > 3072) fail("MYSQL_INDEX_TOO_WIDE");
  }
  const definitions = [...columns, ...internalColumns].map(columnSql)
    .concat(indexes.map(indexSql), checks.map((check) => `CONSTRAINT ${quote(check.name)} CHECK (${check.expression})`));
  const createSql = `CREATE TABLE ${quote(source.name)} (\n  ${definitions.join(",\n  ")}\n) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION}`;
  const foreignKeySql = foreignKeys.map((foreign) => `ALTER TABLE ${quote(source.name)} ADD CONSTRAINT ${quote(foreign.name)} FOREIGN KEY (${foreign.columns.map(quote).join(", ")}) REFERENCES ${quote(foreign.referencedTable)} (${foreign.referencedColumns.map(quote).join(", ")}) ON DELETE ${foreign.onDelete} ON UPDATE ${foreign.onUpdate}`);
  return { name: source.name, columns, internalColumns, sourcePrimaryKey, digestKeys, indexes, foreignKeys, checks, createSql, indexSql: [], foreignKeySql };
}

export function buildMysqlSchema(audit) {
  const sourceSchemaHash = sourceSchemaFingerprint(audit);
  if (sourceSchemaHash !== REVIEWED_SOURCE_SCHEMA_HASH) fail();
  if (audit.tables.length !== 38 || audit.tables.reduce((sum, table) => sum + table.columns.length, 0) !== 324) fail();
  const tables = [...audit.tables].sort(byName).map(createTable);
  const byTable = new Map(tables.map((table) => [table.name, table]));
  for (const table of tables) for (const foreign of table.foreignKeys) {
    const parent = byTable.get(foreign.referencedTable);
    if (!parent) fail();
    foreign.columns.forEach((name, index) => {
      const childColumn = table.columns.find((column) => column.name === name);
      const parentColumn = parent.columns.find((column) => column.name === foreign.referencedColumns[index]);
      if (!childColumn || !parentColumn || childColumn.mysqlType !== parentColumn.mysqlType || childColumn.charset !== parentColumn.charset || childColumn.collation !== parentColumn.collation) fail("MYSQL_FOREIGN_KEY_TYPE_MISMATCH");
    });
  }
  const createOrder = [];
  const pending = new Set(tables.map((table) => table.name));
  while (pending.size) {
    const ready = [...pending].filter((name) => byTable.get(name).foreignKeys.every((foreign) => foreign.referencedTable === name || !pending.has(foreign.referencedTable))).sort();
    if (!ready.length) fail("MYSQL_FOREIGN_KEY_CYCLE");
    for (const name of ready) { pending.delete(name); createOrder.push(name); }
  }
  const statements = createOrder.map((name) => ({ kind: "table", table: name, sql: byTable.get(name).createSql }))
    .concat(createOrder.flatMap((name) => byTable.get(name).foreignKeySql.map((sql, index) => ({ kind: "foreign_key", table: name, name: byTable.get(name).foreignKeys[index].name, sql }))));
  return {
    formatVersion: MYSQL_SCHEMA_FORMAT_VERSION, sourceSchemaHash, charset: MYSQL_CHARSET, collation: MYSQL_COLLATION,
    engine: "InnoDB", rowFormat: "Dynamic", requiredInnodbPageSize: 16384,
    sourceTableCount: tables.length, sourceColumnCount: 324,
    foreignKeyCount: tables.reduce((sum, table) => sum + table.foreignKeys.length, 0),
    tables, createOrder, statements,
  };
}
