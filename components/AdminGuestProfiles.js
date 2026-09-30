import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getAdminGuestProfiles } from "../utils/api";

const COPY = {
	"zh-CN": {
		title: "访客资料", note: "来自 APP 访客基本资料表单：仅收集年龄、性别和使用目的，不收集姓名、电话或定位。",
		boundary: "每条代表一次成功提交，不代表独立访客人数。未成功上传的离线资料不会出现在这里。",
		gender: "性别", purpose: "使用目的", all: "全部", age: "年龄", id: "记录编号", time: "提交时间（香港）",
		genders: { female: "女", male: "男", other: "其他／不透露" },
		purposes: { personal: "个人使用", family: "家庭照顾者", industry: "健康与保健行业工作者" },
		count: "符合条件的提交记录", records: "条", empty: "暂无符合条件的访客资料", refresh: "刷新访客资料", reset: "清除筛选",
		previous: "上一页", next: "下一页", page: "页", loading: "正在读取访客资料…", error: "访客资料读取失败，请重试。",
		denied: "当前账号无权查看访客资料，请联系管理员。", unavailable: "服务器尚未支持访客资料列表，请先部署本次后台更新。",
	},
	"zh-HK": {
		title: "訪客資料", note: "來自 APP 訪客基本資料表單：僅收集年齡、性別和使用目的，不收集姓名、電話或定位。",
		boundary: "每條代表一次成功提交，不代表獨立訪客人數。未成功上傳的離線資料不會出現在這裡。",
		gender: "性別", purpose: "使用目的", all: "全部", age: "年齡", id: "記錄編號", time: "提交時間（香港）",
		genders: { female: "女", male: "男", other: "其他／不透露" },
		purposes: { personal: "個人使用", family: "家庭照顧者", industry: "健康與保健行業工作者" },
		count: "符合條件的提交記錄", records: "條", empty: "暫無符合條件的訪客資料", refresh: "重新整理訪客資料", reset: "清除篩選",
		previous: "上一頁", next: "下一頁", page: "頁", loading: "正在讀取訪客資料…", error: "訪客資料讀取失敗，請重試。",
		denied: "目前帳號無權查看訪客資料，請聯絡管理員。", unavailable: "伺服器尚未支援訪客資料列表，請先部署本次後台更新。",
	},
	en: {
		title: "Guest information", note: "Submitted through the APP guest form: age, gender and purpose only. Names, phone numbers and location are not collected.",
		boundary: "Each record is one successful submission, not a unique visitor. Offline information that has not been uploaded is not listed.",
		gender: "Gender", purpose: "Purpose", all: "All", age: "Age", id: "Record ID", time: "Submitted (Hong Kong)",
		genders: { female: "Female", male: "Male", other: "Other / Prefer not to say" },
		purposes: { personal: "Personal use", family: "Family caregiver", industry: "Health and wellness worker" },
		count: "Matching submissions", records: "records", empty: "No guest information matches these filters", refresh: "Refresh guest information", reset: "Clear filters",
		previous: "Previous", next: "Next", page: "Page", loading: "Loading guest information…", error: "Could not load guest information. Please retry.",
		denied: "This account cannot view guest information. Please contact an administrator.", unavailable: "The server does not support guest information yet. Deploy this backend update first.",
	},
};

function submittedTime(value, locale) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString(locale === "en" ? "en-GB" : locale, { timeZone: "Asia/Hong_Kong", hour12: false });
}

