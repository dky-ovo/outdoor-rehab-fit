import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { withEquipmentTcmReply } from "../assistantTcm";
import { localEquipmentAnswer, resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { symptomGuideAnswer } from "../assistantSymptomEvidence";
import { formatAssistantDisplayText } from "../assistantDisplayText";
import { equipmentTranslations } from "../../constants/Equipments";

const longQuote = "這段專業說明介紹肩膊的活動，並詳細解釋伸展時肌肉與關節的活動方式，供讀者了解相關的運動背景。";
const tcmQuote = "這項活動與經絡的運行相關。中醫說明提到氣血流動。";
const equipment = (changes = {}) => ({ id: 0, name: "測試設施", ptTip: longQuote, tcmEnabled: true, tcmTip: tcmQuote, ...changes });
const intro = name => `我了解您想查詢肩部方面的資料。建議先了解「${name}」：`;
const safetyNotice = "有疼痛不代表適合使用，請先找醫護人員評估；若做動作時更痛，就要停止。";
function example(changes = {}, messageChanges = {}) {
  const item = equipment(changes);
  const known = symptomGuideAnswer("肩周炎有什麼器材可以參考？", equipmentTranslations.zh.equipmentList);
  const message = withEquipmentTcmReply({ sender: "ai", reply: known.equipmentReplyBase,
    action: "equipment_evidence", focus: "shoulder", recommendations: [{ id: 0, evidence: { field: "ptTip", quote: item.ptTip } }],
    ...messageChanges }, [item]);
  return { item, message, cards: resolveEquipmentRecommendations(message.recommendations, [item]) };
}

test("a natural acknowledgement, professional explanation and same-facility TCM sentence preserve the full article", () => {
  const { message, cards } = example();
  const saved = JSON.stringify({ message, cards });
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(true);
  expect(view.fullText).toContain(longQuote);
  expect(view.previewText).toBe(`${intro("測試設施")}\n${longQuote}\n\n從中醫學角度：這項活動與經絡的運行相關。\n\n${safetyNotice}`);
  expect(view.fullText).toContain(tcmQuote);
  expect(view.fullText).toContain(safetyNotice);
  expect(view.previewText).not.toContain("中醫說明提到氣血流動。");
  expect(view.previewText).not.toMatch(/例如|首選|已判斷|推薦您使用/);
  expect(view.previewText).not.toContain("僅供參考"); // The fixed notice remains in the chat UI.
  expect(view.fullText).not.toMatch(/APP原文|APP的中醫/);
  expect(JSON.stringify({ message, cards })).toBe(saved);
});

test("legacy answer formatting never changes a user's words or the stored answer", () => {
  const raw = "這些是現有 FAQ 的使用注意，不能確認器材適合您的情況；持續疼痛應先由醫護評估。";
  const answer = { sender: "ai", reply: raw };
  const before = JSON.stringify(answer);
  const view = assistantReplyPresentation(answer);
  expect(view.fullText).not.toContain("FAQ");
  expect(view.fullText).toContain("不能確認器材適合您的情況；持續疼痛應先由醫護評估。");
  expect(assistantReplyPresentation({ sender: "user", text: raw }).fullText).toBe(raw);
  expect(JSON.stringify(answer)).toBe(before);
});

test.each([
  ["zh", "肩周炎有什麼器材可以參考？", ["0", "5", "19"]],
  ["en", "What equipment can I look up for frozen shoulder?", ["0", "5", "19"]],
  ["zh", "膝蓋疼痛，有什麼器材可以參考？", ["4", "10", "11"]],
  ["en", "What equipment can I look up for knee pain?", ["4", "10", "11"]],
])("real %s %s: useful compact preview and full verified explanations", (locale, query, ids) => {
  const catalog = equipmentTranslations[locale].equipmentList;
  const message = { sender: "ai", ...symptomGuideAnswer(query, catalog, locale) };
  const cards = resolveEquipmentRecommendations(message.recommendations, catalog, locale);
  const view = assistantReplyPresentation(message, cards, locale);
  expect(cards.map(item => String(item.id))).toEqual(ids);
  expect(view.canExpand).toBe(true);
  expect(view.previewText.length).toBeLessThan(view.fullText.length * 0.6);
  expect(view.previewText.length).toBeLessThan(locale === "en" ? 800 : 300);
  expect(view.previewText).toContain(cards[0].name);
  expect(view.previewText).toContain(cards[0].evidence.quote);
  expect(view.previewText).toContain(locale === "en" ? "From a traditional Chinese medicine perspective:" : "從中醫學角度：");
  expect(view.previewText).not.toContain(locale === "en" ? "View details" : "查看詳細說明");
  expect(view.previewText).not.toMatch(/For example:|例如：|APP原文/);
  expect(view.previewText.split(locale === "en" ? "From a traditional Chinese medicine perspective:" : "從中醫學角度：")).toHaveLength(2);
  expect(view.fullText).toContain(locale === "en" ? "This does not mean it is suitable for your pain" : "有疼痛不代表適合使用");
  for (const item of cards) {
    expect(view.fullText).toContain(item.name);
    expect(view.fullText).toContain(item.evidence.quote);
    if (item.tcmExcerpt) expect(view.fullText).toContain(item.tcmExcerpt.quote);
  }
  expect(view.fullText).toBe(formatAssistantDisplayText(message.reply, cards.flatMap(item => [item.evidence.quote, item.tcmExcerpt?.quote])));
});

test.each([
  "如果疼痛加劇，請停止。", "切勿強行拉伸。", "只能在專業評估後使用。", "請控制力度和幅度。", "必須先諮詢醫護。", "沒有證據證明適合。",
  "Stop if pain worsens.", "Only use after assessment.", "Do not force the movement.", "This is not suitable for everyone.",
  "Consult a professional before exercising.", "Keep movement within a comfortable range.", "Use only as long as it stays comfortable.",
])("complete conditional/warning paragraph remains visible: %s", caution => {
  const quote = `${longQuote}${caution}`;
  const { message, cards } = example({ ptTip: quote });
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain(quote);
  expect(view.canExpand).toBe(false);
});

test("a short explanation is not hidden behind an expansion control", () => {
  const { message, cards } = example({ ptTip: "活動肩膊的簡短說明。", tcmEnabled: false }, { reply: "以下是相關器材資料。" });
  expect(assistantReplyPresentation(message, cards).canExpand).toBe(false);
});

test("known recommendations show a complete short explanation and keep the detail entry", () => {
  const { message, cards } = example({ ptTip: "活動肩膊的簡短說明。", tcmEnabled: false });
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toBe(`${intro("測試設施")}\n活動肩膊的簡短說明。\n\n${safetyNotice}`);
  expect(view.canExpand).toBe(true);
  expect(view.fullText).toContain("活動肩膊的簡短說明。");
});

test("ordinary range-of-motion descriptions do not block a concise preview", () => {
  const { message, cards } = example({ ptTip: "柔和的關節活動有助於五十肩患者保持肩關節的活動幅度並減輕肩膊的疼痛。" });
  expect(assistantReplyPresentation(message, cards).canExpand).toBe(true);
});

test.each([{ tcmEnabled: false }, { tcmTip: "" }, { tcmEnabled: undefined }])("no TCM summary without current enabled content: %j", changes => {
  const { message, cards } = example({ ptTip: longQuote.repeat(3), ...changes });
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(true);
  expect(view.previewText).not.toContain("中醫");
  expect(view.previewText).not.toContain("測試設施"); // Long evidence stays complete in details.
  expect(view.fullText).toContain(longQuote);
});

test("a model-supplied TCM excerpt is not trusted", () => {
  const { message, cards } = example({ tcmEnabled: false });
  cards[0].tcmExcerpt = { field: "tcmTip", quote: "虛構中醫內容。" };
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).not.toContain("中醫");
  expect(view.fullText).not.toContain("虛構");
});

