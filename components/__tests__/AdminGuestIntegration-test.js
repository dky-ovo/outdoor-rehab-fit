import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import AdminRegistrationCodes from "../AdminRegistrationCodes";
import { getAdminGuestProfiles, getAdminMe, getAdminOverview, getAdminUsers, getAdminRegistrationCodes, exportAdminUsers, loginAccount } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-image-picker", () => ({}));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] }, en: { equipmentList: [] } } }));
jest.mock("../../utils/equipmentCatalog", () => ({ equipmentImageSource: jest.fn(() => null), mergeEquipmentCategories: (items = []) => items, equipmentCategoryLabel: (category,locale) => (locale === "en" ? category?.nameEn : category?.nameZh) || category?.id || "" }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api", () => ({
	getAdminGuestProfiles: jest.fn(),
	getAdminMe: jest.fn(),
	getAdminOverview: jest.fn(),
	getAdminUsers: jest.fn(),
	getAdminRegistrationCodes: jest.fn(),
	exportAdminUsers: jest.fn(),
	loginAccount: jest.fn(),
}));

let tree;
const labelText = (children) => Array.isArray(children) ? children.map(labelText).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const button = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => labelText(text.props.children) === label));
const tab = (id) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === id);
const hasText = (label) => tree.root.findAllByType(Text).some((node) => labelText(node.props.children) === label);
const login = async (permissions = ["users.read", "users.edit", "data.export"]) => {
	getAdminMe.mockResolvedValue({ user: { id: "admin-test" }, admin: { systemRole: "operator", permissions } });
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	const inputs = tree.root.findAllByType(TextInput);
	await act(async () => {
		inputs.find((input) => input.props.placeholder === "手机号或电邮").props.onChangeText("admin@example.test");
		inputs.find((input) => input.props.placeholder === "密码").props.onChangeText("test-password");
	});
	await act(async () => { await button("登录后台").props.onPress(); });
};

