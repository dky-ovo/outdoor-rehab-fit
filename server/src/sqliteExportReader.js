import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { buildMysqlSchema, sourceSchemaFingerprint, REVIEWED_SOURCE_SCHEMA_HASH } from "./mysqlSchema.js";

const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const INTEGER = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const REAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/;
const minimumInteger = -(1n << 63n);
const maximumInteger = (1n << 63n) - 1n;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");

class ExportReadError extends Error {
  constructor(code) {
    super(code);
    this.name = "SqliteExportError";
    this.code = code;
  }
}
const requireValue = (condition, code) => { if (!condition) throw new ExportReadError(code); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

function exactKeys(value, expected) {
  requireValue(object(value) && Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)), "SQLITE_EXPORT_FORMAT_INVALID");
}

function characterCount(value) {
  let length = 0;
  for (let index = 0; index < value.length; index++, length++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      requireValue(next >= 0xdc00 && next <= 0xdfff, "SQLITE_EXPORT_UNICODE_INVALID");
    } else requireValue(code < 0xdc00 || code > 0xdfff, "SQLITE_EXPORT_UNICODE_INVALID");
  }
  return length;
}

// Python sort_keys orders Unicode scalar values, whereas JS default sort uses
// UTF-16 units. Build object text directly so integer-looking keys cannot be
// reordered by JavaScript object enumeration either.
function pythonKeyOrder(left, right) {
  const a = left[Symbol.iterator](), b = right[Symbol.iterator]();
  for (;;) {
    const x = a.next(), y = b.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const difference = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (difference) return difference;
  }
}

