import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AiChatbox from "../../app/(tabs)/chat";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { localEquipmentAnswer } from "../../utils/assistantEquipmentSearch";
import { useAssistantVoiceInput } from "../../hooks/useAssistantVoiceInput";
import { mockCurrentAssistantConversation } from "../../scripts/test-helpers/assistantConversationFixtures";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockSpeech;
let mockRouteParams = {};
jest.mock("../../hooks/useAssistantReplySpeech", () => ({ useAssistantReplySpeech: () => mockSpeech }));
jest.mock("../../hooks/useAssistantVoiceInput", () => ({ useAssistantVoiceInput: jest.fn(() => { throw new Error("Retired voice input must not be initialized"); }) }));
jest.mock("react-native", () => {
  const React = require("react"), native = jest.requireActual("react-native");
  const List = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }), []);
    return React.createElement("speech-test-list", props, ...(props.data || []).map((item, index) => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index }))));
  });
  return Object.defineProperty(Object.create(native), "FlatList", { value: List, enumerable: true });
});
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => mockRouteParams }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => { const sendAssistantMessage = jest.fn(); return ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage, ...require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage) }); });
jest.mock("../../utils/equipmentCatalog", () => ({ mergeEquipmentCatalog: base => base, equipmentImageSource: value => value }));
jest.mock("../../utils/assistantSymptomEvidence", () => ({ symptomGuideAnswer: () => null, symptomConcern: () => null }));
jest.mock("../../utils/assistantEquipmentSearch", () => ({ assistantMessagesForDisplay: items => items, localEquipmentAnswer: jest.fn(), localEquipmentAnswerForItem: () => null, localEquipmentRecommendations: () => [], resolveEquipmentRecommendations: () => [] }));
jest.mock("../../utils/assistantReplyPresentation", () => ({ assistantReplyPresentation: item => ({ previewText: `Visible: ${item.text || item.reply}`, fullText: `Hidden: ${item.text || item.reply}`, canExpand: true }) }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("../../utils/openExternalMap", () => ({ openExternalMap: jest.fn() }));
jest.mock("../../components/AssistantReplyDetails", () => () => null);

let tree, auth, localeValue;
const makeLocale = locale => ({ locale, i18n: { t: key => key === "equipmentList" ? [] : `${locale}:${key}` } });
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const input = () => tree.root.findByType(TextInput);
const messages = () => tree.root.findByType(FlatList).props.data.filter(item => item.id !== "welcome");
const send = async value => { await act(async () => input().props.onChangeText(value)); await act(async () => { void button("assistant-send").props.onPress(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockRouteParams = {};
  auth = { user: { id: "one", token: "token-one", assistantSessionId: "test-session" }, isGuest: false, isUser: true, isLoading: false };
  localeValue = makeLocale("zh");
  mockSpeech = { status: "idle", activeMessageId: null, errorCode: null, autoRead: true, read: jest.fn(), stop: jest.fn(), setAutoRead: jest.fn() };
  mockCurrentAssistantConversation(AsyncStorage, []); AsyncStorage.setItem.mockResolvedValue();
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  sendAssistantMessage.mockReset().mockResolvedValue({ reply: "Answer", recommendations: [] });
  localEquipmentAnswer.mockReset().mockReturnValue(null);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("welcome and restored history never auto-play; fresh replies read only their visible presentation once", async () => {
  mockCurrentAssistantConversation(AsyncStorage, [{ id: "history", sender: "ai", reply: "Old answer" }]);
  await render();
  expect(mockSpeech.read).not.toHaveBeenCalled();
  await send("hello");
  expect(mockSpeech.read).toHaveBeenCalledTimes(1);
  expect(mockSpeech.read).toHaveBeenCalledWith(messages()[0].id, "Visible: Answer");
  await render();
  expect(mockSpeech.read).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(AsyncStorage.setItem.mock.calls.at(-1))).not.toContain("Visible:");
});

test("offline in-app answers use the same automatic read path without contacting AI", async () => {
  localEquipmentAnswer.mockReturnValueOnce({ reply: "Local guide", action: "equipment_local", recommendations: [] });
  await render(); await send("如何使用");
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  expect(mockSpeech.read).toHaveBeenCalledWith(messages()[0].id, "Visible: Local guide");
});

test.each([{ code: "assistantTimeout" }, { status: 401 }])("failed replies %j are not spoken and offer no reply read button", async error => {
  sendAssistantMessage.mockRejectedValueOnce(error);
  await render(); await send("question");
  expect(mockSpeech.read).not.toHaveBeenCalled();
  expect(button(`assistant-read-${messages()[0].id}`)).toBeUndefined();
});

test("manual reading still works when automatic reading is off", async () => {
  mockSpeech.autoRead = false;
  await render(); await send("question");
  expect(mockSpeech.read).not.toHaveBeenCalled();
  await act(async () => button(`assistant-read-${messages()[0].id}`).props.onPress());
  expect(mockSpeech.read).toHaveBeenCalledWith(messages()[0].id, "Visible: Answer");
});

test("enabling automatic reading later does not replay existing messages", async () => {
  mockSpeech.autoRead = false;
  await render(); await send("question");
  mockSpeech.autoRead = true; await render();
  expect(mockSpeech.read).not.toHaveBeenCalled();
  await send("next");
  expect(mockSpeech.read).toHaveBeenCalledTimes(1);
});

test("leaving the page stops playback; a late reply and returning do not start it", async () => {
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render(); await send("question");
  mockSpeech.stop.mockClear(); mockFocused = false; await render();
  expect(mockSpeech.stop).toHaveBeenCalled();
  await act(async () => request.resolve({ reply: "Late answer", recommendations: [] }));
  mockFocused = true; await render();
  expect(mockSpeech.read).not.toHaveBeenCalled();
});

test.each(["account", "token", "locale", "logout"])("%s change stops playback and discards pending old conversation speech", async change => {
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await render(); await send("old"); mockSpeech.stop.mockClear();
  if (change === "account") auth = { ...auth, user: { ...auth.user, id: "two" } };
  if (change === "token") auth = { ...auth, user: { ...auth.user, token: "two" } };
  if (change === "locale") localeValue = makeLocale("en");
  if (change === "logout") auth = { ...auth, user: null, isUser: false };
  await render();
  expect(mockSpeech.stop).toHaveBeenCalled();
  await act(async () => request.resolve({ reply: "Old answer", recommendations: [] }));
  expect(mockSpeech.read).not.toHaveBeenCalled();
});

test("sending a new question stops the previous playback immediately", async () => {
  await render(); await send("first"); mockSpeech.stop.mockClear();
  const request = deferred(); sendAssistantMessage.mockReturnValueOnce(request.promise);
  await send("second");
  expect(mockSpeech.stop).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve({ reply: "Second reply", recommendations: [] }));
});

test("legacy voice links cannot initialize recording and typed replies still auto-read", async () => {
  mockRouteParams = { voiceRequest: "legacy-home-voice-request" };
  await render();
  expect(button("assistant-voice-button")).toBeUndefined();
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
  await send("文字問題");
  expect(sendAssistantMessage.mock.calls[0][0].message).toBe("文字問題");
  expect(mockSpeech.read).toHaveBeenCalledWith(messages()[0].id, "Visible: Answer");
  mockFocused = false; await render(); mockFocused = true; await render();
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
  expect(mockSpeech.read).toHaveBeenCalledTimes(1);
});

test("automatic-read toggle and both stop controls remain available without a microphone", async () => {
  await render(); await send("文字問題");
  const id = messages()[0].id;
  await act(async () => button("assistant-auto-read").props.onPress());
  expect(mockSpeech.setAutoRead).toHaveBeenCalledWith(false);
  mockSpeech.status = "speaking"; mockSpeech.activeMessageId = id; await render();
  mockSpeech.stop.mockClear();
  await act(async () => button(`assistant-read-${id}`).props.onPress());
  await act(async () => button("assistant-stop-reading").props.onPress());
  expect(mockSpeech.stop).toHaveBeenCalledTimes(2);
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
});

test("unmount stops playback", async () => {
  await render(); mockSpeech.stop.mockClear();
  await act(async () => tree.unmount()); tree = null;
  expect(mockSpeech.stop).toHaveBeenCalled();
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
