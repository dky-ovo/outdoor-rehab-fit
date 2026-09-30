import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AiChatbox from "../../app/(tabs)/chat";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import AssistantConversationHistory from "../AssistantConversationHistory";
import { ASSISTANT_CONVERSATIONS_PREFIX } from "../../utils/assistantConversations";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockRead = jest.fn(async () => {}), mockStop = jest.fn(async () => {});
jest.mock("../../hooks/useAssistantReplySpeech", () => ({ useAssistantReplySpeech: () => ({
  read: mockRead, stop: mockStop, autoRead: true, status: "idle", errorCode: null, isSupported: true,
  setAutoRead: jest.fn(),
}) }));
jest.mock("react-native", () => {
  const React = require("react");
  const native = jest.requireActual("react-native");
  const MockFlatList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }), []);
    return React.createElement("mock-conversation-list", props,
      ...(props.data || []).map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item }))));
  });
  return Object.defineProperty(Object.create(native), "FlatList", { value: MockFlatList, enumerable: true });
});
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => { const sendAssistantMessage = jest.fn(); return ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage, ...require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage), resolveApiAssetUrl: value => value }); });
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("../../utils/openExternalMap", () => ({ openExternalMap: jest.fn() }));

let tree, auth, storage;
const localeValue = { locale: "zh", i18n: { t: key => key === "equipmentList" ? [] : key } };
const user = (owner = "person-one", session = "session-one") => ({ user: { id: owner, token: "unchanged-token", assistantSessionId: session }, isUser: true, isGuest: false, isLoading: false });
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const messages = () => [...tree.root.findByType(FlatList).props.data].reverse().filter(item => item.id !== "welcome");
const input = () => tree.root.findByType(TextInput);
const button = id => tree.root.findAllByType(TouchableOpacity).find(item => item.props.testID === id);
const press = async id => act(async () => { await button(id).props.onPress(); });
const send = async text => {
  await act(async () => input().props.onChangeText(text));
  await act(async () => { void button("assistant-send").props.onPress(); });
};
const history = () => tree.root.findByType(AssistantConversationHistory).props;
const archive = owner => JSON.parse(storage.get(`${ASSISTANT_CONVERSATIONS_PREFIX}${owner}:zh`));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  jest.clearAllMocks();
  auth = user(); storage = new Map();
  AsyncStorage.getItem.mockReset().mockImplementation(async key => storage.get(key) ?? null);
  AsyncStorage.setItem.mockReset().mockImplementation(async (key, value) => { storage.set(key, value); });
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  sendAssistantMessage.mockReset().mockImplementation(async ({ message }) => ({ reply: `回答：${message}`, recommendations: [] }));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("legacy history is view-only, preserved on disk, and not sent to DeepSeek", async () => {
  const legacyKey = "@outdoor_fit_ai_history_v1:person-one:zh";
  const raw = JSON.stringify([{ id: "old-u", sender: "user", text: "舊私人問題" }, { id: "old-a", sender: "ai", reply: "舊回答" }]);
  storage.set(legacyKey, raw);
  await render();
  expect(messages()).toEqual([]);
  await press("assistant-conversation-history");
  expect(history().conversations).toHaveLength(1);
  expect(history().conversations[0].messages.map(item => item.text)).toEqual(["舊私人問題", "舊回答"]);
  expect(sendAssistantMessage).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
  await act(async () => history().onClose());
  await send("今天你好");
  expect(sendAssistantMessage.mock.calls[0][0].history).toEqual([]);
  expect(storage.get(legacyKey)).toBe(raw);
});

test("leaving the page within the same login restores current chat without auto-reading", async () => {
  await render(); await send("同一次登入");
  const saved = messages().map(item => item.text || item.reply);
  await act(async () => tree.unmount()); tree = null; mockRead.mockClear();
  await render();
  expect(messages().map(item => item.text || item.reply)).toEqual(saved);
  expect(mockRead).not.toHaveBeenCalled();
  await send("繼續這次對話");
  expect(sendAssistantMessage.mock.calls[1][0].history.map(item => item.content)).toEqual(saved);
});

