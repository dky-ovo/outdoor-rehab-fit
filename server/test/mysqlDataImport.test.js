import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildMysqlSchema } from "../src/mysqlSchema.js";
import { importMysqlData } from "../src/mysqlDataImport.js";

const schema = buildMysqlSchema(JSON.parse(fs.readFileSync(new URL("../../docs/aliyun-source-schema-audit.json", import.meta.url), "utf8")));
const schemaFingerprint = "8b67ce16f43f3f82f9d03a9d4be1eec219d942951a44cf19249c71d68a561cb6";
const verifySchema = async () => ({ status: "verified", database: "outdoor_fit_test", fingerprint: schemaFingerprint });
const tableByName = name => schema.tables.find(table => table.name === name);
function sourceRow(name, values = {}) {
	return tableByName(name).columns.map(column => Object.hasOwn(values, column.name) ? values[column.name] : column.nullable ? null : column.mysqlType === "BIGINT" ? "1" : column.mysqlType === "DOUBLE" ? 0 : "");
}
function dataset(rows = {}) {
	const tables = schema.tables.map(table => ({ name: table.name, columns: table.columns.map(column => column.name), rows: rows[table.name] || [], rowCount: (rows[table.name] || []).length }));
	return { schema, sourceSha256: "1".repeat(64), manifestSha256: "2".repeat(64), exportSha256: "3".repeat(64), tables, rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0) };
}
function example() {
	return dataset({
		users: [sourceRow("users", { id: "u-1", email: "synthetic@example.test", name: "private_fixture 文 O'Reilly \\n\n", profile_role: "participant" }), sourceRow("users", { id: "u-2", email: null })],
		admin_accounts: [sourceRow("admin_accounts", { user_id: "u-1", system_role: "admin", permissions_json: "[]" })],
		facilities: [sourceRow("facilities", { source_id: "facility-1", latitude: -0, longitude: 99.99999999999999 })],
		equipment_document_previews: [sourceRow("equipment_document_previews", { created_at: "9223372036854775807" })],
	});
}
function fakeConnection(options = {}) {
	const calls = [], stored = new Map(schema.tables.map(table => [table.name, []]));
	let insertCount = 0;
	const connection = {
		calls, stored,
		async query(sql, values = []) {
			calls.push({ method: "query", sql, values });
			if (sql === "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE") return [{ warningStatus: 0 }, []];
			if (sql.startsWith("SELECT DATABASE()")) return [[{ currentDatabase: "outdoor_fit_test", sqlMode: "STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES", foreignKeyChecks: 1, uniqueChecks: 1, maxAllowedPacket: 1024 ** 3, autocommit: 1, ...options.state }], []];
			if (sql.includes("GET_LOCK")) return [[{ acquired: options.lockResult ?? 1 }], []];
			if (sql.includes("RELEASE_LOCK")) return [[{ released: options.releaseResult ?? 1 }], []];
			const count = /^SELECT COUNT\(\*\) AS rowCount FROM `([^`]+)`$/.exec(sql);
			if (count) return [[{ rowCount: String(options.nonempty === count[1] ? 1 : stored.get(count[1]).length) }], []];
			throw new Error("Unexpected synthetic query");
		},
		async execute(input, params) {
			const sql = typeof input === "string" ? input : input.sql;
			calls.push({ method: "execute", sql, input, params });
			const insert = /^INSERT INTO `([^`]+)` \(([^)]+)\) VALUES /.exec(sql);
			if (insert) {
				insertCount++;
				if (insertCount === options.failInsert) throw Object.assign(new Error("private_driver_message"), { code: "ER_DUP_ENTRY", sql, sqlMessage: "private_driver_values" });
				const table = tableByName(insert[1]);
				assert.equal(insert[2], table.columns.map(column => "`" + column.name + "`").join(","));
				assert.equal(params.length % table.columns.length, 0);
				const rowCount = params.length / table.columns.length;
				for (let index = 0; index < rowCount; index++) stored.get(table.name).push(params.slice(index * table.columns.length, (index + 1) * table.columns.length));
				return [{ affectedRows: rowCount, warningStatus: insertCount === options.warningAt ? 1 : 0 }, []];
			}
			const read = / FROM `([^`]+)`$/.exec(sql);
			assert.ok(sql.startsWith("SELECT ") && read);
			assert.equal(input.bigNumberStrings, true);
			assert.equal(input.supportBigNumbers, true);
			const table = tableByName(read[1]);
			let records = stored.get(table.name).map((row, rowIndex) => {
				const result = Object.fromEntries(table.columns.map((column, index) => [column.name, row[index] === null || ["BIGINT", "DOUBLE"].includes(column.mysqlType) ? row[index] : Buffer.from(row[index], "utf8")]));
				for (const digest of table.digestKeys) {
					const value = row[table.columns.findIndex(column => column.name === digest.sourceColumn)];
					result[digest.digestColumn] = value === null ? null : createHash("sha256").update(value, "utf8").digest();
				}
				for (const column of table.internalColumns) {
					if (column.autoIncrement) result[column.name] = String(rowIndex + 42);
					if (column.name === "__active_name") result[column.name] = result.deleted_at === null ? result.name : null;
					if (column.name === "__active_phone") result[column.name] = result.used_at === null && result.revoked_at === null ? result.phone : null;
				}
				return result;
			});
			if (options.reverseReads) records.reverse();
			options.mutateRead?.(table.name, records);
			return [records, []];
		},
		async beginTransaction() { calls.push({ method: "begin" }); },
		async rollback() {
			calls.push({ method: "rollback" });
			if (options.rollbackError) throw new Error("private_rollback_message");
			for (const values of stored.values()) values.length = 0;
		},
		async commit() {
			calls.push({ method: "commit" });
			if (options.commitError) throw Object.assign(new Error("private_commit_message"), { code: "PROTOCOL_CONNECTION_LOST" });
		},
		destroy() { calls.push({ method: "destroy" }); },
	};
	return connection;
}
const run = (connection, input = example(), options = {}) => importMysqlData(connection, input, { write() {}, verifySchema, ...options });
async function rejected(connection, code, input = example(), options = {}) {
	let report;
	await assert.rejects(run(connection, input, options), error => {
		assert.equal(error.name, "MysqlDataImportError");
		assert.equal(error.code, code);
		assert.equal(error.report.status, "failed");
		assert.doesNotMatch(error.message + JSON.stringify(error.report), /private_|INSERT INTO|synthetic@example/);
		report = error.report;
		return true;
	});
	return report;
}
const inserts = connection => connection.calls.filter(call => call.method === "execute" && call.sql.startsWith("INSERT "));

test("a single transaction imports explicit source columns and fully verifies all 38 tables before commit", async () => {
	const connection = fakeConnection({ reverseReads: true }), lines = [];
	const input = example();
	const report = await run(connection, input, { write: line => lines.push(line) });
	assert.equal(report.status, "imported");
	assert.equal(report.commitStatus, "committed");
	assert.equal(report.schemaFingerprint, schemaFingerprint);
	assert.equal(report.tableCount, 38);
	assert.equal(report.tables.length, 38);
	assert.equal(report.insertedRows, input.rowCount);
	assert.equal(report.verifiedRows, input.rowCount);
	assert.equal(report.lockReleased, true);
	assert.equal(connection.calls.filter(call => call.method === "begin").length, 1);
	assert.equal(connection.calls.filter(call => call.method === "commit").length, 1);
	assert.equal(connection.calls.filter(call => call.method === "rollback").length, 0);
	const beginIndex = connection.calls.findIndex(call => call.method === "begin");
	assert.ok(connection.calls.findIndex(call => call.sql === "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE") < beginIndex);
	assert.ok(connection.calls.findIndex(call => call.sql?.startsWith("SELECT COUNT")) > beginIndex);
	const lastRead = connection.calls.findLastIndex(call => call.method === "execute" && call.sql.startsWith("SELECT "));
	assert.ok(lastRead < connection.calls.findIndex(call => call.method === "commit"));
	assert.ok(connection.calls.findIndex(call => call.sql?.startsWith("INSERT INTO `users`")) < connection.calls.findIndex(call => call.sql?.startsWith("INSERT INTO `admin_accounts`")));
	assert.ok(report.tables.every(table => /^[a-f0-9]{64}$/.test(table.contentSha256)));
	assert.equal(report.tables.find(table => table.name === "users").digestValuesChecked, 2);
	assert.ok(connection.calls.filter(call => call.sql).every(call => !/\b(?:DROP|TRUNCATE|DELETE|UPDATE|IGNORE|REPLACE)\b/.test(call.sql)));
	assert.ok(inserts(connection).every(call => !call.sql.includes("private_fixture") && !call.sql.includes("__")));
	assert.doesNotMatch(lines.join("\n") + JSON.stringify(report), /private_fixture|synthetic@example/);
});

test("row order does not change table content digests", async () => {
	const left = await run(fakeConnection()), right = await run(fakeConnection({ reverseReads: true }));
	assert.deepEqual(left.tables, right.tables);
});

test("DOUBLE content hashes retain the negative-zero sign", async () => {
	const signed = dataset({ facilities: [sourceRow("facilities", { source_id: "facility-1", latitude: -0 })] });
	const positive = dataset({ facilities: [sourceRow("facilities", { source_id: "facility-1", latitude: 0 })] });
	const left = await run(fakeConnection(), signed), right = await run(fakeConnection(), positive);
	assert.notEqual(left.tables.find(table => table.name === "facilities").contentSha256, right.tables.find(table => table.name === "facilities").contentSha256);
});

test("active generated values and both surrogate columns are verified without requiring contiguous IDs", async () => {
	const input = dataset({
		facilities: [sourceRow("facilities", { source_id: "facility-1" })],
		media_seed_folders: [sourceRow("media_seed_folders", { import_id: "seed-1", folder_path: "one" }), sourceRow("media_seed_folders", { import_id: "seed-1", folder_path: "two" })],
		media_folders: [
			sourceRow("media_folders", { [tableByName("media_folders").sourcePrimaryKey[0]]: "folder-1", name: "active 文" }),
			sourceRow("media_folders", { [tableByName("media_folders").sourcePrimaryKey[0]]: "folder-2", name: "deleted", deleted_at: "2026-01-01" }),
		],
		registration_codes: [
			sourceRow("registration_codes", { [tableByName("registration_codes").sourcePrimaryKey[0]]: "code-1", phone: "synthetic-phone-1" }),
			sourceRow("registration_codes", { [tableByName("registration_codes").sourcePrimaryKey[0]]: "code-2", phone: "synthetic-phone-2", used_at: "2026-01-01" }),
		],
	});
	const report = await run(fakeConnection(), input);
	assert.equal(report.tables.find(table => table.name === "media_folders").activeValuesChecked, 2);
	assert.equal(report.tables.find(table => table.name === "registration_codes").activeValuesChecked, 2);
	assert.equal(report.tables.find(table => table.name === "facilities").surrogateValuesChecked, 1);
	assert.equal(report.tables.find(table => table.name === "media_seed_folders").surrogateValuesChecked, 2);
	for (const [mutateRead, code] of [
		[(name, rows) => { if (name === "media_folders") rows[0].__active_name = null; }, "IMPORT_GENERATED_ACTIVE_MISMATCH"],
		[(name, rows) => { if (name === "registration_codes") rows[1].__active_phone = Buffer.from("unexpected"); }, "IMPORT_GENERATED_ACTIVE_MISMATCH"],
		[(name, rows) => { if (name === "media_seed_folders") rows[1].__mysql_row_id = rows[0].__mysql_row_id; }, "IMPORT_SURROGATE_INVALID"],
		[(name, rows) => { if (name === "facilities") rows[0].__mysql_row_id = "-1"; }, "IMPORT_SURROGATE_INVALID"],
	]) {
		const failure = await rejected(fakeConnection({ mutateRead }), code, input);
		assert.equal(failure.commitStatus, "rolled_back");
	}
});

test("prepared batches stop at 100 rows or the approximate one MiB budget", async () => {
	const rows = Array.from({ length: 201 }, (_, index) => sourceRow("users", { id: "u-" + index }));
	const connection = fakeConnection();
	await run(connection, dataset({ users: rows }));
	assert.deepEqual(inserts(connection).map(call => call.params.length / tableByName("users").columns.length), [100, 100, 1]);
	const large = fakeConnection();
	await run(large, dataset({ users: [0, 1, 2].map(index => sourceRow("users", { id: "large-" + index, avatar_data: "x".repeat(600_000) })) }));
	assert.equal(inserts(large).length, 3);
	const single = fakeConnection();
	await run(single, dataset({ users: [sourceRow("users", { id: "single", avatar_data: "x".repeat(1_100_000) })] }));
	assert.equal(inserts(single).length, 1);
});

test("a row over the connection packet budget is rejected before BEGIN or INSERT", async () => {
	const connection = fakeConnection({ state: { maxAllowedPacket: 32_768 } });
	await rejected(connection, "IMPORT_ROW_PACKET_TOO_LARGE", dataset({ users: [sourceRow("users", { id: "large", avatar_data: "x".repeat(40_000) })] }));
	assert.equal(connection.calls.filter(call => call.method === "begin").length, 0);
	assert.equal(inserts(connection).length, 0);
});

test("nonempty target, wrong database and unsafe session settings refuse mutation", async () => {
	for (const [options, code] of [
		[{ nonempty: "users" }, "IMPORT_DATABASE_NOT_EMPTY"],
		[{ state: { currentDatabase: "outdoor_fit_prod" } }, "IMPORT_DATABASE_REFUSED"],
		[{ state: { sqlMode: "" } }, "IMPORT_STRICT_MODE_REQUIRED"],
		[{ state: { foreignKeyChecks: 0 } }, "IMPORT_SESSION_UNSAFE"],
		[{ state: { uniqueChecks: 0 } }, "IMPORT_SESSION_UNSAFE"],
		[{ state: { autocommit: 0 } }, "IMPORT_SESSION_UNSAFE"],
		[{ lockResult: 0 }, "IMPORT_LOCK_UNAVAILABLE"],
	]) {
		const connection = fakeConnection(options);
		await rejected(connection, code);
		assert.equal(inserts(connection).length, 0);
		assert.equal(connection.calls.filter(call => call.method === "begin").length, options.nonempty ? 1 : 0);
		if (options.nonempty) assert.equal(connection.calls.filter(call => call.method === "rollback").length, 1);
	}
});

test("schema verification shares the connection while holding a distinct migration lock", async () => {
	const connection = fakeConnection();
	let verified = false;
	await run(connection, example(), { async verifySchema(actualConnection, actualSchema) {
		assert.equal(actualConnection, connection); assert.equal(actualSchema, schema);
		const lock = connection.calls.find(call => call.sql?.includes("GET_LOCK"));
		assert.equal(lock.values[0], "outdoor-fit:mysql-data:outdoor_fit_test");
		assert.ok(!connection.calls.some(call => call.method === "begin"));
		verified = true;
		return verifySchema();
	} });
	assert.equal(verified, true);
	const rejectedConnection = fakeConnection();
	const report = await rejected(rejectedConnection, "SCHEMA_METADATA_MISMATCH", example(), { verifySchema() { throw Object.assign(new Error("private_metadata"), { code: "SCHEMA_METADATA_MISMATCH" }); } });
	assert.equal(report.lockReleased, true);
	assert.equal(inserts(rejectedConnection).length, 0);
});

test("warnings or INSERT failures roll back the whole transaction without retries", async () => {
	for (const [options, code] of [[{ warningAt: 2 }, "IMPORT_INSERT_WARNING"], [{ failInsert: 2 }, "ER_DUP_ENTRY"]]) {
		const connection = fakeConnection(options);
		const report = await rejected(connection, code);
		assert.equal(report.commitStatus, "rolled_back");
		assert.equal(report.rollbackStatus, "rolled_back");
		assert.equal(report.lockReleased, true);
		assert.equal(inserts(connection).length, 2);
		assert.equal(connection.calls.filter(call => call.method === "rollback").length, 1);
		assert.equal(connection.calls.filter(call => call.method === "commit").length, 0);
		assert.ok([...connection.stored.values()].every(rows => rows.length === 0));
	}
});

test("full field comparison rejects text, NULL, DOUBLE, BIGINT and generated digest changes", async () => {
	for (const [mutateRead, code] of [
		[(name, rows) => { if (name === "users") rows[0].name = Buffer.from("changed"); }, "IMPORT_VALUE_MISMATCH"],
		[(name, rows) => { if (name === "users") rows[1].email = Buffer.alloc(0); }, "IMPORT_VALUE_MISMATCH"],
		[(name, rows) => { if (name === "users") rows[0].name = Buffer.from([0xc3, 0x28]); }, "IMPORT_TEXT_UTF8_INVALID"],
		[(name, rows) => { if (name === "facilities") rows[0].longitude = 100; }, "IMPORT_VALUE_MISMATCH"],
		[(name, rows) => { if (name === "facilities") rows[0].latitude = 0; }, "IMPORT_VALUE_MISMATCH"],
		[(name, rows) => { if (name === "equipment_document_previews") rows[0].created_at = 9223372036854775807; }, "IMPORT_INTEGER_INVALID"],
		[(name, rows) => { if (name === "users") rows[0].__email_sha256 = Buffer.alloc(32); }, "IMPORT_GENERATED_DIGEST_MISMATCH"],
		[(name, rows) => { if (name === "facilities") rows[0].__mysql_row_id = "0"; }, "IMPORT_SURROGATE_INVALID"],
		[(name, rows) => { if (name === "users") rows.pop(); }, "IMPORT_ROW_COUNT_MISMATCH"],
		[(name, rows) => { if (name === "users") rows[1] = rows[0]; }, "IMPORT_PRIMARY_KEY_MISMATCH"],
	]) {
		const connection = fakeConnection({ mutateRead });
		const report = await rejected(connection, code);
		assert.equal(report.commitStatus, "rolled_back");
		assert.equal(connection.calls.filter(call => call.method === "commit").length, 0);
	}
});

test("unsafe source integers fail before touching the database", async () => {
	const input = example();
	const table = input.tables.find(table => table.name === "equipment_document_previews");
	table.rows[0][table.columns.indexOf("created_at")] = 9223372036854775807;
	const connection = fakeConnection();
	await rejected(connection, "IMPORT_INTEGER_INVALID", input);
	assert.equal(connection.calls.length, 0);
});

test("rollback failure destroys the connection and preserves the initial safe failure", async () => {
	const connection = fakeConnection({ warningAt: 1, rollbackError: true });
	const report = await rejected(connection, "IMPORT_INSERT_WARNING");
	assert.equal(report.rollbackStatus, "failed");
	assert.equal(report.connectionDestroyed, true);
	assert.equal(report.lockReleased, false);
	assert.equal(connection.calls.at(-1).method, "destroy");
});

test("COMMIT failure has unknown outcome, destroys the connection, and never claims rollback or retries", async () => {
	const connection = fakeConnection({ commitError: true });
	const report = await rejected(connection, "PROTOCOL_CONNECTION_LOST");
	assert.equal(report.commitStatus, "unknown");
	assert.equal(report.rollbackStatus, "not_needed");
	assert.equal(report.connectionDestroyed, true);
	assert.equal(connection.calls.filter(call => call.method === "commit").length, 1);
	assert.equal(connection.calls.filter(call => call.method === "rollback").length, 0);
	assert.equal(connection.calls.at(-1).method, "destroy");
});

test("post-commit lock-release failure retains the committed outcome", async () => {
	const connection = fakeConnection({ releaseResult: 0 });
	const report = await rejected(connection, "IMPORT_LOCK_RELEASE_FAILED");
	assert.equal(report.commitStatus, "committed");
	assert.equal(report.connectionDestroyed, true);
	assert.equal(connection.calls.filter(call => call.method === "rollback").length, 0);
});
