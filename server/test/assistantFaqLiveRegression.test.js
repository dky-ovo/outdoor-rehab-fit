import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assistantFaqAnswer } from "../src/assistantFaq.js";
import { ASSISTANT_FAQ_ENTRIES, renderAssistantFaq, retrieveAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { BUILT_IN_EQUIPMENT_CATALOG } from "../src/equipmentCatalog.js";
import { symptomConcern } from "../src/assistantSymptomEvidence.js";

// The exact 43 account-test questions, including held-out translations and
// named-equipment questions. Expectations come from the Word question intent,
// not the (occasionally wrong) live FAQ ID returned for a paraphrase.
const questions = JSON.parse(fs.readFileSync(new URL("./fixtures/assistantFaqLiveQuestions.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../src/equipmentGuideEvidence.json", import.meta.url), "utf8"));
const catalog = locale => BUILT_IN_EQUIPMENT_CATALOG.map(item => ({ ...item,
  name: locale === "en" ? item.nameEn : item.nameZh, ...evidence[item.id]?.[locale],
}));

test("43 actual account-test questions retain their documented intent with the real catalog in either UI language", () => {
  const failures = [];
  for (const row of questions) for (const locale of ["zh", "en"]) {
    const result = assistantFaqAnswer({ message: row.question, locale, catalog: catalog(locale) });
    if (result?.faqId !== row.expectedFaq) failures.push({ id: row.id, locale, expected: row.expectedFaq, actual: result?.faqId || null });
    if (result) {
      assert.equal(result.deepSeekUsed, false, row.id);
      assert.deepEqual(result.knowledgeReferences, [], row.id);
      assert.doesNotMatch(result.reply, /https?:\/\/|www\.|【列出/, row.id);
      assert.ok(result.recommendations.every(item => catalog(locale).some(current => current.id === item.id)), row.id);
    }
  }
  assert.deepEqual(failures, []);
});

test("a named machine is not an additional painful body part, but real multi-site symptoms stay distinct", () => {
  for (const question of [
    "膝盖痛，太极推手机、扭腰机和踏步机有哪些动作需要小心？",
    "膝痛，用腰背按摩器要注意什麼？",
    "My knee hurts. What precautions apply to a back massage machine?",
  ]) {
    assert.equal(retrieveAssistantFaq(question)?.id, "knee-cautions", question);
    assert.deepEqual(symptomConcern(question)?.targets, ["knee"], question);
  }
  for (const question of [
    "膝痛而且腰痛，使用扭腰機要小心什麼？",
    "My knee and back hurt. Can I use the back massage machine?",
  ]) {
    assert.equal(retrieveAssistantFaq(question)?.id || null, question.includes("扭腰機") ? "knee-back-twister" : null, question);
    assert.deepEqual(symptomConcern(question)?.targets, ["knee", "back"], question);
  }
  assert.equal(assistantFaqAnswer({ message: "膝痛，扭腰機可以用嗎？現在胸口不適" })?.recommendations.length, 0);
});

test("Word review omissions are retained in the main answer, not left only behind a generic guide card", () => {
  const coverage = [
    ["back-twister-pain", /休息/, /陪同/, /rest/i, /companion/i],
    ["balance-safety", /頭暈/, /立即停止/, /漫步機/, /dizz/i, /stop/i, /airwalker/i],
    ["weak-legs-falls", /椅背/, /幅度/, /軀幹/, /backrest/i, /range/i, /trunk/i],
    ["exercise-weather", /秋冬|寒冷/, /保暖/, /cold|winter/i, /warm/i],
    ["calf-stretch-alternative", /室內/, /indoor/i],
    ["knee-cautions", /半蹲/, /調整後.*痛/, /轉板/, /蹲|屈膝/, /squat/i, /still hurts|persists/i, /rotating/i],
    ["back-pain", /健騎機/, /拱腰|拗腰/, /避免|暫停/, /rider/i, /arch/i],
    ["wrist-pain", /掌上壓|臂伏撐/, /避免/, /push.up/i, /avoid/i],
    ["app-records", /無法確認.*分享|未能確認.*分享/, /技術支援/, /cannot confirm.*shar/i, /support/i],
  ];
  for (const [id, ...patterns] of coverage) {
    const entry = ASSISTANT_FAQ_ENTRIES.find(item => item.id === id);
    const zh = renderAssistantFaq(entry, catalog("zh"), "zh").faqReplyBase;
    const en = renderAssistantFaq(entry, catalog("en"), "en").faqReplyBase;
    for (const pattern of patterns) assert.match(`${zh}\n${en}`, pattern, id);
  }
});

test("caution-only equipment stays out of recommendation cards while the main answer keeps its warning", () => {
  for (const [id, cautionIds] of [["back-pain", ["9", "14"]], ["wrist-pain", ["7", "14"]]]) {
    for (const locale of ["zh", "en"]) {
      const entry = ASSISTANT_FAQ_ENTRIES.find(item => item.id === id);
      const reply = renderAssistantFaq(entry, catalog(locale), locale);
      for (const guideId of cautionIds) {
        const recommendation = reply.recommendations.find(item => item.id === guideId);
        assert.equal(recommendation, undefined, `${id}/${guideId}`);
      }
      assert.match(reply.reply, /避免|先不要|avoid/i);
      assert.match(reply.reply, id === "back-pain" ? /健騎機|rider/i : /掌上壓|push-ups/i);
      assert.match(reply.reply, /臂伏撐|standing push-ups/i);
      assert.doesNotMatch(reply.reply, /透過進行站式掌上壓訓練，可以增強使用者上肢肌肉的力量/);
    }
  }
  assert.match(renderAssistantFaq(ASSISTANT_FAQ_ENTRIES.find(item => item.id === "back-pain"), catalog("zh")).reply, /三位壓腿/);
});

test("FAQ 15 flags the actual conflicting rope instructions in both languages without picking a technique", () => {
  const entry = ASSISTANT_FAQ_ENTRIES.find(item => item.id === "carer-upper-body");
  for (const locale of ["zh", "en"]) {
    const items = catalog(locale);
    const original = items.find(item => item.id === "20").careTip;
    const answer = renderAssistantFaq(entry, items, locale);
    assert.ok(answer.recommendations.some(item => item.id === "20"), "Keep the equipment entry available");
    assert.match(answer.reply, locale === "en" ? /do not pull on your own.*venue staff or a physiotherapist.*demonstrate/is : /先不要自行拉.*場地人員或治療師示範/);
    assert.doesNotMatch(answer.reply, /不要兩手同時拉繩|不可單手拉繩|avoid pulling with both hands simultaneously|not to use one hand only to pull/i);
    assert.equal(items.find(item => item.id === "20").careTip, original, "The maintained source stays intact");
    assert.match(answer.reply, locale === "en" ? /wheelchair/i : /輪椅/, "Other companion precautions remain available");
  }
});
