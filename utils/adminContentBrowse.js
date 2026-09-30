// Read-only view helpers. Filters never change the stored content or its status.
const text = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
export function filterAdminContent(items, { search = "", status = "all", sort = "order" } = {}, fields = []) {
	const terms = text(search).split(/\s+/).filter(Boolean);
	return (items || []).filter(item => {
		if (status === "active" && !item.isActive) return false;
		if (status === "inactive" && item.isActive) return false;
		const haystack = fields.map(field => text(typeof field === "function" ? field(item) : item[field])).join(" ");
		return terms.every(term => haystack.includes(term));
	}).slice().sort((a,b) => {
		if (sort === "name") return text(a.nameZh || a.title || a.regionZh || a.nameEn).localeCompare(text(b.nameZh || b.title || b.regionZh || b.nameEn), "zh-Hant", { numeric: true });
		return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
	});
}
