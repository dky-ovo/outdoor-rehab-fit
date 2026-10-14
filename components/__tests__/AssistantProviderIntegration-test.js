import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, FlatList, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AiChatbox from "../../app/(tabs)/chat";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { createAssistantJob, getAssistantRuntime, getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { localEquipmentAnswer } from "../../utils/assistantEquipmentSearch";
import AssistantConversationHistory from "../AssistantConversationHistory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockAppListeners = new Set();
jest.mock("react-native", () => {
  const React = require("react"), native = jest.requireActual("react-native");
  const MockList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }), []);
    return React.createElement("assistant-list", props, props.ListHeaderComponent,
      ...(props.data || []).map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item }))));
  });
  return Object.defineProperties(Object.create(native), {
    FlatList: { value: MockList, enumerable: true },
    AppState: { value: { currentState: "active", addEventListener: (_event, listener) => {
      mockAppListeners.add(listener); return { remove: () => mockAppListeners.delete(listener) };
    } }, enumerable: true },
  });
});
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => {
  const sendAssistantMessage = jest.fn();
  const jobApi = require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage);
  return { getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null,
    getEquipmentCatalog: jest.fn(), sendAssistantMessage,
    ...jobApi, createAssistantJob: jest.fn(jobApi.createAssistantJob),
    getAssistantRuntime: jest.fn(), resolveApiAssetUrl: value => value };
});
jest.mock("../../utils/assistantEquipmentSearch", () => {
  const original = jest.requireActual("../../utils/assistantEquipmentSearch");
  return { ...original, localEquipmentAnswer: jest.fn(original.localEquipmentAnswer) };
});
jest.mock("../../hooks/useAssistantReplySpeech", () => ({ useAssistantReplySpeech: () => ({
  read: jest.fn(), stop: jest.fn(), autoRead: false, isSupported: false, status: "idle", setAutoRead: jest.fn(),
}) }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("../../components/AssistantKeyboardSpacer", () => ({ children }) => children);
jest.mock("../../components/EquipmentImage", () => () => null);

const runtime = provider => ({ provider, scope: provider, model: provider === "bailian" ? "qwen-plus" : "deepseek-v4-flash",
  revision: `${provider}-revision-1`, promptMode: provider === "bailian" ? "none" : "app", faqEnabled: provider === "deepseek", protocol: 2 });
const response = (provider, reply = "模型原文") => ({ provider, reply, model: runtime(provider).model, action: "general", recommendations: [],
  ...(provider === "bailian" ? { responsePolicy: "bailian-chat-raw-v1" } : {}) });
const equipment = [{ id: "0", name: "太極揉推器", nameEn: "Tai Chi Wheel", details: "雙手握住手柄。", categories: ["upper"] }];
let tree, auth, storage;
const localeValue = { locale: "zh", i18n: { t: key => key === "equipmentList" ? equipment : `zh:${key}` } };
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const input = () => tree.root.findByType(TextInput);
const button = id => tree.root.findAllByType(TouchableOpacity).find(item => item.props.testID === id);
const press = async id => act(async () => { await button(id).props.onPress(); });
const type = async text => act(async () => input().props.onChangeText(text));
const send = async text => { await type(text); await press("assistant-send"); };
const messages = () => [...tree.root.findByType(FlatList).props.data].reverse().filter(item => item.id !== "welcome");
const expectNoProviderLabels = () => {
  expect(tree.root.findByType(AssistantConversationHistory).props.providerLabel).toBeUndefined();
  expect(tree.root.findAll(node => typeof node.props.testID === 'string' && (node.props.testID.startsWith('assistant-model-') || ['assistant-active-model', 'assistant-history-provider'].includes(node.props.testID)))).toHaveLength(0);
};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const foreground = async () => act(async () => { for (const fn of [...mockAppListeners]) fn("active"); });

beforeEach(() => {
  jest.clearAllMocks();
  storage = new Map();
  auth = { user: { id: "provider-owner", token: "token-one", assistantSessionId: "session-one" }, isUser: true, isGuest: false, isLoading: false };
  AsyncStorage.getItem.mockReset().mockImplementation(async key => storage.get(key) ?? null);
  AsyncStorage.setItem.mockReset().mockImplementation(async (key, value) => storage.set(key, value));
  getAssistantRuntime.mockReset().mockResolvedValue(runtime("deepseek"));
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  sendAssistantMessage.mockReset().mockImplementation(async request => response(request.provider, `回覆：${request.message}`));
  localEquipmentAnswer.mockClear();
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("runtime failure blocks local answers and remote sends, with an explicit reconnect action", async () => {
  getAssistantRuntime.mockRejectedValue({ code: "networkError" });
  await render();
  await type("太極揉推器點用？");
  await press("assistant-send");
  expect(button("assistant-send").props.disabled).toBe(true);
  expect(button("assistant-runtime-retry")).toBeTruthy();
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  getAssistantRuntime.mockResolvedValue(runtime("deepseek"));
  await press("assistant-runtime-retry");
  expectNoProviderLabels();
  expect(tree.root.findAllByProps({ testID: "assistant-active-model" })).toHaveLength(0);
  expect(button("assistant-runtime-retry")).toBeUndefined();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
});

test.each(["我現在胸口痛，抖唔到氣", "太極揉推器點用？", "拉繩機要拉幾多下？", "短片在哪裡？"])("Bailian sends %s to the selected provider without local interception", async question => {
  getAssistantRuntime.mockResolvedValue(runtime("bailian"));
  const raw = "**模型文字**\n![remote](https://example.com/photo.png)\nhttps://example.com\n不加入應用段落";
  sendAssistantMessage.mockResolvedValue(response("bailian", raw));
  await render(); await send(question);
  expect(tree.root.findAllByProps({ testID: "assistant-active-model" })).toHaveLength(0);
  expectNoProviderLabels();
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(sendAssistantMessage.mock.calls[0][0]).toMatchObject({ provider: "bailian", runtimeRevision: "bailian-revision-1", historyScope: "bailian", protocol: 2, history: [] });
  expect(messages().at(-1).reply).toBe(raw);
  expect(messages().at(-1).recommendations).toEqual([]);
  const visible = tree.root.findAllByType(Text).find(node => node.props.testID === `assistant-reply-${messages().at(-1).id}`);
  expect(visible.props.children).toBe(raw);
  expect(getAssistantRuntime).toHaveBeenCalledTimes(2);
});

test("a switch discovered on send preserves the draft and archives separately before sending again", async () => {
  await render(); await send("DeepSeek 對話");
  expect(messages()).toHaveLength(2);
  getAssistantRuntime.mockResolvedValue(runtime("bailian"));
  await send("保留這份草稿");
  expectNoProviderLabels();
  expect(messages()).toHaveLength(0);
  expect(input().props.value).toBe("保留這份草稿");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  await press("assistant-send");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
  expect(sendAssistantMessage.mock.calls[1][0]).toMatchObject({ provider: "bailian", history: [], message: "保留這份草稿" });
  await send("百煉接續");
  expect(sendAssistantMessage.mock.calls[2][0].history.map(row => row.content)).toEqual(["保留這份草稿", "回覆：保留這份草稿"]);
  getAssistantRuntime.mockResolvedValue(runtime("deepseek"));
  await foreground();
  expectNoProviderLabels();
  expect(messages().map(row => row.text || row.reply)).toEqual(["DeepSeek 對話", "回覆：DeepSeek 對話"]);
});

test("raw Bailian history remains verbatim after leaving and reopening the page", async () => {
  getAssistantRuntime.mockResolvedValue(runtime("bailian"));
  const raw = "FAQ **原樣**\nAPP 原文\nhttps://example.com";
  sendAssistantMessage.mockResolvedValue(response("bailian", raw));
  await render(); await send("拉繩機要拉幾多下？");
  await press("assistant-new-conversation");
  await press("assistant-conversation-history");
  expect(tree.root.findByType(AssistantConversationHistory).props.conversations[0].messages.at(-1).text).toBe(raw);
  await act(async () => tree.unmount()); tree = null;
  await render(); await press("assistant-conversation-history");
  expect(tree.root.findByType(AssistantConversationHistory).props.conversations[0].messages.at(-1).text).toBe(raw);
});

test("a response to the previous account's runtime lookup cannot select the new account's mode", async () => {
  const old = deferred(); getAssistantRuntime.mockReturnValueOnce(old.promise);
  await render();
  auth = { ...auth, user: { id: "owner-two", token: "token-two", assistantSessionId: "session-two" } };
  getAssistantRuntime.mockResolvedValue(runtime("bailian"));
  await render();
  await act(async () => old.resolve(runtime("deepseek")));
  expectNoProviderLabels();
  await send("新帳戶問題");
  expect(sendAssistantMessage.mock.calls[0][0]).toMatchObject({ provider: "bailian", history: [] });
  expect(sendAssistantMessage.mock.calls[0][1]).toBe("token-two");
});

test("a provider change between runtime lookup and durable POST preserves the question without retrying the old context", async () => {
  getAssistantRuntime.mockResolvedValueOnce(runtime("deepseek")).mockResolvedValueOnce(runtime("deepseek")).mockResolvedValue(runtime("bailian"));
  createAssistantJob.mockRejectedValueOnce({ code: "assistantProviderChanged", status: 409 });
  await render(); await send("切換時的問題");
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  expectNoProviderLabels();
  expect(messages()).toEqual([]);
  expect(input().props.value).toBe("切換時的問題");
  await press("assistant-send");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(sendAssistantMessage.mock.calls[0][0]).toMatchObject({ provider: "bailian", history: [], message: "切換時的問題" });
});

test("a late DeepSeek job after a foreground switch is saved only in the DeepSeek archive", async () => {
  const late = deferred(); sendAssistantMessage.mockReturnValueOnce(late.promise);
  await render(); await send("等待舊服務回覆");
  expect(messages()).toHaveLength(1);
  getAssistantRuntime.mockResolvedValue(runtime("bailian")); await foreground();
  expect(messages()).toHaveLength(0);
  await act(async () => late.resolve(response("deepseek", "這是晚到的 DeepSeek 回覆")));
  expect(messages()).toHaveLength(0);
  await send("全新百煉問題");
  expect(sendAssistantMessage.mock.calls[1][0].history).toEqual([]);
  getAssistantRuntime.mockResolvedValue(runtime("deepseek")); await foreground();
  expect(messages().at(-1).reply).toBe("這是晚到的 DeepSeek 回覆");
});

test("a failed fresh runtime read does not fall back to a local DeepSeek guide", async () => {
  await render();
  getAssistantRuntime.mockRejectedValueOnce({ code: "networkError" });
  await send("太極揉推器點用？");
  expect(messages()).toEqual([]);
  expect(input().props.value).toBe("太極揉推器點用？");
  expect(button("assistant-runtime-retry")).toBeTruthy();
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test("an older failed runtime lookup cannot replace the later successful foreground lookup", async () => {
  const late = deferred(); getAssistantRuntime.mockReturnValueOnce(late.promise);
  await render();
  getAssistantRuntime.mockResolvedValue(runtime("bailian")); await foreground();
  await act(async () => late.reject({ code: "networkError" }));
  expectNoProviderLabels();
  expect(button("assistant-runtime-retry")).toBeUndefined();
  await send("確認新的模式");
  expect(sendAssistantMessage.mock.calls[0][0].provider).toBe("bailian");
});

test('hidden model labels retain stored model metadata and clearing affects only the current history collection', async () => {
  await render(); await send('第一段問題');
  expect(messages().at(-1).model).toBe('deepseek-v4-flash'); expectNoProviderLabels();
  await press('assistant-new-conversation');
  getAssistantRuntime.mockResolvedValue(runtime('bailian')); await foreground();
  await send('另一段問題'); expect(messages().at(-1).model).toBe('qwen-plus');
  await press('assistant-new-conversation'); await press('assistant-conversation-history');
  const history = () => tree.root.findByType(AssistantConversationHistory).props;
  expect(history().conversations).toHaveLength(1);
  expect(history().conversations[0].messages[0].text).toBe('另一段問題');
  await press('assistant-history-clear-all'); await press('assistant-history-delete-confirm');
  expect(history().conversations).toEqual([]);
  await press('assistant-history-close');
  getAssistantRuntime.mockResolvedValue(runtime('deepseek')); await foreground(); await press('assistant-conversation-history');
  expect(history().conversations).toHaveLength(1);
  expect(history().conversations[0].messages[0].text).toBe('第一段問題');
  expect(history().conversations[0].messages.at(-1).model).toBe('deepseek-v4-flash');
  expectNoProviderLabels();
});
