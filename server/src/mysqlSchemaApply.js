import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

const DATABASE = "outdoor_fit_test";
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const METADATA_FIELDS = new Set([
	"currentDatabase", "mysqlVersion", "sqlMode", "foreignKeyChecks", "uniqueChecks", "pageSize",
	"acquired", "released", "objectCount", "tableName", "tableType", "engine", "rowFormat", "collation",
	"name", "ordinal", "columnType", "isNullable", "charset", "columnDefault", "extra", "generationExpression",
	"nonUnique", "columnName", "direction", "prefixLength", "referencedSchema", "referencedTable",
	"referencedColumn", "onDelete", "onUpdate", "enforced", "expression",
]);
// This decoder is only used for the known metadata/state SELECT aliases below.
// ignoreBOM preserves a leading BOM instead of silently deleting a code point.
const metadataDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const DRIVER_CODES = new Set([
	"ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR",
	"ER_BAD_DB_ERROR", "ER_TABLE_EXISTS_ERROR", "ER_CANT_CREATE_TABLE", "ER_TOO_LONG_KEY",
	"ER_TOO_BIG_ROWSIZE", "ER_DUP_KEYNAME", "ER_DUP_FIELDNAME", "ER_FK_DUP_NAME",
	"ER_DUP_CONSTRAINT_NAME", "ER_CANNOT_ADD_FOREIGN", "ER_FK_CANNOT_OPEN_PARENT",
	"ER_FK_INCOMPATIBLE_COLUMNS", "ER_PARSE_ERROR", "ER_UNKNOWN_COLLATION",
	"ER_NOT_SUPPORTED_YET", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK",
	"ER_USER_LOCK_DEADLOCK", "ER_SERVER_SHUTDOWN", "PROTOCOL_CONNECTION_LOST",
	"ECONNRESET", "EPIPE", "ETIMEDOUT",
]);

class SchemaFailure extends Error {
	constructor(code) { super("MySQL schema application could not be completed"); this.code = code; }
}

function requireCondition(condition, code) {
	if (!condition) throw new SchemaFailure(code);
}

function safeCode(error) {
	return error instanceof SchemaFailure || DRIVER_CODES.has(error?.code) || /^ER_[A-Z0-9_]+$/.test(error?.code || "")
		? error.code : "SCHEMA_OPERATION_FAILED";
}

