import React from "react";
jest.mock('../../components/BookmarkSync', () => () => null);
jest.mock('../../components/AssistantJobSync', () => () => null);
jest.mock('../../components/AccountDataSync', () => () => null);
import renderer, { act } from "react-test-renderer";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { ensurePlaybackAudioMode } from "../../utils/audioMode";

let mockFontState = [true, null];
jest.mock("react-native", () => ({ View: "View" }));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("@react-navigation/native", () => ({ DefaultTheme: {}, ThemeProvider: ({ children }) => children }));
jest.mock("expo-font", () => ({ useFonts: () => mockFontState }));
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
  AuthContext: require("react").createContext({ recordActivity: () => {} }),
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
  jest.doMock("react", () => React); jest.clearAllMocks(); mockFontState = [true, null];
  for (const call of [SplashScreen.preventAutoHideAsync, SplashScreen.hideAsync, SystemUI.setBackgroundColorAsync, ensurePlaybackAudioMode]) call.mockResolvedValue(undefined);
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; warn.mockRestore(); });
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

test("failed optional font loading does not leave the app behind the splash forever", async () => {
  mockFontState = [false, new Error("font unavailable")];
  await mount();
  expect(tree.root.findAllByType("StackScreen").length).toBeGreaterThan(0);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("Unable to load optional display font; using system fallback", mockFontState[1]);
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
