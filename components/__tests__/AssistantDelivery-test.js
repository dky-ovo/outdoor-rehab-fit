import React from "react";
import renderer, { act } from "react-test-renderer";
import { ActivityIndicator, FlatList, Platform, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import AiChatbox from "../../app/(tabs)/chat";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { notifyAccountData } from '../../utils/accountSyncEvents';
import { localEquipmentAnswer } from "../../utils/assistantEquipmentSearch";
import { withEquipmentTcmReply } from "../../utils/assistantTcm";
import { mockCurrentAssistantConversation, persistedCurrentAssistantMessages } from "../../scripts/test-helpers/assistantConversationFixtures";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../hooks/useAssistantVoiceInput", () => ({ useAssistantVoiceInput: () => ({ status: "idle", interimText: "", errorCode: null, isSupported: false, start: jest.fn(async () => false), stop: jest.fn(async () => {}), cancel: jest.fn(async () => {}) }) }));
const mockEquipment = [{ id: 0, name: "太極揉推器", nameEn: "Tai Chi Wheel", details: "雙手握住手柄。", categories: ["upper"] }];

// Render every row so these tests verify the visible reply, not just list data.
// Native scroll placement is covered separately by AssistantScroll-test.js.
jest.mock("react-native", () => {
  const React = require("react");
  const native = jest.requireActual("react-native");
  const MockFlatList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }), []);
    return React.createElement("mock-assistant-delivery-list", props,
      props.ListHeaderComponent || null,
      ...(props.data || []).map((item, index) => React.createElement(React.Fragment,
        { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))));
  });
  MockFlatList.displayName = "AssistantDeliveryFlatList";
  return Object.defineProperty(Object.create(native), "FlatList", { value: MockFlatList, enumerable: true });
});
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => {
  const sendAssistantMessage = jest.fn();
  return { getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage, resolveApiAssetUrl: value => value,
    ...require('../../scripts/test-helpers/assistantJobApi').assistantJobApi(sendAssistantMessage),
  };
});
jest.mock("../../utils/assistantEquipmentSearch", () => {
  const actual = jest.requireActual("../../utils/assistantEquipmentSearch");
  return { ...actual, localEquipmentAnswer: jest.fn(actual.localEquipmentAnswer) };
});
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-constants", () => ({ nativeBuildVersion: "18" }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("../../utils/imagePermissions", () => ({ canUseNativeCamera: () => true, ensureImagePermission: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/openExternalMap", () => ({ openExternalMap: jest.fn() }));