test("logout then login as the same owner and token starts blank and keeps a read-only archive", async () => {
  await render(); await send("登出之前的問題");
  auth = { isUser: false, isGuest: false, isLoading: false, user: null }; await render();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  auth = user("person-one", "session-two"); await render();
  expect(messages()).toEqual([]);
  await press("assistant-conversation-history");
  const previous = history().conversations[0];
  expect(previous.messages.map(item => item.text)).toEqual(["登出之前的問題", "回答：登出之前的問題"]);
  const calls = sendAssistantMessage.mock.calls.length; const reads = mockRead.mock.calls.length;
  await press(`assistant-history-open-${previous.id}`);
  expect(sendAssistantMessage).toHaveBeenCalledTimes(calls); expect(mockRead).toHaveBeenCalledTimes(reads);
  await press("assistant-history-close");
  await send("全新問題");
  expect(sendAssistantMessage.mock.calls.at(-1)[0].history).toEqual([]);
});

test("new chat archives only this account and removes its old context without erasing history", async () => {
  await render(); await send("前一段問題");
  await press("assistant-new-conversation"); expect(messages()).toEqual([]);
  await press("assistant-conversation-history"); expect(history().conversations).toHaveLength(1);
  await act(async () => history().onClose());
  await send("另一段問題"); expect(sendAssistantMessage.mock.calls.at(-1)[0].history).toEqual([]);
  expect(archive("person-one").conversations.filter(item => item.messages.length)).toHaveLength(2);
});

test("switching accounts while history is open cannot expose the previous account's messages", async () => {
  await render(); await send("甲帳戶資料"); await press("assistant-new-conversation"); await press("assistant-conversation-history");
  auth = user("person-two", "session-two"); await render();
  expect(messages()).toEqual([]); expect(history().visible).toBe(false);
  await press("assistant-conversation-history"); expect(history().conversations).toEqual([]);
  await act(async () => history().onClose()); await send("乙帳戶問題");
  expect(sendAssistantMessage.mock.calls.at(-1)[0].history).toEqual([]);
  expect(JSON.stringify(archive("person-two"))).not.toContain("甲帳戶");
  expect(JSON.stringify(archive("person-one"))).toContain("甲帳戶");
});

test.each(["logout", "new-chat"])("a pending response after %s is archived without replacing or speaking in the new chat", async change => {
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render(); await send("延遲的問題");
  if (change === "logout") { auth = user("person-one", "next-login"); await render(); }
  else await press("assistant-new-conversation");
  mockRead.mockClear();
  await act(async () => request.resolve({ reply: "遲來舊回答", recommendations: [] }));
  expect(messages()).toEqual([]); expect(mockRead).not.toHaveBeenCalled();
  expect(JSON.stringify(archive("person-one"))).toContain("遲來舊回答");
  await send("新的問題"); expect(sendAssistantMessage.mock.calls.at(-1)[0].history).toEqual([]);
});

test("initial history load disables typing and send instead of dropping a new draft", async () => {
  const read = deferred(); AsyncStorage.getItem.mockReturnValueOnce(read.promise);
  await render(); expect(input().props.editable).toBe(false);
  expect(button("assistant-send").props.disabled).toBe(true);
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  await act(async () => read.resolve(null));
  expect(input().props.editable).toBe(true);
  await send("載入後的問題"); expect(sendAssistantMessage.mock.calls[0][0].message).toBe("載入後的問題");
});

test("late loading of another account cannot display or append its questions", async () => {
  const read = deferred(); AsyncStorage.getItem.mockReturnValueOnce(read.promise);
  await render(); auth = user("person-two", "second-login"); await render();
  await send("第二個帳戶");
  await act(async () => read.resolve(null));
  expect(messages().map(item => item.text || item.reply)).toEqual(["第二個帳戶", "回答：第二個帳戶"]);
  expect(history().conversations).toEqual([]);
});

test("corrupt saved history stays intact while temporary chat works with a save warning", async () => {
  const key = `${ASSISTANT_CONVERSATIONS_PREFIX}person-one:zh`; storage.set(key, "{corrupt");
  await render(); expect(messages()).toEqual([]); expect(button("assistant-new-conversation").props.disabled).toBe(true);
  expect(tree.root.findAll(item => item.props.testID === "assistant-history-save-error").length).toBeGreaterThan(0);
  await send("臨時問題"); expect(sendAssistantMessage.mock.calls[0][0].history).toEqual([]);
  expect(storage.get(key)).toBe("{corrupt");
  await press("assistant-new-conversation"); expect(messages()).toHaveLength(2);
  await press("assistant-conversation-history"); expect(history().error).toBeTruthy();
});

