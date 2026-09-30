import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { adminPagination } from "../src/adminPagination.js";

const SECRET = "pagination-test-secret-with-more-than-32-characters";
async function fixture(run) {
	const database = createDatabase(":memory:"); const tokens = {};
	const created = "2026-09-10T00:00:00.000Z";
	for (const [index, [id, name, profileRole, systemRole, permissions]] of [
		["super", "Super", "staff", "super_admin", []],
		["reader", "Researcher", "staff", "operator", ["research.read"]],
		["blocked", "Blocked", "staff", "operator", ["dashboard.read"]],
		["participant", "Participant A", "participant", null, []],
		["users-reader", "User reader", "staff", "operator", ["users.read"]],
		["export-only", "Export only", "staff", "operator", ["data.export"]],
	].entries()) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,'unused','unused',?,?)").run(id, name, `+8529888000${index}`, profileRole, created, created);
		if (systemRole) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)").run(id,systemRole,JSON.stringify(permissions),created,created);
		tokens[id] = signToken({ id, profile_role: profileRole }, SECRET);
	}
	const event = database.prepare("INSERT INTO research_events (id,participant_id,event_name,event_time,metadata_json) VALUES (?,?,?,?,?)");
	const log = database.prepare("INSERT INTO system_logs (id,actor_user_id,actor_role,action,created_at) VALUES (?,'super','super_admin','fixture.test',?)");
	for (let index = 0; index < 345; index += 1) {
		event.run(`event-${String(index).padStart(3,"0")}`, index % 2 ? "reader" : "participant", index % 2 ? "video.completed" : "video.play", created, JSON.stringify({ screen: `screen-${index % 35}`, contentId: `video-${index % 35}` }));
		log.run(`log-${String(index).padStart(3,"0")}`, created);
	}
	const app = createApp({ database, jwtSecret: SECRET });
	const server = app.listen(0,"127.0.0.1"); await new Promise((resolve) => server.once("listening",resolve));
	const request = async (path, actor = "super", { method = "GET", body } = {}) => {
		const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
		return { status: result.status, data: await result.json() };
	};
	try { await run({ request, database }); }
	finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); database.close(); }
}

test("system log pagination reaches records beyond the old 300-row cap in deterministic order", async () => {
	await fixture(async ({ request }) => {
		const first = await request("/api/admin/system-logs");
		assert.equal(first.status,200); assert.equal(first.data.total,345); assert.equal(first.data.pageSize,20); assert.equal(first.data.totalPages,18); assert.equal(first.data.logs.length,20); assert.equal(first.data.logs[0].id,"log-344");
		const old = await request("/api/admin/system-logs?page=16&pageSize=20");
		assert.equal(old.data.page,16); assert.equal(old.data.logs.length,20); assert.equal(old.data.logs[0].id,"log-044");
		const final = await request("/api/admin/system-logs?page=999&pageSize=20");
		assert.equal(final.data.page,18); assert.equal(final.data.logs.length,5); assert.equal(final.data.logs.at(-1).id,"log-000");
	});
});

test("raw research events and analytics have the same full total and page window", async () => {
	await fixture(async ({ request }) => {
		const raw = await request("/api/admin/research-events?page=16&pageSize=20", "reader");
		const analytics = await request("/api/admin/research-analytics?page=16&pageSize=20", "reader");
		assert.equal(raw.status,200); assert.equal(analytics.status,200);
		assert.equal(raw.data.total,345); assert.equal(raw.data.events.length,20); assert.equal(raw.data.events[0].id,"event-044");
		assert.equal(analytics.data.summary.totalEvents,345); assert.equal(analytics.data.total,345);
		assert.deepEqual(analytics.data.events,raw.data.events);
		assert.equal(raw.data.events[0].metadata.screen,"screen-9"); assert.equal(raw.data.events[0].participantPhone,"+85298880003");
		assert.equal(analytics.data.screens.length,35); assert.equal(analytics.data.videos.length,35);
	});
});

test("filters apply to both count and rows on every page", async () => {
	await fixture(async ({ request }) => {
		const filters = "eventName=video.play&profileRole=participant&userSearch=Participant%20A&dateFrom=2026-09-10&dateTo=2026-09-10&pageSize=20&page=2";
		for (const route of ["research-events", "research-analytics"]) {
			const result = await request(`/api/admin/${route}?${filters}`,"reader");
			assert.equal(result.data.total,173); assert.equal(result.data.page,2); assert.equal(result.data.events.length,20);
			assert.ok(result.data.events.every((item) => item.profileRole === "participant" && item.eventName === "video.play"));
		}
		const empty = await request("/api/admin/research-events?screen=missing&page=10","reader");
		assert.equal(empty.data.total,0); assert.equal(empty.data.page,1); assert.equal(empty.data.totalPages,1); assert.deepEqual(empty.data.events,[]);
	});
});

test("consecutive equal-timestamp pages neither overlap nor omit records", async () => {
	await fixture(async ({ request }) => {
		const ids = [];
		for (let page = 1; page <= 4; page += 1) {
			const result = await request(`/api/admin/research-events?page=${page}&pageSize=100`,"reader");
			ids.push(...result.data.events.map((item) => item.id));
		}
		assert.equal(ids.length,345); assert.equal(new Set(ids).size,345);
	});
});

