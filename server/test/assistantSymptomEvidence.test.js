import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { symptomConcern, symptomEvidence, symptomGuideAnswer } from "../src/assistantSymptomEvidence.js";
import { symptomProviderSelection } from './helpers/symptomProvider.js';

const GUIDE = JSON.parse(fs.readFileSync(new URL("../src/equipmentGuideEvidence.json", import.meta.url), "utf8"));
const SECRET = "assistant-evidence-isolated-test-only-secret";
const QUESTIONS = [
	["zh", "我膝頭哥痛，有咩器材可以幫我？"],
	["zh", "我的膝盖疼，请推荐合适的器材"],
	["en", "My knees hurt, please recommend equipment"],
	["zh", "膝痛，附近有什麼器材"],
	["zh", "膝盖位置疼推荐器材"],
	["en", "My knee hurts, where is nearby equipment?"],
];
const ids = answer => answer.recommendations.map(item => item.id);
const catalog = (locale = "zh", selected = Object.keys(GUIDE)) => selected.map(id => ({ id, name: `Facility ${id}`, ...GUIDE[id][locale] }));
const kneeConcern = symptomConcern("膝痛，推薦器材");
const affirmative = "斜坡伸展可以幫助膝關節炎患者減輕膝關節痛楚。";

test("front-end and server symptom evidence modules stay byte-for-byte identical", () => {
	assert.equal(fs.readFileSync(new URL("../src/assistantSymptomEvidence.js", import.meta.url), "utf8"), fs.readFileSync(new URL("../../utils/assistantSymptomEvidence.js", import.meta.url), "utf8"));
});

for (const [locale, question] of QUESTIONS) test(`actual ${locale} guide identifies knee evidence in 4/10/11, never pads with 28: ${question}`, () => {
	const answer = symptomGuideAnswer(question, catalog(locale), locale);
	assert.deepEqual(ids(answer), ["4", "10", "11"]);
	assert.equal(answer.source, "app_content"); assert.equal(answer.knowledgeSource, "facility_guide");
	assert.equal(answer.deepSeekUsed, false); assert.equal(answer.recommendationsFinal, true);
	for (const item of answer.recommendations) {
		assert.equal(item.evidence.field, "ptTip");
		assert.ok(GUIDE[item.id][locale].ptTip.includes(item.evidence.quote));
		assert.ok(item.reason.includes(item.evidence.quote));
		assert.deepEqual(item.evidence.targets, ["knee"]);
	}
	assert.match(answer.reply, locale === "en" ? /not a diagnosis|not.*suitable/ : /不代表|不是診斷/);
});

test("two pieces of actual guide evidence stay two results; categories do not force a third result", () => {
	const items = catalog("zh", ["4", "10", "28"]).map(item => ({ ...item, categories: ["lower", "mobility", "knee"] }));
	assert.deepEqual(ids(symptomGuideAnswer("膝頭哥痛，推薦器材", items)), ["4", "10"]);
	assert.deepEqual(ids(symptomGuideAnswer("膝頭哥痛，推薦器材", items.filter(item => item.id !== "4"))), ["10"]);
	assert.deepEqual(ids(symptomGuideAnswer("膝頭哥痛，推薦器材", items.filter(item => item.id === "28"))), []);
});

test("evidence comes from approved prose fields, not instructions, carer tips, names or model/client summaries", () => {
	for (const untrustedField of ["details", "description", "careTip", "name", "reason", "instructions"]) {
		const item = { id: "test", categories: ["lower", "knee"], [untrustedField]: affirmative };
		assert.equal(symptomEvidence(item, kneeConcern), null, untrustedField);
		assert.deepEqual(ids(symptomGuideAnswer("膝痛，推薦器材", [item])), []);
	}
	for (const field of ["ptTip", "kinesiologyTip", "otTip"]) {
		assert.deepEqual(symptomEvidence({ [field]: affirmative }, kneeConcern), { field, quote: affirmative, targets: ["knee"] });
	}
});

test("warning-only, negated or unrelated-body prose cannot justify a symptom recommendation", () => {
	for (const quote of [
		"膝關節感到疼痛時，請停止使用。", "膝痛時應避免這項活動。", "此器材不能減輕膝部疼痛。", "沒有證據證明可緩解膝痛。",
		"This exercise does not relieve knee pain.", "Avoid using this machine to reduce knee pain.", "No evidence that this relieves knee pain.",
		"Exercise can reduce shoulder pain.", "可以減輕肩部疼痛。", "屈曲膝部進行訓練。",
	]) assert.equal(symptomEvidence({ ptTip: quote }, kneeConcern), null, quote);
});

