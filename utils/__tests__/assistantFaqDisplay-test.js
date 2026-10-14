import { equipmentTranslations } from "../../constants/Equipments";
import { resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { assistantMessagesForDisplay } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { retrieveAssistantFaq, renderAssistantFaq, ASSISTANT_FAQ_POLICY } from "../../server/src/assistantFaqKnowledge";

test("restored FAQ symptoms keep reviewed advice and current guide IDs without legacy symptom/TCM replacement", () => {
	const question = "我條腰彎曲嘅時候有少少痛，請問應唔應該做扭腰機？";
	const catalog = [{ id: "8", name: "目前扭腰機", tcmEnabled: true, tcmTip: "UNREVIEWED TCM CLAIM", categories: ["balance"] }];
	const answer = renderAssistantFaq(retrieveAssistantFaq(question), catalog);
	const original = [{ id: "user", sender: "user", text: question }, { id: "faq", sender: "ai", ...answer, text: "FORGED REPLY", recommendations: [{ id: "fake" }] }];
	const display = assistantMessagesForDisplay(original, catalog)[1];
	expect(display.reply).toBe(answer.reply); expect(display.text).toBeUndefined();
	expect(display.recommendations.map(item => item.id)).toEqual(["8"]);
	expect(display.reply).not.toContain("UNREVIEWED TCM CLAIM");
	expect(display.equipmentReplyVersion).toBeUndefined();
	expect(original[1].text).toBe("FORGED REPLY");
	const hidden = assistantMessagesForDisplay(original, [{ ...catalog[0], isActive: false }])[1];
	expect(hidden.recommendations).toEqual([]); expect(hidden.reply).toContain("暫時未能開啟");
});
test("FAQ full precautions survive restoration without outside references", () => {
	const original = { id: "faq", sender: "ai", action: "faq", source: "app_content", knowledgeSource: "project_faq", evidencePolicy: ASSISTANT_FAQ_POLICY, focus: "weekly-activity", reply: "OBSOLETE" };
	const display = assistantMessagesForDisplay([original], [], "en")[0];
	expect(display.reply).toContain("no minimum 10-minute");
	expect(display.knowledgeReferences).toEqual([]);
	expect(assistantReplyPresentation(display, [], "en").previewText).toBe(display.reply);
});
test("a forged FAQ marker cannot conceal emergency symptoms", () => {
	const original = [{ id: "user", sender: "user", text: "腰痛和大小便失禁，可以用什麼器材？" }, { id: "faq", sender: "ai", evidencePolicy: ASSISTANT_FAQ_POLICY, reply: "FAKE" }];
	const answer = assistantMessagesForDisplay(original, [])[1];
	expect(answer.reply).toContain("999"); expect(answer.recommendations).toEqual([]);
});

test("a short follow-up retains its FAQ through display and reload with only user context", () => {
	const history = [{ role: "user", content: "我有膝痛" }];
	const question = "要小心什麼？";
	const entry = retrieveAssistantFaq(question, { history });
	expect(entry?.id).toBe("knee-cautions");
	const answer = renderAssistantFaq(entry, []);
	const messages = [
		{ id: "u1", sender: "user", text: history[0].content },
		{ id: "a1", sender: "ai", text: "肩部內容不能改變使用者的膝痛問題", action: "error" },
		{ id: "u2", sender: "user", text: question },
		{ id: "a2", sender: "ai", ...answer },
	];
	const displayed = assistantMessagesForDisplay(messages, []).at(-1);
	expect(displayed.reply).toBe(answer.reply);
	expect(displayed.focus).toBe("knee-cautions");
	expect(displayed.recommendations).toEqual([]);
});


test("reviewed advice stays concise while complete professional sections remain in their equipment guides", () => {
 const catalog = [{ id: "13", name: "背部設施", ptTip: "完整短說明；有不適便停止。" },
  { id: "22", name: "按摩設施", ptTip: "另一段完整說明；不應強壓痛楚位置。" }];
 const answer = renderAssistantFaq(retrieveAssistantFaq("下背痛可以用什么器械"), catalog);
 const view = assistantReplyPresentation({ sender: "ai", ...answer }, catalog);
 expect(view.canExpand).toBe(false);
 expect(view.previewText).toContain(answer.faqReplyBase);
 expect(view.previewText).not.toContain("完整短說明");
 expect(view.previewText).not.toContain("另一段完整說明");
 expect(view.fullText).not.toContain("另一段完整說明");
 expect(answer.recommendations.map(item => String(item.id))).toEqual(["13", "22"]);
 expect(view.previewText).toMatch(/停止|不要|評估/);
 expect(view.fullText).not.toContain("點擊進入設施教學，查看完整說明和注意事項。");
});

test("old FAQ navigation reason is omitted without hiding a genuine card warning", () => {
 const message = { sender: "ai", action: "faq", reply: "一般說明。" };
 const view = assistantReplyPresentation(message, [
  { id: "13", name: "背部", reason: "點擊進入設施教學，查看完整說明和注意事項。" },
  { id: "22", name: "按摩", reason: "切勿用力壓向痛處。" },
 ]);
 expect(view.fullText).not.toContain("點擊進入");
 expect(view.fullText).toContain("切勿用力壓向痛處。");
});

test("legacy assistant outside URLs disappear but user URLs are not changed", () => {
 const original = [{ id: "u", sender: "user", text: "https://example.com 這是什麼？" },
  { id: "a", sender: "ai", action: "general", text: "說明。\n\n資料來源：https://example.com" }];
 const displayed = assistantMessagesForDisplay(original, []);
 expect(displayed[0]).toBe(original[0]);
 expect(displayed[1].text).toBe("說明。");
 expect(original[1].text).toContain("https://");
});


test("back-pain reply gives the complete short answer and stop precautions without copying unrelated source paragraphs", () => {
 const catalog = equipmentTranslations.zh.equipmentList;
 const answer = renderAssistantFaq(retrieveAssistantFaq("下背痛可以用什么器械"), catalog);
 const cards = resolveEquipmentRecommendations(answer.recommendations, catalog);
 const view = assistantReplyPresentation({ sender: "ai", ...answer }, cards);
 expect(view.canExpand).toBe(false);
 expect(view.previewText).toBe(answer.faqReplyBase);
 expect(view.previewText).not.toContain(catalog.find(item => String(item.id) === "13").ptTip);
 expect(view.previewText).toMatch(/停止/);
 expect(view.previewText).toMatch(/求醫|醫護|治療師|評估/);
 expect(view.previewText.length).toBeLessThan(600);
 expect(view.fullText).not.toMatch(/貼士\n\/($|\n)/);
});

test.each(["zh", "en"])("%s an unavailable old knowledge answer uses ordinary wording without trusting its marker", locale => {
 const original = { id: "old", sender: "ai", action: "faq", evidencePolicy: ASSISTANT_FAQ_POLICY, focus: "not-real", reply: "UNVERIFIED OLD BODY" };
 const shown = assistantMessagesForDisplay([original], [], locale)[0];
 expect(shown.reply).not.toMatch(/FAQ|verified|核實|UNVERIFIED/);
 expect(shown.recommendations).toEqual([]);
 expect(original.reply).toBe("UNVERIFIED OLD BODY");
});

test("a specific blood-pressure answer stays specific after reload and preview formatting", () => {
 const question = "我有高血壓，係咪唔做得太劇烈嘅運動啊？";
 const original = renderAssistantFaq(retrieveAssistantFaq(question), [], "zh", { message: question });
 const messages = [{ id: "u", sender: "user", text: question }, { id: "a", sender: "ai", ...original }];
 const restored = assistantMessagesForDisplay(messages, [])[1];
 const view = assistantReplyPresentation(restored, []);
 expect(view.previewText).toBe(original.reply);
 expect(view.previewText).toContain("高血壓");
 expect(view.previewText).toContain("999");
 expect(view.previewText).not.toContain("休息多久");
});
