import assert from "node:assert/strict";
import test from "node:test";
import { createMysqlDatabase } from "../src/mysqlDatabase.js";

function fixture(overrides = {}) {
  const calls = [];
  let count = 0;
  const connections = [];
  const pool = {
    async getConnection() {
      const id = ++count;
      const connection = {
        async query(sql) { calls.push([id, "setup", sql]); if (overrides.setupError) throw overrides.setupError; },
        async execute(sql, values) {
          calls.push([id, "execute", sql, values]);
          if (overrides.executeError) throw overrides.executeError;
          if (sql === "SELECT empty") return [[], []];
          if (sql.startsWith("SELECT")) return [[{ id }], []];
          return [{ affectedRows: 2, insertId: 7, warningStatus: 0 }, []];
        },
        async beginTransaction() { calls.push([id, "begin"]); if (overrides.beginError) throw overrides.beginError; },
        async commit() { calls.push([id, "commit"]); if (overrides.commitError) throw overrides.commitError; },
        async rollback() { calls.push([id, "rollback"]); if (overrides.rollbackError) throw overrides.rollbackError; },
        release() { calls.push([id, "release"]); },
        destroy() { calls.push([id, "destroy"]); },
      };
      connections.push(connection);
      return connection;
    },
    async end() { calls.push([0, "end"]); },
  };
  const config = { ssl: { ca: "unit-test-pool-only", rejectUnauthorized: true, verifyIdentity: true } };
  const database = createMysqlDatabase(config, { poolFactory: () => pool });
  return { database, calls, connections };
}

test("bound values are passed separately; standalone queries reset UTC and release connections", async () => {
  const { database, calls } = fixture();
  const value = "text'); DROP TABLE users; --";
  assert.deepEqual(await database.get("SELECT ? AS value", [value]), { id: 1 });
  assert.deepEqual(calls, [[1, "setup", "SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin"], [1, "setup", "SET SESSION time_zone = '+00:00'"], [1, "execute", "SELECT ? AS value", [value]], [1, "release"]]);
  assert.equal(await database.get("SELECT empty"), undefined);
  assert.deepEqual(await database.run("UPDATE example SET value=?", [1]), { affectedRows: 2, insertId: 7, warningStatus: 0 });
  await assert.rejects(database.get("SELECT ?", { value }), /array of bound values/);
  await database.close();
});

test("transaction operations, including helper calls through database, share one connection", async () => {
  const { database, calls } = fixture();
  assert.equal(database.inTransaction, false);
  let saved;
  const result = await database.transaction(async (tx) => {
    assert.equal(database.inTransaction, true);
    saved = tx;
    assert.deepEqual(await tx.get("SELECT 1"), { id: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await database.get("SELECT 2"), { id: 1 });
    return "complete";
  });
  assert.equal(result, "complete");
  assert.equal(database.inTransaction, false);
  assert.deepEqual(calls.map((call) => call[1]), ["setup", "setup", "begin", "execute", "execute", "commit", "release"]);
  await assert.rejects(saved.get("SELECT after"), { code: "MYSQL_TRANSACTION_FINISHED" });
  await database.close();
});

test("concurrent transactions keep separate async contexts and connections", async () => {
  const { database, calls } = fixture();
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = database.transaction(async () => {
    await gate;
    return (await database.get("SELECT first")).id;
  });
  const second = database.transaction(async () => {
    const id = (await database.get("SELECT second")).id;
    releaseFirst();
    return id;
  });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(calls.filter((call) => call[1] === "commit").length, 2);
  await database.close();
});

test("callback failure rolls back; rollback failure destroys the connection without masking the cause", async () => {
  for (const rollbackError of [undefined, new Error("connection lost")]) {
    const { database, calls } = fixture({ rollbackError });
    const original = Object.assign(new Error("business validation failed"), { code: "BUSINESS_CONFLICT" });
    await assert.rejects(database.transaction(async (tx) => { await tx.run("UPDATE example SET value=1"); throw original; }), (error) => error === original);
    assert.deepEqual(calls.map((call) => call[1]), ["setup", "setup", "begin", "execute", "rollback", rollbackError ? "destroy" : "release"]);
    await database.close();
  }
});

test("commit failure is an unknown outcome, destroys the connection and never retries", async () => {
  const { database, calls } = fixture({ commitError: Object.assign(new Error("secret raw error"), { code: "ECONNRESET" }) });
  let invoked = 0;
  await assert.rejects(database.transaction(async (tx) => { invoked++; await tx.run("UPDATE example SET value=1"); }), (error) => {
    assert.equal(error.code, "MYSQL_COMMIT_OUTCOME_UNKNOWN");
    assert.equal(error.driverCode, "ECONNRESET");
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.equal(invoked, 1);
  assert.deepEqual(calls.map((call) => call[1]), ["setup", "setup", "begin", "execute", "commit", "destroy"]);
  await database.close();
});

test("a swallowed deadlock or lock timeout cannot continue as autocommit or report transaction success", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]) {
    const { database, calls } = fixture({ executeError: Object.assign(new Error("transaction aborted"), { code }) });
    await assert.rejects(database.transaction(async (tx) => {
      await assert.rejects(tx.run("UPDATE example SET value=1"), { code });
      assert.equal(database.inTransaction, false);
      await assert.rejects(database.run("UPDATE example SET value=2"), { code });
      return "must not succeed";
    }), { code });
    assert.deepEqual(calls.map((call) => call[1]), ["setup", "setup", "begin", "execute", "rollback", "release"]);
    await database.close();
  }
});