let tree, auth, localeValue;
const makeLocale = locale => ({ locale, i18n: { t: key => key === "equipmentList" ? mockEquipment : `${locale}:${key}` } });
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const list = () => tree.root.findByType(FlatList);
const messages = () => [...list().props.data].reverse().filter(item => item.id !== "welcome");
const input = () => tree.root.findByType(TextInput);
const sendButton = () => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Ionicons).some(icon => icon.props.name === "send"));
const visibleReply = message => tree.root.findAllByType(Text).find(node => node.props.testID === `assistant-reply-${message.id}`)?.props.children;
const type = async value => act(async () => input().props.onChangeText(value));
const pressSend = async () => act(async () => { void sendButton().props.onPress(); });
const send = async query => { await type(query); await pressSend(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const assertBusy = busy => {
  expect(Boolean(list().props.ListHeaderComponent)).toBe(busy);
  expect(list().findAllByType(ActivityIndicator).length > 0).toBe(busy);
};
const assertFailure = () => {
  const answer = messages().at(-1);
  expect(answer.action).toBe("error");
  expect(typeof visibleReply(answer)).toBe("string");
  expect(visibleReply(answer).trim()).not.toBe("");
  expect(answer.recommendations).toEqual([]);
  assertBusy(false);
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = "android";
  auth = { user: { id: "person-one", token: "token-one", assistantSessionId: "test-session" }, isGuest: false, isUser: true, isLoading: false };
  localeValue = makeLocale("zh");
  mockCurrentAssistantConversation(AsyncStorage, []);
  AsyncStorage.setItem.mockResolvedValue();
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  sendAssistantMessage.mockReset().mockResolvedValue({ reply: "這是本次回答", recommendations: [] });
  localEquipmentAnswer.mockReset().mockImplementation(jest.requireActual("../../utils/assistantEquipmentSearch").localEquipmentAnswer);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.restoreAllMocks();
});

test("a delayed reply keeps the submitted question visible while clearing the composer and showing progress", async () => {
  const request = deferred();
  sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render();
  await send("你好");
  expect(messages()).toHaveLength(1);
  expect(visibleReply(messages()[0])).toBe("你好");
  expect(input().props.value).toBe("");
  assertBusy(true);
  expect(sendButton().props.disabled).toBe(true);
  await act(async () => request.resolve({ reply: "收到您的問題", recommendations: [] }));
  expect(messages().map(visibleReply)).toEqual(["你好", "收到您的問題"]);
  expect(input().props.value).toBe("");
  assertBusy(false);
});

test.each(["zh", "en"])("%s timeout shows an error, restores the question and permits a successful retry", async locale => {
  localeValue = makeLocale(locale);
  sendAssistantMessage.mockRejectedValueOnce({ code: "assistantTimeout", status: 0 });
  await render();
  await send("hello");
  assertFailure();
  expect(visibleReply(messages().at(-1))).toMatch(locale === "en" ? /timed out/i : /逾時/);
  expect(input().props.value).toBe("hello");
  expect(sendButton().props.disabled).toBe(false);
  await pressSend();
  expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
  expect(sendAssistantMessage.mock.calls[1][0].message).toBe("hello");
  expect(sendAssistantMessage.mock.calls[1][0].history.some(item => /逾時|timed out/i.test(item.content))).toBe(false);
  expect(visibleReply(messages().at(-1))).toBe("這是本次回答");
  expect(input().props.value).toBe("");
  assertBusy(false);
});

test.each([
  ["missing payload", undefined], ["null payload", null], ["array payload", []],
  ["empty object", {}], ["empty reply", { reply: "", recommendations: [] }],
  ["whitespace reply", { text: " \n ", reply: "\t", recommendations: [] }],
  ["non-text fields", { text: {}, reply: 123, recommendations: [] }],
])("a successful API call with %s gets a visible error and can be retried", async (_name, payload) => {
  sendAssistantMessage.mockResolvedValueOnce(payload);
  await render();
  await send("你好");
  assertFailure();
  expect(visibleReply(messages()[0])).toBe("你好");
  expect(visibleReply(messages().at(-1))).toContain("未收到完整回覆");
  expect(input().props.value).toBe("你好");
  expect(sendButton().props.disabled).toBe(false);
  await pressSend();
  expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
  expect(visibleReply(messages().at(-1))).toBe("這是本次回答");
  assertBusy(false);
});

test("a failed request never overwrites the next question already being typed", async () => {
  const request = deferred();
  sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render();
  await send("你好");
  await type("這是另一個問題");
  await act(async () => request.reject({ code: "assistantTimeout", status: 0 }));
  assertFailure();
  expect(input().props.value).toBe("這是另一個問題");
  await pressSend();
  expect(sendAssistantMessage.mock.calls[1][0].message).toBe("這是另一個問題");
});

test("two taps before React rerenders create only one question and one pending request", async () => {
  const request = deferred();
  sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render();
  await type("你好");
  const onPress = sendButton().props.onPress;
  await act(async () => { void onPress(); void onPress(); });
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(messages()).toHaveLength(1);
  assertBusy(true);
  await act(async () => request.resolve({ reply: "只回答一次", recommendations: [] }));
  expect(messages().map(visibleReply)).toEqual(["你好", "只回答一次"]);
  assertBusy(false);
});

test('cloud-history refresh cannot unlock a submission while device location is still pending', async () => {
  Platform.OS = 'web';
  let located;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition: success => { located = success; } } } });
  try {
  await render();
  await send('最近公園在哪裡');
  expect(located).toBeDefined();
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  await act(async () => notifyAccountData('person-one', 'assistant', true));
  expect(sendButton().props.disabled).toBe(true);
  await type('另一個問題');
  await pressSend();
  expect(messages().filter(message => message.sender === 'user')).toHaveLength(1);
  await act(async () => located({ coords: { latitude: 22.3, longitude: 114.2 } }));
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(messages().map(visibleReply)).toEqual(['最近公園在哪裡', '這是本次回答']);
  expect(input().props.value).toBe('另一個問題');
  assertBusy(false);
  } finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
});