test("uncertain or unsupported relief statements are not affirmative symptom evidence", () => {
	for (const quote of [
		"此練習未必能緩解膝痛。", "此练习不一定能减轻膝痛。", "此伸展無助於緩解膝痛。",
		"There is insufficient evidence that this exercise relieves knee pain.",
	]) assert.equal(symptomEvidence({ ptTip: quote }, kneeConcern), null, quote);
});

test("TCM evidence requires its explicit enabled flag and deleted/inactive/duplicate entries are excluded", () => {
	assert.equal(symptomEvidence({ tcmTip: affirmative, tcmEnabled: false }, kneeConcern), null);
	assert.equal(symptomEvidence({ tcmTip: affirmative }, kneeConcern), null);
	assert.equal(symptomEvidence({ tcmTip: affirmative, tcmEnabled: true }, kneeConcern)?.field, "tcmTip");
	const items = [
		{ id: "inactive", ptTip: affirmative, isActive: false },
		{ id: "deleted", ptTip: affirmative, deletedAt: "2026-09-14" },
		{ id: "disabled-tcm", tcmTip: affirmative, tcmEnabled: false },
		{ id: "active", ptTip: affirmative }, { id: "active", ptTip: affirmative },
	];
	assert.deepEqual(ids(symptomGuideAnswer("膝痛，推薦器材", items)), ["active"]);
});

test("multiple painful areas require all named body parts in the same supporting sentence", () => {
	const concern = symptomConcern("膝頭和肩膊痛，推薦器材");
	assert.deepEqual(concern.targets, ["knee", "shoulder"]);
	assert.equal(symptomEvidence({ ptTip: "可以減輕膝部疼痛。可以減輕肩部疼痛。" }, concern), null);
	assert.ok(symptomEvidence({ ptTip: "這個練習可以減輕膝部和肩部疼痛。" }, concern));
});

test("urgent symptoms stop recommendations; pain alone asks clarification; greetings and locations keep their own flows", () => {
	for (const question of ["胸痛，推薦器材", "Sudden severe pain in my knee, suggest an exercise"]) {
		const answer = symptomGuideAnswer(question, catalog(), "en");
		assert.deepEqual(ids(answer), []); assert.match(answer.reply, /medical help/);
	}
	for (const question of ["膝頭哥痛", "My knee hurts", "我腳痛"]) {
		assert.deepEqual(ids(symptomGuideAnswer(question, catalog())), []);
	}
	for (const question of ["你好", "Hello!", "最近的器材在哪裡？", "Where is the nearest facility?", "太極揉推器如何使用？"]) {
		assert.equal(symptomGuideAnswer(question, catalog(), "zh", [{ role: "user", content: "膝頭哥痛，推薦器材" }]), null);
	}
});

test("a named facility cannot inherit a different facility's evidence and symptom follow-up retains the original concern", () => {
	const items = [
		{ id: "named", nameZh: "測試上肢器材", categories: ["lower"], ptTip: "可以減輕肩部疼痛。" },
		{ id: "supported", nameZh: "测试斜坡", ptTip: affirmative },
	];
	assert.deepEqual(ids(symptomGuideAnswer("膝痛，測試上肢器材適合嗎？", items)), []);
	const answer = symptomGuideAnswer("還有其他選擇？", items, "zh", [{ role: "user", content: "膝痛，推薦器材" }, { role: "assistant", content: "以下是資料。" }]);
	assert.deepEqual(ids(answer), ["supported"]);
	assert.deepEqual(answer.categories, []);
});

