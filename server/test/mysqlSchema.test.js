import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { buildMysqlSchema, sourceSchemaFingerprint, REVIEWED_SOURCE_SCHEMA_HASH } from "../src/mysqlSchema.js";

const audit = JSON.parse(fs.readFileSync(new URL("../../docs/aliyun-source-schema-audit.json", import.meta.url), "utf8"));
const schema = buildMysqlSchema(audit);
const table = (name) => schema.tables.find((item) => item.name === name);
const column = (name, field) => table(name).columns.find((item) => item.name === field);
const mutableAudit = () => structuredClone(audit);

test("reviewed snapshot compiles 38 complete tables and 324 original columns separately from internals", () => {
  assert.equal(schema.sourceSchemaHash, REVIEWED_SOURCE_SCHEMA_HASH);
  assert.equal(schema.sourceTableCount, 38);
  assert.equal(schema.sourceColumnCount, 324);
  assert.equal(schema.tables.reduce((sum, item) => sum + item.columns.length, 0), 324);
  assert.equal(schema.tables.reduce((sum, item) => sum + item.internalColumns.length, 0), 9);
  assert.deepEqual(schema.tables.map((item) => item.name), audit.tables.map((item) => item.name).sort());
  for (const original of audit.tables) {
    assert.deepEqual(table(original.name).columns.map((item) => item.name), original.columns.map((item) => item.name));
    assert.deepEqual(table(original.name).sourcePrimaryKey, original.columns.filter((item) => item.pk).sort((a, b) => a.pk - b.pk).map((item) => item.name));
  }
});

test("schema fingerprint ignores changed data counts, audit paths, timestamps and input array ordering", () => {
  const changed = mutableAudit();
  changed.source = { database_path: "somewhere-else", sha256: "new-backup" };
  changed.generated_at_utc = "different-time";
  changed.tool = { sqlite_version: "different-runtime" };
  changed.tables.reverse();
  changed.schema_objects.reverse();
  for (const item of changed.tables) {
    item.row_count += 123;
    item.indexes.reverse();
    item.foreign_keys.reverse();
    for (const foreign of item.foreign_keys) foreign.id += 100;
  }
  assert.equal(sourceSchemaFingerprint(changed), REVIEWED_SOURCE_SCHEMA_HASH);
  assert.deepEqual(buildMysqlSchema(changed).statements, schema.statements);
});

test("unknown columns, types, defaults, indexes, CHECKs and foreign-key actions fail closed without echoing input", () => {
  const mutations = [
    (value) => value.tables.push({ ...value.tables[0], name: "unreviewed_secret" }),
    (value) => value.tables[0].columns.push({ ...value.tables[0].columns[0], name: "unreviewed_secret", cid: 100 }),
    (value) => { value.tables[0].columns[0].type = "BLOB"; },
    (value) => { value.tables[0].columns[0].dflt_value = "'unreviewed_secret'"; },
    (value) => { value.tables[0].indexes[0].unique = 1; },
    (value) => { value.tables[0].indexes[0].columns[0].coll = "NOCASE"; },
    (value) => { value.tables[0].foreign_keys[0].on_delete = "CASCADE"; },
    (value) => { value.schema_objects.find((item) => item.type === "table").schema_sql += " CHECK (unreviewed_secret = 1)"; },
  ];
  for (const mutate of mutations) {
    const changed = mutableAudit();
    mutate(changed);
    assert.throws(() => buildMysqlSchema(changed), (error) => {
      assert.equal(error.code, "MYSQL_SOURCE_SCHEMA_UNREVIEWED");
      assert.doesNotMatch(error.message, /unreviewed_secret/);
      return true;
    });
  }
  for (const invalid of [undefined, {}, { format_version: 1, tables: [{}], schema_objects: [] }]) {
    assert.throws(() => buildMysqlSchema(invalid), { code: "MYSQL_SOURCE_SCHEMA_UNREVIEWED" });
  }
});

test("every integer is signed BIGINT and every real is DOUBLE, including millisecond timestamps", () => {
  for (const original of audit.tables) for (const source of original.columns) {
    if (source.type === "INTEGER") assert.equal(column(original.name, source.name).mysqlType, "BIGINT");
    if (source.type === "REAL") assert.equal(column(original.name, source.name).mysqlType, "DOUBLE");
  }
  assert.equal(column("equipment_document_previews", "created_at").mysqlType, "BIGINT");
  assert.equal(column("equipment_document_previews", "expires_at").mysqlType, "BIGINT");
  assert.equal(column("users", "created_at").mysqlType, "VARCHAR(32)");
  assert.equal(column("system_logs", "target_id").mysqlType, "MEDIUMTEXT");
});

