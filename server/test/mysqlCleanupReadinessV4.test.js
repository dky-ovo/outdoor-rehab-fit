import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMysqlDatabase } from "../src/mysqlDatabase.js";
import { auditEquipmentImageRetirement } from "../src/mysqlEquipmentImageRetirement.js";

// Execute the actual stdin probe with a synthetic TLS/driver boundary. The real
// adapter and retirement audit run; this does not emulate InnoDB range locking.
const probePath = new URL("../../deploy/aliyun-equipment-image-cleanup-v4/check-cleanup-readiness.mjs", import.meta.url);
const original = fs.readFileSync(probePath, "utf8");
const moduleImport = 'const moduleAt = name => import(pathToFileURL(path.join(process.cwd(), "src", name)).href);';
assert.equal(original.split(moduleImport).length, 2);
const source = original.replace(/^import .+;\r?\n/gm, "")
  .replace(moduleImport, "const moduleAt = async name => modules[name];");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("fs", "path", "pathToFileURL", "checkServerIdentity", "mysql", "process", "console", "modules", source);

async function fixture(options = {}) {
  const output = [], calls = [];
  let globalLevel = options.defaultLevel || "READ-COMMITTED", sessionLevel = globalLevel;
  let connectionId = 101, destroyed = false, readonly = false, commits = 0, leases = 0;
  const failure = code => Object.assign(new Error("PRIVATE_DRIVER_SQL_AND_SECRET"), { code });
  const state = () => ({ db: "outdoor_fit_prod", account: "outdoor_fit_app@%", version: "8.0.36",
    connectionId, sessionLevel, globalLevel });
  const connection = {
    connection: { stream: { encrypted: true, authorized: !options.unauthorized,
      getPeerCertificate: () => ({ subjectaltname: "DNS:synthetic.rds.test" }) } },
    async query(sql) {
      calls.push(["query", sql]);
      if (sql === "SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin" || sql === "SET SESSION time_zone = '+00:00'") return [{}, []];
      if (sql === "SELECT @@SESSION.transaction_isolation AS isolationLevel") return [[{ isolationLevel: sessionLevel }], []];
      const setting = sql.match(/^SET SESSION TRANSACTION ISOLATION LEVEL (READ UNCOMMITTED|READ COMMITTED|REPEATABLE READ|SERIALIZABLE)$/);
      if (setting) {
        assert.equal(readonly, false, "SESSION isolation cannot be changed inside the active transaction");
        if (options.restoreFails && commits) throw failure("ECONNRESET");
        if (!options.ignoreSetup) sessionLevel = setting[1].replaceAll(" ", "-");
        return [{}, []];
      }
      if (sql === "START TRANSACTION READ ONLY") {
        assert.equal(sessionLevel, "REPEATABLE-READ"); readonly = true;
        if (options.changeGlobal) globalLevel = "SERIALIZABLE";
        return [{}, []];
      }
      assert.fail("Unexpected probe query: " + sql);
    },
    async execute(sql, values) {
      calls.push(["execute", sql]);
      assert.match(sql, /^SELECT /); assert.deepEqual(values, []);
      if (sql.includes("CONNECTION_ID()")) return [[state()], []];
      if (sql === "SELECT @@transaction_isolation AS level") return [[{ level: sessionLevel }], []];
      if (sql.startsWith("SELECT SUM(")) {
        assert.equal(readonly, true, "audit must run inside server READ ONLY transaction");
        return [[{ pendingCount: options.badCount ? -1 : 0, completedCount: 2 }], []];
      }
      assert.fail("Unexpected probe SELECT: " + sql);
    },
    async beginTransaction() { assert.fail("Probe must request READ ONLY explicitly"); },
    async commit() { calls.push(["commit"]); assert.equal(readonly, true); readonly = false; commits++; },
    async rollback() { calls.push(["rollback"]); readonly = false; },
    release() { calls.push(["release"]); assert.equal(readonly, false); },
    destroy() { calls.push(["destroy"]); destroyed = true; readonly = false; },
  };
  const pool = {
    async getConnection() {
      calls.push(["getConnection"]); leases++;
      if (options.connectError) throw failure("ECONNREFUSED");
      if (destroyed || (options.changeConnection && leases === 3)) {
        connectionId++; sessionLevel = options.defaultLevel || "READ-COMMITTED"; destroyed = false;
      }
      return connection;
    },
    async end() { calls.push(["end"]); if (options.closeError) throw failure("ECONNRESET"); },
  };
  const config = { database: options.badAccount ? "wrong_db" : "outdoor_fit_prod", user: "outdoor_fit_app",
    host: "synthetic.rds.test", ssl: { ca: "SYNTHETIC_CA", rejectUnauthorized: true, verifyIdentity: true } };
  const syntheticProcess = { cwd: () => path.dirname(fileURLToPath(probePath)), exitCode: 0,
    env: { MYSQL_PASSWORD_FILE: path.resolve("synthetic-secret") } };
  await run({ lstatSync: () => ({ isFile: () => true }), readFileSync: () => "PRIVATE_PASSWORD" }, path, pathToFileURL,
    (host, certificate) => { assert.equal(host, "synthetic.rds.test"); assert.match(certificate.subjectaltname, /synthetic/); },
    { createPool(actual) { assert.equal(actual.connectionLimit, 1); calls.push(["createPool"]); return pool; } },
    syntheticProcess, { log: text => output.push(text) }, {
      "mysqlConfig.js": { readMysqlConfig: () => config },
      "mysqlDatabase.js": { createMysqlDatabase },
      "mysqlEquipmentImageRetirement.js": { auditEquipmentImageRetirement: options.attemptWrite
        ? db => db.get("UPDATE users SET name='PRIVATE_VALUE'") : auditEquipmentImageRetirement },
    });
  assert.doesNotMatch(output.join("\n"), /PRIVATE_|SYNTHETIC_CA|synthetic\.rds/);
  assert.ok(!calls.some(([, sql]) => typeof sql === "string" && /^(?:INSERT|UPDATE|DELETE|ALTER|DROP|SET GLOBAL)/.test(sql)));
  return { output, calls, status: syntheticProcess.exitCode, sessionLevel, globalLevel };
}

