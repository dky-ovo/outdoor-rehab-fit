import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import { getAdminMe, getAdminOverview, getAdminEquipment, getAdminContent, getAdminUsers, createAdminEquipment, updateAdminEquipment, updateAdminContent, updateAdminAppText, deleteAdminEquipment, loginAccount } from "../../utils/api";
import AdminContentToolbar from "../AdminContentToolbar";
import AdminEquipmentEditor from "../AdminEquipmentEditor";
import { getAdminWorkbenchCopy } from "../../constants/AdminWorkbench";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-image-picker", () => ({}));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] }, en: { equipmentList: [] } } }));
jest.mock("../../utils/equipmentCatalog", () => ({ equipmentImageSource: () => null, mergeEquipmentCategories: (items = []) => items, equipmentCategoryLabel: () => "" }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../AdminGuestProfiles", () => "GuestProfiles");
jest.mock("../AdminMediaLibrary", () => "MediaLibrary");
jest.mock("../AdminFeedback", () => "Feedback");
jest.mock("../AdminAppTexts", () => "AppTexts");
jest.mock("../../utils/api", () => ({ getAdminMe: jest.fn(), getAdminOverview: jest.fn(), getAdminEquipment: jest.fn(), getAdminContent: jest.fn(), getAdminUsers: jest.fn(), createAdminEquipment: jest.fn(), updateAdminEquipment: jest.fn(), updateAdminContent: jest.fn(), updateAdminAppText: jest.fn(), deleteAdminEquipment: jest.fn(), loginAccount: jest.fn() }));
let tree;
const label = children => Array.isArray(children) ? children.map(label).join("") : typeof children === "string" ? children : "";
const button = title => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => label(text.props.children) === title));
const press = async title => act(async () => button(title).props.onPress());
const pressId = async testID => act(async () => tree.root.findByProps({ testID }).props.onPress());
// Icon fonts render private-use glyphs through Text; they are not interface copy.
const copyTexts = node => node.findAllByType(Text).filter(item => !/^[\uE000-\uF8FF]+$/.test(label(item.props.children)));
const nodeText = node => copyTexts(node).map(item => label(item.props.children)).join("\n");
const SHORTCUT_KEYS = ["equipment", "home", "files", "feedback"];
const SHORTCUT_PERMISSIONS = ["dashboard.read", "app_maintenance.equipment.manage", "app_maintenance.home.manage", "app_maintenance.files.manage", "feedback.read", "app_maintenance.text.manage"];
const SHORTCUT_LOCALES = [
	["zh-CN", "内容管理快捷入口", "APP文字与说明"],
	["zh-HK", "內容管理快捷入口", "APP文字與說明"],
	["en", "Content management shortcuts", "APP Text & Instructions"],
];
async function login(permissions) {
	getAdminMe.mockResolvedValue({ admin: { systemRole: "operator", permissions } });
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	await press("登录后台");
}
beforeEach(() => {
	jest.clearAllMocks();
	loginAccount.mockResolvedValue({ token: "local-test-token", user: { name: "测试管理员" } });
	getAdminOverview.mockResolvedValue({ counts: {}, roles: [], eventTypes: [] });
	getAdminEquipment.mockResolvedValue({ items: [{ id: "test", isCustom: true, isActive: true, nameZh: "测试设施", categories: ["lower"], sortOrder: 0 }] });
	updateAdminEquipment.mockResolvedValue({});
	getAdminContent.mockResolvedValue({ items: [] });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
test("authorized modules remain navigable at the default narrow test viewport", async () => {
	await login(["dashboard.read", "app_maintenance.equipment.manage"]);
	const tab = tree.root.findByProps({ testID: "admin-tab-maintenance" });
	expect(StyleSheet.flatten(tab.parent.props.style)?.display).not.toBe("none");
	await act(async () => tab.props.onPress());
	expect(tree.root.findByType(AdminContentToolbar).props.placeholder).toContain("设施编号");
});
test("one failed content module does not misreport a valid login and can be retried", async () => {
	getAdminEquipment.mockRejectedValueOnce(new Error("temporary unavailable"));
	await login(["dashboard.read", "app_maintenance.equipment.manage"]);
	expect(button("退出")).toBeDefined();
	await act(async () => tree.root.findByProps({ testID: "admin-tab-maintenance" }).props.onPress());
	expect(tree.root.findByProps({ testID: "admin-module-load-error" })).toBeDefined();
	expect(button("添加设施")).toBeUndefined();
	await press("重试载入");
	expect(tree.root.findAllByProps({ testID: "admin-module-load-error" })).toHaveLength(0);
	expect(button("添加设施")).toBeDefined();
});
test("shortcuts never expose unauthorized modules", async () => {
	await login(["dashboard.read"]);
	expect(tree.root.findAllByProps({ testID: "admin-shortcut-equipment" })).toHaveLength(0);
	expect(tree.root.findAllByProps({ testID: "admin-tab-files" })).toHaveLength(0);
	expect(getAdminEquipment).not.toHaveBeenCalled();
});
test("an unauthorized session is still rejected", async () => {
	getAdminOverview.mockRejectedValueOnce({ status: 401 });
	await login(["dashboard.read"]);
	expect(button("登录后台")).toBeDefined();
	expect(button("退出")).toBeUndefined();
});
test("search and status filters work together without mutating data", async () => {
	await login(["app_maintenance.equipment.manage"]);
	await act(async () => tree.root.findByType(AdminContentToolbar).props.onChange({ search: "不存在", status: "all", sort: "order" }));
	expect(tree.root.findByType(AdminContentToolbar).props.count).toBe(0);
	await act(async () => tree.root.findByProps({ testID: "admin-equipment-filter-reset" }).props.onPress());
	expect(tree.root.findByType(AdminContentToolbar).props.count).toBe(1);
});
test("registered-user list failure does not block independently loaded guest records", async () => {
	getAdminUsers.mockRejectedValueOnce(new Error("unavailable"));
	await login(["users.read"]);
	expect(tree.root.findByProps({ testID: "admin-module-load-error" })).toBeDefined();
	await act(async () => tree.root.findByProps({ testID: "admin-menu-guests" }).props.onPress());
	expect(tree.root.findAllByProps({ testID: "admin-module-load-error" })).toHaveLength(0);
	expect(tree.root.findByType("GuestProfiles")).toBeDefined();
});
test("successful facility save followed by failed list refresh closes draft and does not invite duplicate creation", async () => {
	await login(["app_maintenance.equipment.manage"]);
	await press("编辑");
	getAdminEquipment.mockRejectedValueOnce(new Error("refresh unavailable"));
	await act(async () => tree.root.findByType(AdminEquipmentEditor).props.onSave());
	expect(updateAdminEquipment).toHaveBeenCalledTimes(1);
	expect(tree.root.findByType(AdminEquipmentEditor).props.value).toBeNull();
	expect(tree.root.findByProps({ testID: "admin-module-load-error" })).toBeDefined();
	expect(tree.root.findAllByType(Text).some(node => label(node.props.children).includes("不要重复新增"))).toBe(true);
});

test.each(SHORTCUT_LOCALES)("%s switches the workbench heading, hint and every authorized shortcut", async (locale, title) => {
	await login(SHORTCUT_PERMISSIONS);
	await pressId(`admin-language-${locale}`);
	const copy = getAdminWorkbenchCopy(locale);
	const workbench = tree.root.findByProps({ testID: "admin-content-shortcuts" });
	expect(nodeText(workbench)).toContain(title);
	expect(nodeText(workbench)).toContain(copy.hint);
	for (const key of SHORTCUT_KEYS) {
		const shortcut = tree.root.findByProps({ testID: `admin-shortcut-${key}` });
		expect(nodeText(shortcut)).toBe(`${copy.shortcuts[key].label}\n${copy.shortcuts[key].hint}\n›`);
		for (const text of copyTexts(shortcut)) expect(text.props.numberOfLines).toBeUndefined();
	}
	expect(tree.root.findByProps({ testID: `admin-language-${locale}` }).props.accessibilityState).toMatchObject({ selected: true });
	if (locale === "en") expect(nodeText(workbench)).not.toMatch(/[\u3400-\u9fff]/);
});

test("language switching is reversible, preserves authorized entry points and never saves or reloads data", async () => {
	await login(SHORTCUT_PERMISSIONS);
	const before = {
		me: getAdminMe.mock.calls.length,
		overview: getAdminOverview.mock.calls.length,
		equipment: getAdminEquipment.mock.calls.length,
		content: getAdminContent.mock.calls.length,
	};
	const snapshot = () => nodeText(tree.root.findByProps({ testID: "admin-content-shortcuts" }));
	const initial = snapshot();
	for (const locale of ["en", "zh-HK", "zh-CN", "en", "zh-CN"]) {
		await pressId(`admin-language-${locale}`);
		expect(tree.root.findAllByType(TouchableOpacity).filter(node => SHORTCUT_KEYS.some(key => node.props.testID === `admin-shortcut-${key}`))).toHaveLength(4);
		expect(tree.root.findByProps({ testID: "admin-tab-overview" }).props.accessibilityState).toMatchObject({ selected: true });
	}
	expect(snapshot()).toBe(initial);
	expect(getAdminMe).toHaveBeenCalledTimes(before.me);
	expect(getAdminOverview).toHaveBeenCalledTimes(before.overview);
	expect(getAdminEquipment).toHaveBeenCalledTimes(before.equipment);
	expect(getAdminContent).toHaveBeenCalledTimes(before.content);
	for (const mutate of [updateAdminEquipment, updateAdminContent, updateAdminAppText, deleteAdminEquipment]) expect(mutate).not.toHaveBeenCalled();
});

test("switching language preserves an unsaved facility editor draft without creating or updating equipment", async () => {
	await login(["app_maintenance.equipment.manage"]);
	await press("编辑");
	const original = tree.root.findByType(AdminEquipmentEditor).props.value;
	const draft = { ...original, nameZh: "尚未保存的设施名称", nameEn: "Unsaved facility name", categories: ["lower", "balance"], sortOrder: 8 };
	await act(async () => tree.root.findByType(AdminEquipmentEditor).props.onChange(draft));
	await pressId("admin-language-en");
	const editor = tree.root.findByType(AdminEquipmentEditor);
	expect(editor.props.locale).toBe("en");
	expect(editor.props.value).toBe(draft);
	expect(editor.props.value).toMatchObject({ id: "test", nameZh: "尚未保存的设施名称", nameEn: "Unsaved facility name", categories: ["lower", "balance"], sortOrder: 8 });
	expect(createAdminEquipment).not.toHaveBeenCalled();
	expect(updateAdminEquipment).not.toHaveBeenCalled();
	expect(getAdminEquipment).toHaveBeenCalledTimes(1);
});

test.each(SHORTCUT_LOCALES)("%s keeps shortcut destinations unchanged and forwards the selected locale", async (locale) => {
	await login(SHORTCUT_PERMISSIONS);
	await pressId(`admin-language-${locale}`);
	for (const key of SHORTCUT_KEYS) {
		await pressId(`admin-shortcut-${key}`);
		const tab = ["equipment", "home"].includes(key) ? "maintenance" : key;
		expect(tree.root.findByProps({ testID: `admin-tab-${tab}` }).props.accessibilityState).toMatchObject({ selected: true });
		if (key === "equipment" || key === "home") {
			const toolbar = tree.root.findByType(AdminContentToolbar);
			expect(toolbar.props.testID).toBe(key === "equipment" ? "admin-equipment-filter" : "admin-home-filter");
			expect(toolbar.props.locale).toBe(locale);
		} else if (key === "files") {
			expect(tree.root.findByType("MediaLibrary").props.token).toBe("local-test-token");
			expect(tree.root.findByType("MediaLibrary").props.permissions).toEqual(SHORTCUT_PERMISSIONS);
		} else {
			expect(tree.root.findByType("Feedback").props.locale).toBe(locale);
		}
		await pressId("admin-tab-overview");
	}
	expect(updateAdminEquipment).not.toHaveBeenCalled();
	expect(updateAdminContent).not.toHaveBeenCalled();
});

test.each(SHORTCUT_LOCALES)("%s translates the APP text sidebar and breadcrumb without changing its destination", async (locale, _title, textsLabel) => {
	await login(["app_maintenance.text.manage"]);
	await pressId(`admin-language-${locale}`);
	const menu = tree.root.findByProps({ testID: "admin-menu-texts" });
	expect(nodeText(menu)).toBe(textsLabel);
	expect(tree.root.findAllByType(Text).filter(node => label(node.props.children) === textsLabel)).toHaveLength(2);
	expect(tree.root.findByType("AppTexts").props.locale).toBe(locale);
	expect(tree.root.findByType("AppTexts").props.token).toBe("local-test-token");
	expect(tree.root.findAllByProps({ testID: "admin-shortcut-equipment" })).toHaveLength(0);
	expect(updateAdminAppText).not.toHaveBeenCalled();
});

test("language changes never reveal shortcuts outside the operator's permission set", async () => {
	await login(["dashboard.read", "feedback.read"]);
	for (const locale of ["en", "zh-HK", "zh-CN"]) {
		await pressId(`admin-language-${locale}`);
		expect(tree.root.findByProps({ testID: "admin-shortcut-feedback" })).toBeDefined();
		for (const key of ["equipment", "home", "files"]) expect(tree.root.findAllByProps({ testID: `admin-shortcut-${key}` })).toHaveLength(0);
		expect(tree.root.findAllByProps({ testID: "admin-tab-maintenance" })).toHaveLength(0);
		expect(tree.root.findAllByProps({ testID: "admin-tab-files" })).toHaveLength(0);
	}
	expect(getAdminEquipment).not.toHaveBeenCalled();
	expect(getAdminContent).not.toHaveBeenCalled();
});

test("workbench dictionaries cover the same four modules and default safely to Simplified Chinese", () => {
	for (const [locale, title, textsLabel] of SHORTCUT_LOCALES) {
		const copy = getAdminWorkbenchCopy(locale);
		expect(copy.title).toBe(title);
		expect(copy.textsLabel).toBe(textsLabel);
		expect(copy.hint.trim().length).toBeGreaterThan(10);
		expect(Object.keys(copy.shortcuts)).toEqual(SHORTCUT_KEYS);
		for (const key of SHORTCUT_KEYS) {
			expect(copy.shortcuts[key].label.trim().length).toBeGreaterThan(2);
			expect(copy.shortcuts[key].hint.trim().length).toBeGreaterThan(5);
		}
	}
	expect(getAdminWorkbenchCopy()).toEqual(getAdminWorkbenchCopy("zh-CN"));
	expect(getAdminWorkbenchCopy("unsupported")).toEqual(getAdminWorkbenchCopy("zh-CN"));
});
