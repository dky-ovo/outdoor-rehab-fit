import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { AdminAuthorizationError, revalidateAdmin } from "../src/adminAuthorization.js";
import { createMysqlDatabase } from "../src/mysqlDatabase.js";
import { writeSystemLog } from "../src/systemLog.js";

function sqlite() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT,phone TEXT,email TEXT,profile_role TEXT,avatar_data TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE admin_accounts (user_id TEXT,system_role TEXT,permissions_json TEXT,is_active INTEGER,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE system_logs (id TEXT,actor_user_id TEXT,actor_role TEXT,action TEXT,target_type TEXT,target_id TEXT,created_at TEXT,ip_address TEXT,metadata_json TEXT);
    INSERT INTO users (id,name,profile_role) VALUES ('actor','Synthetic actor','staff');
    INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active) VALUES ('actor','operator','["users.edit"]',1);`);
  return db;
}

test("SQLite guard refreshes current permissions and audit joins the existing synchronous transaction", () => {
  const db = sqlite(), request = { ip: "127.0.0.1", admin: { user: { id: "actor" }, account: { system_role: "super_admin" }, permissions: ["all"] } };
  try {
    assert.throws(() => revalidateAdmin(db, request, "users.edit"), /active database transaction/);
    assert.throws(db.transaction(() => {
      const result = revalidateAdmin(db, request, "users.edit");
      assert.equal(result?.then, undefined);
      assert.equal(request.admin.account.system_role, "operator");
      assert.deepEqual(request.admin.permissions, ["users.edit"]);
      writeSystemLog(db, request, "synthetic.write", "test", "row", { changed: true });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_logs").get().n, 1);
      throw new Error("rollback sentinel");
    }), /rollback sentinel/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_logs").get().n, 0);
    for (const [sql, code] of [
      ["UPDATE admin_accounts SET permissions_json='[]'", "permissionDenied"],
      ["UPDATE admin_accounts SET is_active=0", "adminRequired"],
      ["UPDATE users SET deleted_at='deleted'", "accountDeleted"],
      ["DELETE FROM users", "unauthorized"],
    ]) {
      db.exec(sql);
      assert.throws(db.transaction(() => revalidateAdmin(db, request, "users.edit")), error => error instanceof AdminAuthorizationError && error.code === code);
    }
  } finally { db.close(); }
});

test("MySQL guard locks user then admin and writes audit on one transaction connection", async () => {
  const calls = [];
  const connection = {
    async query() {},
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); }, destroy() { calls.push("destroy"); },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM users")) return [[{ id: "actor", deleted_at: null }]];
      if (sql.includes("FROM admin_accounts")) return [[{ user_id: "actor", system_role: "operator", permissions_json: '["users.edit"]', is_active: "1" }]];
      return [{ affectedRows: 1, warningStatus: 0, insertId: 0 }];
    },
  };
  let acquisitions = 0;
  const db = createMysqlDatabase({ ssl: { ca: "fixture", rejectUnauthorized: true, verifyIdentity: true } }, {
    poolFactory: () => ({ async getConnection() { acquisitions++; return connection; }, async end() {} }),
  });
  const request = { admin: { user: { id: "actor" } } };
  try {
    assert.equal(db.inTransaction, false);
    assert.throws(() => revalidateAdmin(db, request, "users.edit"), /active database transaction/);
    await assert.rejects(db.transaction(async () => {
      assert.equal(db.inTransaction, true);
      await revalidateAdmin(db, request, "users.edit");
      await writeSystemLog(db, request, "synthetic.write", "test", "row", { key: "a'quoted value" });
      throw new Error("rollback sentinel");
    }), /rollback sentinel/);
    assert.equal(db.inTransaction, false);
    assert.equal(acquisitions, 1);
    const queries = calls.filter(call => typeof call === "object");
    assert.match(queries[0].sql, /FROM users WHERE id = \? FOR UPDATE$/);
    assert.match(queries[1].sql, /FROM admin_accounts WHERE user_id = \? FOR UPDATE$/);
    assert.equal(queries[2].sql.includes("a'quoted value"), false);
    assert.deepEqual(JSON.parse(queries[2].values.at(-1)), { key: "a'quoted value" });
    assert.deepEqual(calls.filter(call => typeof call === "string"), ["begin", "rollback", "release"]);
  } finally { await db.close(); }
});

test("MySQL guard refuses disabled string state and stale requested permissions", async () => {
  for (const [account, code] of [
    [{ system_role: "super_admin", is_active: "0" }, "adminRequired"],
    [{ system_role: "operator", is_active: "1", permissions_json: "[]" }, "permissionDenied"],
    [{ system_role: "invented", is_active: "1" }, "adminRequired"],
  ]) {
    const db = { dialect: "mysql", inTransaction: true, async get(sql) { return sql.includes("FROM users") ? { id: "actor", deleted_at: null } : account; } };
    await assert.rejects(revalidateAdmin(db, { admin: { user: { id: "actor" }, permissions: ["users.edit"] } }, "users.edit"), { code });
  }
});

test("an audit warning or unexpected affected count is a failure", async () => {
  for (const result of [{ affectedRows: 1, warningStatus: 1 }, { affectedRows: 0, warningStatus: 0 }, { affectedRows: 2, warningStatus: 0 }]) {
    await assert.rejects(writeSystemLog({ dialect: "mysql", async run() { return result; } }, {}, "synthetic.write", "test", "row"), { code: "SYSTEM_LOG_WRITE_FAILED" });
  }
});
