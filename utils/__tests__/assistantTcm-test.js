import fs from "node:fs";
import path from "node:path";
import { equipmentTcmExcerpt, withEquipmentTcm, withEquipmentTcmReply } from "../assistantTcm";

const { generateEvidenceCatalog } = require("../../scripts/generate-assistant-evidence-catalog.cjs");
const original = generateEvidenceCatalog();
const catalog = locale => Object.entries(original).map(([id, value]) => ({ id, ...value[locale] }));
const tip = text => ({ id: "19", tcmEnabled: true, tcmTip: text });

test("client and server TCM extractors remain byte-for-byte identical", () => {
  expect(fs.readFileSync(path.resolve(__dirname, "../assistantTcm.js"), "utf8"))
    .toBe(fs.readFileSync(path.resolve(__dirname, "../../server/src/assistantTcm.js"), "utf8"));
});

test.each(["zh", "en"])("uses only actual enabled %s APP prose, keeping every excerpt verbatim and bounded", locale => {
  const items = catalog(locale);
  const expected = ["0", "4", "6", "8", "10", "16", "19", "20", "22", ...(locale === "zh" ? ["28"] : [])];
  expect(items.filter(item => equipmentTcmExcerpt(item, locale)).map(item => item.id)).toEqual(expected);
  for (const item of items) {
    const excerpt = equipmentTcmExcerpt(item, locale);
    if (!excerpt) continue;
    expect(excerpt.field).toBe("tcmTip");
    expect(item.tcmTip).toContain(excerpt.quote);
    expect([...excerpt.quote].length).toBeLessThanOrEqual(locale === "en" ? 550 : 220);
    expect(excerpt.quote).not.toMatch(/首選|首选|第一選擇|first.choice|barefoot|赤腳|治癒|治愈/i);
  }
});

test("shoulder stretch keeps the V24 meridian paragraph, not the first-choice claim", () => {
  const zh = equipmentTcmExcerpt({ ...original["19"].zh }, "zh");
  expect(zh.quote).toBe(original["19"].zh.tcmTip.split("\n\n")[0]);
  expect(zh.quote).toContain("可以疏通手部經脈");
  expect(zh.quote).not.toContain("首選");
  const en = equipmentTcmExcerpt({ ...original["19"].en }, "en");
  expect(en.quote).toBe(original["19"].en.tcmTip.split("\n\n")[0]);
  expect(en.quote).not.toMatch(/首選|first choice|frozen shoulder/);
});

test("Foot Massage Path only adds Chinese background, never barefoot instructions or an English translation", () => {
  const zh = equipmentTcmExcerpt(original["28"].zh);
  expect(zh.quote).toBe("足底是下肢經絡的交匯處，聯通人體的五臟六腑，分佈著全身臟腑的多個反射區。");
  expect(zh.quote).not.toContain("赤腳");
  expect(equipmentTcmExcerpt(original["28"].en, "en")).toBeNull();
  expect(equipmentTcmExcerpt({ tcmEnabled: true, tcmTip: "", tcmZh: original["28"].zh.tcmTip }, "en")).toBeNull();
});

test.each([
  { tcmEnabled: false }, { tcmEnabled: undefined }, { tcmEnabled: 1 },
  { tcmTip: "" }, { tcmTip: " \n " }, { tcmTip: null }, { isActive: false },
  { deletedAt: "2026-09-16" }, { deleted_at: "2026-09-16" },
])("omits hidden, absent and unpublished TCM prose: %p", changes => {
  expect(equipmentTcmExcerpt({ ...tip("這是APP的中醫說明。"), ...changes })).toBeNull();
});

test("caps by whole sentences rather than truncating a longer sentence", () => {
  expect(equipmentTcmExcerpt(tip(`${"伸".repeat(221)}。`))).toBeNull();
  expect(equipmentTcmExcerpt(tip(`${"s".repeat(551)}.`), "en")).toBeNull();
  expect(equipmentTcmExcerpt(tip(`第一句完整。${"伸".repeat(221)}。`)).quote).toBe("第一句完整。");
  expect(equipmentTcmExcerpt(tip("第一句。第二句。第三句。"))).toEqual({ field: "tcmTip", quote: "第一句。第二句。" });
  expect(equipmentTcmExcerpt(tip("First sentence. Second sentence. Third sentence."), "en").quote).toBe("First sentence. Second sentence.");
});

