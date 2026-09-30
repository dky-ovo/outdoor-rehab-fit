import React from "react";
import AdminPagination from "./AdminPagination";
import { useAdminPagination } from "../utils/adminPagination";

export default function AdminPaginatedList({ items = [], children, resetKey = "", pageSize = 20, locale = "zh-CN", testID = "admin-list" }) {
	const pagination = useAdminPagination(items, { resetKey, pageSize });
	return <>
		{pagination.items.map((item, index) => children(item, pagination.start + index))}
		<AdminPagination {...pagination} locale={locale} onPageChange={pagination.setPage} testID={`${testID}-pagination`} />
	</>;
}