// Parse the expressions used by the schema contract instead of deleting all
// parentheses: (a AND b) OR c must not compare equal to a AND (b OR c).
function expressionTree(sql) {
	if (sql == null || sql === "") return null;
	requireCondition(typeof sql === "string", "SCHEMA_EXPRESSION_UNSUPPORTED");
	const tokens = [];
	let cursor = 0;
	while (cursor < sql.length) {
		if (/\s/.test(sql[cursor])) { cursor++; continue; }
		const character = sql[cursor];
		if (character === "'" || character === "`") {
			const quote = character;
			let value = "", closed = false;
			cursor++;
			while (cursor < sql.length) {
				const next = sql[cursor++];
				if (next === quote) {
					if (sql[cursor] === quote) { value += quote; cursor++; }
					else { closed = true; break; }
				} else if (next === "\\" && quote === "'") {
					requireCondition(cursor < sql.length, "SCHEMA_EXPRESSION_UNSUPPORTED");
					const escaped = sql[cursor++];
					value += ({ n: "\n", r: "\r", t: "\t", b: "\b", "0": "\0", Z: "\x1a" })[escaped] ?? escaped;
				} else value += next;
			}
			requireCondition(closed, "SCHEMA_EXPRESSION_UNSUPPORTED");
			tokens.push({ type: quote === "'" ? "string" : "word", value: quote === "'" ? value : value.toLowerCase() });
			continue;
		}
		const match = /^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[a-zA-Z_][a-zA-Z0-9_]*|<=>|<=|>=|<>|!=|[(),=<>+*/%-])/.exec(sql.slice(cursor));
		requireCondition(match, "SCHEMA_EXPRESSION_UNSUPPORTED");
		const value = match[0].toLowerCase();
		tokens.push({ type: /^\d/.test(value) ? "number" : /^[a-z_]/.test(value) ? "word" : "symbol", value });
		cursor += match[0].length;
	}
	// MySQL prefixes string literals in stored CHECK definitions with their charset.
	const cleaned = tokens.filter((token, index) => !(token.type === "word" && /^_(?:utf8mb4|utf8mb3|utf8|binary)$/.test(token.value) && tokens[index + 1]?.type === "string"));
	let position = 0;
	const peek = () => cleaned[position]?.value;
	const take = value => { requireCondition(peek() === value, "SCHEMA_EXPRESSION_UNSUPPORTED"); position++; };
	function atom() {
		const token = cleaned[position++];
		requireCondition(token, "SCHEMA_EXPRESSION_UNSUPPORTED");
		if (token.type === "symbol" && token.value === "(") { const value = parse(0); take(")"); return value; }
		if (["+", "-", "not"].includes(token.value) && token.type !== "string") {
			const value = parse(token.value === "not" ? 15 : 50);
			if (token.value === "+" && value[0] === "number") return value;
			if (token.value === "-" && value[0] === "number") return ["number", String(-Number(value[1]))];
			return ["unary", token.value, value];
		}
		if (token.type === "string") return ["string", token.value];
		if (token.type === "number") return ["number", String(Number(token.value))];
		requireCondition(token.type === "word", "SCHEMA_EXPRESSION_UNSUPPORTED");
		if (token.value === "case") {
			const clauses = [];
			while (peek() === "when") { take("when"); const condition = parse(0); take("then"); clauses.push([condition, parse(0)]); }
			requireCondition(clauses.length > 0, "SCHEMA_EXPRESSION_UNSUPPORTED");
			let otherwise = ["word", "null"];
			if (peek() === "else") { take("else"); otherwise = parse(0); }
			take("end");
			return ["case", clauses, otherwise];
		}
		if (peek() === "(") {
			take("(");
			if (token.value === "cast") {
				const value = parse(0); take("as");
				// MySQL renders CAST(value AS BINARY) as CHAR CHARSET BINARY.
				if (peek() === "binary") take("binary");
				else { take("char"); take("charset"); take("binary"); }
				take(")"); return ["cast_binary", value];
			}
			const arguments_ = [];
			if (peek() !== ")") {
				do { arguments_.push(parse(0)); if (peek() !== ",") break; take(","); } while (true);
			}
			take(")"); return ["call", ({ substr: "substring", character_length: "char_length" })[token.value] || token.value, arguments_];
		}
		return ["word", token.value];
	}
	function parse(minimum) {
		let left = atom();
		while (position < cleaned.length) {
			let operator = peek();
			const compoundNot = operator === "not" && ["in", "between"].includes(cleaned[position + 1]?.value);
			if (compoundNot) operator = "not " + cleaned[position + 1].value;
			const precedence = ({ or: 5, and: 10, "=": 20, "!=": 20, "<>": 20, "<=>": 20, "<": 20, ">": 20,
				"<=": 20, ">=": 20, is: 20, in: 20, "not in": 20, between: 20, "not between": 20,
				"+": 30, "-": 30, "*": 40, "/": 40, "%": 40 })[operator];
			if (precedence === undefined || precedence < minimum) break;
			position += compoundNot ? 2 : 1;
			if (operator.endsWith("between")) {
				const start = parse(21); take("and"); left = [operator, left, start, parse(21)];
			} else if (operator.endsWith("in")) {
				take("("); const values = [];
				do { values.push(parse(0)); if (peek() !== ",") break; take(","); } while (true);
				take(")"); left = [operator, left, values];
			} else if (operator === "is") {
				const negate = peek() === "not"; if (negate) take("not");
				requireCondition(["null", "true", "false", "unknown"].includes(peek()), "SCHEMA_EXPRESSION_UNSUPPORTED");
				left = [negate ? "is not" : "is", left, cleaned[position++].value];
			} else {
				const right = parse(precedence + 1);
				if (["and", "or"].includes(operator)) {
					const operands = value => value[0] === operator ? value.slice(1) : [value];
					left = [operator, ...operands(left), ...operands(right)];
				} else left = [operator === "!=" ? "<>" : operator, left, right];
			}
		}
		return left;
	}
	const tree = parse(0);
	requireCondition(position === cleaned.length, "SCHEMA_EXPRESSION_UNSUPPORTED");
	return tree;
}

