import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildMysqlSchema } from "../src/mysqlSchema.js";
import { loadSqliteExport } from "../src/sqliteExportReader.js";

// This is schema metadata only. All rows below are synthetic; the production
// snapshot and any existing private export are never opened by this test.
const audit = JSON.parse(fs.readFileSync(new URL("../../docs/aliyun-source-schema-audit.json", import.meta.url), "utf8"));
const schema = buildMysqlSchema(audit);
const sourceHash = "a".repeat(64);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const line = (value) => Buffer.from(canonical(value) + "\n");
const typed = (type, value) => ({ type, value });

function syntheticRow(name, overrides = {}) {
  const target = schema.tables.find((table) => table.name === name);
  return { kind: "row", table: name, values: target.columns.map((column) => overrides[column.name] ||
    (column.nullable ? typed("null", null) : column.sourceType === "INTEGER" ? typed("integer", "1") :
      column.sourceType === "REAL" ? typed("real", "0.1") : typed("text", "synthetic"))) };
}

function fixture(t, initialRows = [
  syntheticRow("facilities", { latitude: typed("real", "5e-324"), longitude: typed("real", "-0.0") }),
  syntheticRow("schema_migrations", { version: typed("integer", "9223372036854775807") }),
  syntheticRow("schema_migrations", { version: typed("integer", "-9223372036854775808") }),
  syntheticRow("users", { name: typed("text", "PRIVATE_TEXT\n中🏃\u2028\u2029\u007f\u0000"), phone: typed("text", "🏃".repeat(64)),
    password_hash: typed("text", "PRIVATE_PASSWORD_HASH"), password_salt: typed("text", "PRIVATE_PASSWORD_SALT") }),
]) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "sqlite-reader-synthetic-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith("sqlite-reader-synthetic-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, "synthetic.jsonl");
  let rows = structuredClone(initialRows);
  const manifest = {
    user_version: audit.user_version,
    schema_objects: audit.schema_objects.map(({ type, name, tbl_name, schema_sql }) => ({ type, name, table_name: tbl_name, sql: schema_sql })),
    tables: audit.tables.map((table) => ({ name: table.name, row_count: 0,
      exported_columns: table.columns.filter((column) => column.hidden === 0).map((column) => column.name),
      table_xinfo: structuredClone(table.columns), indexes: structuredClone(table.indexes), foreign_keys: structuredClone(table.foreign_keys) })),
  };
  const header = { kind: "header", format: "outdoor-fit-sqlite-export", format_version: 1,
    source: { sha256: sourceHash, bytes: 4096 }, sqlite_version: "3.40.1", manifest, manifest_sha256: "" };
  const options = { expectedSourceSha256: sourceHash, audit };
  function render({ mutateFooter = () => {}, mutateLines = (value) => value, keepCounts = false } = {}) {
    if (!keepCounts) for (const table of manifest.tables) table.row_count = rows.filter((row) => row.table === table.name).length;
    header.manifest_sha256 = sha(canonical(manifest));
    const rowLines = rows.map(line);
    const raw = [line(header), ...rowLines];
    const footer = { kind: "footer", source_sha256: sourceHash, manifest_sha256: header.manifest_sha256,
      row_count: rows.length, tables: manifest.tables.map((table) => ({ name: table.name,
        row_count: rows.filter((row) => row.table === table.name).length,
        sha256: sha(Buffer.concat(rowLines.filter((_, index) => rows[index].table === table.name))) })),
      stream_sha256: sha(Buffer.concat(raw)) };
    mutateFooter(footer);
    const bytes = Buffer.concat(mutateLines([...raw, line(footer)]));
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    return bytes;
  }
  return { directory, file, manifest, header, options, render, get rows() { return rows; }, set rows(value) { rows = value; } };
}

function expectFailure(context, code) {
  assert.throws(() => loadSqliteExport(context.file, context.options), (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /PRIVATE_|synthetic\.jsonl/);
    return true;
  });
}

