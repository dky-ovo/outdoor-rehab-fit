import React from "react";
import renderer, { act } from "react-test-renderer";
import { ActivityIndicator, FlatList, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AiChatbox from "../../app/(tabs)/chat";
import AssistantKeyboardSpacer from "../AssistantKeyboardSpacer";
import AssistantPhotoPreview from "../AssistantPhotoPreview";
import { AuthContext } from "../../contexts/AuthContext";
import { currentAssistantConversation, mockCurrentAssistantConversation, persistedCurrentAssistantMessages } from "../../scripts/test-helpers/assistantConversationFixtures";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../hooks/useAssistantVoiceInput", () => ({ useAssistantVoiceInput: () => ({ status: "idle", interimText: "", errorCode: null, isSupported: false, start: jest.fn(async () => false), stop: jest.fn(async () => {}), cancel: jest.fn(async () => {}) }) }));
const mockScrollToOffset = jest.fn();
const mockScrollToEnd = jest.fn();
const mockScrollToIndex = jest.fn();
let mockFocused = true;
let mockKeyboard = { visible: false, inset: 0 };
const mockEquipment = [{ id: 0, name: "太極揉推器", nameEn: "Tai Chi Wheel", details: "雙手握住手柄。", categories: ["upper"] }];

jest.mock("react-native", () => {
  const React = require("react");
  const native = jest.requireActual("react-native");
  const MockFlatList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset, scrollToEnd: mockScrollToEnd, scrollToIndex: mockScrollToIndex }), []);
    return React.createElement("mock-assistant-flat-list", props,
      props.ListHeaderComponent || null,
      ...(props.data || []).map((item, index) => props.CellRendererComponent
        ? React.createElement(props.CellRendererComponent, {
          key: props.keyExtractor(item, index), item, index, cellKey: props.keyExtractor(item, index),
          style: { transform: [{ scaleY: -1 }] }, onLayout: jest.fn(),
        }, props.renderItem({ item, index }))
        : React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))),
      props.ListFooterComponent || null);
  });
  MockFlatList.displayName = "AssistantScrollFlatList";
  return Object.defineProperty(Object.create(native), "FlatList", { value: MockFlatList, enumerable: true });
});
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../utils/api", () => { const sendAssistantMessage = jest.fn(); return ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage, ...require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage), resolveApiAssetUrl: value => value }); });
jest.mock("../../utils/equipmentCatalog", () => ({ mergeEquipmentCatalog: base => base, equipmentImageSource: () => null }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => mockKeyboard }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-image-picker", () => ({ launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-constants", () => ({ nativeBuildVersion: "18" }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
jest.mock("../../utils/imagePermissions", () => ({ canUseNativeCamera: () => true, ensureImagePermission: jest.fn(async () => true) }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/openExternalMap", () => ({ openExternalMap: jest.fn() }));

let tree, auth, localeValue, frame, cancelFrame, frames, nextFrame;
const makeLocale = locale => ({ locale, i18n: { t: key => key === "equipmentList" ? mockEquipment : `${locale}:${key}` } });
const stored = [
  { id: "old-user-1", sender: "user", text: "之前第一個問題" },
  { id: "old-ai-1", sender: "ai", reply: "之前第一個回答", recommendations: [] },
  { id: "old-user-2", sender: "user", text: "之前第二個問題" },
  { id: "old-ai-2", sender: "ai", reply: "之前第二個回答", recommendations: [] },
];
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><AiChatbox /></LocaleContext.Provider></AuthContext.Provider>;
const list = () => tree.root.findByType(FlatList);
const data = () => list().props.data;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const iconButton = name => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Ionicons).some(icon => icon.props.name === name));
const type = async query => act(async () => tree.root.findByType(TextInput).props.onChangeText(query));
const send = async query => { await type(query); await act(async () => { void iconButton("send").props.onPress(); }); };
const scrollEvent = y => ({ nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 2200 }, layoutMeasurement: { width: 390, height: 600 } } });
const browseOlder = async () => {
  expect(typeof list().props.onScrollBeginDrag).toBe("function");
  expect(typeof list().props.onScroll).toBe("function");
  await act(async () => {
    list().props.onScrollBeginDrag(scrollEvent(0));
    list().props.onScroll(scrollEvent(360));
  });
};
const expectAnchorWithoutAutoscroll = () => {
  expect(list().props.maintainVisibleContentPosition).toMatchObject({ minIndexForVisible: 0 });
  expect(list().props.maintainVisibleContentPosition).not.toHaveProperty("autoscrollToTopThreshold");
};
const expectLatestOffset = () => {
  expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
  expect(mockScrollToEnd).not.toHaveBeenCalled();
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const persisted = () => persistedCurrentAssistantMessages(AsyncStorage);

const longExplanation = "這項設施的专业说明详细介绍肩膊的活动方式，描述运动过程中肌肉的配合，以及动作与关节活动之间的关系。".repeat(3);
const compactCatalog = [{ ...mockEquipment[0], ptTip: longExplanation, tcmEnabled: true, tcmTip: "練習時配合呼吸，中醫說明提到氣血的運行。" }];
const compactHistory = [
  { id: "compact-u", sender: "user", text: "推薦上肢器材" },
  { id: "compact-ai", sender: "ai", action: "equipment_evidence", reply: "相关器材资料。請先由專業人員評估。", recommendations: [{ id: "0", evidence: { field: "ptTip", quote: longExplanation } }] },
];
const useCompactHistory = () => {
  localeValue = { locale: "zh", i18n: { t: key => key === "equipmentList" ? compactCatalog : `zh:${key}` } };
  mockCurrentAssistantConversation(AsyncStorage, compactHistory);
};
const expansion = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-expand-compact-ai");
const compactReply = () => tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-compact-ai").props.children;
const detailsText = () => tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-details-text")?.props.children;
const closeDetails = async () => act(async () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-reply-details-close").props.onPress());
const flushFrames = async () => {
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => callbacks.forEach(callback => callback(0)));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockKeyboard = { visible: false, inset: 0 };
  Platform.OS = "android";
  auth = { user: { id: "person-one", token: "token-one", assistantSessionId: "test-session" }, isGuest: false, isUser: true, isLoading: false };
  localeValue = makeLocale("zh");
  mockCurrentAssistantConversation(AsyncStorage, stored);
  AsyncStorage.setItem.mockResolvedValue();
  getEquipmentCatalog.mockResolvedValue({ items: [] });
  sendAssistantMessage.mockResolvedValue({ reply: "這是本次回答", recommendations: [] });
  ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ base64: "synthetic-image", mimeType: "image/jpeg" }] });
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
  frames = new Map(); nextFrame = 0;
  frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  cancelFrame = jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => frames.delete(id));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  frame?.mockRestore();
  cancelFrame?.mockRestore();
});

