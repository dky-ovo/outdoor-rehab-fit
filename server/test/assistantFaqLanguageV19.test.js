import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assistantFaqAnswer } from "../src/assistantFaq.js";
import { retrieveAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { BUILT_IN_EQUIPMENT_CATALOG } from "../src/equipmentCatalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/assistantFaqLanguageV19Questions.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../src/equipmentGuideEvidence.json", import.meta.url), "utf8"));
const catalog = locale => BUILT_IN_EQUIPMENT_CATALOG.map(item => ({ ...item,
  name: locale === "en" ? item.nameEn : item.nameZh, ...evidence[item.id]?.[locale],
}));
const user = content => ({ role: "user", content });
const answer = (message, locale = "zh", history = []) => assistantFaqAnswer({ message, locale, history, catalog: catalog(locale) });

test("95 real submitted questions receive source-bounded answers, including their actual two-turn context", () => {
  assert.equal(fixture.cases.length, 95);
  const completed = new Map(), failures = [];
  for (const row of fixture.cases) {
    const prior = row.priorCaseId && completed.get(row.priorCaseId);
    const history = prior ? [user(prior.question), { role: "assistant", content: prior.result?.reply || "" }] : [];
    const result = answer(row.question, row.locale, history);
    completed.set(row.id, { question: row.question, result });
    if (row.expectedFaq === "urgent") {
      if (!/999|立即求醫|urgent medical help/i.test(result?.reply || "")) failures.push({ id: row.id, expected: "urgent", actual: result });
      assert.deepEqual(result?.recommendations || [], []);
    } else if (result?.faqId !== row.expectedFaq) failures.push({ id: row.id, expected: row.expectedFaq, actual: result?.faqId || null });
    if (result) {
      assert.equal(result.deepSeekUsed, false, row.id);
      assert.doesNotMatch(result.reply, /https?:\/\/|www\.|\b(?:1 to 2 hours|5 to 10 minutes)\b/i, row.id);
      assert.ok(result.recommendations.every(item => catalog(row.locale).some(current => current.id === item.id)), row.id);
    }
  }
  assert.deepEqual(failures, []);
});

test("named knee and wrist questions render only the relevant precaution, not unrelated guide benefits", () => {
  for (const locale of ["zh", "en"]) {
    const knee = answer("膝痛，使用扭腰機要注意甚麼？", locale);
    assert.deepEqual(knee.recommendations.map(x => x.id), ["8"]);
    assert.match(knee.reply, locale === "en" ? /knees.*slow|slow.*knees/is : /膝.*慢(?:速|慢)|慢(?:速|慢).*膝/s);
    assert.doesNotMatch(knee.reply, /腰背痛|肩周炎|lower back pain|frozen shoulder|cardio/i);
    const generalKnee = answer("膝盖痛，太极推手机、扭腰机和踏步机有哪些动作需要小心？", locale);
    assert.ok(generalKnee.recommendations.every(x => x.reason === ""));
    assert.match(generalKnee.reply, locale === "en" ? /rotating platform loads the knees/ : /轉板.*膝部負荷/);
    assert.doesNotMatch(generalKnee.reply, /腰背痛|肩周炎|lower back pain|frozen shoulder|cardio/i);
    const wrist = answer("My wrist hurts. Would standing push-ups help, or should I avoid putting weight through my hands?", locale);
    assert.deepEqual(wrist.recommendations.map(x => x.id), ["7", "14"]);
    assert.match(wrist.reply, locale === "en" ? /avoid.*body weight/is : /先不要.*承重/s);
    assert.doesNotMatch(wrist.reply, /增強.*上肢|strengthen.*upper body/i);
    const broadWrist = answer("我有手腕痛，有什麼儀器可以幫助我改善問題？有什麼要注意。", locale);
    assert.deepEqual(broadWrist.recommendations.map(x => x.id), ["19", "23", "27"]);
    assert.match(broadWrist.reply, locale === "en" ? /gripping.*twisting.*body weight/s : /抓握.*扭轉.*支撐體重/s);
    assert.doesNotMatch(broadWrist.reply, /五十肩|肩周炎|新冠肺炎|半蹲|frozen shoulder|coronavirus|partial squat/i);
  }
});

