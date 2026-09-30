import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import { getAdminResearchAnalytics, getAdminResearchEvents, getAdminMe, loginAccount } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] }, en: { equipmentList: [] } } }));
jest.mock("../../utils/equipmentCatalog", () => ({ equipmentImageSource: jest.fn(() => null), mergeEquipmentCategories: (items = []) => items, equipmentCategoryLabel: (category,locale) => (locale === "en" ? category?.nameEn : category?.nameZh) || category?.id || "" }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api", () => ({ getAdminMe: jest.fn(), loginAccount: jest.fn(), getAdminResearchAnalytics: jest.fn(), getAdminResearchEvents: jest.fn() }));
let tree;
const event = (id) => ({ id, eventName: "video.play", participantName: id, participantPhone: "+85261234567", eventTime: "2026-09-10T00:00:00.000Z", metadata: { screen: "outdoor.detail" } });
const initial = { events: [event("first-event")], summary: {}, filters: { eventName: "video.play" }, eventTypes: [], screens: [], daily: [], videos: [], participants: [], total: 345, page: 1, pageSize: 20, totalPages: 18 };
const text = (children) => Array.isArray(children) ? children.map(text).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const button = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((item) => text(item.props.children) === label));
const tab = (id) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === id);
beforeEach(() => { jest.clearAllMocks(); loginAccount.mockResolvedValue({ token: "token", user: { name: "Researcher" } }); getAdminMe.mockResolvedValue({ admin: { systemRole: "operator", permissions: ["research.read"] } }); getAdminResearchAnalytics.mockResolvedValue(initial); getAdminResearchEvents.mockResolvedValue({ ...initial, events: [event("page-two")], page: 2 }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
test("raw event paging sends the applied filters, not unapplied edited inputs, and reloads filter results on page one", async () => {
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	await act(async () => button("登录后台").props.onPress());
	expect(getAdminResearchEvents).not.toHaveBeenCalled();
	await act(async () => tree.root.findAllByType(TextInput).find((node) => node.props.placeholder === "例如 video.completed").props.onChangeText("video.completed"));
	await act(async () => tab("admin-research-events-pagination-next").props.onPress());
	expect(getAdminResearchEvents).toHaveBeenLastCalledWith("token", { eventName: "video.play", page: 2, pageSize: 20 });
	getAdminResearchAnalytics.mockResolvedValueOnce({ ...initial, events: [], total: 0, totalPages: 1, filters: { eventName: "video.completed" } });
	await act(async () => button("应用筛选").props.onPress());
	expect(getAdminResearchAnalytics).toHaveBeenLastCalledWith("token", expect.objectContaining({ eventName: "video.completed" }));
	expect(tab("admin-research-events-pagination-next").props.disabled).toBe(true);
	expect(tab("admin-research-events-pagination-previous").props.disabled).toBe(true);
});

test("research-only operators see current equipment and home video names, including descriptive missing states", async () => {
	const named = { contentId: "0", contentKind: "equipment", contentStatus: "current", contentNameZh: "后台当前太極名稱", contentNameEn: "Current Tai Chi name", started: 2, completed: 1 };
	getAdminResearchAnalytics.mockResolvedValue({ ...initial,
		videos: [named, { contentId: "1", contentKind: "equipment", contentStatus: "deleted", contentNameZh: "已移除测试器材", started: 1, completed: 1 }, { contentId: "9999", contentKind: "equipment", contentStatus: "unknown", started: 1, completed: 0 }, { contentId: "home-video-uuid", contentKind: "content", contentStatus: "current", contentNameZh: "首页目前的视频标题", started: 1, completed: 1 }],
		events: [{ ...event("named-event"), ...named, metadata: { screen: "outdoor.detail", contentId: "0", title: "旧标题" } }],
	});
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	await act(async () => button("登录后台").props.onPress());
	const rendered = tree.root.findAllByType(Text).map(node => text(node.props.children));
	expect(rendered).toContain("后台当前太極名稱");
	expect(rendered).toContain("已删除器材 · 已移除测试器材");
	expect(rendered).toContain("未知或已移除器材");
	expect(rendered).toContain("首页目前的视频标题");
	expect(rendered.some(line => line.startsWith("对象：后台当前太極名稱"))).toBe(true);
	expect(rendered).not.toContain("9999");
	expect(rendered).not.toContain("home-video-uuid");
	expect(button("APP维护")).toBeUndefined();
});
