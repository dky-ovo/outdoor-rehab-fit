import React from "react";
jest.mock('../../components/BookmarkSync', () => () => null);
jest.mock('../../components/AssistantJobSync', () => () => null);
jest.mock('../../components/AccountDataSync', () => () => null);
import renderer, { act } from "react-test-renderer";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { ensurePlaybackAudioMode } from "../../utils/audioMode";

let mockFontState = [true, null];
let mockDisplayFontState = [true, null];
let mockPlatform = { OS: "android" };
const mockUseFonts = jest.fn(map => Object.prototype.hasOwnProperty.call(map, "SpaceMono") ? mockDisplayFontState : mockFontState);
const mockRecordActivity = jest.fn();
jest.mock("react-native", () => ({ View: "View", Platform: mockPlatform }));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("@react-navigation/native", () => ({ DefaultTheme: {}, ThemeProvider: ({ children }) => children }));
jest.mock("expo-font", () => ({ useFonts: (...args) => mockUseFonts(...args) }));
jest.mock("expo-router", () => {
  const Stack = ({ children }) => children;
  Stack.Screen = "StackScreen";
  return { Stack };
});
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock("expo-system-ui", () => ({ setBackgroundColorAsync: jest.fn() }));
jest.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
jest.mock("../../utils/audioMode", () => ({ ensurePlaybackAudioMode: jest.fn() }));
jest.mock("@/contexts/LocaleContext", () => ({ LocaleProvider: ({ children }) => children }));
jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }) => children,
  AuthContext: require("react").createContext({ recordActivity: (...args) => mockRecordActivity(...args) }),
}));
jest.mock("@/contexts/ActiveSessionContext", () => ({ ActiveSessionProvider: ({ children }) => children }));
jest.mock("@/components/ResearchInteractionTracker", () => ({ children }) => children(() => false));
jest.mock("@/components/AppUpdateOverlay", () => () => null);
jest.mock("@/components/FloatingSessionTimer", () => () => null);
jest.mock("@/components/AppAlertHost", () => () => null);
jest.mock("@/components/CountdownNotificationObserver", () => () => null);
jest.mock("@/components/LearningProgressSync", () => () => null);
jest.mock("@/components/EquipmentOfflineSync", () => () => null);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, warn;
beforeEach(() => {
  jest.doMock("react", () => React); jest.clearAllMocks(); mockFontState = [true, null]; mockDisplayFontState = [true, null]; mockPlatform.OS = "android";
  for (const call of [SplashScreen.preventAutoHideAsync, SplashScreen.hideAsync, SystemUI.setBackgroundColorAsync, ensurePlaybackAudioMode]) call.mockResolvedValue(undefined);
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; warn.mockRestore(); jest.useRealTimers(); });
function loadRoot() { let Root; jest.isolateModules(() => { Root = require("../../app/_layout").default; }); return Root; }
async function mount() { const Root = loadRoot(); await act(async () => { tree = renderer.create(<Root />); }); return Root; }

test("normal startup waits for fonts and then opens the unchanged navigation stack", async () => {
  mockFontState = [false, null];
  const Root = await mount();
  expect(tree.toJSON()).toBeNull(); expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled(); expect(ensurePlaybackAudioMode).not.toHaveBeenCalled();
  mockFontState = [true, null];
  await act(async () => tree.update(<Root />));
  expect(tree.root.findAllByType("StackScreen").map(node => node.props.name)).toContain("(tabs)");
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1); expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(1);
});

test("failed icon font loading does not leave the app behind the splash forever", async () => {
  mockFontState = [false, new Error("font unavailable")];
  await mount();
  expect(tree.root.findAllByType("StackScreen").length).toBeGreaterThan(0);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("Unable to preload icon fonts; continuing startup", mockFontState[1]);
});

test("web navigation and playback initialization do not wait for the optional font or request it", async () => {
  mockPlatform.OS = "web"; mockFontState = [false, null];
  await mount();
  expect(mockUseFonts).toHaveBeenCalledWith({});
  expect(tree.root.findAllByType("StackScreen").map(node => node.props.name)).toContain("(tabs)");
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1); expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(1);
});

test.each([
  ["hold splash", () => SplashScreen.preventAutoHideAsync],
  ["hide splash", () => SplashScreen.hideAsync],
  ["system background", () => SystemUI.setBackgroundColorAsync],
  ["playback mode", () => ensurePlaybackAudioMode],
])("a rejected %s startup call is handled without breaking navigation", async (_label, getCall) => {
  const failure = new Error("native service unavailable"); getCall().mockRejectedValue(failure);
  await mount();
  expect(tree.root.findAllByType("StackScreen").length).toBeGreaterThan(0);
  expect(warn).toHaveBeenCalledWith(expect.any(String), failure);
});

