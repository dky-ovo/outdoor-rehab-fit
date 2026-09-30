import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readMysqlConfig } from "../src/mysqlConfig.js";

const workspace = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function fixture(t) {
	const directory = fs.mkdtempSync(path.join(workspace, ".mysql-config-test-"));
	t.after(() => {
		assert.equal(path.dirname(directory), workspace);
		assert.ok(path.basename(directory).startsWith(".mysql-config-test-"));
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const certificatePath = path.join(directory, "ca.pem");
	fs.writeFileSync(certificatePath, rootCertificates[0], { mode: 0o600 });
	return { directory, certificatePath, env: {
		MYSQL_HOST: "test.mysql.rds.aliyuncs.com",
		MYSQL_USER: "migration_user",
		MYSQL_PASSWORD: "  password with spaces  ",
		MYSQL_DATABASE: "outdoor_fit_test",
		MYSQL_SSL_CA: certificatePath,
	} };
}

test("reads the CA and returns bounded pool options with mandatory TLS identity verification", t => {
	const { env } = fixture(t);
	assert.deepEqual(readMysqlConfig(env), {
		host: env.MYSQL_HOST, port: 3306, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD,
		database: env.MYSQL_DATABASE,
		ssl: { ca: rootCertificates[0], rejectUnauthorized: true, verifyIdentity: true, minVersion: "TLSv1.2" },
		multipleStatements: false, charset: "utf8mb4_bin", timezone: "Z",
		dateStrings: true, supportBigNumbers: true, bigNumberStrings: false, jsonStrings: true,
		waitForConnections: true, connectionLimit: 4, queueLimit: 32, connectTimeout: 10000, enableKeepAlive: true,
	});
	const custom = readMysqlConfig({ ...env, MYSQL_PORT: "3307", MYSQL_POOL_SIZE: "16" });
	assert.equal(custom.port, 3307);
	assert.equal(custom.connectionLimit, 16);
	assert.equal(readMysqlConfig({ ...env, MYSQL_PASSWORD: "   " }).password, "   ");
});

test("does not accept TLS or statement-safety overrides from environment variables", t => {
	const { env } = fixture(t);
	const config = readMysqlConfig({ ...env, MYSQL_SSL_MODE: "DISABLED", MYSQL_SSL_REJECT_UNAUTHORIZED: "false",
		MYSQL_SSL_VERIFY_IDENTITY: "false", MYSQL_SSL_MIN_VERSION: "TLSv1", MYSQL_MULTIPLE_STATEMENTS: "true" });
	assert.equal(config.ssl.rejectUnauthorized, true);
	assert.equal(config.ssl.verifyIdentity, true);
	assert.equal(config.ssl.minVersion, "TLSv1.2");
	assert.equal(config.multipleStatements, false);
});

test("requires host, user, password, database, and CA without including supplied values in errors", t => {
	const { env } = fixture(t);
	for (const name of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE", "MYSQL_SSL_CA"]) {
		for (const value of [undefined, "", null, 123]) {
			assert.throws(() => readMysqlConfig({ ...env, [name]: value }), error => {
				assert.match(error.message, new RegExp(name));
				assert.ok(!error.message.includes(env.MYSQL_PASSWORD));
				assert.ok(!error.message.includes(env.MYSQL_USER));
				return true;
			});
		}
	}
});

test("rejects IP addresses, protocols, ports, whitespace and malformed DNS names", t => {
	const { env } = fixture(t);
	for (const host of ["localhost", "127.0.0.1", "127.000.0.1", "::1", "[::1]", "https://db.example.com",
		"mysql://private-secret@db.example.com", "db.example.com:3306", "db.example.com ", " db.example.com",
		"db\n.example.com", "db_.example.com", "-db.example.com", "db-.example.com", "db..example.com",
		"db.example.com.", "a".repeat(64) + ".example.com", "a.".repeat(126) + "com"]) {
		assert.throws(() => readMysqlConfig({ ...env, MYSQL_HOST: host }), error => {
			assert.match(error.message, /MYSQL_HOST/);
			assert.ok(!error.message.includes(host));
			assert.ok(!error.message.includes("private-secret"));
			return true;
		});
	}
});

test("bounds decimal integer settings and validates a conservative database identifier", t => {
	const { env } = fixture(t);
	for (const name of ["MYSQL_PORT", "MYSQL_POOL_SIZE"]) {
		for (const value of ["", "0", "-1", "1.5", "1e1", "0x10", " 4", "4 ", "NaN", null, 4,
			name === "MYSQL_PORT" ? "65536" : "17"]) {
			assert.throws(() => readMysqlConfig({ ...env, [name]: value }), new RegExp(name));
		}
	}
	for (const database of ["outdoor-fit", "db.name", "1database", "db name", "db;private-secret", "x".repeat(65)]) {
		assert.throws(() => readMysqlConfig({ ...env, MYSQL_DATABASE: database }), error => {
			assert.match(error.message, /MYSQL_DATABASE/);
			assert.ok(!error.message.includes(database));
			return true;
		});
	}
});

test("rejects directories, absent files, empty files and invalid PEM without leaking their contents or paths", t => {
	const { env, directory, certificatePath } = fixture(t);
	const assertRejected = caPath => assert.throws(() => readMysqlConfig({ ...env, MYSQL_SSL_CA: caPath }), error => {
		assert.equal(error.message, "MYSQL_SSL_CA must name a readable, valid PEM CA certificate file");
		assert.ok(!error.message.includes(caPath));
		assert.ok(!error.message.includes("private-secret"));
		assert.ok(!error.message.includes(env.MYSQL_PASSWORD));
		return true;
	});
	assertRejected(directory);
	assertRejected(path.join(directory, "private-secret-missing.pem"));
	for (const contents of ["", " \n", "private-secret", "-----BEGIN CERTIFICATE-----\nprivate-secret\n-----END CERTIFICATE-----",
		rootCertificates[0] + "\n-----BEGIN CERTIFICATE-----\nbroken\n-----END CERTIFICATE-----",
		rootCertificates[0] + "\n-----BEGIN CERTIFICATE-----\ntruncated"]) {
		fs.writeFileSync(certificatePath, contents);
		assertRejected(certificatePath);
	}
});

test("accepts a complete PEM certificate chain", t => {
	const { env, certificatePath } = fixture(t);
	const chain = rootCertificates[0] + "\n" + rootCertificates[1] + "\n";
	fs.writeFileSync(certificatePath, chain);
	assert.equal(readMysqlConfig(env).ssl.ca, chain);
});

test("the locked driver's SSL and authentication handshake packets accept our charset", t => {
	const { env } = fixture(t);
	const require = createRequire(import.meta.url);
	const driverRoot = path.dirname(require.resolve("mysql2/package.json"));
	const ConnectionConfig = require(path.join(driverRoot, "lib/connection_config.js"));
	const SSLRequest = require(path.join(driverRoot, "lib/packets/ssl_request.js"));
	const HandshakeResponse = require(path.join(driverRoot, "lib/packets/handshake_response.js"));
	const config = new ConnectionConfig(readMysqlConfig(env));
	assert.equal(config.charsetNumber, 46);
	assert.equal(new SSLRequest(config.clientFlags, config.charsetNumber).toPacket().buffer[12], 46);
	const response = new HandshakeResponse({
		user: "synthetic", database: "synthetic", charsetNumber: config.charsetNumber,
		flags: config.clientFlags, authToken: Buffer.alloc(0), authPluginName: "mysql_native_password",
	});
	assert.equal(response.toPacket().buffer[12], 46);
	// This was the v1 failure: it occurs before TLS or credentials are sent.
	assert.throws(() => new SSLRequest(config.clientFlags, 309).toPacket(), { code: "ERR_OUT_OF_RANGE" });
});
