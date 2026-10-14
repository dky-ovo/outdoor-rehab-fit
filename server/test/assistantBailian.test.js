import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BAILIAN_SELECTOR_SYSTEM_PROMPT, BAILIAN_SELECTOR_INSTRUCTION, createBailianFaqSelector, readBailianConfig, parseBailianSelection, singaporeCompletionUrl } from "../src/assistantBailian.js";

const env = { BAILIAN_FAQ_ENABLED: "true", BAILIAN_MODEL_ID: "qwen3-14b-test-deployment", DASHSCOPE_API_KEY: "unit-test-key" };
const input = { question: "Which tab keeps my activity diary?", locale: "en", candidates: [{ faqId: "app-records", questions: ["Where are my activity records?"] }] };
const response = (content = '{"action":"faq","faqId":"app-records"}', overrides = {}) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content }, ...overrides }] }) });

test("disabled integration neither needs credentials nor makes a request", () => {
  for (const value of [undefined, "false", "TRUE", "1"]) {
    assert.equal(createBailianFaqSelector({ BAILIAN_FAQ_ENABLED: value }, { fetchImpl: () => assert.fail("network") }), null);
  }
  assert.throws(() => readBailianConfig({ BAILIAN_FAQ_ENABLED: "true" }), /BAILIAN_API_KEY_REQUIRED/);
  assert.throws(() => readBailianConfig({ ...env, BAILIAN_MODEL_ID: "" }), /BAILIAN_MODEL_ID_REQUIRED/);
});

test("credentials are restricted to Singapore HTTPS endpoints, with no redirects", () => {
  assert.equal(singaporeCompletionUrl("https://workspace123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/").pathname, "/compatible-mode/v1/chat/completions");
  const base = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  for (const url of [base.replace("https:", "http:"), base.replace("-intl", ""), base + "?key=secret", base + "#secret", base + "/chat/completions", base.replace(".com/", ".com.evil.test/"), base.replace("https://", "https://user:pass@"), base.replace(".com/", ".com:8080/")]) {
    assert.throws(() => singaporeCompletionUrl(url), /BAILIAN_BASE_URL_INVALID/);
  }
});

test("runtime prompt matches fine-tuning, and the request projects only public candidate fields", async () => {
  const policy = JSON.parse(await readFile(new URL("../../models/outdoorfit-assistant/policy.json", import.meta.url), "utf8"));
  const { SELECTOR_INSTRUCTION } = await import("../../models/outdoorfit-assistant/selector.mjs");
  assert.equal(BAILIAN_SELECTOR_SYSTEM_PROMPT, policy.selectorSystemPrompt);
  assert.equal(BAILIAN_SELECTOR_INSTRUCTION, SELECTOR_INSTRUCTION);
  let calls = 0;
  const select = createBailianFaqSelector(env, { fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url.hostname, "dashscope-intl.aliyuncs.com");
    assert.equal(options.headers.authorization, "Bearer unit-test-key");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.includes("private-sentinel"), false);
    assert.equal(options.body.includes(env.DASHSCOPE_API_KEY), false);
    const body = JSON.parse(options.body);
    assert.equal(body.model, env.BAILIAN_MODEL_ID);
    assert.equal(body.enable_thinking, false);
    assert.equal(body.max_tokens, 96);
    assert.equal(body.stream, false);
    for (const key of ["response_format", "thinking", "reasoning_effort", "chat_template_kwargs"]) assert.equal(key in body, false);
    assert.deepEqual(JSON.parse(body.messages[1].content.slice(BAILIAN_SELECTOR_INSTRUCTION.length + 1)), input);
    return response();
  } });
  const result = await select({ ...input, history: [{ content: "private-sentinel" }], location: "private-sentinel", candidates: input.candidates.map(item => ({ ...item, private: "private-sentinel" })) });
  assert.deepEqual(result, { action: "faq", faqId: "app-records" });
  assert.equal(select.model, env.BAILIAN_MODEL_ID);
  assert.equal(calls, 1);
});

