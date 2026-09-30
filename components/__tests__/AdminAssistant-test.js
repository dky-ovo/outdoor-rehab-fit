import React from "react";
import renderer, { act } from "react-test-renderer";
import AdminAssistant from "../AdminAssistant";
import { previewAdminAssistant, sendAdminAssistant } from "../../utils/adminAssistantApi";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/adminAssistantApi", () => ({ previewAdminAssistant: jest.fn(), sendAdminAssistant: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
let tree;
const byId = id => tree.root.findByProps({ testID: id });
const previewResponse = () => ({ previewToken: "a".repeat(64), expiresAt: Date.now() + 60000, summary: { messageCharacters: 4, historyMessages: 0, documentCharacters: 0, writesAllowed: false, sensitiveDataAllowed: false, recipient: "DeepSeek" } });
const answer = { reply: "这是待审核的说明。", draft: "保持站姿稳定。", references: [{ id: "0", name: "太極揉推器", field: "details" }], draftOnly: true, published: false };
const mount = async props => act(async () => { tree = renderer.create(<AdminAssistant token="staff-token" {...props} />); });
const message = async (value = "整理教學") => act(async () => byId("admin-assistant-message").props.onChangeText(value));
const click = async id => act(async () => byId(id).props.onPress());

beforeEach(() => { jest.clearAllMocks(); previewAdminAssistant.mockResolvedValue(previewResponse()); sendAdminAssistant.mockResolvedValue(answer); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("no provider chat request happens before an explicit summary confirmation", async () => {
  await mount(); await message(); await click("admin-assistant-check");
  expect(previewAdminAssistant).toHaveBeenCalledTimes(1); expect(sendAdminAssistant).not.toHaveBeenCalled();
  expect(byId("admin-assistant-preview")).toBeTruthy();
  await click("admin-assistant-confirm");
  expect(sendAdminAssistant).toHaveBeenCalledWith("staff-token", expect.objectContaining({ message: "整理教學", locale: "zh" }), "a".repeat(64));
  expect(byId("admin-assistant-answer")).toBeTruthy(); expect(byId("admin-assistant-message").props.value).toBe("");
  expect(JSON.stringify(tree.toJSON())).toContain("尚未发布");
});

test("sensitive preview refusal preserves the input and never enables send", async () => {
  previewAdminAssistant.mockRejectedValueOnce({ status: 400, code: "adminAssistantSensitiveContent" });
  await mount(); await message("姓名：王小明"); await click("admin-assistant-check");
  expect(byId("admin-assistant-message").props.value).toBe("姓名：王小明");
  expect(byId("admin-assistant-error").props.children).toContain("敏感"); expect(sendAdminAssistant).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
});

test("failed completion retains question and requires a fresh preview rather than reusing approval", async () => {
  sendAdminAssistant.mockRejectedValueOnce({ status: 502 });
  await mount(); await message(); await click("admin-assistant-check"); await click("admin-assistant-confirm");
  expect(byId("admin-assistant-message").props.value).toBe("整理教學");
  expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
  await click("admin-assistant-check"); expect(previewAdminAssistant).toHaveBeenCalledTimes(2);
});

test("editing a question or imported document invalidates the earlier preview", async () => {
  await mount({ documentText: "已審核教學" }); await message(); await click("admin-assistant-check");
  await message("新的整理要求"); expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
  await click("admin-assistant-check");
  await act(async () => tree.update(<AdminAssistant token="staff-token" documentText="換一份教學" />));
  expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
  expect(sendAdminAssistant).not.toHaveBeenCalled();
});

test("rapid repeated confirmation sends once and successful history includes no account metadata", async () => {
  await mount({ account: { phone: "PRIVATE_PHONE" } }); await message(); await click("admin-assistant-check");
  await act(async () => { const send = byId("admin-assistant-confirm").props.onPress; await Promise.all([send(), send(), send()]); });
  expect(sendAdminAssistant).toHaveBeenCalledTimes(1);
  await message("繼續整理"); await click("admin-assistant-check");
  const body = previewAdminAssistant.mock.calls.at(-1)[1];
  expect(body.history).toEqual([{ role: "user", content: "整理教學" }, { role: "assistant", content: answer.reply }]);
  expect(JSON.stringify(body)).not.toContain("PRIVATE_PHONE");
});

test("account switching clears private draft/history and ignores the old account response", async () => {
  let resolve;
  previewAdminAssistant.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); await message();
  let operation; await act(async () => { operation = byId("admin-assistant-check").props.onPress(); });
  await act(async () => tree.update(<AdminAssistant token="other-token" />));
  await act(async () => { resolve(previewResponse()); await operation; });
  expect(byId("admin-assistant-message").props.value).toBe("");
  expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
});

test("expired confirmations cannot send and clearing a document never publishes it", async () => {
  previewAdminAssistant.mockResolvedValueOnce({ ...previewResponse(), expiresAt: Date.now() - 1 });
  const onClearDocument = jest.fn(); await mount({ documentText: "選取文件", onClearDocument, locale: "en" });
  await message(); await click("admin-assistant-check"); await click("admin-assistant-confirm");
  expect(sendAdminAssistant).not.toHaveBeenCalled(); expect(byId("admin-assistant-error").props.children).toContain("expired");
  await click("admin-assistant-remove-document"); expect(onClearDocument).toHaveBeenCalledTimes(1);
});

test("welcome shortcuts fill the composer without sending and teaching material is optional", async () => {
  await mount();
  expect(byId("admin-assistant-welcome")).toBeTruthy();
  expect(byId("admin-assistant-check").props.accessibilityLabel).toBe("检查并预览发送范围");
  expect(byId("admin-assistant-check").props.disabled).toBe(true);
  expect(tree.root.findAllByProps({ testID: "admin-assistant-document" })).toHaveLength(0);
  await click("admin-assistant-suggest-search");
  expect(byId("admin-assistant-message").props.value).toContain("太极揉推器");
  expect(byId("admin-assistant-check").props.disabled).toBe(false);
  expect(previewAdminAssistant).not.toHaveBeenCalled();
  expect(sendAdminAssistant).not.toHaveBeenCalled();
  await click("admin-assistant-suggest-document");
  expect(byId("admin-assistant-message").props.value).toContain("教学资料");
  expect(byId("admin-assistant-document").props.value).toBe("");
});

test("folding teaching material preserves it while removal invalidates a confirmed preview", async () => {
  await mount();
  await click("admin-assistant-toggle-document");
  await act(async () => byId("admin-assistant-document").props.onChangeText("公开教学资料"));
  await click("admin-assistant-hide-document");
  expect(byId("admin-assistant-toggle-document").props.accessibilityState.expanded).toBe(false);
  await message(); await click("admin-assistant-check");
  expect(previewAdminAssistant).toHaveBeenCalledWith("staff-token", expect.objectContaining({ documentText: "公开教学资料" }));
  await click("admin-assistant-toggle-document");
  expect(byId("admin-assistant-document").props.value).toBe("公开教学资料");
  await click("admin-assistant-remove-document");
  expect(tree.root.findAllByProps({ testID: "admin-assistant-confirm" })).toHaveLength(0);
  await click("admin-assistant-check");
  expect(previewAdminAssistant.mock.calls.at(-1)[1].documentText).toBe("");
  expect(sendAdminAssistant).not.toHaveBeenCalled();
});

test("clearing a conversation returns to the welcome screen and removes history from the next request", async () => {
  await mount(); await message(); await click("admin-assistant-check"); await click("admin-assistant-confirm");
  expect(tree.root.findAllByProps({ testID: "admin-assistant-welcome" })).toHaveLength(0);
  await click("admin-assistant-clear");
  expect(byId("admin-assistant-welcome")).toBeTruthy();
  expect(tree.root.findAllByProps({ testID: "admin-assistant-answer" })).toHaveLength(0);
  await message("重新整理"); await click("admin-assistant-check");
  expect(previewAdminAssistant.mock.calls.at(-1)[1].history).toEqual([]);
});

test("signing out clears local teaching material and disables preview", async () => {
  await mount(); await click("admin-assistant-toggle-document");
  await act(async () => byId("admin-assistant-document").props.onChangeText("公开教学资料"));
  await message();
  await act(async () => tree.update(<AdminAssistant token="" />));
  expect(byId("admin-assistant-message").props.value).toBe("");
  expect(byId("admin-assistant-check").props.disabled).toBe(true);
  await click("admin-assistant-toggle-document");
  expect(byId("admin-assistant-document").props.value).toBe("");
});
