import { formatAssistantDisplayText } from "../assistantDisplayText";
import { symptomGuideAnswer } from "../assistantSymptomEvidence";
import { equipmentTranslations } from "../../constants/Equipments";

const format = formatAssistantDisplayText;
const quote = "柔和活動肩關節，有助緩解肩膊疼痛。";

test.each([
  ["物理治療師的小貼士（APP原文）", "物理治療師的小貼士"],
  ["運動學專家的專業介紹（APP原文）", "運動學專家的專業介紹"],
  ["職業治療師的小貼士（APP原文）", "職業治療師的小貼士"],
  ["從中醫學角度（APP原文）", "從中醫學角度"],
  ["中醫學角度（APP原文節錄）－肩關節伸展", "中醫學角度－肩關節伸展"],
  ["Tips from Physiotherapists (APP excerpt)", "Tips from Physiotherapists"],
  ["TCM perspective (APP excerpt) — Shoulder stretch", "TCM perspective — Shoulder stretch"],
])("source-free heading: %s", (before, after) => expect(format(before)).toBe(after));

test("card labels change without changing the quoted professional explanation", () => {
  expect(format(`APP「物理治療師的小貼士」原文：「${quote}」`, [quote])).toBe(`物理治療師的小貼士：「${quote}」`);
  expect(format('APP excerpt — Physiotherapist: “Move gently.”', ["Move gently."])).toBe('Physiotherapist: “Move gently.”');
});

test("the Chinese closing note says 以上說明 without changing the rest or the English wording", () => {
  const original = "這是APP的中醫背景資料，並非針對症狀的使用建議。請查看設施教學的完整注意事項。";
  expect(format(original)).toBe("以上說明僅供參考，並非針對症狀的使用建議。請查看設施教學的完整注意事項。");
  expect(format(original, [original])).toBe(original);
  expect(format("This is TCM background from the APP, not advice to use this equipment for your symptoms. Please read the full precautions in the Facility Guide."))
    .toBe("This TCM information is for reference, not advice to use this equipment for your symptoms. Please read the full precautions in the Facility Guide.");
});

test.each(["zh", "en"])("real %s shoulder recommendations lose provenance copy but retain all evidence and cautions", locale => {
  const entries = equipmentTranslations[locale].equipmentList;
  const answer = symptomGuideAnswer(locale === "en" ? "I have frozen shoulder, please recommend equipment." : "肩周炎可以用什麼器材？", entries, locale);
  expect(answer.recommendations.length).toBeGreaterThan(0);
  const passages = answer.recommendations.flatMap(item => [item.evidence?.quote, item.tcmExcerpt?.quote]).filter(Boolean);
  const visible = format(answer.reply, passages);
  expect(visible).not.toMatch(/APP原文|APP設施教學|APP的中醫|APP excerpt|from the APP|According to the APP|original passages/);
  for (const passage of passages) expect(visible).toContain(passage);
  expect(visible).toContain(locale === "en" ? "This does not mean it is suitable for your pain" : "有疼痛不代表適合使用");
  expect(visible).toContain(locale === "en" ? "not treatment advice" : "不能代替診治");
  if (locale === "zh") {
    expect(visible).toContain("這些是中醫的一般說明");
    expect(visible).not.toContain("以上中醫說明");
  }
  expect(format(visible, passages)).toBe(visible);
});

test.each([
  ["根據APP內「設施教學－太極揉推器」的資料：\n\n握住手柄。", "太極揉推器：\n\n握住手柄。"],
  ["以下內容來自「設施教學－太極揉推器」：\n\n握住手柄。", "太極揉推器：\n\n握住手柄。"],
  ["According to the Facility Guide for Tai Chi Wheel:\n\nHold the handles.", "Tai Chi Wheel:\n\nHold the handles."],
  ["The following information comes from the Facility Guide for Tai Chi Wheel:\n\nHold the handles.", "Tai Chi Wheel:\n\nHold the handles."],
])("old local/server professional wrapper is display-only: %s", (before, after) => expect(format(before)).toBe(after));

