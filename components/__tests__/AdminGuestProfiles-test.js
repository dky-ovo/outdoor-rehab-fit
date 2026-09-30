import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import AdminGuestProfiles from "../AdminGuestProfiles";
import { getAdminGuestProfiles } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/api", () => ({ getAdminGuestProfiles: jest.fn() }));

const profile = { id: "guest-record-1", age: 68, gender: "female", purpose: "family", createdAt: "2026-09-08T00:00:00.000Z" };
const page = (items = [profile], extra = {}) => ({ guestProfiles: items, total: items.length, page: 1, pageSize: 20, totalPages: items.length ? 1 : 0, ...extra });
let tree;
const text = () => tree.root.findAllByType(Text).flatMap((node) => React.Children.toArray(node.props.children)).filter((item) => typeof item === "string" || typeof item === "number").join(" ");
const button = (testID) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === testID);
const press = async (testID) => { await act(async () => { button(testID).props.onPress(); }); };
const mount = async (props = {}) => { await act(async () => { tree = renderer.create(<AdminGuestProfiles token="admin-token" {...props} />); }); };

beforeEach(() => { jest.resetAllMocks(); getAdminGuestProfiles.mockResolvedValue(page()); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each([["zh-CN", "访客资料", "家庭照顾者"], ["zh-HK", "訪客資料", "家庭照顧者"], ["en", "Guest information", "Family caregiver"]])("renders collected fields using %s labels", async (locale, title, purpose) => {
	await mount({ locale });
	expect(getAdminGuestProfiles).toHaveBeenCalledWith("admin-token", { page: 1, pageSize: 20, gender: "", purpose: "" });
	expect(text()).toContain(title);
	expect(text()).toContain(purpose);
	expect(text()).toContain("68");
	expect(text()).toContain(profile.id);
	expect(text()).toContain("08:00");
	expect(button("guest-previous").props.disabled).toBe(true);
	expect(button("guest-next").props.disabled).toBe(true);
});

test("filters reset pagination and clear filters restores all submissions", async () => {
	getAdminGuestProfiles.mockResolvedValue(page([profile], { total: 41, totalPages: 3 }));
	await mount();
	await press("guest-next");
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("admin-token", { page: 2, pageSize: 20, gender: "", purpose: "" });
	await press("guest-gender-male");
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("admin-token", { page: 1, pageSize: 20, gender: "male", purpose: "" });
	await press("guest-purpose-industry");
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("admin-token", { page: 1, pageSize: 20, gender: "male", purpose: "industry" });
	await press("guest-reset");
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("admin-token", { page: 1, pageSize: 20, gender: "", purpose: "" });
});

test("a slow previous filter response cannot replace the latest result", async () => {
	let resolveOld;
	getAdminGuestProfiles.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(page([{ ...profile, id: "latest-filter" }]));
	await mount();
	await press("guest-gender-male");
	await act(async () => resolveOld(page([{ ...profile, id: "old-filter" }])));
	expect(text()).toContain("latest-filter");
	expect(text()).not.toContain("old-filter");
});

test("changing tokens hides previous account data and ignores late responses", async () => {
	let resolveOld;
	getAdminGuestProfiles.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(page([{ ...profile, id: "new-account-data" }]));
	await mount();
	await act(async () => tree.update(<AdminGuestProfiles token="different-admin" />));
	await act(async () => resolveOld(page([{ ...profile, id: "old-account-data" }])));
	expect(text()).toContain("new-account-data");
	expect(text()).not.toContain("old-account-data");
});

test.each([[0, "读取失败"], [403, "无权查看"], [404, "先部署"]])("status %s displays an error instead of pretending there are no records", async (status, label) => {
	getAdminGuestProfiles.mockRejectedValueOnce({ status });
	await mount();
	expect(text()).toContain(label);
	expect(text()).not.toContain("暂无符合条件");
	expect(text()).not.toContain("符合条件的提交记录");
	await press("guest-refresh");
	expect(text()).toContain(profile.id);
});

test("empty results show a genuine empty state with both page controls disabled", async () => {
	getAdminGuestProfiles.mockResolvedValue(page([]));
	await mount();
	expect(text()).toContain("暂无符合条件");
	expect(button("guest-previous").props.disabled).toBe(true);
	expect(button("guest-next").props.disabled).toBe(true);
});

test("dashboard refresh reloads the current filters and discards visible stale rows while loading", async () => {
	await mount();
	await press("guest-purpose-family");
	let finish;
	getAdminGuestProfiles.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
	await act(async () => tree.update(<AdminGuestProfiles token="admin-token" refreshKey={1} />));
	expect(text()).not.toContain(profile.id);
	expect(text()).toContain("正在读取");
	await act(async () => finish(page([{ ...profile, id: "new-submission" }])));
	expect(getAdminGuestProfiles).toHaveBeenLastCalledWith("admin-token", { page: 1, pageSize: 20, gender: "", purpose: "family" });
	expect(text()).toContain("new-submission");
});

test("without an admin token there is no anonymous list request", async () => {
	await mount({ token: "" });
	expect(getAdminGuestProfiles).not.toHaveBeenCalled();
	expect(text()).toContain("无权查看");
});

test("unmounting cancels pending state writes", async () => {
	let finish;
	getAdminGuestProfiles.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
	await mount();
	await act(async () => tree.unmount()); tree = null;
	await act(async () => finish(page()));
	expect(getAdminGuestProfiles).toHaveBeenCalledTimes(1);
});