test("parallel transaction requests stay in the adapter queue and stop after a server rollback", async () => {
  const { database, calls } = fixture({ executeError: Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }) });
  await assert.rejects(database.transaction(async (tx) => {
    const results = await Promise.allSettled([
      tx.run("UPDATE first SET value=1"),
      tx.run("UPDATE second SET value=2"),
      database.run("UPDATE third SET value=3"),
    ]);
    assert.equal(results.every((result) => result.status === "rejected" && result.reason.code === "ER_LOCK_DEADLOCK"), true);
    return "caught all errors";
  }), { code: "ER_LOCK_DEADLOCK" });
  assert.deepEqual(calls.filter((call) => call[1] === "execute").map((call) => call[2]), ["UPDATE first SET value=1"]);
  assert.equal(calls.some((call) => call[1] === "commit"), false);
  await database.close();
});

test("driver errors omit SQL, bound values, message and cause", async () => {
  const raw = Object.assign(new Error("password=do-not-expose"), { code: "ER_DUP_ENTRY", errno: 1062, sqlState: "23000", sql: "INSERT secret", sqlMessage: "token=do-not-expose" });
  const { database, calls } = fixture({ executeError: raw });
  await assert.rejects(database.run("INSERT secret VALUES (?)", ["do-not-expose"]), (error) => {
    assert.equal(error.code, "ER_DUP_ENTRY");
    assert.equal(error.errno, 1062);
    assert.equal(error.sqlState, "23000");
    assert.equal(error.cause, undefined);
    assert.equal(error.sql, undefined);
    assert.equal(error.sqlMessage, undefined);
    assert.doesNotMatch(error.stack + JSON.stringify(error), /do-not-expose|INSERT secret/);
    return true;
  });
  assert.equal(calls.at(-1)[1], "release");
  await database.close();
});

test("connection setup and transaction start failures destroy instead of releasing a bad connection", async () => {
  for (const options of [{ setupError: new Error("setup failed") }, { beginError: new Error("begin failed") }]) {
    const { database, calls } = fixture(options);
    await assert.rejects(database.transaction(async () => assert.fail("must not run")), { name: "MysqlOperationError" });
    assert.equal(calls.at(-1)[1], "destroy");
    assert.equal(calls.some((call) => ["release", "commit", "rollback"].includes(call[1])), false);
    await database.close();
  }
});

test("nested transactions and closing inside a transaction are rejected; closing is idempotent", async () => {
  const { database, calls } = fixture();
  await database.transaction(async () => {
    await assert.rejects(database.transaction(async () => {}), { code: "MYSQL_NESTED_TRANSACTION" });
    await assert.rejects(database.close(), { code: "MYSQL_CLOSE_IN_TRANSACTION" });
  });
  await Promise.all([database.close(), database.close()]);
  assert.equal(calls.filter((call) => call[1] === "end").length, 1);
  await assert.rejects(database.get("SELECT 1"), { code: "MYSQL_CLOSED" });
});

test("TLS verification cannot be disabled at adapter creation", () => {
  for (const ssl of [{}, { ca: "ca", rejectUnauthorized: false, verifyIdentity: true }, { ca: "ca", rejectUnauthorized: true, verifyIdentity: false }]) {
    assert.throws(() => createMysqlDatabase({ ssl }, { poolFactory: () => assert.fail("must not create pool") }), /identity verification/);
  }
});

