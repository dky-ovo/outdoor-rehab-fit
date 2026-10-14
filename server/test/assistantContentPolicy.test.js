import assert from "node:assert/strict";
import test from "node:test";
import { assistantAppText, assistantAppMessage, assistantHasExternalContent, assistantAppOnlyReply } from "../src/assistantContentPolicy.js";
import { assistantFaqAnswer } from "../src/assistantFaq.js";

test("FAQ exact low-back question keeps specific cautions without appending every guide's professional section", () => {
  const catalog = [{ id: "13", name: "目前背部設施", ptTip: "先由治療師評估；獲准後保持緩慢，出現不適立即停止。" },
    { id: "22", name: "目前按摩設施", ptTip: "請先閱讀教學。不要用力壓向疼痛位置。" }];
  const answer = assistantFaqAnswer({ message: "下背痛可以用什么器械", catalog });
  assert.equal(answer.focus, "back-pain");
  assert.equal(answer.deepSeekUsed, false);
  assert.match(answer.reply, /健騎機.*停止.*醫護/);
  assert.match(answer.reply, /拱腰.*避免/);
  assert.match(answer.reply, /雙腿麻痺無力.*立即求醫/);
  assert.equal(answer.reply, answer.faqReplyBase);
  assert.doesNotMatch(answer.reply, /先由治療師評估；獲准後|請先閱讀教學/);
  assert.doesNotMatch(answer.reply, /點擊進入|https?:\/\/|NHS/);
  assert.deepEqual(answer.knowledgeReferences, []);
  assert.ok(answer.recommendations.every(item => item.reason === ""));
});

test("long maintained explanations are omitted whole instead of losing end precautions", () => {
  const answer = assistantFaqAnswer({ message: "下背痛可以用什么器械", catalog: [{ id: "13", name: "背部", ptTip: "原文".repeat(1000) + "不可使用。" }] });
  assert.doesNotMatch(answer.reply, /原文/);
  assert.deepEqual(answer.recommendations.map(item => item.id), ["13"]);
});

test("historical assistant links are removed while user input and separate precautions stay intact", () => {
  const user = { sender: "user", text: "https://example.com 我想了解這段", knowledgeReferences: [{ url: "https://example.com" }] };
  assert.equal(assistantAppMessage(user), user);
  const ai = { sender: "ai", text: "出現不適立即停止。\n\n資料來源：https://example.com\n\n[網站](https://example.com/path)\nwww.example.com", knowledgeReferences: [{ url: "https://example.com" }], recommendations: [{ id: "13", reason: "查看 https://example.com" }] };
  const display = assistantAppMessage(ai);
  assert.match(display.text, /出現不適立即停止/);
  assert.doesNotMatch(JSON.stringify(display), /https?:\/\/|www\./);
  assert.deepEqual(display.knowledgeReferences, []);
  assert.match(ai.text, /https:/);
  assert.equal(assistantAppText("According to NHS, OUTSIDE CLAIM.\n\nA separate APP caution."), "A separate APP caution.");
});

test("outside answers without a URL are detected and fallback facts come from APP catalog only", () => {
  assert.equal(assistantHasExternalContent("According to NHS, take OUTSIDE MEDICATION."), true);
  assert.equal(assistantHasExternalContent("您想了解哪個部位？"), false);
  assert.equal(assistantHasExternalContent("People who use this equipment should read its guide."), false);
  assert.equal(assistantHasExternalContent("WHO recommends OUTSIDE PROSE."), true);
  assert.equal(assistantHasExternalContent("More information at example.org/help"), true);
  assert.equal(assistantAppText("NHS says OUTSIDE CLAIM.\n\nRead the app's complete precautions."), "Read the app's complete precautions.");
  const empty = { sender: "ai", text: "", id: "welcome" };
  assert.equal(assistantAppMessage(empty), empty);
  assert.equal(assistantAppText("People who use it should read the precautions. ".repeat(150)).includes("People who use"), true);
  const text = assistantAppOnlyReply({ question: "鍛煉上肢", intent: { type: "equipment" }, recommendations: [{ id: "x", reason: "UNVERIFIED OUTSIDE PROSE" }], catalog: [{ id: "x", name: "APP NAME", ptTip: "MAINTAINED APP TEXT" }] });
  assert.match(text, /MAINTAINED APP TEXT/);
  assert.doesNotMatch(text, /UNVERIFIED OUTSIDE PROSE/);
});

test("reviewed weekly FAQ keeps its reviewed values without website attribution", () => {
  for (const locale of ["en", "zh"]) {
    const answer = assistantFaqAnswer({ message: "How often should older adults exercise?", catalog: [], locale });
    assert.match(answer.reply, /150–300/);
    assert.doesNotMatch(answer.reply, /WHO|NHS|https?:\/\//);
    assert.equal(assistantHasExternalContent(answer.reply), false);
  }
});
