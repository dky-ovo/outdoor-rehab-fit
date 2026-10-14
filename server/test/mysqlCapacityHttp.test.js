import assert from "node:assert/strict";
import test from "node:test";
import { createMysqlApp } from "../src/appMysql.js";
import { shouldTouchLastSeen } from "../src/lastSeenPolicy.js";
import { signToken } from "../src/security.js";

const SECRET = "synthetic-mysql-capacity-http-secret-over-32-characters";

async function fixture(t, options = {}) {
  const calls = { reads: 0, touches: 0 };
  const row = { id: "capacity-user", name: "Synthetic user", phone: "+85270000001", email: "capacity@example.test", profile_role: "participant", deleted_at: null, ...options.row };
  const identityRepository = {
    async getUserById() { calls.reads++; if (options.readError) throw options.readError; return { ...row }; },
    async getDeletionState() { return { deleted_at: row.deleted_at }; },
    async touchLastSeen(_id, time) { calls.touches++; await options.onTouch?.(row); row.last_seen_at = time; },
    async getAdminAccountByUserId() { return null; }
  };
  const database = {
    dialect: "mysql", async all() { return []; },
    async get() { return { total: 0, ready: 1 }; },
    async run() { return { affectedRows: 0, insertId: 0, warningStatus: 0 }; },
    async transaction(callback) { return callback(database); }
  };
  const app = await createMysqlApp({ database, identityRepository, jwtSecret: SECRET });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await app.locals.imageRetirement?.stop();
  });
  const token = signToken({ id: row.id, profile_role: "participant" }, SECRET);
  const request = () => fetch(`http://127.0.0.1:${server.address().port}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { request, calls, row };
}

test("UTC last-seen values skip redundant writes only within the existing minute", () => {
  const now = Date.parse("2026-10-02T09:30:00.000Z");
  assert.equal(shouldTouchLastSeen("2026-10-02T09:29:30.000Z", now), false);
  assert.equal(shouldTouchLastSeen("2026-10-02 09:29:30.000000", now), false);
  assert.equal(shouldTouchLastSeen("2026-10-02T09:29:00.000Z", now), false);
  assert.equal(shouldTouchLastSeen("2026-10-02T09:28:59.999Z", now), true);
  for (const value of [null, "", "invalid", "2026-10-02T09:29:30", "2026-10-02T10:00:00.000Z"]) {
    assert.equal(shouldTouchLastSeen(value, now), true);
  }
});

test("50 recent-user HTTP requests each read identity once without redundant activity writes", async t => {
  const f = await fixture(t, { row: { last_seen_at: new Date().toISOString() } });
  const responses = await Promise.all(Array.from({ length: 50 }, () => f.request()));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(f.calls.reads, 50);
  assert.equal(f.calls.touches, 0);
  for (const r of responses) assert.equal((await r.json()).user.id, "capacity-user");
  f.row.deleted_at = new Date().toISOString();
  const deleted = await f.request();
  assert.equal(deleted.status, 401);
  assert.deepEqual(await deleted.json(), { error: "accountDeleted" });
});

test("old activity is written and deletion during that write still revokes access", async t => {
  const f = await fixture(t, { row: { last_seen_at: "2026-01-01T00:00:00.000Z" }, onTouch: row => { row.deleted_at = new Date().toISOString(); } });
  const response = await f.request();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "accountDeleted" });
  assert.deepEqual(f.calls, { reads: 2, touches: 1 });
});

test("pool saturation is uncached retryable 503 rather than generic 500", async t => {
  const f = await fixture(t, { readError: Object.assign(new Error("Synthetic private driver details"), { code: "MYSQL_POOL_QUEUE_LIMIT" }) });
  const response = await f.request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "serverBusy", retryAfterSec: 2 });
});

test("unrelated database errors remain 500 and disclose no SQL or driver details", async t => {
  const f = await fixture(t, { readError: Object.assign(new Error("Synthetic SQL with private parameters"), { code: "ER_BAD_FIELD_ERROR" }) });
  const response = await f.request();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("retry-after"), null);
  assert.deepEqual(await response.json(), { error: "internalError" });
});
