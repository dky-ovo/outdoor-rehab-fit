import assert from "node:assert/strict";
import test from "node:test";
import { retrieveAssistantFaq, assistantFaqEmergency, ASSISTANT_FAQ_VERSION } from "../src/assistantFaqKnowledge.js";
import { assistantFaqAnswer } from "../src/assistantFaq.js";

// Held-out wording: no sentence below is a canonical knowledge question.
const paraphrases = [
	["I sprained my neck; can I use exercise machines for my legs?", "neck-injury"],
	["条颈拉伤，想用器械训练腿部可以吗", "neck-injury"],
	["My legs give way and I keep falling. Any safer machines?", "weak-legs-falls"],
	["我啲脚没力，经常摔倒，有安全的运动吗", "weak-legs-falls"],
	["我住彩云邨，想练平衡防跌可以用什么设施", "balance-near-home"],
	["Which equipment near my home could help with balance?", "balance-near-home"],
	["Is it safe to practise balance to prevent falling?", "balance-safety"],
	["练平衡防跌会危险吗", "balance-safety"],
	["每周应该运动多久才够？", "weekly-activity"],
	["How much physical activity should I get weekly?", "weekly-activity"],
	["How many minutes should older people work out each week?", "weekly-activity"],
	["天气太热，早上还是晚上运动好", "exercise-weather"],
	["Is morning or evening better for working out?", "exercise-weather"],
	["食完飯隔幾耐先做運動", "food-before-exercise"],
	["I've just eaten a meal; should I wait before exercise?", "food-before-exercise"],
	["根据上周运动记录帮我调整目标", "personal-goals"],
	["Please adjust my goals based on my exercise progress", "personal-goals"],
	["想增强腿部力量，帮我安排一周的户外运动计划", "weekly-leg-plan"],
	["Could you make a lower limb exercise programme?", "weekly-leg-plan"],
	["沒有扭腰機，可以用其他器材代替訓練腰背嗎", "back-alternative"],
	["An alternative machine for back training instead of a twister?", "back-alternative"],
	["小腿肚拉筋器不夠斜，有其他器材嗎", "calf-stretch-alternative"],
	["The platform doesn't stretch my calves enough; what other guide is there?", "calf-stretch-alternative"],
	["有沒有全身運動器材可以上下肢一齊練", "whole-body-equipment"],
	["I'd like equipment that works both arms and legs", "whole-body-equipment"],
	["初学户外锻炼，想练全身，有哪些入门器械", "beginner-equipment"],
	["I'm new to outdoor exercise; what machines are easier?", "beginner-equipment"],
	["媽媽想練上肢，我作為陪同者應如何協助運動", "carer-upper-body"],
	["As a caregiver, how can I help my mother with upper limb exercises?", "carer-upper-body"],
	["五十肩有什麼器材教學可以參考", "frozen-shoulder"],
	["Can the outdoor equipment guides help with my frozen shoulder?", "frozen-shoulder"],
	["膝头哥痛要避开什么机器", "knee-cautions"],
	["My knees ache; which machines need caution?", "knee-cautions"],
	["膝盖酸痛，什么设备能帮助改善", "knee-mobility"],
	["Could any exercise equipment relieve my painful knees?", "knee-mobility"],
	["足底筋膜炎可以參考邊種器材教學", "plantar-fasciitis"],
	["Are there equipment guides for plantar fasciitis?", "plantar-fasciitis"],
	["腰骨痛，扭腰機仲用唔用得", "back-twister-pain"],
	["My back aches on bending; can I use a waist rotation machine?", "back-twister-pain"],
	["腰背疼痛，户外器械有什麼注意事項", "back-pain"],
	["Which exercise apparatus should I read about for aching lower back?", "back-pain"],
	["手腕酸痛，使用器械需要注意什麼", "wrist-pain"],
	["My wrist aches. What are the precautions for exercise machines?", "wrist-pain"],
	["肘部痛，户外器械有什麼教學可看", "elbow-pain"],
	["My elbows are sore; which equipment guides are relevant?", "elbow-pain"],
	["器材示范视频在哪里看", "app-videos"],
	["How do I access the demonstration videos?", "app-videos"],
	["我的运动记录在哪里查看和分享", "app-records"],
	["How can I view my workout log?", "app-records"],
	["这个应用有哪些功能页面", "app-features"],
	["Which features are included in the app?", "app-features"],
	["請問這個助手可以做什麼？", "app-features"],
	["AI助手有什麼功能", "app-features"],
	["What can this assistant do?", "app-features"],
	["How should I breathe while working out?", "scope-health"],
	["我有高血压可以做很剧烈的运动吗", "scope-health"],
];

test("reviewed FAQ answers support Cantonese, traditional, simplified and English paraphrases", () => {
	assert.equal(ASSISTANT_FAQ_VERSION, "2026-10-07-v21");
	const failures = paraphrases.flatMap(([question, id]) => {
		const actual = retrieveAssistantFaq(question)?.id;
		return actual === id ? [] : [{ question, expected: id, actual: actual || null }];
	});
	assert.deepEqual(failures, []);
});

