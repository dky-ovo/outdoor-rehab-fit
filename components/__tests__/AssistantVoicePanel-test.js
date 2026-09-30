import React from "react";
import renderer, { act } from "react-test-renderer";
import { Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import AssistantVoiceInput from "../AssistantVoiceInput";
import { assistantVoiceCopy } from "../../constants/AssistantVoice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockDimensions = { width: 320, height: 568 };
jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  return Object.defineProperty(Object.create(native), "useWindowDimensions", { value: () => mockDimensions, enumerable: true });
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test.each([[568, false, 198.8], [320, true, 80], [568, true, 142], [844, true, 160]])("voice panel fits a %ipx window with keyboard=%s and all controls remain scroll-accessible", async (height, keyboardVisible, cap) => {
  mockDimensions = { width: 320, height };
  const insert = jest.fn(), discard = jest.fn();
  await act(async () => { tree = renderer.create(<AssistantVoiceInput locale="zh" status="idle" keyboardVisible={keyboardVisible}
    errorCode="limit" candidate={"較長的語音文字。".repeat(80)} onInsert={insert} onDiscard={discard} />); });
  const panel = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(panel.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 1 });
  expect(StyleSheet.flatten(panel.props.style).maxHeight).toBeCloseTo(cap);
  expect(panel.props.keyboardShouldPersistTaps).toBe("handled");
  expect(panel.props.nestedScrollEnabled).toBe(true);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(1);
  const buttons = panel.findAllByType(TouchableOpacity);
  await act(async () => buttons.find(button => button.props.testID === "assistant-voice-insert").props.onPress());
  await act(async () => buttons.find(button => button.props.testID === "assistant-voice-discard").props.onPress());
  expect(insert).toHaveBeenCalledTimes(1); expect(discard).toHaveBeenCalledTimes(1);
  // Full candidate remains available by scrolling rather than being truncated.
  const text = panel.findAllByType(Text).find(node => node.props.testID === "assistant-voice-candidate");
  expect(text.props.numberOfLines).toBeUndefined();
});

test.each(["missingNativeModule", "speechServiceUnavailable", "languageUnavailable", "browserUnavailable"])("%s has a distinct actionable explanation and preserves keyboard fallback", async errorCode => {
  await act(async () => { tree = renderer.create(<AssistantVoiceInput locale="zh" status="idle" errorCode={errorCode} />); });
  const error = tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-voice-error");
  expect(error.props.children).toBe(assistantVoiceCopy("zh")[errorCode]);
  expect(error.props.children).toContain("鍵盤");
  if (errorCode !== "missingNativeModule") expect(error.props.children).not.toContain("新版 APP 安裝包");
  expect(tree.root.findAll(node => node.props.testID === "assistant-voice-settings")).toHaveLength(0);
});

test("diagnostics disclose only installed version and device speech capabilities on explicit expansion", async () => {
  const diagnostics = { installedVersion: "1.1.9", installedBuild: "12", platform: "android", osVersion: "31", nativeModule: "available", speechService: "unavailable", language: "yue-Hant-HK", transcript: "must not display", token: "must not display" };
  await act(async () => { tree = renderer.create(<AssistantVoiceInput locale="zh" status="idle" errorCode="speechServiceUnavailable" diagnostics={diagnostics} />); });
  expect(tree.root.findAll(node => node.props.testID === "assistant-voice-diagnostics")).toHaveLength(0);
  const toggle = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-voice-diagnostics-toggle");
  await act(async () => toggle().props.onPress());
  const serialized = JSON.stringify(tree.toJSON());
  for (const value of ["1.1.9", "12", "android / 31", "yue-Hant-HK"]) expect(serialized).toContain(value);
  expect(serialized).not.toContain("must not display");
  await act(async () => toggle().props.onPress());
  expect(tree.root.findAll(node => node.props.testID === "assistant-voice-diagnostics")).toHaveLength(0);
});

test("permission settings are opened only by the user and a failed settings handoff stays usable", async () => {
  const previousPlatform = Platform.OS; Platform.OS = "android";
  const openSettings = jest.spyOn(Linking, "openSettings").mockRejectedValue(new Error("not available"));
  try {
    await act(async () => { tree = renderer.create(<AssistantVoiceInput locale="en" status="idle" errorCode="permissionDenied" />); });
    expect(openSettings).not.toHaveBeenCalled();
    const settings = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-voice-settings");
    await act(async () => settings.props.onPress());
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain(assistantVoiceCopy("en").settingsFailed);
  } finally { Platform.OS = previousPlatform; }
});