test("a long TCM first sentence is never cut midway or replaced with an unqualified later benefit", () => {
  const first = `${"這是很長的中醫背景資料，".repeat(10)}結束。`;
  const { message, cards } = example({ tcmTip: `${first}這項活動有助舒展。` });
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(true);
  expect(view.previewText).not.toContain("中醫");
  expect(view.previewText).not.toContain("這項活動有助舒展");
  expect(view.fullText).toContain(first);
});

test("a later qualifying condition prevents selecting the first TCM sentence", () => {
  const { message, cards } = example({ tcmTip: "這項活动與氣血流動相關。只有特定情況適用。" });
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain("這項活动與氣血流動相關。只有特定情況適用。");
  expect(view.previewText).not.toContain("從中醫學角度：");
  expect(view.fullText).toContain("只有特定情況適用。");
  expect(view.canExpand).toBe(false);
});

test.each(["如不適請停止。", "Stop if discomfort increases.", "請先由醫護評估。", "Only use after assessment."])("a warning immediately following old TCM prose cannot be hidden: %s", warning => {
  const { message, cards } = example();
  message.reply = message.reply.replace(tcmQuote, `${tcmQuote}${warning}`);
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(false);
  expect(view.previewText).toContain(`${tcmQuote}${warning}`);
});

