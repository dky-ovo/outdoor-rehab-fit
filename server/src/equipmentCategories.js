import crypto from "node:crypto";
import { adminPagination } from "./adminPagination.js";

// Keys are stable identities, not labels. Renaming never rewrites equipment
// bindings or the built-in keys used by existing APPs and AI safety filters.
export const BUILT_IN_EQUIPMENT_CATEGORIES = [
	["muscle", "肌肉強化", "Muscle Strengthening"],
	["mobility", "關節靈活性及伸展", "Mobility and Flexibility"],
	["balance", "平衡力", "Balance"], ["aerobic", "帶氧運動", "Aerobic Activity"],
	["wheelchair", "坐輪椅人士使用", "For Wheelchair Users"],
	["multifunctional", "多功能型", "Multi-functional & Integrative"],
	["relaxation", "肌肉放鬆", "Muscle Relaxation"],
	["upper", "上肢運動", "Upper Limbs Exercise"], ["lower", "下肢運動", "Lower Limbs Exercise"],
	["back", "腰背", "Back Exercise", false],
	["alternative", "民間智慧", "Local Tips"],
	["special_population", "特殊人群", "Special Population", true, true],
	["warmup", "中風人士", "Chronic Stroke Survivor", true, true],
].map(([id, nameZh, nameEn, showInGuide = true, isLocked = false], sortOrder) => ({ id, nameZh, nameEn, isBuiltIn: true, showInGuide, isLocked, sortOrder }));