test("failed persistence cannot clear the current unsaved messages through New chat", async () => {
  await render(); const before = storage.get(`${ASSISTANT_CONVERSATIONS_PREFIX}person-one:zh`);
  AsyncStorage.setItem.mockRejectedValue(new Error("disk unavailable"));
  await send("不能丟失這段問題");
  expect(button("assistant-new-conversation").props.disabled).toBe(true);
  await press("assistant-new-conversation"); expect(messages()).toHaveLength(2);
  expect(storage.get(`${ASSISTANT_CONVERSATIONS_PREFIX}person-one:zh`)).toBe(before);
});

test("two New chat taps in the same frame create only one new conversation", async () => {
  await render(); await send("原對話");
  const action = button("assistant-new-conversation").props.onPress;
  await act(async () => { await Promise.all([action(), action()]); });
  expect(archive("person-one").conversations).toHaveLength(2);
});

test("deleting one archive preserves the current conversation, draft, and model context after reopening", async () => {
  await render(); await send("準備刪除的舊問題"); await press("assistant-new-conversation");
  await send("保留的現在問題");
  await act(async () => input().props.onChangeText("未發送的草稿"));
  await press("assistant-conversation-history");
  const id = history().conversations[0].id;
  const current = messages(); const calls = sendAssistantMessage.mock.calls.length;
  await act(async () => expect(await history().onDelete(id)).toBe(true));
  expect(history().conversations).toEqual([]); expect(messages()).toEqual(current);
  expect(input().props.value).toBe("未發送的草稿"); expect(sendAssistantMessage).toHaveBeenCalledTimes(calls);
  expect(archive("person-one").conversations.some(item => item.id === id)).toBe(false);
  await act(async () => history().onClose()); await press("assistant-conversation-history");
  expect(history().conversations).toEqual([]);
  await act(async () => history().onClose()); await send("下一個問題");
  expect(sendAssistantMessage.mock.calls.at(-1)[0].history.map(item => item.content)).toEqual(current.map(item => item.text || item.reply));
});

test("clear history keeps the current chat and other owners, and remains deleted after remount", async () => {
  await render(); await send("甲舊記錄一"); await press("assistant-new-conversation");
  await send("甲舊記錄二"); await press("assistant-new-conversation"); await send("甲當前記錄");
  const otherKey = `${ASSISTANT_CONVERSATIONS_PREFIX}person-two:zh`;
  storage.set(otherKey, "unrelated account bytes");
  await press("assistant-conversation-history"); expect(history().conversations).toHaveLength(2);
  const current = messages(); await act(async () => expect(await history().onClearAll()).toBe(true));
  expect(history().conversations).toEqual([]); expect(messages()).toEqual(current);
  expect(storage.get(otherKey)).toBe("unrelated account bytes");
  await act(async () => tree.unmount()); tree = null; await render();
  expect(messages()).toEqual(current); await press("assistant-conversation-history");
  expect(history().conversations).toEqual([]);
});

test("failed deletion leaves records intact and can be retried", async () => {
  await render(); await send("保護舊記錄"); await press("assistant-new-conversation");
  await press("assistant-conversation-history");
  const id = history().conversations[0].id;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error("storage unavailable"));
  await act(async () => expect(await history().onDelete(id)).toBe(false));
  expect(history().deleteError).toBeTruthy(); expect(history().conversations).toHaveLength(1);
  expect(archive("person-one").conversations.some(item => item.id === id)).toBe(true);
  await act(async () => expect(await history().onDelete(id)).toBe(true));
  expect(history().deleteError).toBeNull(); expect(history().conversations).toEqual([]);
});

test("a pending AI response during deletion is saved without resurrecting deleted history", async () => {
  await render(); await send("刪除舊問題"); await press("assistant-new-conversation");
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await send("等待新回答"); await press("assistant-conversation-history");
  const id = history().conversations[0].id;
  const gate = deferred(); const write = AsyncStorage.setItem.getMockImplementation();
  AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { await gate.promise; await write(key, value); });
  let deletion;
  await act(async () => { deletion = history().onDelete(id); });
  expect(history().deleting).toBe(true);
  const sameFrameDelete = history().onDelete;
  await act(async () => expect(await sameFrameDelete(id)).toBe(false));
  expect(button("assistant-new-conversation").props.disabled).toBe(true);
  await press("assistant-new-conversation");
  await act(async () => request.resolve({ reply: "刪除中到達的新回答", recommendations: [] }));
  await act(async () => { gate.resolve(); await deletion; });
  expect(history().conversations).toEqual([]); expect(history().deleting).toBe(false);
  const raw = JSON.stringify(archive("person-one"));
  expect(raw).toContain("刪除中到達的新回答"); expect(raw).not.toContain("刪除舊問題");
  expect(messages().map(item => item.text || item.reply)).toEqual(["等待新回答", "刪除中到達的新回答"]);
});