test("a qualifying TCM paragraph for another facility stays visible, not only the chosen first item", () => {
  const items = [equipment({ id: 1 }), equipment({ id: 2, name: "有附加條件的設施", tcmTip: "活動與氣血流動相關。只有特定情況適用。" })];
  const { message: initial } = example();
  const message = withEquipmentTcmReply({ ...initial, recommendations: items.map(item => ({ id: item.id, evidence: { field: "ptTip", quote: longQuote } })) }, items);
  const view = assistantReplyPresentation(message, resolveEquipmentRecommendations(message.recommendations, items));
  expect(view.canExpand).toBe(false);
  expect(view.previewText).toContain("只有特定情況適用。");
});

test("a qualifier after the excerpt candidate is not discarded to produce a new TCM interpretation", () => {
  const { message, cards } = example({ tcmTip: "活動與氣血流動相關。這是中醫背景資料。只有特定情況適用。", ptTip: longQuote.repeat(3) });
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(true);
  expect(view.previewText).not.toContain("中醫");
  expect(view.previewText).not.toContain("氣血流動");
});

test("all TCM perspectives remain in details, without selecting one for the preview or reordering cards", () => {
  const items = [equipment({ id: 1, name: "沒有中醫的設施", tcmEnabled: false }), equipment({ id: 2, name: "有中醫的設施" })];
  const { message: initial } = example();
  const message = withEquipmentTcmReply({ ...initial, recommendations: items.map(item => ({ id: item.id, evidence: { field: "ptTip", quote: longQuote } })) }, items);
  const cards = resolveEquipmentRecommendations(message.recommendations, items);
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain(`${intro("沒有中醫的設施")}\n${longQuote}`);
  expect(view.previewText).not.toContain("從中醫學角度：");
  expect(view.previewText).not.toContain(tcmQuote);
  expect(view.fullText).toContain("有中醫的設施");
  expect(view.fullText).toContain(tcmQuote);
  expect(cards.map(item => item.id)).toEqual([1, 2]);
});

test.each(["ptTip", "kinesiologyTip", "otTip"])("a complete verified %s explanation can be the single example", field => {
  const { message: initial } = example();
  const item = equipment({ [field]: longQuote });
  const message = withEquipmentTcmReply({ ...initial, recommendations: [{ id: 0, evidence: { field, quote: longQuote } }] }, [item]);
  const cards = resolveEquipmentRecommendations(message.recommendations, [item]);
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain(`${intro("測試設施")}\n${longQuote}`);
  expect(view.fullText).toContain(longQuote);
  expect(view.fullText).toContain(tcmQuote);
});