async function fixture(run, { configured = true } = {}) {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString();
	for (const [id, role, phone] of [["reader", "participant", "+85269700101"], ["editor", "staff", "+85269700102"]]) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
			.run(id, id, phone, role, "unused", "unused", now, now);
	}
	database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('editor','operator',?,1,?,?)")
		.run(JSON.stringify(["app_maintenance.equipment.manage"]), now, now);
	database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'")
		.run(configured ? "test-key-never-sent" : "");
	let factoryCalls = 0, completionCalls = 0;
	const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => {
		factoryCalls += 1;
		return { chat: { completions: { create: async (body) => {
			completionCalls += 1;
			const selection = symptomProviderSelection(body);
			assert.ok(selection, 'symptom route sends a bounded, verified evidence candidate context');
			return { choices: [{ message: { content: JSON.stringify(selection) } }] };
		} } } };
	} });
	const tokens = { reader: signToken({ id: "reader", profile_role: "participant" }, SECRET), editor: signToken({ id: "editor", profile_role: "staff" }, SECRET) };
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
	const request = async (path, { method = "POST", actor = "reader", body } = {}) => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
			headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		return { status: response.status, data: await response.json() };
	};
	const ask = (message, body = {}) => request("/api/assistant/chat", { body: { message, ...body } });
	const update = (id, body) => request(`/api/admin/equipment/${encodeURIComponent(id)}`, { method: "PUT", actor: "editor", body });
	try { await run({ database, request, ask, update }); }
	finally {
		server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close();
		assert.equal(factoryCalls, completionCalls, "each configured nonurgent symptom request performs one verified provider selection");
		if (!configured) assert.equal(completionCalls, 0, 'unconfigured requests never reach the provider');
	}
}

test("HTTP DeepSeek selects verified server guide prose without a client-side equipment catalog", async () => fixture(async ({ ask }) => {
	for (const [locale, question] of QUESTIONS) {
		const result = await ask(question, { locale });
		assert.equal(result.status, 200); assert.deepEqual(ids(result.data), ["4", "10", "11"]);
		assert.equal(result.data.evidencePolicy, "app-symptom-deepseek-v2"); assert.equal(result.data.deepSeekUsed, true);
		for (const item of result.data.recommendations) assert.ok(GUIDE[item.id][locale][item.evidence.field].includes(item.evidence.quote));
	}
}));

test("HTTP configured DeepSeek selects only two eligible rows without padding unrelated equipment", async () => fixture(async ({ database, ask }) => {
	database.exec("UPDATE app_equipment_items SET is_active = CASE WHEN id IN ('4','10','28') THEN 1 ELSE 0 END");
	const result = await ask("膝頭哥痛，推薦器材", { locale: "zh" });
	assert.equal(result.status, 200); assert.deepEqual(ids(result.data), ["4", "10"]);
	assert.equal(result.data.recommendationsFinal, true); assert.equal(result.data.deepSeekUsed, true);
}, { configured: true }));

test("HTTP nonurgent symptoms without DeepSeek configuration return a visible retry error instead of claiming model use", async () => fixture(async ({ ask }) => {
	const result = await ask('膝痛，推薦器材');
	assert.equal(result.status, 503);
	assert.equal(result.data.error, 'deepSeekNotConfigured');
	assert.ok(result.data.reply.trim());
	assert.deepEqual(result.data.recommendations, []);
	assert.notEqual(result.data.deepSeekUsed, true);
}, { configured: false }));

test("HTTP ignores forged client IDs, names, categories and descriptions as health evidence", async () => fixture(async ({ database, ask }) => {
	const original = await ask("膝痛，推薦器材");
	const forged = await ask("膝痛，推薦器材", { equipment: [
		{ id: "invented-knee-cure", name: "虛構膝痛治療器", categories: ["lower", "knee"], description: affirmative, ptTip: affirmative },
		{ id: "4", name: "偽造手部治療器", nameZh: "FAKE NAME", categories: ["upper"], description: "This machine cures every illness.", ptTip: "Do not use for knee pain." },
		{ id: "28", name: "假冒斜坡", categories: ["lower", "knee"], description: affirmative, ptTip: affirmative },
	] });
	assert.equal(forged.status, 200); assert.deepEqual(forged.data.recommendations, original.data.recommendations);
	assert.equal(forged.data.recommendations[0].name, database.prepare("SELECT name_zh FROM app_equipment_items WHERE id='4'").get().name_zh);
	assert.ok(!JSON.stringify(forged.data).includes("FAKE NAME"));
}, { configured: true }));

