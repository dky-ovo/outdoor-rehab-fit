import crypto from "node:crypto";
import { adminPagination } from "./adminPagination.js";
import { revalidateAdmin } from "./adminAuthorization.js";
export { BUILT_IN_EQUIPMENT_CATEGORIES } from "./equipmentCategories.js";

const COLUMNS = "id,name_zh,name_en,is_builtin,show_in_guide,is_locked,sort_order,created_at,updated_at";
const enabled = value => [1, "1", 1n].includes(value);
function publicCategory(row) {
  const sortOrder = Number(row.sort_order);
  if (!Number.isSafeInteger(sortOrder)) throw new Error("EQUIPMENT_CATEGORY_ORDER_INVALID");
  return { id: row.id, nameZh: row.name_zh, nameEn: row.name_en, isBuiltIn: enabled(row.is_builtin),
    showInGuide: enabled(row.show_in_guide), isLocked: enabled(row.is_locked), sortOrder };
}
export async function equipmentCategories(database) {
  return (await database.all(`SELECT ${COLUMNS} FROM equipment_categories ORDER BY sort_order,created_at,id`, [])).map(publicCategory);
}
export async function validEquipmentCategorySelection(database, value) {
  if (!Array.isArray(value) || !value.length || value.length > 32 || value.some(key => typeof key !== "string")) return false;
  const known = new Set((await equipmentCategories(database)).map(item => item.id));
  return value.every(key => known.has(key));
}
function normalizedName(value) { return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(); }
function inputNames(body, current) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["nameZh", "nameEn"].includes(key))) return null;
  const names = {};
  for (const key of ["nameZh", "nameEn"]) {
    const value = Object.hasOwn(body, key) ? body[key] : current?.[key];
    if (typeof value !== "string" || /[\u0000-\u001f\u007f<>]/.test(value)) return null;
    const normalized = value.trim().normalize("NFKC");
    if (!normalized || normalized.length > 80 || /[<>]/.test(normalized)) return null;
    names[key] = normalized;
  }
  return names;
}
function duplicateNames(categories, names, exceptId = "") {
  const values = new Set(Object.values(names).map(normalizedName));
  return categories.some(item => item.id !== exceptId && [item.nameZh, item.nameEn].some(name => values.has(normalizedName(name))));
}
function write(result) {
  if (result?.warningStatus !== 0 || result.affectedRows !== 1) throw new Error("EQUIPMENT_CATEGORY_WRITE_FAILED");
}
async function lockedCategories(database, request) {
  await revalidateAdmin(database, request, "app_maintenance.equipment.manage");
  // Imported built-in row is the common anchor for NFKC duplicate-name checks,
  // ordering and the 200-category cap, including inserts with different IDs.
  if (!await database.get("SELECT id FROM equipment_categories WHERE id = ? FOR UPDATE", ["muscle"])) throw new Error("EQUIPMENT_CATEGORY_BASELINE_MISSING");
  return (await database.all(`SELECT ${COLUMNS} FROM equipment_categories ORDER BY id FOR UPDATE`, [])).map(publicCategory);
}
export async function registerEquipmentCategories({ app, database, requirePermission, writeSystemLog }) {
  app.get("/api/equipment-categories", async (_request, response) => response.json({ categories: await equipmentCategories(database) }));
  const permission = requirePermission("app_maintenance.equipment.manage");
  app.get("/api/admin/equipment-categories", permission, async (request, response) => {
    const result = await database.transaction(async () => {
      await revalidateAdmin(database, request, "app_maintenance.equipment.manage");
      const search = String(request.query.search || "").trim().toLocaleLowerCase().slice(0, 100);
      const categories = (await equipmentCategories(database)).filter(item => !search || `${item.id} ${item.nameZh} ${item.nameEn}`.toLocaleLowerCase().includes(search));
      const pagination = adminPagination(request.query, categories.length), counts = new Map();
      for (const row of await database.all("SELECT categories_json FROM app_equipment_items WHERE deleted_at IS NULL", [])) {
        let keys; try { keys = JSON.parse(row.categories_json); } catch { continue; }
        if (Array.isArray(keys)) for (const key of new Set(keys)) counts.set(key, (counts.get(key) || 0) + 1);
      }
      const start = (pagination.page - 1) * pagination.pageSize;
      return { categories: categories.slice(start, start + pagination.pageSize).map(item => ({ ...item, equipmentCount: counts.get(item.id) || 0 })), ...pagination };
    });
    return response.json(result);
  });
  app.post("/api/admin/equipment-categories", permission, async (request, response) => {
    const names = inputNames(request.body);
    if (!names) return response.status(400).json({ error: "invalidEquipmentCategory" });
    const result = await database.transaction(async () => {
      const categories = await lockedCategories(database, request);
      if (duplicateNames(categories, names)) return { error: "equipmentCategoryNameConflict", status: 409 };
      if (categories.length >= 200) return { error: "equipmentCategoryLimit", status: 409 };
      const id = `category-${crypto.randomUUID()}`, now = new Date().toISOString();
      const order = Math.max(0, ...categories.map(item => item.sortOrder)) + 1;
      if (!Number.isSafeInteger(order)) throw new Error("EQUIPMENT_CATEGORY_ORDER_INVALID");
      write(await database.run("INSERT INTO equipment_categories (id,name_zh,name_en,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)", [id, names.nameZh, names.nameEn, order, now, now]));
      await writeSystemLog(database, request, "equipment_category.create", "equipment_category", id, names);
      return { category: publicCategory(await database.get(`SELECT ${COLUMNS} FROM equipment_categories WHERE id=?`, [id])) };
    });
    return response.status(result.status || 201).json(result);
  });
  app.patch("/api/admin/equipment-categories/:id", permission, async (request, response) => {
    const result = await database.transaction(async () => {
      const categories = await lockedCategories(database, request);
      const before = categories.find(item => item.id === request.params.id);
      if (!before) return { error: "equipmentCategoryNotFound", status: 404 };
      const body = request.body, expected = body?.expectedNames;
      if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== 2 || typeof expected.nameZh !== "string" || typeof expected.nameEn !== "string") return { error: "equipmentCategoryBaselineRequired", status: 400 };
      const { expectedNames: _expected, ...changes } = body, names = inputNames(changes, before);
      if (!names) return { error: "invalidEquipmentCategory", status: 400 };
      if (expected.nameZh !== before.nameZh || expected.nameEn !== before.nameEn) return { error: "equipmentCategoryChanged", status: 409 };
      if (duplicateNames(categories, names, before.id)) return { error: "equipmentCategoryNameConflict", status: 409 };
      write(await database.run("UPDATE equipment_categories SET name_zh=?,name_en=?,updated_at=? WHERE id=?", [names.nameZh, names.nameEn, new Date().toISOString(), before.id]));
      await writeSystemLog(database, request, "equipment_category.update", "equipment_category", before.id, { before, ...names });
      return { category: { ...before, ...names } };
    });
    return response.status(result.status || 200).json(result);
  });
}
