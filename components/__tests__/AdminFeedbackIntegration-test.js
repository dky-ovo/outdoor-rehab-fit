import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import AdminFeedback from "../AdminFeedback";
import { getAdminMe, getAdminOverview, getAdminPersonnel, loginAccount } from "../../utils/api";
import { getAdminFeedback } from "../../utils/feedbackApi";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-image-picker", () => ({}));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] }, en: { equipmentList: [] } } }));
jest.mock("../../utils/equipmentCatalog", () => ({ equipmentImageSource: jest.fn(() => null), mergeEquipmentCategories: (items = []) => items, equipmentCategoryLabel: () => "" }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api", () => ({ getAdminMe: jest.fn(), getAdminOverview: jest.fn(), getAdminPersonnel: jest.fn(), loginAccount: jest.fn() }));
jest.mock("../../utils/feedbackApi", () => ({ getAdminFeedback: jest.fn(), getAdminFeedbackDetail: jest.fn(), updateAdminFeedback: jest.fn() }));

let tree;
const labelText = children => Array.isArray(children) ? children.map(labelText).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const button = label => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => labelText(text.props.children) === label));
const login = async permissions => {
	getAdminMe.mockResolvedValue({ user: { id: "admin" }, admin: { systemRole: "admin", permissions } });
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	await act(async () => { await button("登录后台").props.onPress(); });
};
beforeEach(() => {
	jest.clearAllMocks();
	loginAccount.mockResolvedValue({ token: "test-admin-token", user: { id: "admin", name: "Test Admin" } });
	getAdminOverview.mockResolvedValue({ counts: { users: 0, researchEvents: 0, smsRequests: 0, smsVerified: 0, activeConsents: 0 }, roles: [], eventTypes: [] });
	getAdminPersonnel.mockResolvedValue({ personnel: [] });
	getAdminFeedback.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("feedback is a standalone menu, loaded on selection with a dedicated global refresh", async () => {
	await login(["dashboard.read", "feedback.read", "feedback.manage"]);
	expect(getAdminFeedback).not.toHaveBeenCalled();
	await act(async () => button("用户反馈").props.onPress());
	expect(getAdminFeedback).toHaveBeenCalledTimes(1);
	expect(tree.root.findByType(AdminFeedback).props.canManage).toBe(true);
	await act(async () => button("↻ 刷新").props.onPress());
	expect(getAdminFeedback).toHaveBeenCalledTimes(2);
	expect(getAdminOverview).toHaveBeenCalledTimes(1);
	await act(async () => button("繁").props.onPress());
	expect(tree.root.findByType(AdminFeedback).props.locale).toBe("zh-HK"); expect(button("用戶回饋")).toBeDefined();
	await act(async () => button("EN").props.onPress());
	expect(tree.root.findByType(AdminFeedback).props.locale).toBe("en"); expect(button("User Feedback")).toBeDefined();
	await act(async () => button("Overview").props.onPress());
	expect(tree.root.findAllByType(AdminFeedback)).toHaveLength(0);
	expect(getAdminOverview).toHaveBeenCalledTimes(1);
});

test.each([["dashboard.read"], ["dashboard.read", "feedback.manage"]])("without feedback.read menu and requests remain unavailable: %j", async (...permissions) => {
	await login(permissions);
	expect(button("用户反馈")).toBeUndefined(); expect(getAdminFeedback).not.toHaveBeenCalled();
	await act(async () => button("↻ 刷新").props.onPress());
	expect(getAdminFeedback).not.toHaveBeenCalled();
});

test("feedback-only read access opens the list but provides no manage permission", async () => {
	await login(["feedback.read"]);
	expect(tree.root.findByType(AdminFeedback).props.canManage).toBe(false);
	expect(getAdminFeedback).toHaveBeenCalledTimes(1);
	expect(getAdminOverview).not.toHaveBeenCalled();
});

test("feedback page grows around its records and pagination instead of using the row-card height", async () => {
	await login(["feedback.read"]);
	const panel = tree.root.findByProps({ testID: "admin-feedback-panel" });
	const style = StyleSheet.flatten(panel.props.style);
	expect(style).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: "auto", minWidth: 0, width: "100%", backgroundColor: "#fff", padding: 20 });
	expect(style.height).toBeUndefined();
	expect(style.maxHeight).toBeUndefined();
	expect(style.overflow).not.toBe("hidden");
	expect(panel.findByType(AdminFeedback)).toBeDefined();
	expect(panel.findAllByProps({ testID: "feedback-pagination" }).length).toBeGreaterThan(0);
});

test("personnel exposes both feedback permissions with localized labels", async () => {
	await login(["operators.manage"]);
	await act(async () => button("新增后台人员").props.onPress());
	expect(button("查看用户反馈")).toBeDefined(); expect(button("处理用户反馈")).toBeDefined();
	await act(async () => button("查看用户反馈").props.onPress());
	expect(button("✓ 查看用户反馈")).toBeDefined();
	await act(async () => button("EN").props.onPress());
	expect(button("✓ View user feedback")).toBeDefined(); expect(button("Manage user feedback")).toBeDefined();
	expect(getAdminFeedback).not.toHaveBeenCalled();
});
