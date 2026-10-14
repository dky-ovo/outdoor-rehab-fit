import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createMysqlApp } from "../src/appMysql.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { ASSISTANT_FAQ_ENTRIES, renderAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { BAILIAN_FAQ_POLICY } from "../src/assistantBailianPolicy.js";

// Local HTTP, synthetic accounts, isolated persistence and injected providers.
// The MySQL-shaped executor exercises production handlers, not a live database.
const question = "Which section lets me replay the clips?";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const completion = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
  reply: "Existing provider response.", recommendations: [], guideReferences: [],
}) } }] };

async function fixture(t, dialect, { selector, configured = true } = {}) {
  const sqlite = createDatabase(":memory:");
  const secret = "synthetic-bailian-http-signing-secret";
  const now = new Date().toISOString();
  const tokens = [0, 1].map(index => {
    const id = `bailian-reader-${index}`;
    sqlite.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "PRIVATE_ACCOUNT_NAME", `+8526970010${index}`, "participant", "PRIVATE_SALT", "PRIVATE_HASH", now, now, now);
    return signToken({ id, profile_role: "participant" }, secret);
  });
  if (configured) sqlite.prepare("UPDATE ai_configuration SET api_key = 'synthetic-private-key', model = 'deepseek-v4-flash' WHERE id = 'default'").run();
  let database = sqlite;
  if (dialect === "mysql") {
    sqlite.exec(`CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, request_json TEXT, result_json TEXT, error_code TEXT, created_at INTEGER, completed_at INTEGER);
      CREATE TABLE account_bookmarks (user_id TEXT, equipment_id TEXT, selected INTEGER, version INTEGER, last_operation TEXT, PRIMARY KEY(user_id,equipment_id));
      CREATE TABLE account_documents (user_id TEXT, collection TEXT, record_id TEXT, value_json TEXT, deleted INTEGER, revision INTEGER, last_operation TEXT, PRIMARY KEY(user_id,collection,record_id));`);
    const clean = sql => sql.replace(/ FOR (?:UPDATE|SHARE)\b/g, "");
    const context = new AsyncLocalStorage();
    let queue = Promise.resolve();
    const execute = async fn => { if (!context.getStore()) await queue; return fn(); };
    database = {
      dialect: "mysql",
      get: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).get(...values)),
      all: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).all(...values)),
      run: (sql, values = []) => execute(() => ({ affectedRows: sqlite.prepare(clean(sql)).run(...values).changes })),
      transaction(fn) {
        const operation = queue.then(async () => {
          sqlite.exec("BEGIN");
          try { const result = await context.run(true, () => fn(database)); sqlite.exec("COMMIT"); return result; }
          catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        });
        queue = operation.catch(() => {});
        return operation;
      },
    };
  }
  let deepSeekCalls = 0;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "outdoor-bailian-http-"));
  const options = { database, jwtSecret: secret, faqSelector: selector,
    equipmentUploadDir: path.join(folder, "equipment"), mediaUploadDir: path.join(folder, "media"),
    deepSeekClientFactory: () => ({ chat: { completions: { create: async () => { deepSeekCalls++; return completion; } } } }),
  };
  const app = dialect === "mysql" ? await createMysqlApp(options) : createApp(options);
  if (app.locals.accountContinuity) await app.locals.accountContinuity.start();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const request = (route, body, { user = 0, signal } = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(user === null ? {} : { authorization: `Bearer ${tokens[user]}` }) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: signal || AbortSignal.timeout(10_000),
  });
  const ask = (body, options) => request("/api/assistant/chat", body, options);
  t.after(async () => {
    await app.locals.accountContinuity?.stop();
    await app.locals.imageRetirement?.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    sqlite.close();
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith("outdoor-bailian-http-"));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { ask, request, sqlite, stats: () => ({ deepSeekCalls }) };
}

