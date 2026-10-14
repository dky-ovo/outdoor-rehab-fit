import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform, StyleSheet } from "react-native";
import TabLayout from "../../app/(tabs)/_layout";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { Redirect, Tabs, router } from "expo-router";
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("expo-router", () => {
  const React = require("react");
  const Tabs = props => React.createElement("mock-protected-tabs", props);
  Tabs.Screen = () => null;
  return { Tabs, Redirect: () => null, router: { replace: jest.fn() } };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@expo/vector-icons/MaterialIcons", () => () => null);
jest.mock("../../components/HapticTab", () => ({ HapticTab: () => null }));
jest.mock("../../components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("../../components/ui/TabBarBackground", () => () => null);
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const screen = auth => <AuthContext.Provider value={auth}><LocaleContext.Provider value={{ i18n: { t: key => key } }}><TabLayout /></LocaleContext.Provider></AuthContext.Provider>;
let tree;
const originalPlatform = Platform.OS;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalPlatform; });
test.each([{ user: null, isLoading: false }, { user: undefined, isLoading: false }])("signed-out deep links redirect to login: %j", async auth => {
  await act(async () => { tree = renderer.create(screen(auth)); });
  expect(tree.root.findByType(Redirect).props.href).toBe("/login"); expect(tree.root.findAllByType(Tabs)).toHaveLength(0);
});
test("restoring auth never exposes a previously rendered account screen", async () => {
  await act(async () => { tree = renderer.create(screen({ user: { id: "old" }, isLoading: true })); });
  expect(tree.toJSON()).toBeNull(); expect(tree.root.findAllByType(Tabs)).toHaveLength(0);
});
test.each([{ id: "person", role: "user" }, { role: "guest", isGuest: true }])("both authenticated and explicit guest sessions keep normal tabs: %j", async user => {
  await act(async () => { tree = renderer.create(screen({ user, isLoading: false })); });
  expect(tree.root.findAllByType(Tabs)).toHaveLength(1); expect(tree.root.findAllByType(Redirect)).toHaveLength(0);
});
test("deletion removes the previous tab subtree immediately and keeps Back/deep-link entry gated", async () => {
  await act(async () => { tree = renderer.create(screen({ user: { id: "deleted" }, isLoading: false })); });
  const previous = tree.root.findByType(Tabs);
  await act(async () => tree.update(screen({ user: null, isLoading: false })));
  expect(tree.root.findAllByType(Tabs)).toHaveLength(0); expect(tree.root.findByType(Redirect).props.href).toBe("/login");
  await act(async () => tree.update(screen({ user: { id: "other" }, isLoading: false })));
  expect(tree.root.findByType(Tabs)).not.toBe(previous);
});

test.each(["android", "ios", "web"])("%s gives Settings a fixed parent layout and platform-specific keyboard handling", async platform => {
  Platform.OS = platform;
  await act(async () => { tree = renderer.create(screen({ user: { id: "person" }, isLoading: false })); });
  const screens = tree.root.findAllByType(Tabs.Screen);
  const setting = screens.find(item => item.props.name === "setting");
  expect(setting.props.options.headerShown).toBe(false);
  expect(setting.props.options.headerLeft).toBeUndefined();
  expect(setting.props.options.tabBarHideOnKeyboard).toBe(platform === "android");
  const favorite = screens.find(item => item.props.name === "favorite");
  expect(favorite.props.options.headerShown).toBe(false);
  expect(favorite.props.options.headerLeft).toBeUndefined();
  for (const name of ["other"]) {
    const options = screens.find(item => item.props.name === name).props.options;
    expect(options.headerShown).toBe(true);
    expect(options.headerLeft).toEqual(expect.any(Function));
    expect(options.tabBarHideOnKeyboard).toBeUndefined();
  }
});

test.each(["other", "exercise-videos"])("%s keeps its home return target with a labelled 44-point header button", async name => {
  Platform.OS = "ios";
  await act(async () => { tree = renderer.create(screen({ user: { id: "person" }, isLoading: false })); });
  const options = tree.root.findAllByType(Tabs.Screen).find(item => item.props.name === name).props.options;
  const button = options.headerLeft();
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(button.props.accessibilityRole).toBe("button");
  expect(button.props.accessibilityLabel).toBe("back");
  button.props.onPress();
  expect(router.replace).toHaveBeenLastCalledWith("/(tabs)");
});
