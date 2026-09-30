import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { deepSeekSymptomRecommendations } from "../src/assistantSymptomRecommendations.js";

const SECRET = "isolated-recommendation-context-test";
const result = value => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value), reasoning_content: "PRIVATE_REASONING" } }] });
const context = body => JSON.parse(body.messages.find(message => message.role === "user").content);
const selection = (body, ids) => {
	const candidates = context(body).candidates;
	return { style: "follow_up", recommendations: (ids ? ids.map(id => candidates.find(item => item.id === id)).filter(Boolean) : candidates.slice(0, 3)).map(({ id, evidence }) => ({ id, evidence })) };
};
async function fixture(run, { configured = true, respond = body => result(selection(body)) } = {}) {
	const database = createDatabase(":memory:"); const now = new Date().toISOString();
	database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
		.run("reader", "PRIVATE_ACCOUNT_NAME", "+85269709991", "participant", "PRIVATE_SALT", "PRIVATE_HASH", now, now);
	database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'").run(configured ? "PRIVATE_API_KEY" : "");
	const calls = [];
	const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => ({ chat: { completions: { create: async (body, options) => {
		calls.push(body); return respond(body, calls.length, database, options);
	} } } }) });
	const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
	const ask = async (message, extra = {}) => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${signToken({ id: "reader" }, SECRET)}` }, body: JSON.stringify({ message, ...extra }) });
		return { status: response.status, data: await response.json() };
	};
	try { await run({ ask, database, calls }); }
	finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("screenshot leg -> knee -> walking pain goes through DeepSeek each turn and keeps useful guide links", async () => fixture(async ({ ask, calls }) => {
	const history = [];
	for (const question of ["我现在腿痛建议使用什么器械", "膝盖", "走路痛", "推荐器材"]) {
		const response = await ask(question, { history });
		assert.equal(response.status, 200); assert.equal(response.data.deepSeekUsed, true);
		assert.equal(response.data.evidencePolicy, "app-symptom-deepseek-v2"); assert.ok(response.data.recommendations.length);
		assert.ok(!response.data.recommendations.some(item => item.id === "28"));
		assert.ok(!/請問具體|請告訴我不適的部位/.test(response.data.reply));
		history.push({ role: "user", content: question }, { role: "assistant", content: response.data.reply });
	}
	assert.equal(calls.length, 4); assert.deepEqual(context(calls[2]).concern.targets, ["knee"]);
	assert.ok(context(calls[2]).previousUserQuestions.includes("膝盖"));
}));
test("model can select a relevant candidate beyond the former fixed first three, preserving order", async () => fixture(async ({ ask, calls }) => {
	const response = await ask("膝痛推薦器材"); assert.equal(response.status, 200);
	assert.deepEqual(response.data.recommendations.map(item => item.id), ["25", "10"]);
	assert.ok(context(calls[0]).candidates.length > 3); assert.ok(response.data.reply.includes(response.data.recommendations[0].name));
}, { respond: body => result(selection(body, ["25", "10"])) }));
test("continued explanations preserve the original symptom through the same public-context contract", async () => fixture(async ({ ask, calls }) => {
	const history = [{ role: "user", content: "膝蓋痛推薦器材" }];
	for (const question of ["继续", "詳細", "more details"]) {
		const response = await ask(question, { history });
		assert.equal(response.status, 200); assert.equal(response.data.deepSeekUsed, true);
		assert.ok(response.data.recommendations.length); assert.deepEqual(context(calls.at(-1)).concern.targets, ["knee"]);
		assert.equal(context(calls.at(-1)).question, question);
		history.push({ role: "user", content: question }, { role: "assistant", content: response.data.reply });
	}
	assert.equal(calls.length, 3);
}));
test("colloquial follow-ups share the same exact symptom parser as the APP", async () => fixture(async ({ ask, calls }) => {
	for (const question of ["继续说", "详细介绍一下", "再讲详细点", "可以講詳細啲？"]) {
		const response = await ask(question, { history: [{ role: "user", content: "膝蓋痛推薦器材" }, { role: "user", content: "走路痛" }] });
		assert.equal(response.status, 200); assert.equal(response.data.evidencePolicy, "app-symptom-deepseek-v2");
		assert.ok(response.data.recommendations.length); assert.deepEqual(context(calls.at(-1)).concern.targets, ["knee"]);
		assert.equal(context(calls.at(-1)).question, question);
	}
}));
test("a continuation prefix followed by a new topic must not be remapped into the old symptom", async () => fixture(async ({ ask, calls }) => {
	const response = await ask("继续聊旅游", { history: [{ role: "user", content: "膝蓋痛推薦器材" }] });
	assert.notEqual(response.data.evidencePolicy, "app-symptom-deepseek-v2");
	assert.deepEqual(response.data.recommendations, []);
	assert.ok(calls.every(call => !call.messages.some(message => typeof message.content === "string" && message.content.includes('"contextQuestions"'))));
}, { respond: () => result({ reply: "請告訴我想查詢的資料。", recommendations: [] }) }));
test("English requests and body-only followups retain context and use only English evidence", async () => fixture(async ({ ask, calls }) => {
	let history = [{ role: "user", content: "My leg hurts, recommend equipment" }];
	for (const question of ["knee", "when walking", "recommend equipment"]) {
		const response = await ask(question, { history, locale: "en" }); assert.equal(response.status, 200);
		assert.ok(response.data.recommendations.length); assert.ok(!/[\u4e00-\u9fff]/.test(response.data.reply));
		history.push({ role: "user", content: question });
	}
	assert.equal(calls.length, 3);
}));
test("model receives only public evidence and current user's text, not account fields or forged client catalog", async () => fixture(async ({ ask, calls }) => {
	const response = await ask("膝痛推薦器材", { equipment: [{ id: "28", ptTip: "FAKE_CLIENT_EVIDENCE" }], privateData: "FAKE_PRIVATE_INPUT", permissions: ["read_users"] });
	assert.equal(response.status, 200); const sent = JSON.stringify(calls);
	for (const secret of ["PRIVATE_ACCOUNT_NAME", "PRIVATE_SALT", "PRIVATE_HASH", "PRIVATE_API_KEY", "FAKE_CLIENT_EVIDENCE", "FAKE_PRIVATE_INPUT", "read_users"]) assert.ok(!sent.includes(secret), secret);
	assert.ok(!JSON.stringify(response.data).includes("PRIVATE_REASONING"));
	assert.equal(calls[0].response_format.type, "json_object"); assert.equal(calls[0].stream, false);
}));
test("free generated cures and instructions never become factual explanations", async () => fixture(async ({ ask }) => {
	const response = await ask("膝痛推薦器材"); assert.equal(response.status, 200);
	assert.ok(!response.data.reply.includes("MODEL_CURES_EVERYTHING"));
	for (const card of response.data.recommendations) assert.ok(response.data.reply.includes(card.evidence.quote));
}, { respond: body => result({ ...selection(body), reply: "MODEL_CURES_EVERYTHING", reason: "MODEL_CURES_EVERYTHING" }) }));
test("empty selection with eligible guides gets one bounded model repair, not a clarification loop", async () => fixture(async ({ ask, calls }) => {
	const response = await ask("膝痛推薦器材"); assert.equal(response.status, 200); assert.ok(response.data.recommendations.length); assert.equal(calls.length, 2);
}, { respond: (body, round) => result(round === 1 ? { style: "direct", recommendations: [] } : selection(body)) }));
for (const bad of ["unknown", "foot-path", "altered-quote", "empty", "truncated"]) test(`invalid model ${bad} cannot become an unsupported recommendation`, async () => fixture(async ({ ask, calls }) => {
	const response = await ask("膝痛推薦器材"); assert.equal(response.status, 502); assert.equal(response.data.error, "deepSeekInvalidResponse"); assert.deepEqual(response.data.recommendations, []); assert.equal(calls.length, 2);
}, { respond: body => {
	const value = selection(body);
	if (bad === "unknown") value.recommendations[0].id = "invented";
	if (bad === "foot-path") value.recommendations[0].id = "28";
	if (bad === "altered-quote") value.recommendations[0].evidence = { field: "ptTip", quote: "腳底按摩治好膝痛" };
	if (bad === "empty") value.recommendations = [];
	const response = result(value); if (bad === "truncated") response.choices[0].finish_reason = "length"; return response;
} }));
test("unknown anatomy asks only for the genuinely missing body part; no related prose returns no invented guides", async () => fixture(async ({ ask, database, calls }) => {
	const unknown = await ask("好痛推薦器材"); assert.equal(unknown.status, 200); assert.deepEqual(unknown.data.recommendations, []); assert.match(unknown.data.reply, /部位/);
	database.exec("UPDATE app_equipment_items SET is_active=0");
	const unsupported = await ask("膝痛推薦器材"); assert.equal(unsupported.status, 200); assert.deepEqual(unsupported.data.recommendations, []); assert.match(unsupported.data.reply, /未找到/);
	assert.equal(calls.length, 2);
}));
test("missing key and provider outage are explicit failures, not fake local DeepSeek recommendations", async () => {
	await fixture(async ({ ask, calls }) => { const response = await ask("膝痛推薦器材"); assert.equal(response.status, 503); assert.equal(response.data.error, "deepSeekNotConfigured"); assert.equal(calls.length, 0); }, { configured: false });
	await fixture(async ({ ask }) => { const response = await ask("膝痛推薦器材"); assert.equal(response.status, 502); assert.equal(response.data.error, "deepSeekUnavailable"); }, { respond: () => { throw new Error("offline"); } });
});
test("urgent symptoms and short recommendations after them keep an immediate warning without provider calls", async () => fixture(async ({ ask, calls }) => {
	const history = [];
	for (const question of ["突然劇痛，無法站立", "膝盖", "推荐器材"]) {
		const response = await ask(question, { history }); assert.equal(response.status, 200); assert.deepEqual(response.data.recommendations, []); assert.equal(response.data.deepSeekUsed, false); assert.match(response.data.reply, /醫護/);
		history.push({ role: "user", content: question });
	}
	assert.equal(calls.length, 0);
}));
for (const edit of ["pt_tip_zh='內容已變更'", "is_active=0", "deleted_at='2026-09-22'"]) test(`maintenance ${edit} during model response cannot return stale evidence`, async () => fixture(async ({ ask }) => {
	const response = await ask("膝痛推薦器材"); assert.equal(response.status, 502); assert.equal(response.data.error, "deepSeekInvalidResponse"); assert.deepEqual(response.data.recommendations, []);
}, { respond: (body, _, database) => { const generated = selection(body, ["4"]); database.exec(`UPDATE app_equipment_items SET ${edit} WHERE id='4'`); return result(generated); } }));
test("one global provider deadline bounds a transport that ignores cancellation", async () => {
	await assert.rejects(deepSeekSymptomRecommendations({ client: { chat: { completions: { create: () => new Promise(() => {}) } } }, model: "deepseek-v4-flash", question: "好痛", history: [], locale: "zh", concern: { targets: [] }, catalog: [], getCatalog: () => [], timeoutMs: 10 }), { code: "deepSeekUnavailable" });
});
