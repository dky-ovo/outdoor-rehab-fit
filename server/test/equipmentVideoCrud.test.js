import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

const SECRET = "equipment-video-crud-test-only-secret";
const ZH = "/api/media/video-zh/video-zh.mp4";
const EN = "/api/media/video-en/video-en.mp4";
const EN_NEW = "/api/media/video-en-new/video-en-new.mp4";
const LEGACY = "https://example.org/legacy.mp4";
const YOUTUBE = "abcdefghijk";

async function fixture(run) {
	const database = createDatabase(":memory:");
	const now = new Date().toISOString(); const tokens = {};
	for (const [index, [id, permission, active]] of [["equipment", "app_maintenance.equipment.manage", 1], ["files", "app_maintenance.files.manage", 1], ["inactive", "app_maintenance.equipment.manage", 0], ["ordinary", null, 1], ["home", "app_maintenance.home.manage", 1]].entries()) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)").run(id,id,`+8526999000${index}`,now,now);
		if (permission) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,?,?,?)").run(id,JSON.stringify([permission]),active,now,now);
		tokens[id] = signToken({ id, profile_role: "staff" }, SECRET);
	}
	const app = createApp({ database, jwtSecret: SECRET });
	for (const [id, kind, mime, archived, deletedAt] of [["video-zh", "video", "video/mp4", 0, null], ["video-en", "video", "video/mp4", 0, null], ["video-en-new", "video", "video/mp4", 0, null], ["archived", "video", "video/mp4", 1, null], ["deleted", "video", "video/mp4", 0, now], ["image", "image", "image/png", 0, null], ["document", "file", "application/octet-stream", 0, null]]) {
		database.prepare("INSERT INTO media_files (id,url,name,mime_type,kind,category_id,source,archived,deleted_at,created_at,updated_at) VALUES (?,?,?,?,?,'videos','upload',?,?,?,?)").run(id,`/api/media/${id}/${id}.mp4`,`${id}.mp4`,mime,kind,archived,deletedAt,now,now);
	}
	const server = app.listen(0, "127.0.0.1"); await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${server.address().port}`;
	const request = async (path, { method = "GET", actor = "equipment", body } = {}) => {
		const result = await fetch(base + path, { method, headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
		return { status: result.status, data: await result.json() };
	};
	const create = (body = {}, actor = "equipment") => request("/api/admin/equipment", { method: "POST", actor, body: { nameZh: "測試器材", nameEn: "Test equipment", categories: ["mobility"], videoUrlZh: ZH, videoUrlEn: EN, ...body } });
	const update = (id, body, actor = "equipment") => request(`/api/admin/equipment/${id}`, { method: "PUT", actor, body });
	const publicItem = async (id) => {
		const result = await request("/api/equipment-catalog", { actor: null });
		assert.equal(result.status, 200);
		return result.data.items.find((item) => item.id === id);
	};
	try { await run({ database, request, create, update, publicItem }); }
	finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); database.close(); }
}

test("POST creates a bilingual facility and both language URLs reach the public catalog without swapping", async () => fixture(async ({ create, database, publicItem, request }) => {
	const result = await create({ videoUrl: LEGACY, youtubeKey: YOUTUBE });
	assert.equal(result.status, 201);
	const created = result.data.item;
	assert.equal(created.isCustom, true); assert.equal(created.videoUrlZh, ZH); assert.equal(created.videoUrlEn, EN); assert.equal(created.videoLocalesEnabled, true);
	const row = database.prepare("SELECT video_url_zh,video_url_en,video_localized,video_url,youtube_key FROM app_equipment_items WHERE id=?").get(created.id);
	assert.deepEqual(row, { video_url_zh: ZH, video_url_en: EN, video_localized: 1, video_url: LEGACY, youtube_key: YOUTUBE });
	const published = await publicItem(created.id);
	assert.equal(published.videoUrlZh, ZH); assert.equal(published.videoUrlEn, EN); assert.equal(published.videoLocalesEnabled, true);
	const listed = (await request("/api/admin/equipment")).data.items.find((item) => item.id === created.id);
	assert.equal(listed.videoUrlZh, ZH); assert.equal(listed.videoUrlEn, EN);
}));

test("PUT adds bilingual videos to built-in equipment and preserves description, identity and unspecified language", async () => fixture(async ({ database, update, publicItem }) => {
	database.prepare("UPDATE app_equipment_items SET details_zh='保留使用步驟',video_url=?,youtube_key=? WHERE id='0'").run(LEGACY,YOUTUBE);
	const original = database.prepare("SELECT name_zh,name_en,is_custom FROM app_equipment_items WHERE id='0'").get();
	const first = await update("0", { videoUrlZh: ZH, videoUrlEn: EN });
	assert.equal(first.status, 200); assert.equal(first.data.item.videoLocalesEnabled, true); assert.equal(first.data.item.detailsZh, "保留使用步驟");
	const second = await update("0", { videoUrlEn: EN_NEW });
	assert.equal(second.status, 200); assert.equal(second.data.item.videoUrlZh, ZH); assert.equal(second.data.item.videoUrlEn, EN_NEW);
	assert.deepEqual(database.prepare("SELECT name_zh,name_en,is_custom FROM app_equipment_items WHERE id='0'").get(), original);
	const published = await publicItem("0"); assert.equal(published.videoUrlZh, ZH); assert.equal(published.videoUrlEn, EN_NEW); assert.equal(published.videoLocalesEnabled, true);
}));

test("clearing one or both languages keeps video_localized sticky, even if a client sends a false flag", async () => fixture(async ({ create, update, database, publicItem }) => {
	const created = await create({ videoUrl: LEGACY, youtubeKey: YOUTUBE }); const id = created.data.item.id;
	const clearEnglish = await update(id, { videoUrlEn: "", videoLocalesEnabled: false, videoLocalized: 0 });
	assert.equal(clearEnglish.status, 200); assert.equal(clearEnglish.data.item.videoUrlZh, ZH); assert.equal(clearEnglish.data.item.videoUrlEn, ""); assert.equal(clearEnglish.data.item.videoLocalesEnabled, true);
	const englishMissing = await publicItem(id);
	assert.equal(englishMissing.videoUrlEn, ""); assert.equal(englishMissing.videoLocalesEnabled, true);
	const clearChinese = await update(id, { videoUrlZh: "", videoLocalesEnabled: false });
	assert.equal(clearChinese.status, 200);
	const bothMissing = await publicItem(id);
	assert.equal(bothMissing.videoUrlZh, ""); assert.equal(bothMissing.videoUrlEn, ""); assert.equal(bothMissing.videoLocalesEnabled, true);
	assert.equal(database.prepare("SELECT video_localized FROM app_equipment_items WHERE id=?").get(id).video_localized, 1);
	// The public catalog intentionally retains historical fields for old builds.
	// New clients MUST see the sticky flag even when both new URLs are empty;
	// equipmentVideoForLocale (frontend tests) then suppresses these old sources.
	assert.equal(bothMissing.videoUrl, LEGACY); assert.equal(bothMissing.youtubeKey, YOUTUBE);
	const legacyOnlyEdit = await update(id, { videoUrl: "https://example.org/another-old.mp4", nameZh: "修改名稱" });
	assert.equal(legacyOnlyEdit.status, 200); assert.equal(legacyOnlyEdit.data.item.videoLocalesEnabled, true);
	assert.equal((await publicItem(id)).videoLocalesEnabled, true);
}));

test("one-language creation enables localized mode and keeps the other language empty on public GET", async () => fixture(async ({ create, publicItem }) => {
	for (const missing of ["videoUrlZh", "videoUrlEn"]) {
		const result = await create({ [missing]: "", youtubeKey: YOUTUBE, videoUrl: LEGACY });
		assert.equal(result.status, 201);
		const published = await publicItem(result.data.item.id);
		assert.equal(published[missing], ""); assert.equal(published.videoLocalesEnabled, true);
	}
}));

test("localized video POST/PUT reject external URLs, missing/nonvideo/archived/deleted files and unsafe paths without partial writes", async () => fixture(async ({ create, update, database }) => {
	const created = await create(); const id = created.data.item.id;
	const original = database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(id);
	const count = database.prepare("SELECT COUNT(*) AS n FROM app_equipment_items").get().n;
	for (const field of ["videoUrlZh", "videoUrlEn"]) {
		for (const invalid of ["https://example.org/unregistered.mp4", "https://example.org/video.mp4?token=secret", "javascript:alert(1)", "/api/media/../private.mp4", "/api/media/missing/missing.mp4", "/api/media/image/image.mp4", "/api/media/document/document.mp4", "/api/media/archived/archived.mp4", "/api/media/deleted/deleted.mp4"]) {
			const createdInvalid = await create({ [field]: invalid }); assert.equal(createdInvalid.status, 400, `${field}: ${invalid}`); assert.equal(createdInvalid.data.error, "invalidEquipment");
			const updatedInvalid = await update(id, { [field]: invalid, nameZh: "不可部分保存" }); assert.equal(updatedInvalid.status, 400, `${field}: ${invalid}`); assert.equal(updatedInvalid.data.error, "invalidEquipment");
			assert.deepEqual(database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(id), original);
		}
	}
	assert.equal(database.prepare("SELECT COUNT(*) AS n FROM app_equipment_items").get().n, count);
}));

test("file-only staff, ordinary users, inactive accounts and anonymous callers cannot replace facility videos", async () => fixture(async ({ create, update, database }) => {
	for (const [actor, status] of [["files",403], ["ordinary",403], ["inactive",403], [null,401]]) {
		assert.equal((await create({},actor)).status,status);
		assert.equal((await update("0",{videoUrlZh:ZH,videoUrlEn:EN},actor)).status,status);
	}
	assert.equal(database.prepare("SELECT COUNT(*) AS n FROM app_equipment_items WHERE is_custom=1").get().n,0);
	assert.equal(database.prepare("SELECT video_localized FROM app_equipment_items WHERE id='0'").get().video_localized,0);
}));

const extraVideo = (id, url = EN_NEW) => ({ id, titleZh: "家居替代動作", titleEn: "Home alternative", videoUrlZh: url, videoUrlEn: "" });
test("additional videos and custom teaching sections persist in append order and survive legacy edits", async () => fixture(async ({ create, update, publicItem, database }) => {
 const additionalVideos = [extraVideo("first"), extraVideo("second", EN)];
 const teachingSections = [{ id: "home-tips", titleZh: "家居練習", titleEn: "Home practice", bodyZh: "坐姿練習", bodyEn: "Seated practice" }];
 const result = await create({ additionalVideos, teachingSections }); assert.equal(result.status, 201);
 const id = result.data.item.id;
 assert.deepEqual(result.data.item.additionalVideos, additionalVideos);
 assert.deepEqual((await publicItem(id)).teachingSections, teachingSections);
 assert.equal((await update(id, { nameEn: "Legacy client edit" })).status, 200);
 assert.deepEqual((await publicItem(id)).additionalVideos, additionalVideos);
 assert.deepEqual(JSON.parse(database.prepare("SELECT teaching_sections_json FROM app_equipment_items WHERE id=?").get(id).teaching_sections_json), teachingSections);
 assert.equal((await update(id, { additionalVideos: [], teachingSections: [] })).status, 200);
 assert.deepEqual((await publicItem(id)).additionalVideos, []);
}));

test("additional media reject wrong/missing/archived/private files and malformed lists without partial writes", async () => fixture(async ({ create, update, database }) => {
 const created = await create({ additionalVideos: [extraVideo("first")] }); const id = created.data.item.id;
 const before = database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(id);
 for (const url of ["https://example.org/external.mp4", "/api/media/image/image.mp4", "/api/media/archived/archived.mp4", "/api/media/deleted/deleted.mp4", "/api/media/document/document.mp4", "/api/media/missing/missing.mp4"]) {
  assert.equal((await update(id, { nameEn: "Must not save", additionalVideos: [extraVideo("bad", url)] })).status, 400);
  assert.deepEqual(database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(id), before);
 }
 for (const additionalVideos of [null, {}, [extraVideo("duplicate"), extraVideo("duplicate")], Array.from({ length: 41 }, (_, i) => extraVideo(`v${i}`)), [extraVideo("empty", "")]]) assert.equal((await update(id, { additionalVideos })).status, 400);
 assert.equal((await update(id, { teachingSections: [{ id: "bad", titleZh: "", titleEn: "", bodyZh: "", bodyEn: "" }] })).status, 400);
}));

test("files referenced only by additional equipment videos cannot be archived or deleted", async () => fixture(async ({ create, update, request }) => {
 const result = await create({ additionalVideos: [extraVideo("home")] }); assert.equal(result.status, 201);
 const media = await request("/api/admin/media?kind=video", { actor: "files" });
 assert.equal(media.status, 200); assert.equal(media.data.items.find(item => item.id === "video-en-new").isReferenced, true);
 assert.equal((await request("/api/admin/media/video-en-new", { method: "PATCH", actor: "files", body: { archived: true } })).status, 409);
 assert.equal((await request("/api/admin/media/delete", { method: "POST", actor: "files", body: { items: [{ id: "video-en-new", kind: "file" }] } })).status, 409);
 assert.equal((await update(result.data.item.id, { additionalVideos: [] })).status, 200);
 const cleared = await request("/api/admin/media?kind=video", { actor: "files" }); assert.equal(cleared.data.items.find(item => item.id === "video-en-new").isReferenced, false);
}));

test("Exercise Videos uses stored video CRUD, publication filtering and content permissions", async () => fixture(async ({ request }) => {
 const add = (body = {}, actor = "home") => request("/api/admin/content", { method: "POST", actor, body: { pageKey: "exercise_videos", contentType: "video", title: "Warm-up", value: EN_NEW, sortOrder: 2, ...body } });
 for (const [actor, status] of [["equipment", 403], ["files", 403], ["ordinary", 403], [null, 401]]) assert.equal((await add({}, actor)).status, status);
 for (const value of [LEGACY, YOUTUBE, "/api/media/missing/missing.mp4", "/api/media/archived/archived.mp4", "/api/media/document/document.mp4"]) assert.equal((await add({ value })).status, 400);
 assert.equal((await add({ contentType: "text" })).status, 400);
 const draft = await add({ isActive: false }); assert.equal(draft.status, 201);
 const published = await request("/api/content?pageKey=exercise_videos", { actor: null }); assert.deepEqual(published.data.items, []);
 const id = draft.data.id;
 assert.equal((await request(`/api/admin/content/${id}`, { method: "PATCH", actor: "home", body: { isActive: true } })).status, 200);
 assert.equal((await add({ title: "First", value: EN, sortOrder: 1 })).status, 201);
 assert.deepEqual((await request("/api/content?pageKey=exercise_videos", { actor: null })).data.items.map(item => item.title), ["First", "Warm-up"]);
 assert.equal((await request("/api/admin/media/video-en-new", { method: "PATCH", actor: "files", body: { archived: true } })).status, 409);
 assert.equal((await request(`/api/admin/content/${id}`, { method: "DELETE", actor: "home" })).status, 200);
 assert.deepEqual((await request("/api/content?pageKey=exercise_videos", { actor: null })).data.items.map(item => item.title), ["First"]);
}));
