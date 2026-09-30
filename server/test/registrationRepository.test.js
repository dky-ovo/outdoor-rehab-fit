import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createDatabase } from "../src/database.js";
import { createRegistrationRepository } from "../src/registrationRepository.js";
import { registrationCodeHash } from "../src/registrationCodes.js";
import { revalidateAdmin } from "../src/adminAuthorization.js";
import { writeSystemLog } from "../src/systemLog.js";

const now = "2026-09-24T00:00:00.000Z";
const input = { name: "Synthetic registrant", phone: "+85261234567", profileRole: "participant" };
const request = () => ({ admin: { user: { id: "actor" } }, ip: "127.0.0.1" });
function makeInvitation(data, actorId, code = "ABCDEFGH") {
  return { code, row: { id: crypto.randomUUID(), code_hash: registrationCodeHash(code), code_hint: code.slice(-4),
    name: data.name, phone: data.phone, profile_role: data.profileRole, created_by: actorId, created_at: now } };
}
const consumeInput = (code = "ABCDEFGH") => ({ codeHash: registrationCodeHash(code), phone: input.phone, email: null,
  name: "Synthetic nickname", passwordRecord: { salt: "synthetic-salt", hash: "synthetic-hash" } });

function fixture(t) {
  const database = createDatabase(":memory:");
  t.after(() => database.close());
  database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('actor','Actor','+85291112222','staff','salt','hash',?,?)").run(now, now);
  database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('actor','operator','[\"users.edit\",\"users.read\"]',1,?,?)").run(now, now);
  return database;
}
const options = (overrides = {}) => ({ makeInvitation, revalidateAdmin, writeSystemLog, ...overrides });

// This async executor uses a synthetic SQLite fixture to validate business
// boundaries, bound values and rollback. It does not emulate InnoDB locks or
// replace a real MySQL integration test; FOR UPDATE is asserted separately.
function mysqlExecutor(sqlite) {
  const calls = [];
  const hooks = {};
  let inTransaction = false;
  let tail = Promise.resolve();
  async function execute(method, sql, values) {
    calls.push({ method, sql, values, inTransaction });
    await Promise.resolve();
    const override = await hooks.execute?.(method, sql, values);
    if (override?.handled) return override.result;
    const statement = sqlite.prepare(sql.replace(/ FOR UPDATE$/, ""));
    try {
      if (method !== "run") return statement[method](...values);
      const result = statement.run(...values);
      return { affectedRows: result.changes, warningStatus: 0 };
    } catch (error) {
      if (["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"].includes(error.code)) {
        throw Object.assign(new Error("synthetic duplicate"), { code: "ER_DUP_ENTRY" });
      }
      throw error;
    }
  }
  const database = {
    dialect: "mysql", get inTransaction() { return inTransaction; },
    get: (sql, values) => execute("get", sql, values),
    all: (sql, values) => execute("all", sql, values),
    run: (sql, values) => execute("run", sql, values),
    transaction(callback) {
      const pending = tail.then(async () => {
        sqlite.exec("BEGIN IMMEDIATE"); inTransaction = true;
        try { const result = await callback(); sqlite.exec("COMMIT"); return result; }
        catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        finally { inTransaction = false; }
      });
      tail = pending.catch(() => {});
      return pending;
    },
  };
  return { database, calls, hooks };
}

