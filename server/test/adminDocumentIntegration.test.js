import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

async function fixture(run) {
  const database = createDatabase(":memory:"), now = new Date().toISOString(), secret = "admin-document-test-secret", calls = [];
  for (const [index, [id, role, permissions]] of [["ai", "operator", ["admin_assistant.use"]], ["equipment", "operator", ["app_maintenance.equipment.manage"]], ["maintenance", "operator", ["app_maintenance.manage"]], ["admin", "admin", []], ["ordinary", null, []]].entries()) {
    database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,'staff','PRIVATE_PASSWORD_SALT','PRIVATE_PASSWORD_HASH',?,?)").run(id, "PRIVATE_USER_NAME", `+8526123000${index}`, now, now);
    if (role) database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)").run(id, role, JSON.stringify(permissions), now, now);
  }
  database.prepare("UPDATE ai_configuration SET model='deepseek-v4-flash',api_key='PRIVATE_KEY',updated_at=? WHERE id='default'").run(now);
  const server = createApp({ database, jwtSecret: secret, deepSeekClientFactory: ({ apiKey }) => {
    assert.equal(apiKey, "PRIVATE_KEY");
    return { chat: { completions: { create: async body => { calls.push(body); return { choices: [{ message: { content: JSON.stringify({ reply: "可以查阅设施教学并整理草稿。", draft: "", guideReferences: [] }) } }] }; } } } };
  } }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = async (path, { actor = "ai", body, raw, method = "POST", headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${signToken({ id: actor }, secret)}` } : {}), ...headers }, ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body ?? {}) }) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ request, calls, database }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}
const draft = { message: "请查询太极揉推器", history: [], locale: "zh" };

test("dedicated AI permission is independent of equipment and legacy maintenance access", () => fixture(async ({ request, calls }) => {
  for (const actor of [null, "ordinary", "equipment", "maintenance"]) {
    assert.equal((await request("/api/admin/assistant/preview", { actor, body: draft })).status, actor ? 403 : 401);
  }
  const preview = await request("/api/admin/assistant/preview", { body: draft });
  assert.equal(preview.status, 200); assert.equal(calls.length, 0);
  assert.equal((await request("/api/admin/assistant/chat", { body: { ...draft, previewToken: preview.body.previewToken } })).status, 200);
  assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls);
  for (const forbidden of ["PRIVATE_USER_NAME", "PRIVATE_PASSWORD", "PRIVATE_KEY", "+8526123000", "permissions_json"]) assert.ok(!sent.includes(forbidden));
  const me = await request("/api/admin/me", { actor: "admin", method: "GET" });
  assert.ok(me.body.admin.permissions.includes("admin_assistant.use"));
}));

test("preview must be bound to request and actor and detected private data never leaves server", () => fixture(async ({ request, calls }) => {
  assert.equal((await request("/api/admin/assistant/preview", { body: { ...draft, documentText: "电话：+85261234567" } })).status, 400);
  const preview = await request("/api/admin/assistant/preview", { body: draft });
  assert.equal((await request("/api/admin/assistant/chat", { actor: "admin", body: { ...draft, previewToken: preview.body.previewToken } })).status, 409);
  assert.equal((await request("/api/admin/assistant/chat", { body: { ...draft, message: "不同问题", previewToken: preview.body.previewToken } })).status, 409);
  assert.equal(calls.length, 0);
}));

test("import upload and confirm enforce equipment permission before parsing or updating", () => fixture(async ({ request, database }) => {
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name='equipment_document_previews'").get());
  for (const actor of [null, "ordinary", "ai"]) for (const path of ["preview", "confirm"]) assert.equal((await request(`/api/admin/equipment/import/${path}`, { actor })).status, actor ? 403 : 401);
  assert.equal((await request("/api/admin/equipment/import/preview", { actor: "equipment", raw: "invalid", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "X-Document-Name": "test.docx" } })).status, 400);
  assert.equal((await request("/api/admin/equipment/import/confirm", { actor: "equipment", body: { actorId: "admin" } })).status, 400);
  assert.equal(database.prepare("SELECT count(*) n FROM equipment_document_commits").get().n, 0);
}));

test("malformed private JSON is handled without reaching the raw-body error logger", () => fixture(async ({ request, calls }) => {
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    assert.equal((await request("/api/admin/assistant/preview", { raw: '{"password":"PRIVATE_MALFORMED"' })).status, 400);
    assert.equal((await request("/api/admin/assistant/preview", { body: { ...draft, documentText: "x".repeat(270000) } })).status, 413);
    assert.equal((await request("/api/admin/equipment/import/confirm", { actor: "equipment", raw: '{"password":"PRIVATE_MALFORMED"' })).status, 400);
    assert.equal(calls.length, 0); assert.deepEqual(logged, []);
  } finally { console.error = original; }
}));

const suppliedDocx = "D:/下载/Exercise Machine Code and Content V24.docx";
test("actual V24 upload previews, confirms selected text, replays safely and exposes protected old-content audit", { skip: !fs.existsSync(suppliedDocx) }, () => fixture(async ({ request, calls, database }) => {
  const before = database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get();
  const preview = await request("/api/admin/equipment/import/preview", { actor: "equipment", raw: fs.readFileSync(suppliedDocx), headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "X-Document-Name": encodeURIComponent("Exercise Machine Code and Content V24.docx") } });
  assert.equal(preview.status, 200); assert.equal(preview.body.canConfirm, true); assert.equal(preview.body.entries.length, 9);
  assert.equal(database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get().care_tip_zh, before.care_tip_zh);
  const field = preview.body.entries.find(entry => entry.id === "0").fields.find(entry => entry.field === "care_tip_zh");
  assert.ok(field.changed && !field.emptySkipped);
  const body = { previewId: preview.body.previewId, idempotencyKey: preview.body.confirmationKey, selections: [{ id: "0", fields: ["care_tip_zh"] }] };
  const saved = await request("/api/admin/equipment/import/confirm", { actor: "equipment", body });
  assert.equal(saved.status, 200); assert.equal(saved.body.fieldCount, 1);
  assert.equal((await request("/api/admin/equipment/import/confirm", { actor: "equipment", body })).body.replayed, true);
  const after = database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get();
  assert.equal(after.care_tip_zh, field.after);
  for (const key of Object.keys(before).filter(key => !["care_tip_zh", "updated_at"].includes(key))) assert.deepEqual(after[key], before[key]);
  const history = await request("/api/admin/equipment/import/history?page=1&pageSize=10", { actor: "equipment", method: "GET" });
  assert.equal(history.status, 200); assert.equal(history.body.total, 1);
  const audit = await request(`/api/admin/equipment/import/history/${body.previewId}`, { actor: "equipment", method: "GET" });
  assert.equal(audit.status, 200); assert.equal(audit.body.changes[0].before, before.care_tip_zh);
  assert.equal((await request(`/api/admin/equipment/import/history/${body.previewId}`, { actor: "ai", method: "GET" })).status, 403);
  assert.equal(calls.length, 0);
}));
