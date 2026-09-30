import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import AdminEquipmentCategories from "../AdminEquipmentCategories";
import { createAdminEquipmentCategory, getAdminEquipmentCategories, updateAdminEquipmentCategory } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/api",() => ({ createAdminEquipmentCategory: jest.fn(),getAdminEquipmentCategories: jest.fn(),updateAdminEquipmentCategory: jest.fn() }));
const row = { id: "muscle",nameZh: "肌肉強化",nameEn: "Muscle Strengthening",isBuiltIn: true,equipmentCount: 5 };
let tree;
const button = id => tree.root.findAllByType(TouchableOpacity).find(item => item.props.testID === id);
const press = async id => act(async () => { await button(id).props.onPress(); });
const change = async (id,value) => act(async () => { tree.root.findAllByType(TextInput).find(item => item.props.testID === id).props.onChangeText(value); });
const text = () => tree.root.findAllByType(Text).flatMap(node => React.Children.toArray(node.props.children)).filter(item => typeof item === "string").join(" ");
const mount = async (props={}) => act(async () => { tree = renderer.create(<AdminEquipmentCategories token="token" canManage {...props} />); });
function deferred() { let resolve; const promise = new Promise(done => { resolve=done; }); return { promise,resolve }; }
beforeEach(() => {
	jest.resetAllMocks();
	getAdminEquipmentCategories.mockResolvedValue({ categories: [row],page: 1,pageSize: 20,total: 1,totalPages: 1 });
	createAdminEquipmentCategory.mockResolvedValue({ category: { id: "category-new",nameZh: "坐式練習",nameEn: "Seated Practice" } });
	updateAdminEquipmentCategory.mockResolvedValue({ category: { ...row,nameZh: "肌力練習" } });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree=null; });

test("classification management loads only when expanded and uses bounded pages",async () => {
	await mount(); expect(getAdminEquipmentCategories).not.toHaveBeenCalled();
	await press("equipment-categories-toggle");
	expect(getAdminEquipmentCategories).toHaveBeenCalledWith("token",{ page: 1,pageSize: 20,search: "" });
	expect(text()).toContain("肌肉強化"); expect(text()).toContain("不删除分类");
	expect(button("equipment-categories-pagination-next").props.disabled).toBe(true);
});

test("new bilingual names are trimmed and published to the parent picker immediately",async () => {
	const onChange=jest.fn(); await mount({ onChange }); await press("equipment-categories-toggle"); await press("equipment-category-add");
	await change("equipment-category-name-zh"," 坐式練習 "); await change("equipment-category-name-en"," Seated Practice "); await press("equipment-category-save");
	expect(createAdminEquipmentCategory).toHaveBeenCalledWith("token",{ nameZh: "坐式練習",nameEn: "Seated Practice" });
	expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "category-new" }));
	expect(button("equipment-category-save")).toBeUndefined();
});

test("rename sends only names and the immutable category ID",async () => {
	await mount(); await press("equipment-categories-toggle"); await press("equipment-category-edit-muscle");
	await change("equipment-category-name-zh","肌力練習"); await press("equipment-category-save");
	expect(updateAdminEquipmentCategory).toHaveBeenCalledWith("token","muscle",{ nameZh: "肌力練習",nameEn: "Muscle Strengthening",expectedNames: { nameZh: "肌肉強化",nameEn: "Muscle Strengthening" } });
});

test("empty names are blocked and duplicate errors keep the editable form",async () => {
	await mount(); await press("equipment-categories-toggle"); await press("equipment-category-add"); await press("equipment-category-save");
	expect(createAdminEquipmentCategory).not.toHaveBeenCalled(); expect(text()).toContain("请填写中文及英文");
	await change("equipment-category-name-zh","重複"); await change("equipment-category-name-en","Duplicate");
	createAdminEquipmentCategory.mockRejectedValue({ code: "equipmentCategoryNameConflict" }); await press("equipment-category-save");
	expect(text()).toContain("分类名称已存在"); expect(button("equipment-category-save")).toBeDefined();
});

