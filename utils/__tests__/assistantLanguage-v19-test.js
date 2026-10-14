import { equipmentTranslations } from "../../constants/Equipments";
import { assistantMessagesForDisplay, resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { retrieveAssistantFaq, renderAssistantFaq } from "../../server/src/assistantFaqKnowledge";

test("Cantonese emergency overrides the exact stale live model/map reply without changing stored records", () => {
  const question = "我用扭腰機嗰陣心口痛，仲抖唔到氣，咁可唔可以繼續呀？";
  for (const action of ["equipment_evidence", "facility", "general"]) {
    const rows = [{ id: "u", sender: "user", text: question }, { id: "a", sender: "ai", action,
      reply: "請告訴我不適的部位，例如膝蓋或小腿，我便可幫您查找相關器材資料。",
      recommendations: [], evidencePolicy: "app-symptom-deepseek-v2", deepSeekUsed: true,
      recommendationsFinal: true, source: "app_content", knowledgeSource: "facility_guide" }];
    const before = JSON.stringify(rows);
    const display = assistantMessagesForDisplay(rows, equipmentTranslations.zh.equipmentList).at(-1);
    expect(display.reply).toMatch(/停止/);
    expect(display.reply).toMatch(/999/);
    expect(display.reply).not.toContain("請告訴我不適的部位");
    expect(display.recommendations).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  }
});

test("denied urgent symptoms and unrelated conversation history do not replace a normal reply", () => {
  const rows = [{ id: "u", sender: "user", text: "我冇心口痛，呼吸正常。啱啱食完晏，要等陣先做運動嗎？" },
    { id: "a", sender: "ai", action: "general", reply: "請避免太飽時運動。", recommendations: [] }];
  const display = assistantMessagesForDisplay(rows, []).at(-1);
  expect(display.reply).not.toMatch(/999/);
  expect(display.reply).toContain("太飽");
});

test("restored FAQ replies cannot override an unresolved urgent prior turn, but explicit correction is respected", () => {
  const catalog = equipmentTranslations.zh.equipmentList;
  const prefix = [{ id: "u1", sender: "user", text: "我心口痛，抖唔到氣" },
    { id: "a1", sender: "ai", action: "safety", reply: "請停止運動，立即求醫。", recommendations: [] }];
  for (const [question, urgent] of [
    ["膝痛有什麼器材要小心？", true],
    ["更正：我冇心口痛，冇呼吸困難，只有膝痛，有什麼器材要小心？", false],
  ]) {
    const faq = renderAssistantFaq(retrieveAssistantFaq(question), catalog);
    const rows = [...prefix, { id: "u2", sender: "user", text: question }, { id: "a2", sender: "ai", ...faq }];
    const display = assistantMessagesForDisplay(rows, catalog).at(-1);
    if (urgent) {
      expect(display.reply).toMatch(/999/);
      expect(display.recommendations).toEqual([]);
    } else {
      expect(display.reply).not.toMatch(/999/);
      expect(display.faqId).toBe("knee-cautions");
    }
  }
});

test("focused new FAQ IDs survive reload and the phone preview retains the relevant caution", () => {
  for (const [question, expected, required, forbidden] of [
    ["我的膝蓋有點痛，想試扭腰機，轉動時應注意甚麼？", "knee-twister-cautions", /膝|轉板/, /柔和地扭動軀幹有助於腰背痛/],
    ["我的手腕痛，站立式臂伏撐是否合適，還是應避免雙手承重？", "wrist-support", /不要做|避免|暫停|停止/, /增強使用者上肢肌肉的力量/],
    ["拉繩器應如何使用，每次應拉多少次？", "rope-use", /先不要自行拉|示範|確認/, /不要兩手同時拉繩|不可單手拉繩/],
  ]) {
    const catalog = equipmentTranslations.zh.equipmentList;
    const entry = retrieveAssistantFaq(question);
    expect(entry?.id).toBe(expected);
    const reply = renderAssistantFaq(entry, catalog);
    const saved = [{ id: "u", sender: "user", text: question }, { id: "a", sender: "ai", ...reply }];
    const display = assistantMessagesForDisplay(JSON.parse(JSON.stringify(saved)), catalog).at(-1);
    expect(display.faqId).toBe(expected);
    const cards = resolveEquipmentRecommendations(display.recommendations, catalog);
    const view = assistantReplyPresentation(display, cards);
    expect(view.previewText).toMatch(required);
    expect(view.fullText).not.toMatch(forbidden);
  }
});