test.each(["zh", "en"])("%s skips an oversized excerpt without truncating it or reordering cards", locale => {
  const quote = locale === "en" ? "This description explains shoulder movement." : longQuote;
  const largeQuote = quote.repeat(10);
  const items = [equipment({ id: 1, name: "Long example", ptTip: largeQuote }), equipment({ id: 2, name: "Short example", ptTip: quote })];
  const known = symptomGuideAnswer(locale === "en" ? "What equipment can I look up for frozen shoulder?" : "肩周炎有什麼器材可以參考？", equipmentTranslations[locale].equipmentList, locale);
  const message = withEquipmentTcmReply({ sender: "ai", reply: known.equipmentReplyBase, action: "equipment_evidence", focus: "shoulder",
    recommendations: items.map(item => ({ id: item.id, evidence: { field: "ptTip", quote: item.ptTip } })) }, items, locale);
  const cards = resolveEquipmentRecommendations(message.recommendations, items, locale);
  const view = assistantReplyPresentation(message, cards, locale);
  expect(view.canExpand).toBe(true);
  expect(view.previewText).toContain("Short example");
  expect(view.previewText).toContain(quote);
  expect(view.previewText).not.toContain("Long example");
  expect(view.fullText).toContain(largeQuote);
  expect(cards.map(item => item.id)).toEqual([1, 2]);
});

test("TCM-only evidence keeps a detail invitation instead of substituting unrelated PT content", () => {
  const { message: initial, item } = example();
  const message = withEquipmentTcmReply({ ...initial, recommendations: [{ id: 0, evidence: { field: "tcmTip", quote: tcmQuote } }] }, [item]);
  const cards = resolveEquipmentRecommendations(message.recommendations, [item]);
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toBe(`我了解您想進一步認識相關器材。\n\n${safetyNotice}`);
  expect(view.canExpand).toBe(true);
  expect(view.fullText).toContain(tcmQuote);
  expect(view.fullText).not.toContain(longQuote);
});

test.each(["zh", "en"])("%s wording varies across six replies without changing evidence, ordering or full text", locale => {
  const catalog = equipmentTranslations[locale].equipmentList;
  const message = { sender: "ai", ...symptomGuideAnswer(locale === "en" ? "What equipment can I look up for knee pain?" : "膝蓋痛，有什麼器材可以參考？", catalog, locale) };
  const cards = resolveEquipmentRecommendations(message.recommendations, catalog, locale);
  const saved = JSON.stringify({ message, cards });
  const variants = Array.from({ length: 6 }, (_, index) => assistantReplyPresentation(message, cards, locale, index));
  expect(new Set(variants.map(view => view.previewText.split("\n")[0])).size).toBe(6);
  expect(new Set(variants.map(view => view.fullText)).size).toBe(1);
  for (const [index, view] of variants.entries()) {
    expect(view.previewText).toContain(cards[0].name);
    expect(view.previewText).toContain(cards[0].evidence.quote);
    expect(view.previewText).not.toMatch(/例如|For example|我已了解您的病情|推薦您使用|diagnos/i);
    expect(view.introVariant).toBe(index);
    expect(assistantReplyPresentation(message, cards, locale, index)).toEqual(view);
  }
  expect(JSON.stringify({ message, cards })).toBe(saved);
});

test.each([undefined, NaN, -1, Infinity, "2"])("invalid variation index %s safely uses the first style", index => {
  const { message, cards } = example();
  expect(assistantReplyPresentation(message, cards, "zh", index)).toEqual(assistantReplyPresentation(message, cards));
});

test("a fabricated TCM excerpt cannot override current same-facility text", () => {
  const { message, cards } = example();
  cards[0].tcmExcerpt = { field: "tcmTip", quote: "虛構：治好所有疾病。" };
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain("從中醫學角度：這項活動與經絡的運行相關。");
  expect(view.previewText).not.toContain("虛構");
  expect(view.fullText).not.toContain("治好");
});

test.each(["只有在評估後適用。", "Only suitable after assessment."])("later TCM condition is never detached: %s", condition => {
  const { message, cards } = example({ tcmTip: `活動與經絡的運行相關。${condition}` });
  const view = assistantReplyPresentation(message, cards);
  expect(view.canExpand).toBe(false);
  expect(view.previewText).toContain(condition);
});

test("empty English TCM does not borrow available Chinese fields", () => {
  const catalog = equipmentTranslations.en.equipmentList.map(item => ({ ...item, tcmTip: "", tcmTipZh: tcmQuote }));
  const message = { sender: "ai", ...symptomGuideAnswer("What equipment can I look up for frozen shoulder?", catalog, "en") };
  const cards = resolveEquipmentRecommendations(message.recommendations, catalog, "en");
  const view = assistantReplyPresentation(message, cards, "en");
  expect(view.previewText).toContain(cards[0].evidence.quote);
  expect(view.previewText).not.toMatch(/Chinese medicine|中醫|經絡/);
});

