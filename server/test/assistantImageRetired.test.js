import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

const SECRET = "image-retirement-test-only-secret";

async function fixture(run, { configured = true } = {}) {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString();
	database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
		.run("reader", "Reader", "+85269700291", "participant", "unused", "unused", now, now);
	database.prepare("UPDATE ai_configuration SET model='deepseek-v4-flash', api_key=? WHERE id='default'").run(configured ? "never-sent-test-key" : "");
	let providerCalls = 0;
	const app = createApp({ database, jwtSecret: SECRET, deepSeekClientFactory: () => {
		providerCalls += 1;
		return { chat: { completions: { create: async (body) => {
			assert.ok(body.messages.every(message => typeof message.content === "string"));
			return { choices: [{ message: { content: JSON.stringify({ reply: "Hello!", recommendations: [] }) } }] };
		} } } };
	} });
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
	const token = signToken({ id: "reader", profile_role: "participant" }, SECRET);
	const ask = async (body, authenticated = true) => {
		const result = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, {
			method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(body),
		});
		return { status: result.status, body: await result.json() };
	};
	try { await run({ ask, calls: () => providerCalls }); }
	finally { await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("all retired image inputs fail explicitly before calling DeepSeek, with or without text", async () => fixture(async ({ ask, calls }) => {
	for (const imageData of ["data:image/jpeg;base64,/9j/2Q==", "data:image/png;base64,iVBORw0KGgo=", "malformed", {}, false, 7, "   "]) {
		for (const message of ["", "你好", "太極揉推器怎麼使用？"]) {
			const result = await ask({ message, imageData });
			assert.equal(result.status, 400);
			assert.equal(result.body.error, "aiImageInputRetired");
			assert.match(result.body.reply, /圖片輸入功能已停用/);
			assert.deepEqual(result.body.recommendations, []);
			assert.equal(result.body.deepSeekUsed, false);
		}
	}
	assert.equal(calls(), 0);
}));

test("retired English image requests work without an AI key and never encourage another photo", async () => fixture(async ({ ask, calls }) => {
	const result = await ask({ locale: "en", imageData: "data:image/jpeg;base64,/9j/2Q==" });
	assert.equal(result.status, 400);
	assert.equal(result.body.error, "aiImageInputRetired");
	assert.match(result.body.reply, /no longer available/);
	assert.match(result.body.reply, /speech-to-text/);
	assert.doesNotMatch(result.body.reply, /clearer|take a photo|try another photo/i);
	assert.equal(calls(), 0);
}, { configured: false }));

test("legacy empty image fields still allow text and image rejection does not consume text allowance", async () => fixture(async ({ ask, calls }) => {
	for (let index = 0; index < 32; index += 1) {
		const result = await ask({ imageData: "data:image/jpeg;base64,/9j/2Q==" });
		assert.equal(result.status, 400);
	}
	assert.equal(calls(), 0);
	for (let index = 0; index < 30; index += 1) {
		const result = await ask({ message: "你好", imageData: index % 2 ? "" : null });
		assert.equal(result.status, 200);
		assert.deepEqual(result.body.recommendations, []);
	}
	assert.equal(calls(), 30);
	const limited = await ask({ message: "你好" });
	assert.equal(limited.status, 429);
	assert.equal(limited.body.error, "assistantRateLimited");
}));

test("AI authentication is still required for retired image requests", async () => fixture(async ({ ask, calls }) => {
	const result = await ask({ imageData: "data:image/jpeg;base64,/9j/2Q==" }, false);
	assert.equal(result.status, 401);
	assert.equal(result.body.error, "unauthorized");
	assert.equal(calls(), 0);
}));
