function first(value) {
	return String(Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

export function equipmentListBackTarget(route = {}) {
	return first(route.from) === "goals" ? "/(tabs)/goals" : "/outdoor";
}

function listOrigin(route) {
	return first(route.listFrom) === "goals" ? { from: "goals" } : {};
}

export function equipmentDetailBackTarget(route) {
	const from = first(route.from);
	if (from === "ai") return "/chat";
	if (from === "favorite") return "/favorite";
	if (from === "list" || first(route.categoryId)) return {
		pathname: "/outdoor/list",
		params: { categoryId: first(route.categoryId) || "all", categoryName: first(route.categoryName), ...listOrigin(route) },
	};
	return null;
}

export function equipmentLocationReturnTarget(route) {
	const source = first(route.locationSource);
	if (source === "detail" && first(route.equipmentId)) return {
		pathname: first(route.detailFrom) === "favorite" ? "/favorite/detail" : "/outdoor/detail",
		params: {
			id: first(route.equipmentId), name: first(route.equipmentName),
			from: first(route.detailFrom), categoryId: first(route.categoryId), categoryName: first(route.categoryName),
			...(first(route.listFrom) === "goals" ? { listFrom: "goals" } : {}),
		},
	};
	if (source === "list") return {
		pathname: "/outdoor/list",
		params: { categoryId: first(route.categoryId) || "all", categoryName: first(route.categoryName), ...listOrigin(route) },
	};
	return "/(tabs)";
}