test.each([
  "本器材是治療的首選。", "这是最佳器材。", "This is the first choice.", "This is the best treatment.",
  "這個動作可以治癒疾病。", "This cures your illness.", "赤腳行走刺激穴位。", "Walk barefoot on the path.",
  "服用中藥。", "使用針灸。", "Take the prescribed medication.", "Use a dosage of 20 mg.",
  "這是優先使用的器材。", "This is a first-line treatment.", "使用10克藥材。",
  "使用10.5克藥材。", "Take 10.5 mg with water.",
])("does not reproduce ranking, cure or treatment instructions: %s", text => {
  expect(equipmentTcmExcerpt(tip(text), /[A-Za-z]/.test(text) ? "en" : "zh")).toBeNull();
});

test.each([
  "這個動作可以舒緩不適。疼痛時應停止使用。", "這個動作可以舒緩不適。但以下人士不建議使用。",
  "此運動不能舒緩疼痛。", "沒有證據證明可以減輕疼痛。",
  "This may ease discomfort. Avoid it if you have pain.", "This may ease discomfort. It is not suitable for everyone.",
])("does not detach the benefit from a warning or negation: %s", text => {
  expect(equipmentTcmExcerpt(tip(text), /[A-Za-z]/.test(text) ? "en" : "zh")).toBeNull();
});

test("retains qualifying conditions in the original sentence and never selects a later dependent sentence alone", () => {
  const condition = "對於氣虛、腎虛之體，下肢容易失於溫煦。持之以恆練習小腿伸展的動作，可以預防下肢退化。";
  expect(equipmentTcmExcerpt(tip(condition)).quote).toBe(condition);
  expect(equipmentTcmExcerpt(tip("赤腳行走刺激穴位。這樣能使人放鬆。"))).toBeNull();
  expect(equipmentTcmExcerpt(tip("這可以紓緩不適。這可以放鬆。只適用於已獲專業評估的人士。"))).toBeNull();
  expect(equipmentTcmExcerpt(tip("This may ease discomfort. This may relax muscles. Only for people already assessed."), "en")).toBeNull();
});

test("recomputes TCM from the trusted catalog without changing identities, order or source metadata", () => {
  const recommendations = [
    { id: "19", name: "original name", reason: "original reason", source: "app_content", evidence: { field: "ptTip", quote: "original evidence" }, tcmExcerpt: { field: "tcmTip", quote: "injected cure" } },
    { id: 0, source: "app_content", tcmExcerpt: { quote: "injected" } },
    { id: "missing", source: "app_content", tcmExcerpt: { quote: "invented" } },
  ];
  const before = JSON.stringify(recommendations), trusted = catalog("zh"), beforeCatalog = JSON.stringify(trusted);
  const result = withEquipmentTcm(recommendations, trusted);
  expect(result.map(item => item.id)).toEqual(["19", 0, "missing"]);
  for (let index = 0; index < result.length; index += 1) {
    const { tcmExcerpt: ignoredOriginal, ...identity } = recommendations[index];
    const { tcmExcerpt: ignoredResult, ...actualIdentity } = result[index];
    expect(actualIdentity).toEqual(identity);
  }
  expect(result[0].tcmExcerpt).toEqual(equipmentTcmExcerpt(trusted.find(item => item.id === "19")));
  expect(result[2]).not.toHaveProperty("tcmExcerpt");
  expect(JSON.stringify(recommendations)).toBe(before);
  expect(JSON.stringify(trusted)).toBe(beforeCatalog);
});

test("never duplicates TCM evidence, adds cards, or uses recommendation-injected prose", () => {
  const evidence = { field: "tcmTip", quote: "already displayed" };
  const recommendations = [{ id: "19", evidence, tcmEnabled: true, tcmTip: "injected", tcmExcerpt: { quote: "old" } }];
  const result = withEquipmentTcm(recommendations, catalog("zh"));
  expect(result).toHaveLength(1);
  expect(result[0].evidence).toBe(evidence);
  expect(result[0]).not.toHaveProperty("tcmExcerpt");
  expect(withEquipmentTcm([{ id: "unknown", tcmEnabled: true, tcmTip: "forged" }], catalog("zh"))[0]).not.toHaveProperty("tcmExcerpt");
  expect(withEquipmentTcm([], catalog("zh"))).toEqual([]);
  expect(withEquipmentTcm([{ id: "19", tcmExcerpt: { quote: "forged" } }], [])).toEqual([{ id: "19" }]);
});