export function initializeEquipmentCategories(database) {
	database.exec(`CREATE TABLE IF NOT EXISTS equipment_categories (
		id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT NOT NULL,
		is_builtin INTEGER NOT NULL DEFAULT 0, show_in_guide INTEGER NOT NULL DEFAULT 1,
		is_locked INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	)`);
	const now = new Date().toISOString();
	const insert = database.prepare(`INSERT OR IGNORE INTO equipment_categories
		(id,name_zh,name_en,is_builtin,show_in_guide,is_locked,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
	database.transaction(() => {
		for (const item of BUILT_IN_EQUIPMENT_CATEGORIES) insert.run(item.id,item.nameZh,item.nameEn,1,Number(item.showInGuide),Number(item.isLocked),item.sortOrder,now,now);
		// Older maintenance clients accepted free-form keys. Adopt those keys
		// without dropping, guessing translations or altering existing bindings.
		for (const row of database.prepare("SELECT categories_json FROM app_equipment_items").all()) {
			let keys; try { keys = JSON.parse(row.categories_json); } catch { continue; }
			if (!Array.isArray(keys)) continue;
			for (const key of keys) if (typeof key === "string" && key.trim()) insert.run(key,key,key,0,1,0,100,now,now);
		}
	})();
}

function publicCategory(row) {
	return { id: row.id, nameZh: row.name_zh, nameEn: row.name_en, isBuiltIn: Boolean(row.is_builtin), showInGuide: Boolean(row.show_in_guide), isLocked: Boolean(row.is_locked), sortOrder: row.sort_order };
}
export function equipmentCategories(database) {
	return database.prepare("SELECT * FROM equipment_categories ORDER BY sort_order,created_at,id").all().map(publicCategory);
}
export function validEquipmentCategorySelection(database, value) {
	if (!Array.isArray(value) || !value.length || value.length > 32 || value.some(key => typeof key !== "string")) return false;
	const known = new Set(equipmentCategories(database).map(item => item.id));
	return value.every(key => known.has(key));
}
function normalizedName(value) { return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(); }
function inputNames(body, current) {
	if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["nameZh", "nameEn"].includes(key))) return null;
	const names = {};
	for (const key of ["nameZh", "nameEn"]) {
		const value = Object.prototype.hasOwnProperty.call(body,key) ? body[key] : current?.[key];
		if (typeof value !== "string" || /[\u0000-\u001f\u007f<>]/.test(value)) return null;
		const normalized = value.trim().normalize("NFKC");
		if (!normalized || normalized.length > 80 || /[<>]/.test(normalized)) return null;
		names[key] = normalized;
	}
	return names;
}
function duplicateNames(database, names, exceptId = "") {
	const values = new Set(Object.values(names).map(normalizedName));
	return equipmentCategories(database).some(item => item.id !== exceptId && [item.nameZh,item.nameEn].some(name => values.has(normalizedName(name))));
}

export function registerEquipmentCategories({ app, database, requirePermission, writeSystemLog }) {
	app.get("/api/equipment-categories", (_request,response) => response.json({ categories: equipmentCategories(database) }));
	const permission = requirePermission("app_maintenance.equipment.manage");
	app.get("/api/admin/equipment-categories", permission, (request,response) => {
		const search = String(request.query.search || "").trim().toLocaleLowerCase().slice(0, 100);
		const categories = equipmentCategories(database).filter(item => !search || `${item.id} ${item.nameZh} ${item.nameEn}`.toLocaleLowerCase().includes(search));
		const pagination = adminPagination(request.query,categories.length);
		const counts = new Map();
		for (const row of database.prepare("SELECT categories_json FROM app_equipment_items WHERE deleted_at IS NULL").all()) {
			let keys; try { keys = JSON.parse(row.categories_json); } catch { continue; }
			if (Array.isArray(keys)) for (const key of new Set(keys)) counts.set(key,(counts.get(key)||0)+1);
		}
		const start = (pagination.page - 1) * pagination.pageSize;
		return response.json({ categories: categories.slice(start,start+pagination.pageSize).map(item => ({ ...item,equipmentCount: counts.get(item.id)||0 })), ...pagination });
	});
	app.post("/api/admin/equipment-categories", permission, (request,response) => {
		const names = inputNames(request.body);
		if (!names) return response.status(400).json({ error: "invalidEquipmentCategory" });
		const result = database.transaction(() => {
			if (duplicateNames(database,names)) return { error: "equipmentCategoryNameConflict", status: 409 };
			if (database.prepare("SELECT COUNT(*) AS count FROM equipment_categories").get().count >= 200) return { error: "equipmentCategoryLimit", status: 409 };
			const id = `category-${crypto.randomUUID()}`, now = new Date().toISOString();
			const order = database.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM equipment_categories").get().value;
			database.prepare("INSERT INTO equipment_categories (id,name_zh,name_en,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id,names.nameZh,names.nameEn,order,now,now);
			writeSystemLog(database,request,"equipment_category.create","equipment_category",id,names);
			return { category: publicCategory(database.prepare("SELECT * FROM equipment_categories WHERE id=?").get(id)) };
		}).immediate();
		return response.status(result.status || 201).json(result);
	});
	app.patch("/api/admin/equipment-categories/:id", permission, (request,response) => {
		const result = database.transaction(() => {
			const row = database.prepare("SELECT * FROM equipment_categories WHERE id=?").get(request.params.id);
			if (!row) return { error: "equipmentCategoryNotFound", status: 404 };
			const body = request.body;
			const expected = body?.expectedNames;
			if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== 2 || typeof expected.nameZh !== "string" || typeof expected.nameEn !== "string") return { error: "equipmentCategoryBaselineRequired", status: 400 };
			const { expectedNames: _expectedNames, ...changes } = body;
			const before = publicCategory(row), names = inputNames(changes,before);
			if (!names) return { error: "invalidEquipmentCategory", status: 400 };
			// Compare values under the same write transaction, not timestamps:
			// two administrators can save in the same clock tick.
			if (expected.nameZh !== before.nameZh || expected.nameEn !== before.nameEn) return { error: "equipmentCategoryChanged", status: 409 };
			if (duplicateNames(database,names,row.id)) return { error: "equipmentCategoryNameConflict", status: 409 };
			database.prepare("UPDATE equipment_categories SET name_zh=?,name_en=?,updated_at=? WHERE id=?").run(names.nameZh,names.nameEn,new Date().toISOString(),row.id);
			writeSystemLog(database,request,"equipment_category.update","equipment_category",row.id,{ before, ...names });
			return { category: { ...before,...names } };
		}).immediate();
		return response.status(result.status || 200).json(result);
	});
}
