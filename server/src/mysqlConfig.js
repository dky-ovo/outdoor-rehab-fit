import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { createSecureContext } from "node:tls";

function requiredText(env, name, { password = false } = {}) {
	const value = env[name];
	if (typeof value !== "string" || (password ? value.length === 0 : value.trim().length === 0)) {
		throw new Error(`${name} is required`);
	}
	return value;
}

function integerSetting(env, name, fallback, maximum) {
	if (env[name] === undefined) return fallback;
	const value = env[name];
	if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
		throw new Error(`${name} must be an integer between 1 and ${maximum}`);
	}
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
		throw new Error(`${name} must be an integer between 1 and ${maximum}`);
	}
	return number;
}

function readCertificate(certificatePath) {
	try {
		if (!fs.statSync(certificatePath).isFile()) throw new Error();
		const ca = fs.readFileSync(certificatePath, "utf8");
		const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
		if (!certificates?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
			throw new Error();
		}
		// Some TLS versions silently ignore an unparseable CA entry. Validate
		// every PEM block too, so an empty trust store cannot pass this check.
		for (const certificate of certificates) new X509Certificate(certificate);
		createSecureContext({ ca, minVersion: "TLSv1.2" });
		return ca;
	} catch {
		// Filesystem and OpenSSL errors can contain supplied paths or contents.
		throw new Error("MYSQL_SSL_CA must name a readable, valid PEM CA certificate file");
	}
}

export function readMysqlConfig(env = process.env) {
	const host = requiredText(env, "MYSQL_HOST");
	const labels = host.split(".");
	if (host.length > 253 || isIP(host) || labels.length < 2 ||
		labels.some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)) ||
		!/[a-zA-Z]/.test(labels.at(-1))) {
		throw new Error("MYSQL_HOST must be a DNS hostname without a scheme, port, whitespace, or IP address");
	}
	const port = integerSetting(env, "MYSQL_PORT", 3306, 65535);
	const user = requiredText(env, "MYSQL_USER");
	const password = requiredText(env, "MYSQL_PASSWORD", { password: true });
	const database = requiredText(env, "MYSQL_DATABASE");
	if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(database)) {
		throw new Error("MYSQL_DATABASE must be a simple identifier of at most 64 characters");
	}
	const certificatePath = requiredText(env, "MYSQL_SSL_CA");
	const connectionLimit = integerSetting(env, "MYSQL_POOL_SIZE", 4, 16);
	const ca = readCertificate(certificatePath);
	return {
		host, port, user, password, database,
		ssl: { ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: "TLSv1.2" },
		multipleStatements: false,
		// The protocol handshake charset field is one byte. 0900_bin has ID
		// 309 and mysql2 cannot encode it there. Set the final session collation
		// after connecting; utf8mb4_bin (46) uses the same UTF-8 wire encoding.
		charset: "utf8mb4_bin",
		timezone: "Z",
		dateStrings: true,
		supportBigNumbers: true,
		bigNumberStrings: false,
		jsonStrings: true,
		waitForConnections: true,
		connectionLimit,
		queueLimit: 32,
		connectTimeout: 10000,
		enableKeepAlive: true,
	};
}
