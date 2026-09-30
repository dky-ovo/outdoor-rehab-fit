import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import AdminDashboard from "../../app/admin";
import { getAdminMe, getAdminEquipment, getAdminEquipmentCategories, getEquipmentCategories, loginAccount } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../constants/Equipments",() => ({ equipmentTranslations: { zh: { equipmentList: [] },en: { equipmentList: [] } } }));
jest.mock("../AdminMediaField",() => () => null);
jest.mock("../../utils/alert",() => ({ showAlert: jest.fn() }));
jest.mock("../../utils/api",() => ({ getAdminMe: jest.fn(),getAdminEquipment: jest.fn(),getAdminEquipmentCategories: jest.fn(),getEquipmentCategories: jest.fn(),loginAccount: jest.fn(),resolveApiAssetUrl: value => value }));
let tree;
const words=value => Array.isArray(value) ? value.map(words).join("") : typeof value === "string" ? value : "";
const button=label => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(item => words(item.props.children) === label));
const testButton=id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
beforeEach(() => {
	jest.clearAllMocks();
	loginAccount.mockResolvedValue({ token: "admin-token",user: { name: "Category Staff" } });
	getAdminMe.mockResolvedValue({ admin: { permissions: ["app_maintenance.equipment.manage"],systemRole: "operator" } });
	getAdminEquipment.mockResolvedValue({ items: [{ id: "custom-test",isCustom: true,isActive: true,nameZh: "測試器材",nameEn: "Test Machine",categories: ["muscle"],sortOrder: 1 }],categories: [] });
	const a={ id: "category-a",nameZh: "当前分类页",nameEn: "Current Page",isBuiltIn: false,sortOrder: 20 };
	const b={ id: "category-b",nameZh: "不在当前分类页",nameEn: "Not On Current Page",isBuiltIn: false,sortOrder: 21 };
	getAdminEquipmentCategories.mockResolvedValue({ categories: [a],page: 1,pageSize: 20,total: 21,totalPages: 2 });
	getEquipmentCategories.mockResolvedValue({ categories: [a,b] });
});
afterEach(async () => { if(tree) await act(async () => tree.unmount()); tree=null; });

test("refreshing the category manager reloads all picker options instead of replacing them with its current page",async () => {
	await act(async () => { tree=renderer.create(<AdminDashboard />); });
	await act(async () => { await button("登录后台").props.onPress(); });
	expect(getEquipmentCategories).not.toHaveBeenCalled();
	await act(async () => { testButton("equipment-categories-toggle").props.onPress(); });
	expect(getEquipmentCategories).toHaveBeenCalledTimes(1);
	await act(async () => { button("编辑").props.onPress(); });
	await act(async () => { testButton("equipment-editor-tab-basic").props.onPress(); });
	expect(button("不在当前分类页")).toBeDefined();
	expect(button("当前分类页")).toBeDefined();
	expect(tree.root.findAllByType(Text).some(node => words(node.props.children) === "✓ 肌肉強化")).toBe(true);
	await act(async () => {});
	expect(getEquipmentCategories).toHaveBeenCalledTimes(1);
	expect(getAdminEquipmentCategories).toHaveBeenCalledTimes(1);
});
