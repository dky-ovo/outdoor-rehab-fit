import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createIdentityRepository } from "../src/identityRepository.js";

function sqliteFixture(t) {
  const database = new Database(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, profile_role TEXT,
      password_salt TEXT, password_hash TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      last_seen_at TEXT, avatar_data TEXT);
    CREATE TABLE admin_accounts (user_id TEXT PRIMARY KEY, system_role TEXT, permissions_json TEXT,
      is_active INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT);
  `);
  const insert = database.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("active", "Synthetic", "+85212345678", "case@example.test", "staff", "synthetic-salt",
    "synthetic-hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null, null, "");
  insert.run("deleted", "Deleted", "+85212345679", "deleted@example.test", "participant", "old-salt",
    "old-hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-09-24T00:00:00.000Z", null, null);
  database.prepare("INSERT INTO admin_accounts VALUES (?,?,?,?,?,?,?)")
    .run("active", "operator", '["dashboard.read"]', 0, null, "created", "updated");
  return { database, repository: createIdentityRepository(database) };
}

test("SQLite identity reads remain synchronous and preserve original row fields and deletion filters", (t) => {
  const { database, repository } = sqliteFixture(t);
  assert.equal(repository.dialect, "sqlite");
  const row = repository.getUserById("active");
  assert.ok(!(row instanceof Promise));
  assert.deepEqual(row, database.prepare("SELECT * FROM users WHERE id = ?").get("active"));
  assert.equal(repository.getActiveUserById("active").id, "active");
  assert.equal(repository.getUserById("deleted").id, "deleted");
  assert.equal(repository.getActiveUserById("deleted"), null);
  assert.equal(repository.getUserById("missing"), null);
  assert.deepEqual(repository.getDeletionState("active"), { deleted_at: null });
  assert.deepEqual(repository.getDeletionState("deleted"), { deleted_at: "2026-09-24T00:00:00.000Z" });
  assert.equal(repository.getDeletionState("missing"), null);
  assert.equal(repository.findActiveUserByIdentifier({ kind: "email", value: "case@example.test" }).id, "active");
  assert.equal(repository.findActiveUserByIdentifier({ kind: "phone", value: "+85212345678" }).id, "active");
  assert.equal(repository.findActiveUserByIdentifier({ kind: "email", value: "CASE@example.test" }), null);
  assert.equal(repository.findActiveUserByIdentifier({ kind: "phone", value: " +85212345678 " }), null);
  assert.equal(repository.findActiveUserByIdentifier({ kind: "email", value: "deleted@example.test" }), null);
  assert.equal(repository.findActiveUserByIdentifier({ kind: "phone", value: "+85212345679" }), null);
  assert.equal(repository.findActiveUserByIdentifier({ kind: "email", value: "' OR 1=1 --" }), null);
});

test("SQLite touch preserves conditional cutoff and participates in the caller's synchronous rollback", (t) => {
  const { database, repository } = sqliteFixture(t);
  const first = "2026-09-24T00:01:00.000Z", next = "2026-09-24T00:01:30.000Z";
  assert.equal(repository.touchLastSeen("active", first, "2026-09-24T00:00:00.000Z"), undefined);
  repository.touchLastSeen("active", next, "2026-09-24T00:00:30.000Z");
  assert.equal(repository.getUserById("active").last_seen_at, first);
  repository.touchLastSeen("active", next, first); // Equality is not older.
  assert.equal(repository.getUserById("active").last_seen_at, first);
  assert.throws(() => database.transaction(() => {
    repository.touchLastSeen("active", "2026-09-24T00:03:00.000Z", "2026-09-24T00:02:00.000Z");
    assert.equal(repository.getUserById("active").last_seen_at, "2026-09-24T00:03:00.000Z");
    throw new Error("synthetic rollback");
  }).immediate(), /synthetic rollback/);
  assert.equal(repository.getUserById("active").last_seen_at, first);
  assert.equal(repository.touchLastSeen("missing", next, first), undefined);
  assert.equal(repository.touchLastSeen("deleted", next, first), undefined);
  assert.equal(repository.getUserById("deleted").last_seen_at, null);
  database.prepare("UPDATE users SET deleted_at = ? WHERE id = ?").run("2026-09-24T00:02:00.000Z", "active");
  repository.touchLastSeen("active", "2026-09-24T00:03:00.000Z", "2026-09-24T00:02:00.000Z");
  assert.equal(repository.getUserById("active").last_seen_at, first);
});

test("SQLite admin reads retain disabled accounts and permission JSON; missing accounts return null", (t) => {
  const { database, repository } = sqliteFixture(t);
  assert.deepEqual(repository.getAdminAccountByUserId("active"), database.prepare("SELECT * FROM admin_accounts").get());
  assert.equal(repository.getAdminAccountByUserId("active").is_active, 0);
  assert.equal(repository.getAdminAccountByUserId("missing"), null);
  database.prepare("UPDATE admin_accounts SET is_active=2").run();
  assert.throws(() => repository.getAdminAccountByUserId("active"), { code: "IDENTITY_ADMIN_STATE_INVALID" });
});

test("MySQL methods await only the injected executor and pass values separately with explicit user projections", async () => {
  const calls = [];
  const row = { id: "synthetic-id", deleted_at: null, password_hash: "synthetic-hash", avatar_data: "" };
  const executor = {
    dialect: "mysql",
    async get(sql, values) { calls.push({ type: "get", sql, values }); await Promise.resolve(); return row; },
    async run(sql, values) { calls.push({ type: "run", sql, values }); await Promise.resolve(); return { affectedRows: 0 }; },
  };
  const repository = createIdentityRepository(executor);
  assert.equal(repository.dialect, "mysql");
  assert.equal(calls.length, 0);
  const pending = repository.getUserById("' OR 1=1 --");
  assert.ok(pending instanceof Promise);
  assert.equal(await pending, row);
  assert.equal(await repository.getActiveUserById("synthetic-id"), row);
  assert.equal(await repository.findActiveUserByIdentifier({ kind: "email", value: "case@example.test" }), row);
  assert.equal(await repository.findActiveUserByIdentifier({ kind: "phone", value: "+85212345678" }), row);
  assert.equal(await repository.getDeletionState("synthetic-id"), row);
  assert.equal(await repository.touchLastSeen("synthetic-id", "now-iso", "cutoff-iso"), undefined);
  assert.deepEqual(calls.map((call) => call.values), [["' OR 1=1 --"], ["synthetic-id"], ["case@example.test"],
    ["+85212345678"], ["synthetic-id"], ["now-iso", "synthetic-id", "cutoff-iso"]]);
  assert.doesNotMatch(calls[0].sql, /SELECT \*|OR 1=1/);
  assert.match(calls[0].sql, /password_salt, password_hash/);
  assert.match(calls[1].sql, /deleted_at IS NULL/);
  assert.match(calls[2].sql, /email = \?/);
  assert.match(calls[3].sql, /phone = \?/);
  assert.equal(calls[4].sql, "SELECT deleted_at FROM users WHERE id = ?");
  assert.match(calls[5].sql, /last_seen_at IS NULL OR last_seen_at < \?/);
  assert.match(calls[5].sql, /deleted_at IS NULL/);
});

test("MySQL admin activation strings are strictly decoded and never mutate the driver's row", async () => {
  for (const value of [0, 1, "0", "1", 0n, 1n]) {
    const row = { user_id: "synthetic", is_active: value, permissions_json: "[]", system_role: "operator" };
    const repository = createIdentityRepository({ dialect: "mysql", async get() { return row; }, async run() {} });
    const account = await repository.getAdminAccountByUserId("synthetic");
    assert.equal(account.is_active, Number(value));
    assert.equal(Boolean(account.is_active), Number(value) === 1);
    assert.equal(account.permissions_json, "[]");
    assert.equal(row.is_active, value);
  }
  for (const value of [undefined, null, true, false, "00", " 0", "2", 2, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const repository = createIdentityRepository({ dialect: "mysql", async get() { return { is_active: value }; }, async run() {} });
    await assert.rejects(repository.getAdminAccountByUserId("synthetic"), { code: "IDENTITY_ADMIN_STATE_INVALID" });
  }
});

test("missing MySQL rows normalize to null and executor errors propagate without fallback or retries", async () => {
  let result;
  let error;
  let calls = 0;
  const repository = createIdentityRepository({ dialect: "mysql",
    async get() { calls++; if (error) throw error; return result; },
    async run() { calls++; if (error) throw error; },
  });
  for (const missing of [undefined, null]) {
    result = missing;
    assert.equal(await repository.getUserById("missing"), null);
    assert.equal(await repository.getActiveUserById("missing"), null);
    assert.equal(await repository.getDeletionState("missing"), null);
    assert.equal(await repository.getAdminAccountByUserId("missing"), null);
  }
  error = Object.assign(new Error("synthetic executor failure"), { code: "SYNTHETIC_FAILURE" });
  const before = calls;
  await assert.rejects(repository.getUserById("id"), (received) => received === error);
  await assert.rejects(repository.touchLastSeen("id", "now", "cutoff"), (received) => received === error);
  assert.equal(calls, before + 2);
});

test("invalid backend and identifier kinds fail without interpolating input or querying", async (t) => {
  const { repository } = sqliteFixture(t);
  for (const identifier of [undefined, {}, { kind: "email OR 1=1", value: "x" }, { kind: "email", value: 123 }]) {
    assert.throws(() => repository.findActiveUserByIdentifier(identifier), TypeError);
  }
  let calls = 0;
  const mysqlRepository = createIdentityRepository({ dialect: "mysql", async get() { calls++; }, async run() {} });
  await assert.rejects(mysqlRepository.findActiveUserByIdentifier({ kind: "__proto__", value: "x" }), TypeError);
  assert.equal(calls, 0);
  assert.throws(() => createIdentityRepository({ dialect: "mysql", prepare() {} }), TypeError);
  assert.throws(() => createIdentityRepository({}), TypeError);
});