test("disabled overrides and ambiguous catalog IDs cannot re-enable a recommendation excerpt", () => {
  const enabled = { id: "19", ...original["19"].zh }, disabled = { ...enabled, tcmEnabled: false };
  const recommendations = [{ id: "19", tcmExcerpt: { quote: "injected" } }];
  expect(withEquipmentTcm(recommendations, [disabled])).toEqual([{ id: "19" }]);
  expect(withEquipmentTcm(recommendations, [enabled, disabled, enabled])).toEqual([{ id: "19" }]);
});

const namedCatalog = locale => catalog(locale).map(item => ({ ...item, name: locale === "en" ? `Facility ${item.id}` : `設施${item.id}` }));
const bodyAnswer = (ids = ["19"], extra = {}) => ({ reply: "Original APP answer.", action: "equipment", source: "app_content", recommendations: ids.map(id => ({ id, name: "Old name", reason: "Existing reason" })), ...extra });

test.each(["zh", "en"])("appends trustworthy %s TCM to the answer body and is strictly idempotent", locale => {
  const items = namedCatalog(locale), answer = bodyAnswer(["19", "4"]);
  const before = JSON.stringify(answer), beforeCatalog = JSON.stringify(items);
  const result = withEquipmentTcmReply(answer, items, locale);
  expect(result.reply.startsWith(answer.reply)).toBe(true);
  expect(result.reply).toContain(locale === "en" ? "From a TCM perspective (APP excerpt)" : "從中醫學角度（APP原文）");
  for (const id of ["19", "4"]) {
    const item = items.find(value => value.id === id), excerpt = equipmentTcmExcerpt(item, locale);
    expect(result.reply).toContain(`${item.name}\n`);
    expect(result.reply.split(excerpt.quote)).toHaveLength(2);
  }
  expect(result.tcmInReply).not.toBe(true);
  expect(result.equipmentReplyVersion).toBe("app-equipment-prose-v1");
  expect(result.equipmentReplyBase).toBe(answer.reply);
  expect(withEquipmentTcmReply(result, items, locale)).toEqual(result);
  expect(result.recommendations.map(item => item.id)).toEqual(["19", "4"]);
  expect(result.source).toBe(answer.source);
  expect(JSON.stringify(answer)).toBe(before);
  expect(JSON.stringify(items)).toBe(beforeCatalog);
});

test.each(["zh", "en"])("places each validated %s evidence passage before that facility's TCM", locale => {
  const items = namedCatalog(locale), quote = original["19"][locale].ptTip.split(". ")[0];
  const answer = bodyAnswer(["19"], { action: "equipment_evidence" });
  answer.recommendations[0].evidence = { field: "ptTip", quote, targets: ["shoulder"] };
  const result = withEquipmentTcmReply(answer, items, locale), excerpt = result.recommendations[0].tcmExcerpt.quote;
  expect(result.reply).toContain(quote);
  expect(result.reply.indexOf(quote)).toBeLessThan(result.reply.indexOf(excerpt));
  expect(result.recommendations[0].evidence).toEqual(answer.recommendations[0].evidence);
});

test("rebuilds historical appended prose after renaming, editing or disabling TCM, including when no body remains", () => {
  const items = namedCatalog("zh"), result = withEquipmentTcmReply(bodyAnswer(), items);
  const oldQuote = result.recommendations[0].tcmExcerpt.quote;
  const renamed = items.map(item => item.id === "19" ? { ...item, name: "新名稱", tcmTip: "更新的肩部原文：配合自然呼吸。" } : item);
  const edited = withEquipmentTcmReply(result, renamed);
  expect(edited.reply).toContain("新名稱\n");
  expect(edited.reply).toContain("更新的肩部原文：配合自然呼吸。");
  expect(edited.reply).not.toContain(oldQuote);
  expect(edited.reply).not.toContain("設施19");
  const disabled = withEquipmentTcmReply(edited, renamed.map(item => ({ ...item, tcmEnabled: false })));
  expect(disabled.reply).toBe(result.equipmentReplyBase);
  expect(disabled.recommendations[0]).not.toHaveProperty("tcmExcerpt");
  expect(withEquipmentTcmReply(result, []).reply).toBe(result.equipmentReplyBase);
  expect(withEquipmentTcmReply(result, []).recommendations).toEqual([]);
});

