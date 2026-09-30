import fs from "node:fs";
import path from "node:path";
import { DEFAULT_EQUIPMENT_CATEGORIES, equipmentCategoryLabel, mergeEquipmentCategories } from "../equipmentCatalog";
jest.mock("../api",() => ({ resolveApiAssetUrl: value => value }));

test("category fallback labels and keys mirror the server defaults",() => {
	const source=fs.readFileSync(path.join(__dirname,"../../server/src/equipmentCategories.js"),"utf8");
	for (const item of DEFAULT_EQUIPMENT_CATEGORIES) for (const value of [item.id,item.nameZh,item.nameEn]) expect(source).toContain(JSON.stringify(value));
	expect(DEFAULT_EQUIPMENT_CATEGORIES.find(item => item.id === "alternative").nameZh).toBe("民間智慧");
});
test("renamed built-in and custom categories merge by immutable ID without altering defaults",() => {
	const result=mergeEquipmentCategories([{ id: "muscle",nameZh: "肌力練習",nameEn: "Strength Practice" },{ id: "category-new",nameZh: "新分類",nameEn: "New Category",sortOrder: 50 }]);
	expect(result.filter(item => item.id === "muscle")).toHaveLength(1);
	expect(result.find(item => item.id === "muscle").nameZh).toBe("肌力練習");
	expect(DEFAULT_EQUIPMENT_CATEGORIES.find(item => item.id === "muscle").nameZh).toBe("肌肉強化");
	expect(result.at(-1)).toEqual(expect.objectContaining({ id: "category-new",showInGuide: true,isLocked: false }));
});
test("labels use the chosen language with an explicit fallback",() => {
	expect(equipmentCategoryLabel({ id: "new",nameZh: "中文",nameEn: "English" },"en")).toBe("English");
	expect(equipmentCategoryLabel({ id: "new",nameZh: "中文",nameEn: "English" },"zh-CN")).toBe("中文");
	expect(equipmentCategoryLabel({ id: "new",nameZh: "中文" },"en")).toBe("中文");
	expect(equipmentCategoryLabel({ id: "new" },"en")).toBe("new");
});