test("large JSON/avatar fields and all JSON columns remain strings, and API widths exceed observed data maxima", () => {
  for (const item of schema.tables) for (const field of item.columns) {
    if (field.name.endsWith("_json")) {
      assert.equal(field.mysqlType, "MEDIUMTEXT");
      assert.equal(field.maxBytes, 16777215);
    }
  }
  assert.equal(column("users", "avatar_data").mysqlType, "MEDIUMTEXT");
  for (const [name, field, width] of [
    ["users", "phone", 64], ["exercise_sessions", "id", 100], ["exercise_session_revisions", "session_id", 100],
    ["feedback", "submission_id", 128], ["app_equipment_items", "id", 200], ["facility_learning_progress", "equipment_id", 200],
    ["equipment_locations", "equipment_id", 200], ["media_seed_items", "import_id", 100],
  ]) assert.equal(column(name, field).maxCharacters, width);
});

test("nullable values, empty sentinels and expression defaults survive without inventing defaults", () => {
  for (const original of audit.tables) for (const source of original.columns) {
    const target = column(original.name, source.name);
    assert.equal(target.nullable, !source.notnull && !source.pk);
    if (source.dflt_value === null) assert.equal(target.defaultSql, null);
  }
  assert.equal(column("users", "email").nullable, true);
  assert.equal(column("app_equipment_items", "tcm_enabled").nullable, true);
  assert.equal(column("app_text_overrides", "zh").nullable, true);
  assert.equal(column("media_folders", "parent_id").defaultValue, "");
  assert.equal(column("media_files", "folder_id").defaultValue, "");
  assert.equal(column("facility_learning_progress", "learning_date").defaultValue, "");
  assert.equal(column("research_events", "metadata_json").defaultSql, "('{}')");
  assert.equal(column("app_equipment_items", "categories_json").defaultSql, "('[]')");
  assert.equal(column("app_equipment_items", "details_zh").defaultSql, "('')");
  assert.equal(column("users", "id").nullable, false);
});

test("all text uses binary NO PAD collation without ASCII narrowing", () => {
  for (const item of schema.tables) for (const field of [...item.columns, ...item.internalColumns]) {
    if (field.mysqlType === "MEDIUMTEXT" || field.mysqlType.startsWith("VARCHAR")) {
      assert.equal(field.charset, "utf8mb4");
      assert.equal(field.collation, "utf8mb4_0900_bin");
    } else {
      assert.equal(field.charset, null);
      assert.equal(field.collation, null);
    }
  }
  for (const item of schema.tables) assert.match(item.createSql, /ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin$/);
});

test("long unique strings preserve original values and use complete generated digests, never unique prefixes", () => {
  const expected = [
    ["users", "email", []], ["media_files", "url", []], ["push_tokens", "expo_push_token", []],
    ["facilities", "source_id", []], ["media_seed_folders", "folder_path", ["import_id"]],
  ];
  for (const [name, field, scope] of expected) {
    const item = table(name);
    assert.equal(column(name, field).mysqlType, "MEDIUMTEXT");
    const digest = item.digestKeys[0];
    assert.equal(digest.sourceColumn, field);
    assert.deepEqual(digest.scopeColumns, scope);
    const generated = item.internalColumns.find((entry) => entry.name === digest.digestColumn);
    assert.equal(generated.mysqlType, "BINARY(32)");
    assert.equal(generated.generatedExpression, `UNHEX(SHA2(CAST(\`${field}\` AS BINARY),256))`);
    assert.equal(generated.nullable, true);
    const unique = item.indexes.find((entry) => entry.name === digest.indexName);
    assert.equal(unique.unique, true);
    assert.deepEqual(unique.columns.map((entry) => entry.name), [...scope, digest.digestColumn]);
  }
  for (const item of schema.tables) for (const index of item.indexes) {
    if (index.unique) assert.ok(index.columns.every((key) => key.prefixLength === null));
  }
  for (const name of ["facilities", "media_seed_folders"]) {
    const item = table(name);
    assert.equal(item.internalColumns.find((entry) => entry.name === "__mysql_row_id").autoIncrement, true);
    assert.deepEqual(item.indexes.find((entry) => entry.primary).columns.map((entry) => entry.name), ["__mysql_row_id"]);
    assert.equal(schema.tables.flatMap((entry) => entry.foreignKeys).some((entry) => entry.referencedTable === name), false);
  }
});

test("partial uniqueness uses nullable generated keys with the original active predicates", () => {
  const folders = table("media_folders");
  const activeName = folders.internalColumns.find((entry) => entry.name === "__active_name");
  assert.equal(activeName.generatedExpression, "CASE WHEN `deleted_at` IS NULL THEN `name` ELSE NULL END");
  assert.equal(activeName.nullable, true);
  assert.deepEqual(folders.indexes.find((entry) => entry.name === "media_folder_active_name").columns.map((entry) => entry.name), ["parent_id", "__active_name"]);
  const codes = table("registration_codes");
  assert.equal(codes.internalColumns.find((entry) => entry.name === "__active_phone").generatedExpression,
    "CASE WHEN `used_at` IS NULL AND `revoked_at` IS NULL THEN `phone` ELSE NULL END");
  assert.deepEqual(codes.indexes.find((entry) => entry.name === "registration_codes_active_phone").columns.map((entry) => entry.name), ["__active_phone"]);
});