beforeEach(() => {
	jest.clearAllMocks();
	loginAccount.mockResolvedValue({ token: "test-admin-token", user: { id: "admin-test", name: "Test Admin" } });
	getAdminUsers.mockResolvedValue({ users: [{
		id: "registered-1", name: "Registered Test User", phone: "+85261234567", email: "registered@example.test",
		profileRole: "participant", createdAt: "2026-09-01T01:00:00.000Z", isOnline: false,
	}] });
	getAdminGuestProfiles.mockResolvedValue({
		guestProfiles: [{ id: "guest-1", age: 68, gender: "female", purpose: "personal", createdAt: "2026-09-08T01:00:00.000Z" }],
		total: 1, page: 1, pageSize: 20, totalPages: 1,
	});
	getAdminOverview.mockResolvedValue({ counts: { users: 1, researchEvents: 0, smsRequests: 0, smsVerified: 0, activeConsents: 0 }, roles: [], eventTypes: [] });
	getAdminRegistrationCodes.mockResolvedValue({ codes: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
});

afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("user management opens registered users first and loads guest information only when selected", async () => {
	await login();
	expect(loginAccount).toHaveBeenCalledWith("admin@example.test", "test-password");
	expect(getAdminUsers).toHaveBeenCalledTimes(1);
	expect(getAdminGuestProfiles).not.toHaveBeenCalled();
	expect(tab("admin-users-registered").props.accessibilityState.selected).toBe(true);
	expect(hasText("Registered Test User")).toBe(true);
	expect(button("新增用户")).toBeDefined();
	expect(button("导出 CSV")).toBeDefined();

	await act(async () => { tab("admin-users-guests").props.onPress(); });
	expect(tab("admin-users-guests").props.accessibilityState.selected).toBe(true);
	expect(getAdminGuestProfiles).toHaveBeenCalledTimes(1);
	expect(getAdminGuestProfiles).toHaveBeenCalledWith("test-admin-token", { page: 1, pageSize: 20, gender: "", purpose: "" });
	expect(hasText("记录编号：guest-1")).toBe(true);
	expect(hasText("Registered Test User")).toBe(false);
	expect(button("新增用户")).toBeUndefined();
	expect(button("导出 CSV")).toBeUndefined();
	expect(button("编辑")).toBeUndefined();
	expect(button("删除")).toBeUndefined();

	await act(async () => { tab("admin-users-registered").props.onPress(); });
	expect(tab("admin-users-registered").props.accessibilityState.selected).toBe(true);
	expect(hasText("Registered Test User")).toBe(true);
	expect(hasText("记录编号：guest-1")).toBe(false);
	expect(button("新增用户")).toBeDefined();
	expect(button("导出 CSV")).toBeDefined();
	expect(getAdminUsers).toHaveBeenCalledTimes(1);
	expect(getAdminGuestProfiles).toHaveBeenCalledTimes(1);
});

test("the dashboard refresh button reloads the active guest list without reloading registered users", async () => {
	await login();
	await act(async () => { tab("admin-users-guests").props.onPress(); });
	expect(getAdminGuestProfiles).toHaveBeenCalledTimes(1);
	getAdminGuestProfiles.mockResolvedValueOnce({
		guestProfiles: [{ id: "guest-refreshed", age: 72, gender: "male", purpose: "family", createdAt: "2026-09-08T02:00:00.000Z" }],
		total: 1, page: 1, pageSize: 20, totalPages: 1,
	});
	await act(async () => { await button("↻ 刷新").props.onPress(); });
	expect(getAdminGuestProfiles).toHaveBeenCalledTimes(2);
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("test-admin-token", { page: 1, pageSize: 20, gender: "", purpose: "" });
	expect(hasText("记录编号：guest-refreshed")).toBe(true);
	expect(hasText("记录编号：guest-1")).toBe(false);
	expect(getAdminUsers).toHaveBeenCalledTimes(1);
});

test("accounts without users.read have no user-management or guest information entry", async () => {
	await login(["dashboard.read"]);
	expect(getAdminOverview).toHaveBeenCalledWith("test-admin-token");
	expect(getAdminUsers).not.toHaveBeenCalled();
	expect(getAdminGuestProfiles).not.toHaveBeenCalled();
	expect(tab("admin-users-guests")).toBeUndefined();
	expect(tab("admin-users-registered")).toBeUndefined();
	expect(button("用户管理")).toBeUndefined();
	expect(button("访客资料")).toBeUndefined();
	await act(async () => { await button("↻ 刷新").props.onPress(); });
	expect(getAdminGuestProfiles).not.toHaveBeenCalled();
});

test("registered users paginate in groups of 20 and a changed search returns to the first page", async () => {
	const users = Array.from({ length: 41 }, (_, index) => ({ id: `user-${index}`, name: `Paged User ${index + 1}`, phone: `+8526123${String(index).padStart(4, "0")}`, profileRole: "participant", createdAt: "2026-09-01T01:00:00.000Z" }));
	getAdminUsers.mockImplementation(async (_token, search = "", { page = 1 } = {}) => ({ users: users.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: users.length, totalPages: 3, filters: { search } }));
	await login();
	expect(hasText("Paged User 1")).toBe(true); expect(hasText("Paged User 21")).toBe(false);
	await act(async () => tab("admin-users-pagination-next").props.onPress());
	expect(hasText("Paged User 1")).toBe(false); expect(hasText("Paged User 21")).toBe(true); expect(hasText("Paged User 41")).toBe(false);
	await act(async () => tab("admin-users-pagination-next").props.onPress());
	expect(hasText("Paged User 41")).toBe(true); expect(tab("admin-users-pagination-next").props.disabled).toBe(true);
	await act(async () => tree.root.findAllByType(TextInput).find((node) => node.props.placeholder === "搜索姓名、手机号或电邮").props.onChangeText("Paged"));
	await act(async () => button("搜索").props.onPress());
	expect(hasText("Paged User 1")).toBe(true); expect(tab("admin-users-pagination-previous").props.disabled).toBe(true);
});

test("CSV requests the full export endpoint and refuses incomplete server responses", async () => {
	await login();
	exportAdminUsers.mockResolvedValueOnce({ users: [], total: 300, recordCount: 200, complete: false });
	await act(async () => button("导出 CSV").props.onPress());
	expect(exportAdminUsers).toHaveBeenCalledWith("test-admin-token", "");
	expect(hasText("完整用户导出失败，请检查权限后重试；没有生成不完整文件。")).toBe(true);
	exportAdminUsers.mockRejectedValueOnce({ code: "userExportTooLarge" });
	await act(async () => button("导出 CSV").props.onPress());
	expect(hasText("符合条件的用户超过 50,000 条，请先缩小搜索范围再导出；没有生成不完整文件。")).toBe(true);
});

test("user registration opens from the function menu with explicit read/edit permissions", async () => {
	await login(["users.read"]);
	expect(getAdminRegistrationCodes).not.toHaveBeenCalled();
	await act(async () => tab("admin-menu-registration").props.onPress());
	expect(tree.root.findByType(AdminRegistrationCodes).props.canEdit).toBe(false);
	expect(getAdminRegistrationCodes).toHaveBeenCalledTimes(1);
	expect(tree.root.findByType(AdminRegistrationCodes).props.token).toBe("test-admin-token");
	await act(async () => button("↻ 刷新").props.onPress());
	expect(getAdminRegistrationCodes).toHaveBeenCalledTimes(2);
	expect(getAdminUsers).toHaveBeenCalledTimes(1);
	await act(async () => tab("admin-menu-registered").props.onPress());
	expect(hasText("Registered Test User")).toBe(true);
});
