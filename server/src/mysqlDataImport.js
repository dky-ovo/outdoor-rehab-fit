import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { verifyMysqlSchema } from "./mysqlSchemaApply.js";

const DATABASE = "outdoor_fit_test";
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const DECIMAL = /^(?:0|-?[1-9]\d*)$/;
const MIB = 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

class ImportFailure extends Error {
	constructor(code) { super("MySQL data import could not be completed"); this.code = code; }
}
function requireCondition(condition, code) { if (!condition) throw new ImportFailure(code); }
function safeCode(error) {
	return error instanceof ImportFailure || /^(?:ER|SCHEMA)_[A-Z0-9_]+$/.test(error?.code || "") ||
		["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error?.code)
		? error.code : "IMPORT_OPERATION_FAILED";
}
function quote(name) {
	requireCondition(typeof name === "string" && IDENTIFIER.test(name), "IMPORT_IDENTIFIER_INVALID");
	return "`" + name + "`";
}
function integer(value) {
	requireCondition(typeof value === "string" && DECIMAL.test(value), "IMPORT_INTEGER_INVALID");
	const number = BigInt(value);
	requireCondition(number >= -(1n << 63n) && number < (1n << 63n), "IMPORT_INTEGER_INVALID");
	return value;
}
function typedValue(value, column, fromServer = false) {
	if (value === null) {
		requireCondition(column.nullable, "IMPORT_NULL_INVALID");
		return null;
	}
	if (column.mysqlType === "BIGINT") return integer(value);
	if (column.mysqlType === "DOUBLE") {
		requireCondition(typeof value === "number" && Number.isFinite(value), "IMPORT_DOUBLE_INVALID");
		return value;
	}
	requireCondition(column.mysqlType === "MEDIUMTEXT" || /^VARCHAR\(\d+\)$/.test(column.mysqlType), "IMPORT_TYPE_UNSUPPORTED");
	if (fromServer && Buffer.isBuffer(value)) {
		try { value = utf8.decode(value); } catch { throw new ImportFailure("IMPORT_TEXT_UTF8_INVALID"); }
	}
	requireCondition(typeof value === "string" && value.isWellFormed(), "IMPORT_TEXT_INVALID");
	return value;
}
function keyFor(row, table) {
	return JSON.stringify(table.sourcePrimaryKey.map(name => {
		const index = table.columns.findIndex(column => column.name === name);
		requireCondition(index >= 0 && row[index] !== null, "IMPORT_PRIMARY_KEY_INVALID");
		return [table.columns[index].mysqlType === "BIGINT" ? "i" : table.columns[index].mysqlType === "DOUBLE" ? "f" : "s", row[index]];
	}));
}
function hashRow(hash, row, columns) {
	for (const [index, value] of row.entries()) {
		const type = value === null ? "n" : columns[index].mysqlType === "BIGINT" ? "i" : columns[index].mysqlType === "DOUBLE" ? "f" : "s";
		const bytes = value === null ? Buffer.alloc(0) : type === "f" ? Buffer.alloc(8) : Buffer.from(String(value), "utf8");
		if (type === "f") bytes.writeDoubleBE(value);
		hash.update(type + bytes.length + ":"); hash.update(bytes); hash.update(";");
	}
	hash.update("\n");
}
function prepareDataset(dataset) {
	requireCondition(dataset && [dataset.sourceSha256, dataset.manifestSha256, dataset.exportSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)), "IMPORT_DATASET_INVALID");
	const schema = dataset.schema;
	requireCondition(schema?.tables?.length === 38 && dataset.tables?.length === 38 && schema.createOrder?.length === 38, "IMPORT_DATASET_INVALID");
	const tables = new Map(schema.tables.map(table => [table.name, table]));
	const data = new Map(dataset.tables.map(table => [table.name, table]));
	requireCondition(tables.size === 38 && data.size === 38 && new Set(schema.createOrder).size === 38, "IMPORT_DATASET_INVALID");
	let total = 0;
	for (const [position, name] of schema.createOrder.entries()) {
		quote(name);
		const table = tables.get(name), source = data.get(name);
		requireCondition(table && source && Array.isArray(source.rows) && Number.isSafeInteger(source.rowCount) && source.rowCount === source.rows.length &&
			JSON.stringify(source.columns) === JSON.stringify(table.columns.map(column => column.name)) && table.sourcePrimaryKey.length > 0, "IMPORT_DATASET_INVALID");
		for (const column of table.columns) quote(column.name);
		for (const digest of table.digestKeys) { quote(digest.digestColumn); requireCondition(source.columns.includes(digest.sourceColumn), "IMPORT_DATASET_INVALID"); }
		for (const foreign of table.foreignKeys) {
			requireCondition(foreign.referencedTable !== name, "IMPORT_SELF_FOREIGN_KEY_UNSUPPORTED");
			requireCondition(schema.createOrder.indexOf(foreign.referencedTable) >= 0 && schema.createOrder.indexOf(foreign.referencedTable) < position, "IMPORT_FOREIGN_KEY_ORDER_INVALID");
		}
		const keys = new Set();
		for (const row of source.rows) {
			requireCondition(Array.isArray(row) && row.length === table.columns.length, "IMPORT_DATASET_INVALID");
			row.forEach((value, index) => typedValue(value, table.columns[index]));
			const key = keyFor(row, table);
			requireCondition(!keys.has(key), "IMPORT_PRIMARY_KEY_DUPLICATE"); keys.add(key);
		}
		total += source.rowCount;
	}
	requireCondition(Number.isSafeInteger(dataset.rowCount) && total === dataset.rowCount, "IMPORT_DATASET_INVALID");
	return { tables, data };
}
async function select(connection, sql, values = []) {
	const [result] = await connection.query(sql, values);
	requireCondition(Array.isArray(result), "IMPORT_RESULT_INVALID");
	return result;
}
function countValue(value) {
	requireCondition((typeof value === "number" && Number.isSafeInteger(value)) || (typeof value === "string" && /^\d+$/.test(value)), "IMPORT_COUNT_INVALID");
	const count = Number(value);
	requireCondition(Number.isSafeInteger(count) && count >= 0, "IMPORT_COUNT_INVALID");
	return count;
}
function *batches(table, source, packetBudget) {
	const prefix = `INSERT INTO ${quote(table.name)} (${source.columns.map(quote).join(",")}) VALUES `;
	const tuple = "(" + source.columns.map(() => "?").join(",") + ")";
	const baseBytes = Buffer.byteLength(prefix) + 64;
	let batch = [], bytes = baseBytes;
	for (const row of source.rows) {
		const rowBytes = Buffer.byteLength(tuple) + 1 + row.reduce((sum, value) => sum + 16 + (value === null ? 0 : typeof value === "number" ? 8 : Buffer.byteLength(value, "utf8")), 0);
		requireCondition(baseBytes + rowBytes <= packetBudget, "IMPORT_ROW_PACKET_TOO_LARGE");
		if (batch.length && (batch.length === 100 || bytes + rowBytes > Math.min(MIB, packetBudget))) {
			yield { sql: prefix + batch.map(() => tuple).join(","), params: batch.flat(), rowCount: batch.length };
			batch = []; bytes = baseBytes;
		}
		batch.push(row); bytes += rowBytes;
	}
	if (batch.length) yield { sql: prefix + batch.map(() => tuple).join(","), params: batch.flat(), rowCount: batch.length };
}

