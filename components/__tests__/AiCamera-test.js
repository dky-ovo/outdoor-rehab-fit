// Photo and microphone input are retired. Text questions and reply playback remain.
import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AiChatbox from "../../app/(tabs)/chat/index";
import { AuthContext } from "../../contexts/AuthContext";
import { mockCurrentAssistantConversation, persistedCurrentAssistantMessages } from "../../scripts/test-helpers/assistantConversationFixtures";
import { LocaleContext } from "../../contexts/LocaleContext";
import { sendAssistantMessage } from "../../utils/api";
import { useAssistantVoiceInput } from "../../hooks/useAssistantVoiceInput";
import { assistantVoiceRequestScope, createAssistantVoiceRequest } from "../../utils/assistantVoiceRequests";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true, mockRouteParams = {}, mockKeyboard, mockSpeech;
let user, locale, isGuest, tree;
jest.mock("../../hooks/useAssistantVoiceInput", () => ({ useAssistantVoiceInput: jest.fn(() => { throw new Error("Retired microphone hook must not be called"); }) }));
jest.mock("../../hooks/useAssistantReplySpeech", () => ({ useAssistantReplySpeech: () => mockSpeech }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => mockKeyboard }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: () => {} }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockRouteParams }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock("../../utils/api", () => { const sendAssistantMessage = jest.fn(); return ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(async () => ({ items: [] })), sendAssistantMessage, ...require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage) }); });
jest.mock("../../utils/equipmentCatalog", () => ({ mergeEquipmentCatalog: base => base, equipmentImageSource: value => value?.uri ? value : ({ uri: value }) }));
jest.mock("../../utils/assistantEquipmentSearch", () => ({ ...jest.requireActual("../../utils/assistantEquipmentSearch"), localEquipmentAnswer: jest.fn(), localEquipmentAnswerForItem: jest.fn(), localEquipmentRecommendations: jest.fn(() => []) }));
jest.mock("../../utils/openExternalMap", () => ({ openExternalMap: jest.fn() }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
const equipment = [{ id: 0, name: "太極揉推器", icon: "facility.jpg", details: "握住手柄" }];
const screen = () => <AuthContext.Provider value={{ user, isGuest, isUser: !isGuest && !!user, isLoading: false }}><LocaleContext.Provider value={{ locale, i18n: { t: key => key === "equipmentList" ? equipment : key } }}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const update = async () => act(async () => { tree.update(screen()); });
const input = () => tree.root.findByType(TextInput);
const byId = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const texts = () => tree.root.findAllByType(Text).map(node => node.props.children).filter(value => typeof value === "string").join("\n");
const type = async value => act(async () => input().props.onChangeText(value));
const press = async id => act(async () => byId(id).props.onPress());
beforeEach(async () => {
  jest.clearAllMocks(); mockFocused = true; mockRouteParams = {}; user = { id: "person", token: "token", assistantSessionId: "test-session" }; locale = "zh"; isGuest = false;
  mockSpeech = { status: "idle", activeMessageId: null, errorCode: null, autoRead: true, read: jest.fn(), stop: jest.fn(), setAutoRead: jest.fn() };
  mockKeyboard = { visible: false, inset: 0 };
  mockCurrentAssistantConversation(AsyncStorage, []);
  sendAssistantMessage.mockReset().mockResolvedValue({ reply: "收到問題", recommendations: [] });
  Platform.OS = "android";
  await act(async () => { tree = renderer.create(screen()); });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("mount has neither microphone/photo controls nor a recognizer or ASR diagnostic panel", () => {
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(Ionicons).some(icon => /camera|image|mic/.test(icon.props.name))).toBe(false);
  expect(byId("assistant-voice-button")).toBeUndefined();
  expect(tree.root.findAll(node => /assistant-voice-/.test(node.props.testID || ""))).toHaveLength(0);
  expect(byId("assistant-auto-read")).toBeTruthy();
  expect(input().props.value).toBe("");
});

test.each(["zh", "en"])("%s typed questions remain editable and are only sent on explicit send", async value => {
  locale = value; await update();
  await type("已有問題"); await type("太極揉推器怎麼使用");
  expect(input().props.value).toBe("太極揉推器怎麼使用");
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  await press("assistant-send");
  expect(sendAssistantMessage.mock.calls[0][0]).toMatchObject({ message: "太極揉推器怎麼使用", locale: value });
  expect(sendAssistantMessage.mock.calls[0][0].imageData).toBeUndefined();
  expect(input().props.value).toBe("");
  expect(mockSpeech.read).toHaveBeenCalledTimes(1);
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
});

test.each(["android", "ios"])("%s keyboard preserves the ordinary composer without a recording panel or extra inset", async platform => {
  Platform.OS = platform; mockKeyboard = { visible: true, inset: 0 }; await update();
  await type("手動輸入");
  expect(tree.root.findAllByType(ScrollView).filter(node => node.props.testID === "assistant-voice-panel")).toHaveLength(0);
  expect(input().props.value).toBe("手動輸入");
  expect(byId("assistant-send").props.disabled).toBe(false);
  expect(StyleSheet.flatten(byId("assistant-send").parent.props.style).paddingBottom).toBe(10);
});

test("failed text requests retain the question for retry without starting recording or playback", async () => {
  sendAssistantMessage.mockRejectedValueOnce({ code: "assistantTimeout" });
  await type("保留的問題"); await press("assistant-send");
  expect(input().props.value).toBe("保留的問題");
  expect(tree.root.findByType(FlatList).props.data.some(item => item.sender === "user" && item.text === "保留的問題")).toBe(true);
  expect(mockSpeech.read).not.toHaveBeenCalled();
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
});

test.each(["home", "external", "otherAccount", "array"])("retired %s voiceRequest cannot acquire the microphone, including after revisit", async source => {
  const scopeUser = source === "otherAccount" ? { id: "old-user", token: "old-token" } : user;
  const request = source === "external" ? "pretend-home-tap" : createAssistantVoiceRequest(assistantVoiceRequestScope(scopeUser, locale));
  mockRouteParams = { voiceRequest: source === "array" ? [request] : request };
  await update(); mockFocused = false; await update(); mockFocused = true; await update();
  locale = "en"; await update();
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
  expect(byId("assistant-voice-button")).toBeUndefined();
  expect(sendAssistantMessage).not.toHaveBeenCalled();
  await type("hello"); await press("assistant-send");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
});

test("guest access cannot be bypassed by a retired voice route parameter", async () => {
  isGuest = true; user = { id: "guest" }; mockRouteParams = { voiceRequest: "home-guest" }; await update();
  expect(useAssistantVoiceInput).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(byId("assistant-auto-read")).toBeUndefined();
  expect(texts()).toContain("訪客模式暫不可使用 AI 助手");
});

test("old photo questions and replies retain read-only text without attachments or new AI context", async () => {
  await act(async () => tree.unmount()); tree = null;
  mockCurrentAssistantConversation(AsyncStorage, [
    { id: "u-img-1", sender: "user", text: "旧照片", imageUri: "data:image/png;base64,secret" },
    { id: "photo-ai", sender: "ai", reply: "旧辨识", action: "equipment_image", confirmationRequired: true, recommendations: [{ id: 0 }] },
    { id: "a-confirm-1", sender: "ai", reply: "旧確認文字", action: "image_confirmation" },
    { id: "u-text", sender: "user", text: "文字問題" },
    { id: "a-text", sender: "ai", reply: "器材資料", recommendations: [{ id: 0 }] },
  ]);
  await act(async () => { tree = renderer.create(screen()); });
  const list = tree.root.findByType(FlatList);
  expect(list.props.data.map(item => item.id)).toEqual(["a-text", "u-text", "a-confirm-1", "photo-ai", "u-img-1", "welcome"]);
  expect(list.props.data.find(item => item.id === "u-img-1")).toMatchObject({ text: "旧照片", retiredImage: true });
  expect(list.props.data.find(item => item.id === "photo-ai")).toMatchObject({ reply: "旧辨识", action: "retired_image", recommendations: [] });
  const row = list.props.renderItem({ item: list.props.data[0] });
  let rowTree; await act(async () => { rowTree = renderer.create(row); });
  expect(rowTree.root.findAllByType(Image).some(image => image.props.source.uri === "facility.jpg")).toBe(true);
  await act(async () => rowTree.unmount());
  const saved = persistedCurrentAssistantMessages(AsyncStorage);
  expect(saved.filter(item => item.retiredImage).map(item => item.text || item.reply)).toEqual(["旧照片", "旧辨识", "旧確認文字"]);
  expect(JSON.stringify(saved)).not.toMatch(/data:image|imageUri|imageData|confirmationRequired/);
  const retiredRow = list.props.renderItem({ item: list.props.data.find(item => item.id === "photo-ai") });
  await act(async () => { rowTree = renderer.create(retiredRow); });
  expect(rowTree.root.findAllByType(Text).some(node => node.props.children === "旧辨识")).toBe(true);
  expect(rowTree.root.findAllByType(Image)).toHaveLength(0);
  expect(rowTree.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  await act(async () => rowTree.unmount());
  await type("你好"); await press("assistant-send");
  const payload = sendAssistantMessage.mock.calls.at(-1)[0];
  expect(payload.history.map(item => item.content)).toEqual(["文字問題", "器材資料"]);
  expect(JSON.stringify(payload)).not.toMatch(/旧照片|旧辨识|旧確認文字|data:image/);
  await act(async () => tree.unmount()); tree = null;
  mockCurrentAssistantConversation(AsyncStorage, saved);
  await act(async () => { tree = renderer.create(screen()); });
  const restored = tree.root.findByType(FlatList).props.data;
  expect(restored.filter(item => item.retiredImage).reverse().map(item => item.text || item.reply)).toEqual(["旧照片", "旧辨识", "旧確認文字"]);
  expect(JSON.stringify(AsyncStorage.setItem.mock.calls.at(-1))).not.toMatch(/imageUri|imageData|data:image/);
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
