import React, { useContext } from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, FlatList, Text, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LocaleContext, LocaleProvider } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";
import EditSession from "../../app/(tabs)/sessionlog/edit";
import Safety from "../../app/(tabs)/risk/safety";
import ActivityAdviceScreen from "../../app/(tabs)/activity-advice";
import AiChatbox from "../../app/(tabs)/chat";
import { getAppTexts, getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { getSessionById, getSessions, saveSession } from "../../utils/sessions";
import { setAppTextOverrides } from "../../utils/appText";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockNavigation = { setOptions: jest.fn(), isFocused: () => true, addListener: jest.fn(() => jest.fn()) };
jest.mock("expo-router", () => ({ router: { dismissTo: jest.fn(), replace: jest.fn() }, useNavigation: () => mockNavigation, useLocalSearchParams: () => ({ id: "session-1" }), useFocusEffect: callback => require("react").useEffect(callback, [callback]) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => ({ getAppTexts: jest.fn(), getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage: jest.fn(), resolveApiAssetUrl: value => value }));
jest.mock("../../utils/sessions", () => ({ getSessionById: jest.fn(), getSessions: jest.fn(), saveSession: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useUsageBack", () => ({ useUsageBack: () => jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("../../hooks/useAssistantReplySpeech", () => ({ useAssistantReplySpeech: () => ({ status: "idle", activeMessageId: null, autoRead: false, errorCode: null, read: jest.fn(), stop: jest.fn(), setAutoRead: jest.fn() }) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "zh" }] }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));

const record = { id: "session-1", date: "2026-09-23T01:00:00.000Z", durationSec: 61, mode: "home", journal: "original journal", exercises: [], types: {} };
const user = { id: "participant-1", token: "test-token", profileRole: "participant" };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let tree, context, foreground, now;
function Capture() { context = useContext(LocaleContext); return null; }
async function mount() { await act(async () => { tree = renderer.create(<AuthContext.Provider value={{ user }}><LocaleProvider><Capture /><EditSession /><Safety /><ActivityAdviceScreen /></LocaleProvider></AuthContext.Provider>); }); }
const journal = () => tree.root.findAllByType(TextInput).find(node => node.props.multiline);
const texts = () => tree.root.findAllByType(Text).map(node => node.props.children);
beforeEach(() => {
  jest.clearAllMocks(); setAppTextOverrides(null); AsyncStorage.getItem.mockResolvedValue(null);
  getSessionById.mockResolvedValue(record); getSessions.mockResolvedValue([record]); saveSession.mockResolvedValue([]);
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  now = Date.parse("2026-09-23T12:00:00.000Z"); jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => { foreground = callback; return { remove: jest.fn() }; });
});
afterEach(async () => {
  if (tree) { if (context.locale === "en") await act(async () => context.changeLanguage()); await act(async () => tree.unmount()); }
  tree = null; jest.restoreAllMocks(); setAppTextOverrides(null);
});

test("a late remote copy update renders real APP pages without reloading or overwriting an open exercise-log draft", async () => {
  const remote = deferred(); getAppTexts.mockReturnValueOnce(remote.promise);
  await mount();
  expect(getSessionById).toHaveBeenCalledTimes(1);
  const instance = context.i18n;
  await act(async () => journal().props.onChangeText("用户尚未保存的日志"));
  await act(async () => remote.resolve({ version: 1, overrides: {
    "copy.sessionJournal": { zh: "远程日志说明" }, "copy.saveSessionChanges": { zh: "测试保存" }, "copy.safety": { zh: "远程安全说明" },
    "activity.title": { zh: "远程体能活动标题" },
    "copy.equipmentList.0.id": { zh: "forged-id" }, "copy.permissions": { zh: "admin" },
  } }));
  expect(context.i18n).toBe(instance);
  expect(texts()).toEqual(expect.arrayContaining(["远程日志说明", "远程安全说明", "远程体能活动标题"]));
  expect(getSessionById).toHaveBeenCalledTimes(1);
  expect(journal().props.value).toBe("用户尚未保存的日志");
  expect(user).toEqual({ id: "participant-1", token: "test-token", profileRole: "participant" });
  expect(context.i18n.t("equipmentList")[0].id).not.toBe("forged-id");
  const save = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === "测试保存"));
  await act(async () => save.props.onPress());
  expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-1", journal: "用户尚未保存的日志", durationSec: 61 }), "test-token");
});

test("identical foreground content, default restoration and switching languages preserve the real edit draft", async () => {
  const payload = { version: 1, overrides: { "copy.sessionJournal": { zh: "定制日志说明", en: "Customized journal label" } } };
  getAppTexts.mockResolvedValue(payload);
  await mount();
  const instance = context.i18n;
  await act(async () => journal().props.onChangeText("继续保留日志草稿"));
  now += 31000; await act(async () => foreground("active"));
  expect(getSessionById).toHaveBeenCalledTimes(1);
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: {} });
  now += 31000; await act(async () => foreground("active"));
  expect(texts()).not.toContain("定制日志说明");
  expect(journal().props.value).toBe("继续保留日志草稿");
  await act(async () => context.changeLanguage());
  expect(context.locale).toBe("en");
  expect(context.i18n).toBe(instance);
  expect(getSessionById).toHaveBeenCalledTimes(1);
  expect(journal().props.value).toBe("继续保留日志草稿");
  expect(saveSession).not.toHaveBeenCalled();
});

test("a real chat keeps an unsent draft and an in-flight question when maintained text refreshes", async () => {
  const remote = deferred(), answer = deferred();
  getAppTexts.mockReturnValueOnce(remote.promise);
  sendAssistantMessage.mockReturnValueOnce(answer.promise);
  const chatUser = { ...user, assistantSessionId: "same-login-session" };
  await act(async () => { tree = renderer.create(<AuthContext.Provider value={{ user: chatUser, isUser: true, isGuest: false, isLoading: false }}><LocaleProvider><Capture /><AiChatbox /></LocaleProvider></AuthContext.Provider>); });
  const input = () => tree.root.findByType(TextInput);
  const send = () => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Ionicons).some(icon => icon.props.name === "send"));
  const rows = () => tree.root.findByType(FlatList).props.data;
  const instance = context.i18n;
  await act(async () => input().props.onChangeText("尚未发送的问题"));
  await act(async () => remote.resolve({ version: 1, overrides: { "copy.aiChatPlaceholder": { zh: "新的问题输入提示" } } }));
  expect(context.i18n).toBe(instance);
  expect(input().props.value).toBe("尚未发送的问题");
  expect(input().props.placeholder).toBe("新的问题输入提示");
  expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
  await act(async () => input().props.onChangeText("你好"));
  await act(async () => { void send().props.onPress(); });
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(rows().some(item => item.sender === "user" && item.text === "你好")).toBe(true);
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: { "copy.aiChatPlaceholder": { zh: "再次更新输入提示" } } });
  now += 31000; await act(async () => foreground("active"));
  await act(async () => answer.resolve({ reply: "收到您的問題", recommendations: [] }));
  expect(rows().some(item => item.sender === "user" && item.text === "你好")).toBe(true);
  expect(rows().some(item => item.sender === "ai" && (item.text || item.reply) === "收到您的問題")).toBe(true);
  expect(input().props.placeholder).toBe("再次更新输入提示");
  expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
  expect(context.i18n).toBe(instance);
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
