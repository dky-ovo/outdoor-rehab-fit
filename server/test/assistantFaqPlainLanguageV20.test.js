import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ASSISTANT_FAQ_ENTRIES, renderAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { assistantFaqAnswer } from "../src/assistantFaq.js";
import { assistantAppOnlyReply, assistantRopeCaution } from "../src/assistantContentPolicy.js";
import { BUILT_IN_EQUIPMENT_CATALOG } from "../src/equipmentCatalog.js";

const evidence = JSON.parse(fs.readFileSync(new URL("../src/equipmentGuideEvidence.json", import.meta.url), "utf8"));
const catalog = locale => BUILT_IN_EQUIPMENT_CATALOG.map(item => ({ ...item,
  name: locale === "en" ? item.nameEn : item.nameZh, ...evidence[item.id]?.[locale],
}));
const internal = /\bFAQ\b|knowledge base|published catalog|reviewed (?:guide|source)|知識庫|知识库|供核對|供核对|項目教學|项目教学|資料範圍|资料范围/i;

test("every bilingual FAQ gives a direct, bounded first reply with at most three cards and no internal-source narration", () => {
  for (const entry of ASSISTANT_FAQ_ENTRIES) for (const locale of ["zh", "en"]) {
    const result = renderAssistantFaq(entry, catalog(locale), locale);
    assert.doesNotMatch(result.reply, internal, `${entry.id}/${locale}`);
    assert.ok(result.reply.length > 20 && result.reply.length < (locale === "en" ? 1200 : 600), `${entry.id}/${locale}: ${result.reply.length}`);
    assert.ok(result.recommendations.length <= 3, entry.id);
    assert.ok(result.recommendations.every(item => item.reason === ""), entry.id);
    assert.equal(result.reply, result.faqReplyBase, entry.id);
    assert.doesNotMatch(result.reply, /https?:\/\/|www\.|\bTCM\b|中醫/, entry.id);
  }
});

test("four health questions receive their own practical response instead of the same scope explanation", () => {
  const questions = [
    ["Is arm soreness the day after exercise normal?", /cannot tell.*normal/i, /pain persists/i],
    ["Can I do intense exercise with high blood pressure?", /ask your doctor.*intensity/i, /vigorous/i],
    ["How should I breathe during exercise?", /breathing normally/i, /do not push/i],
    ["How long should I rest between machines?", /rest between/i, /no fixed interval/i],
  ];
  const replies = new Set();
  for (const [message, ...checks] of questions) {
    const result = assistantFaqAnswer({ message, locale: "en", catalog: catalog("en") });
    assert.equal(result?.faqId, "scope-health", message);
    checks.forEach(pattern => assert.match(result.reply, pattern, message));
    assert.doesNotMatch(result.reply, internal);
    assert.doesNotMatch(result.reply, /\d+\s*(?:minutes?|hours?|repetitions?)/i);
    replies.add(result.reply);
  }
  assert.equal(replies.size, 4);
});

test("shorter knee and back replies retain actionable precautions for omitted cards", () => {
  const knee = assistantFaqAnswer({ message: "我有膝蓋痛，有什麼戶外儀器要避免/小心使用？", catalog: catalog("zh") });
  for (const pattern of [/半蹲/, /調整後仍痛/, /快速扭轉/, /踏級及踏步/, /膝頭與腳尖/, /單車.*座高/, /醫護評估/]) assert.match(knee.reply, pattern);
  const back = assistantFaqAnswer({ message: "下背痛可以用什么器械", catalog: catalog("zh") });
  for (const pattern of [/健騎機.*停止/, /臂伏撐.*拱腰.*避免/, /按摩.*扭轉.*伸展/, /雙腿麻痺無力/, /大小便/]) assert.match(back.reply, pattern);
  assert.deepEqual(back.recommendations.map(item => item.id), ["13", "22", "6"]);
  assert.equal(back.reply.split("物理治療師貼士").length, 1);
});

test("conflicting rope wording becomes a clear safe action, never a technique or a made-up repetition count", () => {
  for (const locale of ["zh", "en"]) {
    const result = assistantFaqAnswer({ message: "拉繩器應如何使用，每次應拉多少次？", catalog: catalog(locale), locale });
    assert.ok(result.reply.includes(assistantRopeCaution(locale)));
    assert.doesNotMatch(result.reply, internal);
    assert.doesNotMatch(result.reply, /\d+\s*(?:次|reps|repetitions)|不可單手|不要兩手同時|both hands simultaneously|one hand only/i);
    assert.deepEqual(result.recommendations.map(item => item.id), ["20"]);
  }
});

test("content fallback asks a natural clarification and never dumps many professional sections", () => {
  for (const locale of ["zh", "en"]) {
    assert.doesNotMatch(assistantAppOnlyReply({ question: "unclear", intent: { type: "general" }, locale }), internal);
    const result = assistantAppOnlyReply({ question: "guide", intent: { type: "equipment" }, locale,
      recommendations: [{ id: "a" }, { id: "b" }], catalog: [{ id: "a", name: "First", ptTip: "Complete first section. Stop if painful." }, { id: "b", name: "Second", ptTip: "Unrelated second section." }] });
    assert.match(result, /Complete first section.*Stop if painful/);
    assert.doesNotMatch(result, /Unrelated second section/);
  }
});