test.each([{ isActive: false }, { deletedAt: "2026-09-16" }, { deleted_at: "2026-09-16" }])("removes unpublished facilities and their appended prose from history: %p", changes => {
  const items = namedCatalog("zh"), result = withEquipmentTcmReply(bodyAnswer(), items);
  const hidden = withEquipmentTcmReply(result, items.map(item => item.id === "19" ? { ...item, ...changes } : item));
  expect(hidden.reply).toBe(result.equipmentReplyBase);
  expect(hidden.recommendations).toEqual([]);
});

test("missing English TCM never borrows Chinese and original replies remain unchanged", () => {
  const answer = bodyAnswer(["28"]), result = withEquipmentTcmReply(answer, namedCatalog("en"), "en");
  expect(result.reply).toBe(answer.reply);
  expect(result.recommendations[0]).not.toHaveProperty("tcmExcerpt");
  expect(result.reply).not.toContain(original["28"].zh.tcmTip.slice(0, 12));
});

test("the dedicated direct-TCM answer is returned unchanged without a second excerpt", () => {
  const answer = bodyAnswer(["19"], { tcmInReply: true, reply: "Direct original answer already contains TCM." });
  expect(withEquipmentTcmReply(answer, namedCatalog("zh"))).toBe(answer);
  expect(answer).not.toHaveProperty("equipmentReplyVersion");
});

test.each([
  { confirmationRequired: true }, { confirmationRequired: true, confirmationAnswered: "no" },
  { confirmationAnswered: "no" }, { action: "facility" }, { action: "auth_error" },
  { action: "error" }, { action: "image_confirmation", confirmationAnswered: "yes" },
])("does not append to blocked actions or unconfirmed/rejected photographs: %p", state => {
  const answer = bodyAnswer(["19"], state), result = withEquipmentTcmReply(answer, namedCatalog("zh"));
  expect(result.reply).toBe(answer.reply);
  const previouslyAppended = withEquipmentTcmReply(bodyAnswer(), namedCatalog("zh"));
  expect(withEquipmentTcmReply({ ...previouslyAppended, ...state }, namedCatalog("zh")).reply).toBe(previouslyAppended.equipmentReplyBase);
});

test("confirmed photo equipment may receive body prose without changing its confirmation state", () => {
  const answer = bodyAnswer(["19"], { confirmationRequired: true, confirmationAnswered: "yes" });
  const result = withEquipmentTcmReply(answer, namedCatalog("zh"));
  expect(result.reply).toContain("從中醫學角度");
  expect(result.confirmationRequired).toBe(true);
  expect(result.confirmationAnswered).toBe("yes");
});

test("TCM as the validated primary evidence appears once and disappears when disabled", () => {
  const items = namedCatalog("zh"), item = items.find(value => value.id === "19"), quote = equipmentTcmExcerpt(item).quote;
  const answer = bodyAnswer(["19"], { action: "equipment_evidence" });
  answer.recommendations[0].evidence = { field: "tcmTip", quote };
  const result = withEquipmentTcmReply(answer, items);
  expect(result.reply.split(quote)).toHaveLength(2);
  expect(result.recommendations[0]).not.toHaveProperty("tcmExcerpt");
  const disabled = withEquipmentTcmReply(result, items.map(value => ({ ...value, tcmEnabled: false })));
  expect(disabled.reply).toBe(result.equipmentReplyBase);
  expect(disabled.recommendations[0]).not.toHaveProperty("evidence");
});

test("ignores injected or stale excerpts/evidence and preserves the order of valid unique IDs", () => {
  const items = namedCatalog("zh"), answer = bodyAnswer(["19", "missing", 4, "19", "4", "11"], { action: "equipment_evidence" });
  for (const recommendation of answer.recommendations) {
    recommendation.tcmExcerpt = { field: "tcmTip", quote: "FORGED_TCM" };
    recommendation.evidence = { field: "ptTip", quote: "FORGED_EVIDENCE" };
  }
  const result = withEquipmentTcmReply(answer, items);
  expect(result.recommendations.map(item => item.id)).toEqual(["19", 4, "11"]);
  expect(result.reply).not.toContain("FORGED");
  expect(result.recommendations.every(item => !item.evidence)).toBe(true);
  expect(result.recommendations.every(item => !Object.hasOwn(item, "reason"))).toBe(true);
  const edited = items.map(item => ({ ...item, ptTip: "Changed authoritative field" }));
  const stale = bodyAnswer(["19"], { action: "equipment_evidence" });
  stale.recommendations[0].evidence = { field: "ptTip", quote: original["19"].zh.ptTip };
  expect(withEquipmentTcmReply(stale, edited).reply).not.toContain(original["19"].zh.ptTip);
});