test("fast sequential sends in the same millisecond retain unique rows and complete saved history", async () => {
  jest.spyOn(Date, "now").mockReturnValue(123456789);
  await render();
  await send("你好");
  await send("謝謝");
  const delivered = messages();
  expect(delivered).toHaveLength(4);
  expect(new Set(delivered.map(item => item.id)).size).toBe(4);
  expect(delivered.map(visibleReply)).toEqual(["你好", "這是本次回答", "謝謝", "這是本次回答"]);
  expect(sendAssistantMessage.mock.calls[1][0].history).toEqual([
    { role: "user", content: "你好" }, { role: "assistant", content: "這是本次回答" },
  ]);
  expect(persistedCurrentAssistantMessages(AsyncStorage)).toEqual(delivered);
});

test("a local lookup exception gets the same visible recovery and releases the send lock", async () => {
  localEquipmentAnswer.mockImplementationOnce(() => { throw new Error("malformed catalog"); });
  await render();
  await send("你好");
  assertFailure();
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  expect(input().props.value).toBe("你好");
  expect(sendButton().props.disabled).toBe(false);
  await pressSend();
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(visibleReply(messages().at(-1))).toBe("這是本次回答");
  assertBusy(false);
});

test.each([
  ["language", "resolve"], ["language", "reject"],
  ["account", "resolve"], ["account", "reject"],
])("a stale request that will %s/%s cannot replace the current conversation or draft", async (change, outcome) => {
  const oldRequest = deferred();
  const newRequest = deferred();
  sendAssistantMessage.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  await render();
  await send("舊對話問題");
  await type("舊對話草稿");
  if (change === "language") localeValue = makeLocale("en");
  if (change === "account") auth = { ...auth, user: { ...auth.user, id: "person-two" } };
  if (change === "token") auth = { ...auth, user: { ...auth.user, token: "token-two" } };
  await render();
  // Token refresh within the same explicit login session retains that session's
  // existing text, but cannot accept an in-flight response using the old token.
  const retained = change === "token" ? ["舊對話問題"] : [];
  expect(messages().map(visibleReply)).toEqual(retained);
  expect(input().props.value).toBe("");
  assertBusy(false);
  await send("新對話問題");
  await type("新對話下一個草稿");
  await act(async () => {
    if (outcome === "resolve") oldRequest.resolve({ reply: "不應出現的舊回答", recommendations: [] });
    else oldRequest.reject({ code: "assistantTimeout", status: 0 });
  });
  expect(messages().map(visibleReply)).toEqual([...retained, "新對話問題"]);
  expect(input().props.value).toBe("新對話下一個草稿");
  assertBusy(true);
  await act(async () => newRequest.resolve({ reply: "新對話回答", recommendations: [] }));
  expect(messages().map(visibleReply)).toEqual([...retained, "新對話問題", "新對話回答"]);
  expect(input().props.value).toBe("新對話下一個草稿");
  assertBusy(false);
});

test("a same-language provider rerender preserves the pending question", async () => {
  const request = deferred();
  sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render();
  await send("你好");
  localeValue = { ...localeValue };
  auth = { ...auth, user: { ...auth.user, name: "Updated profile" } };
  await render();
  expect(messages().map(visibleReply)).toEqual(["你好"]);
  assertBusy(true);
  await act(async () => request.resolve({ reply: "正常回覆", recommendations: [] }));
  expect(messages().map(visibleReply)).toEqual(["你好", "正常回覆"]);
});

test("a complete reply with empty final recommendations is preserved without category fallback", async () => {
  sendAssistantMessage.mockResolvedValueOnce({ reply: "目前不建議使用器材。", recommendations: [], recommendationsFinal: true });
  await render();
  await send("推薦上肢運動器材");
  expect(messages().at(-1)).toMatchObject({ reply: "目前不建議使用器材。", recommendations: [], recommendationsFinal: true });
  expect(visibleReply(messages().at(-1))).toBe("目前不建議使用器材。");
  expect(input().props.value).toBe("");
  assertBusy(false);
});

