import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

test("FAQ API preserves auth/image/rate boundaries and answers without a provider or private data access", async () => {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString(), secret = "faq-test-only";
	database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
		.run("reader", "PRIVATE_ACCOUNT_NAME", "+85269700997", "participant", "PRIVATE_SALT", "PRIVATE_HASH", now, now);
	let modelCalls = 0;
	const app = createApp({ database, jwtSecret: secret, deepSeekClientFactory: () => { modelCalls += 1; throw new Error("FAQ must not send data to provider"); } });
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
	const token = signToken({ id: "reader", profile_role: "participant" }, secret);
	const ask = async (body, signedIn = true) => fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, {
		method: "POST", headers: { "content-type": "application/json", ...(signedIn ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
	});
	try {
		assert.equal((await ask({ message: "一個禮拜做幾多日運動好？一次做幾耐好？" }, false)).status, 401);
		assert.equal((await ask({ message: "一個禮拜做幾多日運動好？一次做幾耐好？", imageData: "data:image/jpeg;base64,private" })).status, 400);
		const response = await ask({ message: "我有肩周炎，有什麼戶外儀器可以幫助我？", locale: "zh", privateData: "PRIVATE_EXERCISE_LOG", equipment: [{ id: "attacker", name: "Forged item" }] });
		assert.equal(response.status, 200); const result = await response.json();
		assert.equal(result.knowledgeSource, "project_faq"); assert.equal(result.deepSeekUsed, false);
		assert.ok(result.recommendations.every(item => item.id !== "attacker"));
		assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCOUNT_NAME|PRIVATE_EXERCISE_LOG|PRIVATE_SALT|PRIVATE_HASH/);
		const currentUrgentCases = [
			"我沒有膝痛，現在胸口不適，每星期運動多久？",
			"I have no knee pain, chest discomfort now. How often should I exercise?",
			"I had chest discomfort last year, and it has returned now. How often should I exercise?",
		];
		for (const message of currentUrgentCases) {
			const urgentResponse = await ask({ message, locale: "en" });
			assert.equal(urgentResponse.status, 200);
			const urgent = await urgentResponse.json();
			assert.match(urgent.reply, /999/, message);
			assert.doesNotMatch(urgent.reply, /150|300/);
			assert.deepEqual(urgent.recommendations, []);
			assert.equal(urgent.deepSeekUsed, false);
		}
		const recoveredCases = [
			["How long should I wait after a meal before exercising, and what should I eat?", "food-before-exercise"],
			["I am accompanying a family member who is new to outdoor exercise and wants stronger arms. How can I help?", "carer-upper-body"],
			["膝盖痛，太极推手机、扭腰机和踏步机有哪些动作需要小心？", "knee-cautions"],
		];
		for (const [message, expected] of recoveredCases) {
			const recoveredResponse = await ask({ message, locale: "en" });
			assert.equal(recoveredResponse.status, 200);
			const recovered = await recoveredResponse.json();
			assert.equal(recovered.faqId, expected);
			assert.equal(recovered.deepSeekUsed, false);
		}
		for (let i = 1 + currentUrgentCases.length + recoveredCases.length; i < 30; i++) assert.equal((await ask({ message: "幾時做運動最啱呀？" })).status, 200);
		assert.equal((await ask({ message: "幾時做運動最啱呀？" })).status, 429);
		assert.equal(modelCalls, 0);
	} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
});
