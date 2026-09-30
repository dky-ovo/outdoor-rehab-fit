import { equipmentDetailBackTarget, equipmentListBackTarget, equipmentLocationReturnTarget } from "../equipmentLocationRoutes";

test.each(["aerobic", "balance", "muscle"])("goal recommendation %s returns through locations/detail/list to goal settings", (categoryId) => {
	const route = { locationSource: "detail", equipmentId: "0", equipmentName: "Tai Chi", detailFrom: "list", listFrom: "goals", categoryId, categoryName: "Label" };
	const detail = equipmentLocationReturnTarget(route);
	expect(detail.pathname).toBe("/outdoor/detail");
	expect(detail.params.listFrom).toBe("goals");
	const list = equipmentDetailBackTarget(detail.params);
	expect(list).toEqual({ pathname: "/outdoor/list", params: { categoryId, categoryName: "Label", from: "goals" } });
	expect(equipmentListBackTarget(list.params)).toBe("/(tabs)/goals");
	const directList = equipmentLocationReturnTarget({ ...route, locationSource: "list" });
	expect(directList).toEqual(list);
});

test("normal facility, favorite and AI origins keep their own parents", () => {
	expect(equipmentDetailBackTarget({ from: "ai", listFrom: "goals" })).toBe("/chat");
	expect(equipmentDetailBackTarget({ from: "favorite" })).toBe("/favorite");
	expect(equipmentListBackTarget({ from: "unknown" })).toBe("/outdoor");
	expect(equipmentListBackTarget({ from: ["goals"] })).toBe("/(tabs)/goals");
});

test("a map opened from Favorites returns to its own detail stack, including array URL params", () => {
	const detail = equipmentLocationReturnTarget({ locationSource: ["detail"], equipmentId: ["0"], equipmentName: ["Tai Chi"], detailFrom: ["favorite"] });
	expect(detail).toEqual({ pathname: "/favorite/detail", params: { id: "0", name: "Tai Chi", from: "favorite", categoryId: "", categoryName: "" } });
	expect(equipmentDetailBackTarget(detail.params)).toBe("/favorite");
});
