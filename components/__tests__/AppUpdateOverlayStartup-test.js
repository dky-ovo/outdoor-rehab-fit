import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import * as Updates from "expo-updates";
import AppUpdateOverlay from "../AppUpdateOverlay";

jest.mock("react-native", () => ({
  AppState: { currentState: null, addEventListener: jest.fn() },
  Platform: { OS: "android" }, StyleSheet: { create: value => value },
  View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal",
  Easing: { linear: value => value },
  Animated: {
    Value: class { setValue() {} interpolate() { return "0deg"; } },
    View: "AnimatedView", loop: () => ({ start() {}, stop() {} }),
    timing: () => ({ start() {}, stop() {} }), spring: () => ({ start() {}, stop() {} }),
  },
}));
jest.mock("expo-updates", () => ({
  isEnabled: true, useUpdates: () => ({}),
  checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn(),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("@/contexts/LocaleContext", () => ({
  LocaleContext: require("react").createContext({ locale: "zh" }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, listener, remove, warn;
const previousDev = globalThis.__DEV__;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-23T01:00:00Z"));
  jest.clearAllMocks(); globalThis.__DEV__ = false;
  AppState.currentState = null;
  remove = jest.fn();
  AppState.addEventListener.mockImplementation((_event, handler) => { listener = handler; return { remove }; });
  Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null; warn.mockRestore(); globalThis.__DEV__ = previousDev; jest.useRealTimers();
});

test.each([null, undefined, "unknown"])("initial AppState %s does not throw on the first foreground event", async state => {
  AppState.currentState = state;
  await act(async () => { tree = renderer.create(<AppUpdateOverlay />); });
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  await act(async () => { listener("active"); });
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  expect(tree.toJSON()).toBeNull();
});

test.each(["background", "inactive"])("normal %s to active still checks for updates", async state => {
  AppState.currentState = "active";
  await act(async () => { tree = renderer.create(<AppUpdateOverlay />); });
  await act(async () => { listener(state); jest.setSystemTime(new Date("2026-09-23T01:02:00Z")); listener("active"); });
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
});

test("a rejected startup update check remains caught and removes its listener on unmount", async () => {
  Updates.checkForUpdateAsync.mockRejectedValue(new Error("offline"));
  await act(async () => { tree = renderer.create(<AppUpdateOverlay />); });
  expect(warn).toHaveBeenCalledWith("App update check/download failed", expect.any(Error));
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount()); tree = null;
  expect(remove).toHaveBeenCalledTimes(1);
});