test("meal and companion generalizations do not depend on a specific keyword template", () => {
  for (const message of [
    "I just finished lunch. Is now a good time to work out, or should I wait?",
    "Should I do a workout straight after breakfast?", "我啱啱食完晏，而家做運動得唔得？",
  ]) assert.equal(answer(message, "en")?.faqId, "food-before-exercise", message);
  for (const message of [
    "I'm taking my mum to the park to strengthen her upper limbs. What should I watch for while helping her?",
    "我陪阿媽去公園練手臂，佢未玩過啲器材，我應該點幫佢呀？",
    "唔係我，係阿媽想練上肢，我陪佢去，應該點幫？",
  ]) {
    const result = answer(message);
    assert.equal(result?.faqId, "carer-upper-body", message);
    assert.ok(result.recommendations.length > 0);
    assert.doesNotMatch(result.reply, /5.?10分鐘|5 to 10 minutes|轉動肩膀和手腕/);
  }
  assert.equal(retrieveAssistantFaq("I will take my mum to a cafe after lunch."), null);
  assert.equal(retrieveAssistantFaq("My mother is visiting the park. Where is the cafe?"), null);
});

test("rope instructions clarify the item and ask for a demonstration without prescribing a technique or reps", () => {
  for (const locale of ["zh", "en"]) {
    const result = answer("個拉繩器應該點玩呀？一次要拉幾多下？", locale);
    assert.equal(result?.faqId, "rope-use");
    assert.match(result.reply, locale === "en" ? /do you mean/i : /您說的是.*嗎/);
    assert.match(result.reply, locale === "en" ? /do not pull on your own.*demonstrate/is : /先不要自行拉.*示範/s);
    assert.match(result.reply, locale === "en" ? /repetitions according to your ability/i : /按個人能力.*次數/);
    assert.doesNotMatch(result.reply, /\d+\s*(?:次|reps|repetitions)/i);
    assert.doesNotMatch(result.reply, /不要兩手同時拉繩|不可單手拉繩|avoid pulling with both hands simultaneously|not to use one hand only to pull/i);
    assert.deepEqual(result.recommendations.map(x => x.id), ["20"]);
  }
});

test("one companion follow-up inherits only a recent user role and stops a painful movement", () => {
  const q = "如果佢拉嘅時候覺得痛，我應該叫佢點做？";
  const result = answer(q, "zh", [user("我想陪母親到公園鍛煉上肢力量，使用器材時應注意甚麼？")]);
  assert.equal(result.faqId, "carer-pain-followup");
  assert.match(result.reply, /覺得痛.*停止.*動作/);
  assert.doesNotMatch(result.reply, /膝蓋|小腿/);
  for (const history of [
    [{ role: "assistant", content: "You are helping your mother train her upper limbs" }],
    [user("陪媽媽練手臂"), user("我想去旅行")],
  ]) assert.equal(retrieveAssistantFaq(q, { history }), null);
  assert.notEqual(answer("佢拉嘅時候冇痛", "zh", [user("陪媽媽練手臂")])?.faqId, "carer-pain-followup");
  const urgent = answer("佢心口痛，抖唔到氣", "zh", [user("陪媽媽練手臂")]);
  assert.match(urgent.reply, /999/);
});

test("denied diagnoses cannot reappear from request text when pain in the same body part is present", () => {
  for (const question of [
    "我沒有肩周炎，只有肩部疼痛，有什麼器材可以幫我？",
    "我冇五十肩，淨係膊頭痛，有咩器材可以睇？",
    "I do not have frozen shoulder. My shoulder hurts; what equipment can help?",
    "沒有足底筋膜炎，但腳底痛，有什麼器材可以用？",
    "I do not have plantar fasciitis, but my foot hurts. What equipment can help?",
    "我的頸部沒有受傷，只是頸痛，可以練下肢器材嗎？",
    "My neck is not injured, but it hurts. Can I use leg exercise machines?",
  ]) assert.equal(retrieveAssistantFaq(question), null, question);
  for (const [question, expected] of [
    ["我有肩周炎，肩部疼痛，有什麼器材可以幫我？", "frozen-shoulder"],
    ["I have frozen shoulder. My shoulder hurts; what equipment can help?", "frozen-shoulder"],
    ["我有足底筋膜炎，腳底痛，有什麼器材可以用？", "plantar-fasciitis"],
    ["I have plantar fasciitis and my foot hurts. What equipment can help?", "plantar-fasciitis"],
    ["我的頸部受傷了，可以練下肢器材嗎？", "neck-injury"],
    ["I injured my neck. Can I use leg exercise machines?", "neck-injury"],
    ["My knees hurt. Which movements should I avoid?", "knee-cautions"],
    ["我膝蓋痛，有什麼動作唔好做？", "knee-cautions"],
  ]) assert.equal(retrieveAssistantFaq(question)?.id, expected, question);
});