test("an unverified version marker or stale generated suffix cannot enable folding", () => {
  const { message, cards } = example();
  for (const altered of [
    { ...message, equipmentReplyVersion: undefined },
    { ...message, reply: `${message.reply}\n额外模型内容，不可隐藏。` },
    { ...message, equipmentReplyBase: "不同的 base" },
  ]) expect(assistantReplyPresentation(altered, cards).canExpand).toBe(false);
  const stale = cards.map(item => ({ ...item, ptTip: "后台已更新说明。" }));
  expect(assistantReplyPresentation(message, stale).canExpand).toBe(false);
});

test.each(["equipment_local", "equipment_image", "image_confirmation", "facility", "auth_error", "error"])("%s action is never folded", action => {
  const { message, cards } = example({}, { action });
  expect(assistantReplyPresentation(message, cards).canExpand).toBe(false);
});

test.each([
  { confirmationRequired: true }, { confirmationRequired: true, confirmationAnswered: "no" },
  { confirmationAnswered: "no" }, { tcmInReply: true },
])("independent flow remains complete: %j", flags => {
  const { message, cards } = example();
  expect(assistantReplyPresentation({ ...message, ...flags }, cards).canExpand).toBe(false);
});

test.each(["zh", "en"])("%s usage instructions are kept complete", locale => {
  const catalog = equipmentTranslations[locale].equipmentList;
  const message = { sender: "ai", ...localEquipmentAnswer(locale === "en" ? "How do I use Tai Chi Wheel?" : "太極揉推器如何使用", catalog, locale) };
  const cards = resolveEquipmentRecommendations(message.recommendations, catalog, locale);
  const view = assistantReplyPresentation(message, cards, locale);
  expect(message.action).toBe("equipment_local");
  expect(view.canExpand).toBe(false);
  expect(view.previewText).toBe(view.fullText);
  expect(view.fullText).toContain(catalog.find(item => String(item.id) === "0").details);
  expect(view.fullText).toContain(message.equipmentReplyBase);
});

test("unknown base text including warnings is preserved without sentence extraction", () => {
  const base = "很长的模型说明。".repeat(30) + "请勿使用，先向治疗师查询。";
  const { message, cards } = example({}, { reply: base });
  expect(assistantReplyPresentation(message, cards).previewText).toContain(base);
});

test("card-only descriptions and warnings move to the article, never get silently removed", () => {
  const item = equipment({ tcmEnabled: false });
  const message = { sender: "ai", reply: "以下是参考器材。", recommendations: [{ id: 0, reason: "建议先了解动作。Stop if pain worsens." }] };
  const cards = resolveEquipmentRecommendations(message.recommendations, [item]);
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain(item.name);
  expect(view.previewText).toContain(message.recommendations[0].reason);
  expect(message.reply).toBe("以下是参考器材。");
});

test("an additional caution outside a quoted card explanation remains visible", () => {
  const { message, cards } = example();
  cards[0].reason = `${longQuote}請停止並求醫。`;
  const view = assistantReplyPresentation(message, cards);
  expect(view.previewText).toContain("請停止並求醫。");
});

test("TCM evidence does not hide an extra card-only caution", () => {
  const item = equipment();
  const message = withEquipmentTcmReply({ sender: "ai", reply: "相关参考资料。", action: "equipment_evidence",
    recommendations: [{ id: 0, evidence: { field: "tcmTip", quote: tcmQuote }, reason: `${tcmQuote}如疼痛加劇，請停止。` }] }, [item]);
  const view = assistantReplyPresentation(message, resolveEquipmentRecommendations(message.recommendations, [item]));
  expect(view.previewText).toContain("如疼痛加劇，請停止。");
});

test.each(["user", undefined])("%s text is never formatted, summarized or folded", sender => {
  const { message, cards } = example();
  const original = { ...message, sender, text: "APP原文：這是用戶自己的內容。" };
  expect(assistantReplyPresentation(original, cards)).toEqual({ fullText: original.text, previewText: original.text, canExpand: false });
});
