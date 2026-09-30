import { filterAdminContent } from "../adminContentBrowse";

const items = [
	{ id: "a", nameZh: "太極揉推器", nameEn: "Tai Chi Wheel", sortOrder: 3, isActive: true, category: "肌肉强化" },
	{ id: "b", nameZh: "小腿伸展", nameEn: "Calf stretch", sortOrder: 1, isActive: false, category: "下肢" },
];
const fields = ["id", "nameZh", "nameEn", item => item.category];
test("matches bilingual names, IDs and category labels without changing source order", () => {
	expect(filterAdminContent(items,{ search: "ＴＡＩ wheel" },fields).map(item => item.id)).toEqual(["a"]);
	expect(filterAdminContent(items,{ search: "下肢" },fields).map(item => item.id)).toEqual(["b"]);
	expect(items.map(item => item.id)).toEqual(["a","b"]);
});
test("combines filters and resets to display order", () => {
	expect(filterAdminContent(items,{ search: "小腿", status: "active" },fields)).toEqual([]);
	expect(filterAdminContent(items,{ status: "inactive" },fields).map(item => item.id)).toEqual(["b"]);
	expect(filterAdminContent(items,{},fields).map(item => item.id)).toEqual(["b","a"]);
});
test("empty and missing fields are safe", () => {
	expect(filterAdminContent(null)).toEqual([]);
	expect(filterAdminContent([{}],{ search: "x" },["name"])).toEqual([]);
});