const typeName = value => String(value ?? "").toLowerCase().replace(/\s+/g, "");
const ruleName = value => ["no action", "restrict"].includes(String(value).toLowerCase()) ? "RESTRICT" : String(value).toUpperCase();
const sorted = (items, key) => [...items].sort((a, b) => key(a).localeCompare(key(b), "en"));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function decodeMetadataExpression(value, report) {
	if (typeof value !== "string" || !value.includes("\\")) return value;
	// MySQL 8.0.36 String::print applies this display encoding to the UTF-8
	// dictionary expressions exposed by information_schema. Undo one layer,
	// leaving any SQL literal escapes for expressionTree to interpret.
	const escapes = { "\\": "\\", "'": "'", "0": "\0", n: "\n", r: "\r", Z: "\x1a" };
	let decoded = "";
	for (let index = 0; index < value.length; index++) {
		if (value[index] !== "\\") {
			// Once display escapes are present, a raw quote/control character
			// would mix encoded and unencoded SQL. Refuse that ambiguity.
			requireCondition(!["'", "\0", "\n", "\r", "\x1a"].includes(value[index]), "SCHEMA_METADATA_ESCAPE_INVALID");
			decoded += value[index]; continue;
		}
		const escaped = value[++index];
		requireCondition(Object.hasOwn(escapes, escaped), "SCHEMA_METADATA_ESCAPE_INVALID");
		decoded += escapes[escaped];
	}
	if (report) report.metadataDecodedExpressions++;
	return decoded;
}

function metadataExpression(value, report) {
	try { return expressionTree(decodeMetadataExpression(value, report)); }
	catch (error) {
		report.expressionValueType = value === null ? "null" : typeof value;
		report.expressionLength = typeof value === "string" ? value.length : null;
		report.expressionBackslashQuoteCount = typeof value === "string" ? value.split("\\'").length - 1 : null;
		throw error;
	}
}

function metadataDefault(row, report) {
	if (row.columnDefault === null) return null;
	requireCondition(row.columnDefault !== undefined, "SCHEMA_METADATA_RESULT_INVALID");
	if (/\bdefault_generated\b/i.test(row.extra || "")) {
		const expression = metadataExpression(row.columnDefault, report);
		requireCondition(expression && ["string", "number"].includes(expression[0]), "SCHEMA_DEFAULT_UNSUPPORTED");
		return expression[1];
	}
	return String(row.columnDefault);
}

function singleStatement(sql) {
	if (typeof sql !== "string" || !sql.trim()) return false;
	let quote = null;
	for (let index = 0; index < sql.length; index++) {
		const character = sql[index];
		if (quote) {
			if (character === "\\" && quote !== "`") index++;
			else if (character === quote) {
				if (sql[index + 1] === quote) index++;
				else quote = null;
			}
		} else if (["'", '"', "`"].includes(character)) quote = character;
		else if (character === ";" && sql.slice(index + 1).trim()) return false;
		else if (sql.slice(index, index + 2) === "--" || sql.slice(index, index + 2) === "/*" || character === "#") return false;
	}
	return quote === null;
}

function metadataContext(report, kind, table, column) {
	if (!report) return;
	delete report.metadataKind;
	delete report.table;
	delete report.column;
	if (kind) report.metadataKind = kind;
	if (typeof table === "string" && IDENTIFIER.test(table)) report.table = table;
	if (typeof column === "string" && IDENTIFIER.test(column)) report.column = column;
}

