import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AdminFeedback from "../AdminFeedback";
import { getAdminFeedback, getAdminFeedbackDetail, updateAdminFeedback } from "../../utils/feedbackApi";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/feedbackApi", () => ({ getAdminFeedback: jest.fn(), getAdminFeedbackDetail: jest.fn(), updateAdminFeedback: jest.fn() }));

const row = { id: "feedback-1", name: "Test Visitor", email: "visitor@example.test", subject: "Exercise question", message: "Full feedback\n<script>alert('text only')</script>", status: "new", notes: "", isGuest: true, createdAt: "2026-09-18T01:00:00.000Z", updatedAt: "2026-09-18T01:00:00.000Z" };
const page = (items = [row], pagination = {}) => ({ items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...pagination } });
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
let tree;
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const input = id => tree.root.findAllByType(TextInput).find(node => node.props.testID === id);
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(" ");
const press = async id => act(async () => { await button(id).props.onPress(); });
const change = async (id, value) => act(async () => input(id).props.onChangeText(value));
const mount = async (props = {}) => act(async () => { tree = renderer.create(<AdminFeedback token="token-one" canManage {...props} />); });

beforeEach(() => {
	jest.resetAllMocks();
	getAdminFeedback.mockResolvedValue(page());
	getAdminFeedbackDetail.mockResolvedValue({ feedback: row });
	updateAdminFeedback.mockResolvedValue({ feedback: { ...row, status: "resolved", notes: "Checked", updatedAt: "2026-09-18T02:00:00.000Z" } });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("loads 20 records per page and resets to page one on search and status changes", async () => {
	getAdminFeedback.mockResolvedValueOnce(page([row], { total: 41, totalPages: 3 })).mockResolvedValueOnce(page([row], { page: 2, total: 41, totalPages: 3 })).mockResolvedValue(page());
	await mount();
	expect(getAdminFeedback).toHaveBeenCalledWith("token-one", { page: 1, pageSize: 20, search: "", status: "" });
	await press("feedback-pagination-next");
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-one", { page: 2, pageSize: 20, search: "", status: "" });
	await change("feedback-search", "  visitor@example.test  ");
	await press("feedback-search-submit");
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-one", { page: 1, pageSize: 20, search: "visitor@example.test", status: "" });
	await press("feedback-filter-resolved");
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-one", { page: 1, pageSize: 20, search: "visitor@example.test", status: "resolved" });
});

test("ignores late page responses after filters change", async () => {
	const old = deferred();
	getAdminFeedback.mockResolvedValueOnce(page([row], { total: 41, totalPages: 3 })).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([{ ...row, subject: "Latest filtered feedback" }]));
	await mount();
	await press("feedback-pagination-next");
	await press("feedback-filter-resolved");
	await act(async () => old.resolve(page([{ ...row, subject: "Stale page feedback" }], { page: 2 })));
	expect(text()).toContain("Latest filtered feedback");
	expect(text()).not.toContain("Stale page feedback");
});

test("opens complete plain-text detail and saves status, internal notes and expected version", async () => {
	await mount();
	await press("feedback-open-feedback-1");
	expect(getAdminFeedbackDetail).toHaveBeenCalledWith("token-one", "feedback-1");
	expect(text()).toContain("<script>alert('text only')</script>");
	expect(text()).toContain("访客");
	expect(tree.root.findAll(node => Boolean(node.props.dangerouslySetInnerHTML))).toHaveLength(0);
	await change("feedback-notes", "Checked");
	await press("feedback-status-resolved");
	await press("feedback-save");
	expect(updateAdminFeedback).toHaveBeenCalledWith("token-one", "feedback-1", { status: "resolved", notes: "Checked", expectedUpdatedAt: row.updatedAt });
	expect(text()).toContain("处理记录已保存");
	expect(getAdminFeedback).toHaveBeenCalledTimes(2);
});

test("read-only viewers can open detail but cannot edit or save", async () => {
	await mount({ canManage: false });
	await press("feedback-open-feedback-1");
	expect(input("feedback-notes")).toBeUndefined();
	expect(button("feedback-save")).toBeUndefined();
	expect(button("feedback-status-resolved")).toBeUndefined();
	expect(updateAdminFeedback).not.toHaveBeenCalled();
});

test("conflicts preserve draft and require loading latest version before a second save", async () => {
	updateAdminFeedback.mockRejectedValueOnce({ status: 409, code: "feedbackConflict" });
	await mount(); await press("feedback-open-feedback-1");
	await change("feedback-notes", "My unsaved investigation"); await press("feedback-status-in_progress");
	await press("feedback-save");
	expect(text()).toContain("其他人员已更新此反馈");
	expect(input("feedback-notes").props.value).toBe("My unsaved investigation");
	expect(button("feedback-save").props.disabled).toBe(true);
	await press("feedback-save");
	expect(updateAdminFeedback).toHaveBeenCalledTimes(1);
	const latest = { ...row, notes: "Another admin's note", status: "resolved", updatedAt: "2026-09-18T03:00:00.000Z" };
	getAdminFeedbackDetail.mockResolvedValueOnce({ feedback: latest });
	await press("feedback-reload-detail");
	expect(text()).toContain("Another admin's note");
	expect(input("feedback-notes").props.value).toBe("My unsaved investigation");
	expect(button("feedback-save").props.disabled).toBe(false);
	await press("feedback-save");
	expect(updateAdminFeedback).toHaveBeenLastCalledWith("token-one", row.id, { notes: "My unsaved investigation", status: "in_progress", expectedUpdatedAt: latest.updatedAt });
});

test("deduplicates saves and ignores their responses after switching accounts", async () => {
	const pending = deferred(); updateAdminFeedback.mockReturnValueOnce(pending.promise);
	await mount(); await press("feedback-open-feedback-1");
	const save = button("feedback-save").props.onPress;
	await act(async () => { save(); save(); });
	expect(updateAdminFeedback).toHaveBeenCalledTimes(1);
	await act(async () => tree.update(<AdminFeedback token="token-two" canManage />));
	expect(button("feedback-save")).toBeUndefined();
	await act(async () => pending.resolve({ feedback: { ...row, notes: "Old account private draft" } }));
	expect(text()).not.toContain("Old account private draft");
	expect(getAdminFeedback).toHaveBeenCalledTimes(2);
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-two", { page: 1, pageSize: 20, search: "", status: "" });
});

test("ignores old detail responses after close and old list responses after account change", async () => {
	const detailPending = deferred();
	getAdminFeedbackDetail.mockReturnValueOnce(detailPending.promise);
	await mount();
	await act(async () => { button("feedback-open-feedback-1").props.onPress(); });
	await press("feedback-close");
	await act(async () => detailPending.resolve({ feedback: { ...row, message: "Closed detail must stay closed" } }));
	expect(text()).not.toContain("Closed detail must stay closed");
	const listPending = deferred(); getAdminFeedback.mockReturnValueOnce(listPending.promise).mockResolvedValueOnce(page([{ ...row, subject: "Second account" }]));
	await press("feedback-refresh");
	await act(async () => tree.update(<AdminFeedback token="token-two" />));
	await act(async () => listPending.resolve(page([{ ...row, subject: "Old private record" }])));
	expect(text()).toContain("Second account"); expect(text()).not.toContain("Old private record");
});

test("errors expose retry, empty lists remain usable, and global refresh reloads", async () => {
	getAdminFeedback.mockRejectedValueOnce(new Error("Network failed")).mockResolvedValue(page([]));
	await mount(); expect(text()).toContain("反馈加载失败");
	await press("feedback-retry"); expect(text()).toContain("暂无符合条件的反馈");
	await act(async () => tree.update(<AdminFeedback token="token-one" canManage refreshKey={1} />));
	expect(getAdminFeedback).toHaveBeenCalledTimes(3);
});

test.each([[401, "无权查看"], [403, "无权查看"], [404, "暂不支持"]])("server status %s uses a localized actionable message", async (status, message) => {
	getAdminFeedback.mockRejectedValueOnce({ status }); await mount(); expect(text()).toContain(message);
});

test("failed detail load cannot save an unrefreshed record and retry retains notes", async () => {
	getAdminFeedbackDetail.mockRejectedValueOnce({ status: 500 });
	await mount(); await press("feedback-open-feedback-1");
	expect(button("feedback-save").props.disabled).toBe(true);
	await press("feedback-save"); expect(updateAdminFeedback).not.toHaveBeenCalled();
	await press("feedback-reload-detail"); expect(button("feedback-save").props.disabled).toBe(false);
});

test("save errors retain the draft and permission changes remove edit controls", async () => {
	updateAdminFeedback.mockRejectedValueOnce({ status: 500 });
	await mount(); await press("feedback-open-feedback-1"); await change("feedback-notes", "Still needed"); await press("feedback-save");
	expect(input("feedback-notes").props.value).toBe("Still needed"); expect(text()).toContain("保存失败");
	const staleSave = button("feedback-save").props.onPress;
	await act(async () => tree.update(<AdminFeedback token="token-one" canManage={false} />));
	await act(async () => staleSave());
	expect(button("feedback-save")).toBeUndefined(); expect(updateAdminFeedback).toHaveBeenCalledTimes(1);
});

test.each([["zh-CN", "用户反馈"], ["zh-HK", "用戶回饋"], ["en", "User Feedback"]])("supports %s", async (locale, title) => {
	await mount({ locale }); expect(text()).toContain(title);
	await press("feedback-open-feedback-1"); expect(input("feedback-notes").props.maxLength).toBe(2000);
});

test("missing token never requests data", async () => {
	await mount({ token: "" }); expect(getAdminFeedback).not.toHaveBeenCalled(); expect(text()).toContain("无权查看");
});

test("feedback keeps a natural-height white surface around all records and pagination", async () => {
	await mount();
	const workspace = tree.root.findAllByType(View).find(node => node.props.testID === "admin-feedback");
	const style = StyleSheet.flatten(workspace.props.style);
	expect(style).toMatchObject({ width: "100%", minWidth: 0, flexGrow: 0, flexShrink: 0, flexBasis: "auto", backgroundColor: "#FFF" });
	expect(style.height).toBeUndefined(); expect(style.maxHeight).toBeUndefined();
	expect(style.overflow).not.toBe("hidden");
	expect(workspace.findAllByProps({ testID: "feedback-record" })).not.toHaveLength(0);
	expect(workspace.findAllByProps({ testID: "feedback-pagination" })).not.toHaveLength(0);
});

test("narrow content columns stack search and cards without changing search, detail or pagination actions", async () => {
	getAdminFeedback.mockResolvedValue(page([row], { total: 21, totalPages: 2 }));
	await mount({ locale: "en" });
	const workspace = () => tree.root.findAllByType(View).find(node => node.props.testID === "admin-feedback");
	await act(async () => workspace().props.onLayout({ nativeEvent: { layout: { width: 260 } } }));
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "feedback-search-row" }).props.style)).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "feedback-record" }).props.style)).toMatchObject({ flexDirection: "column", alignItems: "stretch", minWidth: 0 });
	expect(StyleSheet.flatten(input("feedback-search").props.style)).toMatchObject({ width: "100%", minWidth: 0, flexBasis: "auto" });
	await change("feedback-search", "  exercise  "); await press("feedback-search-submit");
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-one", { page: 1, pageSize: 20, search: "exercise", status: "" });
	await press("feedback-pagination-next");
	expect(getAdminFeedback).toHaveBeenLastCalledWith("token-one", { page: 2, pageSize: 20, search: "exercise", status: "" });
	await press("feedback-open-feedback-1"); expect(text()).toContain(row.message);
	await press("feedback-close");
	await act(async () => workspace().props.onLayout({ nativeEvent: { layout: { width: 800 } } }));
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "feedback-search-row" }).props.style).flexDirection).toBe("row");
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "feedback-record" }).props.style).flexDirection).toBe("row");
});

