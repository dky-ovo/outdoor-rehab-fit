import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { assistantIntent, assistantEquipmentCandidates } from "../src/assistant.js";
import { initializeEquipmentCategories, equipmentCategories } from "../src/equipmentCategories.js";

const SECRET = "equipment-categories-test-only";
async function fixture(run) {
	const database = createDatabase(":memory:"), now = new Date().toISOString(), tokens = {};
	for (const [index,[id,permission,active]] of [["equipment","app_maintenance.equipment.manage",1],["files","app_maintenance.files.manage",1],["locations","app_maintenance.locations.manage",1],["inactive","app_maintenance.equipment.manage",0],["ordinary",null,1],["equipment2","app_maintenance.equipment.manage",1]].entries()) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)").run(id,id,`+8526988000${index}`,now,now);
		if (permission) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,?,?,?)").run(id,JSON.stringify([permission]),active,now,now);
		tokens[id] = signToken({ id,profile_role: "staff" },SECRET);
	}
	const app = createApp({ database,jwtSecret: SECRET }), server = app.listen(0,"127.0.0.1");
	await new Promise(resolve => server.once("listening",resolve));
	const request = async (path,{ actor="equipment",method="GET",body }={}) => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`,{ method,headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}),...(body ? { "Content-Type": "application/json" } : {}) },...(body ? { body: JSON.stringify(body) } : {}) });
		return { status: response.status,data: await response.json() };
	};
	const create = (body,actor) => request("/api/admin/equipment-categories",{ method: "POST",body,actor });
	const update = (id,body,actor) => {
		const baseline = database.prepare("SELECT name_zh AS nameZh,name_en AS nameEn FROM equipment_categories WHERE id=?").get(id);
		return request(`/api/admin/equipment-categories/${encodeURIComponent(id)}`,{ method: "PATCH",body: { expectedNames: baseline,...body },actor });
	};
	try { await run({ database,request,create,update }); }
	finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("category defaults preserve identities, locks and Local Tips independently of TCM",async () => fixture(async ({ request,database }) => {
	const result = await request("/api/equipment-categories",{ actor: null });
	assert.equal(result.status,200); assert.equal(result.data.categories.length,13);
	assert.deepEqual(result.data.categories.find(item => item.id === "alternative"),{ id: "alternative",nameZh: "民間智慧",nameEn: "Local Tips",isBuiltIn: true,showInGuide: true,isLocked: false,sortOrder: 10 });
	assert.equal(result.data.categories.find(item => item.id === "warmup").isLocked,true);
	assert.equal(result.data.categories.find(item => item.id === "special_population").isLocked,true);
	assert.equal(result.data.categories.find(item => item.id === "back").showInGuide,false);
	assert.ok(database.prepare("PRAGMA table_info(app_equipment_items)").all().some(item => item.name === "tcm_zh"));
	assert.deepEqual((await request("/api/equipment-catalog",{ actor: null })).data.categories,result.data.categories);
}));

test("adding and renaming a category keeps equipment bindings and video URLs stable across public and admin catalogs",async () => fixture(async ({ create,update,request,database }) => {
	const created = await create({ nameZh: "椅上練習",nameEn: "Seated Practice" });
	assert.equal(created.status,201); const id = created.data.category.id; assert.match(id,/^category-[a-f0-9-]{36}$/);
	const before = database.prepare("SELECT categories_json,video_url,image_url FROM app_equipment_items WHERE id='0'").get();
	const selected = await request("/api/admin/equipment/0",{ method: "PUT",body: { categories: ["upper",id] } });
	assert.equal(selected.status,200);
	assert.equal((await update(id,{ nameZh: "坐式練習",nameEn: "Seated Activities" })).status,200);
	const stored = database.prepare("SELECT categories_json,video_url,image_url FROM app_equipment_items WHERE id='0'").get();
	assert.equal(stored.categories_json,JSON.stringify(["upper",id])); assert.equal(stored.video_url,before.video_url); assert.equal(stored.image_url,before.image_url);
	const publicResult = (await request("/api/equipment-catalog",{ actor: null })).data;
	assert.equal(publicResult.categories.find(item => item.id === id).nameEn,"Seated Activities");
	assert.ok(publicResult.items.find(item => item.id === "0").categories.includes(id));
	const listed = await request(`/api/admin/equipment-categories?search=${encodeURIComponent("坐式")}`);
	assert.equal(listed.data.categories[0].equipmentCount,1);
	assert.equal(database.prepare("SELECT COUNT(*) AS n FROM system_logs WHERE action LIKE 'equipment_category.%'").get().n,2);
}));

test("renaming built-ins survives reinitialization and existing unrecognized bindings are adopted without loss",async () => fixture(async ({ update,database }) => {
	assert.equal((await update("alternative",{ nameZh: "民間經驗",nameEn: "Community Tips" })).status,200);
	database.prepare("UPDATE app_equipment_items SET categories_json=? WHERE id='0'").run('["upper","legacy-purpose"]');
	initializeEquipmentCategories(database);
	assert.equal(equipmentCategories(database).find(item => item.id === "alternative").nameEn,"Community Tips");
	assert.equal(equipmentCategories(database).find(item => item.id === "legacy-purpose").nameZh,"legacy-purpose");
	assert.equal(database.prepare("SELECT categories_json FROM app_equipment_items WHERE id='0'").get().categories_json,'["upper","legacy-purpose"]');
}));

test("category CRUD requires equipment maintenance and does not accept location or file permissions",async () => fixture(async ({ request,create,update }) => {
	for (const actor of [null,"ordinary","inactive","files","locations"]) {
		assert.equal((await request("/api/admin/equipment-categories",{ actor })).status,actor ? 403 : 401);
		assert.equal((await create({ nameZh: "測試",nameEn: "Testing" },actor)).status,actor ? 403 : 401);
		assert.equal((await update("muscle",{ nameZh: "測試",nameEn: "Testing" },actor)).status,actor ? 403 : 401);
	}
}));

test("invalid input, canonical duplicate names, unknown selections and identity mutations are rejected without changes",async () => fixture(async ({ request,create,update,database }) => {
	const initial = JSON.stringify(equipmentCategories(database));
	for (const body of [{ nameZh: "",nameEn: "A" },{ nameZh: "測試" },{ nameZh: "測試",nameEn: "x".repeat(81) },{ nameZh: "<script>",nameEn: "Test" },{ nameZh: "測試",nameEn: "Test\n" },{ nameZh: "測試",nameEn: "Test",id: "muscle" }]) assert.equal((await create(body)).status,400);
	assert.equal((await create({ nameZh: "新類別",nameEn: "  BALANCE  " })).status,409);
	assert.equal((await update("muscle",{ nameZh: "平衡力" })).status,409);
	assert.equal((await update("muscle",{ id: "renamed-key",nameZh: "新名稱" })).status,400);
	assert.equal((await update("muscle",{ nameZh: null })).status,400);
	assert.equal((await create({ nameZh: "正常名稱",nameEn: "ﬃ".repeat(30) })).status,400);
	assert.equal((await create({ nameZh: "＜script＞",nameEn: "Normal Name" })).status,400);
	assert.equal((await update("missing",{ nameZh: "名稱",nameEn: "Name" })).status,404);
	assert.equal(JSON.stringify(equipmentCategories(database)),initial);
	for (const categories of [[],["not-created"],[12],"muscle",Array(33).fill("muscle")]) assert.equal((await request("/api/admin/equipment/0",{ method: "PUT",body: { categories } })).status,400);
	assert.equal((await request("/api/admin/equipment/0",{ method: "PUT",body: { categories: ["muscle","upper"] } })).status,200);
}));

test("category management returns true bounded pages and search clamping",async () => fixture(async ({ create,request }) => {
	for (let i=0;i<10;i++) assert.equal((await create({ nameZh: `新類別${i}`,nameEn: `New category ${i}` })).status,201);
	const one = (await request("/api/admin/equipment-categories?page=1&pageSize=20")).data;
	const two = (await request("/api/admin/equipment-categories?page=2&pageSize=20")).data;
	assert.equal(one.categories.length,20); assert.equal(two.categories.length,3); assert.equal(two.total,23);
	assert.equal(new Set([...one.categories,...two.categories].map(item => item.id)).size,23);
	const search = (await request(`/api/admin/equipment-categories?search=${encodeURIComponent("新類別")}&page=999&pageSize=3`)).data;
	assert.equal(search.page,4); assert.equal(search.categories.length,1); assert.equal(search.total,10);
	assert.equal((await request("/api/admin/equipment-categories?pageSize=10000")).data.pageSize,100);
}));

test("AI searches custom bilingual labels while preserving greeting, pain, urgency and body-part safety",async () => fixture(async ({ create,database }) => {
	const created = await create({ nameZh: "椅上練習",nameEn: "Seated Practice" }); const id = created.data.category.id;
	const definitions = equipmentCategories(database);
	const catalog = [{ id: "match",name: "椅上器材",categories: [id,"upper"] },{ id: "other",name: "其他器材",categories: ["upper"] }];
	for (const question of ["椅上練習有哪些器材？","Show Seated Practice equipment"]) {
		const intent = assistantIntent(question,[],definitions);
		assert.ok(intent.categories.includes(id)); assert.deepEqual(assistantEquipmentCandidates(catalog,intent).map(item => item.id),["match"]);
	}
	assert.equal(assistantIntent("你好",[{ role: "user",content: "椅上練習有哪些器材" }],definitions).type,"general");
	assert.equal(assistantIntent("Tell me about chemical imbalance",[],definitions).type,"general");
	assert.equal(assistantIntent("胸痛，椅上練習適合嗎",[],definitions).urgent,true);
	assert.equal(assistantIntent("腿痛椅上練習",[],definitions).allowRecommendations,false);
	assert.deepEqual(assistantEquipmentCandidates(catalog,assistantIntent("腿痛推薦椅上練習器材",[],definitions)),[]);
}));

test("PATCH requires a complete original-name baseline, not a timestamp or missing fields",async () => fixture(async ({ request,database }) => {
	const original = database.prepare("SELECT * FROM equipment_categories WHERE id='muscle'").get();
	for (const expectedNames of [undefined,null,[],{}, { nameZh: original.name_zh },{ nameZh: 1,nameEn: original.name_en },{ nameZh: original.name_zh,nameEn: original.name_en,extra: true }]) {
		const result = await request("/api/admin/equipment-categories/muscle",{ method: "PATCH",body: { nameZh: "新名稱",expectedNames } });
		assert.equal(result.status,400); assert.equal(result.data.error,"equipmentCategoryBaselineRequired");
	}
	assert.deepEqual(database.prepare("SELECT * FROM equipment_categories WHERE id='muscle'").get(),original);
}));

test("two administrators cannot overwrite each other's language changes even with identical timestamps or repeated requests",async () => fixture(async ({ request,database }) => {
	const path = "/api/admin/equipment-categories/muscle";
	const baseline = database.prepare("SELECT name_zh AS nameZh,name_en AS nameEn,updated_at FROM equipment_categories WHERE id='muscle'").get();
	const expectedNames = { nameZh: baseline.nameZh,nameEn: baseline.nameEn };
	const firstBody = { nameZh: "肌力練習",nameEn: baseline.nameEn,expectedNames };
	assert.equal((await request(path,{ method: "PATCH",actor: "equipment",body: firstBody })).status,200);
	// Equal clock ticks must not make stale edits look current.
	database.prepare("UPDATE equipment_categories SET updated_at=? WHERE id='muscle'").run(baseline.updated_at);
	const staleSecond = await request(path,{ method: "PATCH",actor: "equipment2",body: { nameZh: baseline.nameZh,nameEn: "Strength Practice",expectedNames } });
	assert.equal(staleSecond.status,409); assert.equal(staleSecond.data.error,"equipmentCategoryChanged");
	const replay = await request(path,{ method: "PATCH",actor: "equipment",body: firstBody });
	assert.equal(replay.status,409); assert.equal(replay.data.error,"equipmentCategoryChanged");
	assert.deepEqual(database.prepare("SELECT name_zh AS nameZh,name_en AS nameEn FROM equipment_categories WHERE id='muscle'").get(),{ nameZh: "肌力練習",nameEn: baseline.nameEn });
	const fresh = { nameZh: "肌力練習",nameEn: baseline.nameEn };
	const retried = await request(path,{ method: "PATCH",actor: "equipment2",body: { ...fresh,nameEn: "Strength Practice",expectedNames: fresh } });
	assert.equal(retried.status,200); assert.equal(retried.data.category.nameZh,"肌力練習"); assert.equal(retried.data.category.nameEn,"Strength Practice");
	assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action='equipment_category.update'").get().count,2);
}));

test("simultaneous category edits accept one baseline and reject the other without partial changes",async () => fixture(async ({ request,database }) => {
	const expectedNames = database.prepare("SELECT name_zh AS nameZh,name_en AS nameEn FROM equipment_categories WHERE id='muscle'").get();
	const results = await Promise.all(["equipment","equipment2"].map((actor,index) => request("/api/admin/equipment-categories/muscle",{ actor,method: "PATCH",body: { nameZh: `修改${index}`,nameEn: `Edit ${index}`,expectedNames } })));
	assert.deepEqual(results.map(result => result.status).sort(),[200,409]);
	const success=results.find(result => result.status===200).data.category;
	assert.deepEqual(database.prepare("SELECT name_zh AS nameZh,name_en AS nameEn FROM equipment_categories WHERE id='muscle'").get(),{ nameZh: success.nameZh,nameEn: success.nameEn });
}));