test("native chat uses inverted newest-first display while storage and API history remain chronological", async () => {
  await render();
  expect(list().props.inverted).toBe(true);
  expect(data().map(item => item.id)).toEqual(["old-ai-2", "old-user-2", "old-ai-1", "old-user-1", "welcome"]);
  expect(persisted()).toEqual(stored);
  await send("你好");
  expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  expect(sendAssistantMessage.mock.calls[0][0].history).toEqual(stored.map(item => ({ role: item.sender === "user" ? "user" : "assistant", content: item.text || item.reply })));
  expect(data()[0].reply).toBe("這是本次回答");
  expect(data()[1].text).toBe("你好");
  expect(persisted().slice(0, stored.length)).toEqual(stored);
  expect(persisted().slice(-2).map(item => item.text || item.reply)).toEqual(["你好", "這是本次回答"]);
});

test("asynchronous restoration of 80 long messages starts at newest without measuring or scrolling through history", async () => {
  const restore = deferred();
  const longHistory = Array.from({ length: 80 }, (_, index) => ({
    id: `long-history-${index}`,
    sender: index % 2 === 0 ? "user" : "ai",
    ...(index % 2 === 0 ? { text: `問題 ${index}` } : { reply: `回答 ${index}：${"這是較長的APP設施說明。".repeat(120)}`, recommendations: [] }),
  }));
  // The deferred read represents this disk value. A no-op restore need not
  // write it again, so the persistence fixture must use the same baseline.
  mockCurrentAssistantConversation(AsyncStorage, longHistory);
  AsyncStorage.getItem.mockReturnValue(restore.promise);
  await render();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  // This FlatList mock never measures any row or emits a content/layout event.
  await act(async () => restore.resolve(currentAssistantConversation(longHistory, { owner: "person-one" })));
  expect(data()).toHaveLength(81);
  expect(data()[0].id).toBe("long-history-79");
  expect(data().slice(0, 80).map(item => item.id)).toEqual(longHistory.map(item => item.id).reverse());
  expect(data().at(-1).id).toBe("welcome");
  expect(persisted()).toEqual(longHistory);
  expectLatestOffset();
  expect(mockScrollToOffset.mock.calls.every(([options]) => options.offset === 0 && options.animated === false)).toBe(true);
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  expect(list().props.onContentSizeChange).toBeUndefined();
  expect(typeof list().props.onLayout).toBe("function");
});

