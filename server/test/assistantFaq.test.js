import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_FAQ_ENTRIES, ASSISTANT_FAQ_POLICY, retrieveAssistantFaq, renderAssistantFaq } from "../src/assistantFaqKnowledge.js";
import { assistantFaqAnswer } from "../src/assistantFaq.js";
import { BUILT_IN_EQUIPMENT_CATALOG } from "../src/equipmentCatalog.js";

const catalog = BUILT_IN_EQUIPMENT_CATALOG.map(item => ({ ...item, name: item.nameZh }));
test("reviewed topics and scoped precaution variants retrieve their Chinese/Cantonese and English questions with real guide IDs", () => {
	assert.ok(ASSISTANT_FAQ_ENTRIES.length >= 26);
	const validIds = new Set(catalog.map(item => item.id));
	for (const entry of ASSISTANT_FAQ_ENTRIES) {
		for (const id of entry.guideIds) assert.ok(validIds.has(id), `${entry.id}: ${id}`);
		for (const question of entry.questions) {
			const answer = assistantFaqAnswer({ message: question, catalog });
			assert.equal(answer?.focus, entry.id, question);
			assert.equal(answer.evidencePolicy, ASSISTANT_FAQ_POLICY);
			assert.equal(answer.deepSeekUsed, false);
			assert.equal(answer.recommendationsFinal, true);
			assert.doesNotMatch(answer.reply, /【列出|激發膀胱|祛除風寒|帶走發炎|增進腦部/);
		}
	}
});
test("paraphrases retrieve conservatively, with no unrelated greeting/travel or ambiguous symptom capture", () => {
	for (const [question, id] of [["每週應做多久運動？", "weekly-activity"], ["How often should older adults exercise?", "weekly-activity"], ["有膝痛要小心哪些器材？", "knee-cautions"], ["Where can I find videos?", "app-videos"]]) assert.equal(retrieveAssistantFaq(question)?.id, id, question);
	for (const question of ["Hello", "Plan a holiday", "我的膝痛", "膝痛推薦器材", "How to use the bike", "附近公園在哪？"]) assert.equal(retrieveAssistantFaq(question), null, question);
});
test("current published catalog owns names, visibility and IDs; companion safety stays concise", () => {
	const selected = retrieveAssistantFaq("My lower back hurts when bending. Should I use the twister?");
	assert.deepEqual(renderAssistantFaq(selected, [{ id: "8", name: "Renamed guide", isActive: false }], "en").recommendations, []);
	assert.deepEqual(renderAssistantFaq(selected, [{ id: "8", name: "Deleted guide", deleted_at: "today" }], "en").recommendations, []);
	assert.equal(renderAssistantFaq(selected, [{ id: "8", name: "Current name" }], "en").recommendations[0].name, "Current name");
	const carer = ASSISTANT_FAQ_ENTRIES.find(item => item.id === "carer-upper-body");
	const answer = renderAssistantFaq(carer, [{ id: "dynamic-upper", name: "Current upper guide", categories: ["upper"], careTip: "CURRENT CARE TIP — stop if dizzy" }, { id: "lower", name: "Lower", categories: ["lower"], careTip: "UNRELATED" }], "en");
	assert.match(answer.reply, /do not pull her arm or force a larger movement/);
	assert.doesNotMatch(answer.reply, /CURRENT CARE TIP|UNRELATED/);
	assert.deepEqual(answer.recommendations.map(item => item.id), ["dynamic-upper"]);
});
test("urgent symptoms precede knowledge retrieval and no private history becomes FAQ output", () => {
	assert.match(assistantFaqAnswer({ message: "胸痛，呼吸困難，一星期做幾多運動？", catalog }).reply, /999/);
	const urgent = assistantFaqAnswer({ message: "腰痛和大小便失禁，可以用什麼器材？", catalog });
	assert.match(urgent.reply, /999/); assert.deepEqual(urgent.recommendations, []);
	for (const message of ["I have chest discomfort. What equipment can I use?", "Perineal numbness, can I use a bike?"]) {
		const warning = assistantFaqAnswer({ message, catalog, locale: "en" });
		assert.match(warning.reply, /999/); assert.deepEqual(warning.recommendations, []);
	}
	const answer = assistantFaqAnswer({ message: "How many days a week should I exercise and for how long?", locale: "en", catalog, history: [{ role: "user", content: "PRIVATE ACCOUNT RECORD SECRET" }] });
	assert.doesNotMatch(JSON.stringify(answer), /PRIVATE ACCOUNT RECORD SECRET/);
	assert.match(answer.reply, /no minimum 10-minute/); assert.match(answer.reply, /150–300/);
	assert.deepEqual(answer.knowledgeReferences, []);
	assert.doesNotMatch(JSON.stringify(answer), /https?:\/\//);
});
