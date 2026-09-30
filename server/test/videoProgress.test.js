import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

for (const language of ["zh", "en"]) test(`${language} direct-video playback progress survives the research API and database unchanged`, async () => {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString();
	const jwtSecret = "video-progress-local-test-only-secret";
	database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('video-test-user','Video test','+85261231234','participant','unused','unused',?,?)").run(now, now);
	const token = signToken({ id: "video-test-user", profile_role: "participant" }, jwtSecret);
	const server = createApp({ database, jwtSecret }).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${server.address().port}`;
	const videoId = `/api/media/${language}-test/${language}-test.mp4`;
	const events = [
		["video.play", { positionMs: 0, durationMs: 12000, progressPercent: 0 }],
		["video.paused", { positionMs: 3000, durationMs: 12000, progressPercent: 25, watchedMs: 3000, completed: false }],
		["video.play", { positionMs: 3000, durationMs: 12000, progressPercent: 25 }],
		["video.completed", { positionMs: 12000, durationMs: 12000, progressPercent: 100, watchedMs: 9000, completed: true }],
	];
	try {
		for (const [eventName, snapshot] of events) {
			const metadata = { screen: "outdoor.detail", contentId: 0, videoId, ...snapshot };
			const result = await fetch(base + "/api/research/events", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventName, metadata }) });
			assert.equal(result.status, 201);
			const { eventId } = await result.json();
			const stored = database.prepare("SELECT participant_id,event_name,metadata_json FROM research_events WHERE id = ?").get(eventId);
			assert.equal(stored.participant_id, "video-test-user");
			assert.equal(stored.event_name, eventName);
			assert.deepEqual(JSON.parse(stored.metadata_json), metadata);
		}
		assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_events WHERE event_name = 'video.completed'").get().count, 1);
		assert.equal(database.prepare("SELECT SUM(json_extract(metadata_json,'$.watchedMs')) AS watched FROM research_events").get().watched, 12000);
	} finally {
		server.closeAllConnections();
		await new Promise((done) => server.close(done)); database.close();
	}
});
