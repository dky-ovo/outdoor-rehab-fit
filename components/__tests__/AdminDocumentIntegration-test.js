import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import AdminAssistant from "../AdminAssistant";
import AdminEquipmentImport from "../AdminEquipmentImport";
import { getAdminMe, getAdminEquipment, getAdminOverview, getEquipmentCategories, loginAccount } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-image-picker", () => ({}));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] }, en: { equipmentList: [] } } }));
jest.mock("../../utils/equipmentCatalog", () => ({ equipmentImageSource: () => null, mergeEquipmentCategories: (items = []) => items, equipmentCategoryLabel: () => "" }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api", () => ({ getAdminMe: jest.fn(), getAdminEquipment: jest.fn(), getAdminOverview: jest.fn(), getEquipmentCategories: jest.fn(), loginAccount: jest.fn() }));
jest.mock("../AdminAssistant", () => jest.fn(() => null));
jest.mock("../AdminEquipmentImport", () => jest.fn(() => null));
jest.mock("../AdminEquipmentCategories", () => jest.fn(() => null));

let tree;
const labelText = value => Array.isArray(value) ? value.map(labelText).join("") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const button = label => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => labelText(text.props.children) === label));
const mount = async permissions => {
  getAdminMe.mockResolvedValue({ user: { id: "operator", name: "PRIVATE_USER_NAME", phone: "PRIVATE_PHONE" }, admin: { systemRole: "operator", permissions } });
  await act(async () => { tree = renderer.create(<AdminDashboard />); });
  await act(async () => button("登录后台").props.onPress());
};
beforeEach(() => {
  jest.clearAllMocks();
  loginAccount.mockResolvedValue({ token: "test-token", user: { id: "operator", name: "PRIVATE_USER_NAME" } });
  getAdminEquipment.mockResolvedValue({ items: [] }); getEquipmentCategories.mockResolvedValue({ categories: [] });
  getAdminOverview.mockResolvedValue({ counts: {}, roles: [], eventTypes: [] });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("AI-only operator opens standalone assistant without loading private admin data", async () => {
  await mount(["admin_assistant.use"]);
  expect(tree.root.findAllByType(AdminAssistant)).toHaveLength(1);
  expect(button("用户管理")).toBeUndefined(); expect(button("科研数据")).toBeUndefined();
  expect(getAdminEquipment).not.toHaveBeenCalled(); expect(getAdminOverview).not.toHaveBeenCalled();
  const props = tree.root.findByType(AdminAssistant).props;
  expect(props.user).toBeUndefined(); expect(props.permissions).toBeUndefined();
  expect(JSON.stringify(props)).not.toContain("PRIVATE_");
  await act(async () => button("EN").props.onPress());
  expect(tree.root.findByType(AdminAssistant).props.locale).toBe("en");
  expect(button("AI Assistant")).toBeDefined();
});

test("equipment-only operator can import but cannot forward drafts to DeepSeek", async () => {
  await mount(["app_maintenance.equipment.manage"]);
  expect(button("AI 助手")).toBeUndefined();
  expect(tree.root.findByType(AdminEquipmentImport).props.onAssistantDocument).toBeUndefined();
  expect(tree.root.findAllByType(AdminAssistant)).toHaveLength(0);
});

test("selected public teaching text can be reviewed in AI panel; metadata and old values stay out", async () => {
  await mount(["app_maintenance.equipment.manage", "admin_assistant.use"]);
  await act(async () => tree.root.findByType(AdminEquipmentImport).props.onAssistantDocument({ documentSha256: "ignored", fileName: "ignored", actorId: "PRIVATE_OWNER", entries: [{ code: "1", nameZh: "太極揉推器", nameEn: "Tai Chi Wheel", fields: [{ label: "使用方法", after: "雙腳站穩。", before: "PRIVATE_OLD_TEXT" }] }] }));
  const assistant = tree.root.findByType(AdminAssistant);
  expect(assistant.props.documentText).toContain("雙腳站穩。");
  expect(assistant.props.documentText).not.toContain("PRIVATE_");
  await act(async () => assistant.props.onDocumentChange("已审核的公开教学文字"));
  expect(tree.root.findByType(AdminAssistant).props.documentText).toBe("已审核的公开教学文字");
  await act(async () => button("退出").props.onPress());
  await act(async () => button("登录后台").props.onPress());
  await act(async () => button("AI 助手").props.onPress());
  expect(tree.root.findByType(AdminAssistant).props.documentText).toBe("");
});
