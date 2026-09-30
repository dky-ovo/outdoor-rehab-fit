import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { createIdentityRepository } from "../src/identityRepository.js";
import { hashPassword, signToken } from "../src/security.js";

const SECRET = "async-identity-test-secret-over-thirty-two-characters";
const PASSWORD = "Synthetic-password-identity-1";

async function fixture(run, overrides = {}) {
  const database = createDatabase(":memory:");
  const now = new Date().toISOString(), password = await hashPassword(PASSWORD);
  database.prepare("INSERT INTO users (id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('identity-user','Synthetic user','+85261230000','identity@example.test','participant',?,?,?,?)")
    .run(password.salt, password.hash, now, now);
  database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('identity-user','operator','[\"users.read\"]',1,?,?)").run(now, now);
  const base = createIdentityRepository(database);
  const identityRepository = Object.fromEntries(Object.entries(base).map(([key, value]) => [key,
    typeof value === "function" ? async (...args) => { await Promise.resolve(); return value(...args); } : value]));
  for (const [key, value] of Object.entries(overrides)) identityRepository[key] = (...args) => value({ database, base }, ...args);
  const server = createApp({ database, jwtSecret: SECRET, identityRepository }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const token = signToken({ id: "identity-user", profile_role: "participant" }, SECRET);
  const request = (route, { auth = true, method = "GET", body } = {}) => fetch(url + route, {
    method, headers: { ...(auth ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try { await run({ database, request }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("delayed identity reads preserve user, administrator and feedback HTTP behavior", async () => {
  await fixture(async ({ database, request }) => {
    const user = await request("/api/users/me");
    assert.equal(user.status, 200);
    assert.equal((await user.json()).user.id, "identity-user");
    assert.ok(database.prepare("SELECT last_seen_at FROM users WHERE id='identity-user'").get().last_seen_at);
    const admin = await request("/api/admin/me");
    assert.equal(admin.status, 200);
    const feedback = await request("/api/feedback", { method: "POST", body: {
      submissionId: "async-identity-feedback-0001", name: "Synthetic user", email: "identity@example.test",
      subject: "Synthetic", message: "A synthetic feedback body", locale: "en",
    } });
    assert.equal(feedback.status, 201);
    assert.deepEqual(database.prepare("SELECT user_id, submitter_type FROM feedback").get(), {
      user_id: "identity-user", submitter_type: "registered",
    });
    database.prepare("UPDATE admin_accounts SET is_active=0 WHERE user_id='identity-user'").run();
    const denied = await request("/api/admin/me");
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "adminRequired" });
    database.prepare("UPDATE users SET deleted_at=? WHERE id='identity-user'").run(new Date().toISOString());
    const deleted = await request("/api/health");
    assert.equal(deleted.status, 401);
    assert.deepEqual(await deleted.json(), { error: "accountDeleted" });
  });
});

test("an asynchronously absent user is unauthorized and cannot become a registered feedback sender", async () => {
  await fixture(async ({ database, request }) => {
    for (const [route, options] of [["/api/users/me", {}], ["/api/feedback", { method: "POST", body: {} }]]) {
      const result = await request(route, options);
      assert.equal(result.status, 401);
      assert.deepEqual(await result.json(), { error: "unauthorized" });
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 0);
  }, { getUserById: async () => null });
});

test("a user response waits until the asynchronous last-seen write is complete", async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await fixture(async ({ request }) => {
    let settled = false;
    const pending = request("/api/users/me").then(response => { settled = true; return response; });
    try {
      await started;
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(settled, false);
    } finally { release(); }
    assert.equal((await pending).status, 200);
  }, { touchLastSeen: async ({ base }, ...args) => { entered(); await gate; return base.touchLastSeen(...args); } });
});

test("login awaits identifier lookup and a fresh active-user read after password verification", async () => {
  let reread = false;
  await fixture(async ({ request }) => {
    const login = await request("/api/auth/login", { auth: false, method: "POST", body: { identifier: "identity@example.test", password: PASSWORD } });
    assert.equal(reread, true);
    assert.equal(login.status, 401);
    assert.deepEqual(await login.json(), { error: "invalidCredentials" });
  }, { getActiveUserById: async () => { await Promise.resolve(); reread = true; return null; } });
});

test("deletion or role revocation during last-seen update is checked before a protected operation", async () => {
  await fixture(async ({ database, request }) => {
    const result = await request("/api/research/events", { method: "POST", body: { eventName: "screen.view" } });
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: "accountDeleted" });
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM research_events").get().n, 0);
  }, { touchLastSeen: async ({ database }) => {
    await Promise.resolve();
    database.prepare("UPDATE users SET deleted_at=? WHERE id='identity-user'").run(new Date().toISOString());
  } });
  await fixture(async ({ database, request }) => {
    database.prepare("UPDATE users SET profile_role='staff' WHERE id='identity-user'").run();
    const result = await request("/api/chat/participants");
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { error: "staffRequired" });
  }, { touchLastSeen: async ({ database }) => {
    await Promise.resolve();
    database.prepare("UPDATE users SET profile_role='participant' WHERE id='identity-user'").run();
  } });
});

test("the unfinished MySQL application cannot be started through createApp", () => {
  assert.throws(() => createApp({ database: { dialect: "mysql" }, jwtSecret: SECRET }), /not yet fully migrated/);
});

test("personnel creation rechecks actor authority and target deletion after awaiting lookup", async () => {
  for (const change of ["deactivate", "revoke", "delete-target"]) {
    await fixture(async ({ database, request }) => {
      const now = new Date().toISOString();
      database.prepare("UPDATE admin_accounts SET system_role='admin' WHERE user_id='identity-user'").run();
      database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('target','Synthetic target','+85261230001','staff','salt','hash',?,?)").run(now, now);
      const result = await request("/api/admin/personnel", { method: "POST", body: { identifier: "+85261230001", systemRole: "operator" } });
      assert.equal(result.status, change === "delete-target" ? 404 : 403);
      assert.deepEqual(await result.json(), { error: change === "delete-target" ? "userNotFound" : change === "deactivate" ? "adminRequired" : "permissionDenied" });
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_accounts WHERE user_id='target'").get().n, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM system_logs WHERE action='admin_account.create'").get().n, 0);
    }, { findActiveUserByIdentifier: async ({ database, base }, identifier) => {
      const row = base.findActiveUserByIdentifier(identifier);
      await Promise.resolve();
      if (change === "deactivate") database.prepare("UPDATE admin_accounts SET is_active=0 WHERE user_id='identity-user'").run();
      else if (change === "revoke") database.prepare("UPDATE admin_accounts SET system_role='operator',permissions_json='[]' WHERE user_id='identity-user'").run();
      else database.prepare("UPDATE users SET deleted_at=? WHERE id='target'").run(new Date().toISOString());
      return row;
    } });
  }
});