test("permission removal hides management immediately and ignores late writes",async () => {
	const pending=deferred(), onChange=jest.fn(); createAdminEquipmentCategory.mockReturnValue(pending.promise);
	await mount({ onChange }); await press("equipment-categories-toggle"); await press("equipment-category-add");
	await change("equipment-category-name-zh","新類別"); await change("equipment-category-name-en","New Category");
	let saving; await act(async () => { saving=button("equipment-category-save").props.onPress(); });
	await act(async () => tree.update(<AdminEquipmentCategories token="token" canManage={false} onChange={onChange} />));
	expect(tree.toJSON()).toBeNull();
	await act(async () => { pending.resolve({ category: row }); await saving; }); expect(onChange).not.toHaveBeenCalled();
});

test("rapid repeated saves create only one category",async () => {
	const pending=deferred(); createAdminEquipmentCategory.mockReturnValue(pending.promise);
	await mount(); await press("equipment-categories-toggle"); await press("equipment-category-add");
	await change("equipment-category-name-zh","新類別"); await change("equipment-category-name-en","New Category");
	let saving; await act(async () => { const save=button("equipment-category-save").props.onPress; saving=save(); void save(); });
	expect(createAdminEquipmentCategory).toHaveBeenCalledTimes(1);
	await act(async () => { pending.resolve({ category: row }); await saving; });
});

test("the next-page control requests a new server page and search resets to page one",async () => {
	getAdminEquipmentCategories.mockResolvedValue({ categories: [row],page: 1,pageSize: 20,total: 23,totalPages: 2 });
	await mount(); await press("equipment-categories-toggle"); await press("equipment-categories-pagination-next");
	expect(getAdminEquipmentCategories).toHaveBeenLastCalledWith("token",{ page: 2,pageSize: 20,search: "" });
	await change("equipment-categories-search","肌力");
	expect(getAdminEquipmentCategories).toHaveBeenLastCalledWith("token",{ page: 1,pageSize: 20,search: "肌力" });
});

test("a stale editor preserves its draft, blocks replay, and requires reopening the refreshed category",async () => {
	await mount(); await press("equipment-categories-toggle"); await press("equipment-category-edit-muscle");
	await change("equipment-category-name-en","My English Name");
	updateAdminEquipmentCategory.mockRejectedValueOnce({ code: "equipmentCategoryChanged",status: 409 });
	await press("equipment-category-save");
	expect(text()).toContain("其他管理员已修改此分类");
	expect(button("equipment-category-save").props.disabled).toBe(true);
	expect(tree.root.findAllByType(TextInput).find(item => item.props.testID === "equipment-category-name-en").props.value).toBe("My English Name");
	await press("equipment-category-save"); expect(updateAdminEquipmentCategory).toHaveBeenCalledTimes(1);
	getAdminEquipmentCategories.mockResolvedValue({ categories: [{ ...row,nameZh: "其他管理员新中文" }],page: 1,pageSize: 20,total: 1,totalPages: 1 });
	await act(async () => { tree.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === "刷新分类").props.onPress(); });
	await press("equipment-category-edit-muscle");
	await change("equipment-category-name-en","Reviewed English Name"); await press("equipment-category-save");
	expect(updateAdminEquipmentCategory).toHaveBeenLastCalledWith("token","muscle",{ nameZh: "其他管理员新中文",nameEn: "Reviewed English Name",expectedNames: { nameZh: "其他管理员新中文",nameEn: row.nameEn } });
});

test("successful paged refresh triggers whole-catalog synchronization once without a render loop",async () => {
	const onCatalogRefresh=jest.fn(async () => {});
	getAdminEquipmentCategories.mockResolvedValue({ categories: [row],page: 1,pageSize: 20,total: 23,totalPages: 2 });
	await mount({ onCatalogRefresh }); await press("equipment-categories-toggle");
	expect(onCatalogRefresh).toHaveBeenCalledTimes(1); expect(onCatalogRefresh).toHaveBeenCalledWith();
	await press("equipment-categories-pagination-next");
	expect(onCatalogRefresh).toHaveBeenCalledTimes(2);
	await act(async () => tree.update(<AdminEquipmentCategories token="token" canManage onCatalogRefresh={onCatalogRefresh} locale="en" />));
	expect(onCatalogRefresh).toHaveBeenCalledTimes(2);
});
