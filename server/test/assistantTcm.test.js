import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { symptomProviderSelection } from './helpers/symptomProvider.js';

const GUIDE = JSON.parse(fs.readFileSync(new URL("../src/equipmentGuideEvidence.json", import.meta.url), "utf8"));
const SECRET = "assistant-tcm-isolated-test-only-secret";
const DIRECT = {
	zh: "肩關節伸展的中醫解釋",
	en: "What is the traditional Chinese medicine perspective on Shoulder stretch?",
};
const SHOULDER_REQUEST = {
	zh: "想活動肩膊，有什麼器材？",
	en: "Please suggest equipment for shoulder mobility.",
};
const FORGED = "FORGED_TCM_CONTENT_NOT_IN_THE_APP";
const recommendation = (answer, id) => answer.recommendations.find(item => item.id === id);

test("HTTP old APK concatenated TCM cannot bypass disabled fields through ordinary guide lookup", async () => fixture(async ({ ask, update, calls }) => {
	assert.equal((await update("19", { tcmEnabled: false })).status, 200);
	const result = await ask("肩關節伸展如何使用？", { equipment: [{ id: "19", description: `${FORGED} ${GUIDE["19"].zh.tcmTip}` }] });
	assert.equal(result.status, 200);
	assert.equal(result.data.source, "app_content");
	assert.ok(!JSON.stringify(result.data).includes(FORGED));
	assert.ok(!result.data.reply.includes("首選"));
	assert.ok(!result.data.reply.includes("肩髃"));
	assert.equal(recommendation(result.data, "19").tcmExcerpt, undefined);
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { configured: false }));

function assertOriginalExcerpt(item, original) {
	assert.ok(item, "the expected facility has an entry");
	assert.equal(item.tcmExcerpt?.field, "tcmTip");
	assert.equal(typeof item.tcmExcerpt.quote, "string");
	assert.ok(item.tcmExcerpt.quote.trim().length > 0, "an excerpt must not be blank");
	assert.ok(original.includes(item.tcmExcerpt.quote), "the excerpt must be a contiguous, verbatim original passage");
	assert.ok(!item.tcmExcerpt.quote.includes(FORGED));
}

function assertTcmInReply(answer, id, original) {
	const item = recommendation(answer, id);
	assertOriginalExcerpt(item, original);
	if (answer.tcmInReply !== true) {
		assert.equal(answer.equipmentReplyVersion, "app-equipment-prose-v1");
		assert.equal(typeof answer.equipmentReplyBase, "string");
	}
	assert.ok(answer.reply.includes(item.name), "the text identifies which facility the excerpt belongs to");
	assert.equal(answer.reply.split(item.tcmExcerpt.quote).length - 1, 1, "each TCM excerpt appears exactly once in the main reply");
}

function assertEvidenceInReply(answer, item, locale) {
	assert.ok(GUIDE[item.id][locale][item.evidence.field].includes(item.evidence.quote));
	assert.ok(answer.reply.includes(item.name));
	const facilitiesSharingQuote = answer.recommendations.filter(candidate => candidate.evidence?.quote === item.evidence.quote).length;
	const alreadyInIntroduction = answer.equipmentReplyBase?.includes(item.evidence.quote);
	assert.equal(answer.reply.split(item.evidence.quote).length - 1, alreadyInIntroduction ? 1 : facilitiesSharingQuote,
		'the exact primary evidence appears once in the introduction or once per facility; an already displayed identical passage is not duplicated');
}

async function fixture(run, { configured = true, generated = { reply: "Please open the matching Facility Guide.", recommendedIds: ["19"] } } = {}) {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString();
	for (const [id, role, phone] of [["reader", "participant", "+85269700201"], ["editor", "staff", "+85269700202"]]) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
			.run(id, id, phone, role, "unused", "unused", now, now);
	}
	database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('editor','operator',?,1,?,?)")
		.run(JSON.stringify(["app_maintenance.equipment.manage"]), now, now);
	database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'")
		.run(configured ? "test-key-never-sent" : "");
	const calls = { factory: 0, completion: 0 };
	let modelResult = generated;
	const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => {
		calls.factory += 1;
		return { chat: { completions: { create: async (body) => {
			calls.completion += 1;
			return { choices: [{ message: { content: JSON.stringify(symptomProviderSelection(body) || modelResult) } }] };
		} } } };
	} });
	const tokens = { reader: signToken({ id: "reader", profile_role: "participant" }, SECRET), editor: signToken({ id: "editor", profile_role: "staff" }, SECRET) };
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
	const request = async (path, { method = "POST", actor = "reader", body } = {}) => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
			method, headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		return { status: response.status, data: await response.json() };
	};
	const ask = (message, body = {}) => request("/api/assistant/chat", { body: { message, ...body } });
	const update = (id, body) => request(`/api/admin/equipment/${encodeURIComponent(id)}`, { method: "PUT", actor: "editor", body });
	const only = (...ids) => {
		database.exec("UPDATE app_equipment_items SET is_active=0");
		for (const id of ids) database.prepare("UPDATE app_equipment_items SET is_active=1 WHERE id=?").run(id);
	};
	try { await run({ database, request, ask, update, only, calls, setGenerated: value => { modelResult = value; } }); }
	finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