for (const dialect of ["sqlite", "mysql"]) {
  test(`${dialect}: unfamiliar navigation uses selected reviewed FAQ, without private context or DeepSeek configuration`, async t => {
    const captured = [];
    const examples = [
      [question, "en", "app-videos"], ["邊個分頁可以重播片段？", "zh", "app-videos"],
      ["I need a look at my past sessions.", "en", "app-records"],
      ["Could you give me a tour of OutdoorFit?", "en", "app-features"],
      ["Let us revise my targets using the last seven days.", "en", "personal-goals"],
    ];
    const selector = async input => { captured.push(input); return { action: "faq", faqId: examples.find(([message]) => message === input.question)[2] }; };
    Object.defineProperty(selector, "model", { value: "test-deployed-model" });
    const env = await fixture(t, dialect, { selector, configured: false });
    for (const [message, locale, faqId] of examples) {
      const response = await env.ask({ message, locale, privateData: "PRIVATE_EXERCISE_LOG", latitude: 22.33, longitude: 114.1,
        history: [{ role: "assistant", content: "PRIVATE_HISTORY_SENTINEL" }], equipment: [{ id: "forged", name: "PRIVATE_FORGED" }] });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.faqId, faqId);
      assert.equal(result.focus, faqId);
      assert.equal(result.evidencePolicy, BAILIAN_FAQ_POLICY);
      assert.equal(result.deepSeekUsed, false);
      assert.equal(result.model, "test-deployed-model");
      assert.equal(result.reply, renderAssistantFaq(ASSISTANT_FAQ_ENTRIES.find(item => item.id === faqId), [], locale, { message }).reply);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|forged/);
    }
    assert.equal(captured.length, examples.length);
    for (const input of captured) {
      assert.deepEqual(Object.keys(input).sort(), ["candidates", "locale", "question", "signal"]);
      assert.doesNotMatch(JSON.stringify(input), /PRIVATE_|latitude|longitude|synthetic-private-key/);
    }
    assert.equal(env.stats().deepSeekCalls, 0);
  });

  test(`${dialect}: auth, images, deterministic FAQs, health and direct guides keep priority`, async t => {
    let calls = 0;
    const env = await fixture(t, dialect, { selector: async () => { calls++; return { action: "faq", faqId: "app-videos" }; } });
    assert.equal((await env.ask({ message: question }, { user: null })).status, 401);
    assert.equal((await env.ask({ message: question, imageData: "data:image/png;base64,private" })).status, 400);
    for (const body of [
      { message: "Where can I find the demonstration videos?", locale: "en" },
      { message: "I have chest pain now", locale: "en" },
      { message: "Which app page treats hypertension?", locale: "en" },
      { message: "How many repetitions does the app recommend?", locale: "en" },
      { message: "Where is the nearest outdoor facility?", locale: "en" },
      { message: "太極揉推器怎樣使用？", locale: "zh" },
      { message: "Tell me more", locale: "en", history: [{ role: "user", content: "How do I use the Tai Chi wheel?" }] },
    ]) {
      const response = await env.ask(body);
      assert.equal(response.status, 200, body.message);
      assert.notEqual((await response.json()).evidencePolicy, BAILIAN_FAQ_POLICY, body.message);
    }
    assert.equal(calls, 0);
  });

  test(`${dialect}: disabled, abstaining, malformed and unavailable selectors preserve the existing provider`, async t => {
    for (const selector of [undefined, async () => ({ action: "clarify", faqId: null }),
      async () => ({ action: "faq", faqId: "back-pain" }),
      async () => ({ action: "faq", faqId: "app-videos", reply: "invented answer" }),
      async () => { throw Error("PRIVATE_PROVIDER_FAILURE"); },
    ]) {
      const env = await fixture(t, dialect, { selector });
      const response = await env.ask({ message: question, locale: "en" });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.reply, "Existing provider response.");
      assert.equal(result.model, "deepseek-v4-flash");
      assert.notEqual(result.evidencePolicy, BAILIAN_FAQ_POLICY);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|invented answer/);
      assert.equal(env.stats().deepSeekCalls, 1);
    }
  });

  test(`${dialect}: disconnected HTTP request cancels the selector and never starts DeepSeek`, async t => {
    let begun, aborted;
    const started = new Promise(resolve => { begun = resolve; });
    const stopped = new Promise(resolve => { aborted = resolve; });
    const env = await fixture(t, dialect, { selector: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => { aborted(); reject(signal.reason); }, { once: true });
      begun();
    }) });
    const controller = new AbortController();
    const pending = env.ask({ message: question, locale: "en" }, { signal: controller.signal }).catch(error => error);
    await Promise.race([started, pause(1500).then(() => { throw Error("selector transport did not start"); })]);
    controller.abort();
    await pending;
    await Promise.race([stopped, pause(1500).then(() => { throw Error("selector transport was not cancelled"); })]);
    await pause(20);
    assert.equal(env.stats().deepSeekCalls, 0);
  });
}

test("phone job path uses the same selector, preserves owned results and scrubs queued private input", async t => {
  const captured = [];
  const env = await fixture(t, "mysql", { selector: async input => {
    captured.push(input); return { action: "faq", faqId: "app-videos" };
  } });
  const body = { id: "bailian-phone-job", request: { message: question, locale: "en",
    history: [{ role: "assistant", content: "PRIVATE_HISTORY_SENTINEL" }], privateData: "PRIVATE_LOG",
  } };
  assert.equal((await env.request("/api/assistant/jobs", body)).status, 202);
  assert.equal((await env.request("/api/assistant/jobs", body)).status, 202);
  assert.equal((await env.request("/api/assistant/jobs/bailian-phone-job", null, { user: 1 })).status, 404);
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await env.request("/api/assistant/jobs/bailian-phone-job");
    assert.equal(response.status, 200);
    result = await response.json();
    if (["complete", "failed"].includes(result.status)) break;
    await pause(10);
  }
  assert.equal(result.status, "complete");
  assert.equal(result.result.evidencePolicy, BAILIAN_FAQ_POLICY);
  assert.equal(result.result.focus, "app-videos");
  assert.equal(result.result.deepSeekUsed, false);
  assert.equal(captured.length, 1);
  assert.doesNotMatch(JSON.stringify(captured), /PRIVATE_|history|privateData/);
  assert.equal(env.stats().deepSeekCalls, 0);
  const retained = JSON.parse(env.sqlite.prepare("SELECT request_json FROM assistant_jobs WHERE id = ?").get(body.id).request_json);
  assert.deepEqual(Object.keys(retained), ['runtimeSnapshot']);
  assert.equal(retained.runtimeSnapshot.provider, 'deepseek');
  assert.doesNotMatch(JSON.stringify(retained), /PRIVATE_|apiKey|message|history/);
});