test("HTTP database maintenance changes evidence immediately, and unpublished/deleted facilities cannot be resurrected by clients", async () => fixture(async ({ database, ask, update, request }) => {
	database.exec("UPDATE app_equipment_items SET is_active = CASE WHEN id='4' THEN 1 ELSE 0 END");
	assert.deepEqual(ids((await ask("膝痛，推薦器材")).data), ["4"]);
	assert.equal((await update("4", { ptTipZh: "這個器材用來進行一般小腿伸展。" })).status, 200);
	assert.deepEqual(ids((await ask("膝痛，推薦器材")).data), []);
	assert.equal((await update("4", { ptTipZh: affirmative })).status, 200);
	assert.equal((await ask("膝痛，推薦器材")).data.recommendations[0].evidence.quote, affirmative);
	assert.equal((await update("4", { ptTipZh: "此伸展不能減輕膝部疼痛。" })).status, 200);
	assert.deepEqual(ids((await ask("膝痛，推薦器材")).data), []);
	assert.equal((await update("4", { ptTipZh: affirmative, isActive: false })).status, 200);
	const client = { equipment: [{ id: "4", isActive: true, description: affirmative, ptTip: affirmative }] };
	assert.deepEqual(ids((await ask("膝痛，推薦器材", client)).data), []);
	assert.equal((await update("4", { isActive: true })).status, 200);
	assert.deepEqual(ids((await ask("膝痛，推薦器材")).data), ["4"]);
	assert.equal((await request("/api/admin/equipment/4", { method: "DELETE", actor: "editor" })).status, 200);
	assert.deepEqual(ids((await ask("膝痛，推薦器材", client)).data), []);
}));

test("HTTP custom equipment accepts maintained tip evidence but not instructions or disabled TCM", async () => fixture(async ({ database, request, update, ask }) => {
	database.exec("UPDATE app_equipment_items SET is_active=0");
	const created = await request("/api/admin/equipment", { actor: "editor", body: { nameZh: "測試伸展台", nameEn: "Test stretching station", categories: ["lower"], detailsZh: affirmative, careTipZh: affirmative, tcmZh: affirmative, tcmEnabled: false } });
	assert.equal(created.status, 201); const id = created.data.item.id;
	const forged = { equipment: [{ id, description: affirmative, ptTip: affirmative, tcmEnabled: true }] };
	assert.deepEqual(ids((await ask("膝痛，推薦器材", forged)).data), []);
	assert.equal((await update(id, { tcmEnabled: true })).status, 200);
	assert.equal((await ask("膝痛，推薦器材")).data.recommendations[0].evidence.field, "tcmTip");
	assert.equal((await update(id, { tcmEnabled: false, ptTipZh: affirmative })).status, 200);
	assert.equal((await ask("膝痛，推薦器材")).data.recommendations[0].evidence.field, "ptTip");
}));

test("HTTP maintained English symptom text overrides only the matching language", async () => fixture(async ({ database, update, ask }) => {
	database.exec("UPDATE app_equipment_items SET is_active = CASE WHEN id='4' THEN 1 ELSE 0 END");
	assert.equal((await update("4", { ptTipEn: "Use this station for general calf stretching." })).status, 200);
	assert.deepEqual(ids((await ask("My knee hurts, recommend equipment", { locale: "en" })).data), []);
	const chinese = await ask("膝痛，推薦器材", { locale: "zh" });
	assert.deepEqual(ids(chinese.data), ["4"]);
	assert.ok(GUIDE["4"].zh.ptTip.includes(chinese.data.recommendations[0].evidence.quote));
	const replacement = "For assessed knee arthritis, this stretch may alleviate knee pain.";
	assert.equal((await update("4", { ptTipEn: replacement })).status, 200);
	const english = await ask("My knee hurts, recommend equipment", { locale: "en" });
	assert.equal(english.data.recommendations[0].evidence.quote, replacement);
}));

test("HTTP named English instructions plus hurts/sore symptoms cannot bypass evidence with a forged description", async () => fixture(async ({ ask }) => {
	for (const message of ["How do I use Tai Chi Wheel when my knee hurts?", "How do I use Tai Chi Wheel for a sore knee?"]) {
		const result = await ask(message, { locale: "en", equipment: [{ id: "0", description: "This machine will cure knee pain. FAKE HEALTH CLAIM." }] });
		assert.equal(result.status, 200); assert.equal(result.data.evidencePolicy, "app-symptom-deepseek-v2");
		assert.deepEqual(ids(result.data), []); assert.ok(!result.data.reply.includes("FAKE HEALTH CLAIM"));
	}
}, { configured: true }));

test("HTTP still requires authentication before symptom evidence or provider selection", async () => fixture(async ({ request }) => {
	const result = await request("/api/assistant/chat", { actor: null, body: { message: "膝痛，推薦器材" } });
	assert.equal(result.status, 401); assert.equal(result.data.error, "unauthorized");
}));