async function verifyTable(connection, table, source, report) {
	const fields = table.columns.map(column => ["BIGINT", "DOUBLE"].includes(column.mysqlType) ? quote(column.name) : `CAST(${quote(column.name)} AS BINARY) AS ${quote(column.name)}`)
		.concat(table.internalColumns.map(column => column.charset ? `CAST(${quote(column.name)} AS BINARY) AS ${quote(column.name)}` : quote(column.name)));
	// Binary-protocol DOUBLE decoding preserves the stored IEEE-754 value; the
	// driver's text-protocol decimal parser can introduce an extra rounding.
	const [actual] = await connection.execute({ sql: `SELECT ${fields.join(",")} FROM ${quote(table.name)}`, supportBigNumbers: true, bigNumberStrings: true });
	requireCondition(Array.isArray(actual) && actual.length === source.rowCount, "IMPORT_ROW_COUNT_MISMATCH");
	const expected = new Map(source.rows.map(row => [keyFor(row, table), row]));
	const found = new Set();
	const surrogateKeys = new Map(table.internalColumns.filter(column => column.autoIncrement).map(column => [column.name, new Set()]));
	let digestValuesChecked = 0, activeValuesChecked = 0, surrogateValuesChecked = 0;
	for (const record of actual) {
		const row = table.columns.map(column => {
			report.column = column.name;
			return typedValue(record[column.name], column, true);
		});
		const key = keyFor(row, table), original = expected.get(key);
		requireCondition(original && !found.has(key), "IMPORT_PRIMARY_KEY_MISMATCH"); found.add(key);
		for (const [index, value] of row.entries()) {
			report.column = table.columns[index].name;
			const wanted = original[index];
			requireCondition(table.columns[index].mysqlType === "DOUBLE" ? Object.is(value, wanted) : value === wanted, "IMPORT_VALUE_MISMATCH");
			if (typeof value === "string" && table.columns[index].mysqlType !== "BIGINT") {
				requireCondition(Buffer.from(value, "utf8").equals(Buffer.from(wanted, "utf8")), "IMPORT_VALUE_MISMATCH");
			}
		}
		for (const digest of table.digestKeys) {
			report.column = digest.digestColumn;
			const value = original[source.columns.indexOf(digest.sourceColumn)], stored = record[digest.digestColumn];
			const wanted = value === null ? null : createHash("sha256").update(Buffer.from(value, "utf8")).digest();
			requireCondition(wanted === null ? stored === null : Buffer.isBuffer(stored) && stored.length === 32 && wanted.equals(stored), "IMPORT_GENERATED_DIGEST_MISMATCH");
				digestValuesChecked++;
		}
		for (const column of table.internalColumns.filter(column => !table.digestKeys.some(digest => digest.digestColumn === column.name))) {
			report.column = column.name;
			if (column.autoIncrement) {
				const value = integer(record[column.name]), seen = surrogateKeys.get(column.name);
				requireCondition(BigInt(value) > 0n && !seen.has(value), "IMPORT_SURROGATE_INVALID");
				seen.add(value); surrogateValuesChecked++;
			} else {
				const originalValue = name => original[source.columns.indexOf(name)];
				let wanted;
				if (table.name === "media_folders" && column.name === "__active_name") wanted = originalValue("deleted_at") === null ? originalValue("name") : null;
				else if (table.name === "registration_codes" && column.name === "__active_phone") wanted = originalValue("used_at") === null && originalValue("revoked_at") === null ? originalValue("phone") : null;
				else throw new ImportFailure("IMPORT_GENERATED_COLUMN_UNSUPPORTED");
				requireCondition(typedValue(record[column.name], column, true) === wanted, "IMPORT_GENERATED_ACTIVE_MISMATCH");
				activeValuesChecked++;
			}
		}
	}
	delete report.column;
	const [count] = await select(connection, `SELECT COUNT(*) AS rowCount FROM ${quote(table.name)}`);
	requireCondition(countValue(count?.rowCount) === source.rowCount, "IMPORT_ROW_COUNT_MISMATCH");
	const hash = createHash("sha256").update("outdoor-fit:mysql-data:v1\0" + table.name + "\0");
	for (const key of [...expected.keys()].sort()) hashRow(hash, expected.get(key), table.columns);
	return { name: table.name, rowCount: source.rowCount, contentSha256: hash.digest("hex"), digestValuesChecked, activeValuesChecked, surrogateValuesChecked };
}

