import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { FEEDBACK_SCHEMA } from "../src/feedback.js";
import { signToken } from "../src/security.js";

const SECRET = "feedback-tests-only-secret-with-more-than-thirty-two-characters";
const payload = (overrides = {}) => ({ submissionId: crypto.randomUUID(), name: "測試聯絡人", email: "visitor@example.org", subject: "應用程式意見", message: "請改善設施搜尋。\n謝謝！", locale: "zh", ...overrides });

async function fixture(run) {
  let database = createDatabase(":memory:"), server;
  const tokens = {}, now = new Date().toISOString();
  const accounts = [
    ["super", "super_admin", [], 1], ["admin", "admin", [], 1],
    ["reader", "operator", ["feedback.read"], 1], ["editor", "operator", ["feedback.read", "feedback.manage"], 1],
    ["manage-only", "operator", ["feedback.manage"], 1], ["unrelated", "operator", ["users.read", "messages.read"], 1],
    ["inactive", "operator", ["feedback.read", "feedback.manage"], 0], ["ordinary", null, [], 1],
    ["deleted", "admin", [], 1],
  ];
  for (const [index, [id, role, permissions, active]] of accounts.entries()) {
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)")
      .run(id, `Account ${id}`, `+8526888000${index}`, now, now);
    if (role) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, role, JSON.stringify(permissions), active, now, now);
    tokens[id] = signToken({ id, profile_role: "staff" }, SECRET);
  }
  database.prepare("UPDATE users SET deleted_at = ? WHERE id = 'deleted'").run(now);
  const start = async () => {
    server = createApp({ database, jwtSecret: SECRET }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  const request = async (path, { actor = null, method = "GET", body, rawBody, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, data: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text, headers: response.headers };
  };
  const submit = (body = payload(), options = {}) => request("/api/feedback", { method: "POST", body, ...options });
  const list = (query = "", actor = "reader") => request(`/api/admin/feedback${query}`, { actor });
  const update = (id, body, actor = "editor") => request(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "PATCH", actor, body });
  const restart = async () => {
    await stop();
    // Reopen actual SQLite bytes without writing test data to a production path.
    const bytes = database.serialize(); database.close();
    database = new Database(bytes); database.pragma("foreign_keys = ON");
    database.exec(FEEDBACK_SCHEMA);
    await start();
  };
  try { await run({ get database() { return database; }, tokens, request, submit, list, update, restart }); }
  finally { await stop(); database.close(); }
}

test("guest feedback creates one private receipt and an audit entry without contact text", async () => fixture(async ({ database, submit, list, request }) => {
  const body = payload({ name: "  訪客  ", email: " Visitor@Example.org ", subject: "" });
  const created = await submit(body);
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.data.feedback).sort(), ["createdAt", "id", "status"]);
  assert.equal(created.data.feedback.status, "new");
  const row = (await list()).data.items[0];
  assert.equal(row.id, created.data.feedback.id); assert.equal(row.name, "訪客"); assert.equal(row.email, "visitor@example.org");
  assert.equal(row.subject, ""); assert.equal(row.message, body.message); assert.equal(row.locale, "zh");
  assert.equal(row.isGuest, true); assert.equal(row.userId, null); assert.equal(row.notes, "");
  const logs = database.prepare("SELECT * FROM system_logs WHERE action LIKE 'feedback.%'").all();
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0].metadata_json), { isGuest: true, locale: "zh" });
  assert.equal(logs[0].actor_user_id, null);
  assert.ok(!JSON.stringify(logs).includes(body.message)); assert.ok(!JSON.stringify(logs).includes("visitor@example.org"));
  for (const path of ["/api/feedback", `/api/feedback/${row.id}`]) assert.equal((await request(path)).status, 404);
  assert.equal((await request(`/api/admin/feedback/${row.id}`, { actor: "admin", method: "DELETE" })).status, 404);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 1);
}));

test("only server-verified identity is attached; forged, expired and deleted credentials are rejected", async () => fixture(async ({ database, submit, list }) => {
  const guest = await submit(payload({ userId: "super", isGuest: false, status: "resolved", notes: "forged" }));
  assert.equal(guest.status, 201);
  const signed = await submit(payload({ userId: "super", email: "signed@example.org", locale: "en" }), { actor: "ordinary" });
  assert.equal(signed.status, 201);
  const rows = (await list()).data.items;
  assert.equal(rows.find(row => row.id === guest.data.feedback.id).userId, null);
  const row = rows.find(item => item.id === signed.data.feedback.id);
  assert.equal(row.userId, "ordinary"); assert.equal(row.userName, "Account ordinary"); assert.equal(row.userProfileRole, "staff"); assert.equal(row.isGuest, false);
  assert.equal(row.status, "new"); assert.equal(row.notes, "");
  for (const token of ["invalid", signToken({ id: "ordinary" }, "wrong-secret"), signToken({ id: "ordinary" }, SECRET, Date.now() - 8 * 86400000), signToken({ id: "missing" }, SECRET)]) {
    const failed = await submit(payload(), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(failed.status, 401); assert.equal(failed.data.error, "unauthorized");
  }
  assert.equal((await submit(payload(), { actor: "deleted" })).status, 401);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 2);
}));