test("an old account's pending deletion cannot change the newly logged-in account", async () => {
  await render(); await send("甲記錄"); await press("assistant-new-conversation"); await press("assistant-conversation-history");
  const id = history().conversations[0].id;
  const gate = deferred(); const write = AsyncStorage.setItem.getMockImplementation();
  AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { await gate.promise; await write(key, value); });
  let deletion; await act(async () => { deletion = history().onDelete(id); });
  auth = user("person-two", "new-login"); await render(); await send("乙的新對話");
  await act(async () => { gate.resolve(); await deletion; });
  expect(messages().map(item => item.text || item.reply)).toEqual(["乙的新對話", "回答：乙的新對話"]);
  expect(history().visible).toBe(false); expect(history().deleting).toBe(false); expect(history().deleteError).toBeNull();
  expect(JSON.stringify(archive("person-two"))).not.toContain("甲記錄");
});

test("deleting history retries and recovers a failed current save without dropping messages", async () => {
  await render(); await send("舊記錄占用空間"); await press("assistant-new-conversation");
  AsyncStorage.setItem.mockRejectedValueOnce(Object.assign(new Error("full"), { code: "assistantHistoryFull" }));
  await send("不能丟失的新問題");
  expect(messages().some(item => item.text === "不能丟失的新問題")).toBe(true);
  await press("assistant-conversation-history");
  await act(async () => expect(await history().onClearAll()).toBe(true));
  expect(history().conversations).toEqual([]); expect(button("assistant-new-conversation").props.disabled).toBe(false);
  expect(JSON.stringify(archive("person-one"))).toContain("不能丟失的新問題");
  expect(tree.root.findAll(item => item.props.testID === "assistant-history-save-error")).toHaveLength(0);
});

test("deletion recovers a temporary chat after the initial load failed, preserving the draft and in-flight answer", async () => {
  await render(); await send("上一段資料"); await press("assistant-new-conversation");
  await act(async () => tree.unmount()); tree = null;
  auth = user("person-one", "next-login");
  AsyncStorage.setItem.mockRejectedValueOnce(Object.assign(new Error("full"), { code: "assistantHistoryFull" }));
  await render(); expect(button("assistant-new-conversation").props.disabled).toBe(true);
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await send("臨時對話中等待回答");
  await act(async () => input().props.onChangeText("臨時草稿"));
  await press("assistant-conversation-history");
  await act(async () => expect(await history().onClearAll()).toBe(true));
  expect(input().props.value).toBe("臨時草稿");
  await act(async () => request.resolve({ reply: "恢復後的回答", recommendations: [] }));
  expect(messages().map(item => item.text || item.reply)).toEqual(["臨時對話中等待回答", "恢復後的回答"]);
  expect(JSON.stringify(archive("person-one"))).toContain("恢復後的回答");
  expect(history().conversations).toEqual([]);
  await act(async () => history().onClose()); await press("assistant-conversation-history");
  expect(history().conversations).toEqual([]);
});

test("recovering from a transient initial read error archives the hidden active chat instead of overwriting it", async () => {
  await render(); await send("準備刪除的歷史"); await press("assistant-new-conversation");
  await send("讀取失敗前的現在對話");
  await act(async () => tree.unmount()); tree = null;
  AsyncStorage.getItem.mockRejectedValueOnce(new Error("temporary read failure"));
  await render(); await send("臨時的新對話");
  expect(sendAssistantMessage.mock.calls.at(-1)[0].history).toEqual([]);
  await press("assistant-conversation-history");
  await act(async () => expect(await history().onClearAll()).toBe(true));
  const persisted = archive("person-one");
  expect(persisted.conversations.some(item => item.archived && item.messages.some(message => message.text === "讀取失敗前的現在對話"))).toBe(true);
  expect(persisted.conversations.some(item => !item.archived && item.messages.some(message => message.text === "臨時的新對話"))).toBe(true);
  expect(JSON.stringify(persisted)).not.toContain("準備刪除的歷史");
  expect(messages().map(item => item.text || item.reply)).toEqual(["臨時的新對話", "回答：臨時的新對話"]);
  await act(async () => history().onClose()); await send("保持隔離");
  expect(sendAssistantMessage.mock.calls.at(-1)[0].history.map(item => item.content)).toEqual(["臨時的新對話", "回答：臨時的新對話"]);
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
