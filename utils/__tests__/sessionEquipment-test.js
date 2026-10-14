import { countSessionEquipment, equipmentUseCount, sortSessionEquipment } from "../sessionEquipment";

test("favorites precede other equipment, then completed usage sorts descending with stable ties", () => {
	const items = [{ id: 0, name: "Zero" }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
	const bookmarks = { 1: true, 2: true, 3: true };
	const counts = { "id:0": 100, "id:1": 1, "id:2": 5, "id:3": 1 };
	expect(sortSessionEquipment(items, bookmarks, counts).map(item => item.id)).toEqual([2, 1, 3, 0, 4]);
	expect(items.map(item => item.id)).toEqual([0, 1, 2, 3, 4]);
});

test("one saved session counts equipment once, including id zero; legacy names remain usable", () => {
	const counts = countSessionEquipment([
		{ exercises: [{ equipmentId: 0, name: "Zero" }, { equipmentId: 0, name: "Zero" }] },
		{ exercises: [{ equipmentId: 0, name: "零" }] },
		{ exercises: [{ name: "Zero" }] },
		{ exercises: [{ equipmentId: 1, name: "Zero" }] },
	]);
	expect(equipmentUseCount({ id: 0, name: "Zero" }, counts)).toBe(3);
	expect(equipmentUseCount({ id: 0, name: "零" }, counts)).toBe(2);
	expect(counts["id:1"]).toBe(1);
});
