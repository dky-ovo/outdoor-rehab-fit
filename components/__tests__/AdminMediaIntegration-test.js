import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import AdminMediaField from "../AdminMediaField";
import AdminMediaLibrary from "../AdminMediaLibrary";
import { createAdminContent, getAdminContent, getAdminEquipment, getAdminMedia, getAdminMe, loginAccount, updateAdminEquipment } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api", () => ({ getAdminContent: jest.fn(), createAdminContent: jest.fn(), getAdminEquipment: jest.fn(), updateAdminEquipment: jest.fn(), getAdminMedia: jest.fn(), getAdminMe: jest.fn(), loginAccount: jest.fn(), resolveApiAssetUrl: (value) => value }));
let tree;
const label = (children) => Array.isArray(children) ? children.map(label).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const buttons = (title) => tree.root.findAllByType(TouchableOpacity).filter((node) => node.findAllByType(Text).some((text) => label(text.props.children) === title));
const press = async (title) => act(async () => buttons(title)[0].props.onPress());
async function login(permissions) {
	getAdminMe.mockResolvedValue({ user: { id: "admin" }, admin: { systemRole: "operator", permissions } });
	await act(async () => { tree = renderer.create(<AdminDashboard />); });
	await act(async () => {
		tree.root.findAllByType(TextInput).find((node) => node.props.placeholder === "手机号或电邮").props.onChangeText("test@example.test");
		tree.root.findAllByType(TextInput).find((node) => node.props.placeholder === "密码").props.onChangeText("password");
	});
	await press("登录后台");
}
beforeEach(() => {
	jest.resetAllMocks();
	loginAccount.mockResolvedValue({ token: "token", user: { id: "admin", name: "Test" } });
	getAdminContent.mockResolvedValue({ items: [] }); getAdminEquipment.mockResolvedValue({ items: [{ id: "0", youtubeKey: "X2cz6HW3J54", videoUrl: "/api/media/old/old.mp4", videoUrlZh: "", videoUrlEn: "", videoLocalesEnabled: false }] });
	getAdminMedia.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, categories: [] });
	createAdminContent.mockResolvedValue({}); updateAdminEquipment.mockResolvedValue({});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("file-storage-only operator can enter the independent sidebar without unrelated API requests", async () => {
	await login(["app_maintenance.files.manage"]);
	expect(tree.root.findAllByType(AdminMediaLibrary)).toHaveLength(1);
	expect(buttons("文件存储").length).toBeGreaterThan(0);
	expect(buttons("APP维护")).toHaveLength(0);
	expect(getAdminContent).not.toHaveBeenCalled(); expect(getAdminEquipment).not.toHaveBeenCalled();
	expect(getAdminMedia).toHaveBeenCalledTimes(1);
});

test("file storage white panel sizes to the explorer and footer without clipping or fixed height", async () => {
	await login(["app_maintenance.files.manage"]);
	const panel = tree.root.findByProps({ testID: "admin-files-panel" });
	const style = StyleSheet.flatten(panel.props.style);
	expect(style).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: "auto", minWidth: 0, width: "100%", backgroundColor: "#fff", padding: 20 });
	expect(style.height).toBeUndefined();
	expect(style.maxHeight).toBeUndefined();
	expect(style.overflow).not.toBe("hidden");
	expect(panel.findByType(AdminMediaLibrary)).toBeDefined();
});
test("home video uses upload/library control and saves selected URL through existing content API", async () => {
	await login(["app_maintenance.home.manage"]); await press("新增内容");
	const field = tree.root.findAllByType(AdminMediaField).find((node) => node.props.label === "首页视频");
	expect(field.props.kind).toBe("video");
	await act(async () => field.props.onChange("/api/media/new/demo.mp4"));
	await press("保存并发布");
	expect(createAdminContent).toHaveBeenCalledWith("token", expect.objectContaining({ contentType: "video", value: "/api/media/new/demo.mp4" }));
});
test("equipment exposes image, both GIFs and separate Chinese/English videos without cross-language overwrite", async () => {
	await login(["app_maintenance.equipment.manage"]); await press("编辑");
	await press("图片 / GIF / 视频");
	const fields = tree.root.findAllByType(AdminMediaField);
	expect(fields.map((node) => node.props.label)).toEqual(["器材图片", "左侧动作 GIF", "右侧动作 GIF", "中文设施教学视频", "英文设施教学视频"]);
	const field = fields[3];
	expect(field.props.value).toBe("");
	expect(field.props.legacyValue).toBe("/api/media/old/old.mp4");
	expect(fields[4].props.value).toBe("");
	expect(fields[4].props.legacyValue).toBe("/api/media/old/old.mp4");
	await act(async () => field.props.onChange("/api/media/new/replacement.mp4"));
	expect(tree.root.findAllByType(AdminMediaField)[4].props.value).toBe("");
	expect(tree.root.findAllByType(AdminMediaField)[4].props.legacyValue).toBe("");
	await press("保存并同步 APP");
	expect(updateAdminEquipment).toHaveBeenCalledWith("token", "0", expect.objectContaining({ videoUrl: "/api/media/old/old.mp4", videoUrlZh: "/api/media/new/replacement.mp4", videoUrlEn: "", youtubeKey: "X2cz6HW3J54" }));
});

test("a cleared localized language never displays the legacy shared source as a fallback", async () => {
	getAdminEquipment.mockResolvedValue({ items: [{ id: "0", youtubeKey: "X2cz6HW3J54", videoUrl: "/api/media/old/old.mp4", videoUrlZh: "/api/media/zh/zh.mp4", videoUrlEn: "", videoLocalesEnabled: true }] });
	await login(["app_maintenance.equipment.manage"]); await press("编辑");
	await press("图片 / GIF / 视频");
	const fields = tree.root.findAllByType(AdminMediaField);
	expect(fields[3].props.value).toBe("/api/media/zh/zh.mp4"); expect(fields[3].props.legacyValue).toBe("");
	expect(fields[4].props.value).toBe(""); expect(fields[4].props.legacyValue).toBe("");
	await act(async () => fields[3].props.onChange(""));
	expect(tree.root.findAllByType(AdminMediaField)[3].props.legacyValue).toBe("");
});