test.each([" \n\t ", { invalid: true }])("an unusable legacy text field %j cannot hide a valid reply", async text => {
  sendAssistantMessage.mockResolvedValueOnce({ text, reply: "完整的回覆", recommendations: [] });
  await render();
  await send("你好");
  expect(messages().at(-1).text).toBeUndefined();
  expect(visibleReply(messages().at(-1))).toBe("完整的回覆");
  expect(input().props.value).toBe("");
  assertBusy(false);
});

const symptomQuote = "伸展可以幫助膝關節炎患者減輕膝關節痛楚。";
const symptomEquipment = { id: 10, name: "小腿伸展", nameZh: "小腿伸展", nameEn: "Calf stretch", ptTip: symptomQuote, isActive: true };
const symptomResponse = () => withEquipmentTcmReply({
  reply: "我了解您走路時膝蓋不舒服，先一起了解小腿伸展的說明。", action: "equipment_evidence",
  source: "app_content", knowledgeSource: "facility_guide", evidencePolicy: "app-symptom-deepseek-v2",
  deepSeekUsed: true, recommendationsFinal: true,
  recommendations: [{ id: "10", reason: symptomQuote, evidence: { field: "ptTip", quote: symptomQuote, targets: ["knee"] } }],
}, [symptomEquipment]);
const useSymptomCatalog = () => getEquipmentCatalog.mockResolvedValue({ items: [{
  ...symptomEquipment, isCustom: true, ptTipZh: symptomQuote, categories: ["lower", "mobility"],
}] });

test.each(["我的膝蓋痛，推薦器材", "我有膝蓋痛"])("nonurgent symptom %s is sent to DeepSeek and its verified answer survives display", async question => {
  useSymptomCatalog();
  const answer = symptomResponse();
  sendAssistantMessage.mockResolvedValueOnce(answer);
  await render();
  await send(question);
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(sendAssistantMessage.mock.calls[0][0]).toMatchObject({ message: question, locale: "zh" });
  expect(sendAssistantMessage.mock.calls[0][1]).toBe("token-one");
  expect(messages().at(-1)).toMatchObject({ deepSeekUsed: true, reply: answer.reply });
  expect(messages().at(-1).recommendations.map(item => String(item.id))).toEqual(["10"]);
  expect(visibleReply(messages().at(-1))).toContain("我了解您走路時膝蓋不舒服");
  expect(visibleReply(messages().at(-1))).not.toContain("具體是哪個部位");
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(input().props.value).toBe("");
  assertBusy(false);
});

test("knee to walking-pain follow-up reaches the backend with user context and keeps its selected card", async () => {
  useSymptomCatalog();
  sendAssistantMessage.mockResolvedValue(symptomResponse());
  await render();
  await send("我有膝蓋痛");
  await send("走路時會痛");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
  expect(sendAssistantMessage.mock.calls[1][0].history).toEqual([
    { role: "user", content: "我有膝蓋痛" },
    { role: "assistant", content: symptomResponse().reply },
  ]);
  expect(messages().at(-1).recommendations.map(item => String(item.id))).toEqual(["10"]);
  expect(visibleReply(messages().at(-1))).not.toContain("具體是哪個部位");
});

test.each(["继续", "详细", "more details"])("the screenshot conversation followed by %s calls the API and preserves its v2 response", async followup => {
  useSymptomCatalog();
  sendAssistantMessage.mockResolvedValue(symptomResponse());
  await render();
  const questions = ["我有膝蓋痛", "走路時會痛", "推薦器材", followup];
  for (const question of questions) await send(question);
  expect(sendAssistantMessage).toHaveBeenCalledTimes(4);
  const lastRequest = sendAssistantMessage.mock.calls[3][0];
  expect(lastRequest.message).toBe(followup);
  expect(lastRequest.history.filter(item => item.role === "user").map(item => item.content)).toEqual(questions.slice(0, 3));
  expect(messages().at(-1).reply).toBe(symptomResponse().reply);
  expect(messages().at(-1).recommendations.map(item => String(item.id))).toEqual(["10"]);
  expect(visibleReply(messages().at(-1))).toContain("我了解您走路時膝蓋不舒服");
  expect(visibleReply(messages().at(-1))).not.toContain("未能核實");
});

