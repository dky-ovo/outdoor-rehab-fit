import { useEffect, useState } from "react";

export const ADMIN_PAGE_SIZE = 20;

export function adminPageWindow(total, requestedPage = 1, requestedPageSize = ADMIN_PAGE_SIZE) {
	const count = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0;
	const pageSize = Number.isFinite(Number(requestedPageSize)) ? Math.min(100, Math.max(1, Math.floor(Number(requestedPageSize)))) : ADMIN_PAGE_SIZE;
	const totalPages = Math.max(1, Math.ceil(count / pageSize));
	const page = Number.isFinite(Number(requestedPage)) ? Math.max(1, Math.min(totalPages, Math.floor(Number(requestedPage)))) : 1;
	return { total: count, page, pageSize, totalPages, start: (page - 1) * pageSize, end: Math.min(count, page * pageSize) };
}

// A changed search/account key resets immediately, before effects run. Clamp on
// deletion as well so removing the last item on the last page never shows a blank page.
export function useAdminPagination(items = [], { pageSize = ADMIN_PAGE_SIZE, resetKey = "" } = {}) {
	const [state, setState] = useState({ key: resetKey, page: 1 });
	const source = Array.isArray(items) ? items : [];
	const window = adminPageWindow(source.length, state.key === resetKey ? state.page : 1, pageSize);
	useEffect(() => {
		setState((current) => current.key === resetKey && current.page === window.page ? current : { key: resetKey, page: window.page });
	}, [resetKey, window.page]);
	return { ...window, items: source.slice(window.start, window.end), setPage: (page) => setState({ key: resetKey, page: adminPageWindow(source.length, page, pageSize).page }) };
}