test("all 33 foreign keys preserve their exact graph, delete actions and type compatibility", () => {
  const expected = audit.tables.flatMap((item) => item.foreign_keys.map((entry) => [item.name, entry.from, entry.table, entry.to, entry.on_delete, entry.on_update].join("|"))).sort();
  const actual = schema.tables.flatMap((item) => item.foreignKeys.map((entry) => [item.name, entry.columns[0], entry.referencedTable, entry.referencedColumns[0], entry.onDelete, entry.onUpdate].join("|"))).sort();
  assert.equal(actual.length, 33);
  assert.deepEqual(actual, expected);
  for (const item of schema.tables) for (const foreign of item.foreignKeys) {
    const parent = column(foreign.referencedTable, foreign.referencedColumns[0]);
    const child = column(item.name, foreign.columns[0]);
    assert.deepEqual([child.mysqlType, child.charset, child.collation], [parent.mysqlType, parent.charset, parent.collation]);
    assert.ok(item.indexes.some((index) => index.columns[0].name === foreign.columns[0] && !index.columns[0].descending && !index.columns[0].prefixLength));
  }
});

test("source indexes are all represented, DESC directions survive, and complete key budgets fit 16 KiB pages", () => {
  for (const original of audit.tables) for (const index of original.indexes) {
    assert.ok(table(original.name).indexes.some((entry) => entry.sourceName === index.name), `${original.name}:${index.name}`);
  }
  const descending = table("feedback").indexes.find((entry) => entry.name === "feedback_created");
  assert.deepEqual(descending.columns.map((entry) => entry.descending), [true, true]);
  assert.equal(table("facilities").indexes.find((entry) => entry.name === "facilities_name_zh").columns[0].prefixLength, 191);
  assert.equal(schema.tables.reduce((sum, item) => sum + item.indexes.length, 0), 96);
  assert.equal(Math.max(...schema.tables.flatMap((item) => item.indexes.map((index) => index.keyBytesWithPrimary))), 1728);
  for (const item of schema.tables) for (const index of item.indexes) {
    assert.ok(index.keyBytes > 0 && index.keyBytes <= 3072);
    assert.ok(index.keyBytesWithPrimary >= index.keyBytes && index.keyBytesWithPrimary <= 3072);
  }
});

test("learning-date CHECK preserves SQLite storage-format acceptance including empty sentinel", () => {
  const database = new Database(":memory:");
  database.function("CHAR_LENGTH", (value) => value === null ? null : [...value].length);
  try {
    const expression = table("facility_learning_progress").checks[0].expression;
    assert.doesNotMatch(expression, /GLOB|REGEXP/);
    const translated = database.prepare(`SELECT (${expression}) AS valid FROM (SELECT ? AS learning_date)`);
    const original = database.prepare("SELECT learning_date = '' OR (length(learning_date) = 10 AND learning_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') AS valid FROM (SELECT ? AS learning_date)");
    for (const value of ["", "2026-09-24", "0000-00-99", "2026-9-24", "2026-09-24 ", "２０２６-09-24", "2026/09/24", "a026-09-24", "2026-09-2a", "2026-09-24\n", null]) {
      assert.equal(translated.get(value).valid, original.get(value).valid, JSON.stringify(value));
    }
  } finally { database.close(); }
});

test("every audited CHECK has an explicit target constraint and identifiers are globally safe", () => {
  const sourceCount = audit.schema_objects.filter((item) => item.type === "table").reduce((sum, item) => sum + (item.schema_sql.match(/\bCHECK\s*\(/gi) || []).length, 0);
  assert.equal(sourceCount, 29);
  assert.equal(schema.tables.reduce((sum, item) => sum + item.checks.length, 0), sourceCount);
  const constraints = schema.tables.flatMap((item) => [...item.foreignKeys, ...item.checks].map((entry) => entry.name));
  assert.equal(new Set(constraints).size, constraints.length);
  for (const name of constraints) assert.match(name, /^[a-z_][a-z0-9_]{0,63}$/);
});

test("DDL creates everything before adding foreign keys, orders parents before children and performs no destructive actions", () => {
  assert.equal(schema.statements.length, 71);
  assert.ok(schema.statements.slice(0, 38).every((entry) => entry.kind === "table" && /^CREATE TABLE /.test(entry.sql)));
  assert.ok(schema.statements.slice(38).every((entry) => entry.kind === "foreign_key" && /^ALTER TABLE .* ADD CONSTRAINT /.test(entry.sql)));
  for (const item of schema.tables) for (const foreign of item.foreignKeys) {
    assert.ok(schema.createOrder.indexOf(foreign.referencedTable) < schema.createOrder.indexOf(item.name));
  }
  for (const { sql } of schema.statements) assert.doesNotMatch(sql, /IF NOT EXISTS|\bDROP\b|\bTRUNCATE\b|FOREIGN_KEY_CHECKS|^INSERT |^UPDATE |^DELETE /);
});
