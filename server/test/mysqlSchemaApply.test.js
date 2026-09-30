import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildMysqlSchema } from "../src/mysqlSchema.js";
import { applyMysqlSchema, verifyMysqlSchema } from "../src/mysqlSchemaApply.js";

// The fixture contains schema metadata and aggregate counts, never business rows.
const audit = JSON.parse(fs.readFileSync(new URL("../../docs/aliyun-source-schema-audit.json", import.meta.url), "utf8"));
const schema = buildMysqlSchema(audit);
const database = "outdoor_fit_test";
const storedExpression = expression => (expression || "")
	.replace(/CAST\((`[^`]+`) AS BINARY\)/g, "cast($1 as char charset binary)")
	.replace(/SUBSTRING/g, "substr")
	.replace(/'([^']*)'/g, "_utf8mb4'$1'");
const actualGeneratedExpressions = [
	"unhex(sha2(cast(`source_id` as char charset binary),256))",
	"unhex(sha2(cast(`url` as char charset binary),256))",
	"(case when (`deleted_at` is null) then `name` else NULL end)",
	"unhex(sha2(cast(`folder_path` as char charset binary),256))",
	"unhex(sha2(cast(`expo_push_token` as char charset binary),256))",
	"(case when ((`used_at` is null) and (`revoked_at` is null)) then `phone` else NULL end)",
	"unhex(sha2(cast(`email` as char charset binary),256))",
];

function actualMetadataFormats(metadata) {
	const generated = metadata.columns.filter(column => column.generationExpression);
	assert.equal(generated.length, 7);
	for (const [index, column] of generated.entries()) column.generationExpression = actualGeneratedExpressions[index];
	for (const column of metadata.columns) {
		if (column.extra === "DEFAULT_GENERATED") column.columnDefault = column.columnDefault.replace(/^\((.*)\)$/, "$1");
	}
}

function mysqlDisplayEncode(value) {
	return value.replace(/[\\'\0\n\r\x1a]/g, character => ({
		"\\": "\\\\", "'": "\\'", "\0": "\\0", "\n": "\\n", "\r": "\\r", "\x1a": "\\Z",
	})[character]);
}

function encodedMetadataFormats(metadata) {
	actualMetadataFormats(metadata);
	for (const column of metadata.columns) {
		if (column.extra === "DEFAULT_GENERATED") column.columnDefault = mysqlDisplayEncode(column.columnDefault);
		column.generationExpression = mysqlDisplayEncode(column.generationExpression);
	}
	for (const check of metadata.checks) check.expression = mysqlDisplayEncode(check.expression);
}

function bufferResults(connection) {
	const query = connection.query.bind(connection);
	connection.convertedBufferCount = 0;
	connection.query = async (...arguments_) => {
		const [result, fields] = await query(...arguments_);
		if (!Array.isArray(result)) return [result, fields];
		return [result.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => {
			if (typeof value !== "string") return [name, value];
			connection.convertedBufferCount++;
			return [name, Buffer.from(value, "utf8")];
		}))), fields];
	};
	return connection;
}

function metadataFixture() {
	return {
		tables: schema.tables.map(table => ({ tableName: table.name, tableType: "BASE TABLE", engine: "InnoDB", rowFormat: "Dynamic", collation: schema.collation })),
		columns: schema.tables.flatMap(table => [...table.columns, ...table.internalColumns].map((column, index) => ({
			tableName: table.name, name: column.name, ordinal: index + 1, columnType: column.mysqlType.toLowerCase(),
			isNullable: column.nullable ? "YES" : "NO", charset: column.charset, collation: column.collation,
			extra: column.generatedExpression ? "STORED GENERATED" : column.autoIncrement ? "auto_increment" : column.mysqlType === "MEDIUMTEXT" && column.defaultSql !== null ? "DEFAULT_GENERATED" : "",
			columnDefault: column.mysqlType === "MEDIUMTEXT" && column.defaultSql !== null ? storedExpression(column.defaultSql) : column.defaultValue === null ? null : String(column.defaultValue),
			generationExpression: storedExpression(column.generatedExpression),
		}))),
		indexes: schema.tables.flatMap(table => table.indexes.flatMap(index => index.columns.map((column, ordinal) => ({
			tableName: table.name, name: index.primary ? "PRIMARY" : index.name, nonUnique: index.unique ? 0 : 1,
			columnName: column.name, direction: column.descending ? "D" : "A", prefixLength: column.prefixLength, ordinal: ordinal + 1,
		})))),
		foreignKeys: schema.tables.flatMap(table => table.foreignKeys.flatMap(key => key.columns.map((name, ordinal) => ({
			tableName: table.name, name: key.name, columnName: name, referencedSchema: database,
			referencedTable: key.referencedTable, referencedColumn: key.referencedColumns[ordinal],
			onDelete: key.onDelete === "NO ACTION" ? "RESTRICT" : key.onDelete,
			onUpdate: key.onUpdate === "NO ACTION" ? "RESTRICT" : key.onUpdate, ordinal: ordinal + 1,
		})))),
		checks: schema.tables.flatMap(table => table.checks.map(check => ({
			tableName: table.name, name: check.name, enforced: "YES", expression: "(" + storedExpression(check.expression) + ")",
		}))),
	};
}

function fakeConnection(options = {}) {
	const metadata = metadataFixture();
	options.mutateMetadata?.(metadata);
	const calls = [];
	let ddlAttempts = 0;
	return {
		calls,
		async query(sql, values = []) {
			calls.push({ sql, values });
			if (sql.startsWith("SELECT DATABASE()")) return [[{
				currentDatabase: database, mysqlVersion: "8.0.36", sqlMode: "STRICT_TRANS_TABLES,NO_ZERO_DATE",
				foreignKeyChecks: 1, uniqueChecks: 1, pageSize: 16384, ...options.state,
			}], []];
			if (sql.includes("GET_LOCK")) return [[{ acquired: options.lockResult ?? 1 }], []];
			if (sql.includes("RELEASE_LOCK")) return [[{ released: options.releaseResult ?? 1 }], []];
			if (sql.startsWith("SELECT COUNT(*)")) return [[{ objectCount: options.objectCount ?? 0 }], []];
			if (/^(CREATE|ALTER) TABLE /.test(sql)) {
				ddlAttempts++;
				if (ddlAttempts === options.failDdl) {
					throw Object.assign(new Error("raw private connection details"), {
						code: options.errorCode || "ER_TOO_LONG_KEY", sql, sqlMessage: "private SQL values",
					});
				}
				return [{ affectedRows: 0 }, []];
			}
			if (sql.includes("information_schema.TABLES")) return [metadata.tables, []];
			if (sql.includes("information_schema.COLUMNS")) return [metadata.columns, []];
			if (sql.includes("information_schema.STATISTICS")) return [metadata.indexes, []];
			if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [metadata.foreignKeys, []];
			if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return [metadata.checks, []];
			throw new Error("Unexpected test query");
		},
	};
}

const ddlCalls = connection => connection.calls.filter(call => /^(CREATE|ALTER) TABLE /.test(call.sql));
const apply = (connection, options = {}, contract = schema) => applyMysqlSchema(connection, contract, { write() {}, ...options });
async function rejection(connection, code, options = {}, contract = schema) {
	let caught;
	await assert.rejects(apply(connection, options, contract), error => {
		caught = error;
		assert.equal(error.name, "MysqlSchemaApplyError");
		assert.equal(error.code, code);
		assert.equal(error.report.status, "failed");
		assert.equal(error.report.errorCode, code);
		assert.doesNotMatch(JSON.stringify(error) + error.message, /private|CREATE TABLE|ALTER TABLE/);
		return true;
	});
	return caught.report;
}

test("empty reviewed database gets all DDL, normalized metadata fingerprint and same-connection lock release", async () => {
	const connection = fakeConnection();
	const lines = [];
	const report = await apply(connection, { write: line => lines.push(line) });
	assert.equal(report.status, "applied");
	assert.equal(report.createdTables, 38);
	assert.equal(report.completedStatements, 71);
	assert.equal(report.partial, false);
	assert.equal(report.lockReleased, true);
	assert.deepEqual(report.metadata, { tables: 38, columns: 333, indexes: 96, foreignKeys: 33, checks: 29 });
	assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
	assert.equal(ddlCalls(connection).length, 71);
	const lock = connection.calls.find(call => call.sql.includes("GET_LOCK"));
	assert.deepEqual(connection.calls.at(-1).values, lock.values);
	assert.match(connection.calls.at(-1).sql, /RELEASE_LOCK/);
	assert.ok(connection.calls.findIndex(call => call.sql.includes("GET_LOCK")) < connection.calls.findIndex(call => call.sql.startsWith("SELECT COUNT")));
	assert.ok(connection.calls.every(call => !/DROP|IF NOT EXISTS/.test(call.sql)));
	assert.ok(connection.calls.filter(call => call.sql.startsWith("SELECT") && /\bFROM\b/.test(call.sql)).every(call => call.sql.includes("information_schema.")));
	assert.doesNotMatch(lines.join("\n"), /CREATE TABLE|ALTER TABLE|private/);
});

test("a nonempty database is refused after acquiring the lock and releases it", async () => {
	const connection = fakeConnection({ objectCount: 1 });
	const report = await rejection(connection, "SCHEMA_DATABASE_NOT_EMPTY");
	assert.equal(ddlCalls(connection).length, 0);
	assert.equal(report.partial, false);
	assert.equal(report.lockReleased, true);
});

test("wrong selected database and caller override cannot reach any DDL", async () => {
	const wrongConnection = fakeConnection({ state: { currentDatabase: "outdoor_fit_prod" } });
	await rejection(wrongConnection, "SCHEMA_DATABASE_REFUSED");
	assert.equal(wrongConnection.calls.length, 1);
	const overrideConnection = fakeConnection();
	await rejection(overrideConnection, "SCHEMA_DATABASE_REFUSED", { expectedDatabase: "outdoor_fit_prod" });
	assert.equal(overrideConnection.calls.length, 0);
});

test("DDL errors report partial progress, do not retry or drop, and release the lock", async () => {
	const connection = fakeConnection({ failDdl: 4 });
	const lines = [];
	const report = await rejection(connection, "ER_TOO_LONG_KEY", { write: line => lines.push(line) });
	assert.equal(report.createdTables, 3);
	assert.equal(report.completedStatements, 3);
	assert.equal(report.operation, "table_ddl");
	assert.equal(report.operationIndex, 4);
	assert.equal(report.partial, true);
	assert.equal(report.lockReleased, true);
	assert.equal(ddlCalls(connection).length, 4);
	assert.doesNotMatch(lines.join("\n"), /private|CREATE TABLE/);
});

test("unknown driver code never enters the report and first-DDL uncertainty is partial", async () => {
	const connection = fakeConnection({ failDdl: 1, errorCode: "private_untrusted_error_code" });
	const report = await rejection(connection, "SCHEMA_OPERATION_FAILED");
	assert.equal(report.partial, true);
	assert.equal(report.createdTables, 0);
	assert.equal(report.lockReleased, true);
});

test("an unavailable lock prevents mutation and does not release somebody else's lock", async () => {
	const connection = fakeConnection({ lockResult: 0 });
	const report = await rejection(connection, "SCHEMA_LOCK_UNAVAILABLE");
	assert.equal(report.lockAcquired, false);
	assert.equal(ddlCalls(connection).length, 0);
	assert.ok(connection.calls.every(call => !call.sql.includes("RELEASE_LOCK")));
});

test("unsafe server/session settings fail before acquiring the lock", async () => {
	for (const [state, code] of [
		[{ mysqlVersion: "8.4.1" }, "SCHEMA_MYSQL_VERSION_REFUSED"],
		[{ sqlMode: "NO_ZERO_DATE" }, "SCHEMA_STRICT_MODE_REQUIRED"],
		[{ foreignKeyChecks: 0 }, "SCHEMA_CONSTRAINT_CHECKS_REQUIRED"],
		[{ uniqueChecks: 0 }, "SCHEMA_CONSTRAINT_CHECKS_REQUIRED"],
		[{ pageSize: 8192 }, "SCHEMA_PAGE_SIZE_REFUSED"],
	]) {
		const connection = fakeConnection({ state });
		await rejection(connection, code);
		assert.equal(connection.calls.length, 1);
	}
});

test("column, index, FK and CHECK mismatches fail verification without undoing DDL", async () => {
	for (const [mutateMetadata, operation] of [
		[metadata => { metadata.columns[0].isNullable = metadata.columns[0].isNullable === "YES" ? "NO" : "YES"; }, "verify_columns"],
		[metadata => { metadata.indexes[0].prefixLength = 1; }, "verify_indexes"],
		[metadata => { metadata.foreignKeys[0].onDelete = metadata.foreignKeys[0].onDelete === "SET NULL" ? "CASCADE" : "SET NULL"; }, "verify_foreign_keys"],
		[metadata => { metadata.checks[0].expression = "1 = 1"; }, "verify_checks"],
	]) {
		const connection = fakeConnection({ mutateMetadata });
		const report = await rejection(connection, "SCHEMA_METADATA_MISMATCH");
		assert.equal(report.operation, operation);
		assert.equal(report.partial, true);
		assert.equal(report.createdTables, 38);
		assert.equal(report.lockReleased, true);
	}
});

test("expression normalization preserves string literal case and logical operators", async () => {
	for (const mutation of [
		metadata => { const check = metadata.checks.find(item => item.expression.includes("'image'")); check.expression = check.expression.replace("'image'", "'IMAGE'"); },
		metadata => { const check = metadata.checks.find(item => item.expression.includes("latitude")); check.expression = check.expression.replace(/\bAND\b/i, "OR"); },
	]) await rejection(fakeConnection({ mutateMetadata: mutation }), "SCHEMA_METADATA_MISMATCH");
});

test("expression parentheses are parsed rather than discarded", async () => {
	const contract = structuredClone(schema);
	const check = contract.tables.find(table => table.checks.length > 0).checks[0];
	check.expression = "a = 1 AND (b = 2 OR c = 3)";
	const connection = fakeConnection({ mutateMetadata(metadata) {
		metadata.checks.find(item => item.name === check.name).expression = "(a = 1 AND b = 2) OR c = 3";
	} });
	await rejection(connection, "SCHEMA_METADATA_MISMATCH", {}, contract);
});

test("strict driver error codes remain diagnostic without raw driver text", async () => {
	await rejection(fakeConnection({ failDdl: 1, errorCode: "ER_GENERATED_COLUMN_FUNCTION_IS_NOT_ALLOWED" }), "ER_GENERATED_COLUMN_FUNCTION_IS_NOT_ALLOWED");
});

test("ordinary and expression literal defaults preserve empty strings, case and null", async () => {
	const connection = fakeConnection({ mutateMetadata(metadata) {
		const column = metadata.columns.find(item => item.extra === "DEFAULT_GENERATED");
		column.columnDefault = "((" + column.columnDefault + "))";
	} });
	assert.equal((await apply(connection)).status, "applied");
	for (const mutation of [
		metadata => { metadata.columns.find(item => item.extra === "DEFAULT_GENERATED").columnDefault = "_utf8mb4'different'"; },
		metadata => { metadata.columns.find(item => item.columnDefault === "").columnDefault = null; },
		metadata => { metadata.columns.find(item => item.columnDefault === null).columnDefault = ""; },
	]) {
		const report = await rejection(fakeConnection({ mutateMetadata: mutation }), "SCHEMA_METADATA_MISMATCH");
		assert.equal(report.operation, "verify_columns");
	}
});

test("duplicate FK statements and multi-statement DDL are refused before connecting", async () => {
	for (const mutate of [
		contract => { contract.statements[70] = contract.statements[69]; },
		contract => { contract.statements[0].sql += "; SELECT 1"; },
	]) {
		const contract = structuredClone(schema); mutate(contract);
		const connection = fakeConnection();
		await rejection(connection, "SCHEMA_STATEMENT_REFUSED", {}, contract);
		assert.equal(connection.calls.length, 0);
	}
});

test("lock-release uncertainty is reported after completed DDL", async () => {
	const report = await rejection(fakeConnection({ releaseResult: 0 }), "SCHEMA_LOCK_RELEASE_FAILED");
	assert.equal(report.partial, true);
	assert.equal(report.completedStatements, 71);
	assert.equal(report.lockReleased, false);
	assert.equal(report.operation, "lock_release");
});

test("verify-only accepts the existing schema using only SELECT and never reads business rows", async () => {
	const connection = fakeConnection({ objectCount: 38 });
	const report = await verifyMysqlSchema(connection, schema, { write() {} });
	assert.equal(report.status, "verified");
	assert.equal(report.readOnly, true);
	assert.equal(report.partial, false);
	assert.equal(report.createdTables, 0);
	assert.equal(report.completedStatements, 0);
	assert.equal(report.lockReleased, true);
	assert.deepEqual(report.metadata, { tables: 38, columns: 333, indexes: 96, foreignKeys: 33, checks: 29 });
	assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
	assert.equal(ddlCalls(connection).length, 0);
	assert.ok(connection.calls.every(call => call.sql.startsWith("SELECT ")));
	assert.ok(connection.calls.every(call => !call.sql.startsWith("SELECT COUNT")));
	assert.ok(connection.calls.filter(call => /\bFROM\b/.test(call.sql)).every(call => call.sql.includes("information_schema.")));
	assert.match(connection.calls.at(-1).sql, /RELEASE_LOCK/);
	assert.equal(report.table, undefined);
	assert.equal(report.column, undefined);
	assert.equal(report.metadataKind, undefined);
});

test("verify-only database guard cannot be overridden", async () => {
	for (const [connection, options, count] of [
		[fakeConnection({ state: { currentDatabase: "outdoor_fit_prod" } }), {}, 1],
		[fakeConnection(), { expectedDatabase: "outdoor_fit_prod" }, 0],
	]) {
		await assert.rejects(verifyMysqlSchema(connection, schema, { write() {}, ...options }), error => {
			assert.equal(error.name, "MysqlSchemaVerifyError");
			assert.equal(error.code, "SCHEMA_DATABASE_REFUSED");
			assert.equal(error.report.readOnly, true);
			return true;
		});
		assert.equal(connection.calls.length, count);
	}
});

test("verify-only expression failures identify the safe column and metadata kind without echoing expressions", async () => {
	for (const kind of ["column_default", "generation_expression"]) {
		let expectedContext;
		const lines = [];
		const connection = fakeConnection({ mutateMetadata(metadata) {
			const row = metadata.columns.find(item => kind === "column_default" ? item.extra === "DEFAULT_GENERATED" : item.generationExpression);
			expectedContext = { table: row.tableName, column: row.name };
			row[kind === "column_default" ? "columnDefault" : "generationExpression"] = "private_expression @ unsupported";
		} });
		await assert.rejects(verifyMysqlSchema(connection, schema, { write: line => lines.push(line) }), error => {
			assert.equal(error.code, "SCHEMA_EXPRESSION_UNSUPPORTED");
			assert.equal(error.report.metadataKind, kind);
			assert.equal(error.report.table, expectedContext.table);
			assert.equal(error.report.column, expectedContext.column);
			assert.equal(error.report.lockReleased, true);
			assert.equal(error.report.partial, false);
			assert.doesNotMatch(error.message + JSON.stringify(error.report), /private_expression|unsupported/);
			return true;
		});
		assert.ok(connection.calls.every(call => call.sql.startsWith("SELECT ")));
		assert.doesNotMatch(lines.join("\n"), /private_expression|unsupported/);
	}
});

test("verify-only metadata mismatch identifies the column and releases its lock", async () => {
	let expectedContext;
	const connection = fakeConnection({ mutateMetadata(metadata) {
		const row = metadata.columns[0];
		expectedContext = { table: row.tableName, column: row.name };
		row.isNullable = row.isNullable === "YES" ? "NO" : "YES";
	} });
	await assert.rejects(verifyMysqlSchema(connection, schema, { write() {} }), error => {
		assert.equal(error.code, "SCHEMA_METADATA_MISMATCH");
		assert.equal(error.report.metadataKind, "columns");
		assert.equal(error.report.table, expectedContext.table);
		assert.equal(error.report.column, expectedContext.column);
		assert.equal(error.report.lockReleased, true);
		return true;
	});
	assert.equal(ddlCalls(connection).length, 0);
});

test("malformed metadata identifiers are never included in failure context or logs", async () => {
	const lines = [];
	const connection = fakeConnection({ mutateMetadata(metadata) {
		const row = metadata.columns[0];
		row.tableName = "private_table\nunsafe";
		row.name = "private_column value";
		row.generationExpression = "private_expression @ unsupported";
	} });
	await assert.rejects(verifyMysqlSchema(connection, schema, { write: line => lines.push(line) }), error => {
		assert.equal(error.code, "SCHEMA_EXPRESSION_UNSUPPORTED");
		assert.equal(error.report.metadataKind, "generation_expression");
		assert.equal(error.report.table, undefined);
		assert.equal(error.report.column, undefined);
		assert.doesNotMatch(JSON.stringify(error.report), /private_/);
		return true;
	});
	assert.doesNotMatch(lines.join("\n"), /private_/);
});

test("apply failure also preserves expression diagnostic context after successful DDL", async () => {
	let table, column;
	const connection = fakeConnection({ mutateMetadata(metadata) {
		const row = metadata.columns.find(item => item.generationExpression);
		table = row.tableName; column = row.name;
		row.generationExpression = "private_expression @ unsupported";
	} });
	const report = await rejection(connection, "SCHEMA_EXPRESSION_UNSUPPORTED");
	assert.equal(report.metadataKind, "generation_expression");
	assert.equal(report.table, table);
	assert.equal(report.column, column);
	assert.equal(report.completedStatements, 71);
	assert.equal(report.partial, true);
	assert.equal(report.lockReleased, true);
});

test("all seven actual generated formats and defaults verify identically as strings and UTF-8 Buffers", async () => {
	const ordinary = fakeConnection({ mutateMetadata: actualMetadataFormats });
	const buffered = bufferResults(fakeConnection({ mutateMetadata: actualMetadataFormats, objectCount: 38 }));
	const lines = [];
	const stringReport = await verifyMysqlSchema(ordinary, schema, { write() {} });
	const bufferReport = await verifyMysqlSchema(buffered, schema, { write: line => lines.push(line) });
	assert.equal(stringReport.status, "verified");
	assert.equal(bufferReport.status, "verified");
	assert.equal(stringReport.metadataBufferValues, 0);
	assert.ok(bufferReport.metadataBufferValues > 333);
	assert.equal(bufferReport.metadataBufferValues, buffered.convertedBufferCount);
	assert.equal(bufferReport.fingerprint, stringReport.fingerprint);
	assert.ok(lines.includes("SCHEMA_METADATA_BUFFER_VALUES " + buffered.convertedBufferCount));
	assert.ok(buffered.calls.every(call => call.sql.startsWith("SELECT ")));
	assert.ok(buffered.calls.filter(call => /\bFROM\b/.test(call.sql)).every(call => call.sql.includes("information_schema.")));
});

test("empty generation Buffers work while NULL and empty default values remain distinct", async () => {
	const valid = bufferResults(fakeConnection());
	assert.equal((await verifyMysqlSchema(valid, schema, { write() {} })).status, "verified");
	for (const mutateMetadata of [
		metadata => { metadata.columns.find(column => column.columnDefault === null).columnDefault = Buffer.alloc(0); },
		metadata => { metadata.columns.find(column => column.columnDefault === "").columnDefault = null; },
	]) {
		await assert.rejects(verifyMysqlSchema(bufferResults(fakeConnection({ mutateMetadata })), schema, { write() {} }), {
			code: "SCHEMA_METADATA_MISMATCH",
		});
	}
});

test("Buffer decoding is strict UTF-8, keeps a BOM, and refuses unknown binary fields", async () => {
	for (const [mutateMetadata, code] of [
		[metadata => { metadata.columns[0].generationExpression = Buffer.from([0xc3, 0x28]); }, "SCHEMA_METADATA_UTF8_INVALID"],
		[metadata => { metadata.columns.find(column => column.columnDefault === "").columnDefault = Buffer.from([0xef, 0xbb, 0xbf]); }, "SCHEMA_METADATA_MISMATCH"],
		[metadata => { metadata.columns[0].unexpectedBinary = Buffer.from("private_binary_value"); }, "SCHEMA_METADATA_FIELD_UNSUPPORTED"],
	]) {
		const lines = [];
		const connection = fakeConnection({ mutateMetadata });
		await assert.rejects(verifyMysqlSchema(connection, schema, { write: line => lines.push(line) }), error => {
			assert.equal(error.code, code);
			assert.equal(error.report.lockReleased, true);
			assert.equal(error.report.readOnly, true);
			assert.doesNotMatch(JSON.stringify(error.report), /private_binary_value/);
			return true;
		});
		assert.equal(ddlCalls(connection).length, 0);
		assert.doesNotMatch(lines.join("\n"), /private_binary_value/);
	}
});

test("Buffer conversion preserves literal case and logical operator mismatch detection", async () => {
	for (const mutateMetadata of [
		metadata => { const row = metadata.checks.find(item => item.expression.includes("'image'")); row.expression = row.expression.replace("'image'", "'IMAGE'"); },
		metadata => { const row = metadata.columns.find(item => item.generationExpression.includes("AND")); row.generationExpression = row.generationExpression.replace("AND", "OR"); },
	]) await assert.rejects(verifyMysqlSchema(bufferResults(fakeConnection({ mutateMetadata })), schema, { write() {} }), {
		code: "SCHEMA_METADATA_MISMATCH",
	});
});

test("real RDS fourteen-byte escaped permissions default verifies after exactly one display decode", async () => {
	const expression = "_utf8mb4\\'[]\\'";
	assert.equal(Buffer.byteLength(expression, "utf8"), 14);
	for (const buffered of [false, true]) {
		const lines = [];
		let connection = fakeConnection({ mutateMetadata(metadata) {
			metadata.columns.find(column => column.tableName === "admin_accounts" && column.name === "permissions_json").columnDefault = expression;
		} });
		if (buffered) connection = bufferResults(connection);
		const report = await verifyMysqlSchema(connection, schema, { write: line => lines.push(line) });
		assert.equal(report.status, "verified");
		assert.equal(report.metadataDecodedExpressions, 1);
		assert.equal(report.metadataBufferValues > 0, buffered);
		assert.ok(lines.includes("SCHEMA_METADATA_DECODED_EXPRESSIONS 1"));
		assert.ok(!lines.join("\n").includes(expression));
	}
});

test("all 38 tables verify with MySQL display-encoded expressions and the unchanged contract fingerprint", async () => {
	const baseline = await verifyMysqlSchema(fakeConnection({ mutateMetadata: actualMetadataFormats }), schema, { write() {} });
	assert.equal(baseline.metadataDecodedExpressions, 0);
	for (const buffered of [false, true]) {
		let connection = fakeConnection({ mutateMetadata: encodedMetadataFormats });
		if (buffered) connection = bufferResults(connection);
		const report = await verifyMysqlSchema(connection, schema, { write() {} });
		assert.equal(report.status, "verified");
		assert.equal(report.metadata.tables, 38);
		assert.equal(report.fingerprint, baseline.fingerprint);
		assert.ok(report.metadataDecodedExpressions > 20);
		assert.ok(connection.calls.every(call => call.sql.startsWith("SELECT ")));
	}
});

test("all six display escapes round trip without confusing literal slash-n, control characters or apostrophes", async () => {
	const value = "literal\\n newline\n carriage\r nul\0 ctrlZ\x1a apostrophe' quote\" tab\t backspace\b";
	const sqlLiteral = "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
	const encoded = mysqlDisplayEncode(sqlLiteral);
	for (const token of ["\\\\", "\\'", "\\0", "\\n", "\\r", "\\Z"]) assert.ok(encoded.includes(token));
	const contract = structuredClone(schema);
	const table = contract.tables.find(table => table.columns.some(column => column.mysqlType === "MEDIUMTEXT" && column.defaultSql !== null));
	const column = table.columns.find(column => column.mysqlType === "MEDIUMTEXT" && column.defaultSql !== null);
	column.defaultValue = value;
	const connection = fakeConnection({ mutateMetadata(metadata) {
		metadata.columns.find(row => row.tableName === table.name && row.name === column.name).columnDefault = encoded;
	} });
	const report = await verifyMysqlSchema(connection, contract, { write() {} });
	assert.equal(report.status, "verified");
	assert.equal(report.metadataDecodedExpressions, 1);
});

test("ordinary literal defaults and contract expressions never pass through display decoding", async () => {
	const value = "literal\\n apostrophe'";
	const contract = structuredClone(schema);
	const table = contract.tables.find(table => table.columns.some(column => column.mysqlType.startsWith("VARCHAR") && column.defaultValue === ""));
	const column = table.columns.find(column => column.mysqlType.startsWith("VARCHAR") && column.defaultValue === "");
	column.defaultValue = value;
	const generatedTable = contract.tables.find(table => table.internalColumns.some(column => column.generatedExpression?.startsWith("CASE")));
	const generatedColumn = generatedTable.internalColumns.find(column => column.generatedExpression?.startsWith("CASE"));
	generatedColumn.generatedExpression = "CASE WHEN `deleted_at` IS NULL THEN 'literal\\\\n apostrophe''' ELSE NULL END";
	const connection = fakeConnection({ mutateMetadata(metadata) {
		metadata.columns.find(row => row.tableName === table.name && row.name === column.name).columnDefault = value;
		metadata.columns.find(row => row.tableName === generatedTable.name && row.name === generatedColumn.name).generationExpression = mysqlDisplayEncode(generatedColumn.generatedExpression);
	} });
	const report = await verifyMysqlSchema(connection, contract, { write() {} });
	assert.equal(report.status, "verified");
	assert.equal(report.metadataDecodedExpressions, 1);
});

test("unknown, trailing and mixed display escapes fail closed without exposing expression contents", async () => {
	for (const expression of ["\\t", "\\b", "\\\"", "\\q", "trailing\\", "'raw quote'\\n", "\\n\n", "\\n\r", "\\n\0", "\\n\x1a"]) {
		const connection = fakeConnection({ mutateMetadata(metadata) {
			metadata.columns.find(column => column.extra === "DEFAULT_GENERATED").columnDefault = expression;
		} });
		await assert.rejects(verifyMysqlSchema(connection, schema, { write() {} }), error => {
			assert.equal(error.code, "SCHEMA_METADATA_ESCAPE_INVALID");
			assert.equal(error.report.metadataKind, "column_default");
			assert.equal(error.report.expressionLength, expression.length);
			assert.equal(error.report.lockReleased, true);
			assert.equal(error.report.metadataDecodedExpressions, 0);
			return true;
		});
	}
});

test("double encoding is decoded only once and changed literals or operators still fail verification", async () => {
	const twiceEncoded = mysqlDisplayEncode(mysqlDisplayEncode("_utf8mb4'[]'"));
	const doubleConnection = fakeConnection({ mutateMetadata(metadata) {
		metadata.columns.find(column => column.extra === "DEFAULT_GENERATED").columnDefault = twiceEncoded;
	} });
	await assert.rejects(verifyMysqlSchema(doubleConnection, schema, { write() {} }), error => {
		assert.equal(error.code, "SCHEMA_EXPRESSION_UNSUPPORTED");
		assert.equal(error.report.metadataDecodedExpressions, 1);
		return true;
	});
	for (const mutate of [
		metadata => { const row = metadata.checks.find(row => row.expression.includes("'image'")); row.expression = row.expression.replace("'image'", "'IMAGE'"); },
		metadata => { const row = metadata.columns.find(row => row.generationExpression.includes("AND")); row.generationExpression = row.generationExpression.replace("AND", "OR"); },
	]) {
		const connection = fakeConnection({ mutateMetadata(metadata) {
			mutate(metadata);
			for (const row of metadata.columns) row.generationExpression = mysqlDisplayEncode(row.generationExpression);
			for (const row of metadata.checks) row.expression = mysqlDisplayEncode(row.expression);
		} });
		await assert.rejects(verifyMysqlSchema(connection, schema, { write() {} }), { code: "SCHEMA_METADATA_MISMATCH" });
	}
});

test("apply uses the same bounded metadata Buffer decoder", async () => {
	const connection = bufferResults(fakeConnection({ mutateMetadata: actualMetadataFormats }));
	const report = await apply(connection);
	assert.equal(report.status, "applied");
	assert.equal(report.metadataBufferValues, connection.convertedBufferCount);
	assert.ok(report.metadataBufferValues > 0);
});
