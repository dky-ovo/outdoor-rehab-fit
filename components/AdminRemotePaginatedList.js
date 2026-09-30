import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import AdminPagination from "./AdminPagination";

// The dashboard supplies the first page it has already fetched. Subsequent
// pages are read from the API, not sliced from a capped client-side array.
export default function AdminRemotePaginatedList({ initialData, itemsKey, loadPage, onPageLoaded, resetKey = "", children, locale = "zh-CN", testID = "admin-remote-list", emptyText = "暂无记录" }) {
	const firstState = () => ({ source: initialData, key: resetKey, page: initialData?.page || 1, request: 0, result: initialData, error: null, previous: initialData });
	const [state, setState] = useState(firstState);
	const fetchRef = useRef(loadPage); fetchRef.current = loadPage;
	const loadedRef = useRef(onPageLoaded); loadedRef.current = onPageLoaded;
	const current = state.source === initialData && state.key === resetKey ? state : firstState();
	const en = locale === "en";
	useEffect(() => {
		if (state.source !== initialData || state.key !== resetKey) { setState(firstState()); return undefined; }
		if (state.result || state.error) return undefined;
		let active = true;
		Promise.resolve().then(() => fetchRef.current(state.page, initialData?.pageSize || 20)).then((result) => {
			if (active) { setState((value) => ({ ...value, result, previous: result })); loadedRef.current?.(result); }
		}).catch((error) => { if (active) setState((value) => ({ ...value, error })); });
		return () => { active = false; };
	}, [initialData, resetKey, state.source, state.key, state.page, state.request, state.result, state.error]);
	const requestPage = (page) => setState({ ...current, source: initialData, key: resetKey, page, request: current.request + 1, previous: current.result || current.previous, result: null, error: null });
	const loading = !current.result && !current.error;
	const pagination = current.result || current.previous || initialData || {};
	const items = Array.isArray(current.result?.[itemsKey]) ? current.result[itemsKey] : [];
	return <>
		{loading && <View testID={`${testID}-loading`} style={{ paddingVertical: 20 }}><ActivityIndicator color="#840B1C" /></View>}
		{!!current.error && <View style={{ paddingVertical: 16 }}>
			<Text accessibilityRole="alert" style={{ color: "#B42318" }}>{current.error?.status === 401 || current.error?.status === 403 ? (en ? "You do not have permission to view these records." : "当前账号无权查看这些数据。") : (en ? "Could not load this page. Please retry." : "这一页读取失败，请重试。")}</Text>
			<TouchableOpacity accessibilityRole="button" testID={`${testID}-retry`} onPress={() => requestPage(current.page)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#840B1C" }}>{en ? "Retry" : "重试"}</Text></TouchableOpacity>
		</View>}
		{current.result && !items.length && <Text style={{ paddingVertical: 16, color: "#666" }}>{emptyText}</Text>}
		{items.map(children)}
		<AdminPagination page={current.result?.page || current.page} pageSize={pagination.pageSize || 20} total={pagination.total ?? (pagination[itemsKey] || []).length} onPageChange={requestPage} disabled={loading} locale={locale} testID={`${testID}-pagination`} />
	</>;
}
