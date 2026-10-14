import AdminAiConfiguration from "../components/AdminAiConfiguration";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Image,
	Modal,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	useWindowDimensions,
	View,
} from "react-native";
import {
	createAdminEquipment,
	createAdminEquipmentLocation,
	createAdminPersonnel,
	createAdminUser,
	deleteAdminEquipment,
	deleteAdminEquipmentLocation,
	deleteAdminUser,
	getAdminMe,
	getAdminUsageUsers,
	getAdminUserUsage,
	getAdminAiConfiguration,
	getAdminOverview,
	getAdminPersonnel,
	getAdminResearchAnalytics,
	getAdminResearchEvents,
	exportAdminResearchData,
	exportAdminUsers,
	getAdminContent,
	createAdminContent,
	updateAdminContent,
	deleteAdminContent,
	getAdminSystemLogs,
	getAdminFacilitySource,
	getAdminEquipment,
	getEquipmentCategories,
	getAdminEquipmentLocations,
	getAdminUsers,
	loginAccount,
	syncAdminFacilities,
	updateAdminFacilitySource,
	updateAdminEquipment,
	updateAdminEquipmentLocation,
	updateAdminPersonnel,
	updateAdminUser,
	updateAdminAiConfiguration,
	testAdminAiConfiguration,
} from "../utils/api";
import { equipmentTranslations } from "../constants/Equipments";
import { equipmentImageSource, equipmentCategoryLabel, mergeEquipmentCategories } from "../utils/equipmentCatalog";
import AdminEquipmentCategories from "../components/AdminEquipmentCategories";
import { showAlert } from "../utils/alert";
import AdminTestUsers from "../components/AdminTestUsers";
import AdminGuestProfiles from "../components/AdminGuestProfiles";
import AdminMediaLibrary from "../components/AdminMediaLibrary";
import AdminMediaField from "../components/AdminMediaField";
import AdminExerciseVideoImport from "../components/AdminExerciseVideoImport";
import AdminExerciseVideoMetadata, { ExerciseVideoCategoryChoices, exerciseVideoEquipmentLabel, useExerciseVideoCatalog } from "../components/AdminExerciseVideoMetadata";
import { exerciseVideoCategoryLabel, normalizeExerciseVideoMetadata } from "../utils/exerciseVideoCategories";
import AdminRegistrationCodes from "../components/AdminRegistrationCodes";
import AdminPaginatedList from "../components/AdminPaginatedList";
import AdminRemotePaginatedList from "../components/AdminRemotePaginatedList";
import AdminFeedback from "../components/AdminFeedback";
import AdminAssistant from "../components/AdminAssistant";
import AdminEquipmentImport from "../components/AdminEquipmentImport";
import AdminContentToolbar from "../components/AdminContentToolbar";
import AdminEquipmentEditor from "../components/AdminEquipmentEditor";
import AdminAppTexts from "../components/AdminAppTexts";
import { researchVideoLabel, researchEventObjectLabel } from "../utils/researchContentLabels";
import { filterAdminContent } from "../utils/adminContentBrowse";
import { getAdminWorkbenchCopy } from "../constants/AdminWorkbench";
import { Ionicons } from "@expo/vector-icons";
import { directVideoUri, youtubeVideoId } from "../utils/contentVideo";

const ROLE_LABELS = { participant: "参与者", staff: "项目人员", volunteer: "志愿者", caregiver: "志愿者" };
const CONTENT_TYPE_LABELS = { video: "视频", text: "文字内容", feature: "功能入口" };
const PAGE_OPTIONS = [
	{ key: "home", label: "APP 首页" },
	{ key: "exercise_videos", label: "运动影片" },
];
const MAINTENANCE_SECTIONS = [
	{ key: "texts", label: "APP文字与说明", permission: "app_maintenance.text.manage" },
	{ key: "home", label: "APP首页内容", pageKey: "home", permission: "app_maintenance.home.manage" },
	{ key: "exercise_videos", label: "运动影片", pageKey: "exercise_videos", permission: "app_maintenance.home.manage" },
	{ key: "equipment", label: "设施教学", permission: "app_maintenance.equipment.manage" },
	{ key: "locations", label: "设施位置", permission: "app_maintenance.locations.manage" },
	{ key: "ai", label: "AI助手配置", permission: "app_maintenance.ai.manage" },
	{ key: "facilities", label: "设施数据", permission: "facilities.manage" },
];

const ADMIN_LANGUAGE_TEXT = {
	"zh-CN": { subtitle: "科研管理后台", menu: "功能菜单", backend: "管理后台", refresh: "刷新", logout: "退出", tabs: { overview: "数据概览", users: "用户管理", events: "科研数据", maintenance: "APP维护", messages: "查看使用者数据", personnel: "后台人员", logs: "系统日志" }, maintenance: { home: "APP首页内容", equipment: "设施教学", locations: "设施位置", ai: "AI助手配置", facilities: "设施数据" }, roles: { super_admin: "最高管理员", admin: "管理员", operator: "操作员" } },
	"zh-HK": { subtitle: "科研管理後台", menu: "功能選單", backend: "管理後台", refresh: "重新整理", logout: "登出", tabs: { overview: "數據概覽", users: "用戶管理", events: "科研數據", maintenance: "APP維護", messages: "查看使用者數據", personnel: "後台人員", logs: "系統日誌" }, maintenance: { home: "APP首頁內容", equipment: "設施教學", locations: "設施位置", ai: "AI助手配置", facilities: "設施數據" }, roles: { super_admin: "最高管理員", admin: "管理員", operator: "操作員" } },
	en: { subtitle: "Research Admin Portal", menu: "Menu", backend: "Admin Portal", refresh: "Refresh", logout: "Sign out", tabs: { overview: "Overview", users: "Users", events: "Research Data", maintenance: "APP Maintenance", messages: "User Usage Data", personnel: "Personnel", logs: "System Logs" }, maintenance: { home: "Home Content", equipment: "Facility Teaching", locations: "Facility Locations", ai: "AI Assistant", facilities: "Facility Data" }, roles: { super_admin: "Super Admin", admin: "Administrator", operator: "Operator" } },
};
const SYSTEM_ROLE_LABELS = { super_admin: "最高管理员", admin: "管理员", operator: "操作员" };
const PERMISSION_LABELS = {
	"dashboard.read": "查看数据概览",
	"users.read": "查看用户资料",
	"users.edit": "编辑用户资料",
	"app_maintenance.home.manage": "维护 APP 首页内容",
	"app_maintenance.text.manage": "维护 APP 文字、双语说明与文献",
	"app_maintenance.equipment.manage": "维护设施教学及 GIF",
	"app_maintenance.files.manage": "管理文件存储空间及分类",
	"app_maintenance.locations.manage": "维护设施教学位置",
	"app_maintenance.ai.manage": "维护 AI 助手",
	"admin_assistant.use": "使用后台 AI 助手（不含用户资料）",
	"research.read": "查看科研数据",
	"messages.read": "查看使用者数据",
	"feedback.read": "查看用户反馈",
	"feedback.manage": "处理用户反馈",
	"messages.delete": "管理历史聊天数据（兼容）",
	"data.export": "导出数据",
	"facilities.manage": "管理政府设施数据",
};
const SYSTEM_ACTION_LABELS = {
	"user.create": "新增用户",
	"user.update": "修改用户资料",
	"user.delete": "删除并匿名化用户",
	"content.create": "新增 APP 维护内容",
	"content.update": "修改 APP 维护内容",
	"content.delete": "删除 APP 维护内容",
	"app_text.update": "修改 APP 文字与说明",
	"media.upload": "上传公开教学文件",
	"media.update": "整理公开教学文件",
	"media_category.create": "新增文件分类",
	"media_category.update": "修改文件分类",
	"admin_account.create": "新增后台人员及权限",
	"admin_account.update": "修改后台人员及权限",
	"facility_source.update": "修改设施数据接口",
	"facilities.sync": "同步政府设施数据",
	"facilities.sync_failed": "政府设施数据同步失败",
	"facility.update": "修改设施资料",
	"group.rename": "项目人员修改群组名称",
	"group.dissolve": "项目人员解散群组",
	"chat_contact.delete": "项目人员删除联系人",
	"message.delete": "后台删除聊天消息",
	"message.bulk_delete": "后台批量删除聊天消息",
	"equipment.create": "新增 APP 户外器材",
	"equipment.update": "编辑 APP 户外器材",
	"equipment.override": "设置现有户外器材",
	"equipment.delete": "删除 APP 户外器材",
	"equipment_category.create": "新增设施教学分类",
	"equipment_category.update": "修改设施教学分类",
	"equipment_location.create": "新增设施位置",
	"equipment_location.update": "编辑设施位置",
	"equipment_location.delete": "删除设施位置",
	"research.export": "导出科研数据",
	"ai_configuration.update": "修改 AI 助手配置",
	"feedback.submitted": "提交用户反馈",
	"feedback.updated": "处理用户反馈",
};
const TARGET_TYPE_LABELS = {
	user: "用户",
	content: "APP 内容",
	media: "公开教学文件",
	media_category: "文件分类",
	admin_account: "后台账号",
	facility_source: "设施数据源",
	facility: "设施",
	conversation: "聊天会话",
	message: "聊天消息",
	message_batch: "一批聊天消息",
	app_equipment: "APP 户外器材",
	equipment_category: "设施教学分类",
	equipment_location: "设施位置",
	research_event_batch: "科研事件数据",
	ai_configuration: "AI 助手配置",
	feedback: "用户反馈",
};

const RESEARCH_EVENT_LABELS = {
	"screen.view": "查看页面", "screen.leave": "离开页面", "screen.tap_batch": "点击页面内容",
	"video.play": "开始播放视频", "video.paused": "暂停视频", "video.completed": "完整观看视频",
	"audio.play": "播放语音指导", "content.open": "打开维护内容",
};

function defaultResearchFilters() {
	const end = new Date(); const start = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
	return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10), profileRole: "", eventName: "", screen: "", userSearch: "" };
}

function researchObjectLabel(event, locale) {
	return researchEventObjectLabel(event, locale);
}