test("feedback rejects invalid types, lengths, email, locale and control characters", async () => fixture(async ({ database, submit, request }) => {
  const invalid = [
    null, [], "text", {}, { name: " " }, { name: "n".repeat(81) }, { name: 5 }, { name: "line\nbreak" },
    { email: "bad" }, { email: "two@@example.org" }, { email: "bad @example.org" }, { email: `a${"b".repeat(250)}@c.org` }, { email: {} },
    { subject: "s".repeat(161) }, { subject: null }, { message: " " }, { message: "m".repeat(5001) }, { message: {} }, { message: "bad\u0000message" },
    { submissionId: "short" }, { submissionId: "../".repeat(10) }, { submissionId: 25 }, { submissionId: "a".repeat(129) },
    { locale: "fr" }, { locale: null },
  ];
  for (const value of invalid) {
    const body = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length ? payload(value) : value;
    const result = await submit(body);
    assert.equal(result.status, 400, JSON.stringify(value)); assert.equal(result.data.error, "invalidFeedback");
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 0);
  const valid = payload({ name: "n".repeat(80), email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`, subject: "s".repeat(160), message: "m".repeat(5000) });
  assert.equal(valid.email.length, 254); assert.equal((await submit(valid)).status, 201);
  const noSubject = payload({ email: "second@example.org" }); delete noSubject.subject;
  assert.equal((await submit(noSubject)).status, 201);
  const malformed = await request("/api/feedback", { method: "POST", rawBody: '{"email":"private@example.org","message":', headers: { "Content-Type": "application/json" } });
  assert.equal(malformed.status, 400); assert.deepEqual(malformed.data, { error: "invalidFeedback" });
  const oversized = await submit(payload({ message: "m".repeat(33_000) }));
  assert.equal(oversized.status, 413); assert.deepEqual(oversized.data, { error: "invalidFeedback" });
}));

test("idempotent concurrent submissions return the same receipt; content and identity conflicts do not overwrite", async () => fixture(async ({ database, submit }) => {
  const body = payload();
  const results = await Promise.all(Array.from({ length: 12 }, () => submit(body)));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 200).length, 11);
  assert.equal(new Set(results.map(result => result.data.feedback.id)).size, 1);
  for (const changes of [{ message: "different" }, { name: "different" }, { email: "another@example.org" }, { subject: "different" }, { locale: "en" }]) {
    const conflict = await submit({ ...body, ...changes });
    assert.equal(conflict.status, 409); assert.equal(conflict.data.error, "feedbackSubmissionConflict");
  }
  assert.equal((await submit(body, { actor: "ordinary" })).status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action = 'feedback.submitted'").get().count, 1);
}));

test("admin and super-admin default permissions include feedback; operators need explicit read and manage", async () => fixture(async ({ submit, list, update, request }) => {
  await submit();
  for (const actor of ["reader", "editor", "admin", "super"]) assert.equal((await list("", actor)).status, 200);
  for (const actor of [null, "ordinary", "unrelated", "inactive", "manage-only", "deleted"]) assert.equal((await list("", actor)).status, [null, "deleted"].includes(actor) ? 401 : 403);
  let row = (await list()).data.items[0];
  for (const actor of [null, "ordinary", "unrelated", "inactive", "manage-only", "deleted"]) assert.equal((await request(`/api/admin/feedback/${row.id}`, { actor })).status, [null, "deleted"].includes(actor) ? 401 : 403);
  const detail = await request(`/api/admin/feedback/${row.id}`, { actor: "reader" }); assert.equal(detail.status, 200); assert.deepEqual(detail.data.feedback, row);
  const missing = await request("/api/admin/feedback/missing", { actor: "reader" }); assert.equal(missing.status, 404); assert.equal(missing.data.error, "feedbackNotFound");
  for (const actor of [null, "ordinary", "reader", "manage-only", "unrelated", "inactive", "deleted"]) {
    assert.equal((await update(row.id, { status: "resolved", notes: "not allowed", expectedUpdatedAt: row.updatedAt }, actor)).status, [null, "deleted"].includes(actor) ? 401 : 403);
  }
  for (const actor of ["editor", "admin", "super"]) {
    const result = await update(row.id, { status: "in_progress", notes: `Reviewed by ${actor}`, expectedUpdatedAt: row.updatedAt }, actor);
    assert.equal(result.status, 200); row = result.data.feedback;
  }
  for (const actor of ["admin", "super"]) {
    const result = await request("/api/admin/me", { actor });
    assert.ok(result.data.admin.permissions.includes("feedback.read")); assert.ok(result.data.admin.permissions.includes("feedback.manage"));
  }
}));

test("feedback permissions can be independently assigned using existing operator management", async () => fixture(async ({ request, list, submit, update }) => {
  const grant = await request("/api/admin/personnel", { actor: "admin", method: "POST", body: { identifier: "+85268880007", systemRole: "operator", permissions: ["feedback.read", "feedback.manage"] } });
  assert.equal(grant.status, 201);
  await submit();
  const result = await list("", "ordinary"); assert.equal(result.status, 200);
  const row = result.data.items[0];
  assert.equal((await update(row.id, { status: "resolved", notes: "Handled", expectedUpdatedAt: row.updatedAt }, "ordinary")).status, 200);
}));

test("admin pagination, status and literal text filtering operate on the complete feedback collection", async () => fixture(async ({ database, submit, list, update }) => {
  for (let index = 0; index < 27; index += 1) assert.equal((await submit(payload({ email: `visitor${index}@example.org`, subject: `Topic ${index}`, message: index === 13 ? "literal 100%_ marker" : `Body ${index}` }))).status, 201);
  const first = await list(); assert.deepEqual(first.data.pagination, { page: 1, pageSize: 20, total: 27, totalPages: 2 }); assert.equal(first.data.items.length, 20);
  const second = await list("?page=2"); assert.equal(second.data.items.length, 7);
  assert.equal(new Set([...first.data.items, ...second.data.items].map(row => row.id)).size, 27);
  const last = await list("?page=999&pageSize=10"); assert.deepEqual(last.data.pagination, { page: 3, pageSize: 10, total: 27, totalPages: 3 });
  const row = first.data.items[0]; await update(row.id, { status: "resolved", notes: "Done", expectedUpdatedAt: row.updatedAt });
  assert.equal((await list("?status=resolved")).data.pagination.total, 1);
  assert.equal((await list("?status=new")).data.pagination.total, 26);
  const literal = await list(`?search=${encodeURIComponent("100%_")}`); assert.equal(literal.data.pagination.total, 1); assert.equal(literal.data.items[0].subject, "Topic 13");
  assert.equal((await list(`?search=${encodeURIComponent("' OR 1=1 --")}`)).data.pagination.total, 0);
  assert.equal((await list("?search=visitor13%40example.org")).data.pagination.total, 1);
  assert.equal((await list("?status=bogus")).status, 400);
  assert.equal((await list("?status=new&status=resolved")).status, 400);
  assert.equal((await list("?search=one&search=two")).status, 400);
  for (const query of ["?page=-1&pageSize=-1", "?page=NaN&pageSize=Infinity", "?page=1.5&pageSize=0"]) {
    const result = await list(query); assert.equal(result.status, 200); assert.equal(result.data.pagination.page, 1); assert.equal(result.data.pagination.pageSize, 20);
  }
  assert.equal((await list("?pageSize=999999")).data.pagination.pageSize, 100);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 27);
}));

test("SQL and HTML-looking feedback stays inert text and never enters audit metadata", async () => fixture(async ({ database, submit, list, update }) => {
  const text = "<script>alert('xss')</script> '); DROP TABLE users; --";
  await submit(payload({ name: text, subject: text, message: text }));
  let row = (await list()).data.items[0]; assert.equal(row.name, text); assert.equal(row.subject, text); assert.equal(row.message, text);
  const result = await update(row.id, { status: "in_progress", notes: text, expectedUpdatedAt: row.updatedAt });
  assert.equal(result.status, 200); row = result.data.feedback; assert.equal(row.notes, text);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 9);
  const logs = database.prepare("SELECT metadata_json FROM system_logs WHERE action LIKE 'feedback.%'").all();
  assert.ok(!JSON.stringify(logs).includes("script")); assert.ok(!JSON.stringify(logs).includes("visitor@example.org"));
  assert.deepEqual(JSON.parse(logs[1].metadata_json), { previousStatus: "new", status: "in_progress", notesChanged: true });
}));

test("admin updates reject stale versions and invalid status/notes; concurrent edits preserve one winner", async () => fixture(async ({ database, submit, list, update }) => {
  await submit(); const row = (await list()).data.items[0];
  const valid = { status: "in_progress", notes: "Reviewing", expectedUpdatedAt: row.updatedAt };
  for (const changes of [{ status: "deleted" }, { notes: "n".repeat(2001) }, { notes: null }, { notes: "bad\u0000note" }, { expectedUpdatedAt: null }, { expectedUpdatedAt: "tomorrow" }]) assert.equal((await update(row.id, { ...valid, ...changes })).status, 400);
  assert.equal((await update("missing", valid)).data.error, "feedbackNotFound");
  const edits = await Promise.all([update(row.id, valid), update(row.id, { ...valid, status: "resolved", notes: "Other admin" })]);
  assert.deepEqual(edits.map(edit => edit.status).sort(), [200, 409]);
  assert.equal(edits.find(edit => edit.status === 409).data.error, "feedbackConflict");
  const winner = edits.find(edit => edit.status === 200).data.feedback;
  assert.notEqual(winner.updatedAt, row.updatedAt);
  assert.equal((await update(row.id, valid)).status, 409);
  assert.equal((await list()).data.items[0].notes, winner.notes);
  const final = await update(row.id, { status: "resolved", notes: "n".repeat(2000), expectedUpdatedAt: winner.updatedAt }); assert.equal(final.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action = 'feedback.updated'").get().count, 2);
}));

test("public limits resist forwarded-header rotation while independent loopback visitors and safe replays remain usable", async () => fixture(async ({ submit }) => {
  const first = payload(); assert.equal((await submit(first)).status, 201);
  for (let index = 0; index < 4; index += 1) assert.equal((await submit(payload(), { headers: { "X-Forwarded-For": `198.51.100.${index}`, "X-Real-IP": `203.0.113.${index}` } })).status, 201);
  const blocked = await submit(payload(), { headers: { "X-Forwarded-For": "1.1.1.1", "X-Real-IP": "8.8.8.8" } });
  assert.equal(blocked.status, 429); assert.equal(blocked.data.error, "feedbackRateLimited"); assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await submit(first)).status, 200);
  assert.equal((await submit({ ...first, message: "changed" })).status, 409);
  assert.equal((await submit(payload({ email: "another-visitor@example.org" }))).status, 201);
}));

test("verified accounts cannot evade limits by rotating email; email quotas reset after their bounded window", async t => fixture(async ({ submit }) => {
  for (let index = 0; index < 10; index += 1) assert.equal((await submit(payload({ email: `member${index}@example.org` }), { actor: "ordinary" })).status, 201);
  assert.equal((await submit(payload({ email: "member11@example.org" }), { actor: "ordinary" })).status, 429);
  for (let index = 0; index < 5; index += 1) assert.equal((await submit(payload())).status, 201);
  assert.equal((await submit(payload())).status, 429);
  const later = Date.now() + 16 * 60 * 1000;
  t.mock.method(Date, "now", () => later);
  assert.equal((await submit(payload())).status, 201);
}));

test("additive schema and SQLite reopen retain feedback, handling notes, identities and idempotency", async () => fixture(async context => {
  const body = payload(); const created = await context.submit(body, { actor: "ordinary" });
  const row = (await context.list()).data.items[0];
  await context.update(row.id, { status: "resolved", notes: "Follow-up saved", expectedUpdatedAt: row.updatedAt });
  const before = (await context.list()).data.items;
  assert.equal(context.database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 23);
  await context.restart();
  assert.deepEqual((await context.list()).data.items, before);
  const replay = await context.submit(body, { actor: "ordinary" }); assert.equal(replay.status, 200); assert.equal(replay.data.feedback.id, created.data.feedback.id); assert.equal(replay.data.feedback.status, "resolved");
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 9);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM app_equipment_items").get().count, 29);
  context.database.prepare("UPDATE users SET deleted_at = ? WHERE id = 'ordinary'").run(new Date().toISOString());
  const deleted = (await context.list()).data.items[0]; assert.equal(deleted.isGuest, false); assert.ok(deleted.userDeletedAt);
  context.database.prepare("DELETE FROM users WHERE id = 'ordinary'").run();
  const preserved = (await context.list()).data.items[0]; assert.equal(preserved.id, created.data.feedback.id); assert.equal(preserved.isGuest, false); assert.equal(preserved.userId, null); assert.equal(preserved.message, body.message);
}));
