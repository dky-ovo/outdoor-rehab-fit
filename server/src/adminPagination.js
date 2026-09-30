// Both inputs are untrusted query values. Do not allow negative LIMIT/OFFSET,
// fractional pages, Infinity, or a caller-controlled unlimited result set.
export function adminPagination(query = {}, total = 0) {
	const positiveInteger = (value, fallback) => {
		if (typeof value !== "string" && typeof value !== "number") return fallback;
		const number = Number(value);
		return Number.isSafeInteger(number) && number > 0 ? number : fallback;
	};
	const pageSize = Math.min(100, positiveInteger(query.pageSize ?? query.limit, 20));
	const count = Math.max(0, Number(total) || 0);
	const totalPages = Math.max(1, Math.ceil(count / pageSize));
	const page = Math.min(totalPages, positiveInteger(query.page, 1));
	return { total: count, page, pageSize, totalPages };
}
