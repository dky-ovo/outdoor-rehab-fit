import { assistantMessagesForDisplay, localEquipmentAnswer } from "../assistantEquipmentSearch";
import { withEquipmentTcmReply } from "../assistantTcm";
import { assistantReplyPresentation } from "../assistantReplyPresentation";

const catalog = [{ id: "0", name: "太極揉推器", nameEn: "Tai Chi Wheel", isActive: true,
  details: "雙手扶穩手柄，慢慢活動。若痛楚加劇，立即停止並找醫護評估。",
  otTip: "穿合適鞋子，在舒適範圍活動。不要忍痛完成動作。",
  tcmEnabled: true, tcmTip: "活動與經絡的運行相關。" }];

test.each([
  ["太極揉推器如何使用？", "details"],
  ["太極揉推器的職業治療介紹", "otTip"],
])("a direct %s answer keeps its full requested section and no unrelated TCM on first display or restore", (question, field) => {
  const answer = localEquipmentAnswer(question, catalog, "zh");
  const original = [{ id: "u", sender: "user", text: question }, { id: "a", sender: "ai", ...answer }];
  const saved = JSON.stringify(original);
  const restored = assistantMessagesForDisplay(original, catalog, "zh")[1];
  for (const value of [answer, restored]) {
    expect(value.guideContentDirect).toBe(true);
    expect(value.reply).toContain(catalog[0][field]);
    expect(value.reply).not.toContain(catalog[0].tcmTip);
    expect(value.recommendations[0].tcmExcerpt).toBeUndefined();
  }
  const view = assistantReplyPresentation(restored, [{ ...catalog[0], ...restored.recommendations[0] }]);
  expect(view.previewText).toContain(catalog[0][field]);
  expect(view.previewText).not.toContain("開啟現有設施教學及注意事項");
  expect(JSON.stringify(original)).toBe(saved);
});

test("an old local guide replaces its appended TCM with the current complete requested section", () => {
  const original = [{ id: "u", sender: "user", text: "太極揉推器的職業治療介紹" },
    { id: "a", sender: "ai", action: "equipment_local", reply: "OLD OT\nOLD TCM", equipmentReplyVersion: "app-equipment-prose-v1", equipmentReplyBase: "OLD OT", recommendations: [{ id: "0" }] }];
  const saved = JSON.stringify(original);
  const shown = assistantMessagesForDisplay(original, catalog)[1];
  expect(shown.reply).toContain(catalog[0].otTip);
  expect(shown.reply).not.toMatch(/OLD|經絡/);
  expect(JSON.stringify(original)).toBe(saved);
});

test("legacy source text without a recoverable named question remains stable and is not given new TCM", () => {
  const original = [{ id: "u", sender: "user", text: "之前問過的器材资料" },
    { id: "a", sender: "ai", action: "equipment_local", reply: "已保存的完整說明。不要忍痛完成。", recommendations: [{ id: "0" }] }];
  const shown = assistantMessagesForDisplay(original, catalog);
  expect(shown[1].reply).toBe(original[1].reply);
  expect(shown[1].reply).not.toContain(catalog[0].tcmTip);
  expect(assistantMessagesForDisplay(shown, catalog)[1].reply).toBe(shown[1].reply);
});

test("the direct-guide flag cannot skip an affirmative emergency or revive an inactive card", () => {
  const supplied = { id: "a", sender: "ai", action: "equipment_local", guideContentDirect: true,
    source: "app_content", knowledgeSource: "facility_guide", reply: "unsafe old guide", recommendations: [{ id: "0", tcmExcerpt: { quote: "forged" } }] };
  const urgent = assistantMessagesForDisplay([{ id: "u", sender: "user", text: "心口痛，抖唔到氣，可唔可以繼續？" }, supplied], catalog)[1];
  expect(urgent.reply).toContain("999");
  expect(urgent.reply).not.toContain("unsafe");
  expect(urgent.recommendations).toEqual([]);
  const invalid = withEquipmentTcmReply(supplied, [{ ...catalog[0], isActive: false }]);
  expect(invalid.recommendations).toEqual([]);
  const missing = assistantMessagesForDisplay([{ id: "u", sender: "user", text: "太極揉推器如何使用？" }, supplied], [])[1];
  expect(missing.recommendations).toEqual([]);
  expect(missing.reply).not.toContain("unsafe");
});

test("a direct rope guide preserves the shared conflict warning instead of giving either contradictory method", () => {
  const rope = { id: "20", name: "上肢伸展器", details: "不可單手拉繩。", careTip: "不要兩手同時拉繩。" };
  const answer = localEquipmentAnswer("上肢伸展器如何使用？", [rope]);
  expect(answer.reply).toContain("先不要自行拉繩");
  expect(answer.reply).toContain("物理治療師");
  expect(answer.reply).not.toContain("不可單手拉繩。");
});

test.each([
  "I do not want Tai Chi Wheel. Show another upper-body guide.",
  "我唔想用太極揉推器，介紹另一款上肢器材教學。",
])("a local named shortcut cannot override rejection of the named equipment: %s", question => {
  expect(localEquipmentAnswer(question, catalog, question.startsWith("I") ? "en" : "zh")).toBeNull();
});

test("the no-extra-TCM flag preserves genuinely verified symptom evidence", () => {
  const quote = "活動肩膊有助舒緩肩部疼痛。";
  const entry = { ...catalog[0], ptTip: quote };
  const answer = withEquipmentTcmReply({ action: "equipment_evidence", guideContentDirect: true,
    reply: "先了解動作，有痛楚加劇便停止。", recommendations: [{ id: "0", evidence: { field: "ptTip", quote } }] }, [entry]);
  expect(answer.reply).toContain(quote);
  expect(answer.reply).not.toContain(entry.tcmTip);
  expect(answer.recommendations[0].evidence.quote).toBe(quote);
  expect(answer.recommendations[0].tcmExcerpt).toBeUndefined();
});

test("deleted_at items cannot appear through the local direct-guide shortcut", () => {
  expect(localEquipmentAnswer("太極揉推器如何使用？", [{ ...catalog[0], deleted_at: "2026-10-07" }])).toBeNull();
});
