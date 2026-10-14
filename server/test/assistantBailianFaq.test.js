import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ASSISTANT_FAQ_ENTRIES, renderAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { BAILIAN_FAQ_IDS, BAILIAN_FAQ_POLICY } from "../src/assistantBailianPolicy.js";
import { bailianFaqCandidates, isBailianFaqEligible, tryBailianFaqAnswer } from "../src/assistantBailianFaq.js";
import { createAssistantDeadline } from "../src/assistantDeadline.js";

const question = "Which section lets me replay the clips?";
const base = { question, locale: "en", getCatalog: () => [], intent: { type: "general" } };

test("selector candidates contain only current public canonical questions in training-compatible order", () => {
  for (const locale of ["en", "zh"]) {
    const candidates = bailianFaqCandidates(question, locale);
    assert.deepEqual(candidates.map(item => item.faqId).sort(), [...BAILIAN_FAQ_IDS].sort());
    const hash = id => createHash("sha256").update(`${question}\0${id}`).digest("hex");
    assert.deepEqual(candidates.map(item => hash(item.faqId)), candidates.map(item => hash(item.faqId)).sort());
    for (const candidate of candidates) {
      assert.deepEqual(Object.keys(candidate).sort(), ["faqId", "questions"]);
      assert.deepEqual(candidate.questions, ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === candidate.faqId).questions
        .filter(text => /\p{Script=Han}/u.test(text) === (locale === "zh")));
    }
  }
});

test("selector is disabled by default and bypasses health, quantities, locations, guides and incomplete followups", async () => {
  assert.equal(await tryBailianFaqAnswer(base), null);
  assert.equal(isBailianFaqEligible(base), true);
  assert.equal(isBailianFaqEligible({ question: "邊個分頁可以重播片段？" }), true);
  let calls = 0;
  for (const overrides of [
    { question: "Hello" }, { question: "The app says my knee hurts" },
    { question: "Which app page treats hypertension?" },
    { question: "How many repetitions does the app recommend?" },
    { question: "How much walking should I record in the app?" },
    { intent: { type: "facility" } }, { intent: { type: "equipment" } },
    { intent: { urgent: true } }, { namedEquipment: { id: "1" } },
    { asksForTcm: true }, { guideFollowup: true },
    { question: "Which app section should I use for this?", history: [{ role: "user", content: "My knee hurts" }] },
  ]) {
    assert.equal(await tryBailianFaqAnswer({ ...base, ...overrides, faqSelector: async () => { calls++; } }), null, JSON.stringify(overrides));
  }
  assert.equal(calls, 0);
});

test("selector receives no private context and renders current reviewed answer after reloading catalog", async () => {
  let selected = false, reads = 0, received;
  const selector = async input => { received = input; selected = true; return { action: "faq", faqId: "app-videos" }; };
  Object.defineProperty(selector, "model", { value: "deployed-test-model" });
  const result = await tryBailianFaqAnswer({ ...base, faqSelector: selector,
    history: [{ role: "assistant", content: "PRIVATE_HISTORY" }], privateData: "PRIVATE_LOG", user: { name: "PRIVATE_NAME" },
    getCatalog: () => { assert.equal(selected, true); reads++; return []; },
  });
  assert.deepEqual(Object.keys(received).sort(), ["candidates", "locale", "question", "signal"]);
  assert.ok(received.signal instanceof AbortSignal);
  assert.doesNotMatch(JSON.stringify(received), /PRIVATE_/);
  assert.equal(reads, 1);
  const expected = renderAssistantFaq(ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === "app-videos"), [], "en", { message: question });
  assert.equal(result.reply, expected.reply);
  assert.equal(result.focus, "app-videos");
  assert.equal(result.evidencePolicy, BAILIAN_FAQ_POLICY);
  assert.equal(result.deepSeekUsed, false);
  assert.equal(result.model, "deployed-test-model");
});

test("unfamiliar session, app-tour and recent-target wording reaches each reviewed navigation answer", async () => {
  for (const [message, faqId] of [
    ["I need a look at my past sessions.", "app-records"],
    ["Could you give me a tour of OutdoorFit?", "app-features"],
    ["Let us revise my targets using the last seven days.", "personal-goals"],
  ]) {
    let calls = 0;
    const result = await tryBailianFaqAnswer({ ...base, question: message, faqSelector: async input => {
      calls++;
      assert.equal(input.question, message);
      return { action: "faq", faqId };
    } });
    assert.equal(calls, 1, message);
    assert.equal(result.focus, faqId);
    assert.equal(result.reply, renderAssistantFaq(ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === faqId), [], "en", { message }).reply);
  }
});

test("helper independently rejects extra prose, unexpected keys/IDs and abstentions", async () => {
  let reads = 0;
  for (const selection of [
    null, [], "{\"action\":\"faq\",\"faqId\":\"app-videos\"}",
    { action: "faq", faqId: "app-videos", reply: "untrusted prose" },
    { action: "faq", faqId: "back-pain" }, { action: "faq", faqId: "invented" },
    { action: "clarify", faqId: null }, { action: "clarify", faqId: "app-videos" },
    { action: "faq" }, { action: "faq", faqId: null },
  ]) {
    assert.equal(await tryBailianFaqAnswer({ ...base, faqSelector: async () => selection, getCatalog: () => { reads++; return []; } }), null);
  }
  assert.equal(reads, 0);
  assert.equal(await tryBailianFaqAnswer({ ...base, faqSelector: async () => { throw Error("SECRET_PROVIDER_FAILURE"); } }), null);
});

test("a provider timeout aborts its transport and returns control for the existing fallback", async () => {
  let transportSignal;
  const started = Date.now();
  const result = await tryBailianFaqAnswer({ ...base, faqSelector: ({ signal }) => new Promise((_, reject) => {
    transportSignal = signal;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  assert.equal(result, null);
  assert.equal(transportSignal.aborted, true);
  assert.ok(Date.now() - started < 6000);
});

test("parent cancellation propagates, including after the selector has returned", async () => {
  const parent = new AbortController();
  const cancelled = Error("synthetic cancellation");
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const pending = tryBailianFaqAnswer({ ...base, signal: parent.signal, faqSelector: ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    resolveStarted();
  }) });
  await started;
  parent.abort(cancelled);
  await assert.rejects(pending, error => error === cancelled);
  let calls = 0;
  await assert.rejects(tryBailianFaqAnswer({ ...base, signal: parent.signal, faqSelector: async () => { calls++; } }), error => error === cancelled);
  assert.equal(calls, 0);

  const afterSelection = new AbortController();
  await assert.rejects(tryBailianFaqAnswer({ ...base, signal: afterSelection.signal,
    faqSelector: async () => ({ action: "faq", faqId: "app-videos" }),
    getCatalog: () => { afterSelection.abort(cancelled); return []; },
  }), error => error === cancelled);
});

test("containing job retains unsettled selector work after cancellation", async () => {
  const controller = new AbortController();
  const parent = createAssistantDeadline({ timeoutMs: 5000, signal: controller.signal });
  let release, begun;
  const started = new Promise(resolve => { begun = resolve; });
  const pending = tryBailianFaqAnswer({ ...base, signal: parent.signal, faqSelector: () => new Promise(resolve => {
    release = resolve; begun();
  }) });
  await started;
  controller.abort();
  await assert.rejects(pending);
  let idle = false;
  const drained = parent.whenIdle().then(() => { idle = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(idle, false);
  release({ action: "clarify", faqId: null });
  await drained;
  parent.close();
});
