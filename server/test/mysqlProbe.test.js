import assert from "node:assert/strict";
import test from "node:test";
import { runMysqlProbe } from "../scripts/check-aliyun-mysql.js";

function fixture(options = {}) {
  const output = [], calls = [];
  const config = { host: "rds.example.test", database: "probe_test", password: "PRIVATE_PASSWORD",
    ssl: { ca: "PRIVATE_CA", rejectUnauthorized: true, verifyIdentity: true }, jsonStrings: true };
  const peer = { subjectaltname: "DNS:rds.example.test" };
  let idCalls = 0;
  const direct = {
    connection: { stream: {
      encrypted: true, authorized: !options.unauthorized,
      getProtocol: () => "TLSv1.3", getCipher: () => ({ name: "TLS_AES_256_GCM_SHA384" }),
      getPeerCertificate: () => peer,
    } },
    async query(sql) {
      calls.push(["direct.session", sql]);
      assert.ok(["SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin", "SET SESSION time_zone = '+00:00'"].includes(sql));
      if (options.sessionError) throw options.sessionError;
      return [{}, []];
    },
    async execute(sql, values) {
      calls.push(["direct.select", sql, values]);
      if (options.metadataError) throw options.metadataError;
      return [[{ version: "8.0.36", database_name: "probe_test", innodb_page_size: 16384,
        collation_connection: "utf8mb4_0900_bin", sql_mode: "STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION", table_count: 38 }], []];
    },
    async end() { calls.push(["direct.end"]); if (options.closeError) throw options.closeError; },
    destroy() { calls.push(["direct.destroy"]); },
  };
  const dependencies = {
    readConfig: () => { if (options.configError) throw options.configError; return config; },
    async connect(actual) {
      assert.equal(actual, config); calls.push(["connect"]);
      if (options.connectError) throw options.connectError;
      return direct;
    },
    verifyIdentity(host, cert) {
      assert.equal(host, config.host); assert.equal(cert, peer); calls.push(["identity"]);
      return options.identityError;
    },
    createDatabase(actual) {
      assert.equal(actual, config); calls.push(["pool.create"]);
      return {
        async transaction(callback) {
          calls.push(["transaction"]);
          await callback({ async get(sql, values = []) {
            calls.push(["pool.select", sql, values]);
            if (sql.includes("CONNECTION_ID")) return { connection_id: options.changedConnection ? ++idCalls : 91 };
            const [milliseconds, text, json] = values;
            return { milliseconds: options.stringMilliseconds ? String(milliseconds) : milliseconds,
              text_value: options.badText ? "incorrect" : text,
              json_value: options.objectJson ? JSON.parse(json) : json };
          } });
        },
        async close() { calls.push(["pool.close"]); if (options.poolCloseError) throw options.poolCloseError; },
      };
    },
    write: line => output.push(line),
  };
  return { dependencies, output, calls };
}

test("probe checks the same direct TLS connection, bound types and transaction connection without writing rows", async () => {
  const { dependencies, output, calls } = fixture();
  assert.equal(await runMysqlProbe(dependencies), 0);
  assert.ok(output.includes("CLIENT_TLS PASS"));
  assert.ok(output.includes("IDENTITY_VERIFIED PASS"));
  assert.ok(output.includes("TABLE_COUNT 38"));
  assert.equal(output.at(-1), "PROBE PASS");
  assert.ok(calls.findIndex(([type]) => type === "direct.end") < calls.findIndex(([type]) => type === "pool.create"));
  assert.ok(calls.findIndex(([type]) => type === "identity") < calls.findIndex(([type]) => type === "direct.session"));
  assert.ok(calls.findIndex(([type]) => type === "direct.session") < calls.findIndex(([type]) => type === "direct.select"));
  assert.deepEqual(calls.filter(([type]) => type === "direct.session").map(([, sql]) => sql),
    ["SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin", "SET SESSION time_zone = '+00:00'"]);
  assert.equal(calls.at(-1)[0], "pool.close");
  for (const [type, sql] of calls) if (type.endsWith(".select")) assert.match(sql, /^SELECT\b/);
  const binding = calls.find(([type, sql]) => type === "pool.select" && sql.includes("CAST"));
  assert.equal(binding[1].split("?").length - 1, 3);
  for (const value of binding[2]) assert.ok(!output.join("\n").includes(String(value)));
  assert.doesNotMatch(output.join("\n"), /PRIVATE_|rds\.example/);
});

