import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

const SECRET = "isolated-feedback-privacy-test-secret";

async function fixture(run) {
  const database = createDatabase(":memory:");
  const now = new Date().toISOString();
  database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('reviewer','Reviewer','+85261230009','staff','test','test',?,?)").run(now, now);
  database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('reviewer','admin','[]',1,?,?)").run(now, now);
  let aiCalls = 0;
  const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => { aiCalls++; throw new Error("Feedback must not invoke AI"); } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const token = signToken({ id: "reviewer", profile_role: "staff" }, SECRET);
  const request = async (path, method = "GET", body, authenticated = false) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ database, request, aiCalls: () => aiCalls }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("contact submissions and internal notes never invoke AI or enter chat/research records", async () => fixture(async ({ database, request, aiCalls }) => {
  const marker = "PRIVATE_FEEDBACK_CONTACT_MARKER";
  const before = {
    messages: database.prepare("SELECT COUNT(*) AS total FROM messages").get().total,
    research: database.prepare("SELECT COUNT(*) AS total FROM research_events").get().total,
  };
  const response = await request("/api/feedback", "POST", { submissionId: crypto.randomUUID(), name: marker, email: "private@example.test", subject: marker, message: marker, locale: "en" });
  assert.equal(response.status, 201);
  const { body: { feedback } } = await request(`/api/admin/feedback/${response.body.feedback.id}`, "GET", undefined, true);
  const updated = await request(`/api/admin/feedback/${feedback.id}`, "PATCH", { status: "in_progress", notes: `${marker}_INTERNAL`, expectedUpdatedAt: feedback.updatedAt }, true);
  assert.equal(updated.status, 200);
  assert.equal(aiCalls(), 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM messages").get().total, before.messages);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM research_events").get().total, before.research);
  const audit = JSON.stringify(database.prepare("SELECT * FROM system_logs WHERE target_type = 'feedback'").all());
  assert.equal(audit.includes(marker), false);
  assert.equal(audit.includes("private@example.test"), false);
}));

test("rejected feedback JSON bypasses the general error logger without exposing supplied contact text", async t => fixture(async ({ request }) => {
  const errorLog = t.mock.method(console, "error", () => {});
  for (const path of ["/api/feedback", "/api/admin/feedback/id"]) {
    const method = path === "/api/feedback" ? "POST" : "PATCH";
    const malformed = await request(path, method, '{"email":"private-malformed@example.test","message":');
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.body, { error: "invalidFeedback" });
    const oversized = await request(path, method, JSON.stringify({ email: "private-large@example.test", message: "private text".repeat(4000) }));
    assert.equal(oversized.status, 413);
    assert.deepEqual(oversized.body, { error: "invalidFeedback" });
  }
  assert.equal(errorLog.mock.callCount(), 0);
}));