function expectedMetadata(schema, report, database) {
	requireCondition(schema?.formatVersion === 1 && /^[a-f0-9]{64}$/i.test(schema.sourceSchemaHash || "") &&
		schema.charset === "utf8mb4" && schema.collation === "utf8mb4_0900_bin" && schema.engine === "InnoDB" &&
		String(schema.rowFormat).toLowerCase() === "dynamic" && Array.isArray(schema.tables) && schema.tables.length === 38,
	"SCHEMA_CONTRACT_INVALID");
	const tables = new Map(schema.tables.map(table => [table.name, table]));
	requireCondition(tables.size === 38 && [...tables.keys()].every(name => IDENTIFIER.test(name)), "SCHEMA_CONTRACT_INVALID");
	requireCondition(schema.tables.reduce((total, table) => total + table.columns.length, 0) === 324 &&
		schema.tables.reduce((total, table) => total + table.foreignKeys.length, 0) === 33, "SCHEMA_CONTRACT_INVALID");
	const expected = { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] };
	for (const table of schema.tables) {
		expected.tables.push({ table: table.name, engine: "innodb", rowFormat: "dynamic", collation: schema.collation });
		for (const [ordinal, column] of [...table.columns, ...table.internalColumns].entries()) {
			requireCondition(IDENTIFIER.test(column.name), "SCHEMA_CONTRACT_INVALID");
			metadataContext(report, "generation_expression", table.name, column.name);
			expected.columns.push({ table: table.name, name: column.name, ordinal: ordinal + 1, type: typeName(column.mysqlType),
				nullable: column.nullable, charset: column.charset, collation: column.collation,
				default: column.defaultValue === null ? null : String(column.defaultValue),
				autoIncrement: Boolean(column.autoIncrement), generated: expressionTree(column.generatedExpression),
				stored: Boolean(column.generatedExpression) });
		}
		for (const index of table.indexes) expected.indexes.push({ table: table.name, name: index.primary ? "PRIMARY" : index.name,
			unique: index.unique, columns: index.columns.map(column => ({ name: column.name, descending: Boolean(column.descending), prefix: column.prefixLength ?? null })) });
		for (const foreignKey of table.foreignKeys) expected.foreignKeys.push({ table: table.name, name: foreignKey.name,
			columns: foreignKey.columns, referencedSchema: database, referencedTable: foreignKey.referencedTable,
			referencedColumns: foreignKey.referencedColumns, onDelete: ruleName(foreignKey.onDelete), onUpdate: ruleName(foreignKey.onUpdate) });
		for (const check of table.checks) {
			metadataContext(report, "check_expression", table.name);
			expected.checks.push({ table: table.name, name: check.name, enforced: true, expression: expressionTree(check.expression) });
		}
	}
	metadataContext(report);
	const created = new Set(), addedForeignKeys = new Set();
	let foreignKeyStarted = false, foreignKeyCount = 0;
	requireCondition(Array.isArray(schema.statements) && schema.statements.length === 71, "SCHEMA_CONTRACT_INVALID");
	for (const statement of schema.statements) {
		const table = tables.get(statement.table);
		requireCondition(table && singleStatement(statement.sql), "SCHEMA_STATEMENT_REFUSED");
		if (statement.kind === "table") {
			requireCondition(!foreignKeyStarted && !created.has(table.name) && statement.sql === table.createSql &&
				statement.sql.trimStart().startsWith(`CREATE TABLE \`${table.name}\` (`), "SCHEMA_STATEMENT_REFUSED");
			created.add(table.name);
		} else {
			foreignKeyStarted = true;
			const keyIdentity = `${table.name}:${statement.name}`;
			requireCondition(statement.kind === "foreign_key" && created.size === 38 && IDENTIFIER.test(statement.name || "") &&
				!addedForeignKeys.has(keyIdentity) &&
				table.foreignKeys.some(key => key.name === statement.name) && table.foreignKeySql.includes(statement.sql) &&
				statement.sql.trimStart().startsWith(`ALTER TABLE \`${table.name}\` ADD CONSTRAINT \`${statement.name}\` FOREIGN KEY (`), "SCHEMA_STATEMENT_REFUSED");
			foreignKeyCount++;
			addedForeignKeys.add(keyIdentity);
		}
	}
	requireCondition(created.size === 38 && foreignKeyCount === 33, "SCHEMA_CONTRACT_INVALID");
	return canonical(expected);
}

