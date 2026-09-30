import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import AdminRegistrationCodes from "../AdminRegistrationCodes";
import { createAdminRegistrationCode, getAdminRegistrationCodes, revokeAdminRegistrationCode } from "../../utils/api";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/api", () => ({ createAdminRegistrationCode: jest.fn(), getAdminRegistrationCodes: jest.fn(), revokeAdminRegistrationCode: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
const row = { id: "code-one", name: "Person One", phone: "+85261234567", profileRole: "participant", codeHint: "ABCD", status: "active", createdAt: "2026-09-10T00:00:00.000Z" };
const page = (extra = {}) => ({ codes: [row], total: 1, page: 1, pageSize: 20, totalPages: 1, ...extra });
let tree;
const text = () => tree.root.findAllByType(Text).flatMap((node) => React.Children.toArray(node.props.children)).filter((item) => typeof item === "string" || typeof item === "number").join(" ");
const button = (id) => tree.root.findAllByType(TouchableOpacity).find((item) => item.props.testID === id);
const press = async (id) => act(async () => { await button(id).props.onPress(); });
const change = async (id, value) => act(async () => { tree.root.findAllByType(TextInput).find((item) => item.props.testID === id).props.onChangeText(value); });
const mount = async (props = {}) => act(async () => { tree = renderer.create(<AdminRegistrationCodes token="token-one" canEdit {...props} />); });
beforeEach(() => { jest.resetAllMocks(); getAdminRegistrationCodes.mockResolvedValue(page()); createAdminRegistrationCode.mockResolvedValue({ code: "ABCDE-FGHJK-LMNPQ-RSTUV", invitation: row }); revokeAdminRegistrationCode.mockResolvedValue({ ok: true }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each([["zh-CN", "用户注册", "参与者"], ["zh-HK", "用戶註冊", "參與者"], ["en", "User registration", "Participant"]])("registration dashboard uses %s copy and defaults to 20 rows", async (locale, title, role) => {
  await mount({ locale });
  expect(text()).toContain(title); expect(text()).toContain(role);
  expect(getAdminRegistrationCodes).toHaveBeenCalledWith("token-one", { page: 1, pageSize: 20, status: "", search: "" });
  expect(button("registration-previous").props.disabled).toBe(true); expect(button("registration-next").props.disabled).toBe(true);
});

test.each(["ABCD-23EF", "ABCDE-FGHJK-LMNPQ-RSTUV"])("presents newly issued %s only after creation and binds the therapist role", async (code) => {
  createAdminRegistrationCode.mockResolvedValue({ code, invitation: row });
  await mount();
  expect(text()).not.toContain(code);
  await change("registration-name", "Therapist Name"); await change("registration-phone", "+85261234567");
  await press("registration-role-staff"); await press("registration-generate");
  expect(createAdminRegistrationCode).toHaveBeenCalledWith("token-one", { name: "Therapist Name", phone: "+85261234567", profileRole: "staff" });
  expect(text()).toContain(code); expect(text()).toContain("仅显示这一次");
});

test("empty form is rejected without calling the server", async () => {
  await mount(); await press("registration-generate");
  expect(createAdminRegistrationCode).not.toHaveBeenCalled(); expect(text()).toContain("有效手机号");
});

test("read-only users have no generation or revoke controls", async () => {
  await mount({ canEdit: false });
  expect(button("registration-generate")).toBeUndefined(); expect(button("registration-revoke-code-one")).toBeUndefined();
});

test("revocation requires confirmation and then refreshes the list", async () => {
  await mount(); await press("registration-revoke-code-one");
  expect(revokeAdminRegistrationCode).not.toHaveBeenCalled();
  const actions = showAlert.mock.calls[0][2];
  await act(async () => actions[1].onPress());
  expect(revokeAdminRegistrationCode).toHaveBeenCalledWith("token-one", "code-one");
  expect(getAdminRegistrationCodes).toHaveBeenCalledTimes(2);
});

test("pagination and search use server page controls and reset to page one", async () => {
  getAdminRegistrationCodes.mockResolvedValueOnce(page({ total: 42, totalPages: 3 })).mockResolvedValueOnce(page({ total: 42, totalPages: 3, page: 2 })).mockResolvedValue(page());
  await mount(); await press("registration-next");
  expect(getAdminRegistrationCodes).toHaveBeenLastCalledWith("token-one", { page: 2, pageSize: 20, status: "", search: "" });
  await change("registration-search", "61234567");
  expect(getAdminRegistrationCodes).toHaveBeenLastCalledWith("token-one", { page: 1, pageSize: 20, status: "", search: "61234567" });
  await press("registration-status-used");
  expect(getAdminRegistrationCodes).toHaveBeenLastCalledWith("token-one", { page: 1, pageSize: 20, status: "used", search: "61234567" });
});

test("slow responses from a previous filter cannot show stale users", async () => {
  let finish;
  getAdminRegistrationCodes.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue(page({ codes: [{ ...row, name: "Latest Person" }] }));
  await mount(); await press("registration-status-used");
  await act(async () => finish(page()));
  expect(text()).toContain("Latest Person"); expect(text()).not.toContain("Person One");
});

test("repeated fast presses issue only one code and late results cannot expose secrets to another account", async () => {
  let finish;
  createAdminRegistrationCode.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await mount(); await change("registration-name", "New Person"); await change("registration-phone", "61234567");
  const generate = button("registration-generate").props.onPress;
  let first;
  await act(async () => { first = generate(); generate(); });
  expect(createAdminRegistrationCode).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<AdminRegistrationCodes token="token-two" canEdit />));
  await act(async () => { finish({ code: "SECRET-OLD-CODE", invitation: row }); await first; });
  expect(text()).not.toContain("SECRET-OLD-CODE");
});

test("an old confirmation cannot revoke using a replaced account", async () => {
  await mount(); await press("registration-revoke-code-one");
  const oldConfirm = showAlert.mock.calls[0][2][1].onPress;
  await act(async () => tree.update(<AdminRegistrationCodes token="token-two" canEdit />));
  await act(async () => oldConfirm());
  expect(revokeAdminRegistrationCode).not.toHaveBeenCalled();
});

test("missing server deployment displays an explicit failure, not an empty list", async () => {
  getAdminRegistrationCodes.mockRejectedValueOnce({ status: 404 }); await mount();
  expect(text()).toContain("先部署"); expect(text()).not.toContain("暂无注册码");
});