test("valid full-schema export preserves integers, finite reals, Unicode, nulls and all digests without changing its file", (t) => {
  const context = fixture(t);
  const bytes = context.render();
  const before = fs.statSync(context.file, { bigint: true });
  const result = loadSqliteExport(context.file, context.options);
  assert.equal(result.schema.sourceTableCount, 38);
  assert.equal(result.tables.length, 38);
  assert.equal(result.rowCount, 4);
  assert.equal(result.sourceSha256, sourceHash);
  assert.equal(result.manifestSha256, context.header.manifest_sha256);
  assert.equal(result.exportSha256, sha(bytes));
  const migrations = result.tables.find((table) => table.name === "schema_migrations");
  assert.deepEqual(migrations.rows.map((row) => row[0]), ["9223372036854775807", "-9223372036854775808"]);
  const facilities = result.tables.find((table) => table.name === "facilities");
  assert.equal(facilities.rows[0][facilities.columns.indexOf("latitude")], Number.MIN_VALUE);
  assert.ok(Object.is(facilities.rows[0][facilities.columns.indexOf("longitude")], -0));
  const users = result.tables.find((table) => table.name === "users");
  assert.equal(users.rows[0][users.columns.indexOf("name")], "PRIVATE_TEXT\n中🏃\u2028\u2029\u007f\u0000");
  assert.equal(users.rows[0][users.columns.indexOf("phone")], "🏃".repeat(64));
  assert.equal(users.rows[0][users.columns.indexOf("email")], null);
  assert.equal(result.tables.find((table) => table.name === "admin_accounts").rowCount, 0);
  assert.deepEqual(fs.readFileSync(context.file), bytes);
  const after = fs.statSync(context.file, { bigint: true });
  for (const key of ["ino", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
});

test("header source hash, manifest hash and reviewed structure are independently enforced", (t) => {
  const context = fixture(t);
  context.render();
  context.options.expectedSourceSha256 = "b".repeat(64);
  expectFailure(context, "SQLITE_EXPORT_SOURCE_MISMATCH");
  context.options.expectedSourceSha256 = sourceHash;
  context.render({ mutateLines: (lines) => {
    const header = JSON.parse(lines[0]); header.manifest_sha256 = "0".repeat(64); lines[0] = line(header); return lines;
  } });
  expectFailure(context, "SQLITE_EXPORT_MANIFEST_HASH_MISMATCH");
  context.manifest.tables[0].table_xinfo[0].type = "BLOB";
  context.render();
  expectFailure(context, "SQLITE_EXPORT_SCHEMA_MISMATCH");
  context.options.audit = {};
  expectFailure(context, "SQLITE_EXPORT_SCHEMA_MISMATCH");
});

test("column mapping and table ordering cannot be changed even after all hashes are recomputed", (t) => {
  const context = fixture(t);
  context.manifest.tables[0].exported_columns.reverse();
  context.render();
  expectFailure(context, "SQLITE_EXPORT_COLUMNS_MISMATCH");
  context.manifest.tables[0].exported_columns.reverse();
  context.manifest.tables.reverse();
  context.render();
  expectFailure(context, "SQLITE_EXPORT_SCHEMA_MISMATCH");
  context.manifest.tables.reverse();
  context.rows.reverse();
  context.render();
  expectFailure(context, "SQLITE_EXPORT_ROW_ORDER_INVALID");
});

test("footer and per-table/stream hashes and counts reject tampering", (t) => {
  const context = fixture(t);
  for (const [mutateFooter, code] of [
    [(footer) => { footer.source_sha256 = "b".repeat(64); }, "SQLITE_EXPORT_FOOTER_MISMATCH"],
    [(footer) => { footer.row_count++; }, "SQLITE_EXPORT_FOOTER_MISMATCH"],
    [(footer) => { footer.tables[0].row_count++; }, "SQLITE_EXPORT_ROW_COUNT_MISMATCH"],
    [(footer) => { footer.tables[0].sha256 = "0".repeat(64); }, "SQLITE_EXPORT_TABLE_HASH_MISMATCH"],
    [(footer) => { footer.stream_sha256 = "0".repeat(64); }, "SQLITE_EXPORT_STREAM_HASH_MISMATCH"],
  ]) {
    context.render({ mutateFooter });
    expectFailure(context, code);
  }
  context.render();
  const users = context.manifest.tables.find((table) => table.name === "users");
  users.row_count++;
  context.render({ keepCounts: true });
  expectFailure(context, "SQLITE_EXPORT_ROW_COUNT_MISMATCH");
});

test("signed BIGINT strings reject overflow, decimals, coercion and numeric JSON values", (t) => {
  const context = fixture(t, [syntheticRow("schema_migrations")]);
  for (const [value, code] of [
    [typed("integer", "9223372036854775808"), "SQLITE_EXPORT_INTEGER_RANGE"],
    [typed("integer", "-9223372036854775809"), "SQLITE_EXPORT_INTEGER_RANGE"],
    [typed("integer", "01"), "SQLITE_EXPORT_INTEGER_INVALID"],
    [typed("integer", "-0"), "SQLITE_EXPORT_INTEGER_INVALID"],
    [typed("integer", "1e3"), "SQLITE_EXPORT_INTEGER_INVALID"],
    [typed("integer", 42), "SQLITE_EXPORT_VALUE_TYPE_INVALID"],
    [typed("real", "1.0"), "SQLITE_EXPORT_INTEGER_INVALID"],
    [typed("null", null), "SQLITE_EXPORT_NULL_NOT_ALLOWED"],
  ]) {
    context.rows[0].values[0] = value; context.render(); expectFailure(context, code);
  }
});

test("DOUBLE rejects nonfinite/underflow/coerced representations and accepts Python exponent forms", (t) => {
  const context = fixture(t, [syntheticRow("facilities")]);
  const index = schema.tables.find((table) => table.name === "facilities").columns.findIndex((column) => column.name === "latitude");
  for (const value of ["NaN", "Infinity", "1e309", "1e-999", "0x10", " 0.1", "PRIVATE_REAL"]) {
    context.rows[0].values[index] = typed("real", value); context.render(); expectFailure(context, "SQLITE_EXPORT_REAL_INVALID");
  }
  for (const value of ["1e-07", "1.2345678901234567", "1.7976931348623157e+308"]) {
    context.rows[0].values[index] = typed("real", value); context.render();
    assert.equal(loadSqliteExport(context.file, context.options).tables.find((table) => table.name === "facilities").rows[0][index], Number(value));
  }
});

test("TEXT checks code-point widths, byte limits, type mapping and Unicode scalar validity", (t) => {
  const context = fixture(t, [syntheticRow("users")]);
  const columns = schema.tables.find((table) => table.name === "users").columns;
  const phone = columns.findIndex((column) => column.name === "phone");
  const name = columns.findIndex((column) => column.name === "name");
  context.rows[0].values[phone] = typed("text", "🏃".repeat(65));
  context.render(); expectFailure(context, "SQLITE_EXPORT_TEXT_TOO_LONG");
  context.rows[0].values[phone] = typed("blob", "AA==");
  context.render(); expectFailure(context, "SQLITE_EXPORT_VALUE_TYPE_INVALID");
  context.rows[0].values[phone] = typed("text", "ok");
  context.rows[0].values[name] = typed("text", "PRIVATE_\ud800");
  context.render(); expectFailure(context, "SQLITE_EXPORT_UNICODE_INVALID");
  context.rows[0].values[name] = typed("text", "中".repeat(5592406));
  context.render(); expectFailure(context, "SQLITE_EXPORT_TEXT_TOO_LONG");
});

test("canonical wire checks reject duplicate keys, unsafe metadata integers and malformed UTF-8 without leaking fragments", (t) => {
  const context = fixture(t);
  context.render({ mutateLines: (lines) => { lines[0] = Buffer.from(lines[0].toString().replace('"format_version":1', '"format_version":1,"format_version":1')); return lines; } });
  expectFailure(context, "SQLITE_EXPORT_NONCANONICAL_JSON");
  context.render({ mutateLines: (lines) => { lines[0] = Buffer.from(lines[0].toString().replace('"bytes":4096', '"bytes":9007199254740993')); return lines; } });
  expectFailure(context, "SQLITE_EXPORT_NUMBER_INVALID");
  context.render({ mutateLines: (lines) => { lines[1] = Buffer.from([0xff, 0x0a]); return lines; } });
  expectFailure(context, "SQLITE_EXPORT_JSON_INVALID");
  context.render({ mutateLines: (lines) => { lines[1] = Buffer.from('{"PRIVATE_SECRET"\n'); return lines; } });
  expectFailure(context, "SQLITE_EXPORT_JSON_INVALID");
});

test("missing footer, missing LF, extra footer and wrong row width are rejected", (t) => {
  const context = fixture(t);
  context.render({ mutateLines: (lines) => lines.slice(0, -1) });
  expectFailure(context, "SQLITE_EXPORT_TRUNCATED");
  context.render({ mutateLines: (lines) => [...lines.slice(0, -1), lines.at(-1).subarray(0, -1)] });
  expectFailure(context, "SQLITE_EXPORT_TRUNCATED");
  context.render({ mutateLines: (lines) => [...lines, lines.at(-1)] });
  expectFailure(context, "SQLITE_EXPORT_FOOTER_INVALID");
  context.rows[0].values.pop(); context.render();
  expectFailure(context, "SQLITE_EXPORT_ROW_WIDTH_INVALID");
});

test("nonregular, missing and symlink paths are refused; reading never creates a missing file", (t) => {
  const context = fixture(t);
  expectFailure(context, "SQLITE_EXPORT_READ_FAILED");
  assert.equal(fs.existsSync(context.file), false);
  assert.throws(() => loadSqliteExport(context.directory, context.options), { code: "SQLITE_EXPORT_NOT_REGULAR_FILE" });
  context.render();
  const aliasDirectory = path.join(context.directory, "linked-directory");
  fs.symlinkSync(context.directory, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => loadSqliteExport(path.join(aliasDirectory, "synthetic.jsonl"), context.options), { code: "SQLITE_EXPORT_SYMLINK_REFUSED" });
  fs.unlinkSync(aliasDirectory);
});

test("file and line byte limits fail before interpreting oversized input", (t) => {
  const context = fixture(t);
  const descriptor = fs.openSync(context.file, "w", 0o600);
  fs.ftruncateSync(descriptor, 128 * 1024 * 1024 + 1); fs.closeSync(descriptor);
  expectFailure(context, "SQLITE_EXPORT_FILE_SIZE_INVALID");
  const bytes = Buffer.alloc(64 * 1024 * 1024 + 1, 0x20); bytes[bytes.length - 1] = 10;
  fs.writeFileSync(context.file, bytes);
  expectFailure(context, "SQLITE_EXPORT_LINE_TOO_LARGE");
});