test("a synchronous native startup exception is also handled", async () => {
  const failure = new Error("native bridge unavailable");
  SystemUI.setBackgroundColorAsync.mockImplementation(() => { throw failure; });
  await mount();
  expect(tree.root.findAllByType("StackScreen").length).toBeGreaterThan(0);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("Unable to set system background", failure);
});

test("the Android root captures editing and drag activity without stealing the touch responder", async () => {
  await mount();
  const view = tree.root.findByType("View");
  expect(view.props.onStartShouldSetResponderCapture({ nativeEvent: {} })).toBe(false);
  view.props.onChangeCapture({ nativeEvent: { text: "typed on the software keyboard" } });
  view.props.onKeyPressCapture({ nativeEvent: { key: "Backspace" } });
  view.props.onTouchMoveCapture({ nativeEvent: {} });
  expect(mockRecordActivity).toHaveBeenCalledTimes(4);
  expect(view.props.onScroll).toBeUndefined(); // Programmatic scrolling is not interaction.
});

test("web tracks trusted typing, touch dragging and wheel input, and removes every listener on unmount", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const callbacks = new Map();
  const doc = { visibilityState: "visible", addEventListener: jest.fn((name, fn) => callbacks.set(name, fn)), removeEventListener: jest.fn() };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    mockPlatform.OS = "web"; await mount();
    expect(callbacks.has("scroll")).toBe(false);
    callbacks.get("input")({ type: "input", isTrusted: false });
    callbacks.get("pointermove")({ type: "pointermove", isTrusted: true, buttons: 0 });
    expect(mockRecordActivity).not.toHaveBeenCalled();
    for (const type of ["input", "keydown", "wheel", "pointerdown", "pointermove"]) callbacks.get(type)({ type, isTrusted: true, buttons: 1 });
    expect(mockRecordActivity).toHaveBeenCalledTimes(5);
    doc.visibilityState = "hidden";
    callbacks.get("input")({ type: "input", isTrusted: true });
    expect(mockRecordActivity).toHaveBeenCalledTimes(5);
    await act(async () => tree.unmount()); tree = null;
    for (const [type, fn] of callbacks) expect(doc.removeEventListener).toHaveBeenCalledWith(type, fn, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document;
  }
});


test("native startup preloads exactly the five used icon families before mounting screens", async () => {
  mockFontState = [false, null];
  await mount();
  expect(tree.toJSON()).toBeNull();
  const icons = mockUseFonts.mock.calls.map(call => call[0]).find(map => "ionicons" in map);
  expect(Object.keys(icons).sort()).toEqual(["FontAwesome", "anticon", "ionicons", "material", "material-community"]);
  expect(mockUseFonts).toHaveBeenCalledWith(expect.objectContaining({ SpaceMono: expect.anything() }));
});

test("optional display-font failure cannot release still-pending native icon fonts", async () => {
  mockFontState = [false, null]; mockDisplayFontState = [false, new Error("display font unavailable")];
  const Root = await mount();
  expect(tree.toJSON()).toBeNull(); expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith("Unable to load optional display font; using system fallback", mockDisplayFontState[1]);
  mockFontState = [true, null]; await act(async () => tree.update(<Root />));
  expect(tree.root.findAllByType("StackScreen").length).toBeGreaterThan(0);
});

test("a stalled native font load has a bounded splash and late success does not remount navigation", async () => {
  jest.useFakeTimers(); mockFontState = [false, null];
  const Root = await mount();
  await act(async () => jest.advanceTimersByTime(1499));
  expect(tree.toJSON()).toBeNull();
  await act(async () => jest.advanceTimersByTime(1));
  const screen = tree.root.findAllByType("StackScreen")[0];
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  mockFontState = [true, null]; await act(async () => tree.update(<Root />));
  expect(tree.root.findAllByType("StackScreen")[0]).toBe(screen);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
});

test("native font completion and root unmount both clear the splash deadline", async () => {
  jest.useFakeTimers(); mockFontState = [false, null];
  const schedule = jest.spyOn(globalThis, "setTimeout"), clear = jest.spyOn(globalThis, "clearTimeout");
  const deadline = () => schedule.mock.results[schedule.mock.calls.findIndex(call => call[1] === 1500)].value;
  try {
    const Root = await mount(); const firstDeadline = deadline();
    mockFontState = [true, null]; await act(async () => tree.update(<Root />));
    expect(clear).toHaveBeenCalledWith(firstDeadline);
    await act(async () => tree.unmount()); tree = null;
    schedule.mockClear(); clear.mockClear();
    mockFontState = [false, null]; await mount(); const secondDeadline = deadline();
    await act(async () => tree.unmount()); tree = null;
    expect(clear).toHaveBeenCalledWith(secondDeadline);
  } finally { schedule.mockRestore(); clear.mockRestore(); }
});