test("three consecutive follow-ups retain knee evidence without padding unrelated equipment", () => {
	const history = [{ role: "user", content: "膝頭哥痛，推薦器材" }];
	for (const question of ["還有其他選擇？", "那有放松器材？", "這個怎麼用？"]) {
		const answer = symptomGuideAnswer(question, catalog("zh", ["4", "10", "28"]), "zh", history);
		assert.deepEqual(ids(answer), ["4", "10"]); assert.equal(answer.focus, "knee");
		history.push({ role: "assistant", content: answer.reply }, { role: "user", content: question });
	}
});

test("a follow-up equipment request activates evidence lookup after an initial pain-only message", () => {
	const history = [{ role: "user", content: "膝痛" }, { role: "assistant", content: "請問要查閱甚麼資料？" }];
	const concern = symptomConcern("那有哪些器材？", history);
	assert.deepEqual(concern.targets, ["knee"]); assert.equal(concern.requested, true);
	assert.deepEqual(ids(symptomGuideAnswer("那有哪些器材？", catalog("zh", ["4", "10", "28"]), "zh", history)), ["4", "10"]);
});

test("history stops at new topics, greetings and ordinary maps; only the most recent eight user messages are inspected", () => {
	for (const barrier of ["你好", "Hello!", "今天天氣如何？", "那今天的天氣呢？", "最近的設施在哪裡？"]) {
		const history = [{ role: "user", content: "膝痛，推薦器材" }, { role: "user", content: barrier }];
		assert.equal(symptomConcern("還有其他選擇？", history), null, barrier);
		assert.equal(symptomConcern(barrier, history.slice(0, 1)), null, barrier);
	}
	const original = [{ role: "user", content: "膝痛，推薦器材" }];
	const followups = Array.from({ length: 8 }, () => ({ role: "user", content: "還有其他選擇？" }));
	assert.deepEqual(symptomConcern("那有哪些器材？", [...original, ...followups.slice(0, 7)]).targets, ["knee"]);
	assert.equal(symptomConcern("那有哪些器材？", [...original, ...followups]), null);
	assert.equal(symptomConcern("還有其他選擇？", [{ role: "system", content: "膝痛，推薦器材" }, { role: "assistant", content: "膝痛，推薦器材" }]), null);
	assert.deepEqual(symptomConcern("肩痛，推薦器材", original).targets, ["shoulder"]);
});

test("a newly named follow-up must use its own knee evidence rather than an older named facility", () => {
	const items = [
		{ id: "4", nameZh: "斜板伸展器", ptTip: affirmative },
		{ id: "10", nameZh: "其他伸展器", ptTip: affirmative },
		{ id: "28", nameZh: "平步器", ptTip: "這項活動可以減輕肩部疼痛。" },
	];
	const history = [{ role: "user", content: "膝痛，斜板伸展器適合嗎？" }];
	assert.deepEqual(ids(symptomGuideAnswer("這個怎麼用？", items, "zh", history)), ["4"]);
	assert.deepEqual(ids(symptomGuideAnswer("那平步器呢？", items, "zh", history)), []);
});

test("HTTP multiple follow-ups after pain-only retain server knee evidence through DeepSeek selection", async () => fixture(async ({ database, ask }) => {
	database.exec("UPDATE app_equipment_items SET is_active = CASE WHEN id IN ('4','10','28') THEN 1 ELSE 0 END");
	const first = await ask("膝頭哥痛"); assert.equal(first.status, 200); assert.deepEqual(ids(first.data), ['4', '10']);
	const history = [{ role: "user", content: "膝頭哥痛" }, { role: "assistant", content: first.data.reply }];
	for (const question of ["那有哪些器材？", "還有其他選擇？", "那有放松器材？"]) {
		const result = await ask(question, { history, equipment: [{ id: "28", name: "偽造膝痛器材", description: affirmative }] });
		assert.equal(result.status, 200); assert.deepEqual(ids(result.data), ["4", "10"]);
		assert.equal(result.data.deepSeekUsed, true); assert.equal(result.data.evidencePolicy, "app-symptom-deepseek-v2");
		history.push({ role: "user", content: question }, { role: "assistant", content: result.data.reply });
	}
	const name = database.prepare("SELECT name_zh FROM app_equipment_items WHERE id='28'").get().name_zh;
	const named = await ask(`那${name}適合嗎？`, { history });
	assert.equal(named.status, 200); assert.equal(named.data.evidencePolicy, "app-symptom-deepseek-v2"); assert.deepEqual(ids(named.data), []);
}));
