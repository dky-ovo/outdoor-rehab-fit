import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { getAdminFeedback, getAdminFeedbackDetail, updateAdminFeedback } from "../utils/feedbackApi";
import AdminPagination from "./AdminPagination";

const COPY = {
	"zh-CN": {
		title: "用户反馈", intro: "查看 APP「联络我们」提交的反馈，记录处理状态及内部备注。",
		search: "搜索姓名、电邮、标题或内容", searchButton: "搜索", all: "全部", status: "处理状态", statuses: { new: "待处理", in_progress: "处理中", resolved: "已处理" },
		empty: "暂无符合条件的反馈", loading: "正在加载反馈…", retry: "重试", refresh: "刷新反馈", open: "查看详情", detail: "反馈详情", close: "关闭",
		name: "姓名", email: "电邮", subject: "标题", message: "反馈内容", identity: "提交身份", guest: "访客", registered: "注册用户", deleted: "账号已删除", unknown: "未提供", id: "反馈编号", created: "提交时间（香港）", updated: "更新时间（香港）",
		notes: "内部处理备注", noteHint: "仅供后台人员查看，保存不会发送电邮。最多 2000 字。", save: "保存处理记录", saved: "处理记录已保存", readOnly: "您拥有查看权限，处理反馈需要管理员授予处理权限。",
		error: "反馈加载失败，请重试。", denied: "当前账号无权查看反馈，请重新登录或联系管理员。", unavailable: "服务器暂不支持用户反馈，请先更新后台服务。", saveError: "保存失败，您的修改仍保留，请重试。", manageDenied: "当前账号无权处理反馈，您的修改仍保留。",
		conflict: "其他人员已更新此反馈。请刷新当前反馈并核对最新记录，您的未保存备注会保留。", reload: "刷新当前反馈（保留修改）", reviewed: "最新记录已加载，您的修改仍保留。请核对后再保存。", latest: "服务器最新处理记录", notesTooLong: "内部备注不能超过 2000 字。",
	},
	"zh-HK": {
		title: "用戶回饋", intro: "查看 APP「聯絡我們」提交的回饋，記錄處理狀態及內部備註。",
		search: "搜尋姓名、電郵、標題或內容", searchButton: "搜尋", all: "全部", status: "處理狀態", statuses: { new: "待處理", in_progress: "處理中", resolved: "已處理" },
		empty: "暫無符合條件的回饋", loading: "正在載入回饋…", retry: "重試", refresh: "重新整理回饋", open: "查看詳情", detail: "回饋詳情", close: "關閉",
		name: "姓名", email: "電郵", subject: "標題", message: "回饋內容", identity: "提交身分", guest: "訪客", registered: "註冊用戶", deleted: "帳號已刪除", unknown: "未提供", id: "回饋編號", created: "提交時間（香港）", updated: "更新時間（香港）",
		notes: "內部處理備註", noteHint: "僅供後台人員查看，儲存不會發送電郵。最多 2000 字。", save: "儲存處理記錄", saved: "處理記錄已儲存", readOnly: "您擁有查看權限，處理回饋需要管理員授予處理權限。",
		error: "回饋載入失敗，請重試。", denied: "目前帳號無權查看回饋，請重新登入或聯絡管理員。", unavailable: "伺服器暫不支援用戶回饋，請先更新後台服務。", saveError: "儲存失敗，您的修改仍保留，請重試。", manageDenied: "目前帳號無權處理回饋，您的修改仍保留。",
		conflict: "其他人員已更新此回饋。請重新整理目前回饋並核對最新記錄，您的未儲存備註會保留。", reload: "重新整理目前回饋（保留修改）", reviewed: "最新記錄已載入，您的修改仍保留。請核對後再儲存。", latest: "伺服器最新處理記錄", notesTooLong: "內部備註不能超過 2000 字。",
	},
	en: {
		title: "User Feedback", intro: "Review feedback submitted through Contact Us in the app and record its status and internal notes.",
		search: "Search name, email, subject or message", searchButton: "Search", all: "All", status: "Status", statuses: { new: "New", in_progress: "In progress", resolved: "Resolved" },
		empty: "No feedback matches these filters", loading: "Loading feedback…", retry: "Retry", refresh: "Refresh feedback", open: "View details", detail: "Feedback details", close: "Close",
		name: "Name", email: "Email", subject: "Subject", message: "Message", identity: "Submitted by", guest: "Guest", registered: "Registered user", deleted: "Account deleted", unknown: "Not provided", id: "Feedback ID", created: "Submitted (Hong Kong)", updated: "Updated (Hong Kong)",
		notes: "Internal notes", noteHint: "For admin staff only. Saving does not send an email. Maximum 2,000 characters.", save: "Save changes", saved: "Changes saved", readOnly: "You have viewing access. Ask an administrator for permission to manage feedback.",
		error: "Could not load feedback. Please retry.", denied: "This account cannot view feedback. Sign in again or contact an administrator.", unavailable: "The server does not support feedback yet. Update the backend first.", saveError: "Could not save. Your changes are preserved; please retry.", manageDenied: "This account cannot manage feedback. Your changes are preserved.",
		conflict: "Someone else updated this feedback. Reload this record and review their changes. Your unsaved notes will be preserved.", reload: "Reload this record (keep changes)", reviewed: "The latest record is loaded and your changes are preserved. Review before saving.", latest: "Latest record on server", notesTooLong: "Internal notes must not exceed 2,000 characters.",
	},
};

