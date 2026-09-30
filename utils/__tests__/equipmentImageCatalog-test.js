import { EQUIPMENT_IMAGE_PLACEHOLDER, mergeEquipmentCatalog } from "../equipmentCatalog";
jest.mock("../api", () => ({ resolveApiAssetUrl: value => value }));
const base = [{ id: 9, name: "健騎機", icon: 42, pic: 43, horizontalPic: 44 }];

test("an unknown directory never exposes bundled photos before its replacement is known", () => {
	const [item] = mergeEquipmentCatalog(base, [], "zh", { imageCatalogReady: false });
	for (const key of ["icon", "pic", "horizontalPic", "fallbackIcon", "fallbackHorizontalPic"]) expect(item[key]).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
	expect(item.name).toBe("健騎機");
});
test("remote replacements remove bundled photos from both icon and horizontal fallbacks", () => {
	const [item] = mergeEquipmentCatalog(base, [{ id: "9", imageUrl: "/new.jpg" }]);
	for (const key of ["icon", "pic", "horizontalPic"]) expect(item[key]).toBe("/new.jpg");
	for (const key of ["fallbackIcon", "fallbackHorizontalPic"]) expect(item[key]).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
});
test("an authoritative catalog with no override retains untouched offline images", () => {
	expect(mergeEquipmentCatalog(base, [])[0]).toMatchObject({ icon: 42, pic: 43, horizontalPic: 44 });
});