function canonicalJson(value, depth = 0) {
  requireValue(depth <= 32, "SQLITE_EXPORT_FORMAT_INVALID");
  if (typeof value === "string") {
    characterCount(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    // Every numeric token emitted by this format is integer metadata. Row
    // integers and reals are strings, so JSON.parse must never round them.
    requireValue(Number.isSafeInteger(value) && !Object.is(value, -0), "SQLITE_EXPORT_NUMBER_INVALID");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  requireValue(object(value), "SQLITE_EXPORT_FORMAT_INVALID");
  return `{${Object.keys(value).sort(pythonKeyOrder).map((key) =>
    `${canonicalJson(key, depth + 1)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
}

function sameStat(left, right) {
  return ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every((key) => left[key] === right[key]);
}

function readPrivateExport(filePath) {
  requireValue(typeof filePath === "string" && path.isAbsolute(filePath), "SQLITE_EXPORT_PATH_INVALID");
  // Reject symlink components as well as the final file; never follow a
  // user-supplied link to a different export location.
  let current = path.resolve(filePath);
  for (;;) {
    requireValue(!fs.lstatSync(current).isSymbolicLink(), "SQLITE_EXPORT_SYMLINK_REFUSED");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const before = fs.lstatSync(filePath, { bigint: true });
  requireValue(before.isFile(), "SQLITE_EXPORT_NOT_REGULAR_FILE");
  requireValue(before.size > 0n && before.size <= BigInt(MAX_FILE_BYTES), "SQLITE_EXPORT_FILE_SIZE_INVALID");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    requireValue(opened.isFile() && sameStat(before, opened), "SQLITE_EXPORT_FILE_CHANGED");
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const received = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      requireValue(received > 0, "SQLITE_EXPORT_FILE_CHANGED");
      offset += received;
    }
    requireValue(fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) === 0 &&
      sameStat(opened, fs.fstatSync(descriptor, { bigint: true })) &&
      sameStat(opened, fs.lstatSync(filePath, { bigint: true })), "SQLITE_EXPORT_FILE_CHANGED");
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateManifest(manifest, schema) {
  exactKeys(manifest, ["user_version", "schema_objects", "tables"]);
  requireValue(Number.isSafeInteger(manifest.user_version) && Array.isArray(manifest.schema_objects) &&
    Array.isArray(manifest.tables) && manifest.tables.length === schema.tables.length,
  "SQLITE_EXPORT_SCHEMA_MISMATCH");
  for (const item of manifest.schema_objects) exactKeys(item, ["type", "name", "table_name", "sql"]);
  const tables = manifest.tables.map((table, index) => {
    exactKeys(table, ["name", "row_count", "exported_columns", "table_xinfo", "indexes", "foreign_keys"]);
    const target = schema.tables[index];
    requireValue(table.name === target.name && count(table.row_count) && table.row_count <= MAX_FILE_BYTES &&
      Array.isArray(table.exported_columns) && Array.isArray(table.table_xinfo) &&
      Array.isArray(table.indexes) && Array.isArray(table.foreign_keys), "SQLITE_EXPORT_SCHEMA_MISMATCH");
    for (const column of table.table_xinfo) exactKeys(column, ["cid", "name", "type", "notnull", "dflt_value", "pk", "hidden"]);
    for (const key of table.indexes) {
      exactKeys(key, ["seq", "name", "unique", "origin", "partial", "columns"]);
      requireValue(Array.isArray(key.columns), "SQLITE_EXPORT_SCHEMA_MISMATCH");
      for (const column of key.columns) exactKeys(column, ["seqno", "cid", "name", "desc", "coll", "key"]);
    }
    for (const foreign of table.foreign_keys) exactKeys(foreign, ["id", "seq", "table", "from", "to", "on_update", "on_delete", "match"]);
    const expectedColumns = target.columns.map((column) => column.name);
    requireValue(JSON.stringify(table.exported_columns) === JSON.stringify(expectedColumns) &&
      JSON.stringify(table.table_xinfo.filter((column) => column.hidden === 0).map((column) => column.name)) === JSON.stringify(expectedColumns),
    "SQLITE_EXPORT_COLUMNS_MISMATCH");
    return { name: table.name, columns: table.table_xinfo, indexes: table.indexes, foreign_keys: table.foreign_keys };
  });
  const convertedAudit = { format_version: 1, user_version: manifest.user_version, tables,
    schema_objects: manifest.schema_objects.map(({ type, name, table_name, sql }) => ({ type, name, tbl_name: table_name, schema_sql: sql })) };
  requireValue(sourceSchemaFingerprint(convertedAudit) === schema.sourceSchemaHash &&
    schema.sourceSchemaHash === REVIEWED_SOURCE_SCHEMA_HASH, "SQLITE_EXPORT_SCHEMA_MISMATCH");
}

function normalizeValue(value, column) {
  exactKeys(value, ["type", "value"]);
  if (value.type === "null") {
    requireValue(value.value === null && column.nullable, "SQLITE_EXPORT_NULL_NOT_ALLOWED");
    return null;
  }
  requireValue(typeof value.value === "string", "SQLITE_EXPORT_VALUE_TYPE_INVALID");
  if (column.mysqlType === "BIGINT") {
    requireValue(value.type === "integer" && value.value.length <= 20 && INTEGER.test(value.value), "SQLITE_EXPORT_INTEGER_INVALID");
    const integer = BigInt(value.value);
    requireValue(integer >= minimumInteger && integer <= maximumInteger, "SQLITE_EXPORT_INTEGER_RANGE");
    return value.value;
  }
  if (column.mysqlType === "DOUBLE") {
    requireValue(value.type === "real" && value.value.length <= 64 && REAL.test(value.value), "SQLITE_EXPORT_REAL_INVALID");
    const real = Number(value.value);
    requireValue(Number.isFinite(real) && (real !== 0 || !/[1-9]/.test(value.value.split("e")[0])), "SQLITE_EXPORT_REAL_INVALID");
    return real;
  }
  requireValue(column.sourceType === "TEXT" && value.type === "text", "SQLITE_EXPORT_VALUE_TYPE_INVALID");
  const characters = characterCount(value.value);
  requireValue(column.maxCharacters === undefined || characters <= column.maxCharacters, "SQLITE_EXPORT_TEXT_TOO_LONG");
  requireValue(column.maxBytes === undefined || Buffer.byteLength(value.value, "utf8") <= column.maxBytes, "SQLITE_EXPORT_TEXT_TOO_LONG");
  return value.value;
}

/** Synchronous, bounded, read-only validation. No data is logged or written. */
export function loadSqliteExport(filePath, { expectedSourceSha256, audit } = {}) {
  try {
    requireValue(typeof expectedSourceSha256 === "string" && SHA256.test(expectedSourceSha256), "SQLITE_EXPORT_SOURCE_HASH_INVALID");
    const schema = buildMysqlSchema(audit);
    const bytes = readPrivateExport(filePath);
    requireValue(bytes.at(-1) === 10, "SQLITE_EXPORT_TRUNCATED");
    const streamDigest = createHash("sha256");
    const tableDigests = schema.tables.map(() => createHash("sha256"));
    const tables = schema.tables.map((table) => ({ name: table.name, columns: table.columns.map((column) => column.name), rows: [], rowCount: 0 }));
    let header, footer;
    let offset = 0, tableIndex = 0, rowCount = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      requireValue(end >= offset && end - offset + 1 <= MAX_LINE_BYTES, "SQLITE_EXPORT_LINE_TOO_LARGE");
      const rawLine = bytes.subarray(offset, end + 1);
      let text, record;
      try { text = decoder.decode(rawLine.subarray(0, -1)); record = JSON.parse(text); }
      catch { throw new ExportReadError("SQLITE_EXPORT_JSON_INVALID"); }
      // Besides matching Python's wire format, this rejects duplicate keys,
      // unsafe numeric tokens, CRLF/BOM and hidden extra JSON whitespace.
      requireValue(canonicalJson(record) === text, "SQLITE_EXPORT_NONCANONICAL_JSON");
      requireValue(object(record), "SQLITE_EXPORT_FORMAT_INVALID");
      if (!header) {
        exactKeys(record, ["kind", "format", "format_version", "source", "sqlite_version", "manifest", "manifest_sha256"]);
        requireValue(record.kind === "header" && record.format === "outdoor-fit-sqlite-export" && record.format_version === 1,
          "SQLITE_EXPORT_FORMAT_INVALID");
        exactKeys(record.source, ["sha256", "bytes"]);
        requireValue(record.source.sha256 === expectedSourceSha256 && count(record.source.bytes) && record.source.bytes > 0,
          "SQLITE_EXPORT_SOURCE_MISMATCH");
        requireValue(typeof record.sqlite_version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(record.sqlite_version),
          "SQLITE_EXPORT_FORMAT_INVALID");
        requireValue(typeof record.manifest_sha256 === "string" && SHA256.test(record.manifest_sha256) &&
          digest(canonicalJson(record.manifest)) === record.manifest_sha256, "SQLITE_EXPORT_MANIFEST_HASH_MISMATCH");
        validateManifest(record.manifest, schema);
        header = record;
        streamDigest.update(rawLine);
      } else if (record.kind === "row") {
        exactKeys(record, ["kind", "table", "values"]);
        while (tableIndex < tables.length && tables[tableIndex].rowCount === header.manifest.tables[tableIndex].row_count) tableIndex++;
        requireValue(!footer && tableIndex < tables.length && record.table === tables[tableIndex].name, "SQLITE_EXPORT_ROW_ORDER_INVALID");
        const target = schema.tables[tableIndex];
        requireValue(Array.isArray(record.values) && record.values.length === target.columns.length, "SQLITE_EXPORT_ROW_WIDTH_INVALID");
        tables[tableIndex].rows.push(record.values.map((value, index) => normalizeValue(value, target.columns[index])));
        tables[tableIndex].rowCount++;
        rowCount++;
        tableDigests[tableIndex].update(rawLine);
        streamDigest.update(rawLine);
      } else {
        exactKeys(record, ["kind", "source_sha256", "manifest_sha256", "row_count", "tables", "stream_sha256"]);
        requireValue(record.kind === "footer" && !footer && end + 1 === bytes.length, "SQLITE_EXPORT_FOOTER_INVALID");
        footer = record;
      }
      offset = end + 1;
    }
    requireValue(header && footer, "SQLITE_EXPORT_TRUNCATED");
    requireValue(footer.source_sha256 === expectedSourceSha256 && footer.manifest_sha256 === header.manifest_sha256 &&
      count(footer.row_count) && footer.row_count === rowCount && Array.isArray(footer.tables) && footer.tables.length === tables.length,
    "SQLITE_EXPORT_FOOTER_MISMATCH");
    for (let index = 0; index < tables.length; index++) {
      const expected = footer.tables[index], actual = tables[index];
      exactKeys(expected, ["name", "row_count", "sha256"]);
      requireValue(expected.name === actual.name && count(expected.row_count) && expected.row_count === actual.rowCount &&
        actual.rowCount === header.manifest.tables[index].row_count, "SQLITE_EXPORT_ROW_COUNT_MISMATCH");
      requireValue(typeof expected.sha256 === "string" && SHA256.test(expected.sha256) && expected.sha256 === tableDigests[index].digest("hex"),
        "SQLITE_EXPORT_TABLE_HASH_MISMATCH");
    }
    requireValue(typeof footer.stream_sha256 === "string" && SHA256.test(footer.stream_sha256) &&
      footer.stream_sha256 === streamDigest.digest("hex"), "SQLITE_EXPORT_STREAM_HASH_MISMATCH");
    return { schema, sourceSha256: expectedSourceSha256, manifestSha256: header.manifest_sha256,
      exportSha256: digest(bytes), tables, rowCount };
  } catch (error) {
    if (error instanceof ExportReadError) throw error;
    if (error?.code === "MYSQL_SOURCE_SCHEMA_UNREVIEWED") throw new ExportReadError("SQLITE_EXPORT_SCHEMA_MISMATCH");
    // Native errors and JSON parser messages can contain paths or row fragments.
    throw new ExportReadError("SQLITE_EXPORT_READ_FAILED");
  }
}