export async function importMysqlData(connection, dataset, { expectedDatabase = DATABASE, write = console.log, verifySchema = verifyMysqlSchema } = {}) {
	const database = ["outdoor_fit_test", "outdoor_fit_prod"].includes(expectedDatabase) ? expectedDatabase : null;
	const lockName = "outdoor-fit:mysql-data:" + database;
	const report = { status: "failed", database, operation: "validate", tableCount: 0, rowCount: 0,
		insertedRows: 0, verifiedRows: 0, batches: 0, tables: [], lockAcquired: false, lockReleased: false,
		commitStatus: "not_attempted", rollbackStatus: "not_needed", connectionDestroyed: false };
	let failure, transactionStarted = false, commitAttempted = false;
	const emit = line => { try { write(line); } catch { throw new ImportFailure("IMPORT_PROGRESS_WRITE_FAILED"); } };
	const destroy = () => { try { connection.destroy(); report.connectionDestroyed = true; } catch {} };
	try {
		requireCondition(connection && ["query", "execute", "beginTransaction", "commit", "rollback", "destroy"].every(name => typeof connection[name] === "function") && typeof write === "function" && typeof verifySchema === "function", "IMPORT_ARGUMENT_INVALID");
		requireCondition(database !== null, "IMPORT_DATABASE_REFUSED");
		const { tables, data } = prepareDataset(dataset);
		Object.assign(report, { sourceSha256: dataset.sourceSha256, manifestSha256: dataset.manifestSha256, exportSha256: dataset.exportSha256, tableCount: tables.size, rowCount: dataset.rowCount });
		report.operation = "preflight";
		const [state] = await select(connection, "SELECT DATABASE() AS currentDatabase, @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks, @@SESSION.unique_checks AS uniqueChecks, @@SESSION.max_allowed_packet AS maxAllowedPacket, @@SESSION.autocommit AS autocommit");
		requireCondition(state?.currentDatabase === database, "IMPORT_DATABASE_REFUSED");
		requireCondition(String(state.sqlMode).split(",").some(mode => ["STRICT_TRANS_TABLES", "STRICT_ALL_TABLES"].includes(mode.trim())), "IMPORT_STRICT_MODE_REQUIRED");
		requireCondition(Number(state.foreignKeyChecks) === 1 && Number(state.uniqueChecks) === 1 && Number(state.autocommit) === 1, "IMPORT_SESSION_UNSAFE");
		const packetBudget = Math.min(16 * MIB, countValue(state.maxAllowedPacket) - 4096);
		requireCondition(packetBudget > 1024, "IMPORT_PACKET_LIMIT_INVALID");
		report.operation = "lock_acquire";
		const [lock] = await select(connection, "SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
		requireCondition(Number(lock?.acquired) === 1, "IMPORT_LOCK_UNAVAILABLE"); report.lockAcquired = true;
		report.operation = "verify_schema";
		const schemaReport = await verifySchema(connection, dataset.schema, { expectedDatabase: database, write() {} });
		requireCondition(schemaReport?.status === "verified" && schemaReport.database === database && /^[a-f0-9]{64}$/.test(schemaReport.fingerprint || ""), "IMPORT_SCHEMA_UNVERIFIED");
		report.schemaFingerprint = schemaReport.fingerprint;
		report.operation = "packet_check";
		for (const name of dataset.schema.createOrder) {
			report.table = name;
			// Validate individual packet sizes before opening the transaction.
			for (const batch of batches(tables.get(name), data.get(name), packetBudget)) void batch;
		}
		delete report.table;
		report.operation = "isolation";
		await connection.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
		report.operation = "begin"; transactionStarted = true;
		await connection.beginTransaction();
		// SERIALIZABLE makes these transactional reads hold shared range locks
		// through COMMIT, so another writer cannot fill a table after this check.
		report.operation = "empty_check";
		for (const name of dataset.schema.createOrder) {
			report.table = name;
			const [count] = await select(connection, `SELECT COUNT(*) AS rowCount FROM ${quote(name)}`);
			requireCondition(countValue(count?.rowCount) === 0, "IMPORT_DATABASE_NOT_EMPTY");
		}
		for (const name of dataset.schema.createOrder) {
			report.operation = "insert"; report.table = name;
			for (const batch of batches(tables.get(name), data.get(name), packetBudget)) {
				const [result] = await connection.execute(batch.sql, batch.params);
				requireCondition(result && Number(result.warningStatus) === 0, "IMPORT_INSERT_WARNING");
				requireCondition(countValue(result.affectedRows) === batch.rowCount, "IMPORT_AFFECTED_ROWS_MISMATCH");
				report.batches++; report.insertedRows += batch.rowCount;
			}
			emit("IMPORT_INSERTED " + name + " " + data.get(name).rowCount);
		}
		for (const name of dataset.schema.createOrder) {
			report.operation = "verify_data"; report.table = name;
			const tableReport = await verifyTable(connection, tables.get(name), data.get(name), report);
			report.tables.push(tableReport); report.verifiedRows += tableReport.rowCount;
			emit("IMPORT_VERIFIED " + name + " " + tableReport.rowCount);
		}
		delete report.table;
		report.operation = "commit"; commitAttempted = true; report.commitStatus = "unknown";
		await connection.commit(); transactionStarted = false;
		report.commitStatus = "committed"; report.status = "imported"; report.operation = "complete";
	} catch (error) {
		failure = safeCode(error);
		if (commitAttempted && report.commitStatus !== "committed") {
			report.commitStatus = "unknown"; destroy();
		} else if (transactionStarted) {
			try { await connection.rollback(); report.rollbackStatus = "rolled_back"; report.commitStatus = "rolled_back"; }
			catch { report.rollbackStatus = "failed"; destroy(); }
		}
	} finally {
		if (report.lockAcquired && !report.connectionDestroyed) {
			try {
				const [lock] = await select(connection, "SELECT RELEASE_LOCK(?) AS released", [lockName]);
				requireCondition(Number(lock?.released) === 1, "IMPORT_LOCK_RELEASE_FAILED"); report.lockReleased = true;
			} catch (error) {
				report.lockReleaseErrorCode = safeCode(error);
				if (!failure) { failure = "IMPORT_LOCK_RELEASE_FAILED"; report.operation = "lock_release"; }
				destroy();
			}
		}
	}
	if (failure) {
		report.status = "failed"; report.errorCode = failure;
		const error = new ImportFailure(failure); error.name = "MysqlDataImportError"; error.report = report; throw error;
	}
	return report;
}