for (const locale of ["zh", "en"]) test(`HTTP direct ${locale} TCM question quotes Shoulder stretch ID 19 without DeepSeek or an API key`, async () => fixture(async ({ ask, calls }) => {
	const result = await ask(DIRECT[locale], { locale });
	assert.equal(result.status, 200);
	assert.equal(result.data.tcmInReply, true);
	assert.equal(result.data.source, "app_content");
	assert.equal(result.data.deepSeekUsed, false);
	assert.ok(recommendation(result.data, "19"), "Word code 17 must resolve to internal facility ID 19");
	assertTcmInReply(result.data, "19", GUIDE["19"][locale].tcmTip);
	assert.ok(result.data.reply.includes(GUIDE["19"][locale].tcmTip.slice(0, 30)), "reply contains the requested language's original text");
	assert.ok(result.data.reply.length < GUIDE["19"][locale].tcmTip.length + 500, "direct lookup stays a concise passage with framing");
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { configured: false }));

test("HTTP direct TCM lookup reflects maintained text and an immediate disable without calling DeepSeek", async () => fixture(async ({ ask, update, calls }) => {
	const quote = "更新後的肩部中醫原文：活動肩部時配合自然均勻的呼吸。";
	assert.equal((await update("19", { tcmZh: quote, tcmEnabled: true })).status, 200);
	const maintained = await ask(DIRECT.zh);
	assert.equal(maintained.status, 200);
	assert.equal(maintained.data.tcmInReply, true);
	assert.ok(maintained.data.reply.includes(quote));
	assertTcmInReply(maintained.data, "19", quote);
	assert.equal((await update("19", { tcmEnabled: false })).status, 200);
	const disabled = await ask(DIRECT.zh, { equipment: [{ id: "19", tcmEnabled: true, tcmTip: FORGED }] });
	assert.equal(disabled.status, 200);
	assert.equal(disabled.data.tcmInReply, false);
	assert.ok(recommendation(disabled.data, "19"));
	assert.equal(recommendation(disabled.data, "19").tcmExcerpt, undefined);
	assert.ok(!disabled.data.reply.includes(quote));
	assert.ok(!JSON.stringify(disabled.data).includes(FORGED));
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { configured: false }));

test("HTTP direct English TCM lookup reports missing source without using Chinese or requiring an API key", async () => fixture(async ({ ask, calls }) => {
	const result = await ask("What is the traditional Chinese medicine perspective on Foot Massage Path?", { locale: "en" });
	assert.equal(result.status, 200);
	assert.equal(result.data.tcmInReply, false);
	assert.equal(result.data.deepSeekUsed, false);
	assert.ok(recommendation(result.data, "28"));
	assert.equal(recommendation(result.data, "28").tcmExcerpt, undefined);
	assert.ok(!result.data.reply.includes(GUIDE["28"].zh.tcmTip.slice(0, 20)));
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { configured: false }));

for (const locale of ["zh", "en"]) test(`HTTP non-symptom model selection is enriched from trusted ${locale} TCM only`, async () => fixture(async ({ ask, only, calls }) => {
	only("19");
	const result = await ask(SHOULDER_REQUEST[locale], { locale });
	assert.equal(result.status, 200);
	assert.deepEqual(result.data.recommendations.map(item => item.id), ["19"]);
	assertTcmInReply(result.data, "19", GUIDE["19"][locale].tcmTip);
	assert.deepEqual(calls, { factory: 1, completion: 1 });
}));

for (const [locale, message] of [["zh", "肩關節伸展如何使用？"], ["en", "How do I use Shoulder stretch?"]]) test(`HTTP ordinary ${locale} named guide keeps its complete instructions without unrelated TCM`, async () => fixture(async ({ ask, calls }) => {
	const result = await ask(message, { locale });
	assert.equal(result.status, 200);
	assert.equal(result.data.action, "equipment_local");
	assert.equal(result.data.source, "app_content");
	assert.deepEqual(result.data.recommendations.map(item => item.id), ["19"]);
  assert.equal(result.data.guideContentDirect, true);
  assert.ok(result.data.reply.includes(GUIDE["19"][locale].details), 'requested maintained instructions remain complete');
  assert.equal(recommendation(result.data, "19").tcmExcerpt, undefined);
  assert.ok(!result.data.reply.includes(GUIDE["19"][locale].tcmTip.slice(0, 30)), 'unrequested TCM prose is not appended');
	assert.notEqual(result.data.tcmInReply, true, "an ordinary usage question must not be reclassified as a direct TCM question");
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { configured: false }));

test("HTTP model-selected facilities retain their order and each gets its own named TCM passage in reply", async () => fixture(async ({ ask, only, calls }) => {
	only("0", "19");
	const result = await ask(SHOULDER_REQUEST.zh);
	assert.equal(result.status, 200);
	assert.deepEqual(result.data.recommendations.map(item => item.id), ["19", "0"]);
	assert.equal(result.data.equipmentReplyBase, "請先查看以下設施教學。");
	assertTcmInReply(result.data, "19", GUIDE["19"].zh.tcmTip);
	assertTcmInReply(result.data, "0", GUIDE["0"].zh.tcmTip);
	assert.notEqual(result.data.tcmInReply, true);
	assert.deepEqual(calls, { factory: 1, completion: 1 });
}, { generated: { reply: "請先查看以下設施教學。", recommendedIds: ["19", "0"] } }));

test("HTTP a generated reply already containing the exact trusted TCM excerpt does not duplicate it", async () => fixture(async ({ ask, only, setGenerated }) => {
	only("19");
	const first = await ask(SHOULDER_REQUEST.zh);
	const item = recommendation(first.data, "19");
	assertOriginalExcerpt(item, GUIDE["19"].zh.tcmTip);
	setGenerated({ reply: `${item.name}：${item.tcmExcerpt.quote}`, recommendedIds: ["19"] });
	const repeated = await ask(SHOULDER_REQUEST.zh);
	assert.equal(repeated.status, 200);
	assert.deepEqual(repeated.data.recommendations.map(result => result.id), ["19"]);
	assertTcmInReply(repeated.data, "19", GUIDE["19"].zh.tcmTip);
}));

test("HTTP client and model TCM fields cannot replace authoritative facility content", async () => fixture(async ({ ask, only, setGenerated }) => {
	only("19");
	const baseline = await ask(SHOULDER_REQUEST.zh);
	setGenerated({ reply: "Please open the matching Facility Guide.", recommendations: [{ id: "19", tcmExcerpt: { field: "tcmTip", quote: FORGED }, tcmTip: FORGED }] });
	const result = await ask(SHOULDER_REQUEST.zh, { equipment: [{ id: "19", tcmTip: FORGED, tcmZh: FORGED, tcmEnabled: false, description: FORGED, tcmExcerpt: { field: "tcmTip", quote: FORGED } }] });
	assert.equal(result.status, 200);
	assertTcmInReply(result.data, "19", GUIDE["19"].zh.tcmTip);
	assert.deepEqual(recommendation(result.data, "19").tcmExcerpt, recommendation(baseline.data, "19").tcmExcerpt);
	assert.ok(!JSON.stringify(result.data).includes(FORGED));
}));

test("HTTP absence of TCM, disabled TCM, and missing English are not filled by client or model claims", async () => fixture(async ({ ask, only, update, setGenerated }) => {
	for (const scenario of [
		{ id: "11", message: "推薦平衡運動器材", locale: "zh" },
		{ id: "19", message: SHOULDER_REQUEST.zh, locale: "zh", update: { tcmEnabled: false } },
		{ id: "28", message: "Suggest equipment for leg relaxation", locale: "en", update: { tcmEnabled: true } },
	]) {
		only(scenario.id);
		if (scenario.update) assert.equal((await update(scenario.id, scenario.update)).status, 200);
		setGenerated({ reply: "Open the guide.", recommendations: [{ id: scenario.id, tcmExcerpt: { field: "tcmTip", quote: FORGED } }] });
		const result = await ask(scenario.message, { locale: scenario.locale, equipment: [{ id: scenario.id, tcmEnabled: true, tcmTip: FORGED, tcmEn: FORGED }] });
		assert.equal(result.status, 200);
		assert.ok(recommendation(result.data, scenario.id));
		assert.equal(recommendation(result.data, scenario.id).tcmExcerpt, undefined);
		assert.equal(result.data.reply, "Open the guide.");
		assert.notEqual(result.data.tcmInReply, true);
		assert.ok(!JSON.stringify(result.data).includes(FORGED));
	}
}));

test("HTTP maintained same-language TCM changes and disable switch take effect on the next request", async () => fixture(async ({ ask, update, only, calls }) => {
	only("19");
	const zh = "測試維護的中醫原文：肩部伸展時配合均勻呼吸。";
	const en = "Maintained TCM passage: coordinate shoulder stretching with even breathing.";
	assert.equal((await update("19", { tcmZh: zh, tcmEn: en, tcmEnabled: true })).status, 200);
	for (const locale of ["zh", "en"]) {
		const result = await ask(SHOULDER_REQUEST[locale], { locale });
		assert.equal(result.status, 200);
		assertTcmInReply(result.data, "19", locale === "zh" ? zh : en);
	}
	const replacement = "已更新中醫欄目原文：伸展肩部時保持自然呼吸。";
	assert.equal((await update("19", { tcmZh: replacement })).status, 200);
	const replaced = await ask(SHOULDER_REQUEST.zh);
	assertTcmInReply(replaced.data, "19", replacement);
	assert.ok(!replaced.data.reply.includes(zh));
	assert.equal((await update("19", { tcmEnabled: false })).status, 200);
	const disabled = await ask(SHOULDER_REQUEST.zh);
	assert.equal(recommendation(disabled.data, "19").tcmExcerpt, undefined);
	assert.ok(!disabled.data.reply.includes(replacement));
	assert.notEqual(disabled.data.tcmInReply, true);
	assert.deepEqual(calls, { factory: 4, completion: 4 });
}));

test("HTTP custom facility TCM is editable, can clear English, and never translates the retained Chinese", async () => fixture(async ({ request, only, ask, update, setGenerated }) => {
	only();
	const zh = "自訂測試肩部設施的中醫原文：活動時配合平穩呼吸。";
	const created = await request("/api/admin/equipment", { actor: "editor", body: { nameZh: "自訂測試肩台", nameEn: "Custom shoulder station", categories: ["upper", "mobility"], tcmZh: zh, tcmEn: "", tcmEnabled: true } });
	assert.equal(created.status, 201);
	const id = created.data.item.id;
	setGenerated({ reply: "Open the matching guide.", recommendedIds: [id] });
	assertTcmInReply((await ask(SHOULDER_REQUEST.zh)).data, id, zh);
	assert.equal(recommendation((await ask(SHOULDER_REQUEST.en, { locale: "en" })).data, id).tcmExcerpt, undefined);
	const en = "Custom TCM passage: breathe evenly while moving the shoulders.";
	assert.equal((await update(id, { tcmEn: en })).status, 200);
	assertTcmInReply((await ask(SHOULDER_REQUEST.en, { locale: "en" })).data, id, en);
	assert.equal((await update(id, { tcmEn: "" })).status, 200);
	const cleared = await ask(SHOULDER_REQUEST.en, { locale: "en" });
	assert.equal(cleared.status, 200);
	assert.equal(recommendation(cleared.data, id).tcmExcerpt, undefined);
	assert.ok(!JSON.stringify(cleared.data).includes(zh));
	assert.ok(!JSON.stringify(cleared.data).includes(en));
	assertTcmInReply((await ask(SHOULDER_REQUEST.zh)).data, id, zh);
}));

test("HTTP a symptom result already quoting TCM evidence does not duplicate a TCM excerpt", async () => fixture(async ({ request, only, ask, calls }) => {
	only();
	const quote = "這個伸展練習可以舒緩肩部疼痛和不適。";
	const created = await request("/api/admin/equipment", { actor: "editor", body: { nameZh: "測試肩部舒展台", categories: ["upper", "mobility"], tcmZh: quote, tcmEnabled: true } });
	assert.equal(created.status, 201);
	const result = await ask("肩膊痛，推薦器材");
	assert.equal(result.status, 200);
	const item = recommendation(result.data, created.data.item.id);
	assert.equal(item?.evidence?.field, "tcmTip");
	assert.equal(item.evidence.quote, quote);
	assert.equal(item.tcmExcerpt, undefined);
	assert.equal(result.data.reply.split(quote).length - 1, 1);
	assert.equal(result.data.deepSeekUsed, true);
	assert.deepEqual(calls, { factory: 1, completion: 1 });
}));

for (const [locale, question] of [
	["zh", "肩周炎可以用什麼器材？"], ["zh", "五十肩，請推薦器材"],
	["zh", "冷冻肩，有哪些器材？"], ["zh", "冷凍肩可以用什麼器材？"],
	["en", "I have frozen shoulder, please recommend equipment."],
]) test(`HTTP ${question} uses reviewed frozen-shoulder FAQ and includes internal ID 19 without a first-choice ranking`, async () => fixture(async ({ ask, calls }) => {
	const result = await ask(question, { locale });
	assert.equal(result.status, 200);
	assert.equal(result.data.evidencePolicy, "app-faq-reviewed-v1");
	assert.equal(result.data.faqId, "frozen-shoulder");
	assert.equal(result.data.deepSeekUsed, false);
	const item = recommendation(result.data, "19");
	assert.ok(item, "Shoulder stretch is internal ID 19, not the Word code 17");
	assert.match(result.data.reply, locale === "en" ? /assess/i : /評估/);
	assert.match(result.data.reply, locale === "en" ? /(?:force|forcing)/i : /(?:強拉|強迫|強行)/);
	assert.doesNotMatch(result.data.reply, /首選器材|首选器材|最佳器材|best equipment|first.choice equipment/i);
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}));

test("HTTP adding TCM excerpts keeps knee evidence relevant and continues to exclude Foot Massage Path", async () => fixture(async ({ ask, calls }) => {
	// Explicit FAQ help queries now use reviewed answers without model/TCM prose.
	for (const [locale, question] of [["zh", "膝頭哥痛，請推薦器材"], ["en", "My knees hurt, please recommend equipment"]]) {
		const result = await ask(question, { locale });
		assert.equal(result.status, 200);
		assert.deepEqual(result.data.recommendations.map(item => item.id), ["4", "10", "11"]);
		assertTcmInReply(result.data, "4", GUIDE["4"][locale].tcmTip);
		assertTcmInReply(result.data, "10", GUIDE["10"][locale].tcmTip);
		assert.equal(recommendation(result.data, "11").tcmExcerpt, undefined);
		for (const item of result.data.recommendations) assertEvidenceInReply(result.data, item, locale);
	}
	assert.deepEqual(calls, { factory: 2, completion: 2 });
}));

test("HTTP unpublished or deleted TCM facilities cannot be resurrected by generated IDs", async () => fixture(async ({ ask, request, update, only }) => {
	only("19");
	assert.equal((await update("19", { isActive: false })).status, 200);
	assert.deepEqual((await ask(SHOULDER_REQUEST.zh)).data.recommendations, []);
	assert.equal((await update("19", { isActive: true })).status, 200);
	assert.equal((await request("/api/admin/equipment/19", { method: "DELETE", actor: "editor" })).status, 200);
	const result = await ask(SHOULDER_REQUEST.zh, { equipment: [{ id: "19", isActive: true, tcmEnabled: true, tcmTip: FORGED }] });
	assert.equal(result.status, 200);
	assert.deepEqual(result.data.recommendations, []);
}));

test("HTTP direct TCM lookup still requires authentication", async () => fixture(async ({ request, calls }) => {
	const result = await request("/api/assistant/chat", { actor: null, body: { message: DIRECT.zh } });
	assert.equal(result.status, 401);
	assert.equal(result.data.error, "unauthorized");
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}));

test("HTTP retired photo identification returns a clear error without TCM or provider calls", async () => fixture(async ({ ask, calls, only }) => {
	only("19");
	const result = await ask("請辨識照片中的器材並提供中醫解釋", { imageData: "data:image/jpeg;base64,/9j/2Q==", equipment: [{ id: "19", tcmTip: FORGED, tcmEnabled: true }] });
	assert.equal(result.status, 400);
	assert.equal(result.data.error, "aiImageInputRetired");
	assert.equal(result.data.confirmationRequired, false);
	assert.deepEqual(result.data.recommendations, []);
	assert.notEqual(result.data.tcmInReply, true);
	assert.ok(!JSON.stringify(result.data).includes(FORGED));
	assert.ok(!result.data.reply.includes(GUIDE["19"].zh.tcmTip.slice(0, 20)));
	assert.deepEqual(calls, { factory: 0, completion: 0 });
}, { generated: { recognizedId: "19", tcmExcerpt: { field: "tcmTip", quote: FORGED } } }));