// A reusable physical connection models session state across pool checkouts.
// SQL behavior is injected; live MySQL semantics are checked by the stage probe.
function isolationFixture(failures = {}) {
  const calls = [], connections = [];
  let available;
  const pool = {
    async getConnection() {
      if (available) { const connection = available; available = undefined; calls.push([connection.id, "checkout"]); return connection; }
      const connection = {
        id: connections.length + 1, level: failures.initialLevel ?? "READ-COMMITTED", active: false, readOnly: false, sets: 0,
        async query(sql) {
          calls.push([this.id, "query", sql]);
          if (sql === "SELECT @@SESSION.transaction_isolation AS isolationLevel") {
            if (failures.readError) throw failures.readError;
            return [[{ isolationLevel: failures.bufferLevel ? Buffer.from(this.level) : this.level }], []];
          }
          if (sql.startsWith("SET SESSION TRANSACTION ISOLATION LEVEL ")) {
            assert.equal(this.active, false, "session isolation must change outside the active transaction");
            this.sets++;
            const settingUp = this.sets === 1;
            if (settingUp && failures.setError) throw failures.setError;
            if (!settingUp && failures.restoreError) throw failures.restoreError;
            if (!((settingUp && failures.setupMismatch) || (!settingUp && failures.restoreMismatch))) {
              this.level = sql.slice("SET SESSION TRANSACTION ISOLATION LEVEL ".length).replaceAll(" ", "-");
            }
          }
          if (sql === "START TRANSACTION READ ONLY") {
            if (failures.beginError) throw failures.beginError;
            this.active = true; this.readOnly = true;
          }
          return [{ warningStatus: 0 }, []];
        },
        async execute(sql) {
          calls.push([this.id, "execute", sql]);
          if (!sql.startsWith("SELECT ") && this.readOnly) throw Object.assign(new Error("synthetic read only"), { code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" });
          return sql.startsWith("SELECT ") ? [[{ id: this.id, level: this.level, readOnly: this.readOnly }], []] : [{ affectedRows: 1, warningStatus: 0 }, []];
        },
        async beginTransaction() { calls.push([this.id, "begin"]); if (failures.beginError) throw failures.beginError; this.active = true; this.readOnly = false; },
        async commit() { calls.push([this.id, "commit"]); if (failures.commitError) throw failures.commitError; this.active = false; this.readOnly = false; },
        async rollback() { calls.push([this.id, "rollback"]); if (failures.rollbackError) throw failures.rollbackError; this.active = false; this.readOnly = false; },
        release() { assert.equal(this.active, false); calls.push([this.id, "release"]); available = this; },
        destroy() { calls.push([this.id, "destroy"]); this.active = false; available = undefined; },
      };
      connections.push(connection); return connection;
    },
    async end() {},
  };
  const database = createMysqlDatabase({ ssl: { ca: "synthetic", rejectUnauthorized: true, verifyIdentity: true } }, { poolFactory: () => pool });
  return { database, calls, connections };
}
const RR = { isolationLevel: "REPEATABLE READ" };

test("opt-in RR is verified before BEGIN and restored before the same pool connection serves ordinary RC work", async () => {
  const { database, calls } = isolationFixture();
  const first = await database.transaction(tx => tx.get("SELECT state"), RR);
  assert.deepEqual(first, { id: 1, level: "REPEATABLE-READ", readOnly: false });
  assert.deepEqual(calls.filter(call => call[1] === "query").slice(2).map(call => call[2]), [
    "SELECT @@SESSION.transaction_isolation AS isolationLevel",
    "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    "SELECT @@SESSION.transaction_isolation AS isolationLevel",
    "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
    "SELECT @@SESSION.transaction_isolation AS isolationLevel",
  ]);
  const checkpoint = calls.length;
  assert.deepEqual(await database.transaction(tx => tx.get("SELECT state")), { id: 1, level: "READ-COMMITTED", readOnly: false });
  assert.ok(calls.slice(checkpoint).every(call => !String(call[2]).includes("ISOLATION") && !String(call[2]).includes("transaction_isolation")));
  await database.close();
});

test("RR rollback restores the prior session without masking the business failure", async () => {
  const { database, calls } = isolationFixture();
  const original = new Error("synthetic business rejection");
  await assert.rejects(database.transaction(async tx => { await tx.run("UPDATE synthetic"); throw original; }, RR), error => error === original);
  assert.ok(calls.some(call => call[1] === "rollback"));
  assert.deepEqual(await database.transaction(tx => tx.get("SELECT state")), { id: 1, level: "READ-COMMITTED", readOnly: false });
  await database.close();
});

test("invalid options are rejected before pool checkout", async () => {
  const { database, calls } = isolationFixture();
  for (const options of [null, [], { isolationLevel: "REPEATABLE-READ" }, { isolationLevel: "READ COMMITTED; DROP TABLE x" }, { readOnly: "true" }, { unknown: true }]) {
    await assert.rejects(database.transaction(() => assert.fail("must not run"), options), TypeError);
  }
  assert.equal(calls.length, 0); await database.close();
});

test("isolation read/set/verification/start failures destroy the connection without entering the callback", async () => {
  for (const failures of [{ readError: new Error("raw secret") }, { initialLevel: "UNKNOWN" }, { setError: new Error("raw secret") }, { setupMismatch: true }, { beginError: new Error("raw secret") }]) {
    const { database, calls } = isolationFixture(failures);
    await assert.rejects(database.transaction(() => assert.fail("must not run"), RR), error => error.name === "MysqlOperationError" && !error.message.includes("raw secret"));
    assert.equal(calls.at(-1)[1], "destroy");
    assert.equal(calls.some(call => ["release", "commit", "rollback"].includes(call[1])), false);
    await database.close();
  }
});

test("restore failure after confirmed COMMIT destroys instead of turning success into a false rollback", async () => {
  for (const failures of [{ restoreError: new Error("raw secret") }, { restoreMismatch: true }]) {
    const { database, calls } = isolationFixture(failures);
    assert.equal(await database.transaction(() => "committed", RR), "committed");
    assert.equal(calls.at(-1)[1], "destroy"); assert.equal(calls.some(call => call[1] === "rollback"), false);
    assert.deepEqual(await database.transaction(tx => tx.get("SELECT state")), { id: 2, level: "READ-COMMITTED", readOnly: false });
    await database.close();
  }
});

test("restore failure after rollback preserves the original rejection and discards the changed session", async () => {
  const { database, calls } = isolationFixture({ restoreError: new Error("raw secret") });
  const original = new Error("business rejection");
  await assert.rejects(database.transaction(() => { throw original; }, RR), error => error === original);
  assert.equal(calls.at(-1)[1], "destroy"); await database.close();
});

test("unknown commit and failed rollback destroy directly, without restoration SQL or pool release", async () => {
  for (const operation of ["commit", "rollback"]) {
    const { database, calls } = isolationFixture({ [operation + "Error"]: Object.assign(new Error("raw secret"), { code: "ECONNRESET" }) });
    const original = new Error("business rejection");
    await assert.rejects(database.transaction(() => { if (operation === "rollback") throw original; }, RR), error => operation === "commit" ? error.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN" : error === original);
    assert.equal(calls.at(-1)[1], "destroy");
    assert.equal(calls.filter(call => String(call[2]).startsWith("SET SESSION TRANSACTION")).length, 1);
    assert.equal(calls.some(call => call[1] === "release"), false); await database.close();
  }
});

test("readOnly opt-in starts a server-enforced READ ONLY transaction and restores RR override on rejection", async () => {
  const { database, calls } = isolationFixture();
  assert.deepEqual(await database.transaction(tx => tx.get("SELECT state"), { ...RR, readOnly: true }), { id: 1, level: "REPEATABLE-READ", readOnly: true });
  assert.ok(calls.some(call => call[2] === "START TRANSACTION READ ONLY"));
  await assert.rejects(database.transaction(tx => tx.run("UPDATE synthetic"), { ...RR, readOnly: true }), { code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" });
  assert.deepEqual(await database.transaction(tx => tx.get("SELECT state")), { id: 1, level: "READ-COMMITTED", readOnly: false });
  await database.close();
});

test("read-only start failure destroys without invoking the callback", async () => {
  const { database, calls } = isolationFixture({ beginError: new Error("raw secret") });
  await assert.rejects(database.transaction(() => assert.fail("must not run"), { ...RR, readOnly: true }), { name: "MysqlOperationError" });
  assert.equal(calls.at(-1)[1], "destroy"); await database.close();
});

test("all four original session levels, including driver Buffer results, are restored from fixed SQL", async () => {
  for (const initialLevel of ["READ-UNCOMMITTED", "READ-COMMITTED", "REPEATABLE-READ", "SERIALIZABLE"]) {
    const { database, connections } = isolationFixture({ initialLevel, bufferLevel: true });
    await database.transaction(tx => tx.get("SELECT state"), RR);
    assert.equal(connections[0].level, initialLevel); await database.close();
  }
});