for (const defaultLevel of ["READ-COMMITTED", "REPEATABLE-READ", "SERIALIZABLE"]) {
  test(`real adapter probe enters RR read-only and restores same connection from ${defaultLevel}`, async () => {
    const result = await fixture({ defaultLevel });
    assert.equal(result.status, 0); assert.equal(result.sessionLevel, defaultLevel); assert.equal(result.globalLevel, defaultLevel);
    assert.ok(result.output.includes("CLEANUP_READ_ONLY_CHECK=PASS"));
    assert.ok(result.output.includes("TRANSACTION_ISOLATION=REPEATABLE-READ"));
    assert.ok(result.output.includes("SESSION_RESTORED=PASS"));
    assert.ok(result.output.includes("GLOBAL_UNCHANGED=PASS"));
    assert.equal(result.calls.filter(([op]) => op === "commit").length, 1);
    assert.equal(result.calls.at(-1)[0], "end");
  });
}

for (const [options, code] of [
  [{ ignoreSetup: true }, "MYSQL_ISOLATION_SETUP_FAILED"],
  [{ restoreFails: true }, "CLEANUP_CHECK_CONNECTION_REUSE_FAILED"],
  [{ changeConnection: true }, "CLEANUP_CHECK_CONNECTION_REUSE_FAILED"],
  [{ changeGlobal: true }, "CLEANUP_CHECK_TRANSACTION_ISOLATION_FAILED"],
  [{ unauthorized: true }, "CLEANUP_CHECK_TLS_NOT_VERIFIED"],
  [{ connectError: true }, "ECONNREFUSED"],
  [{ closeError: true }, "CLEANUP_CHECK_CONNECTION_CLOSE_FAILED"],
  [{ badAccount: true }, "CLEANUP_CHECK_PRODUCTION_ACCOUNT_REQUIRED"],
  [{ badCount: true }, "CLEANUP_CHECK_FAILED"],
  [{ attemptWrite: true }, "CLEANUP_CHECK_SELECT_ONLY"],
]) test(`probe rejects ${Object.keys(options)[0]} with sanitized nonzero result`, async () => {
  const result = await fixture(options);
  assert.equal(result.status, 1);
  assert.deepEqual(result.output, ["CLEANUP_READ_ONLY_CHECK=FAIL", "ERROR_CODE=" + code]);
  if (!options.badAccount) assert.equal(result.calls.at(-1)[0], "end");
});