function canonical(metadata) {
	return Object.fromEntries(Object.entries(metadata).map(([kind, items]) => [kind, sorted(items,
		item => kind === "columns" ? `${item.table}:${String(item.ordinal).padStart(5, "0")}` : `${item.table}:${item.name || ""}`)]));
}

async function rows(connection, report, sql, values = []) {
	const [result] = await connection.query(sql, values);
	requireCondition(Array.isArray(result), "SCHEMA_METADATA_RESULT_INVALID");
	return result.map(row => {
		requireCondition(row && typeof row === "object" && !Array.isArray(row), "SCHEMA_METADATA_RESULT_INVALID");
		return Object.fromEntries(Object.entries(row).map(([field, value]) => {
			if (!Buffer.isBuffer(value)) return [field, value];
			requireCondition(METADATA_FIELDS.has(field), "SCHEMA_METADATA_FIELD_UNSUPPORTED");
			report.metadataBufferValues++;
			try { return [field, metadataDecoder.decode(value)]; }
			catch { throw new SchemaFailure("SCHEMA_METADATA_UTF8_INVALID"); }
		}));
	});
}

function groupRows(values, build, append) {
	const groups = new Map();
	for (const row of values) {
		const key = `${row.tableName}:${row.name}`;
		if (!groups.has(key)) groups.set(key, build(row));
		append(groups.get(key), row);
	}
	return [...groups.values()];
}