test("missing evidence, clarification and classification never become treatment promises", () => {
  const missing = "APP現有說明中，未找到能明確支持本次查詢與膝部疼痛緩解相對應的原文。疼痛嚴重、持續或加劇時，請尋求醫護人員評估。";
  expect(format(missing)).toBe("目前沒有足夠資料支持推薦器材來緩解膝部疼痛。疼痛嚴重、持續或加劇時，請尋求醫護人員評估。");
  expect(format("I did not find an affirmative APP passage linking this request to relief of knee discomfort. Please seek a professional assessment.")).toBe("There is not enough information to recommend equipment for relief of knee discomfort. Please seek a professional assessment.");
  expect(format("我可以幫您查閱APP相關資料，但有疼痛時應先由醫護人員評估。")).toBe("我可以幫您查閱相關器材說明，但有疼痛時應先由醫護人員評估。");
  expect(format("此設施在APP內歸類為下肢相關器材，如疼痛加劇，請立即停止。")).toBe("此設施屬於下肢相關器材，如疼痛加劇，請立即停止。");
});

test("category fallback introductions remove only the attribution", () => {
  expect(format("我先根據APP內的設施分類，為您篩選以下參考器材。請先閱讀設施教學，並按自身情況慢慢進行。")).toBe("以下是按運動部位分類的參考器材。請先閱讀設施教學，並按自身情況慢慢進行。");
  expect(format("I selected these reference items from the in-app Facility Guide categories. Please read the guide and start gently.")).toBe("Here are some equipment references grouped by activity area. Please read the guide and start gently.");
});

test("actual source passages are protected even if they contain the same source-label words", () => {
  const actual = "從中醫學角度（APP原文）：這是資料中的標題。";
  const before = `從中醫學角度（APP原文）：「${actual}」\n\n${actual}`;
  expect(format(before, [actual, "這是資料中的標題。", actual])).toBe(`從中醫學角度：「${actual}」\n\n${actual}`);
  expect(format(actual, [actual])).toBe(actual);
  expect(format("操作APP後閱讀原文。", ["操作APP後閱讀原文。"])).toBe("操作APP後閱讀原文。");
});

test("non-wrapper text, links, instructions and null values are not rewritten", () => {
  for (const value of [undefined, null, "", "APP 更新後，可以再看原文嗎？", "1\n握住手柄。\n2\n保持姿勢。", "查看設施教學 ›", "Please stop exercising and seek prompt medical help."]) {
    expect(format(value)).toBe(value);
  }
});

test.each([
  ["根据APP中的资料，可以查看以下器材。", "可以查看以下器材。"],
  ["根據APP的設施分類，以下是相關的參考器材。", "以下是相關的參考器材。"],
  ["According to the APP content, these are equipment references.", "these are equipment references."],
  ["Based on the APP Facility Guide: Please assess suitability first.", "Please assess suitability first."],
])("a legacy source lead-in does not hide the following caution or equipment reference: %s", (before, after) => {
  expect(format(before)).toBe(after);
  expect(format(before, [before])).toBe(before);
});

test.each([
  ["現有 FAQ 列出的成年人活動量為每星期累積 150–300 分鐘。短時間活動也計算在內。", "成年人一般的活動量建議為每星期累積 150–300 分鐘。短時間活動也計算在內。"],
  ["這些是現有 FAQ 的使用注意，不能確認器材適合您的情況；持續疼痛應先由醫護評估。", "這些注意事項不能確認器材適合您的情況；持續疼痛應先由醫護評估。"],
  ["These precautions from the reviewed FAQ do not establish suitability; stop if pain worsens.", "These precautions do not establish suitability; stop if pain worsens."],
  ["這是根據項目 FAQ 的陪同及疼痛注意事項，不是判斷痛楚原因。若同時出現胸痛或明顯呼吸困難，應立即尋求醫護協助。", "這些是陪同時的注意事項，不能判斷痛楚原因。若同時出現胸痛或明顯呼吸困難，應立即尋求醫護協助。"],
  ["現有 FAQ 亦沒有適用所有人的固定拉繩次數，應按個人能力安排，不要忍痛完成。下方是供核對的教學入口。", "拉繩次數不宜一概而論，應按個人能力安排，不要忍痛完成。下方可查看器材圖片和說明。"],
])("legacy internal wording becomes natural while keeping the whole safety condition: %s", (before, after) => {
  expect(format(before)).toBe(after);
  expect(format(after)).toBe(after);
  expect(format(before, [before])).toBe(before);
});

test("literal FAQ questions and clinical evidence limitations are not removed as internal wrappers", () => {
  for (const sentence of ["FAQ 是什麼意思？", "沒有證據證明這項活動適合所有人。請先由醫護評估。", "The evidence does not establish suitability; stop if pain worsens."]) {
    expect(format(sentence)).toBe(sentence);
  }
});