test("evidence in an unapproved field and ambiguous catalog identity cannot become appended prose", () => {
  const item = { ...original["19"].zh, id: "19", name: "Shoulder", description: "UNTRUSTED_DESCRIPTION", tcmEnabled: false };
  const answer = bodyAnswer(["19"], { action: "equipment_evidence" });
  answer.recommendations[0].evidence = { field: "description", quote: item.description };
  expect(withEquipmentTcmReply(answer, [item]).reply).toBe(answer.reply);
  expect(withEquipmentTcmReply(answer, [item, item]).recommendations).toEqual([]);
});

test("supports historical text fallback and uses version metadata only for presentation rebuilding", () => {
  const answer = { ...bodyAnswer(), reply: undefined, text: "Historical text." };
  const result = withEquipmentTcmReply(answer, namedCatalog("zh"));
  expect(result.equipmentReplyBase).toBe(answer.text);
  expect(result.reply.startsWith(answer.text)).toBe(true);
  const unversioned = withEquipmentTcmReply({ ...bodyAnswer(), equipmentReplyBase: "IGNORE_UNVERSIONED_BASE" }, namedCatalog("zh"));
  expect(unversioned.equipmentReplyBase).toBe("Original APP answer.");
  expect(unversioned.reply).not.toContain("IGNORE_UNVERSIONED_BASE");
});

test("does not append an identical trusted quotation already present in the original answer", () => {
  const items = namedCatalog("zh"), quote = equipmentTcmExcerpt(items.find(item => item.id === "19")).quote;
  const answer = bodyAnswer(["19"], { reply: `設施19\n從中醫學角度（APP原文）：「${quote}」` });
  const result = withEquipmentTcmReply(answer, items);
  expect(result.reply).toBe(answer.reply);
  expect(result.reply.split(quote)).toHaveLength(2);
  expect(result.equipmentReplyBase).toBe(answer.reply);
  expect(withEquipmentTcmReply(result, items)).toEqual(result);
});

test.each(["zh", "en"])("appends the existing %s TCM safety boundary once at the end, never to non-TCM replies", locale => {
  const items = namedCatalog(locale), note = locale === "en"
    ? "This is TCM background from the APP, not advice to use this equipment for your symptoms. Please read the full precautions in the Facility Guide."
    : "這是APP的中醫背景資料，並非針對症狀的使用建議。請查看設施教學的完整注意事項。";
  const result = withEquipmentTcmReply(bodyAnswer(["19", "4"]), items, locale);
  expect(result.reply.endsWith(note)).toBe(true);
  expect(result.reply.split(note)).toHaveLength(2);
  expect(withEquipmentTcmReply(result, items, locale)).toEqual(result);
  const disabled = withEquipmentTcmReply(result, items.map(item => ({ ...item, tcmEnabled: false })), locale);
  expect(disabled.reply).toBe(result.equipmentReplyBase);
  expect(disabled.reply).not.toContain(note);
  const primary = bodyAnswer(["19"], { action: "equipment_evidence" });
  primary.recommendations[0].evidence = { field: "tcmTip", quote: equipmentTcmExcerpt(items.find(item => item.id === "19"), locale).quote };
  expect(withEquipmentTcmReply(primary, items, locale).reply.endsWith(note)).toBe(true);
  const ptOnly = bodyAnswer(["11"], { action: "equipment_evidence" });
  ptOnly.recommendations[0].evidence = { field: "ptTip", quote: original["11"][locale].ptTip };
  expect(withEquipmentTcmReply(ptOnly, items, locale).reply).not.toContain(note);
  const alreadyNoted = bodyAnswer(["19"], { reply: note });
  expect(withEquipmentTcmReply(alreadyNoted, items, locale).reply.split(note)).toHaveLength(2);
});