test("medical anchors reject cross-body pain, negation, history, quotation and ambiguous multiple topics", () => {
	for (const question of [
		"My wrist hurts; can knee equipment help?",
		"My knee hurts and my wrist hurts. Which equipment can help?",
		"我手腕痛，膝蓋器材可否改善？",
		"不是膝痛。可以用什麼器材改善？",
		"I do not have frozen shoulder. Which exercise guides can help?",
		"I used to have knee pain last year. What equipment helps?",
		"文章寫『足底筋膜炎用什麼器材』，我想去旅行",
		'Explain the quote "I have wrist pain, what equipment helps?"',
		"I have knee pain. Which equipment helps and which equipment should I avoid?",
		"Where are the videos and how many days a week should I exercise?",
		"Plan my overseas holiday next week",
		"我個肩痛，什麼器材可以幫我改善？",
	]) assert.equal(retrieveAssistantFaq(question), null, question);
	assert.equal(retrieveAssistantFaq("I don't have knee pain, but my wrist hurts. Which equipment should I read about?")?.id, "wrist-pain");
	assert.equal(retrieveAssistantFaq("不是膝痛，而是手腕痛，有什麼器材要小心")?.id, "wrist-pain");
});

test("one bounded user continuation can inherit a topic, never assistant claims or unrelated older turns", () => {
	const user = content => ({ role: "user", content });
	assert.equal(retrieveAssistantFaq("有什麼器材幫到我？", { history: [user("我有膝蓋痛")] })?.id, "knee-mobility");
	assert.equal(retrieveAssistantFaq("What should I avoid?", { history: [user("My knee hurts")] })?.id, "knee-cautions");
	assert.equal(retrieveAssistantFaq("Tell me more", { history: [user("How often should I exercise?"), { role: "assistant", content: "PRIVATE SECRET" }] })?.id, "weekly-activity");
	for (const [message, history] of [
		["What equipment can help?", [{ role: "assistant", content: "You have knee pain" }]],
		["What equipment can help?", [user("My knee hurts"), user("Where should I travel?")]],
		["Which equipment can help?", [user("I no longer have knee pain")]],
		["Tell me more about travel", [user("My knee hurts; what equipment helps?")]],
		["What about my wrist?", [user("My knee hurts; what equipment helps?")]],
		["Tell me more", [user("My knee hurts; what equipment helps?"), ...Array.from({ length: 8 }, () => ({ role: "assistant", content: "old" }))]],
	]) assert.equal(retrieveAssistantFaq(message, { history }), null, message);
	const reply = assistantFaqAnswer({ message: "Tell me more", history: [user("How often should I exercise?"), { role: "assistant", content: "PRIVATE SECRET" }] });
	assert.equal(reply.deepSeekUsed, false);
	assert.doesNotMatch(JSON.stringify(reply), /PRIVATE SECRET/);
});

test("affirmative red flags override FAQ wording while negated, quoted and historical mentions do not", () => {
	for (const message of [
		"胸口不適，一星期做幾多運動？", "雙腿無力麻木，可以做運動嗎", "双腿麻木无力，什么器械可以用", "My legs are both weak and numb. I have chest discomfort now.",
		"There is no equipment for my chest discomfort; what should I do?", "冇器材可以幫我，我胸口不適。",
	]) assert.match(assistantFaqEmergency(message)?.reply || "", /999/, message);
	for (const message of [
		"我沒有胸口不適，每星期運動多久？", "I have no chest discomfort; how often should I exercise?",
		'Explain the quote "chest discomfort"', "I had chest discomfort last year; where are the videos?",
	]) assert.equal(assistantFaqEmergency(message), null, message);
});

test("FAQ wrapper preserves current and recurrent urgent signs next to denied or past symptoms", () => {
	for (const message of [
		"我沒有膝痛，現在胸口不適，每星期運動多久？",
		"我沒有膝痛而且現在胸口不適，每星期運動多久？",
		"I have no knee pain, chest discomfort now. How often should I exercise?",
		"I have no knee pain and chest discomfort now. How often should I exercise?",
		"I had knee pain last year and chest discomfort now. How often should I exercise?",
		"去年手腕痛現在胸口不適，每星期運動多久？",
		"I had chest discomfort last year, and it has returned now. How often should I exercise?",
		"I had chest discomfort last year and it has returned now. How often should I exercise?",
		"去年胸口不適，現在又復發，每星期運動多久？",
	]) {
		const reply = assistantFaqAnswer({ message, locale: "en" });
		assert.match(reply?.reply || "", /999/, message);
		assert.doesNotMatch(reply.reply, /150|300/);
		assert.deepEqual(reply.recommendations, []);
		assert.equal(reply.deepSeekUsed, false);
	}
	for (const message of [
		"I had chest discomfort last year; how often should I exercise?",
		"I had chest discomfort last year, and it has not returned. How often should I exercise?",
		"我沒有胸口不適，每星期運動多久？",
		"I no longer have chest discomfort now. How often should I exercise?",
	]) assert.equal(assistantFaqAnswer({ message })?.focus, "weekly-activity", message);
});