function exportResearchCsv(events, locale) {
	if (Platform.OS !== "web") return;
	const rows = [
		["事件编号", "用户", "手机号", "用户类型", "事件", "事件代码", "页面", "对象/内容", "点击次数", "观看毫秒", "是否完整观看", "发生时间", "APP版本", "原始参数"],
		...events.map((event) => [event.id, event.participantName, event.participantPhone, ROLE_LABELS[event.profileRole] || event.profileRole, RESEARCH_EVENT_LABELS[event.eventName] || event.eventName, event.eventName, event.metadata?.screen || "", researchObjectLabel(event, locale), event.metadata?.count || "", event.metadata?.watchedMs || "", event.eventName === "video.completed" ? "是" : "", event.eventTime, event.appVersion, event.metadataJson]),
	];
	const blob = new Blob(["\ufeff", rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
	anchor.href = url; anchor.download = `outdoor-fit-research-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
}
const TABS = [
	{ key: "overview", label: "数据概览", permission: "dashboard.read" },
	{ key: "users", label: "用户管理", permission: "users.read" },
	{ key: "events", label: "科研数据", permission: "research.read" },
	{ key: "maintenance", label: "APP维护", permission: "app_maintenance.manage" },
	{ key: "files", label: "文件存储", permission: "app_maintenance.files.manage" },
	{ key: "assistant", label: "AI 助手", permission: "admin_assistant.use" },
	{ key: "messages", label: "查看使用者数据", permission: "messages.read" },
	{ key: "feedback", label: "用户反馈", permission: "feedback.read" },
	{ key: "personnel", label: "后台人员", permission: "operators.manage" },
	{ key: "logs", label: "系统日志", permission: "system_logs.read" },
];
const TAB_ICONS = { overview: "grid-outline", users: "people-outline", events: "bar-chart-outline", maintenance: "create-outline", files: "folder-open-outline", assistant: "chatbubbles-outline", messages: "analytics-outline", feedback: "mail-outline", personnel: "shield-checkmark-outline", logs: "list-outline" };
const EMPTY_FILTER = { search: "", status: "all", sort: "order" };
const DASHBOARD_MODULES = ["overview", "users", "events", "messages", "personnel", "logs", "home", "facilities", "equipment", "locations", "ai"];

const APP_MAINTENANCE_PERMISSION_KEYS = MAINTENANCE_SECTIONS.map((item) => item.permission).filter(Boolean);

function canSeeAdminTab(tab, permissions = []) {
	if (tab.key === "maintenance") return APP_MAINTENANCE_PERMISSION_KEYS.some((permission) => permissions.includes(permission));
	return permissions.includes(tab.permission);
}

function csvCell(value) {
	return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportUsersCsv(users) {
	if (Platform.OS !== "web") return;
	const rows = [
		["姓名", "手机号", "电邮", "角色", "注册时间"],
		...users.map((user) => [user.name, user.phone, user.email, ROLE_LABELS[user.profileRole], user.createdAt]),
	];
	const blob = new Blob(["\ufeff", rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `outdoor-fit-users-${new Date().toISOString().slice(0, 10)}.csv`;
	anchor.click();
	URL.revokeObjectURL(url);
}

function adminEquipmentItems(overrides) {
	const overrideMap = new Map((overrides || []).map((item) => [String(item.id), item]));
	const english = new Map(equipmentTranslations.en.equipmentList.map((item) => [String(item.id), item]));
	const items = equipmentTranslations.zh.equipmentList.map((zhItem, index) => {
		const id = String(zhItem.id); const enItem = english.get(id) || {}; const override = overrideMap.get(id); overrideMap.delete(id);
		if (override?.deletedAt) return null;
		return {
			id, code: zhItem.code || enItem.code || "", isCustom: false, nameZh: override?.nameZh || zhItem.name, nameEn: override?.nameEn || enItem.name || "",
			categories: override?.categories?.length ? override.categories : zhItem.categories,
			imageUrl: override?.imageUrl || "", previewSource: override?.imageUrl ? equipmentImageSource(override.imageUrl) : zhItem.icon,
			gifLeftUrl: override?.gifLeftUrl || "", gifRightUrl: override?.gifRightUrl || "", youtubeKey: override?.youtubeKey || zhItem.youtubeKey || "", videoUrl: override?.videoUrl || "",
			videoUrlZh: override?.videoUrlZh || "", videoUrlEn: override?.videoUrlEn || "", videoLocalesEnabled: Boolean(override?.videoLocalesEnabled || override?.videoUrlZh || override?.videoUrlEn),
			additionalVideos: override?.additionalVideos || [], teachingSections: override?.teachingSections || [],
			detailsZh: override?.detailsZh || zhItem.details || "", detailsEn: override?.detailsEn || enItem.details || "",
			kinesiologyZh: override?.kinesiologyZh || zhItem.kinesiologyTip || "", kinesiologyEn: override?.kinesiologyEn || enItem.kinesiologyTip || "",
			ptTipZh: override?.ptTipZh || zhItem.ptTip || "", ptTipEn: override?.ptTipEn || enItem.ptTip || "", otTipZh: override?.otTipZh || zhItem.otTip || "", otTipEn: override?.otTipEn || enItem.otTip || "",
			tcmZh: override?.tcmZh || zhItem.tcmTip || "", tcmEn: override?.tcmEn || enItem.tcmTip || "", tcmEnabled: override?.tcmEnabled ?? Boolean(zhItem.tcmEnabled),
			careTipZh: override?.careTipZh || zhItem.careTip || "", careTipEn: override?.careTipEn || enItem.careTip || "",
			sortOrder: override?.sortOrder ?? index, isActive: override?.isActive ?? true,
		};
	}).filter(Boolean);
	for (const item of overrideMap.values()) if (item.isCustom && !item.deletedAt) items.push({ ...item, previewSource: item.imageUrl ? equipmentImageSource(item.imageUrl) : null });
	return items.sort((a, b) => a.sortOrder - b.sortOrder);
}

function StatCard({ label, value, color = "#840B1C" }) {
	return (
		<View style={styles.statCard}>
			<View style={[styles.statAccent, { backgroundColor: color }]} />
			<Text style={styles.statValue}>{value ?? 0}</Text>
			<Text style={styles.statLabel}>{label}</Text>
		</View>
	);
}

export default function AdminDashboard() {
	const { width: viewportWidth } = useWindowDimensions();
	const compactLayout = viewportWidth < 1100;
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [token, setToken] = useState("");
	const [adminName, setAdminName] = useState("");
	const [adminLocale, setAdminLocale] = useState("zh-CN");
	const [adminAccess, setAdminAccess] = useState(null);
	const [assistantDocument, setAssistantDocument] = useState(null);
	useEffect(() => { setAssistantDocument(null); }, [token]);
	const currentAdminToken = useRef(token);
	currentAdminToken.current = token;
	const [activeTab, setActiveTab] = useState("overview");
	const [maintenanceSection, setMaintenanceSection] = useState("home");
	const [overview, setOverview] = useState(null);
	const [usersResult, setUsersResult] = useState(null);
	const [userListMode, setUserListMode] = useState("registered");
	const [guestRefreshKey, setGuestRefreshKey] = useState(0);
	const [registrationRefreshKey, setRegistrationRefreshKey] = useState(0);
	const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
	const [feedbackRefreshKey, setFeedbackRefreshKey] = useState(0);
	const [researchAnalytics, setResearchAnalytics] = useState(null);
	const [researchFilters, setResearchFilters] = useState(defaultResearchFilters);
	const [contentItems, setContentItems] = useState([]); const [editingContent, setEditingContent] = useState(null);
	const [exerciseVideoImportOpen, setExerciseVideoImportOpen] = useState(false);
	const [exerciseVideoCategoryFilter, setExerciseVideoCategoryFilter] = useState('all');
	const exerciseVideoCatalog = useExerciseVideoCatalog(Boolean(token && ((activeTab === 'maintenance' && maintenanceSection === 'exercise_videos') || editingContent?.pageKey === 'exercise_videos')));
	useEffect(() => { setExerciseVideoCategoryFilter('all'); setEditingContent(null); setExerciseVideoImportOpen(false); }, [token]);
	const [equipmentOverrides, setEquipmentOverrides] = useState([]); const [editingEquipment, setEditingEquipment] = useState(null);
	const [equipmentCategories, setEquipmentCategories] = useState(() => mergeEquipmentCategories());
	const [equipmentLocations, setEquipmentLocations] = useState([]); const [editingEquipmentLocation, setEditingEquipmentLocation] = useState(null);
	const [locationEquipmentSearch, setLocationEquipmentSearch] = useState("");
	const [chatUsers, setChatUsers] = useState([]);
	const [selectedChatUser, setSelectedChatUser] = useState(null);
	const [messages, setMessages] = useState([]);
	const [aiConfiguration, setAiConfiguration] = useState({ provider: "deepseek", model: "deepseek-v4-flash", apiKey: "", apiKeyConfigured: false });
	const [aiTestResult, setAiTestResult] = useState("");
	const [personnel, setPersonnel] = useState([]);
	const [systemLogResult, setSystemLogResult] = useState(null);
	const [facilitySource, setFacilitySource] = useState(null);
	const [facilityRuns, setFacilityRuns] = useState([]);
	const [search, setSearch] = useState("");
	const [editingUser, setEditingUser] = useState(null);
	const [creatingUser, setCreatingUser] = useState(null);
	const [editingPersonnel, setEditingPersonnel] = useState(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [saveNotice, setSaveNotice] = useState("");
	const equipmentSaveInFlight = useRef(false);
	const [loadIssues, setLoadIssues] = useState([]);
	const [equipmentFilter, setEquipmentFilter] = useState(EMPTY_FILTER);
	const [contentFilter, setContentFilter] = useState(EMPTY_FILTER);
	const [locationFilter, setLocationFilter] = useState(EMPTY_FILTER);
	const dashboardRequestId = useRef(0);
	const contentScroll = useRef(null);
	useEffect(() => { contentScroll.current?.scrollTo({ y: 0, animated: false }); }, [activeTab, maintenanceSection, userListMode]);
	const researchRequestId = useRef(0);
	const usersRequestId = useRef(0);
	const categoryCatalogRequest = useRef(0);
	const categoryCatalogScope = useRef("");
	const categoryCatalogMounted = useRef(true);
	categoryCatalogScope.current = adminAccess?.admin.permissions.includes("app_maintenance.equipment.manage") ? token : "";
	useEffect(() => { categoryCatalogMounted.current = true; return () => { categoryCatalogMounted.current = false; categoryCatalogRequest.current++; }; },[]);
	const refreshEquipmentCategoryCatalog = useCallback(async () => {
		const scope = categoryCatalogScope.current;
		if (!scope) return;
		const requestId = ++categoryCatalogRequest.current;
		const data = await getEquipmentCategories();
		if (categoryCatalogMounted.current && scope === categoryCatalogScope.current && requestId === categoryCatalogRequest.current) setEquipmentCategories(mergeEquipmentCategories(data.categories));
	},[]);
	const acceptEquipmentCategoryChange = useCallback(category => {
		categoryCatalogRequest.current++;
		setEquipmentCategories(items => mergeEquipmentCategories([...items.filter(item => item.id !== category.id),category]));
	},[]);

	const loadDashboard = async (adminToken, access, userSearch = "", userPage = usersResult?.page || 1) => {
		const dashboardRequest = ++dashboardRequestId.current;
		const researchRequest = ++researchRequestId.current;
		const usersRequest = ++usersRequestId.current;
		const permissions = access.admin.permissions;
		const canMaintainHome = permissions.includes("app_maintenance.home.manage");
		const canMaintainEquipment = permissions.includes("app_maintenance.equipment.manage");
		const canMaintainLocations = permissions.includes("app_maintenance.locations.manage");
		const canMaintainAi = permissions.includes("app_maintenance.ai.manage");
		const results = await Promise.allSettled([
			permissions.includes("dashboard.read") ? getAdminOverview(adminToken) : Promise.resolve(null),
			permissions.includes("users.read") ? getAdminUsers(adminToken, userSearch, { page: userPage, pageSize: 20 }) : Promise.resolve({ users: [] }),
			permissions.includes("research.read") ? getAdminResearchAnalytics(adminToken, researchFilters) : Promise.resolve({ events: [], summary: {} }),
			permissions.includes("messages.read") ? getAdminUsageUsers(adminToken) : Promise.resolve({ users: [] }),
			permissions.includes("operators.manage") ? getAdminPersonnel(adminToken) : Promise.resolve({ personnel: [] }),
			permissions.includes("system_logs.read") ? getAdminSystemLogs(adminToken) : Promise.resolve({ logs: [] }),
			canMaintainHome ? getAdminContent(adminToken) : Promise.resolve({ items: [] }),
			permissions.includes("facilities.manage") ? getAdminFacilitySource(adminToken) : Promise.resolve({ source: null, runs: [] }),
			(canMaintainEquipment || canMaintainLocations) ? getAdminEquipment(adminToken) : Promise.resolve({ items: [] }),
			canMaintainLocations ? getAdminEquipmentLocations(adminToken).catch((locationError) => locationError?.status === 404 ? { locations: [] } : Promise.reject(locationError)) : Promise.resolve({ locations: [] }),
			canMaintainAi ? getAdminAiConfiguration(adminToken) : Promise.resolve({ configuration: null }),
		]);
		if (dashboardRequest !== dashboardRequestId.current) return;
		// One unavailable module must not turn a valid login into a password error.
		// Failed modules are blocked below, rather than showing editable built-in defaults.
		const authFailure = results.find(result => result.status === "rejected" && result.reason?.status === 401);
		if (authFailure) throw authFailure.reason;
		setLoadIssues(results.flatMap((result,index) => result.status === "rejected" ? [DASHBOARD_MODULES[index]] : []));
		const [overviewData, userData, eventData, messageData, personnelData, logData, contentData, facilityData, equipmentData, equipmentLocationData, aiData] = results.map(result => result.status === "fulfilled" ? result.value : undefined);
		if (overviewData !== undefined) setOverview(overviewData);
		if (userData && usersRequest === usersRequestId.current) setUsersResult(userData);
		if (eventData && researchRequest === researchRequestId.current) setResearchAnalytics(eventData);
		if (messageData) setChatUsers(messageData.users);
		setMessages([]);
		setSelectedChatUser(null);
		if (aiData?.configuration) setAiConfiguration({ ...aiData.configuration, apiKey: "" });
		if (personnelData) setPersonnel(personnelData.personnel);
		if (logData) setSystemLogResult(logData);
		if (contentData) setContentItems(contentData.items);
		if (facilityData) { setFacilitySource(facilityData.source); setFacilityRuns(facilityData.runs || []); }
		if (equipmentData) { setEquipmentOverrides(equipmentData.items || []); setEquipmentCategories(mergeEquipmentCategories(equipmentData.categories)); }
		if (equipmentLocationData) setEquipmentLocations(equipmentLocationData.locations || []);
	};

	const handleRefreshDashboard = async () => {
		if (!token || !adminAccess || loading) return;
		if (activeTab === "users" && userListMode === "guests") {
			setGuestRefreshKey((value) => value + 1);
			return;
		}
		if (activeTab === "users" && userListMode === "registration") {
			setRegistrationRefreshKey((value) => value + 1);
			return;
		}
		if (activeTab === "files") {
			setMediaRefreshKey((value) => value + 1);
			return;
		}
		if (activeTab === "feedback" && adminAccess.admin.permissions.includes("feedback.read")) {
			setFeedbackRefreshKey((value) => value + 1);
			return;
		}
		setLoading(true);
		setError("");
		try {
			await loadDashboard(token, adminAccess, search);
		} catch {
			setError("后台数据刷新失败，请稍后重试。");
		} finally {
			setLoading(false);
		}
	};

	const handleLogin = async () => {
		if (loading) return;
		setLoading(true);
		setError("");
		try {
			const result = await loginAccount(identifier, password);
			const access = await getAdminMe(result.token);
			await loadDashboard(result.token, access, "", 1);
			setToken(result.token);
			setAdminName(result.user.name);
			setAdminAccess(access);
			setUserListMode("registered");
			const firstTab = TABS.find((tab) => canSeeAdminTab(tab, access.admin.permissions));
			setActiveTab(firstTab?.key || "overview");
			if (firstTab?.key === "maintenance") setMaintenanceSection(MAINTENANCE_SECTIONS.find((item) => access.admin.permissions.includes(item.permission))?.key || "home");
			setPassword("");
		} catch (loginError) {
			setError(loginError.code === "adminRequired" ? "此账号没有项目人员管理权限。" : "登录失败，请检查账号、密码和管理权限。");
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = async () => {
		const requestId = ++usersRequestId.current;
		setLoading(true);
		try {
			const result = await getAdminUsers(token, search);
			if (requestId === usersRequestId.current) setUsersResult(result);
		} catch {
			if (requestId === usersRequestId.current) setError("用户查询失败，请稍后重试。");
		} finally {
			if (requestId === usersRequestId.current) setLoading(false);
		}
	};
	const handleExportUsers = async () => {
		if (saving) return;
		setSaving(true); setError("");
		try {
			const result = await exportAdminUsers(token, usersResult?.filters?.search || "");
			if (!result.complete || result.recordCount !== result.total || result.users?.length !== result.total) throw new Error("incompleteUserExport");
			exportUsersCsv(result.users);
		} catch (exportError) {
			setError(exportError.code === "userExportTooLarge" ? "符合条件的用户超过 50,000 条，请先缩小搜索范围再导出；没有生成不完整文件。" : "完整用户导出失败，请检查权限后重试；没有生成不完整文件。");
		} finally { setSaving(false); }
	};

	const loadResearchAnalytics = async (filters = researchFilters) => {
		const requestId = ++researchRequestId.current;
		setLoading(true); setError("");
		try {
			const result = await getAdminResearchAnalytics(token, filters);
			if (requestId === researchRequestId.current) setResearchAnalytics(result);
		} catch { if (requestId === researchRequestId.current) setError("科研数据分析读取失败，请检查筛选条件后重试。"); }
		finally { if (requestId === researchRequestId.current) setLoading(false); }
	};

	const handleResetResearchFilters = () => {
		const next = defaultResearchFilters();
		setResearchFilters(next); loadResearchAnalytics(next);
	};

	const handleExportResearch = async () => {
		setSaving(true); setError("");
		try {
			const result = await exportAdminResearchData(token, researchFilters);
			exportResearchCsv(result.events || [], adminLocale);
		} catch (exportError) {
			setError(exportError.code === "permissionDenied" ? "当前账号没有导出科研数据的权限。" : "科研数据导出失败，请稍后重试。");
		} finally { setSaving(false); }
	};

	const openUserChat = async (chatUser) => {
		setLoading(true);
		setError("");
		try {
			const result = await getAdminUserUsage(token, chatUser.id);
			setSelectedChatUser(result.user);
			setMessages(result.days || []);
		} catch {
			setError("使用者数据读取失败，请稍后重试。");
		} finally {
			setLoading(false);
		}
	};

	const handleSaveAiConfiguration = async () => {
		setSaving(true); setError(""); setAiTestResult("");
		try {
			const configuration = aiConfiguration.providerMode === "deepseek_only" ? { ...aiConfiguration, provider: "deepseek" } : aiConfiguration;
			const result = await updateAdminAiConfiguration(token, configuration);
			setAiConfiguration({ ...result.configuration, apiKey: "" });
		} catch (saveError) {
			setError(saveError.code === "assistantProviderDisabled" ? "当前仅使用 DeepSeek，请刷新页面后重试。" : saveError.code === "assistantProviderChanged" ? "配置已被其他操作更新，请刷新页面后重试。" : saveError.code === "bailianNotConfigured" ? "请先在服务器配置百炼密钥及模型。" : saveError.code === "invalidDeepSeekConfiguration" ? "请选择 DeepSeek 模型并填写 API Key。" : "AI 配置保存失败，请稍后重试。");
		} finally { setSaving(false); }
	};

	const handleTestAiConfiguration = async () => {
		setSaving(true); setError(""); setAiTestResult("");
		try {
			const configuration = aiConfiguration.providerMode === "deepseek_only" ? { ...aiConfiguration, provider: "deepseek" } : aiConfiguration;
			const result = await testAdminAiConfiguration(token, configuration);
			setAiTestResult(`连接成功：${result.model}${result.preview ? ` · ${result.preview}` : ""}`);
		} catch (testError) {
			const code = testError.code;
			setError(code === "assistantProviderDisabled" ? "当前仅使用 DeepSeek，请刷新页面后重试。" : code === "aiConfigurationIncomplete" || code === "invalidDeepSeekConfiguration" ? "请选择 DeepSeek 模型并填写 API Key。" : code === "aiInvalidResponse" ? "模型已响应，但返回格式不正确。" : code === "bailianNotConfigured" ? "请先在服务器填写百炼密钥并确认模型配置。" : "模型连接测试失败，请检查对应密钥、模型权限及账户余额。");
		} finally { setSaving(false); }
	};

	const handleSaveUser = async () => {
		setSaving(true);
		setError("");
		try {
			await updateAdminUser(token, editingUser.id, {
				name: editingUser.name,
				email: editingUser.email,
				profileRole: editingUser.profileRole,
			});
			setEditingUser(null);
			await loadDashboard(token, adminAccess, search);
		} catch (saveError) {
			setError(saveError.code === "emailExists" ? "该电邮已被其他用户使用。" : "保存失败，请检查填写内容。");
		} finally {
			setSaving(false);
		}
	};
	const handleDeleteUser = (target) => {
		showAlert("删除用户", `确定删除用户“${target.name}”吗？个人资料将匿名化，且该账号不能再登录。`, [
			{ text: "取消", style: "cancel" },
			{ text: "删除", style: "destructive", onPress: async () => {
				setSaving(true); setError("");
				try { await deleteAdminUser(token, target.id); await loadDashboard(token, adminAccess, search); }
				catch (deleteError) { setError(deleteError.code === "adminAccountMustBeRemovedFirst" ? "该用户拥有后台权限，请先移除其后台身份。" : deleteError.code === "cannotDeleteSelf" ? "不能删除当前登录账号。" : "删除用户失败。"); }
				finally { setSaving(false); }
			} },
		]);
	};

	const handleCreateUser = async () => {
		setSaving(true); setError("");
		try {
			await createAdminUser(token, creatingUser);
			setCreatingUser(null);
			await loadDashboard(token, adminAccess, search);
		} catch (createError) {
			const messagesByCode = { phoneExists: "该手机号已注册。", emailExists: "该电邮已注册。", invalidEmail: "电邮格式不正确。", invalidRegistration: "请完整填写资料，密码至少需要 8 位。" };
			setError(messagesByCode[createError.code] || "新增用户失败，请检查填写内容。");
		} finally { setSaving(false); }
	};

	const handleSaveContent = async () => {
		if (saving || !editingContent) return;
		if (editingContent.pageKey === 'exercise_videos' && editingContent.contentType === 'video' && !editingContent.id && !normalizeExerciseVideoMetadata(editingContent).videoCategory) {
			setError('请先选择影片分类。'); return;
		}
		setSaving(true); setError("");
		try {
			const data = {
				pageKey: editingContent.pageKey,
				contentType: editingContent.contentType,
				title: editingContent.title,
				value: editingContent.value,
				sortOrder: Number(editingContent.sortOrder) || 0,
				isActive: editingContent.isActive,
				...(editingContent.pageKey === 'exercise_videos' && editingContent.contentType === 'video' ? normalizeExerciseVideoMetadata(editingContent) : {}),
			};
			if (editingContent.id) await updateAdminContent(token, editingContent.id, data);
			else await createAdminContent(token, data);
			setEditingContent(null);
			await loadDashboard(token, adminAccess, search);
		} catch (saveError) {
			setError(({ invalidVideoCategory: '请选择有效的影片分类。', invalidVideoEquipmentIds: '关联器材已不可用，请重新选择后保存。', invalidExerciseVideoMetadata: '分类和关联器材只适用于运动影片。' })[saveError?.code] || "维护内容保存失败，请检查页面、标题和内容地址。");
		} finally { setSaving(false); }
	};
	const handleDeleteContent = (item) => {
		showAlert("删除维护内容", `确定永久删除“${item.title}”吗？`, [
			{ text: "取消", style: "cancel" },
			{ text: "删除", style: "destructive", onPress: async () => {
				setSaving(true); setError("");
				try { await deleteAdminContent(token, item.id); await loadDashboard(token, adminAccess, search); }
				catch { setError("维护内容删除失败。"); }
				finally { setSaving(false); }
			} },
		]);
	};

	const handleSaveEquipment = async () => {
		if (saving || equipmentSaveInFlight.current || !editingEquipment) return;
		if (!editingEquipment.categories?.length || editingEquipment.categories.length > 32) {
			setError("请至少选择一个器材分类，最多选择 32 个。");
			return;
		}
		equipmentSaveInFlight.current = true;
		setSaving(true); setError(""); setSaveNotice("");
		const scopeToken = token;
		try {
			if (editingEquipment.isNew) await createAdminEquipment(token, editingEquipment);
			else await updateAdminEquipment(token, editingEquipment.id, editingEquipment);
			if (currentAdminToken.current !== scopeToken) return;
			// The write already succeeded. Close before reloading, so a failed GET
			// cannot encourage a second creation of the same facility.
			setEditingEquipment(null);
			setSaveNotice("器材资料已保存。APP 下次刷新设施教学时会读取更新。");
			try {
				const result = await getAdminEquipment(token);
				if (currentAdminToken.current !== scopeToken) return;
				setEquipmentCategories(mergeEquipmentCategories(result.categories));
				setEquipmentOverrides(result.items || []);
				setLoadIssues(items => items.filter(item => item !== "equipment"));
			} catch {
				if (currentAdminToken.current === scopeToken) { setLoadIssues(items => [...new Set([...items,"equipment"])]); setSaveNotice("器材已保存，但列表刷新失败。请重试载入，不要重复新增。"); }
			}
		} catch (equipmentError) {
			if (currentAdminToken.current === scopeToken) setError(equipmentError.code === "invalidEquipment" ? "请填写器材名称并选择有效分类；图片和视频请从电脑或文件存储导入。" : "器材资料保存失败，请稍后重试。");
		} finally { equipmentSaveInFlight.current = false; if (currentAdminToken.current === scopeToken) setSaving(false); }
	};
	const handleDeleteEquipment = () => {
		if (!editingEquipment || editingEquipment.isNew) return;
		const label = editingEquipment.nameZh || editingEquipment.nameEn || editingEquipment.id;
		showAlert("删除器材", `确定删除器材“${label}”吗？删除后 APP 将不再显示此器材，系统日志会保留本次操作。`, [
			{ text: "取消", style: "cancel" },
			{ text: "删除", style: "destructive", onPress: async () => {
				setSaving(true); setError("");
				try {
					await deleteAdminEquipment(token, editingEquipment.id);
					const result = await getAdminEquipment(token);
					setEquipmentOverrides(result.items || []); setEditingEquipment(null);
				} catch { setError("器材删除失败，请稍后重试。"); }
				finally { setSaving(false); }
			} },
		]);
	};

	const handleSaveEquipmentLocation = async () => {
		if (!editingEquipmentLocation) return;
		setSaving(true); setError("");
		try {
			if (editingEquipmentLocation.isNew) await createAdminEquipmentLocation(token, editingEquipmentLocation);
			else await updateAdminEquipmentLocation(token, editingEquipmentLocation.id, editingEquipmentLocation);
			const result = await getAdminEquipmentLocations(token);
			setEquipmentLocations(result.locations || []);
			setEditingEquipmentLocation(null);
			setLocationEquipmentSearch("");
		} catch (locationError) {
			setError(locationError.code === "invalidEquipmentLocation" ? "请选择对应设施，填写地区名称，并检查纬度与经度。" : "设施位置保存失败，请稍后重试。");
		} finally { setSaving(false); }
	};

	const handleDeleteEquipmentLocation = () => {
		if (!editingEquipmentLocation || editingEquipmentLocation.isNew) return;
		showAlert("删除设施位置", "确定删除这个设施位置吗？删除后 APP 将不再显示，系统日志会保留本次操作。", [
			{ text: "取消", style: "cancel" },
			{ text: "删除", style: "destructive", onPress: async () => {
				setSaving(true); setError("");
				try {
					await deleteAdminEquipmentLocation(token, editingEquipmentLocation.id);
					const result = await getAdminEquipmentLocations(token);
					setEquipmentLocations(result.locations || []);
					setEditingEquipmentLocation(null);
					setLocationEquipmentSearch("");
				} catch { setError("设施位置删除失败，请稍后重试。"); }
				finally { setSaving(false); }
			} },
		]);
	};

	const handleSaveFacilitySource = async () => {
		setSaving(true); setError("");
		try {
			const result = await updateAdminFacilitySource(token, facilitySource);
			setFacilitySource(result.source);
			await loadDashboard(token, adminAccess, search);
		} catch (sourceError) {
			setError(sourceError.code === "invalidFacilitySourceUrl" ? "接口地址必须是有效的 HTTPS 地址。" : "设施接口配置保存失败。");
		} finally { setSaving(false); }
	};

	const handleFacilitySync = async () => {
		setSaving(true); setError("");
		try {
			const result = await syncAdminFacilities(token);
			await loadDashboard(token, adminAccess, search);
			showAlert("同步完成", `已同步 ${result.recordCount} 个设施。`);
		} catch (syncError) {
			setError(`政府设施同步失败：${syncError.code === "facilitySyncFailed" ? "主接口和备用接口均无法读取，请检查接口地址。" : "请稍后重试。"}`);
			await loadDashboard(token, adminAccess, search);
		} finally { setSaving(false); }
	};

	const togglePersonnelPermission = (permission) => {
		setEditingPersonnel((current) => ({
			...current,
			permissions: current.permissions.includes(permission)
				? current.permissions.filter((item) => item !== permission)
				: [...current.permissions, permission],
		}));
	};

	const handleSavePersonnel = async () => {
		setSaving(true);
		setError("");
		try {
			const data = {
				systemRole: editingPersonnel.systemRole,
				permissions: editingPersonnel.permissions,
				isActive: editingPersonnel.isActive,
			};
			if (editingPersonnel.userId) {
				await updateAdminPersonnel(token, editingPersonnel.userId, data);
			} else {
				await createAdminPersonnel(token, { ...data, identifier: editingPersonnel.identifier });
			}
			setEditingPersonnel(null);
			await loadDashboard(token, adminAccess, search);
		} catch (personnelError) {
			const messagesByCode = {
				userNotFound: "找不到该注册用户，请先让此人员注册 APP 账号。",
				adminAccountExists: "该用户已经拥有后台身份。",
				cannotAssignRole: "当前账号不能授予此管理角色。",
			};
			setError(messagesByCode[personnelError.code] || "后台人员权限保存失败。");
		} finally {
			setSaving(false);
		}
	};

	const eventMax = useMemo(() => Math.max(1, ...(overview?.eventTypes || []).map((item) => item.count)), [overview]);
	const researchEventMax = useMemo(() => Math.max(1, ...(researchAnalytics?.eventTypes || []).map((item) => item.count)), [researchAnalytics]);
	const researchScreenMax = useMemo(() => Math.max(1, ...(researchAnalytics?.screens || []).map((item) => item.count)), [researchAnalytics]);
	const researchDailyMax = useMemo(() => Math.max(1, ...(researchAnalytics?.daily || []).map((item) => item.count)), [researchAnalytics]);
	const visibleTabs = useMemo(
		() => TABS.filter((tab) => canSeeAdminTab(tab, adminAccess?.admin.permissions || [])),
		[adminAccess],
	);
	const equipmentItems = useMemo(() => adminEquipmentItems(equipmentOverrides), [equipmentOverrides]);
	const equipmentById = useMemo(() => new Map(equipmentItems.map((item) => [String(item.id), item])), [equipmentItems]);
	const locationEquipmentOptions = useMemo(() => {
		const keyword = locationEquipmentSearch.trim().toLocaleLowerCase();
		if (!keyword) return equipmentItems;
		return equipmentItems.filter((item) => [item.id, item.nameZh, item.nameEn].some((value) => String(value || "").toLocaleLowerCase().includes(keyword)));
	}, [equipmentItems, locationEquipmentSearch]);
	const maintenancePage = MAINTENANCE_SECTIONS.find((item) => item.key === maintenanceSection);
	const secondaryItems = activeTab === "maintenance"
		? MAINTENANCE_SECTIONS.filter((item) => !item.permission || adminAccess?.admin.permissions.includes(item.permission))
		: activeTab === "users" ? [{ key: "registered" }, { key: "guests" }, { key: "registration" }]
		: [TABS.find((tab) => tab.key === activeTab)].filter(Boolean);
	const adminLanguage = ADMIN_LANGUAGE_TEXT[adminLocale];
	const workbenchCopy = getAdminWorkbenchCopy(adminLocale);
	const assistantLabel = { "zh-CN": "AI 助手", "zh-HK": "AI 助手", en: "AI Assistant" }[adminLocale];
	const userMenuLabel = (key) => ({ registered: { "zh-CN": "注册用户", "zh-HK": "註冊用戶", en: "Registered users" }, guests: { "zh-CN": "访客资料", "zh-HK": "訪客資料", en: "Guest information" }, registration: { "zh-CN": "用户注册", "zh-HK": "用戶註冊", en: "User registration" } }[key]?.[adminLocale] || key);
	const tabLabel = (key) => key === "assistant" ? assistantLabel : key === "feedback" ? ({ "zh-CN": "用户反馈", "zh-HK": "用戶回饋", en: "User Feedback" }[adminLocale]) : key === "files" ? ({ "zh-CN": "文件存储", "zh-HK": "檔案儲存", en: "File Storage" }[adminLocale]) : adminLanguage.tabs[key] || TABS.find((tab) => tab.key === key)?.label || key;
	const permissionLabel = (permission, fallback = PERMISSION_LABELS[permission]) => ({ "feedback.read": { "zh-CN": "查看用户反馈", "zh-HK": "查看用戶回饋", en: "View user feedback" }, "feedback.manage": { "zh-CN": "处理用户反馈", "zh-HK": "處理用戶回饋", en: "Manage user feedback" } }[permission]?.[adminLocale] || fallback);
	const maintenanceLabel = (key) => key === "exercise_videos" ? (adminLocale === "en" ? "Exercise Videos" : adminLocale === "zh-HK" ? "運動影片" : "运动影片") : key === "texts" ? workbenchCopy.textsLabel : key === "files" ? ({ "zh-CN": "文件存储空间", "zh-HK": "檔案儲存空間", en: "File Storage" }[adminLocale] || "文件存储空间") : adminLanguage.maintenance[key] || MAINTENANCE_SECTIONS.find((item) => item.key === key)?.label || key;
	const filteredEquipment = filterAdminContent(equipmentItems, equipmentFilter, ["id", "code", "nameZh", "nameEn", item => (item.categories || []).map(id => equipmentCategoryLabel(equipmentCategories.find(category => category.id === id), adminLocale) || id).join(" ")]);
	const pageContent = contentItems.filter(item => item.pageKey === maintenancePage?.pageKey);
	const categoryContent = maintenancePage?.pageKey === 'exercise_videos' && exerciseVideoCategoryFilter !== 'all'
		? pageContent.filter(item => normalizeExerciseVideoMetadata(item).videoCategory === exerciseVideoCategoryFilter) : pageContent;
	const filteredContent = filterAdminContent(categoryContent, contentFilter, ["id", "title", "value", item => CONTENT_TYPE_LABELS[item.contentType],
		item => item.pageKey === 'exercise_videos' ? exerciseVideoCategoryLabel(item.videoCategory, adminLocale) : '']);
	const filteredLocations = filterAdminContent(equipmentLocations, locationFilter, ["regionZh", "regionEn", "equipmentId", item => equipmentById.get(String(item.equipmentId))?.nameZh, item => equipmentById.get(String(item.equipmentId))?.nameEn]);
	const currentLoadFailure = (!(activeTab === "users" && userListMode !== "registered") && loadIssues.includes(activeTab === "maintenance" ? maintenanceSection : activeTab)) || (activeTab === "maintenance" && maintenanceSection === "locations" && loadIssues.includes("equipment"));
	const selectTab = key => { setActiveTab(key); setError(""); setSaveNotice(""); if (key === "maintenance" && !adminAccess?.admin.permissions.includes(maintenancePage?.permission)) setMaintenanceSection(MAINTENANCE_SECTIONS.find(item => adminAccess?.admin.permissions.includes(item.permission))?.key || "home"); };
	const shortcuts = [
		{ key: "equipment", tab: "maintenance", permission: "app_maintenance.equipment.manage", icon: "create-outline" },
		{ key: "home", tab: "maintenance", permission: "app_maintenance.home.manage", icon: "home-outline" },
		{ key: "files", tab: "files", permission: "app_maintenance.files.manage", icon: "folder-open-outline" },
		{ key: "feedback", tab: "feedback", permission: "feedback.read", icon: "mail-outline" },
	].filter(item => adminAccess?.admin.permissions.includes(item.permission)).map(item => ({ ...item, ...workbenchCopy.shortcuts[item.key] }));

	if (!token) {
		return (
			<View style={styles.loginPage}>
				<View style={styles.loginCard}>
					<Text style={styles.brand}>OUTDOOR-FIT</Text>
					<Text style={styles.loginTitle}>科研管理后台</Text>
					<Text style={styles.loginHint}>请使用已获授权的最高管理员、管理员或操作员账号登录。普通 APP 用户无法进入后台。</Text>
					<TextInput style={styles.input} value={identifier} onChangeText={setIdentifier} placeholder="手机号或电邮" autoCapitalize="none" />
					<TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="密码" secureTextEntry onSubmitEditing={handleLogin} />
					{!!error && <Text style={styles.errorText}>{error}</Text>}
					<TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
						{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>登录后台</Text>}
					</TouchableOpacity>
				</View>
			</View>
		);
	}

	return (
		<View style={styles.page}>
			<View style={styles.topbar}>
				<View>
					<Text style={styles.topbarBrand}>OUTDOOR-FIT</Text>
					<Text style={styles.topbarSubtitle}>{adminLanguage.subtitle}</Text>
				</View>
				<View style={styles.adminArea}>
					<TouchableOpacity style={[styles.refreshButton, loading && styles.refreshButtonDisabled]} onPress={handleRefreshDashboard} disabled={loading}>
						{loading ? <ActivityIndicator size="small" color="#840B1C" /> : <Text style={styles.refreshButtonText}>↻ {adminLanguage.refresh}</Text>}
					</TouchableOpacity>
					<View style={styles.languageSwitch}>{[["zh-CN","简","简体中文"],["zh-HK","繁","繁體中文"],["en","EN","English"]].map(([code,label,accessibleLabel]) => <TouchableOpacity key={code} testID={`admin-language-${code}`} accessibilityRole="button" accessibilityLabel={accessibleLabel} accessibilityState={{ selected: adminLocale === code }} style={[styles.languageOption, adminLocale === code && styles.languageOptionActive]} onPress={() => setAdminLocale(code)}><Text style={[styles.languageOptionText, adminLocale === code && styles.languageOptionTextActive]}>{label}</Text></TouchableOpacity>)}</View>
					<Text style={styles.adminName}>{adminName}</Text>
					<Text style={styles.adminRole}>{adminLanguage.roles[adminAccess?.admin.systemRole] || SYSTEM_ROLE_LABELS[adminAccess?.admin.systemRole]}</Text>
					<TouchableOpacity onPress={() => { dashboardRequestId.current++; setToken(""); setOverview(null); setAdminAccess(null); setLoadIssues([]); setEquipmentFilter(EMPTY_FILTER); setContentFilter(EMPTY_FILTER); setLocationFilter(EMPTY_FILTER); }}><Text style={styles.logout}>{adminLanguage.logout}</Text></TouchableOpacity>
				</View>
			</View>

			<View style={[styles.body, compactLayout && styles.bodyCompact]}>
				<View style={[styles.primarySidebar, compactLayout && styles.primarySidebarCompact]}>
					{visibleTabs.map(tab => <TouchableOpacity key={tab.key} testID={`admin-tab-${tab.key}`} accessibilityRole="button" accessibilityState={{ selected: activeTab === tab.key }} style={[styles.primaryNavItem, compactLayout && styles.primaryNavItemCompact, activeTab === tab.key && styles.primaryNavItemActive]} onPress={() => selectTab(tab.key)}><Ionicons name={TAB_ICONS[tab.key]} size={21} color={activeTab === tab.key ? "#FFF" : "#CFD5DF"} /><Text style={[styles.primaryNavText, activeTab === tab.key && styles.primaryNavTextActive]}>{tabLabel(tab.key)}</Text></TouchableOpacity>)}
				</View>
				{["maintenance", "users"].includes(activeTab) && <View style={[styles.secondarySidebar, compactLayout && styles.secondarySidebarCompact]}>
					<Text style={styles.secondaryTitle}>{adminLanguage.menu}</Text>
					{secondaryItems.map((item) => (
						<TouchableOpacity key={item.key} testID={`admin-menu-${item.key}`} style={[styles.secondaryItem, (activeTab === "maintenance" ? maintenanceSection === item.key : activeTab === "users" ? userListMode === item.key : true) && styles.secondaryItemActive]} onPress={() => activeTab === "maintenance" ? setMaintenanceSection(item.key) : activeTab === "users" ? setUserListMode(item.key) : setActiveTab(item.key)}>
							<Text style={[styles.secondaryItemText, (activeTab === "maintenance" ? maintenanceSection === item.key : activeTab === "users" ? userListMode === item.key : true) && styles.secondaryItemTextActive]}>{activeTab === "maintenance" ? maintenanceLabel(item.key) : activeTab === "users" ? userMenuLabel(item.key) : tabLabel(item.key)}</Text>
						</TouchableOpacity>
					))}
				</View>}
				<View style={styles.mainArea}>
					<View style={styles.breadcrumb}><Text style={styles.breadcrumbHome}>⌂ {adminLanguage.backend}</Text><Text style={styles.breadcrumbDivider}>/</Text><Text style={styles.breadcrumbCurrent}>{tabLabel(activeTab)}</Text>{activeTab === "maintenance" && <><Text style={styles.breadcrumbDivider}>/</Text><Text style={styles.breadcrumbCurrent}>{maintenanceLabel(maintenanceSection)}</Text></>}</View>
				<ScrollView ref={contentScroll} contentContainerStyle={[styles.content, compactLayout && styles.contentCompact]}>
					{!!error && <Text style={styles.errorBanner}>{error}</Text>}
					{!!saveNotice && <Text accessibilityLiveRegion="polite" style={styles.saveNotice}>{saveNotice}</Text>}
					{currentLoadFailure ? <View testID="admin-module-load-error" style={[styles.panel, styles.fullPagePanel]}><Text style={styles.panelTitle}>此栏目的数据暂时未能载入</Text><Text style={styles.sectionHint}>登录及管理权限已验证。为避免误改，暂不显示此栏目的编辑内容；其他栏目仍可使用。</Text><TouchableOpacity style={styles.primaryButton} disabled={loading} onPress={handleRefreshDashboard}><Text style={styles.primaryButtonText}>{loading ? "正在重试…" : "重试载入"}</Text></TouchableOpacity></View> : <>
					{activeTab === "overview" && overview && (
						<>
							{shortcuts.length > 0 && <View testID="admin-content-shortcuts" style={styles.workbench}><Text style={styles.panelTitle}>{workbenchCopy.title}</Text><Text style={styles.sectionHint}>{workbenchCopy.hint}</Text><View style={styles.shortcutGrid}>{shortcuts.map(item => <TouchableOpacity key={item.key} testID={`admin-shortcut-${item.key}`} accessibilityRole="button" style={styles.shortcut} onPress={() => { selectTab(item.tab); if (item.tab === "maintenance") setMaintenanceSection(item.key); }}><Ionicons name={item.icon} size={24} color="#840B1C" /><View style={styles.listMain}><Text style={styles.listTitle}>{item.label}</Text><Text style={styles.listMeta}>{item.hint}</Text></View><Text style={styles.editButtonText}>›</Text></TouchableOpacity>)}</View></View>}
							<Text style={styles.sectionTitle}>数据概览</Text>
							<View style={styles.statsGrid}>
								<StatCard label="注册用户" value={overview.counts.users} />
								<StatCard label="科研事件" value={overview.counts.researchEvents} color="#235789" />
								<StatCard label="短信请求" value={overview.counts.smsRequests} color="#D97706" />
								<StatCard label="验证成功" value={overview.counts.smsVerified} color="#177245" />
								<StatCard label="使用者总数" value={overview.counts.users} color="#6D28D9" />
								<StatCard label="有效同意" value={overview.counts.activeConsents} color="#0F766E" />
							</View>
							<View style={styles.panelRow}>
								<View style={styles.panel}>
									<Text style={styles.panelTitle}>用户角色分布</Text>
									{<AdminPaginatedList items={overview.roles} locale={adminLocale} resetKey={token} testID="admin-overview-roles">{(item) => <Text key={item.role} style={styles.dataLine}>{ROLE_LABELS[item.role] || item.role}：{item.count}</Text>}</AdminPaginatedList>}
								</View>
								<View style={styles.panel}>
									<Text style={styles.panelTitle}>科研事件类型</Text>
									{overview.eventTypes.length === 0 && <Text style={styles.empty}>尚无科研事件</Text>}
									{<AdminPaginatedList items={overview.eventTypes} locale={adminLocale} resetKey={token} testID="admin-overview-events">{(item) => (
										<View key={item.eventName} style={styles.barRow}>
											<Text style={styles.barLabel}>{item.eventName}</Text>
											<View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(6, item.count / eventMax * 100)}%` }]} /></View>
											<Text style={styles.barCount}>{item.count}</Text>
										</View>
									)}</AdminPaginatedList>}
								</View>
							</View>
						</>
					)}

					{activeTab === "users" && adminAccess.admin.permissions.includes("users.read") && (
						<>
							<View style={styles.userListTabs}>
								{["registered", "guests", "registration"].map((key) => (
									<TouchableOpacity key={key} testID={`admin-users-${key}`} accessibilityRole="button" accessibilityState={{ selected: userListMode === key }} style={[styles.userListTab, userListMode === key && styles.userListTabActive]} onPress={() => setUserListMode(key)}><Text style={[styles.userListTabText, userListMode === key && styles.userListTabTextActive]}>{userMenuLabel(key)}</Text></TouchableOpacity>
								))}
							</View>
							{userListMode === "guests" ? <AdminGuestProfiles key={token} token={token} locale={adminLocale} refreshKey={guestRefreshKey} /> : userListMode === "registration" ? <AdminRegistrationCodes key={token} token={token} locale={adminLocale} canEdit={adminAccess.admin.permissions.includes("users.edit")} refreshKey={registrationRefreshKey} /> : <>
							<View style={styles.sectionHeader}>
								<Text style={styles.sectionTitle}>用户管理</Text>
								<View style={{ flexDirection: "row", gap: 8 }}>{adminAccess.admin.permissions.includes("users.edit") && <TouchableOpacity style={styles.primaryButton} onPress={() => setCreatingUser({ name: "", countryCode: "+852", phone: "", email: "", profileRole: "participant", password: "" })}><Text style={styles.primaryButtonText}>新增用户</Text></TouchableOpacity>}{adminAccess.admin.systemRole === "super_admin" && adminAccess.admin.permissions.includes("users.edit") && <AdminTestUsers key={token} token={token} onChanged={() => loadDashboard(token, adminAccess, search)} />}{adminAccess.admin.permissions.includes("data.export") && <TouchableOpacity style={styles.exportButton} onPress={handleExportUsers} disabled={saving || loading}><Text style={styles.exportButtonText}>导出 CSV</Text></TouchableOpacity>}</View>
							</View>
							<View style={styles.searchRow}>
								<TextInput style={[styles.input, styles.searchInput]} value={search} onChangeText={setSearch} placeholder="搜索姓名、手机号或电邮" onSubmitEditing={handleSearch} />
								<TouchableOpacity style={styles.searchButton} onPress={handleSearch}><Text style={styles.primaryButtonText}>搜索</Text></TouchableOpacity>
							</View>
							{compactLayout && <Text style={styles.fieldHint}>表格可左右滑动，查看完整的联系方式与操作按钮。</Text>}
							<ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}><View style={{ minWidth: 1060, flexGrow: 1 }}>
							<View style={styles.userTableHeader}><Text style={[styles.tableHeadText, styles.userNameCell]}>姓名</Text><Text style={[styles.tableHeadText, styles.userContactCell]}>账号 / 联系方式</Text><Text style={[styles.tableHeadText, styles.userRoleCell]}>用户类型</Text><Text style={[styles.tableHeadText, styles.userOnlineCell]}>在线情况</Text><Text style={[styles.tableHeadText, styles.userDateCell]}>注册时间</Text><Text style={[styles.tableHeadText, styles.userActionCell]}>操作</Text></View>
							<Text style={styles.sectionHint}>每页显示 20 条。CSV 导出全部已应用搜索条件的结果，最多 50,000 条；超出时需先缩小搜索范围。</Text>
							{usersResult && <AdminRemotePaginatedList initialData={usersResult} itemsKey="users" locale={adminLocale} resetKey={token} loadPage={(page, pageSize) => getAdminUsers(token, usersResult.filters?.search || "", { page, pageSize })} onPageLoaded={setUsersResult} testID="admin-users" emptyText="暂无符合条件的用户">{(user) => (
								<View key={user.id} style={styles.listCard}>
									<Text style={[styles.listTitle, styles.userNameCell]}>{user.name}</Text><View style={styles.userContactCell}><Text style={styles.listDetail}>{user.phone}</Text><Text style={styles.listMeta}>{user.email || "未填写电邮"}</Text></View><Text style={[styles.listDetail, styles.userRoleCell]}>{ROLE_LABELS[user.profileRole]}</Text><View style={styles.userOnlineCell}><Text style={{ color: user.isOnline ? "#177245" : "#777", fontWeight: "700" }}>{user.isOnline ? "● 在线" : "○ 离线"}</Text><Text style={styles.listMeta}>{user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "暂无活动"}</Text></View><Text style={[styles.listMeta, styles.userDateCell]}>{new Date(user.createdAt).toLocaleString()}</Text>
									{adminAccess.admin.permissions.includes("users.edit") && (
										<View style={styles.userActionCell}><TouchableOpacity style={styles.editButton} onPress={() => setEditingUser({ ...user })}><Text style={styles.editButtonText}>编辑</Text></TouchableOpacity><TouchableOpacity style={[styles.editButton, { backgroundColor: "#FDECEC" }]} onPress={() => handleDeleteUser(user)}><Text style={{ color: "#B42318", fontWeight: "700" }}>删除</Text></TouchableOpacity></View>
									)}
								</View>
							)}</AdminRemotePaginatedList>}
							</View></ScrollView>
							</>}
						</>
					)}

					{activeTab === "events" && (
						<>
							<View style={styles.sectionHeader}>
								<View><Text style={styles.sectionTitle}>科研数据分析</Text><Text style={styles.sectionHint}>根据 APP 实际记录的页面访问、点击、视频、语音和训练行为分析；原始事件保持只读。</Text></View>
								{adminAccess.admin.permissions.includes("data.export") && <TouchableOpacity style={styles.exportButton} onPress={handleExportResearch} disabled={saving}><Text style={styles.exportButtonText}>导出筛选结果 CSV</Text></TouchableOpacity>}
							</View>
							<View style={styles.researchFilterPanel}>
								<Text style={styles.panelTitle}>筛选条件</Text>
								<View style={styles.researchFilterGrid}>
									<View style={styles.researchFilterField}><Text style={styles.fieldLabel}>开始日期</Text><TextInput style={[styles.input, styles.researchFilterInput]} value={researchFilters.dateFrom} onChangeText={(value) => setResearchFilters((item) => ({ ...item, dateFrom: value }))} placeholder="YYYY-MM-DD" /></View>
									<View style={styles.researchFilterField}><Text style={styles.fieldLabel}>结束日期</Text><TextInput style={[styles.input, styles.researchFilterInput]} value={researchFilters.dateTo} onChangeText={(value) => setResearchFilters((item) => ({ ...item, dateTo: value }))} placeholder="YYYY-MM-DD" /></View>
									<View style={styles.researchFilterField}><Text style={styles.fieldLabel}>用户姓名 / 手机号</Text><TextInput style={[styles.input, styles.researchFilterInput]} value={researchFilters.userSearch} onChangeText={(value) => setResearchFilters((item) => ({ ...item, userSearch: value }))} placeholder="输入关键词" /></View>
									<View style={styles.researchFilterField}><Text style={styles.fieldLabel}>事件代码</Text><TextInput style={[styles.input, styles.researchFilterInput]} value={researchFilters.eventName} onChangeText={(value) => setResearchFilters((item) => ({ ...item, eventName: value }))} placeholder="例如 video.completed" /></View>
									<View style={styles.researchFilterField}><Text style={styles.fieldLabel}>APP 页面</Text><TextInput style={[styles.input, styles.researchFilterInput]} value={researchFilters.screen} onChangeText={(value) => setResearchFilters((item) => ({ ...item, screen: value }))} placeholder="例如 outdoor.detail" /></View>
								</View>
								<Text style={styles.fieldLabel}>用户类型</Text>
								<View style={styles.researchRoleRow}>{[["", "全部"], ["participant", "参与者"], ["volunteer", "志愿者"], ["staff", "项目人员"]].map(([value, label]) => <TouchableOpacity key={value || "all"} style={[styles.researchChip, researchFilters.profileRole === value && styles.researchChipActive]} onPress={() => setResearchFilters((item) => ({ ...item, profileRole: value }))}><Text style={[styles.researchChipText, researchFilters.profileRole === value && styles.researchChipTextActive]}>{label}</Text></TouchableOpacity>)}</View>
								<View style={styles.researchFilterActions}><TouchableOpacity style={styles.primaryButton} onPress={() => loadResearchAnalytics()} disabled={loading}><Text style={styles.primaryButtonText}>应用筛选</Text></TouchableOpacity><TouchableOpacity style={styles.exportButton} onPress={handleResetResearchFilters}><Text style={styles.exportButtonText}>重置</Text></TouchableOpacity></View>
							</View>

							{researchAnalytics && <>
								<View style={styles.statsGrid}>
									<StatCard label="科研事件" value={researchAnalytics.summary?.totalEvents} />
									<StatCard label="活跃参与者" value={researchAnalytics.summary?.activeParticipants} color="#235789" />
									<StatCard label="页面访问" value={researchAnalytics.summary?.screenViews} color="#6D28D9" />
									<StatCard label="内容点击" value={researchAnalytics.summary?.taps} color="#D97706" />
									<StatCard label="视频开始" value={researchAnalytics.summary?.videosStarted} color="#0F766E" />
									<StatCard label="视频完整观看" value={`${researchAnalytics.summary?.videosCompleted || 0} (${researchAnalytics.summary?.videoCompletionRate || 0}%)`} color="#177245" />
								</View>
								<View style={styles.panelRow}>
									<View style={styles.panel}><Text style={styles.panelTitle}>行为类型分布</Text>{<AdminPaginatedList items={researchAnalytics.eventTypes || []} locale={adminLocale} resetKey={JSON.stringify(researchFilters)} testID="admin-research-types">{(item) => <View key={item.eventName} style={styles.barRow}><Text style={styles.barLabel}>{RESEARCH_EVENT_LABELS[item.eventName] || item.eventName}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(4, item.count / researchEventMax * 100)}%` }]} /></View><Text style={styles.barCount}>{item.count}</Text></View>}</AdminPaginatedList>}</View>
									<View style={styles.panel}><Text style={styles.panelTitle}>页面使用排行</Text>{<AdminPaginatedList items={researchAnalytics.screens || []} locale={adminLocale} resetKey={JSON.stringify(researchFilters)} testID="admin-research-screens">{(item) => <View key={item.screen} style={styles.barRow}><Text style={styles.barLabel} numberOfLines={1}>{item.screen}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(4, item.count / researchScreenMax * 100)}%`, backgroundColor: "#235789" }]} /></View><Text style={styles.barCount}>{item.count}</Text></View>}</AdminPaginatedList>}</View>
									<View style={styles.panel}><Text style={styles.panelTitle}>每日活跃趋势</Text>{<AdminPaginatedList items={researchAnalytics.daily || []} locale={adminLocale} resetKey={JSON.stringify(researchFilters)} testID="admin-research-daily">{(item) => <View key={item.day} style={styles.barRow}><Text style={styles.barLabel}>{item.day.slice(5)}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(4, item.count / researchDailyMax * 100)}%`, backgroundColor: "#0F766E" }]} /></View><Text style={styles.barCount}>{item.count}</Text></View>}</AdminPaginatedList>}</View>
								</View>
								<View style={[styles.panel, styles.researchFullPanel]}><Text style={styles.panelTitle}>视频观看完成情况</Text>{(researchAnalytics.videos || []).length === 0 ? <Text style={styles.empty}>筛选范围内没有视频数据</Text> : <AdminPaginatedList items={(researchAnalytics.videos || [])} locale={adminLocale} resetKey={JSON.stringify(researchFilters)} testID="admin-research-videos">{(item) => <View key={`${item.contentKind || 'video'}:${item.contentId}`} style={styles.researchDataRow}><Text style={styles.researchDataName}>{researchVideoLabel(item, adminLocale)}</Text><Text style={styles.researchDataValue}>开始 {item.started} 次</Text><Text style={styles.researchDataValue}>完整观看 {item.completed} 次</Text><Text style={styles.researchDataValue}>完成率 {item.started ? Math.round(item.completed / item.started * 100) : 0}%</Text></View>}</AdminPaginatedList>}</View>
								<Text style={styles.researchSubTitle}>参与者汇总</Text>
								<ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}><View style={{ minWidth: 740, flexGrow: 1 }}>
								<View style={styles.researchTableHeader}><Text style={styles.researchParticipantCell}>参与者</Text><Text style={styles.researchMetricCell}>事件数</Text><Text style={styles.researchMetricCell}>页面访问</Text><Text style={styles.researchMetricCell}>完整视频</Text><Text style={styles.researchDateCell}>最后活动</Text></View>
								{<AdminPaginatedList items={(researchAnalytics.participants || [])} locale={adminLocale} resetKey={JSON.stringify(researchFilters)} testID="admin-research-participants">{(item) => <View key={item.id} style={styles.listCard}><View style={styles.researchParticipantCell}><Text style={styles.listTitle}>{item.name}</Text><Text style={styles.listMeta}>{item.phone} · {ROLE_LABELS[item.profileRole] || item.profileRole}</Text></View><Text style={styles.researchMetricCell}>{item.eventCount}</Text><Text style={styles.researchMetricCell}>{item.screenViews}</Text><Text style={styles.researchMetricCell}>{item.videosCompleted}</Text><Text style={styles.researchDateCell}>{new Date(item.lastEventAt).toLocaleString()}</Text></View>}</AdminPaginatedList>}
								</View></ScrollView>
							</>}

							<Text style={styles.researchSubTitle}>事件明细</Text>
							{researchAnalytics && <AdminRemotePaginatedList initialData={researchAnalytics} itemsKey="events" locale={adminLocale} resetKey={token} loadPage={(page, pageSize) => getAdminResearchEvents(token, { ...(researchAnalytics.filters || researchFilters), page, pageSize })} testID="admin-research-events" emptyText="筛选范围内尚无科研使用数据">{(event) => <View key={event.id} style={styles.listCard}><View style={styles.listMain}><Text style={styles.listTitle}>{RESEARCH_EVENT_LABELS[event.eventName] || event.eventName}</Text><Text style={styles.listDetail}>{event.participantName} · {event.participantPhone} · {event.metadata?.screen || "未标注页面"}</Text><Text style={styles.listMeta}>对象：{researchObjectLabel(event, adminLocale)} · {new Date(event.eventTime).toLocaleString()}</Text></View><Text style={styles.researchEventCode}>{event.eventName}</Text></View>}</AdminRemotePaginatedList>}
						</>
					)}

					{activeTab === "maintenance" && maintenanceSection === "texts" && adminAccess.admin.permissions.includes("app_maintenance.text.manage") && <AdminAppTexts token={token} locale={adminLocale} />}
					{activeTab === "maintenance" && !!maintenancePage?.pageKey && (
						<>
							<View style={styles.sectionHeader}>
								<View><Text style={styles.sectionTitle}>{maintenanceLabel(maintenanceSection)}</Text><Text style={styles.sectionHint}>新增视频、文字说明或功能入口，并控制排序及上下架。</Text></View>
								<TouchableOpacity style={styles.primaryButton} onPress={() => maintenancePage?.pageKey === "exercise_videos" ? setExerciseVideoImportOpen(true) : setEditingContent({ pageKey: maintenancePage?.pageKey || "home", contentType: "video", title: "", value: "", sortOrder: Math.max(0, ...pageContent.map(item => Number(item.sortOrder) || 0)) + 1, isActive: true })}><Text style={styles.primaryButtonText}>{maintenancePage?.pageKey === "exercise_videos" ? "添加影片（可多选）" : "新增内容"}</Text></TouchableOpacity>
							</View>
							<AdminContentToolbar value={contentFilter} onChange={setContentFilter} count={filteredContent.length} total={pageContent.length} placeholder="搜索内容标题、类型或文字" locale={adminLocale} testID="admin-home-filter" />
							{maintenancePage?.pageKey === 'exercise_videos' && <ExerciseVideoCategoryChoices value={exerciseVideoCategoryFilter} onChange={setExerciseVideoCategoryFilter} locale={adminLocale} includeAll allowUncategorized testID="admin-exercise-video-filter" />}
							{<AdminPaginatedList items={filteredContent} locale={adminLocale} resetKey={`${token}:${maintenanceSection}:${JSON.stringify(contentFilter)}:${exerciseVideoCategoryFilter}`} testID="admin-content">{(item) => (
								<View key={item.id} style={styles.listCard}>
									<View style={styles.listMain}>
										<Text style={styles.listTitle}>{item.title}</Text>
										<Text style={styles.listDetail}>{PAGE_OPTIONS.find((page) => page.key === item.pageKey)?.label || item.pageKey} · {CONTENT_TYPE_LABELS[item.contentType] || item.contentType} · 排序 {item.sortOrder}</Text>
										{item.pageKey === 'exercise_videos' && item.contentType === 'video' && <Text testID={`exercise-video-summary-${item.id}`} style={styles.listDetail}>{exerciseVideoCategoryLabel(item.videoCategory, adminLocale)}{normalizeExerciseVideoMetadata(item).equipmentIds.map(id => ` · ${exerciseVideoEquipmentLabel(exerciseVideoCatalog.items.find(equipment => String(equipment.id) === id) || { id: `#${id}` }, adminLocale)}`).join('')}</Text>}
										<Text style={styles.listMeta} numberOfLines={1}>{item.isActive ? "已上架" : "已下架"} · {item.value}</Text>
									</View>
									<TouchableOpacity testID={`admin-edit-content-${item.id}`} style={styles.editButton} onPress={() => setEditingContent({ ...item, ...(item.pageKey === 'exercise_videos' && item.contentType === 'video' ? normalizeExerciseVideoMetadata(item) : {}) })}><Text style={styles.editButtonText}>编辑</Text></TouchableOpacity>
									<TouchableOpacity style={[styles.editButton, { backgroundColor: "#FDECEC" }]} onPress={() => handleDeleteContent(item)}><Text style={{ color: "#B42318", fontWeight: "700" }}>删除</Text></TouchableOpacity>
								</View>
							)}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "files" && adminAccess.admin.permissions.includes("app_maintenance.files.manage") && (
						<View testID="admin-files-panel" style={[styles.panel, styles.fullPagePanel]}><AdminMediaLibrary token={token} permissions={adminAccess?.admin.permissions || []} refreshKey={mediaRefreshKey} /></View>
					)}
					{activeTab === "maintenance" && maintenanceSection === "equipment" && (
						<>
							<AdminEquipmentCategories token={token} canManage={adminAccess.admin.permissions.includes("app_maintenance.equipment.manage")} locale={adminLocale} onChange={acceptEquipmentCategoryChange} onCatalogRefresh={refreshEquipmentCategoryCatalog} />
							<View style={[styles.sectionHeader, styles.equipmentSectionHeader]}>
								<View style={styles.equipmentSectionTitle}><Text style={styles.sectionTitle}>户外器材维护</Text><Text style={styles.sectionHint}>已自动识别 APP 内现有器材。可以编辑名称、说明、分类、图片和视频，或新增器材。</Text></View>
								<View style={styles.equipmentSectionActions}>
								<AdminEquipmentImport key={token} token={token} permissions={adminAccess.admin.permissions} onImported={async () => { const result = await getAdminEquipment(token); if (currentAdminToken.current === token) setEquipmentOverrides(result.items || []); }} onAssistantDocument={adminAccess.admin.permissions.includes("admin_assistant.use") ? (document) => { setAssistantDocument({ token, text: document.entries.map(item => `${item.code} ${item.nameZh} / ${item.nameEn}\n${item.fields.map(field => `${field.label}\n${field.after}`).join("\n\n")}`).join("\n\n") }); setActiveTab("assistant"); } : undefined} />
				<TouchableOpacity style={styles.primaryButton} onPress={() => setEditingEquipment({ isNew: true, nameZh: "", nameEn: "", categories: ["multifunctional"], imageUrl: "", gifLeftUrl: "", gifRightUrl: "", youtubeKey: "", videoUrl: "", detailsZh: "", detailsEn: "", kinesiologyZh: "", kinesiologyEn: "", ptTipZh: "", ptTipEn: "", otTipZh: "", otTipEn: "", tcmZh: "", tcmEn: "", tcmEnabled: false, careTipZh: "", careTipEn: "", sortOrder: equipmentItems.length, isActive: true })}><Text style={styles.primaryButtonText}>添加设施</Text></TouchableOpacity>
								</View>
							</View>
							<AdminContentToolbar value={equipmentFilter} onChange={setEquipmentFilter} count={filteredEquipment.length} total={equipmentItems.length} placeholder="搜索设施编号、中英文名称或分类" locale={adminLocale} testID="admin-equipment-filter" />
							{<AdminPaginatedList items={filteredEquipment} locale={adminLocale} resetKey={`${token}:${JSON.stringify(equipmentFilter)}`} testID="admin-equipment">{(item) => <View key={item.id} style={[styles.listCard,styles.equipmentRow]}>{item.previewSource ? <Image source={item.previewSource} style={styles.equipmentThumb} /> : <View style={styles.equipmentThumbPlaceholder}><Text>设施</Text></View>}<View style={[styles.listMain,styles.equipmentDescription]}><Text style={styles.listTitle}>{item.nameZh || item.nameEn}</Text><Text style={styles.listMeta}>{item.code ? `${item.code} · ` : ""}ID {item.id} · {item.nameEn || "未填写英文名称"}</Text><Text style={styles.listDetail}>{(item.categories || []).map(id => equipmentCategoryLabel(equipmentCategories.find(category => category.id === id),adminLocale) || id).join("、")}</Text><Text style={styles.listMeta}>排序 {item.sortOrder} · {item.isCustom ? "后台新增" : "APP 现有设施"}</Text></View><View style={styles.equipmentRowActions}><Text style={[styles.statusBadge, item.isActive ? styles.publishedBadge : styles.unpublishedBadge]}>{item.isActive ? "已上架" : "已下架"}</Text><TouchableOpacity accessibilityLabel={`编辑 ${item.nameZh || item.nameEn}`} style={styles.editButton} onPress={() => { setError(""); setEditingEquipment({ ...item }); }}><Text style={styles.editButtonText}>编辑</Text></TouchableOpacity></View></View>}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "maintenance" && maintenanceSection === "locations" && (
						<>
							<View style={styles.sectionHeader}>
								<View><Text style={styles.sectionTitle}>设施位置维护</Text><Text style={styles.sectionHint}>为设施教学中的器材配置一个或多个地区和 WGS84 坐标。APP 会按器材显示地点，并直接调用手机的系统地图导航。</Text></View>
								<TouchableOpacity style={styles.primaryButton} onPress={() => {
									const firstEquipment = equipmentItems[0];
									if (!firstEquipment) { setError("请先在设施教学中添加至少一项设施。"); return; }
									setLocationEquipmentSearch("");
									setEditingEquipmentLocation({ isNew: true, equipmentId: String(firstEquipment.id), regionZh: "", regionEn: "", latitude: "", longitude: "", sortOrder: equipmentLocations.length, isActive: true });
								}}><Text style={styles.primaryButtonText}>添加位置</Text></TouchableOpacity>
							</View>
							<AdminContentToolbar value={locationFilter} onChange={setLocationFilter} count={filteredLocations.length} total={equipmentLocations.length} placeholder="搜索地区、中英文设施名称或设施 ID" locale={adminLocale} testID="admin-location-filter" />
							{<AdminPaginatedList items={filteredLocations} locale={adminLocale} resetKey={`${token}:${JSON.stringify(locationFilter)}`} testID="admin-locations">{(location) => {
								const equipment = equipmentById.get(String(location.equipmentId));
								return <View key={location.id} style={[styles.listCard,styles.equipmentRow]}>
									<View style={styles.listMain}><Text style={styles.listTitle}>{equipment?.nameZh || equipment?.nameEn || `设施 ID：${location.equipmentId}`}</Text><Text style={styles.listMeta}>{equipment?.nameEn || location.equipmentId}</Text></View>
									<View style={{ flexGrow: 1, flexBasis: 140 }}><Text style={styles.listDetail}>{location.regionZh || "未填写中文地区"}</Text><Text style={styles.listMeta}>{location.regionEn || "未填写英文地区"}</Text></View>
									<Text style={[styles.listDetail, { width: 210 }]}>{Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)}</Text>
									<Text style={[styles.listDetail, { width: 90, color: location.isActive ? "#177245" : "#B42318" }]}>{location.isActive ? "已上架" : "已下架"}</Text>
									<TouchableOpacity style={styles.editButton} onPress={() => { setLocationEquipmentSearch(equipment?.nameZh || equipment?.nameEn || String(location.equipmentId)); setEditingEquipmentLocation({ ...location }); }}><Text style={styles.editButtonText}>编辑</Text></TouchableOpacity>
								</View>;
							}}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "maintenance" && maintenanceSection === "ai" && (
						<AdminAiConfiguration configuration={aiConfiguration} onChange={value => { setAiConfiguration(value); setAiTestResult(""); }} onSave={handleSaveAiConfiguration} onTest={handleTestAiConfiguration} busy={saving} testResult={aiTestResult} styles={styles} />
					)}

					{activeTab === "maintenance" && maintenanceSection === "facilities" && facilitySource && (
						<>
							<View style={[styles.sectionHeader, styles.facilitySectionHeader]}>
								<View><Text style={styles.sectionTitle}>香港政府设施数据</Text><Text style={styles.sectionHint}>主接口失效时系统会自动尝试备用接口。修改地址后无需重新打包 APP。</Text></View>
								<TouchableOpacity style={styles.primaryButton} onPress={handleFacilitySync} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>立即同步</Text>}</TouchableOpacity>
							</View>
							<View style={[styles.panel, styles.facilityPanel]}>
								<Text style={styles.panelTitle}>数据源设置</Text>
								<Text style={styles.fieldLabel}>主要 WFS / GeoJSON 接口</Text>
								<TextInput style={[styles.input, styles.facilityUrlInput]} multiline autoCapitalize="none" value={facilitySource.primaryUrl || ""} onChangeText={(primaryUrl) => setFacilitySource((value) => ({ ...value, primaryUrl }))} />
								<Text style={styles.fieldLabel}>备用 FeatureServer / GeoJSON 接口</Text>
								<TextInput style={[styles.input, styles.facilityUrlInput]} multiline autoCapitalize="none" value={facilitySource.fallbackUrl || ""} onChangeText={(fallbackUrl) => setFacilitySource((value) => ({ ...value, fallbackUrl }))} />
								<Text style={styles.fieldLabel}>官方资料页面</Text>
								<TextInput style={styles.input} autoCapitalize="none" value={facilitySource.portalUrl || ""} onChangeText={(portalUrl) => setFacilitySource((value) => ({ ...value, portalUrl }))} />
								<Text style={styles.fieldLabel}>自动同步间隔（小时，1–168）</Text>
								<TextInput style={styles.input} keyboardType="numeric" value={String(facilitySource.syncIntervalHours || 24)} onChangeText={(syncIntervalHours) => setFacilitySource((value) => ({ ...value, syncIntervalHours }))} />
								<TouchableOpacity style={[styles.statusButton, !facilitySource.isActive && styles.statusButtonInactive]} onPress={() => setFacilitySource((value) => ({ ...value, isActive: !value.isActive }))}><Text style={styles.statusButtonText}>{facilitySource.isActive ? "自动同步已启用（点击停用）" : "自动同步已停用（点击启用）"}</Text></TouchableOpacity>
								<View style={styles.modalActions}><TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSaveFacilitySource} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存接口配置</Text>}</TouchableOpacity></View>
							</View>
							<View style={[styles.panel, styles.facilityPanel]}>
								<Text style={styles.panelTitle}>同步状态</Text>
								<Text style={styles.dataLine}>当前记录：{facilitySource.lastRecordCount || 0}</Text>
								<Text style={styles.dataLine}>最后成功：{facilitySource.lastSuccessAt ? new Date(facilitySource.lastSuccessAt).toLocaleString() : "尚未同步"}</Text>
								<Text style={styles.dataLine}>最后使用接口：</Text><Text style={styles.facilityUrlText} numberOfLines={3}>{facilitySource.lastUsedUrl || "-"}</Text>
								{!!facilitySource.lastError && <Text style={styles.errorText}>最后错误：{facilitySource.lastError}</Text>}
							</View>
							<Text style={styles.sectionTitle}>最近同步记录</Text>
							{facilityRuns.length === 0 && <Text style={styles.empty}>尚无同步记录</Text>}
							{<AdminPaginatedList items={facilityRuns} locale={adminLocale} resetKey={token} testID="admin-facility-sync">{(run) => <View key={run.id} style={styles.listCard}><View style={styles.listMain}><Text style={styles.listTitle}>{run.status === "success" ? "同步成功" : run.status === "failed" ? "同步失败" : "同步中"} · {run.recordCount || 0} 条</Text><Text style={styles.listDetail}>{new Date(run.startedAt).toLocaleString()}</Text><Text style={styles.listMeta} numberOfLines={2}>{run.errorMessage || run.usedUrl || "-"}</Text></View></View>}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "messages" && (
						<>
							<View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>{selectedChatUser ? `${selectedChatUser.name} 的每日使用数据` : "按使用者查看数据"}</Text><Text style={styles.sectionHint}>先选择使用者，再按日期查看 APP 活动和运动记录。历史群聊资料不会在此页面显示。</Text></View>{selectedChatUser && <TouchableOpacity style={styles.exportButton} onPress={() => { setSelectedChatUser(null); setMessages([]); }}><Text style={styles.exportButtonText}>返回使用者列表</Text></TouchableOpacity>}</View>
							{!selectedChatUser && chatUsers.length === 0 && <Text style={styles.empty}>尚无使用者资料</Text>}
							{!selectedChatUser && <AdminPaginatedList items={chatUsers} locale={adminLocale} resetKey={token} testID="admin-usage-users">{(usageUser) => <View key={usageUser.id} style={styles.listCard}><View style={styles.listMain}><Text style={styles.listTitle}>{usageUser.name}</Text><Text style={styles.listDetail}>{usageUser.phone}{usageUser.email ? ` · ${usageUser.email}` : ""} · {ROLE_LABELS[usageUser.profileRole] || usageUser.profileRole}</Text><Text style={styles.listMeta}>活跃天数 {usageUser.activeDays || 0} 天 · 运动时段 {usageUser.exerciseSessions || 0} 次 · 最近活动：{usageUser.lastSeenAt ? new Date(usageUser.lastSeenAt).toLocaleString() : "暂无"}</Text></View><TouchableOpacity style={styles.editButton} onPress={() => openUserChat(usageUser)}><Text style={styles.editButtonText}>查看日期 ›</Text></TouchableOpacity></View>}</AdminPaginatedList>}
							{selectedChatUser && messages.length === 0 && <Text style={styles.empty}>该使用者尚无每日数据</Text>}
							{selectedChatUser && <AdminPaginatedList items={messages} locale={adminLocale} resetKey={`${token}:${selectedChatUser?.id}`} testID="admin-usage-days">{(day) => <View key={day.date} style={styles.listCard}><View style={styles.listMain}><Text style={styles.listTitle}>{day.date}</Text><Text style={styles.listDetail}>运动 {day.exerciseSessions || 0} 次 / {day.exerciseMinutes || 0} 分钟　页面浏览 {day.screenViews || 0} 次</Text><Text style={styles.listMeta}>APP 启动 {day.appSessions || 0} 次 · 已记录操作 {day.researchEvents || 0} 次 · 语音 {day.audioPlays || 0} 次 · 视频 {day.videoPlays || 0} 次</Text></View></View>}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "assistant" && adminAccess.admin.permissions.includes("admin_assistant.use") && (
						<View testID="admin-assistant-panel" style={[styles.fullPagePanel, styles.assistantPanel]}><AdminAssistant key={token} token={token} locale={adminLocale} documentText={assistantDocument?.token === token ? assistantDocument.text : ""} onDocumentChange={text => setAssistantDocument({ token, text })} onClearDocument={() => setAssistantDocument(null)} /></View>
					)}
					{activeTab === "feedback" && adminAccess.admin.permissions.includes("feedback.read") && (
						<View testID="admin-feedback-panel" style={[styles.panel, styles.fullPagePanel]}><AdminFeedback key={token} token={token} locale={adminLocale} canManage={adminAccess.admin.permissions.includes("feedback.read") && adminAccess.admin.permissions.includes("feedback.manage")} refreshKey={feedbackRefreshKey} /></View>
					)}
					{activeTab === "personnel" && (
						<>
							<View style={styles.sectionHeader}>
								<View>
									<Text style={styles.sectionTitle}>后台人员与权限</Text>
									<Text style={styles.sectionHint}>管理员可创建操作员；最高管理员还可以创建管理员。</Text>
								</View>
								<TouchableOpacity
									style={styles.primaryButton}
									onPress={() => setEditingPersonnel({ identifier: "", systemRole: "operator", permissions: ["dashboard.read"], isActive: true })}
								>
									<Text style={styles.primaryButtonText}>新增后台人员</Text>
								</TouchableOpacity>
							</View>
							{<AdminPaginatedList items={personnel} locale={adminLocale} resetKey={token} testID="admin-personnel">{(person) => (
								<View key={person.userId} style={styles.listCard}>
									<View style={styles.listMain}>
										<Text style={styles.listTitle}>{person.name} · {SYSTEM_ROLE_LABELS[person.systemRole]}</Text>
										<Text style={styles.listDetail}>{person.phone}　{person.email || "未填写电邮"}</Text>
										<Text style={styles.listMeta}>
											{person.isActive ? "已启用" : "已停用"} · {person.systemRole === "operator" ? person.permissions.map((permission) => permissionLabel(permission)).filter(Boolean).join("、") || "未分配权限" : "角色固定权限"}
										</Text>
									</View>
									{person.systemRole !== "super_admin" && (
										<TouchableOpacity style={styles.editButton} onPress={() => setEditingPersonnel({ ...person, permissions: person.permissions.filter((permission) => permission !== "app_maintenance.manage") })}><Text style={styles.editButtonText}>权限设置</Text></TouchableOpacity>
									)}
								</View>
							)}</AdminPaginatedList>}
						</>
					)}

					{activeTab === "logs" && (
						<>
							<Text style={styles.sectionTitle}>系统日志</Text>
							<Text style={styles.sectionHint}>此页面仅最高管理员可访问，记录所有后台修改与权限变更。</Text>
							{systemLogResult && <AdminRemotePaginatedList initialData={systemLogResult} itemsKey="logs" locale={adminLocale} resetKey={token} loadPage={(page, pageSize) => getAdminSystemLogs(token, { page, pageSize })} testID="admin-system-logs" emptyText="尚无系统修改日志">{(log) => (
								<View key={log.id} style={styles.listCard}>
									<View style={styles.listMain}>
									<Text style={styles.listTitle}>{SYSTEM_ACTION_LABELS[log.action] || log.action}</Text>
										<Text style={styles.listDetail}>{log.actorName} · {SYSTEM_ROLE_LABELS[log.actorRole] || log.actorRole || "系统"} · {new Date(log.createdAt).toLocaleString()}</Text>
									<Text style={styles.listMeta} numberOfLines={4}>操作代码：{log.action}　对象：{TARGET_TYPE_LABELS[log.targetType] || log.targetType || "-"} / {log.targetId || "-"}{log.metadataJson && log.metadataJson !== "{}" ? `\n修改详情：${log.metadataJson}` : ""}</Text>
									</View>
								</View>
							)}</AdminRemotePaginatedList>}
						</>
					)}
					</>}
				</ScrollView>
				</View>
			</View>

			<Modal visible={!!creatingUser} transparent animationType="fade" onRequestClose={() => setCreatingUser(null)}>
				<View style={styles.modalOverlay}><ScrollView style={styles.personnelModalScroll} contentContainerStyle={styles.modalCard}>
					<Text style={styles.modalTitle}>新增用户</Text>
					<Text style={styles.fieldLabel}>姓名</Text><TextInput style={styles.input} value={creatingUser?.name || ""} onChangeText={(name) => setCreatingUser((value) => ({ ...value, name }))} />
					<Text style={styles.fieldLabel}>国家区号与手机号</Text><View style={styles.searchRow}><TextInput style={[styles.input, { width: 100 }]} value={creatingUser?.countryCode || "+852"} onChangeText={(countryCode) => setCreatingUser((value) => ({ ...value, countryCode }))} keyboardType="phone-pad" /><TextInput style={[styles.input, styles.searchInput]} value={creatingUser?.phone || ""} onChangeText={(phone) => setCreatingUser((value) => ({ ...value, phone }))} keyboardType="phone-pad" placeholder="手机号码" /></View>
					<Text style={styles.fieldLabel}>电邮（选填）</Text><TextInput style={styles.input} value={creatingUser?.email || ""} onChangeText={(email) => setCreatingUser((value) => ({ ...value, email }))} autoCapitalize="none" />
					<Text style={styles.fieldLabel}>初始密码（至少 8 位）</Text><TextInput style={styles.input} value={creatingUser?.password || ""} onChangeText={(password) => setCreatingUser((value) => ({ ...value, password }))} secureTextEntry />
					<Text style={styles.fieldLabel}>用户类型</Text><View style={styles.roleRow}>{Object.entries(ROLE_LABELS).filter(([role]) => role !== "caregiver").map(([role, label]) => <TouchableOpacity key={role} style={[styles.roleButton, creatingUser?.profileRole === role && styles.roleButtonActive]} onPress={() => setCreatingUser((value) => ({ ...value, profileRole: role }))}><Text style={[styles.roleButtonText, creatingUser?.profileRole === role && styles.roleButtonTextActive]}>{label}</Text></TouchableOpacity>)}</View>
					<View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setCreatingUser(null)}><Text style={styles.cancelButtonText}>取消</Text></TouchableOpacity><TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleCreateUser} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>创建用户</Text>}</TouchableOpacity></View>
				</ScrollView></View>
			</Modal>

			<Modal visible={!!editingUser} transparent animationType="fade" onRequestClose={() => setEditingUser(null)}>
				<View style={styles.modalOverlay}>
					<View style={styles.modalCard}>
						<Text style={styles.modalTitle}>编辑用户</Text>
						<Text style={styles.fieldLabel}>姓名</Text>
						<TextInput style={styles.input} value={editingUser?.name || ""} onChangeText={(name) => setEditingUser((value) => ({ ...value, name }))} />
						<Text style={styles.fieldLabel}>电邮</Text>
						<TextInput style={styles.input} value={editingUser?.email || ""} onChangeText={(email) => setEditingUser((value) => ({ ...value, email }))} autoCapitalize="none" />
						<Text style={styles.fieldLabel}>角色</Text>
						<View style={styles.roleRow}>
							{Object.entries(ROLE_LABELS).filter(([role]) => role !== "caregiver").map(([role, label]) => (
								<TouchableOpacity key={role} style={[styles.roleButton, editingUser?.profileRole === role && styles.roleButtonActive]} onPress={() => setEditingUser((value) => ({ ...value, profileRole: role }))}>
									<Text style={[styles.roleButtonText, editingUser?.profileRole === role && styles.roleButtonTextActive]}>{label}</Text>
								</TouchableOpacity>
							))}
						</View>
						<View style={styles.modalActions}>
							<TouchableOpacity style={styles.cancelButton} onPress={() => setEditingUser(null)}><Text style={styles.cancelButtonText}>取消</Text></TouchableOpacity>
							<TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSaveUser} disabled={saving}>
								{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存修改</Text>}
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>

			<AdminExerciseVideoImport visible={exerciseVideoImportOpen} token={token} permissions={adminAccess?.admin.permissions || []} existing={contentItems} locale={adminLocale}
				onClose={() => setExerciseVideoImportOpen(false)} onSaved={() => { void loadDashboard(token, adminAccess, search).catch(() => setError("影片已发布，但列表刷新失败，请刷新页面查看。")); }} />
			<Modal visible={!!editingContent} transparent animationType="fade" onRequestClose={() => setEditingContent(null)}>
				<View style={styles.modalOverlay}><ScrollView style={styles.personnelModalScroll} contentContainerStyle={styles.modalCard}>
					<Text style={styles.modalTitle}>{editingContent?.id ? "编辑维护内容" : "新增维护内容"}</Text>
					{!!error && <Text style={styles.errorText}>{error}</Text>}
					<Text style={styles.fieldLabel}>显示界面</Text>
					<View style={styles.roleRow}>{PAGE_OPTIONS.filter(page => !editingContent?.id || page.key === editingContent.pageKey).map((page) => <TouchableOpacity key={page.key} style={[styles.roleButton, editingContent?.pageKey === page.key && styles.roleButtonActive]} onPress={() => setEditingContent((value) => ({ ...value, pageKey: page.key, ...(page.key === "exercise_videos" ? { contentType: "video", value: "" } : {}) }))}><Text style={[styles.roleButtonText, editingContent?.pageKey === page.key && styles.roleButtonTextActive]}>{page.label}</Text></TouchableOpacity>)}</View>
					<Text style={styles.fieldLabel}>内容类型</Text>
					<View style={styles.roleRow}>{Object.entries(CONTENT_TYPE_LABELS).filter(([type]) => (!editingContent?.id || type === editingContent.contentType) && (editingContent?.pageKey !== "exercise_videos" || type === "video")).map(([type, label]) => <TouchableOpacity key={type} style={[styles.roleButton, editingContent?.contentType === type && styles.roleButtonActive]} onPress={() => setEditingContent((value) => ({ ...value, contentType: type }))}><Text style={[styles.roleButtonText, editingContent?.contentType === type && styles.roleButtonTextActive]}>{label}</Text></TouchableOpacity>)}</View>
					<Text style={styles.fieldLabel}>标题</Text><TextInput style={styles.input} value={editingContent?.title || ""} onChangeText={(title) => setEditingContent((value) => ({ ...value, title }))} />
					{editingContent?.pageKey === 'exercise_videos' && editingContent?.contentType === 'video' && <AdminExerciseVideoMetadata value={editingContent} onChange={setEditingContent} catalog={exerciseVideoCatalog} locale={adminLocale} disabled={saving} allowUncategorized={Boolean(editingContent.id)} testID="admin-exercise-video-edit" />}
					{editingContent?.contentType === "video" ? <AdminMediaField key={`home-video-${editingContent?.id || "new"}`} label={editingContent?.pageKey === "exercise_videos" ? "运动影片" : "首页视频"} kind="video" token={token} permissions={adminAccess?.admin.permissions || []} disabled={saving} value={directVideoUri(editingContent?.value) ? editingContent.value : ""} legacyValue={youtubeVideoId(editingContent?.value) ? editingContent.value : ""} onChange={(value) => setEditingContent((current) => current ? ({ ...current, value }) : null)} /> : <><Text style={styles.fieldLabel}>{editingContent?.contentType === "feature" ? "APP 路由或网页地址" : "文字内容"}</Text><TextInput style={[styles.input, { minHeight: 82 }]} multiline value={editingContent?.value || ""} onChangeText={(value) => setEditingContent((current) => ({ ...current, value }))} /></>}
					<Text style={styles.fieldLabel}>显示顺序（数字越小越靠前）</Text><TextInput style={styles.input} keyboardType="numeric" value={String(editingContent?.sortOrder ?? 0)} onChangeText={(sortOrder) => setEditingContent((value) => ({ ...value, sortOrder }))} />
					<TouchableOpacity style={[styles.statusButton, !editingContent?.isActive && styles.statusButtonInactive]} onPress={() => setEditingContent((value) => ({ ...value, isActive: !value.isActive }))}><Text style={styles.statusButtonText}>{editingContent?.isActive ? "已上架（点击下架）" : "已下架（点击上架）"}</Text></TouchableOpacity>
					<View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setEditingContent(null)}><Text style={styles.cancelButtonText}>取消</Text></TouchableOpacity><TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSaveContent} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存并发布</Text>}</TouchableOpacity></View>
				</ScrollView></View>
			</Modal>

			<AdminEquipmentEditor value={editingEquipment} onChange={setEditingEquipment} categories={equipmentCategories} token={token} permissions={adminAccess?.admin.permissions || []} locale={adminLocale} saving={saving} error={error} onSave={handleSaveEquipment} onClose={() => { setEditingEquipment(null); setError(""); }} onDelete={handleDeleteEquipment} />

			<Modal visible={!!editingEquipmentLocation} transparent animationType="fade" onRequestClose={() => setEditingEquipmentLocation(null)}>
				<View style={styles.modalOverlay}><ScrollView style={styles.personnelModalScroll} contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled">
					<Text style={styles.modalTitle}>{editingEquipmentLocation?.isNew ? "添加设施位置" : "编辑设施位置"}</Text>
					<Text style={styles.fieldLabel}>对应设施</Text>
					<TextInput style={styles.input} value={locationEquipmentSearch} onChangeText={setLocationEquipmentSearch} placeholder="输入中文、英文名称或设施 ID 搜索" />
					<ScrollView style={styles.locationEquipmentSelector} nestedScrollEnabled keyboardShouldPersistTaps="handled">
						{<AdminPaginatedList items={locationEquipmentOptions} locale={adminLocale} resetKey={`${locationEquipmentSearch}:${editingEquipmentLocation?.id || "new"}`} testID="admin-location-equipment">{(equipment) => {
							const selected = String(editingEquipmentLocation?.equipmentId) === String(equipment.id);
							return <TouchableOpacity key={equipment.id} style={[styles.locationEquipmentOption, selected && styles.locationEquipmentOptionActive]} onPress={() => setEditingEquipmentLocation((item) => ({ ...item, equipmentId: String(equipment.id) }))}>
								<Text style={[styles.locationEquipmentOptionTitle, selected && styles.locationEquipmentOptionTextActive]}>{selected ? "✓ " : ""}{equipment.nameZh || equipment.nameEn}</Text>
								<Text style={[styles.locationEquipmentOptionMeta, selected && styles.locationEquipmentOptionTextActive]}>{equipment.nameEn || `ID：${equipment.id}`}</Text>
							</TouchableOpacity>;
						}}</AdminPaginatedList>}
						{locationEquipmentOptions.length === 0 && <Text style={styles.empty}>没有符合条件的设施</Text>}
					</ScrollView>
					<Text style={styles.fieldHint}>当前设施 ID：{editingEquipmentLocation?.equipmentId || "尚未选择"}</Text>
					<Text style={styles.fieldLabel}>地区名称（繁体中文）</Text><TextInput style={styles.input} value={editingEquipmentLocation?.regionZh || ""} onChangeText={(regionZh) => setEditingEquipmentLocation((item) => ({ ...item, regionZh }))} placeholder="例如：九龍城區" />
					<Text style={styles.fieldLabel}>District name (English)</Text><TextInput style={styles.input} value={editingEquipmentLocation?.regionEn || ""} onChangeText={(regionEn) => setEditingEquipmentLocation((item) => ({ ...item, regionEn }))} placeholder="e.g. Kowloon City District" autoCapitalize="words" />
					<Text style={styles.fieldHint}>中文或英文地区名称至少填写一项。</Text>
					<View style={styles.coordinateFields}>
						<View style={styles.coordinateField}><Text style={styles.fieldLabel}>纬度 Latitude</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={String(editingEquipmentLocation?.latitude ?? "")} onChangeText={(latitude) => setEditingEquipmentLocation((item) => ({ ...item, latitude }))} placeholder="22.319300" /></View>
						<View style={styles.coordinateField}><Text style={styles.fieldLabel}>经度 Longitude</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={String(editingEquipmentLocation?.longitude ?? "")} onChangeText={(longitude) => setEditingEquipmentLocation((item) => ({ ...item, longitude }))} placeholder="114.169400" /></View>
					</View>
					<Text style={styles.fieldHint}>请使用 WGS84 十进制度数；纬度范围 -90 至 90，经度范围 -180 至 180。</Text>
					<Text style={styles.fieldLabel}>显示顺序</Text><TextInput style={styles.input} keyboardType="numeric" value={String(editingEquipmentLocation?.sortOrder ?? 0)} onChangeText={(sortOrder) => setEditingEquipmentLocation((item) => ({ ...item, sortOrder }))} />
					<TouchableOpacity style={[styles.statusButton, !editingEquipmentLocation?.isActive && styles.statusButtonInactive]} onPress={() => setEditingEquipmentLocation((item) => ({ ...item, isActive: !item.isActive }))}><Text style={styles.statusButtonText}>{editingEquipmentLocation?.isActive ? "已上架（点击下架）" : "已下架（点击上架）"}</Text></TouchableOpacity>
					<View style={styles.modalActions}>
						{!editingEquipmentLocation?.isNew && <TouchableOpacity style={[styles.cancelButton, { borderColor: "#B42318" }]} onPress={handleDeleteEquipmentLocation} disabled={saving}><Text style={{ color: "#B42318", fontWeight: "700" }}>删除位置</Text></TouchableOpacity>}
						<TouchableOpacity style={styles.cancelButton} onPress={() => { setEditingEquipmentLocation(null); setLocationEquipmentSearch(""); }}><Text style={styles.cancelButtonText}>取消</Text></TouchableOpacity>
						<TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSaveEquipmentLocation} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存并同步 APP</Text>}</TouchableOpacity>
					</View>
				</ScrollView></View>
			</Modal>

			<Modal visible={!!editingPersonnel} transparent animationType="fade" onRequestClose={() => setEditingPersonnel(null)}>
				<View style={styles.modalOverlay}>
					<ScrollView style={styles.personnelModalScroll} contentContainerStyle={styles.modalCard}>
						<Text style={styles.modalTitle}>{editingPersonnel?.userId ? "设置后台权限" : "新增后台人员"}</Text>
						{!editingPersonnel?.userId && (
							<>
								<Text style={styles.fieldLabel}>已注册用户的手机号或电邮</Text>
								<TextInput
									style={styles.input}
									value={editingPersonnel?.identifier || ""}
									onChangeText={(identifier) => setEditingPersonnel((value) => ({ ...value, identifier }))}
									autoCapitalize="none"
									placeholder="例如：admin@example.com"
								/>
							</>
						)}
						<Text style={styles.fieldLabel}>后台角色</Text>
						<View style={styles.roleRow}>
							{["operator", ...(adminAccess?.admin.systemRole === "super_admin" ? ["admin"] : [])].map((role) => (
								<TouchableOpacity
									key={role}
									style={[styles.roleButton, editingPersonnel?.systemRole === role && styles.roleButtonActive]}
									onPress={() => setEditingPersonnel((value) => ({ ...value, systemRole: role }))}
								>
									<Text style={[styles.roleButtonText, editingPersonnel?.systemRole === role && styles.roleButtonTextActive]}>{SYSTEM_ROLE_LABELS[role]}</Text>
								</TouchableOpacity>
							))}
						</View>
						{editingPersonnel?.systemRole === "operator" && (
							<>
								<Text style={styles.fieldLabel}>操作员权限</Text>
								<View style={styles.permissionGrid}>
									{<AdminPaginatedList items={Object.entries(PERMISSION_LABELS)} locale={adminLocale} resetKey={`${editingPersonnel?.userId || "new"}`} testID="admin-permissions">{([permission, label]) => {
										const selected = editingPersonnel.permissions.includes(permission);
										return (
											<TouchableOpacity key={permission} style={[styles.permissionItem, selected && styles.permissionItemActive]} onPress={() => togglePersonnelPermission(permission)}>
												<Text style={[styles.permissionText, selected && styles.permissionTextActive]}>{selected ? "✓ " : ""}{permissionLabel(permission, label)}</Text>
											</TouchableOpacity>
										);
									}}</AdminPaginatedList>}
								</View>
							</>
						)}
						{!!editingPersonnel?.userId && (
							<TouchableOpacity
								style={[styles.statusButton, !editingPersonnel.isActive && styles.statusButtonInactive]}
								onPress={() => setEditingPersonnel((value) => ({ ...value, isActive: !value.isActive }))}
							>
								<Text style={styles.statusButtonText}>{editingPersonnel.isActive ? "账号已启用（点击停用）" : "账号已停用（点击启用）"}</Text>
							</TouchableOpacity>
						)}
						<View style={styles.modalActions}>
							<TouchableOpacity style={styles.cancelButton} onPress={() => setEditingPersonnel(null)}><Text style={styles.cancelButtonText}>取消</Text></TouchableOpacity>
							<TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSavePersonnel} disabled={saving}>
								{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存权限</Text>}
							</TouchableOpacity>
						</View>
					</ScrollView>
				</View>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	userListTabs: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
	userListTab: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: "#D9DDE3", backgroundColor: "#fff", paddingVertical: 12, paddingHorizontal: 20, justifyContent: "center" },
	userListTabActive: { backgroundColor: "#840B1C", borderColor: "#840B1C" },
	userListTabText: { fontSize: 15, color: "#840B1C", fontWeight: "700" },
	userListTabTextActive: { color: "#fff" },
	loginPage: { flex: 1, minHeight: "100vh", backgroundColor: "#F4F1F2", alignItems: "center", justifyContent: "center", padding: 24 },
	loginCard: { width: "100%", maxWidth: 430, backgroundColor: "#fff", borderRadius: 18, padding: 32, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 18, elevation: 4 },
	brand: { color: "#840B1C", fontSize: 14, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
	loginTitle: { color: "#222", fontSize: 28, fontWeight: "800", textAlign: "center", marginTop: 8 },
	loginHint: { color: "#666", fontSize: 14, lineHeight: 21, textAlign: "center", marginVertical: 20 },
	input: { borderWidth: 1, borderColor: "#D8D4D5", borderRadius: 10, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#222", marginBottom: 12 },
	primaryButton: { backgroundColor: "#840B1C", borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
	primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
	errorText: { color: "#B42318", fontSize: 13, marginBottom: 12 },
	page: { flex: 1, height: "100vh", backgroundColor: "#F2F4F7" },
	topbar: { minHeight: 76, flexShrink: 0, flexWrap: "wrap", gap: 12, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#DDE2E8", paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 3 },
	topbarBrand: { color: "#17181A", fontWeight: "900", fontSize: 22, letterSpacing: 1.2 },
	topbarSubtitle: { color: "#777", fontSize: 12, marginTop: 2 },
	adminArea: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, minWidth: 0, maxWidth: "100%" },
	refreshButton: { minWidth: 88, minHeight: 34, paddingHorizontal: 12, borderWidth: 1, borderColor: "#840B1C", borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
	refreshButtonDisabled: { opacity: 0.55 },
	refreshButtonText: { color: "#840B1C", fontSize: 13, fontWeight: "800" },
	languageSwitch: { flexDirection: "row", borderWidth: 1, borderColor: "#D7D9DD", borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" },
	languageOption: { minWidth: 38, paddingHorizontal: 8, paddingVertical: 7, alignItems: "center" },
	languageOptionActive: { backgroundColor: "#840B1C" },
	languageOptionText: { color: "#555", fontSize: 12, fontWeight: "700" },
	languageOptionTextActive: { color: "#fff" },
	fieldTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 8 },
	fieldTitleText: { flex: 1 },
	fieldHint: { color: "#667085", fontSize: 12, marginTop: -4, marginBottom: 8 },
	compactToggle: { width: 50, height: 28, borderRadius: 14, padding: 3, backgroundColor: "#D0D5DD", justifyContent: "center" },
	compactToggleActive: { backgroundColor: "#840B1C" },
	compactToggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
	compactToggleKnobActive: { alignSelf: "flex-end" },
	adminName: { color: "#333", fontWeight: "600" },
	adminRole: { color: "#840B1C", backgroundColor: "#F5EDEF", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: "700" },
	logout: { color: "#840B1C", fontWeight: "700" },
	body: { flex: 1, minHeight: 0, flexDirection: "row", alignItems: "stretch" },
	bodyCompact: { flexDirection: "column" },
	primarySidebar: { width: 166, flexShrink: 0, backgroundColor: "#202938", paddingVertical: 12, gap: 3, ...Platform.select({ web: { overflowY: "auto" } }) },
	primarySidebarCompact: { width: "100%", flexDirection: "row", flexWrap: "wrap", padding: 8 },
	primaryNavItem: { minHeight: 52, flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderLeftWidth: 4, borderLeftColor: "transparent" },
	primaryNavItemCompact: { minHeight: 42, flexGrow: 1, flexBasis: 145, borderRadius: 7 },
	primaryNavItemActive: { backgroundColor: "#292B2F", borderLeftColor: "#840B1C" },
	primaryNavIcon: { color: "#C8CBD1", fontSize: 22, marginBottom: 5 },
	primaryNavText: { color: "#CFD5DF", fontSize: 13, lineHeight: 19, fontWeight: "600", flexShrink: 1 },
	primaryNavTextActive: { color: "#fff" },
	secondarySidebar: { width: 174, flexShrink: 0, backgroundColor: "#fff", borderRightWidth: 1, borderRightColor: "#E0E4EA", paddingHorizontal: 10, paddingTop: 24 },
	secondarySidebarCompact: { width: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", padding: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: "#E0E4EA" },
	secondaryTitle: { color: "#25272B", fontSize: 16, fontWeight: "800", marginBottom: 18, paddingHorizontal: 10 },
	secondaryItem: { borderRadius: 7, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 7 },
	secondaryItemActive: { backgroundColor: "#F2E8EA" },
	secondaryItemText: { color: "#4F535A", fontSize: 14, fontWeight: "600" },
	secondaryItemTextActive: { color: "#840B1C", fontWeight: "800" },
	mainArea: { flex: 1, minWidth: 0, minHeight: 0 },
	breadcrumb: { minHeight: 54, flexShrink: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
	breadcrumbHome: { color: "#69717D", fontSize: 14 },
	breadcrumbDivider: { color: "#B1B7C0" },
	breadcrumbCurrent: { color: "#840B1C", fontSize: 15, fontWeight: "800" },
	tabs: { paddingHorizontal: 24, paddingTop: 18, gap: 8 },
	tab: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, backgroundColor: "#ECEDEF" },
	tabActive: { backgroundColor: "#840B1C" },
	tabText: { color: "#555", fontSize: 14, fontWeight: "600" },
	tabTextActive: { color: "#fff" },
	content: { width: "100%", maxWidth: 1380, alignSelf: "center", paddingHorizontal: 28, paddingBottom: 70 },
	contentCompact: { paddingHorizontal: 14, paddingBottom: 30 },
	saveNotice: { backgroundColor: "#E8F5ED", color: "#14613D", borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 14, lineHeight: 22 },
	sectionTitle: { color: "#202124", fontSize: 24, fontWeight: "800", marginBottom: 16 },
	sectionHint: { color: "#566173", fontSize: 13, lineHeight: 21, marginBottom: 16 },
	sectionHeader: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
	workbench: { padding: 20, borderRadius: 14, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#DDE2E8", marginBottom: 24 },
	shortcutGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
	shortcut: { flexGrow: 1, flexBasis: 300, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#E1DADD", backgroundColor: "#FCF9FA", borderRadius: 10, padding: 16 },
	equipmentRow: { flexWrap: "wrap", gap: 14 },
	equipmentDescription: { flexBasis: 240, flexGrow: 1 },
	equipmentRowActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
	statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, fontSize: 13, fontWeight: "700" },
	publishedBadge: { color: "#14613D", backgroundColor: "#E8F5ED" },
	unpublishedBadge: { color: "#9D221B", backgroundColor: "#FDEBE9" },
	equipmentSectionHeader: { flexWrap: "wrap", gap: 12, marginBottom: 12 },
	equipmentSectionTitle: { flexBasis: 320, flexGrow: 1, minWidth: 0 },
	equipmentSectionActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" },
	statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 22 },
	statCard: { flexGrow: 1, flexBasis: 240, minWidth: 150, backgroundColor: "#fff", borderRadius: 14, padding: 18, overflow: "hidden", borderWidth: 1, borderColor: "#ECEDEF" },
	statAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
	statValue: { color: "#222", fontSize: 28, fontWeight: "800" },
	statLabel: { color: "#73757A", fontSize: 13, marginTop: 4 },
	panelRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
	panel: { flexGrow: 1, flexBasis: 350, minWidth: 280, backgroundColor: "#fff", borderRadius: 14, padding: 20, borderWidth: 1, borderColor: "#ECEDEF" },
	// Standalone vertical panels must size to their contents, not the row-card basis.
	fullPagePanel: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", minWidth: 0, width: "100%" },
	assistantPanel: { borderRadius: 18, overflow: "hidden", backgroundColor: "#EAF0FA" },
	facilityPanel: { flexGrow: 0, flexBasis: "auto", minWidth: 0, width: "100%", marginBottom: 16, overflow: "hidden" },
	facilitySectionHeader: { flexWrap: "wrap", gap: 12, alignItems: "flex-start" },
	facilityUrlInput: { height: 74, minHeight: 74, textAlignVertical: "top", fontSize: 12, lineHeight: 18 },
	facilityUrlText: { color: "#737780", fontSize: 12, lineHeight: 18, paddingVertical: 8 },
	panelTitle: { color: "#222", fontSize: 17, fontWeight: "700", marginBottom: 14 },
	dataLine: { color: "#4A4A4A", fontSize: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
	barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 6 },
	barLabel: { width: 120, color: "#555", fontSize: 12 },
	barTrack: { flex: 1, height: 9, borderRadius: 5, backgroundColor: "#EEE" },
	barFill: { height: 9, borderRadius: 5, backgroundColor: "#840B1C" },
	barCount: { width: 30, color: "#555", fontSize: 12, textAlign: "right" },
	researchFilterPanel: { backgroundColor: "#fff", borderRadius: 14, padding: 20, borderWidth: 1, borderColor: "#E1E5EA", marginBottom: 18 },
	researchFilterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
	researchFilterField: { flexGrow: 1, flexBasis: 210, minWidth: 180 },
	researchFilterInput: { marginBottom: 5 },
	researchRoleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
	researchChip: { borderWidth: 1, borderColor: "#CDD2D9", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
	researchChipActive: { borderColor: "#840B1C", backgroundColor: "#840B1C" },
	researchChipText: { color: "#52565C", fontSize: 13, fontWeight: "600" },
	researchChipTextActive: { color: "#fff" },
	researchFilterActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
	researchFullPanel: { width: "100%", flexBasis: "auto", marginTop: 16, marginBottom: 18 },
	researchDataRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#ECEFF2" },
	researchDataName: { flex: 1, minWidth: 190, color: "#25272B", fontWeight: "700" },
	researchDataValue: { width: 130, color: "#5A5E65", fontSize: 13 },
	researchSubTitle: { color: "#202124", fontSize: 18, fontWeight: "800", marginTop: 22, marginBottom: 10 },
	researchTableHeader: { flexDirection: "row", alignItems: "center", backgroundColor: "#F7F8FA", paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#DDE1E6" },
	researchParticipantCell: { flex: 1, minWidth: 210 },
	researchMetricCell: { width: 95, textAlign: "center", color: "#4F535A" },
	researchDateCell: { width: 190, color: "#6C7077", fontSize: 12 },
	researchEventCode: { width: 160, color: "#69717D", fontSize: 12, textAlign: "right" },
	searchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
	searchInput: { flex: 1, minWidth: 180, marginBottom: 0 },
	searchButton: { backgroundColor: "#840B1C", borderRadius: 10, minWidth: 82, alignItems: "center", justifyContent: "center" },
	exportButton: { borderWidth: 1, borderColor: "#840B1C", borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
	exportButtonText: { color: "#840B1C", fontWeight: "700" },
	chatToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 10 },
	selectionAction: { backgroundColor: "#F2E8EA", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9 },
	selectionActionText: { color: "#840B1C", fontWeight: "700" },
	selectionCount: { color: "#555", fontWeight: "600", marginRight: "auto" },
	disabledAction: { opacity: 0.4 },
	listCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 15, marginBottom: 8, borderWidth: 1, borderColor: "#E0E4EA" },
	equipmentThumb: { width: 58, height: 58, borderRadius: 8, marginRight: 13, backgroundColor: "#F1F1F1" },
	equipmentThumbPlaceholder: { width: 58, height: 58, borderRadius: 8, marginRight: 13, backgroundColor: "#F1F1F1", alignItems: "center", justifyContent: "center" },
	equipmentPreview: { width: "100%", height: 180, borderRadius: 10, marginBottom: 14, resizeMode: "contain", backgroundColor: "#F3F4F6" },
	longTextInput: { minHeight: 96, textAlignVertical: "top" },
	locationEquipmentSelector: { maxHeight: 210, borderWidth: 1, borderColor: "#D8D4D5", borderRadius: 10, marginBottom: 12, backgroundColor: "#FAFAFB" },
	locationEquipmentOption: { paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#ECEDEF" },
	locationEquipmentOptionActive: { backgroundColor: "#840B1C" },
	locationEquipmentOptionTitle: { color: "#303238", fontSize: 13, fontWeight: "700" },
	locationEquipmentOptionMeta: { color: "#7B7F86", fontSize: 11, marginTop: 3 },
	locationEquipmentOptionTextActive: { color: "#fff" },
	coordinateFields: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
	coordinateField: { flexGrow: 1, flexBasis: 190, minWidth: 170 },
	checkbox: { width: 23, height: 23, borderWidth: 1, borderColor: "#AEB2B8", borderRadius: 4, alignItems: "center", justifyContent: "center", marginRight: 13, backgroundColor: "#fff" },
	checkboxSelected: { backgroundColor: "#840B1C", borderColor: "#840B1C" },
	checkboxMark: { color: "#fff", fontWeight: "900", fontSize: 15 },
	userTableHeader: { flexDirection: "row", alignItems: "center", backgroundColor: "#F7F8FA", borderBottomWidth: 1, borderBottomColor: "#DDE1E6", paddingHorizontal: 18, paddingVertical: 15, marginTop: 8 },
	tableHeadText: { color: "#303238", fontSize: 13, fontWeight: "800" },
	userNameCell: { width: 150 },
	userContactCell: { flex: 1, minWidth: 190 },
	userRoleCell: { width: 110 },
	userOnlineCell: { width: 150 },
	userDateCell: { width: 190 },
	userActionCell: { width: 150, flexDirection: "row", justifyContent: "flex-end", gap: 6 },
	listMain: { flex: 1, minWidth: 0 },
	listTitle: { color: "#252525", fontSize: 15, fontWeight: "700" },
	listDetail: { color: "#4F5155", fontSize: 13, marginTop: 5 },
	listMeta: { color: "#596579", fontSize: 12, lineHeight: 19, marginTop: 5, ...Platform.select({ web: { overflowWrap: "anywhere" } }) },
	editButton: { backgroundColor: "#F5EDEF", borderRadius: 8, paddingHorizontal: 15, paddingVertical: 9, marginLeft: 12 },
	editButtonText: { color: "#840B1C", fontWeight: "700" },
	deleteButton: { borderWidth: 1, borderColor: "#B42318", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9, marginLeft: 12 },
	deleteButtonText: { color: "#B42318", fontWeight: "700" },
	empty: { color: "#888", fontSize: 14, backgroundColor: "#fff", borderRadius: 12, padding: 24, textAlign: "center" },
	errorBanner: { color: "#B42318", backgroundColor: "#FEECEB", borderRadius: 8, padding: 12, marginBottom: 14 },
	modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
	modalCard: { width: "100%", maxWidth: 500, backgroundColor: "#fff", borderRadius: 16, padding: 24 },
	personnelModalScroll: { width: "100%", maxWidth: 540, maxHeight: "90%", borderRadius: 16 },
	modalTitle: { color: "#222", fontSize: 22, fontWeight: "800", marginBottom: 18 },
	fieldLabel: { color: "#444", fontSize: 13, fontWeight: "700", marginBottom: 6 },
	roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 22 },
	roleButton: { borderWidth: 1, borderColor: "#CCC", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
	roleButtonActive: { borderColor: "#840B1C", backgroundColor: "#840B1C" },
	roleButtonText: { color: "#555", fontWeight: "600" },
	roleButtonTextActive: { color: "#fff" },
	permissionGrid: { gap: 8, marginBottom: 18 },
	permissionItem: { borderWidth: 1, borderColor: "#D7D7D7", backgroundColor: "#F8F8F8", borderRadius: 9, paddingHorizontal: 13, paddingVertical: 11 },
	permissionItemActive: { borderColor: "#840B1C", backgroundColor: "#F5EDEF" },
	permissionText: { color: "#555", fontSize: 14 },
	permissionTextActive: { color: "#840B1C", fontWeight: "700" },
	statusButton: { backgroundColor: "#E8F5EE", borderRadius: 9, padding: 12, alignItems: "center", marginBottom: 18 },
	statusButtonInactive: { backgroundColor: "#FDECEC" },
	statusButtonText: { color: "#444", fontWeight: "700" },
	modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
	cancelButton: { borderWidth: 1, borderColor: "#CCC", borderRadius: 10, minHeight: 46, justifyContent: "center", paddingHorizontal: 18 },
	cancelButtonText: { color: "#555", fontWeight: "700" },
	saveButton: { minWidth: 120 },
});
