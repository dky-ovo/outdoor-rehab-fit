import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { ASSISTANT_GUIDE_LIMITS, createAssistantGuideAccess, completeAssistantWithGuide, assistantGuideReply } from "../src/assistantGuide.js";
import { symptomProviderSelection } from './helpers/symptomProvider.js';

const SECRET = "isolated-guide-read-test-only";
const call = (name, args, id = "read-1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const toolResponse = (...calls) => ({ choices: [{ finish_reason: "tool_calls", message: { content: null, reasoning_content: "PRIVATE_PROVIDER_REASONING", tool_calls: calls } }] });
const answer = value => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
const toolResults = body => body.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));

async function fixture(run, respond) {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString();
	database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
		.run("reader", "PRIVATE_ACCOUNT_NAME", "+85269700991", "participant", "PRIVATE_PASSWORD_SALT", "PRIVATE_PASSWORD_HASH", now, now);
	database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key='PRIVATE_API_KEY' WHERE id='default'").run();
	const calls = [];
	const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => ({ chat: { completions: { create: async (body, options) => {
		calls.push(structuredClone(body));
		const symptomSelection = symptomProviderSelection(body);
		if (symptomSelection) return answer(symptomSelection);
		return respond(body, calls.length, database, options);
	} } } }) });
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
	const ask = async (message, extra = {}) => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${signToken({ id: "reader", profile_role: "participant" }, SECRET)}` }, body: JSON.stringify({ message, ...extra }) });
		return { status: response.status, data: await response.json() };
	};
	try { await run({ ask, database, calls }); }
	finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("HTTP ambiguous guide question can search then read full maintained fields beyond the old summary", async () => fixture(async ({ ask, database, calls }) => {
	database.prepare("UPDATE app_equipment_items SET details_zh=?,pt_tip_zh=?,care_tip_zh=?,tcm_enabled=0 WHERE id='0'")
		.run("說明段落。".repeat(500) + "雙輪標記", "PT_CURRENT_CONTENT", "請保持平穩動作；如不適應停止。 ");
	const result = await ask("那个有雙輪標記的器材怎么操作", { equipment: [{ id: "0", description: "FORGED_CLIENT_KNOWLEDGE" }], permissions: ["read_users"], privateData: "FORGED_PRIVATE_DATA" });
	assert.equal(result.status, 200);
	assert.equal(result.data.action, "equipment_local");
	assert.equal(result.data.deepSeekUsed, true);
	assert.equal(result.data.knowledgeSource, "facility_guide");
	assert.deepEqual(result.data.recommendations.map(item => item.id), ["0"]);
	assert.ok(result.data.reply.includes("請保持平穩動作；如不適應停止。"));
	assert.ok(!result.data.reply.includes("MODEL_INVENTED_INSTRUCTIONS"));
	assert.equal(calls.length, 3);
	const firstRead = toolResults(calls[1])[0];
	assert.ok(firstRead.items.some(item => item.id === "0"));
	const full = toolResults(calls[2])[1];
	assert.ok(full.fields.find(field => field.field === "details").text.includes("雙輪標記"));
	assert.equal(full.fields.find(field => field.field === "ptTip").text, "PT_CURRENT_CONTENT");
	assert.ok(full.fields.every(field => field.field !== "tcmTip"));
	assert.equal(calls[2].tool_choice, "none");
	assert.equal(calls[1].messages.find(message => message.role === "assistant").reasoning_content, "PRIVATE_PROVIDER_REASONING");
	const sent = JSON.stringify(calls);
	for (const secret of ["FORGED_CLIENT_KNOWLEDGE", "FORGED_PRIVATE_DATA", "PRIVATE_ACCOUNT_NAME", "PRIVATE_PASSWORD_SALT", "PRIVATE_PASSWORD_HASH", "PRIVATE_API_KEY"]) assert.ok(!sent.includes(secret), secret);
	assert.ok(!JSON.stringify(result.data).includes("PRIVATE_PROVIDER_REASONING"));
}, (_body, number) => number === 1 ? toolResponse(call("search_facility_guide", { query: "雙輪標記" }))
	: number === 2 ? toolResponse(call("get_facility_guide", { id: "0" }, "read-2"))
	: answer({ reply: "MODEL_INVENTED_INSTRUCTIONS", recommendations: [{ id: "28" }], guideReferences: [{ id: "0", field: "careTip" }, { id: "invented", field: "details" }, { id: "19", field: "details" }] })));

test("HTTP retrieval includes bundled instructions and same-language professional APP source", async () => fixture(async ({ ask, calls }) => {
	const result = await ask("Explain the guide with turning wheels", { locale: "en" });
	assert.equal(result.status, 200);
	const fields = toolResults(calls[1])[0].fields;
	for (const field of ["details", "ptTip", "otTip", "kinesiologyTip", "tcmTip", "careTip"]) assert.ok(fields.some(item => item.field === field && item.text), field);
	assert.ok(fields.every(item => !/[\u4e00-\u9fff]/.test(item.text)));
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "0" })) : answer({ reply: "Which wheel guide do you mean?", recommendations: [] })));

test("HTTP unpublished/deleted guides and hidden categories never enter tool results", async () => fixture(async ({ database, ask, calls }) => {
	database.prepare("UPDATE app_equipment_items SET is_active=0,name_zh='INACTIVE_SECRET',details_zh='INACTIVE_PROSE' WHERE id='0'").run();
	database.prepare("UPDATE app_equipment_items SET deleted_at='2026-09-10',name_zh='DELETED_SECRET' WHERE id='19'").run();
	database.prepare("UPDATE equipment_categories SET name_zh='LOCKED_CATEGORY_SECRET',is_locked=1 WHERE id='warmup'").run();
	database.prepare("UPDATE equipment_categories SET name_zh='HIDDEN_CATEGORY_SECRET',show_in_guide=0 WHERE id='back'").run();
	const result = await ask("可以介紹指南內容嗎？");
	assert.equal(result.status, 200);
	const results = toolResults(calls[1]);
	assert.equal(results[0].error, "guideNotFound");
	assert.equal(results[1].error, "guideNotFound");
	for (const value of ["INACTIVE_SECRET", "INACTIVE_PROSE", "DELETED_SECRET", "LOCKED_CATEGORY_SECRET", "HIDDEN_CATEGORY_SECRET"]) assert.ok(!JSON.stringify(calls).includes(value));
	assert.deepEqual(result.data.recommendations, []);
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "0" }, "a"), call("get_facility_guide", { id: "19" }, "b"), call("search_facility_guide", { query: "" }, "c"))
	: answer({ reply: "請提供器材名稱。", guideReferences: [{ id: "0", field: "details" }, { id: "19", field: "details" }] })));

test("HTTP blank custom English and disabled TCM never borrow Chinese or stale client prose", async () => fixture(async ({ database, ask, calls }) => {
	database.prepare("UPDATE app_equipment_items SET is_custom=1,details_en='',pt_tip_en='',ot_tip_en='',kinesiology_en='',care_tip_en='',tcm_en='',details_zh='CHINESE_ONLY_DETAILS',tcm_zh='CHINESE_ONLY_TCM',tcm_enabled=1 WHERE id='19'").run();
	database.prepare("UPDATE app_equipment_items SET tcm_enabled=0,tcm_en='DISABLED_TCM_SECRET' WHERE id='0'").run();
	const result = await ask("Tell me about the guide with two handles", { locale: "en", equipment: [{ id: "19", tcmTip: "CLIENT_FAKE_ENGLISH" }] });
	assert.equal(result.status, 200);
	const results = toolResults(calls[1]);
	assert.deepEqual(results[0].fields, []);
	assert.deepEqual(results[1].fields, []);
	for (const value of ["CHINESE_ONLY_DETAILS", "CHINESE_ONLY_TCM", "DISABLED_TCM_SECRET", "CLIENT_FAKE_ENGLISH"]) assert.ok(!JSON.stringify(calls).includes(value));
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "19" }, "a"), call("get_facility_guide", { id: "0", fields: ["tcmTip"] }, "b"))
	: answer({ reply: "There is no published English content for that section.", recommendations: [], guideReferences: [{ id: "19", field: "tcmTip" }] })));

test("HTTP published guide beyond the old 100-item catalog limit is retrievable", async () => fixture(async ({ database, ask }) => {
	const insert = database.prepare("INSERT INTO app_equipment_items (id,is_custom,name_zh,name_en,details_zh,is_active,sort_order,created_at,updated_at) VALUES (?,1,?,?,?,1,?,?,?)");
	for (let index = 0; index < 105; index += 1) insert.run(`custom-${index}`, `自訂設施${index}`, `Custom ${index}`, index === 104 ? "頁尾獨有教學標記" : "教學", index + 100, "2026-09-01", "2026-09-01");
	const result = await ask("請介紹頁尾獨有教學標記內容");
	assert.equal(result.status, 200);
	assert.equal(result.data.recommendations[0].id, "custom-104");
	assert.ok(result.data.reply.includes("頁尾獨有教學標記"));
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "custom-104" })) : answer({ guideReferences: [{ id: "custom-104", field: "details" }] })));

for (const change of ["is_active=0", "deleted_at='2026-09-11'", "details_zh='REVISED_AFTER_READING'", "tcm_enabled=0"]) {
	test(`HTTP changes during generation invalidate stale guide responses: ${change}`, async () => fixture(async ({ ask }) => {
		const result = await ask("請介紹帶轉盤的指南內容");
		assert.equal(result.status, 502);
		assert.equal(result.data.error, "deepSeekInvalidResponse");
		assert.ok(result.data.reply.trim());
		assert.deepEqual(result.data.recommendations, []);
	}, (_body, number, database) => {
		if (number === 1) return toolResponse(call("get_facility_guide", { id: "0" }));
		database.prepare(`UPDATE app_equipment_items SET ${change} WHERE id='0'`).run();
		return answer({ reply: "STALE_MODEL_PROSE", guideReferences: [{ id: "0", field: "details" }] });
	}));
}

test("HTTP greetings and broad requests do not obtain cards through guideReferences; symptoms use verified selection and urgent signs skip tools", async () => fixture(async ({ ask, calls }) => {
	for (const message of ["你好", "推薦器材"]) {
		const result = await ask(message);
		assert.equal(result.status, 200);
		assert.deepEqual(result.data.recommendations, []);
	}
	const before = calls.length;
	for (const message of ["胸痛，呼吸困難", "我的膝頭痛", "膝痛，推薦器材"]) assert.equal((await ask(message)).status, 200);
	assert.equal(calls.length, before + 2, 'nonurgent symptom requests each invoke verified provider selection');
}, (_body, number) => number % 2 === 1 ? toolResponse(call("get_facility_guide", { id: "0" })) : answer({ reply: "請告訴我您想了解的內容。", recommendedIds: ["0"], guideReferences: [{ id: "0", field: "details" }] })));

test("HTTP TCM retrieval keeps the existing safe excerpt guard", async () => fixture(async ({ ask, database }) => {
	database.prepare("UPDATE app_equipment_items SET tcm_enabled=1,tcm_zh='此為中醫背景資料。\n\n治癒所有疾病。' WHERE id='0'").run();
	const result = await ask("請介紹帶轉盤的中醫內容");
	assert.equal(result.status, 200);
	assert.ok(result.data.reply.includes("此為中醫背景資料。"));
	assert.ok(!result.data.reply.includes("治癒所有疾病"));
	assert.ok(result.data.reply.includes("並非針對症狀的使用建議"));
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "0", fields: ["tcmTip"] })) : answer({ guideReferences: [{ id: "0", field: "tcmTip" }] })));

test("HTTP provider failure or malformed/empty content returns a nonempty error reply", async () => {
	for (const payload of [null, answer(null), answer([]), answer({ reply: "" }), answer({ reply: { invalid: "object" } }), { choices: [{ finish_reason: "length", message: { content: "{}" } }] }]) {
		await fixture(async ({ ask }) => {
			const result = await ask("你好");
			assert.equal(result.status, 502);
			assert.ok(result.data.reply.trim());
			assert.deepEqual(result.data.recommendations, []);
		}, () => { if (payload === null) throw new Error("provider failed"); return payload; });
	}
});

test("HTTP content questions without a verified reference do not return invented provider instructions", async () => fixture(async ({ ask }) => {
	const result = await ask("那个有圆盘的器材怎么操作");
	assert.equal(result.status, 200);
	assert.ok(result.data.reply.includes("器材名稱"));
	assert.ok(!result.data.reply.includes("INVENTED_INSTRUCTIONS"));
	assert.deepEqual(result.data.recommendations, []);
}, () => answer({ reply: "INVENTED_INSTRUCTIONS", guideReferences: [{ id: "missing", field: "details" }] })));

test("HTTP guide references cannot bypass the explicitly requested body-part filter", async () => fixture(async ({ ask }) => {
	const result = await ask("腿部的器材怎么操作");
	assert.equal(result.status, 200);
	assert.deepEqual(result.data.recommendations, []);
	assert.ok(!result.data.reply.includes("太極揉推器"));
}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "0" })) : answer({ reply: "INVENTED_INSTRUCTIONS", guideReferences: [{ id: "0", field: "details" }] })));

for (const message of ["Tell me more", "Movement steps?", "動作要領？", "Something else?"]) {
	test(`HTTP actual guide reads rebuild authoritative follow-up content without relying on keywords: ${message}`, async () => fixture(async ({ ask, calls }) => {
		const result = await ask(message, { locale: "en", history: [{ role: "user", content: "How do I use the turning wheel guide?" }, { role: "assistant", content: "Open the matching guide." }] });
		assert.equal(result.status, 200);
		assert.equal(result.data.action, "equipment_local");
		assert.equal(result.data.recommendations[0].id, "0");
		assert.ok(!result.data.reply.includes("MODEL_UNVERIFIED_INSTRUCTIONS"));
		const original = toolResults(calls[1])[0].fields.find(field => field.field === "details").text;
		assert.ok(result.data.reply.includes(original));
	}, (_body, number) => number === 1 ? toolResponse(call("get_facility_guide", { id: "0", fields: ["details"] }))
		: answer({ reply: "MODEL_UNVERIFIED_INSTRUCTIONS", guideReferences: [{ id: "0", field: "details" }] })));
}

for (const variant of ["context-only", "read-without-reference", "invalid-reference", "malformed-reference", "failed-read", "search-only"]) {
	test(`HTTP follow-ups cannot fall back to model instructions when source cannot be verified: ${variant}`, async () => fixture(async ({ ask }) => {
		const result = await ask(variant === "context-only" ? "Tell me more" : "Something else?", {
			locale: "en", history: [{ role: "user", content: "How do I use the turning wheel guide?" }],
		});
		assert.equal(result.status, 200);
		assert.deepEqual(result.data.recommendations, []);
		assert.match(result.data.reply, /could not verify/);
		assert.ok(!result.data.reply.includes("MODEL_UNVERIFIED_INSTRUCTIONS"));
	}, (_body, number) => {
		if (number === 1 && ["read-without-reference", "failed-read", "search-only"].includes(variant)) return toolResponse(variant === "search-only"
			? call("search_facility_guide", { query: "missing" }) : call("get_facility_guide", { id: variant === "failed-read" ? "missing" : "0", fields: ["details"] }));
		return answer({ reply: "MODEL_UNVERIFIED_INSTRUCTIONS", ...(variant === "invalid-reference" ? { guideReferences: [{ id: "missing", field: "details" }] }
			: variant === "malformed-reference" ? { guideReferences: "invalid" } : {}) });
	}));
}

test("HTTP normal greetings with empty reference arrays remain conversational", async () => fixture(async ({ ask }) => {
	const result = await ask("Hello!");
	assert.equal(result.status, 200);
	assert.equal(result.data.reply, "Hello! How can I help?");
	assert.deepEqual(result.data.recommendations, []);
}, () => answer({ reply: "Hello! How can I help?", guideReferences: [], recommendations: [] })));

test("HTTP consecutive contextual follow-ups without tools or references never return model teaching", async () => fixture(async ({ ask }) => {
	const history = [{ role: "user", content: "How do I use the turning wheel guide?" }];
	for (const message of ["Tell me more", "Movement steps?", "More details", "Please tell me more", "Continue", "再讲详细点", "可以講詳細啲？", "Tell me more"]) {
		const result = await ask(message, { locale: "en", history });
		assert.equal(result.status, 200);
		assert.match(result.data.reply, /could not verify/);
		assert.ok(!result.data.reply.includes("MODEL_UNVERIFIED_INSTRUCTIONS"));
		assert.deepEqual(result.data.recommendations, []);
		history.push({ role: "user", content: message }, { role: "assistant", content: result.data.reply });
	}
}, () => answer({ reply: "MODEL_UNVERIFIED_INSTRUCTIONS" })));

test("HTTP elided follow-up with no available original context still requires verified teaching", async () => fixture(async ({ ask }) => {
	for (const message of ["Tell me more", "Continue", "More details", "再讲详细点"]) {
		const result = await ask(message, { locale: "en", history: [] });
		assert.equal(result.status, 200);
		assert.match(result.data.reply, /could not verify/);
		assert.ok(!result.data.reply.includes("MODEL_UNVERIFIED_INSTRUCTIONS"));
		assert.deepEqual(result.data.recommendations, []);
	}
}, () => answer({ reply: "MODEL_UNVERIFIED_INSTRUCTIONS" })));

for (const previous of ["My knees hurt", "My knees hurt, please recommend equipment", "I have chest pain and difficulty breathing"]) {
	test(`HTTP natural guide follow-ups preserve verified symptom evidence and urgent handling: ${previous}`, async () => fixture(async ({ ask, calls }) => {
		const history = [{ role: "user", content: previous }];
		for (const message of ["Tell me more", "Movement steps?", "動作要領？"]) {
			const result = await ask(message, { locale: "en", history });
			assert.equal(result.status, 200);
			assert.ok(!result.data.reply.includes("MODEL_UNVERIFIED_INSTRUCTIONS"));
			assert.ok(result.data.recommendations.every(item => item.id !== "0"));
			if (previous.includes("chest")) assert.deepEqual(result.data.recommendations, []);
			history.push({ role: "user", content: message });
		}
		assert.equal(calls.length, previous.includes('chest') ? 0 : 3, 'urgent continuations skip the provider; nonurgent continuations use verified selection');
	}, () => answer({ reply: "MODEL_UNVERIFIED_INSTRUCTIONS", guideReferences: [{ id: "0", field: "details" }] })));
}

test("guide references can return only fields actually read, never an unread field or past-end page", () => {
	const access = createAssistantGuideAccess({ locale: "en", getCategories: () => [], getCatalog: () => [{ id: "one", name: "One", categories: [], details: "Instructions", ptTip: "PT text", tcmEnabled: true, tcmTip: "TCM text" }] });
	access.run(call("get_facility_guide", { id: "one", fields: ["ptTip"] }));
	assert.deepEqual(access.references({ guideReferences: [{ id: "one", field: "details" }, { id: "one", field: "tcmTip" }] }), []);
	access.run(call("get_facility_guide", { id: "one", fields: ["details"], offset: 999 }));
	assert.deepEqual(access.references({ guideReferences: [{ id: "one", field: "details" }] }), []);
	assert.equal(access.references({ guideReferences: [{ id: "one", field: "ptTip" }] })[0].text, "PT text");
});

const simpleAccess = () => createAssistantGuideAccess({ locale: "en", getCategories: () => [{ id: "upper", nameEn: "Upper", showInGuide: true }], getCatalog: () => [{ id: "safe", name: "Safe published guide", categories: ["upper"], details: "A".repeat(9000) + "FINAL_WARNING", tcmEnabled: false, tcmTip: "DISABLED_SECRET", apiKey: "PRIVATE_KEY", userId: "PRIVATE_USER" }] });

test("guide tools validate names, IDs, fields, paging and all unexpected arguments without executing capabilities", () => {
	const access = simpleAccess();
	for (const args of [null, [], { id: 12 }, { id: "" }, { id: "safe", fields: ["apiKey"] }, { id: "safe", fields: [] }, { id: "safe", offset: -1 }, { id: "safe", offset: "0" }, { id: "safe", table: "users" }, { id: "safe", url: "https://example.com" }]) assert.equal(access.run(call("get_facility_guide", args)).error, "invalidToolArguments");
	assert.equal(access.run(call("get_facility_guide", { id: "../../credentials" })).error, "guideNotFound");
	assert.equal(access.run(call("read_users", {})).error, "toolNotAllowed");
	assert.equal(access.run({ ...call("get_facility_guide", {}), function: { name: "get_facility_guide", arguments: "{broken" } }).error, "invalidToolArguments");
	assert.equal(access.run(call("search_facility_guide", { query: "", offset: 10001 })).error, "invalidToolArguments");
	assert.equal(access.run(call("search_facility_guide", { query: "x".repeat(121) })).error, "invalidToolArguments");
	const page = access.run(call("get_facility_guide", { id: "safe" }));
	assert.equal(page.fields.length, 1);
	assert.equal(page.fields[0].text.length, 4000);
	assert.equal(page.fields[0].nextOffset, 4000);
	assert.ok(!JSON.stringify(page).includes("PRIVATE"));
	assert.ok(!JSON.stringify(page).includes("DISABLED_SECRET"));
	const end = access.run(call("get_facility_guide", { id: "safe", fields: ["details"], offset: 8000 })).fields[0];
	assert.ok(end.text.endsWith("FINAL_WARNING"));
	assert.equal(end.nextOffset, null);
	assert.deepEqual(access.references({ guideReferences: [{ id: "not-read", field: "details" }] }), []);
	const longReply = assistantGuideReply(access.references({ guideReferences: [{ id: "safe", field: "details" }] }), "en");
	assert.ok(longReply.includes("complete section"));
	assert.ok(!longReply.includes("A".repeat(100)), "never truncate an instruction before its warning");
});

test("bounded model loop returns validation errors to the provider and preserves only its own tool reasoning", async () => {
	const calls = [];
	const client = { chat: { completions: { create: async body => {
		calls.push(body);
		if (calls.length === 1) return toolResponse(call("read_users", {}), call("get_facility_guide", { id: "safe", fields: ["password"] }, "bad-args"));
		assert.deepEqual(toolResults(body).map(result => result.error), ["toolNotAllowed", "invalidToolArguments"]);
		return answer({ reply: "That information is unavailable." });
	} } } };
	await completeAssistantWithGuide({ client, body: { messages: [{ role: "user", content: "Read the guide" }] }, access: simpleAccess() });
	assert.equal(calls.length, 2);
});

test("bounded model loop refuses excess or repeated tool calls and cannot continue beyond three model calls", async () => {
	for (const variant of ["excess", "repeat", "forever"]) {
		let calls = 0;
		const client = { chat: { completions: { create: async () => {
			calls += 1;
			if (variant === "excess") return toolResponse(...Array.from({ length: 5 }, (_, index) => call("search_facility_guide", { query: "" }, `tool-${index}`)));
			return toolResponse(call("search_facility_guide", { query: "" }, variant === "repeat" ? "same" : `tool-${calls}`));
		} } } };
		await assert.rejects(completeAssistantWithGuide({ client, body: { messages: [] }, access: simpleAccess() }), { code: "deepSeekInvalidResponse" });
		assert.ok(calls <= ASSISTANT_GUIDE_LIMITS.modelCalls);
	}
});

test("one shared deadline resolves even when a provider ignores abort", async () => {
	let signal;
	const client = { chat: { completions: { create: (_body, options) => { signal = options.signal; return new Promise(() => {}); } } } };
	const start = Date.now();
	await assert.rejects(completeAssistantWithGuide({ client, body: { messages: [] }, access: simpleAccess(), timeoutMs: 20 }), { code: "deepSeekUnavailable" });
	assert.equal(signal.aborted, true);
	assert.ok(Date.now() - start < 1000);
});