async function verifyMetadata(connection, expected, report, database) {
	const actual = {};
	report.operation = "verify_tables";
	metadataContext(report, "tables");
	actual.tables = (await rows(connection, report, "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine, ROW_FORMAT AS rowFormat, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database])).map(row => {
		metadataContext(report, "tables", row.tableName);
		requireCondition(row.tableType === "BASE TABLE", "SCHEMA_TABLE_MISMATCH");
		return { table: row.tableName, engine: String(row.engine).toLowerCase(), rowFormat: String(row.rowFormat).toLowerCase(), collation: row.collation };
	});
	report.operation = "verify_columns";
	metadataContext(report, "columns");
	actual.columns = (await rows(connection, report, "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_DEFAULT AS columnDefault, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION", [database])).map(row => {
		metadataContext(report, "column_default", row.tableName, row.name);
		const default_ = metadataDefault(row, report);
		metadataContext(report, "generation_expression", row.tableName, row.name);
		const generated = metadataExpression(row.generationExpression, report);
		return {
		table: row.tableName, name: row.name, ordinal: Number(row.ordinal), type: typeName(row.columnType), nullable: row.isNullable === "YES",
		charset: row.charset, collation: row.collation, default: default_, autoIncrement: /\bauto_increment\b/i.test(row.extra || ""),
		generated, stored: /\bstored generated\b/i.test(row.extra || ""),
		};
	});
	report.operation = "verify_indexes";
	metadataContext(report, "indexes");
	actual.indexes = groupRows(await rows(connection, report, "SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, COLLATION AS direction, SUB_PART AS prefixLength, SEQ_IN_INDEX AS ordinal FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX", [database]),
		row => ({ table: row.tableName, name: row.name, unique: Number(row.nonUnique) === 0, columns: [] }),
		(index, row) => index.columns.push({ name: row.columnName, descending: row.direction === "D", prefix: row.prefixLength === null ? null : Number(row.prefixLength) }));
	report.operation = "verify_foreign_keys";
	metadataContext(report, "foreign_keys");
	actual.foreignKeys = groupRows(await rows(connection, report, "SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedSchema, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.DELETE_RULE AS onDelete, r.UPDATE_RULE AS onUpdate, k.ORDINAL_POSITION AS ordinal FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION", [database]),
		row => ({ table: row.tableName, name: row.name, columns: [], referencedSchema: row.referencedSchema, referencedTable: row.referencedTable, referencedColumns: [], onDelete: ruleName(row.onDelete), onUpdate: ruleName(row.onUpdate) }),
		(key, row) => { key.columns.push(row.columnName); key.referencedColumns.push(row.referencedColumn); });
	report.operation = "verify_checks";
	metadataContext(report, "checks");
	actual.checks = (await rows(connection, report, "SELECT t.TABLE_NAME AS tableName,t.CONSTRAINT_NAME AS name,t.ENFORCED AS enforced,c.CHECK_CLAUSE AS expression FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=? AND t.CONSTRAINT_TYPE='CHECK' ORDER BY t.TABLE_NAME,t.CONSTRAINT_NAME", [database])).map(row => {
		metadataContext(report, "check_expression", row.tableName);
		return { table: row.tableName, name: row.name, enforced: row.enforced === "YES", expression: metadataExpression(row.expression, report) };
	});
	const normalized = canonical(actual);
	for (const kind of Object.keys(expected)) {
		report.operation = "verify_" + (({ foreignKeys: "foreign_keys" })[kind] || kind);
		metadataContext(report, kind === "foreignKeys" ? "foreign_keys" : kind);
		if (!same(expected[kind], normalized[kind])) {
			const index = expected[kind].findIndex((item, index) => !same(item, normalized[kind][index]));
			const item = index < 0 ? normalized[kind][expected[kind].length] : expected[kind][index];
			metadataContext(report, kind === "foreignKeys" ? "foreign_keys" : kind, item?.table, kind === "columns" ? item?.name : undefined);
			throw new SchemaFailure("SCHEMA_METADATA_MISMATCH");
		}
	}
	metadataContext(report);
	report.metadata = Object.fromEntries(Object.entries(normalized).map(([kind, values]) => [kind, values.length]));
	report.fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function applyMysqlSchema(connection, schema, { expectedDatabase = DATABASE, write = console.log } = {}) {
	// Per-call target only: the existing entry points keep the test default.
	const database = ["outdoor_fit_test", "outdoor_fit_prod"].includes(expectedDatabase) ? expectedDatabase : null;
	const lockName = "outdoor-fit:mysql-schema:" + database;
	const report = { status: "failed", database, partial: false, operation: "schema_validate", operationIndex: 0,
		createdTables: 0, completedStatements: 0, lockAcquired: false, lockReleased: false, metadata: null, fingerprint: null, metadataBufferValues: 0, metadataDecodedExpressions: 0 };
	let failure = null;
	try {
		requireCondition(database !== null, "SCHEMA_DATABASE_REFUSED");
		requireCondition(connection && typeof connection.query === "function" && typeof write === "function", "SCHEMA_ARGUMENT_INVALID");
		const expected = expectedMetadata(schema, report, database);
		report.sourceSchemaHash = schema.sourceSchemaHash;
		report.operation = "preflight";
		const [state] = await rows(connection, report, "SELECT DATABASE() AS currentDatabase, VERSION() AS mysqlVersion, @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks, @@SESSION.unique_checks AS uniqueChecks, @@GLOBAL.innodb_page_size AS pageSize");
		requireCondition(state?.currentDatabase === database, "SCHEMA_DATABASE_REFUSED");
		requireCondition(/^8\.0\.\d+[-+._a-zA-Z0-9]*$/.test(state.mysqlVersion || ""), "SCHEMA_MYSQL_VERSION_REFUSED");
		requireCondition(String(state.sqlMode).split(",").some(mode => ["STRICT_TRANS_TABLES", "STRICT_ALL_TABLES"].includes(mode.trim().toUpperCase())), "SCHEMA_STRICT_MODE_REQUIRED");
		requireCondition(Number(state.foreignKeyChecks) === 1 && Number(state.uniqueChecks) === 1, "SCHEMA_CONSTRAINT_CHECKS_REQUIRED");
		requireCondition(Number(state.pageSize) === 16384, "SCHEMA_PAGE_SIZE_REFUSED");
		report.operation = "lock_acquire";
		const [lock] = await rows(connection, report, "SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
		requireCondition(Number(lock?.acquired) === 1, "SCHEMA_LOCK_UNAVAILABLE");
		report.lockAcquired = true;
		report.operation = "empty_check";
		const [count] = await rows(connection, report, "SELECT COUNT(*) AS objectCount FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
		requireCondition(Number(count?.objectCount) === 0, "SCHEMA_DATABASE_NOT_EMPTY");
		for (const [index, statement] of schema.statements.entries()) {
			report.operation = statement.kind === "table" ? "table_ddl" : "foreign_key_ddl";
			report.operationIndex = index + 1;
			report.partial = true;
			await connection.query(statement.sql);
			report.completedStatements++;
			if (statement.kind === "table") report.createdTables++;
		}
		await verifyMetadata(connection, expected, report, database);
		report.status = "applied";
		report.partial = false;
		report.operation = "complete";
	} catch (error) {
		failure = safeCode(error);
	} finally {
		if (report.lockAcquired) {
			try {
				const [released] = await rows(connection, report, "SELECT RELEASE_LOCK(?) AS released", [lockName]);
				requireCondition(Number(released?.released) === 1, "SCHEMA_LOCK_RELEASE_FAILED");
				report.lockReleased = true;
			} catch (error) {
				report.lockReleaseErrorCode = safeCode(error);
				if (!failure) { failure = "SCHEMA_LOCK_RELEASE_FAILED"; report.operation = "lock_release"; }
			}
		}
	}
	if (failure) {
		report.status = "failed";
		report.partial ||= report.completedStatements > 0;
		report.errorCode = failure;
	}
	if (typeof write === "function") {
		write("SCHEMA_OPERATION " + report.operation + " " + report.operationIndex);
		write("SCHEMA_METADATA_BUFFER_VALUES " + report.metadataBufferValues);
		write("SCHEMA_METADATA_DECODED_EXPRESSIONS " + report.metadataDecodedExpressions);
		if (report.metadataKind) write("SCHEMA_METADATA_KIND " + report.metadataKind);
		if (report.table) write("SCHEMA_TABLE " + report.table);
		if (report.column) write("SCHEMA_COLUMN " + report.column);
		if (report.expressionValueType) {
			write("SCHEMA_EXPRESSION_TYPE " + report.expressionValueType);
			write("SCHEMA_EXPRESSION_LENGTH " + report.expressionLength);
			write("SCHEMA_EXPRESSION_BACKSLASH_QUOTE_COUNT " + report.expressionBackslashQuoteCount);
		}
		write("SCHEMA_CREATED_TABLES " + report.createdTables);
		write("SCHEMA_COMPLETED_STATEMENTS " + report.completedStatements);
		write("SCHEMA_PARTIAL " + (report.partial ? "YES" : "NO"));
		write("SCHEMA_LOCK_RELEASED " + (report.lockReleased ? "YES" : "NO"));
		if (failure) write("SCHEMA_ERROR " + failure);
		else write("SCHEMA_FINGERPRINT " + report.fingerprint);
	}
	if (failure) {
		const error = new SchemaFailure(failure);
		error.name = "MysqlSchemaApplyError";
		error.report = report;
		throw error;
	}
	return report;
}

// Inspect an already created explicitly selected schema. Every issued statement is a
// SELECT against server state or information_schema; business tables are never read.
export async function verifyMysqlSchema(connection, schema, { expectedDatabase = DATABASE, write = console.log } = {}) {
	// Per-call target only: the existing entry points keep the test default.
	const database = ["outdoor_fit_test", "outdoor_fit_prod"].includes(expectedDatabase) ? expectedDatabase : null;
	const lockName = "outdoor-fit:mysql-schema:" + database;
	const report = { status: "failed", database, readOnly: true, partial: false,
		operation: "schema_validate", operationIndex: 0, createdTables: 0, completedStatements: 0,
		lockAcquired: false, lockReleased: false, metadata: null, fingerprint: null, metadataBufferValues: 0, metadataDecodedExpressions: 0 };
	let failure = null;
	try {
		requireCondition(database !== null, "SCHEMA_DATABASE_REFUSED");
		requireCondition(connection && typeof connection.query === "function" && typeof write === "function", "SCHEMA_ARGUMENT_INVALID");
		const expected = expectedMetadata(schema, report, database);
		report.sourceSchemaHash = schema.sourceSchemaHash;
		report.operation = "preflight";
		const [state] = await rows(connection, report, "SELECT DATABASE() AS currentDatabase, VERSION() AS mysqlVersion, @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks, @@SESSION.unique_checks AS uniqueChecks, @@GLOBAL.innodb_page_size AS pageSize");
		requireCondition(state?.currentDatabase === database, "SCHEMA_DATABASE_REFUSED");
		requireCondition(/^8\.0\.\d+[-+._a-zA-Z0-9]*$/.test(state.mysqlVersion || ""), "SCHEMA_MYSQL_VERSION_REFUSED");
		requireCondition(String(state.sqlMode).split(",").some(mode => ["STRICT_TRANS_TABLES", "STRICT_ALL_TABLES"].includes(mode.trim().toUpperCase())), "SCHEMA_STRICT_MODE_REQUIRED");
		requireCondition(Number(state.foreignKeyChecks) === 1 && Number(state.uniqueChecks) === 1, "SCHEMA_CONSTRAINT_CHECKS_REQUIRED");
		requireCondition(Number(state.pageSize) === 16384, "SCHEMA_PAGE_SIZE_REFUSED");
		report.operation = "lock_acquire";
		const [lock] = await rows(connection, report, "SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
		requireCondition(Number(lock?.acquired) === 1, "SCHEMA_LOCK_UNAVAILABLE");
		report.lockAcquired = true;
		await verifyMetadata(connection, expected, report, database);
		report.status = "verified";
		report.operation = "complete";
	} catch (error) {
		failure = safeCode(error);
	} finally {
		if (report.lockAcquired) {
			try {
				const [released] = await rows(connection, report, "SELECT RELEASE_LOCK(?) AS released", [lockName]);
				requireCondition(Number(released?.released) === 1, "SCHEMA_LOCK_RELEASE_FAILED");
				report.lockReleased = true;
			} catch (error) {
				report.lockReleaseErrorCode = safeCode(error);
				if (!failure) { failure = "SCHEMA_LOCK_RELEASE_FAILED"; report.operation = "lock_release"; }
			}
		}
	}
	if (failure) { report.status = "failed"; report.errorCode = failure; }
	if (typeof write === "function") {
		write("SCHEMA_OPERATION " + report.operation + " " + report.operationIndex);
		write("SCHEMA_METADATA_BUFFER_VALUES " + report.metadataBufferValues);
		write("SCHEMA_METADATA_DECODED_EXPRESSIONS " + report.metadataDecodedExpressions);
		if (report.metadataKind) write("SCHEMA_METADATA_KIND " + report.metadataKind);
		if (report.table) write("SCHEMA_TABLE " + report.table);
		if (report.column) write("SCHEMA_COLUMN " + report.column);
		if (report.expressionValueType) {
			write("SCHEMA_EXPRESSION_TYPE " + report.expressionValueType);
			write("SCHEMA_EXPRESSION_LENGTH " + report.expressionLength);
			write("SCHEMA_EXPRESSION_BACKSLASH_QUOTE_COUNT " + report.expressionBackslashQuoteCount);
		}
		write("SCHEMA_READ_ONLY YES");
		write("SCHEMA_LOCK_RELEASED " + (report.lockReleased ? "YES" : "NO"));
		if (failure) write("SCHEMA_ERROR " + failure);
		else write("SCHEMA_FINGERPRINT " + report.fingerprint);
	}
	if (failure) {
		const error = new SchemaFailure(failure);
		error.name = "MysqlSchemaVerifyError";
		error.report = report;
		throw error;
	}
	return report;
}
