import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const mysqlRoot = path.dirname(require.resolve("mysql2/package.json"));
const mysqlInternal = file => require(path.join(mysqlRoot, "lib", file));
const ColumnDefinition = mysqlInternal("packets/column_definition.js");
const TextRow = mysqlInternal("packets/text_row.js");
const getTextParser = mysqlInternal("parsers/text_parser.js");
const Charsets = mysqlInternal("constants/charsets.js");
const Types = mysqlInternal("constants/types.js");

// Exercise the installed driver's actual protocol encoder, column-definition
// decoder and compiled text-row parser. No typeCast or parser implementation is
// mocked. These synthetic values are schema metadata, never business records.
const metadata = {
	columnDefault: "_utf8mb4'[]'",
	generationExpression: "unhex(sha2(cast(`url` as char charset binary),256))",
	activeGenerationExpression: "(case when (`deleted_at` is null) then `name` else NULL end)",
	emptyGenerationExpression: "",
	emptyExpressionDefault: "_utf8mb4''",
	nullDefault: null,
	unicodeDefault: "_utf8mb4'中文🙂'",
	escapedDefault: String.raw`_utf8mb4'it\'s\\path\n'`,
};

function column(name, characterSet, columnType) {
	const packet = ColumnDefinition.toPacket({
		catalog: "def", schema: "information_schema", table: "COLUMNS",
		orgTable: "COLUMNS", name, orgName: name,
		characterSet, columnType, columnLength: 65535, flags: 0, decimals: 0,
	}, 0);
	packet.reset();
	return new ColumnDefinition(packet, "utf8");
}

function decode(packet, characterSet, columnType) {
	const fields = Object.keys(metadata).map(name => column(name, characterSet, columnType));
	const options = {};
	const Parser = getTextParser(fields, options, {
		timezone: "Z", dateStrings: true, supportBigNumbers: true,
		bigNumberStrings: false, jsonStrings: true,
	});
	packet.reset();
	const result = new Parser(fields).next(packet, fields, options);
	assert.equal(packet.offset, packet.end, "the real parser consumed the complete row");
	return result;
}

test("metadata protocol regression targets the pinned mysql2 version", () => {
	assert.equal(require("mysql2/package.json").version, "3.24.4");
	assert.equal(Charsets.BINARY, 63);
});

for (const columnType of [Types.VAR_STRING, Types.BLOB, Types.LONG_BLOB]) {
	test(`mysql2 ${Types[columnType]} metadata: charset 63 returns Buffers for the same UTF-8 payload`, () => {
		const packet = TextRow.toPacket(Object.values(metadata), "utf8");
		// All three parses consume the very same row bytes. Only column metadata
		// changes; utf8mb4_bin (46) is a text collation, unlike charset binary (63).
		const binary = decode(packet, Charsets.BINARY, columnType);
		const utf8Bin = decode(packet, Charsets.UTF8MB4_BIN, columnType);
		const utf8General = decode(packet, Charsets.UTF8MB4_GENERAL_CI, columnType);
		for (const [name, value] of Object.entries(metadata)) {
			if (value === null) {
				assert.equal(binary[name], null, name);
				assert.equal(utf8Bin[name], null, name);
				assert.equal(utf8General[name], null, name);
				continue;
			}
			assert.ok(Buffer.isBuffer(binary[name]), name);
			assert.deepEqual(binary[name], Buffer.from(value, "utf8"), name);
			assert.equal(typeof utf8Bin[name], "string", name);
			assert.equal(utf8Bin[name], value, name);
			assert.equal(typeof utf8General[name], "string", name);
			assert.equal(utf8General[name], value, name);
		}
		assert.equal(binary.emptyGenerationExpression.length, 0);
		assert.equal(Boolean(binary.emptyGenerationExpression), true);
		assert.notEqual(binary.emptyGenerationExpression, "");
		assert.equal(utf8Bin.emptyGenerationExpression, "");
	});
}