test("unrelated topic between a symptom and continuation cannot revive its old cards", async () => {
  useSymptomCatalog();
  sendAssistantMessage.mockResolvedValueOnce(symptomResponse())
    .mockResolvedValueOnce({ reply: "新的行程問題", recommendations: [] })
    .mockResolvedValueOnce(symptomResponse());
  await render();
  await send("我有膝蓋痛");
  await send("幫我整理今天的行程");
  await send("继续");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(3);
  expect(messages().at(-1).recommendations).toEqual([]);
  expect(visibleReply(messages().at(-1))).toBe("這則舊回覆可能已不適用，請重新提問，查看最新說明。");
  expect(visibleReply(messages().at(-1))).not.toContain(symptomQuote);
});

test("failed symptom request restores the draft without masquerading local recommendations as DeepSeek", async () => {
  useSymptomCatalog();
  sendAssistantMessage.mockRejectedValueOnce({ code: "networkError" });
  await render();
  await send("我的膝蓋痛，推薦器材");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  assertFailure();
  expect(input().props.value).toBe("我的膝蓋痛，推薦器材");
});

test("invalid v2 API card cannot disappear before evidence validation while leaving its claim visible", async () => {
  useSymptomCatalog();
  const answer = symptomResponse();
  answer.recommendations.push({ id: "999", reason: "不存在的器材可以緩解膝痛", evidence: { field: "ptTip", quote: symptomQuote, targets: ["knee"] } });
  answer.reply += "不存在的器材可以緩解膝痛";
  answer.equipmentReplyBase += "不存在的器材可以緩解膝痛";
  sendAssistantMessage.mockResolvedValueOnce(answer);
  await render();
  await send("我的膝蓋痛，推薦器材");
  expect(messages().at(-1).recommendations).toEqual([]);
  expect(visibleReply(messages().at(-1))).toBe("這則舊回覆可能已不適用，請重新提問，查看最新說明。");
  expect(visibleReply(messages().at(-1))).not.toContain("不存在的器材");
  expect(messages().at(-1).equipmentReplyBase).toBeUndefined();
});

test("urgent symptoms stay on the immediate safety path and do not request model recommendations", async () => {
  useSymptomCatalog();
  await render();
  await send("胸痛，推薦器材");
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  expect(messages().at(-1).recommendations).toEqual([]);
  expect(visibleReply(messages().at(-1))).toContain("請停止運動");
});

test("reviewed FAQ red flags override an otherwise local named-equipment lookup", async () => {
  await render();
  await send("突然雙腿麻木無力，太極揉推器怎麼用？");
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(messages().at(-1).recommendations).toEqual([]);
  expect(visibleReply(messages().at(-1))).toContain("999");
});

test("numbness without an acute qualifier goes to the server rather than a local equipment answer", async () => {
  await render();
  await send("雙腿麻木，太極揉推器怎麼用？");
  expect(localEquipmentAnswer).not.toHaveBeenCalled();
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(sendAssistantMessage.mock.calls[0][0].message).toBe("雙腿麻木，太極揉推器怎麼用？");
});

test("restored assistant sources are hidden without changing the user's URL or removing precautions", async () => {
  const userText = "請幫我解釋 https://example.org/question";
  mockCurrentAssistantConversation(AsyncStorage, [
    { id: "u-source", sender: "user", text: userText },
    { id: "a-source", sender: "ai", action: "retired_image", retiredImage: true,
      reply: "如疼痛加劇，請停止。\n資料來源：https://example.org/old\n請先閱讀器材教學。",
      evidencePolicy: "app-faq-reviewed-v1", knowledgeReferences: [{ title: "External source", url: "https://example.org/old" }] },
  ]);
  await render();
  expect(visibleReply(messages().find(item => item.id === "u-source"))).toBe(userText);
  const reply = visibleReply(messages().find(item => item.id === "a-source"));
  expect(reply).toContain("如疼痛加劇，請停止。");
  expect(reply).toContain("請先閱讀器材教學。");
  expect(reply).not.toMatch(/https?:|example\.org|資料來源/);
  expect(tree.root.findAllByType(TouchableOpacity).filter(item => item.props.accessibilityRole === "link")).toHaveLength(0);
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