test("entry and returning from another screen reset to latest with a non-animated zero offset", async () => {
  await render();
  expectLatestOffset();
  await browseOlder();
  mockScrollToOffset.mockClear();
  mockFocused = false;
  await render();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  mockFocused = true;
  await render();
  expectLatestOffset();
  expect(data().map(item => item.id)).toEqual(["old-ai-2", "old-user-2", "old-ai-1", "old-user-1", "welcome"]);
});

test("native content size and layout changes have no unconditional jump-to-bottom handlers", async () => {
  await render();
  expect(list().props.onContentSizeChange).toBeUndefined();
  const initialScrolls = [...mockScrollToOffset.mock.calls];
  await act(async () => list().props.onLayout({ nativeEvent: { layout: { width: 390, height: 600 } } }));
  await act(async () => list().props.onLayout({ nativeEvent: { layout: { width: 390, height: 300 } } }));
  expect(mockScrollToOffset.mock.calls).toEqual(initialScrolls);
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test("dragging into old messages anchors the visible message without an automatic scroll threshold", async () => {
  await render();
  mockScrollToOffset.mockClear();
  await browseOlder();
  expectAnchorWithoutAutoscroll();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
});

test("a late AI answer does not interrupt someone already reading older messages", async () => {
  const reply = deferred();
  sendAssistantMessage.mockReturnValue(reply.promise);
  await render();
  await send("你好");
  expectLatestOffset();
  await browseOlder();
  mockScrollToOffset.mockClear();
  await act(async () => reply.resolve({ reply: "延後回覆", recommendations: [] }));
  expect(data()[0].reply).toBe("延後回覆");
  expectAnchorWithoutAutoscroll();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test("manually returning to offset zero releases the history anchor and a later reply needs no imperative scroll", async () => {
  const reply = deferred();
  sendAssistantMessage.mockReturnValue(reply.promise);
  await render();
  await send("你好");
  await browseOlder();
  expectAnchorWithoutAutoscroll();
  mockScrollToOffset.mockClear();
  await act(async () => list().props.onScroll(scrollEvent(0)));
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  await act(async () => reply.resolve({ reply: "回到底部之後收到的回答", recommendations: [] }));
  expect(data()[0].reply).toBe("回到底部之後收到的回答");
  expect(data()[1].text).toBe("你好");
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test.each(["你好", "太極揉推器如何使用？"])("explicitly sending %s returns to the latest message", async query => {
  await render();
  await browseOlder();
  mockScrollToOffset.mockClear();
  await send(query);
  expectLatestOffset();
  expect(data()[1].text).toBe(query);
});

test("keyboard appearance, dismissal and input-height changes do not pull an older message to the bottom", async () => {
  await render();
  await browseOlder();
  mockScrollToOffset.mockClear();
  mockKeyboard = { visible: true, inset: 290 };
  await render();
  await type("第一行\n第二行\n第三行");
  mockKeyboard = { visible: false, inset: 0 };
  await render();
  expectAnchorWithoutAutoscroll();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test.each(["account", "language"])("a different %s restores its own chronological history and starts at the bottom", async change => {
  await render();
  await browseOlder();
  mockScrollToOffset.mockClear();
  const next = [{ id: "new-user", sender: "user", text: "新歷史問題" }, { id: "new-ai", sender: "ai", reply: "新歷史回答", recommendations: [] }];
  mockCurrentAssistantConversation(AsyncStorage, next);
  if (change === "account") auth = { ...auth, user: { id: "person-two", token: "token-two", assistantSessionId: "test-session" } };
  else localeValue = makeLocale("en");
  await render();
  expectLatestOffset();
  expect(data().map(item => item.id)).toEqual(["new-ai", "new-user", "welcome"]);
  expect(AsyncStorage.getItem.mock.calls.at(-1)[0]).toBe(change === "account" ? "@outdoor_fit_ai_conversations_v2:person-two:zh" : "@outdoor_fit_ai_conversations_v2:person-one:en");
  expect(persisted()).toEqual(next);
});

test("auth loading and a guest screen do not scroll a missing list, then sign-in starts at latest", async () => {
  auth = { user: null, isGuest: true, isUser: false, isLoading: true };
  await render();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  auth = { ...auth, isLoading: false };
  await render();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  auth = { user: { id: "person-one", token: "token-one", assistantSessionId: "test-session" }, isGuest: false, isUser: true, isLoading: false };
  await render();
  expectLatestOffset();
});

test("the busy indicator sits at the latest end through ListHeader rather than the old-history footer", async () => {
  const reply = deferred();
  sendAssistantMessage.mockReturnValue(reply.promise);
  await render();
  expect(list().props.ListHeaderComponent).toBeFalsy();
  await send("你好");
  expect(React.isValidElement(list().props.ListHeaderComponent)).toBe(true);
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(list().props.ListFooterComponent).toBeFalsy();
  await act(async () => reply.resolve({ reply: "已完成", recommendations: [] }));
  expect(list().props.ListHeaderComponent).toBeFalsy();
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
});

test("the retired photo entry cannot open a picker or unexpectedly scroll older history", async () => {
  await render(); await browseOlder(); mockScrollToOffset.mockClear();
  expect(iconButton("camera-outline")).toBeUndefined();
  expect(tree.root.findAllByType(AssistantPhotoPreview)).toHaveLength(0);
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
});

test.each(["android", "ios", "web"])("%s opens the full reply in a separate reader repeatedly without resizing or scrolling history", async os => {
  Platform.OS = os;
  useCompactHistory();
  await render();
  await browseOlder();
  const preview = compactReply();
  expect(preview).not.toContain(longExplanation);
  mockScrollToOffset.mockClear();
  frame.mockClear();
  const writes = AsyncStorage.setItem.mock.calls.length;
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => expansion().props.onPress());
    expect(detailsText()).toContain(longExplanation);
    expect(detailsText()).toContain(compactCatalog[0].tcmTip);
    expect(compactReply()).toBe(preview);
    expect(tree.root.findByType(Modal).props).toMatchObject({ visible: true, animationType: "none", presentationStyle: "fullScreen" });
    await flushFrames();
    await closeDetails();
    expect(detailsText()).toBeUndefined();
    expect(compactReply()).toBe(preview);
  }
  expectAnchorWithoutAutoscroll();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(frame).not.toHaveBeenCalled();
  expect(list().props.CellRendererComponent).toBeUndefined();
  expect(list().props.onScrollToIndexFailed).toBeUndefined();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  expect(persisted()).toEqual(compactHistory);
  expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test("latest reply details are immediately readable without waiting for any chat cell measurement", async () => {
  useCompactHistory();
  await render();
  mockScrollToOffset.mockClear();
  await act(async () => expansion().props.onPress());
  expect(detailsText()).toContain(longExplanation);
  expect(detailsText()).toContain("請先由專業人員評估");
  expect(compactReply()).not.toContain(longExplanation);
  await flushFrames();
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test("a late AI reply cannot replace the older reply already open in the separate reader", async () => {
  useCompactHistory();
  const reply = deferred();
  sendAssistantMessage.mockReturnValue(reply.promise);
  await render();
  await send("你好");
  await browseOlder();
  mockScrollToOffset.mockClear();
  await act(async () => expansion().props.onPress());
  const opened = detailsText();
  await act(async () => reply.resolve({ reply: "稍後收到的新回答", recommendations: [] }));
  const targetIndex = data().findIndex(item => item.id === "compact-ai");
  expect(targetIndex).toBe(2);
  await flushFrames();
  expect(detailsText()).toBe(opened);
  expect(detailsText()).not.toContain("稍後收到的新回答");
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

test("each historical message opens its own explanation, never the last opened one", async () => {
  useCompactHistory();
  const secondHistory = compactHistory.map(item => ({ ...item, id: `${item.id}-second`, ...(item.sender === "ai" ? { reply: "第二次回答的專業說明。使用前請先評估。" } : { text: "再推薦上肢器材" }) }));
  mockCurrentAssistantConversation(AsyncStorage, [...compactHistory, ...secondHistory]);
  await render();
  await browseOlder();
  mockScrollToOffset.mockClear();
  await act(async () => expansion().props.onPress());
  expect(detailsText()).toContain("相关器材资料");
  expect(detailsText()).not.toContain("第二次回答");
  await closeDetails();
  await act(async () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-expand-compact-ai-second").props.onPress());
  expect(detailsText()).toContain("第二次回答的專業說明");
  expect(detailsText()).not.toContain("相关器材资料");
  await closeDetails();
  await act(async () => expansion().props.onPress());
  expect(detailsText()).toContain("相关器材资料");
  expect(detailsText()).not.toContain("第二次回答");
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  expectAnchorWithoutAutoscroll();
});

test.each(["android", "ios", "web"])("%s closing with the platform back handler preserves the older-message anchor", async os => {
  Platform.OS = os; useCompactHistory();
  await render();
  mockScrollToOffset.mockClear();
  await browseOlder();
  await act(async () => expansion().props.onPress());
  expect(detailsText()).toContain(longExplanation);
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  await flushFrames();
  expect(detailsText()).toBeUndefined();
  expectAnchorWithoutAutoscroll();
  expect(mockScrollToIndex).not.toHaveBeenCalled();
  expect(mockScrollToOffset).not.toHaveBeenCalled();
});

test.each(["focus", "account", "language", "token"])("open details close on %s changes and cannot leak into another conversation", async change => {
  useCompactHistory();
  await render();
  await act(async () => expansion().props.onPress());
  expect(detailsText()).toContain(longExplanation);
  if (change === "focus") mockFocused = false;
  if (change === "account") auth = { ...auth, user: { id: "other-person", token: "other-token", assistantSessionId: "test-session" } };
  if (change === "language") localeValue = { ...localeValue, locale: "en" };
  if (change === "token") auth = { ...auth, user: { ...auth.user, token: "new-token" } };
  await render();
  expect(detailsText()).toBeUndefined();
  mockFocused = true;
  await render();
  expect(detailsText()).toBeUndefined();
  expect(list().props.extraData).toBeUndefined();
});

test("retired photo confirmations preserve plain history without actions or new API requests", async () => {
  mockCurrentAssistantConversation(AsyncStorage, [{ id: "photo", sender: "ai", reply: "請確認照片", action: "equipment_image", confirmationRequired: true, recommendations: [{ id: 0 }] }]);
  await render();
  expect(data().find(item => item.id === "photo")).toMatchObject({ reply: "請確認照片", retiredImage: true, action: "retired_image", recommendations: [] });
  expect(sendAssistantMessage).not.toHaveBeenCalled();
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));


test("Android native translation reserves oldest-message scroll space without moving toolbar or replacing history", async () => {
  Platform.OS = "android";
  await render();
  const ids = data().map(item => item.id);
  const frame = tree.root.findByType(AssistantKeyboardSpacer);
  expect(frame.findByType(FlatList)).toBeDefined();
  expect(list().props.removeClippedSubviews).toBe(false);
  expect(frame.findAllByProps({ testID: "assistant-new-conversation" })).toHaveLength(0);
  expect(frame.findByProps({ testID: "assistant-message-input" })).toBeDefined();
  await act(async () => frame.props.onInsetChange(286));
  expect(StyleSheet.flatten(list().props.contentContainerStyle).paddingBottom).toBe(301);
  expect(list().props.inverted).toBe(true);
  expect(data().map(item => item.id)).toEqual(ids);
  await act(async () => frame.props.onInsetChange(0));
  expect(StyleSheet.flatten(list().props.contentContainerStyle).paddingBottom).toBe(15);
  expect(data().map(item => item.id)).toEqual(ids);
});