test("invalid pagination parameters never permit a negative or unlimited SQL page", async () => {
	await fixture(async ({ request }) => {
		for (const query of ["page=-1&pageSize=-1", "page=0&pageSize=0", "page=1.5&pageSize=1.5", "page=Infinity&pageSize=Infinity", "page[]=3&pageSize[]=3"]) {
			const result = await request(`/api/admin/system-logs?${query}`);
			assert.equal(result.status,200); assert.equal(result.data.page,1); assert.equal(result.data.pageSize,20); assert.equal(result.data.logs.length,20);
		}
		const capped = await request("/api/admin/research-events?pageSize=99999", "reader");
		assert.equal(capped.data.pageSize,100); assert.equal(capped.data.events.length,100);
	});
});

test("research and system log pagination preserve authorization boundaries", async () => {
	await fixture(async ({ request }) => {
		for (const route of ["research-events", "research-analytics", "system-logs"]) {
			assert.equal((await request(`/api/admin/${route}?page=2`,null)).status,401);
			assert.equal((await request(`/api/admin/${route}?page=2`,"participant")).status,403);
			assert.equal((await request(`/api/admin/${route}?page=2`,"blocked")).status,403);
		}
		assert.equal((await request("/api/admin/system-logs?page=2","reader")).status,403);
	});
});

test("pagination supports legacy limit safely and clamps after last-page deletions", () => {
	assert.deepEqual(adminPagination({ page: 18, limit: 20 },340),{total:340,page:17,pageSize:20,totalPages:17});
	assert.equal(adminPagination({ pageSize: 1e30 },345).pageSize,20);
	assert.equal(adminPagination({ pageSize: [5], page: { value: 5 } },345).page,1);
});

test("user management pages past 200 users and exports every filtered user, not the current page", async () => {
	await fixture(async ({ request, database }) => {
		const now = "2026-09-10T00:00:00.000Z";
		const insert = database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'participant','unused','unused',?,?)");
		database.transaction(() => { for (let i=0;i<241;i++) insert.run(`paged-${String(i).padStart(3,"0")}`,`Paged ${i}`,`+85270${String(i).padStart(6,"0")}`,now,now); })();
		const initial = await request("/api/admin/users?search=Paged", "users-reader");
		assert.equal(initial.status,200); assert.equal(initial.data.total,241); assert.equal(initial.data.users.length,20);
		const older = await request("/api/admin/users?search=Paged&page=11", "users-reader");
		assert.equal(older.data.users[0].id,"paged-040"); assert.equal(older.data.page,11); assert.equal(older.data.totalPages,13);
		const last = await request("/api/admin/users?search=Paged&page=999", "users-reader");
		assert.equal(last.data.page,13); assert.equal(last.data.users.length,1);
		database.prepare("DELETE FROM users WHERE id='paged-000'").run();
		const clamped = await request("/api/admin/users?search=Paged&page=13", "users-reader");
		assert.equal(clamped.data.page,12); assert.equal(clamped.data.users.length,20);
		const invalid = await request("/api/admin/users?search=Paged&page=-1&pageSize=-1", "users-reader");
		assert.equal(invalid.data.page,1); assert.equal(invalid.data.pageSize,20);
		const exported = await request("/api/admin/users-export?search=Paged&page=13");
		assert.equal(exported.status,200); assert.equal(exported.data.complete,true); assert.equal(exported.data.recordCount,240); assert.equal(exported.data.users.length,240); assert.equal(new Set(exported.data.users.map(item=>item.id)).size,240);
		assert.equal((await request("/api/admin/users-export?search=Paged","users-reader")).status,403);
		assert.equal((await request("/api/admin/users-export?search=Paged","export-only")).status,403);
		assert.equal((await request("/api/admin/users-export",null)).status,401);
		assert.equal((await request("/api/admin/users", "participant")).status,403);
	});
});

test("user export refuses oversized results explicitly without sending a truncated file", async () => {
	await fixture(async ({ request,database }) => {
		const now = "2026-09-10T00:00:00.000Z";
		const insert=database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'participant','unused','unused',?,?)");
		database.transaction(()=>{for(let i=0;i<50001;i++)insert.run(`bulk-${i}`,`Bulk ${i}`,`+85280${String(i).padStart(6,"0")}`,now,now);})();
		const result=await request("/api/admin/users-export?search=Bulk");
		assert.equal(result.status,400); assert.equal(result.data.error,"userExportTooLarge"); assert.equal(result.data.maximum,50000); assert.equal(result.data.total,50001); assert.equal(result.data.users,undefined);
	});
});

test("home content creation and replacement reject videos already in the recycle bin", async () => {
	await fixture(async ({request,database}) => {
		const id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name=`${id}.mp4`, url=`/api/media/${id}/${name}`, now=new Date().toISOString();
		database.prepare("INSERT INTO media_files (id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,created_at,updated_at,deleted_at) VALUES (?,?,?,'video/mp4','video',40,'videos','upload',?,?,?,?)").run(id,url,"Deleted video",name,now,now,now);
		const rejected=await request("/api/admin/content","super",{method:"POST",body:{pageKey:"home",contentType:"video",title:"Deleted selection",value:url}});
		assert.equal(rejected.status,400); assert.equal(rejected.data.error,"invalidContentVideo");
		const original=await request("/api/admin/content","super",{method:"POST",body:{pageKey:"home",contentType:"video",title:"Legacy original",value:"X2cz6HW3J54"}});
		assert.equal(original.status,201);
		const replacement=await request(`/api/admin/content/${original.data.id}`,"super",{method:"PATCH",body:{value:url}});
		assert.equal(replacement.status,400); assert.equal(replacement.data.error,"invalidContentVideo");
		assert.equal(database.prepare("SELECT value FROM content_items WHERE id=?").get(original.data.id).value,"X2cz6HW3J54");
	});
});