export default function AdminGuestProfiles({ token, locale = "zh-CN", refreshKey = 0 }) {
	const labels = COPY[locale] || COPY["zh-CN"];
	const [query, setQuery] = useState({ page: 1, gender: "", purpose: "" });
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState(null);
	const requestKey = JSON.stringify([token, query.page, query.gender, query.purpose, refreshKey, revision]);

	useEffect(() => {
		let current = true;
		if (!token) return () => { current = false; };
		getAdminGuestProfiles(token, { ...query, pageSize: 20 }).then((data) => {
			if (current) setResult({ key: requestKey, data });
		}).catch((error) => {
			if (current) setResult({ key: requestKey, error: error?.status === 401 || error?.status === 403 ? "denied" : error?.status === 404 ? "unavailable" : "error" });
		});
		return () => { current = false; };
	}, [token, query, requestKey]);

	// Do not display the previous filter/account's rows while a new request loads.
	const activeResult = result?.key === requestKey ? result : null;
	const loading = Boolean(token) && !activeResult;
	const data = activeResult?.data;
	const totalPages = Math.max(1, Number(data?.totalPages) || 0);
	const updateFilter = (key, value) => setQuery((current) => ({ ...current, [key]: value, page: 1 }));
	const refresh = () => { setQuery((current) => ({ ...current, page: 1 })); setRevision((value) => value + 1); };
	const optionGroup = (key, options) => (
		<View style={styles.filterGroup}>
			<Text style={styles.label}>{labels[key]}</Text>
			<View style={styles.row}>
				{[["", labels.all], ...Object.entries(options)].map(([value, label]) => (
					<TouchableOpacity key={value} testID={`guest-${key}-${value || "all"}`} accessibilityRole="button" accessibilityState={{ selected: query[key] === value }}
						style={[styles.option, query[key] === value && styles.selected]} onPress={() => updateFilter(key, value)}>
						<Text style={[styles.optionText, query[key] === value && styles.selectedText]}>{label}</Text>
					</TouchableOpacity>
				))}
			</View>
		</View>
	);

	return (
		<View testID="admin-guest-profiles">
			<View style={styles.header}>
				<Text style={styles.title}>{labels.title}</Text>
				<TouchableOpacity testID="guest-refresh" accessibilityRole="button" style={styles.option} onPress={refresh} disabled={loading}>
					<Text style={styles.optionText}>{labels.refresh}</Text>
				</TouchableOpacity>
			</View>
			<Text style={styles.note}>{labels.note}</Text>
			<Text style={styles.note}>{labels.boundary}</Text>
			{optionGroup("gender", labels.genders)}
			{optionGroup("purpose", labels.purposes)}
			{Boolean(query.gender || query.purpose) && <TouchableOpacity testID="guest-reset" accessibilityRole="button" style={styles.reset} onPress={() => setQuery({ page: 1, gender: "", purpose: "" })}><Text style={styles.optionText}>{labels.reset}</Text></TouchableOpacity>}
			{loading && <View style={styles.status}><ActivityIndicator color="#840B1C" /><Text style={styles.note}>{labels.loading}</Text></View>}
			{(!token || activeResult?.error) && <Text accessibilityRole="alert" style={styles.error}>{labels[!token ? "denied" : activeResult.error]}</Text>}
			{data && <>
				<Text style={styles.count}>{labels.count}：{data.total} {labels.records}</Text>
				{!data.guestProfiles.length && <Text style={styles.empty}>{labels.empty}</Text>}
				{data.guestProfiles.map((profile) => <View key={profile.id} testID="guest-record" style={styles.card}>
					<View style={styles.fields}>
						<View style={styles.field}><Text style={styles.label}>{labels.age}</Text><Text style={styles.value}>{profile.age}</Text></View>
						<View style={styles.field}><Text style={styles.label}>{labels.gender}</Text><Text style={styles.value}>{labels.genders[profile.gender] || "—"}</Text></View>
						<View style={[styles.field, styles.purpose]}><Text style={styles.label}>{labels.purpose}</Text><Text style={styles.value}>{labels.purposes[profile.purpose] || "—"}</Text></View>
						<View style={styles.date}><Text style={styles.label}>{labels.time}</Text><Text style={styles.value}>{submittedTime(profile.createdAt, locale)}</Text></View>
					</View>
					<Text selectable style={styles.recordId}>{labels.id}：{profile.id}</Text>
				</View>)}
				<View style={styles.pagination}>
					<TouchableOpacity testID="guest-previous" accessibilityRole="button" style={[styles.option, query.page <= 1 && styles.disabled]} disabled={query.page <= 1} onPress={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}><Text style={styles.optionText}>{labels.previous}</Text></TouchableOpacity>
					<Text style={styles.note}>{labels.page} {query.page} / {Math.max(query.page, totalPages)}</Text>
					<TouchableOpacity testID="guest-next" accessibilityRole="button" style={[styles.option, query.page >= totalPages && styles.disabled]} disabled={query.page >= totalPages} onPress={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}><Text style={styles.optionText}>{labels.next}</Text></TouchableOpacity>
				</View>
			</>}
		</View>
	);
}

const styles = StyleSheet.create({
	header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 },
	title: { fontSize: 20, fontWeight: "800", color: "#222" },
	note: { fontSize: 14, lineHeight: 21, color: "#616772", flexShrink: 1, marginBottom: 5 },
	filterGroup: { marginTop: 14 }, label: { fontSize: 13, color: "#666", marginBottom: 6 },
	row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	option: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 15, borderRadius: 8, borderWidth: 1, borderColor: "#D9DDE3", backgroundColor: "#fff", justifyContent: "center", flexShrink: 1 },
	optionText: { fontSize: 14, color: "#840B1C", fontWeight: "700", flexShrink: 1 }, selected: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, selectedText: { color: "#fff" },
	reset: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4, marginTop: 6 },
	status: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20 },
	error: { color: "#B42318", backgroundColor: "#FDECEC", borderRadius: 8, padding: 14, marginTop: 16, lineHeight: 22 },
	count: { fontSize: 15, fontWeight: "700", color: "#333", marginVertical: 18 },
	empty: { paddingVertical: 25, color: "#777", fontSize: 15 },
	card: { backgroundColor: "#fff", borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
	fields: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
	field: { flexGrow: 1, flexBasis: 90 }, purpose: { flexBasis: 170 }, date: { flexGrow: 1, flexBasis: 200 },
	value: { fontSize: 16, lineHeight: 24, color: "#222", flexShrink: 1 },
	recordId: { fontSize: 12, lineHeight: 19, color: "#737985", marginTop: 12 },
	pagination: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "center", marginTop: 8 }, disabled: { opacity: 0.4 },
});