test("TLS authorization and identity failures prevent querying metadata or creating a pool", async () => {
  for (const options of [{ unauthorized: true }, { identityError: new Error("PRIVATE_CERT") }]) {
    const { dependencies, output, calls } = fixture(options);
    assert.equal(await runMysqlProbe(dependencies), 1);
    assert.ok(calls.some(([type]) => type === "direct.end"));
    assert.ok(!calls.some(([type]) => ["direct.session", "direct.select", "pool.create"].includes(type)));
    assert.doesNotMatch(output.join("\n"), /PRIVATE/);
  }
});

test("incorrect connection affinity or bound result types fail and always close the pool", async () => {
  for (const options of [{ changedConnection: true }, { stringMilliseconds: true }, { badText: true }, { objectJson: true }]) {
    const { dependencies, output, calls } = fixture(options);
    assert.equal(await runMysqlProbe(dependencies), 1);
    assert.equal(calls.at(-1)[0], "pool.close");
    assert.ok(output.includes("PROBE FAIL"));
    assert.ok(!output.includes("PROBE PASS"));
  }
});

test("error codes use an explicit allowlist and never print messages, SQL or credentials", async () => {
  for (const code of ["PRIVATE_SECRET", "ER_ACCESS_DENIED_ERROR"]) {
    const { dependencies, output, calls } = fixture({ metadataError: Object.assign(new Error("PRIVATE_PASSWORD"), {
      code, sql: "PRIVATE_SQL", sqlMessage: "PRIVATE_TOKEN",
    }) });
    assert.equal(await runMysqlProbe(dependencies), 1);
    assert.equal(output.at(-1), `ERROR_CODE ${code === "PRIVATE_SECRET" ? "PROBE_METADATA_FAILED" : code}`);
    assert.ok(output.includes("ERROR_STAGE PROBE_METADATA_FAILED"));
    assert.equal(calls.at(-1)[0], "direct.end");
    assert.doesNotMatch(output.join("\n"), /PRIVATE/);
  }
});

test("configuration and resource closing failures return nonzero safely", async () => {
  for (const options of [{ configError: new Error("PRIVATE_PATH") }, { closeError: new Error("PRIVATE_CLOSE") },
    { poolCloseError: new Error("PRIVATE_POOL") }]) {
    const { dependencies, output, calls } = fixture(options);
    assert.equal(await runMysqlProbe(dependencies), 1);
    assert.doesNotMatch(output.join("\n"), /PRIVATE/);
    if (options.configError) assert.equal(calls.length, 0);
    if (options.closeError) {
      assert.equal(calls.at(-1)[0], "direct.destroy");
      assert.ok(!calls.some(([type]) => type === "pool.create"));
    }
    if (options.poolCloseError) assert.equal(calls.at(-1)[0], "pool.close");
    assert.ok(output.includes(`ERROR_STAGE ${options.configError ? "PROBE_CONFIG_INVALID" : "PROBE_CLOSE_FAILED"}`));
  }
});

test("connection errors expose only an allowed code and the connect stage", async () => {
  for (const code of ["ERR_OUT_OF_RANGE", "HANDSHAKE_NO_SSL_SUPPORT", "AUTH_SWITCH_PLUGIN_ERROR", "PRIVATE_UNLISTED"]) {
    const { dependencies, output, calls } = fixture({ connectError: Object.assign(new Error("PRIVATE_ARGUMENT"), { code }) });
    assert.equal(await runMysqlProbe(dependencies), 1);
    assert.deepEqual(output, ["PROBE FAIL", "ERROR_STAGE PROBE_CONNECT_FAILED",
      `ERROR_CODE ${code === "PRIVATE_UNLISTED" ? "PROBE_CONNECT_FAILED" : code}`]);
    assert.deepEqual(calls, [["connect"]]);
  }
});

test("session initialization failures are classified separately and stop before metadata", async () => {
  const { dependencies, output, calls } = fixture({
    sessionError: Object.assign(new Error("PRIVATE_SQL"), { code: "ER_UNKNOWN_COLLATION" }),
  });
  assert.equal(await runMysqlProbe(dependencies), 1);
  assert.ok(output.includes("ERROR_STAGE PROBE_SESSION_SETUP_FAILED"));
  assert.equal(output.at(-1), "ERROR_CODE ER_UNKNOWN_COLLATION");
  assert.equal(calls.at(-1)[0], "direct.end");
  assert.ok(!calls.some(([type]) => ["direct.select", "pool.create"].includes(type)));
  assert.doesNotMatch(output.join("\n"), /PRIVATE/);
});