test("only exact selection JSON for supplied navigation candidates is accepted", () => {
  assert.deepEqual(parseBailianSelection('{"action":"clarify","faqId":null}', input.candidates), { action: "clarify", faqId: null });
  for (const value of ["null", "[]", '"hello"', "```json\n{}\n```", '{"action":"faq","faqId":"app-videos"}', '{"action":"faq","faqId":"neck-injury"}', '{"action":"clarify","faqId":"app-records"}', '{"action":"faq","faqId":"app-records","reply":"unreviewed text"}', '{"action":"answer","faqId":null}', "x".repeat(2049)]) {
    assert.throws(() => parseBailianSelection(value, input.candidates), /BAILIAN_INVALID_SELECTION/);
  }
});

test("truncation, tool requests, bad JSON and provider errors fall back with sanitized errors and no retries", async () => {
  for (const fetchImpl of [
    async () => response(undefined, { finish_reason: "length" }),
    async () => response(undefined, { message: { content: '{"action":"faq","faqId":"app-records"}', tool_calls: [{}] } }),
    async () => response("untrusted provider text"),
    async () => ({ ok: false, status: 401, json: () => assert.fail("must not read error body") }),
    async () => { throw new Error(env.DASHSCOPE_API_KEY); },
  ]) {
    let count = 0;
    const select = createBailianFaqSelector(env, { fetchImpl: (...args) => { count += 1; return fetchImpl(...args); } });
    await assert.rejects(select(input), error => error.message === "BAILIAN_UNAVAILABLE" && !JSON.stringify(error).includes(env.DASHSCOPE_API_KEY));
    assert.equal(count, 1);
  }
});

test("timeout bounds even a transport that ignores cancellation, and signals the transport", async () => {
  let signal;
  const select = createBailianFaqSelector(env, { timeoutMs: 15, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(select(input), /BAILIAN_UNAVAILABLE/);
  assert.equal(signal.aborted, true);
});

test("cancellation prevents a new request and aborts an in-flight transport", async () => {
  const already = new AbortController(); already.abort();
  let calls = 0;
  const select = createBailianFaqSelector(env, { fetchImpl: async () => { calls += 1; return response(); } });
  await assert.rejects(select({ ...input, signal: already.signal }), /BAILIAN_UNAVAILABLE/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  let transportSignal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const running = createBailianFaqSelector(env, { fetchImpl: (_url, options) => {
    transportSignal = options.signal;
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true }));
  } })({ ...input, signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(running, /BAILIAN_UNAVAILABLE/);
  assert.equal(transportSignal.aborted, true);
});

test("overlong questions, unsupported locale and malformed candidates never leave the server", async () => {
  const select = createBailianFaqSelector(env, { fetchImpl: () => assert.fail("network") });
  for (const value of [
    { ...input, question: "x".repeat(1201) }, { ...input, locale: "other" },
    { ...input, candidates: [{ faqId: "neck-injury", questions: ["neck pain"] }] },
    { ...input, candidates: [] }, { ...input, candidates: [...input.candidates, ...input.candidates] },
  ]) await assert.rejects(select(value), /BAILIAN_INVALID_INPUT/);
});

test("operator diagnostic uses the same deployment and returns only bounded public status", async () => {
  const { checkBailian } = await import("../src/checkBailian.js");
  const result = await checkBailian(env, { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const data = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
    assert.equal(data.candidates.length, 4);
    assert.equal(data.question, "Which section lets me replay the clips?");
    return response('{"action":"faq","faqId":"app-videos"}');
  } });
  assert.equal(result.ok, true);
  assert.equal(result.model, env.BAILIAN_MODEL_ID);
  assert.deepEqual(result.selection, { action: "faq", faqId: "app-videos" });
  assert.equal(JSON.stringify(result).includes(env.DASHSCOPE_API_KEY), false);
  await assert.rejects(checkBailian({}), /BAILIAN_FAQ_DISABLED/);
});