function timestamp(value, locale) {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(locale === "en" ? "en-GB" : locale, { timeZone: "Asia/Hong_Kong", hour12: false });
}

function loadError(error) {
	return error?.status === 401 || error?.status === 403 ? "denied" : error?.status === 404 ? "unavailable" : "error";
}

// The dashboard mounts this component only with feedback.read. Reset the entire
// workspace on account changes so a previous account's details/drafts never show.
export default function AdminFeedback(props) {
	return <FeedbackWorkspace key={props.token || "signed-out"} {...props} />;
}

function FeedbackWorkspace({ token, locale = "zh-CN", canManage = false, refreshKey = 0 }) {
	const labels = COPY[locale] || COPY["zh-CN"];
	const [query, setQuery] = useState({ page: 1, search: "", status: "" });
	const [search, setSearch] = useState("");
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState(null);
	const [detail, setDetail] = useState(null);
	const [saving, setSaving] = useState(false);
	const [compact, setCompact] = useState(false);
	const mounted = useRef(true);
	const detailRequest = useRef(0);
	const saveBusy = useRef(false);
	const permission = useRef(canManage);
	permission.current = canManage;
	const requestKey = JSON.stringify([token, query, refreshKey, revision]);
	const currentKey = useRef(requestKey);
	currentKey.current = requestKey;

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; detailRequest.current++; };
	}, []);
	useEffect(() => {
		let active = true;
		if (!token) return () => { active = false; };
		getAdminFeedback(token, { ...query, pageSize: 20 }).then(data => {
			if (active && currentKey.current === requestKey) setResult({ key: requestKey, data });
		}).catch(error => {
			if (active && currentKey.current === requestKey) setResult({ key: requestKey, error: loadError(error) });
		});
		return () => { active = false; };
	}, [token, requestKey]);

	const activeResult = result?.key === requestKey ? result : null;
	const data = activeResult?.data;
	const loading = Boolean(token) && !activeResult;
	const refresh = () => setRevision(value => value + 1);
	const submitSearch = () => setQuery(value => ({ ...value, page: 1, search: search.trim() }));
	const identity = item => item.isGuest ? labels.guest : item.userDeletedAt ? labels.deleted : item.userName || (item.userId ? labels.registered : labels.unknown);
	const loadDetail = async (item, preserve = false) => {
		if (!token || saveBusy.current) return;
		const request = ++detailRequest.current;
		setDetail(previous => ({
			item, status: item.status || "new", notes: item.notes || "", expectedUpdatedAt: item.updatedAt,
			...(preserve ? previous : {}), loading: true, ready: false, error: "", notice: "",
		}));
		try {
			const response = await getAdminFeedbackDetail(token, item.id);
			if (!mounted.current || request !== detailRequest.current) return;
			setDetail(previous => ({
				...previous, item: response.feedback, expectedUpdatedAt: response.feedback.updatedAt,
				status: preserve ? previous.status : response.feedback.status,
				notes: preserve ? previous.notes : response.feedback.notes || "",
				loading: false, ready: true, conflict: false, error: "", notice: preserve ? "reviewed" : "", latest: preserve,
			}));
		} catch (error) {
			if (mounted.current && request === detailRequest.current) setDetail(previous => ({ ...previous, loading: false, error: loadError(error) }));
		}
	};
	const closeDetail = () => { if (saveBusy.current) return; detailRequest.current++; setDetail(null); };
	const save = async () => {
		if (!token || !permission.current || !detail?.ready || detail.loading || detail.conflict || saveBusy.current || detail.error === "denied") return;
		if (detail.notes.length > 2000) { setDetail(value => ({ ...value, error: "notesTooLong" })); return; }
		const request = detailRequest.current;
		saveBusy.current = true;
		setSaving(true);
		setDetail(value => ({ ...value, error: "", notice: "" }));
		try {
			const response = await updateAdminFeedback(token, detail.item.id, { status: detail.status, notes: detail.notes, expectedUpdatedAt: detail.expectedUpdatedAt });
			if (!mounted.current || request !== detailRequest.current || !permission.current) return;
			setDetail({ item: response.feedback, status: response.feedback.status, notes: response.feedback.notes || "", expectedUpdatedAt: response.feedback.updatedAt, ready: true, notice: "saved" });
			refresh();
		} catch (error) {
			if (!mounted.current || request !== detailRequest.current) return;
			const conflict = error?.status === 409 || error?.code === "feedbackConflict";
			setDetail(value => ({ ...value, conflict, error: conflict ? "conflict" : error?.status === 401 || error?.status === 403 ? "manageDenied" : "saveError" }));
		} finally {
			saveBusy.current = false;
			if (mounted.current && request === detailRequest.current) setSaving(false);
		}
	};
	const option = (value, title, selected, onPress, id, disabled = false) => <TouchableOpacity key={value} testID={id} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, selected && styles.selectedText]}>{title}</Text></TouchableOpacity>;
	const field = (title, value, id) => <View style={styles.field} key={title}><Text style={styles.label}>{title}</Text><Text testID={id} selectable style={styles.value}>{value || labels.unknown}</Text></View>;

	return <View testID="admin-feedback" style={styles.workspace} onLayout={event => {
		const width = event.nativeEvent?.layout?.width;
		if (Number.isFinite(width) && width > 0) setCompact(width < 520);
	}}>
		<View style={styles.header}><Text style={styles.title}>{labels.title}</Text>{option("refresh", labels.refresh, false, refresh, "feedback-refresh", loading || !token)}</View>
		<Text style={styles.hint}>{labels.intro}</Text>
		<View testID="feedback-search-row" style={[styles.searchRow, compact && styles.stack]}><TextInput testID="feedback-search" accessibilityLabel={labels.search} style={[styles.input, styles.searchInput, compact && styles.fullWidth]} value={search} onChangeText={setSearch} placeholder={labels.search} onSubmitEditing={submitSearch} maxLength={200} />{option("search", labels.searchButton, false, submitSearch, "feedback-search-submit", !token)}</View>
		<Text style={styles.label}>{labels.status}</Text>
		<View style={styles.options}>{[["", labels.all], ...Object.entries(labels.statuses)].map(([value, label]) => option(value, label, query.status === value, () => setQuery(current => ({ ...current, page: 1, status: value })), `feedback-filter-${value || "all"}`, !token))}</View>
		{loading && <View testID="feedback-loading" style={styles.loading}><ActivityIndicator color="#840B1C" /><Text style={styles.hint}>{labels.loading}</Text></View>}
		{(!token || activeResult?.error) && <View><Text accessibilityRole="alert" style={styles.error}>{labels[!token ? "denied" : activeResult.error]}</Text>{token && option("retry", labels.retry, false, refresh, "feedback-retry")}</View>}
		{data && <>
			{!data.items.length && <Text style={styles.empty}>{labels.empty}</Text>}
			{data.items.map(item => <View key={item.id} style={[styles.card, compact && styles.stack]} testID="feedback-record">
				<View style={[styles.rowMain, compact && styles.fullWidth]}><Text style={styles.subject} numberOfLines={2}>{item.subject || labels.unknown}</Text><Text style={styles.value}>{item.name || labels.unknown}</Text><Text style={styles.contact}>{item.email || labels.unknown}</Text><Text style={styles.preview} numberOfLines={2}>{item.message || "—"}</Text><Text style={styles.hint}>{timestamp(item.createdAt, locale)} · {labels.statuses[item.status] || "—"}</Text></View>
				{option(item.id, labels.open, false, () => loadDetail(item), `feedback-open-${item.id}`)}
			</View>)}
			<AdminPagination page={data.pagination.page} pageSize={20} total={data.pagination.total} locale={locale} onPageChange={page => setQuery(value => ({ ...value, page }))} testID="feedback-pagination" />
		</>}
		{detail && <Modal transparent animationType="fade" visible onRequestClose={closeDetail}>
			<View style={styles.overlay}><View style={styles.modal} testID="feedback-detail">
				<View style={styles.header}><Text style={styles.title}>{labels.detail}</Text>{option("close", labels.close, false, closeDetail, "feedback-close", saving)}</View>
				<ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
					{field(labels.subject, detail.item.subject)}
					<View style={styles.options}>{field(labels.name, detail.item.name)}{field(labels.email, detail.item.email)}{field(labels.identity, identity(detail.item))}</View>
					{field(labels.message, detail.item.message, "feedback-full-message")}
					{field(labels.id, detail.item.id)}
					<View style={styles.options}>{field(labels.created, timestamp(detail.item.createdAt, locale))}{field(labels.updated, timestamp(detail.item.updatedAt, locale))}</View>
					{detail.loading && <View style={styles.loading}><ActivityIndicator color="#840B1C" /><Text style={styles.hint}>{labels.loading}</Text></View>}
					{!!detail.error && <Text accessibilityRole="alert" style={styles.error}>{labels[detail.error]}</Text>}
					{!!detail.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{labels[detail.notice]}</Text>}
					{detail.latest && <View style={styles.latest}><Text style={styles.label}>{labels.latest}</Text><Text style={styles.value}>{labels.statuses[detail.item.status]}</Text><Text selectable style={styles.value}>{detail.item.notes || "—"}</Text></View>}
					{(detail.conflict || detail.error) && option("reload", labels.reload, false, () => loadDetail(detail.item, true), "feedback-reload-detail", saving || detail.loading)}
					<Text style={styles.label}>{labels.status}</Text>
					{canManage ? <View style={styles.options}>{Object.entries(labels.statuses).map(([value, label]) => option(value, label, detail.status === value, () => setDetail(current => ({ ...current, status: value, notice: "" })), `feedback-status-${value}`, saving || detail.loading))}</View> : <Text style={styles.value}>{labels.statuses[detail.item.status] || "—"}</Text>}
					<Text style={[styles.label, styles.notesLabel]}>{labels.notes}</Text>
					{canManage ? <TextInput testID="feedback-notes" accessibilityLabel={labels.notes} value={detail.notes} onChangeText={notes => setDetail(value => ({ ...value, notes, notice: "" }))} editable={!saving && !detail.loading} multiline maxLength={2000} style={[styles.input, styles.notes]} /> : <Text selectable style={styles.value}>{detail.item.notes || "—"}</Text>}
					<Text style={styles.hint}>{canManage ? labels.noteHint : labels.readOnly}</Text>
				</ScrollView>
				{canManage && <View style={styles.actions}>{saving && <ActivityIndicator color="#840B1C" />}{option("save", labels.save, true, save, "feedback-save", saving || !detail.ready || detail.loading || detail.conflict || detail.error === "denied")}</View>}
			</View></View>
		</Modal>}
	</View>;
}