test("long contact data stays separate from the name and buttons allow wrapped labels with full touch height", async () => {
	const email = `${"long-local-part".repeat(8)}@example.test`;
	getAdminFeedback.mockResolvedValue(page([{ ...row, email }]));
	await mount({ locale: "en" });
	const contact = tree.root.findAllByType(Text).find(node => node.props.children === email);
	expect(contact).toBeDefined(); expect(contact.props.numberOfLines).toBeUndefined();
	expect(StyleSheet.flatten(contact.props.style)).toMatchObject({ minWidth: 0, maxWidth: "100%" });
	const action = button("feedback-open-feedback-1");
	expect(action.props.accessibilityLabel).toBe("View details");
	expect(StyleSheet.flatten(action.props.style)).toMatchObject({ minHeight: 44, minWidth: 0, maxWidth: "100%" });
	expect(StyleSheet.flatten(action.findByType(Text).props.style)).toMatchObject({ textAlign: "center", flexShrink: 1, lineHeight: 20 });
});

test("zero or missing layout sizes do not reset a valid compact measurement", async () => {
	await mount();
	const layout = tree.root.findAllByType(View).find(node => node.props.testID === "admin-feedback").props.onLayout;
	await act(async () => layout({ nativeEvent: { layout: { width: 240 } } }));
	await act(async () => { layout({ nativeEvent: { layout: { width: 0 } } }); layout({ nativeEvent: {} }); });
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "feedback-record" }).props.style).flexDirection).toBe("column");
});