test("SQLite operations stay synchronous and audit failures roll back issue and revoke", (t) => {
  const database = fixture(t);
  const repository = createRegistrationRepository(database, options());
  database.exec("CREATE TRIGGER fail_log BEFORE INSERT ON system_logs BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
  assert.throws(() => repository.issue(input, request()), /synthetic audit failure/);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM registration_codes").get().n, 0);
  database.exec("DROP TRIGGER fail_log");
  const issued = repository.issue(input, request());
  assert.equal(issued instanceof Promise, false);
  database.exec("CREATE TRIGGER fail_log BEFORE INSERT ON system_logs BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
  assert.throws(() => repository.revoke(issued.row.id, request()), /synthetic audit failure/);
  assert.equal(database.prepare("SELECT revoked_at FROM registration_codes").get().revoked_at, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM system_logs").get().n, 1);
});

test("MySQL locks current invitation and conditionally consumes it once with the new user in one transaction", async (t) => {
  const sqlite = fixture(t), { database, calls } = mysqlExecutor(sqlite);
  const repository = createRegistrationRepository(database, options());
  const issued = await repository.issue(input, request());
  await repository.checkRegistration(consumeInput());
  const results = await Promise.allSettled([repository.consume(consumeInput()), repository.consume(consumeInput())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.registrationError, "invalidRegistrationCode");
  const user = results.find((result) => result.status === "fulfilled").value;
  assert.equal(user.profile_role, "participant");
  assert.equal(sqlite.prepare("SELECT used_by FROM registration_codes WHERE id=?").get(issued.row.id).used_by, user.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE phone=?").get(input.phone).n, 1);
  const locked = calls.filter((call) => call.sql.endsWith("FOR UPDATE"));
  assert.match(locked[0].sql, /FROM users WHERE id = \? FOR UPDATE$/);
  assert.match(locked[1].sql, /FROM admin_accounts WHERE user_id = \? FOR UPDATE$/);
  assert.ok(locked.some((call) => call.sql.includes("code_hash = ? AND phone = ?")));
  assert.ok(locked.every((call) => call.inTransaction));
  assert.ok(calls.filter((call) => call.sql.includes("FROM users WHERE phone") || call.sql.startsWith("SELECT id FROM registration_codes WHERE phone"))
    .every((call) => !call.sql.endsWith("FOR UPDATE")));
  const updates = calls.filter((call) => call.sql.startsWith("UPDATE registration_codes SET used_at"));
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /used_at IS NULL AND revoked_at IS NULL$/);
  assert.ok(calls.filter((call) => call.method === "run").every((call) => call.inTransaction && !call.sql.includes("IGNORE")));
});

test("MySQL zero-row consume rolls back the inserted user", async (t) => {
  const sqlite = fixture(t), { database, hooks } = mysqlExecutor(sqlite);
  const repository = createRegistrationRepository(database, options());
  await repository.issue(input, request());
  hooks.execute = (method, sql) => method === "run" && sql.startsWith("UPDATE registration_codes SET used_at") ? { handled: true, result: { affectedRows: 0, warningStatus: 0 } } : undefined;
  await assert.rejects(repository.consume(consumeInput()), { registrationError: "invalidRegistrationCode" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE phone=?").get(input.phone).n, 0);
  assert.equal(sqlite.prepare("SELECT used_at FROM registration_codes").get().used_at, null);
});

test("MySQL user uniqueness races map phone/email conflicts with fresh bound reads, without parsing driver messages", async (t) => {
  for (const conflict of ["phone", "email"]) {
    const sqlite = fixture(t), { database, hooks, calls } = mysqlExecutor(sqlite);
    const repository = createRegistrationRepository(database, options());
    await repository.issue(input, request());
    let inserted = false;
    hooks.execute = (method, sql) => {
      if (method === "run" && sql.startsWith("INSERT INTO users")) {
        inserted = true;
        throw Object.assign(new Error("redacted"), { code: "ER_DUP_ENTRY" });
      }
      if (inserted && method === "all" && sql.includes("FROM users WHERE phone")) {
        return { handled: true, result: [{ phone: conflict === "phone" ? input.phone : "+85260000000", email: "synthetic@example.test" }] };
      }
    };
    await assert.rejects(repository.consume({ ...consumeInput(), email: "synthetic@example.test" }), { registrationError: `${conflict}Exists`, status: 409 });
    assert.ok(calls.at(-1).sql.endsWith("FOR UPDATE"));
    assert.equal(sqlite.prepare("SELECT used_at FROM registration_codes").get().used_at, null);
  }
});

test("MySQL warnings and unexpected insert counts abort every registration write path", async (t) => {
  for (const target of ["INSERT INTO users", "INSERT INTO registration_codes", "UPDATE registration_codes SET used_at", "UPDATE registration_codes SET revoked_at"]) {
    const sqlite = fixture(t), { database, hooks } = mysqlExecutor(sqlite);
    const repository = createRegistrationRepository(database, options());
    const issued = target === "INSERT INTO registration_codes" ? null : await repository.issue(input, request());
    hooks.execute = (method, sql) => method === "run" && sql.startsWith(target) ? { handled: true, result: { affectedRows: 1, warningStatus: 1 } } : undefined;
    const operation = () => target === "INSERT INTO registration_codes" ? repository.issue(input, request()) : target.includes("revoked_at") ? repository.revoke(issued.row.id, request()) : repository.consume(consumeInput());
    await assert.rejects(operation(), { code: "REGISTRATION_WRITE_INVALID" });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE phone=?").get(input.phone).n, 0);
    const row = sqlite.prepare("SELECT used_at, revoked_at FROM registration_codes").get();
    if (row) assert.deepEqual(row, { used_at: null, revoked_at: null });
    else assert.equal(target, "INSERT INTO registration_codes");
    if (target.startsWith("INSERT")) {
      hooks.execute = (method, sql) => method === "run" && sql.startsWith(target) ? { handled: true, result: { affectedRows: 0, warningStatus: 0 } } : undefined;
      await assert.rejects(operation(), { code: "REGISTRATION_WRITE_INVALID" });
    }
  }
});

test("MySQL code hash collisions retry without overwriting history, bounded exhaustion and active phone conflicts stay fixed errors", async (t) => {
  const sqlite = fixture(t), { database } = mysqlExecutor(sqlite);
  let code = "AAAAAAAA";
  const repository = createRegistrationRepository(database, options({ makeInvitation: (data, actor) => makeInvitation(data, actor, code), generationAttempts: 2 }));
  const historical = await repository.issue({ ...input, phone: "+85260000000" }, request());
  await repository.revoke(historical.row.id, request());
  await assert.rejects(repository.issue(input, request()), { registrationError: "registrationCodeGenerationUnavailable", status: 503 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM registration_codes").get().n, 1);
  let attempts = 0;
  const retry = createRegistrationRepository(database, options({ makeInvitation: (data, actor) => makeInvitation(data, actor, attempts++ === 0 ? "AAAAAAAA" : "BBBBBBBB") }));
  const issued = await retry.issue(input, request());
  assert.equal(issued.code, "BBBBBBBB");
  assert.equal(attempts, 2);
  await assert.rejects(retry.issue(input, request()), { registrationError: "activeRegistrationCodeExists", status: 409 });
});

test("MySQL awaits injected audit inside issue and revoke transactions and rolls back on failure", async (t) => {
  const sqlite = fixture(t), { database } = mysqlExecutor(sqlite);
  let fail = true;
  const audit = async (...args) => {
    await writeSystemLog(...args);
    await Promise.resolve();
    assert.equal(database.inTransaction, true);
    if (fail) throw new Error("synthetic audit failure");
  };
  const repository = createRegistrationRepository(database, options({ writeSystemLog: audit }));
  await assert.rejects(repository.issue(input, request()), /synthetic audit failure/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM registration_codes").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM system_logs").get().n, 0);
  fail = false;
  const issued = await repository.issue(input, request());
  fail = true;
  await assert.rejects(repository.revoke(issued.row.id, request()), /synthetic audit failure/);
  assert.equal(sqlite.prepare("SELECT revoked_at FROM registration_codes").get().revoked_at, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM system_logs").get().n, 1);
});

test("MySQL rechecks current actor permissions/deletion inside the transaction before any administrative mutation", async (t) => {
  const sqlite = fixture(t), { database } = mysqlExecutor(sqlite);
  const repository = createRegistrationRepository(database, options());
  const issued = await repository.issue(input, request());
  sqlite.prepare("UPDATE admin_accounts SET permissions_json='[]' WHERE user_id='actor'").run();
  await assert.rejects(repository.revoke(issued.row.id, request()), { authorizationError: "permissionDenied" });
  await assert.rejects(repository.issue({ ...input, phone: "+85260000000" }, request()), { authorizationError: "permissionDenied" });
  sqlite.prepare("UPDATE users SET deleted_at=? WHERE id='actor'").run(now);
  await assert.rejects(repository.revoke(issued.row.id, request()), { authorizationError: "accountDeleted" });
  assert.equal(sqlite.prepare("SELECT revoked_at FROM registration_codes").get().revoked_at, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM registration_codes").get().n, 1);
});

test("both backends preserve SQLite ASCII LIKE search, literal wildcard/backslash, non-ASCII case and page ordering", async (t) => {
  const sqlite = fixture(t);
  const names = ["AbC", "100%literal", "under_score", "path\\item", "Äpfel", "äpfel", "中文ABC", "O'Reilly"];
  for (const [index, name] of names.entries()) {
    const item = makeInvitation({ ...input, name, phone: `+8526000000${index}` }, "actor", String(index));
    const row = item.row;
    sqlite.prepare("INSERT INTO registration_codes(id,code_hash,code_hint,name,phone,profile_role,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(row.id, row.code_hash, row.code_hint, row.name, row.phone, row.profile_role, row.created_by, row.created_at);
  }
  const repositories = [createRegistrationRepository(sqlite, options()), createRegistrationRepository(mysqlExecutor(sqlite).database, options())];
  for (const search of ["abc", "%", "_", "\\", "Ä", "ä", "中文", "'", ""]) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const expected = sqlite.prepare("SELECT id FROM registration_codes WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC").all(pattern, pattern).map((row) => row.id);
    for (const repository of repositories) {
      const result = await repository.list({ search, status: "constructor", pageSize: 3, requestedPage: 1 });
      assert.equal(result.total, expected.length);
      assert.deepEqual(result.codes.map((row) => row.id), expected.slice(0, 3));
      assert.ok(result.codes.every((row) => !Object.hasOwn(row, "code_hash")));
    }
  }
});
