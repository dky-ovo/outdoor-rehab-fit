import React from "react";
import renderer, { act } from "react-test-renderer";
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity } from "react-native";
import AdminAppTexts from "../AdminAppTexts";
import { getAdminAppTexts, updateAdminAppText } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/api", () => ({ getAdminAppTexts: jest.fn(), updateAdminAppText: jest.fn() }));
const ITEM = { key: "copy.test", group: "首页", label: "主页提示", zh: "默认中文", en: "Default English", defaultZh: "默认中文", defaultEn: "Default English", customZh: false, customEn: false, revision: 7, sources: ["APP 双语文字"] };
const RESULT = { items: [ITEM], groups: ["首页", "风险说明"], total: 41, page: 1, pageSize: 20, totalPages: 3 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let tree;
const words = children => Array.isArray(children) ? children.map(words).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const allText = () => tree.root.findAllByType(Text).map(node => words(node.props.children));
const button = label => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => words(text.props.children) === label));
const byId = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const input = language => tree.root.findAllByType(TextInput).find(node => node.props.testID === `app-text-${language}`);
const search = () => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === "搜索 APP 文字");
const press = async label => act(async () => button(label).props.onPress());
const edit = async () => act(async () => byId(`edit-text-${ITEM.key}`).props.onPress());
const change = async (language, value) => act(async () => input(language).props.onChangeText(value));
const modalVisible = () => tree.root.findByType(Modal).props.visible;
async function mount(props = {}, options) { await act(async () => { tree = renderer.create(<AdminAppTexts token="admin-one" {...props} />, options); }); }
beforeEach(() => { jest.resetAllMocks(); getAdminAppTexts.mockResolvedValue(RESULT); updateAdminAppText.mockResolvedValue({ item: { ...ITEM, revision: 8 } }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("list pagination and submitted search, section and modified filters reach the API", async () => {
  await mount();
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", { page: 1, search: "", group: "", modified: false });
  getAdminAppTexts.mockResolvedValueOnce({ ...RESULT, page: 2 });
  await act(async () => byId("admin-app-texts-pages-next").props.onPress());
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", expect.objectContaining({ page: 2 }));
  await act(async () => search().props.onChangeText("风险"));
  expect(getAdminAppTexts).toHaveBeenCalledTimes(2);
  await press("搜索");
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", expect.objectContaining({ page: 1, search: "风险" }));
  await press("风险说明");
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", expect.objectContaining({ group: "风险说明", search: "风险", page: 1 }));
  await press("只看已修改");
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", expect.objectContaining({ modified: true, page: 1 }));
  await press("清除筛选");
  expect(search().props.value).toBe("");
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-one", { page: 1, search: "", group: "", modified: false });
});

test("both languages save through the existing key and revision, then close and reload", async () => {
  await mount(); await edit();
  await change("zh", "新的中文"); await change("en", "New English");
  await press("保存并发布");
  expect(updateAdminAppText).toHaveBeenCalledWith("admin-one", "copy.test", { revision: 7, zh: "新的中文", en: "New English" });
  expect(modalVisible()).toBe(false);
  expect(getAdminAppTexts).toHaveBeenCalledTimes(2);
  expect(allText().some(text => text.startsWith("已保存。"))).toBe(true);
});

test("an unchanged language and restore-default action serialize as null, not an empty override", async () => {
  await mount(); await edit(); await change("zh", "单语修改");
  await press("保存并发布");
  expect(updateAdminAppText).toHaveBeenLastCalledWith("admin-one", "copy.test", { revision: 7, zh: "单语修改", en: null });
  getAdminAppTexts.mockResolvedValueOnce({ ...RESULT, items: [{ ...ITEM, zh: "定制中文", en: "Custom English", customZh: true, customEn: true }] });
  await press("刷新"); await edit(); await press("恢复默认（保存后生效）");
  expect(input("zh").props.value).toBe(ITEM.defaultZh);
  expect(input("en").props.value).toBe(ITEM.defaultEn);
  await press("保存并发布");
  expect(updateAdminAppText).toHaveBeenLastCalledWith("admin-one", "copy.test", { revision: 7, zh: null, en: null });
});

test("a language absent from the document has no input and remains null when saving", async () => {
  getAdminAppTexts.mockResolvedValue({ ...RESULT, items: [{ ...ITEM, en: null, defaultEn: null }] });
  await mount(); await edit();
  expect(input("en")).toBeUndefined();
  await change("zh", "繁體內容"); await press("保存并发布");
  expect(updateAdminAppText).toHaveBeenLastCalledWith("admin-one", "copy.test", { revision: 7, zh: "繁體內容", en: null });
});

test.each([[409, "其他管理员已修改"], [400, "请勿留空"], [500, "未能确认保存"]])("HTTP %s keeps the bilingual draft and displays a recoverable error", async (status, prefix) => {
  updateAdminAppText.mockRejectedValueOnce({ status });
  await mount(); await edit(); await change("zh", "未保存中文"); await change("en", "Unsaved English");
  await press("保存并发布");
  expect(modalVisible()).toBe(true);
  expect(input("zh").props.value).toBe("未保存中文");
  expect(input("en").props.value).toBe("Unsaved English");
  expect(allText().some(text => text.startsWith(prefix))).toBe(true);
  expect(getAdminAppTexts).toHaveBeenCalledTimes(1);
  expect(byId("app-text-save").props.disabled).toBe(false);
});

test("the synchronous save lock prevents double submission and closing while a save is pending", async () => {
  const pending = deferred(); updateAdminAppText.mockReturnValueOnce(pending.promise);
  await mount(); await edit(); await change("zh", "保存中的修改");
  const save = byId("app-text-save").props.onPress;
  await act(async () => { void save(); void save(); });
  expect(updateAdminAppText).toHaveBeenCalledTimes(1);
  expect(input("zh").props.editable).toBe(false);
  expect(byId("app-text-save").props.disabled).toBe(true);
  expect(button("取消").props.disabled).toBe(true);
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(modalVisible()).toBe(true);
  await act(async () => pending.resolve({ item: { ...ITEM, revision: 8 } }));
  expect(modalVisible()).toBe(false);
});

test("clean close is immediate and unsaved exit confirmation can continue editing or discard without saving", async () => {
  await mount(); await edit(); await press("取消");
  expect(modalVisible()).toBe(false);
  await edit(); await change("zh", "待保留草稿"); await press("取消");
  expect(modalVisible()).toBe(true);
  expect(allText()).toContain("有尚未保存的修改，确定放弃吗？");
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  await press("继续编辑");
  expect(input("zh").props.value).toBe("待保留草稿");
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  await press("放弃修改");
  expect(modalVisible()).toBe(false);
  expect(updateAdminAppText).not.toHaveBeenCalled();
});

test("a slower old query cannot replace the latest search results", async () => {
  const old = deferred(); getAdminAppTexts.mockReturnValueOnce(old.promise);
  await mount();
  getAdminAppTexts.mockResolvedValueOnce({ ...RESULT, items: [{ ...ITEM, label: "最新结果" }] });
  await act(async () => search().props.onChangeText("new"));
  await act(async () => search().props.onSubmitEditing());
  await act(async () => old.resolve({ ...RESULT, items: [{ ...ITEM, label: "过期结果" }] }));
  expect(allText()).toContain("最新结果");
  expect(allText()).not.toContain("过期结果");
});

test("changing account ignores old list responses and does not show another account's text manager state", async () => {
  const old = deferred(); getAdminAppTexts.mockReturnValueOnce(old.promise);
  await mount();
  getAdminAppTexts.mockResolvedValueOnce({ ...RESULT, items: [{ ...ITEM, label: "第二账号内容" }] });
  await act(async () => tree.update(<AdminAppTexts token="admin-two" />));
  await act(async () => old.resolve({ ...RESULT, items: [{ ...ITEM, label: "第一账号迟到结果" }] }));
  expect(getAdminAppTexts).toHaveBeenLastCalledWith("admin-two", expect.any(Object));
  expect(allText()).toContain("第二账号内容");
  expect(allText()).not.toContain("第一账号迟到结果");
});

test("changing account during save ignores its late result and cannot close the new account's draft", async () => {
  const oldSave = deferred(); updateAdminAppText.mockReturnValueOnce(oldSave.promise);
  await mount(); await edit(); await change("zh", "旧账号草稿");
  await act(async () => { void byId("app-text-save").props.onPress(); });
  await act(async () => tree.update(<AdminAppTexts token="admin-two" />));
  await edit(); await change("zh", "新账号草稿");
  await act(async () => oldSave.resolve({ item: { ...ITEM, zh: "旧账号结果", customZh: true } }));
  expect(modalVisible()).toBe(true);
  expect(input("zh").props.value).toBe("新账号草稿");
  expect(allText().some(text => text.startsWith("已保存。"))).toBe(false);
  expect(getAdminAppTexts).toHaveBeenCalledTimes(2);
});

test("failed or empty lists are explicit, and retry does not render stale records", async () => {
  getAdminAppTexts.mockRejectedValueOnce(new Error("network"));
  await mount();
  expect(allText()).toContain("文字列表暂时无法载入，请重试。");
  expect(byId(`edit-text-${ITEM.key}`)).toBeUndefined();
  getAdminAppTexts.mockResolvedValueOnce({ ...RESULT, items: [], total: 0 });
  await press("刷新");
  expect(allText()).toContain("没有符合筛选的文字。");
});

test("English administration wording does not alter the bilingual content payload", async () => {
  await mount({ locale: "en" });
  expect(allText()).toContain("APP text and descriptions");
  await edit(); await change("en", "English change"); await press("Save and publish");
  expect(updateAdminAppText).toHaveBeenCalledWith("admin-one", "copy.test", { revision: 7, zh: null, en: "English change" });
});

test("StrictMode effect replay still permits a completed list request to render", async () => {
  await act(async () => { tree = renderer.create(<React.StrictMode><AdminAppTexts token="admin-one" /></React.StrictMode>, { unstable_strictMode: true }); });
  expect(allText()).toContain(ITEM.label);
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
});