const styles = StyleSheet.create({
	workspace: { width: "100%", minWidth: 0, flexGrow: 0, flexShrink: 0, flexBasis: "auto", backgroundColor: "#FFF" },
	header: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
	title: { fontSize: 20, fontWeight: "800", color: "#222", flexShrink: 1, minWidth: 0 }, hint: { color: "#616772", fontSize: 13, lineHeight: 21, marginBottom: 6, flexShrink: 1 },
	searchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 18, minWidth: 0 }, searchInput: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, maxWidth: "100%" },
	stack: { flexDirection: "column", alignItems: "stretch" }, fullWidth: { width: "100%", flexBasis: "auto", flexGrow: 0, minWidth: 0 },
	input: { borderWidth: 1, borderColor: "#D9DDE3", borderRadius: 8, backgroundColor: "#FFF", minHeight: 44, padding: 12, color: "#222", fontSize: 14 },
	options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
	button: { minHeight: 44, minWidth: 0, maxWidth: "100%", borderWidth: 1, borderColor: "#D9DDE3", borderRadius: 8, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: "#FFF", justifyContent: "center", flexShrink: 1 },
	buttonText: { color: "#840B1C", fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center", flexShrink: 1 }, selected: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, selectedText: { color: "#FFF" }, disabled: { opacity: 0.45 },
	loading: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 20 }, empty: { color: "#777", fontSize: 15, paddingVertical: 30 },
	error: { color: "#B42318", backgroundColor: "#FDECEC", borderRadius: 8, padding: 12, lineHeight: 22, marginVertical: 12 }, notice: { color: "#146C43", backgroundColor: "#EAF5EF", padding: 12, borderRadius: 8, lineHeight: 22, marginVertical: 12 },
	card: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, width: "100%", minWidth: 0, flexShrink: 0, backgroundColor: "#FFF", padding: 16, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, marginTop: 12 },
	rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, maxWidth: "100%" }, subject: { color: "#222", fontSize: 16, lineHeight: 24, fontWeight: "700", marginBottom: 6 }, preview: { color: "#616772", fontSize: 14, lineHeight: 22, marginVertical: 8 },
	contact: { color: "#616772", fontSize: 14, lineHeight: 22, minWidth: 0, maxWidth: "100%", ...Platform.select({ web: { overflowWrap: "anywhere" } }) },
	overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 16 }, modal: { width: "100%", maxWidth: 780, maxHeight: "92%", backgroundColor: "#FFF", padding: 20, borderRadius: 14 }, detailScroll: { flexShrink: 1 }, detailContent: { paddingBottom: 12 },
	field: { marginBottom: 15, marginRight: 14, flexShrink: 1, minWidth: 0, maxWidth: "100%" }, label: { color: "#616772", fontSize: 13, marginBottom: 6 }, value: { color: "#222", fontSize: 15, lineHeight: 23, flexShrink: 1, minWidth: 0, maxWidth: "100%", ...Platform.select({ web: { overflowWrap: "anywhere" } }) }, notesLabel: { marginTop: 10 }, notes: { minHeight: 120, textAlignVertical: "top", marginBottom: 8 }, latest: { backgroundColor: "#F3F4F6", padding: 12, borderRadius: 8, marginBottom: 12 }, actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 12, minWidth: 0, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
});
