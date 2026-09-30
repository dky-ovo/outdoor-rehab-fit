import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import AssistantReplySpeechControls, { AssistantReplyReadButton } from "../AssistantReplySpeechControls";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
let tree;
const speech = overrides => ({ status: "idle", activeMessageId: null, errorCode: null, autoRead: true, setAutoRead: jest.fn(), stop: jest.fn(), ...overrides });
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const mount = component => act(() => { tree = renderer.create(component); });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

test.each(["zh", "en"])("%s automatic-read control is an accessible on/off switch", locale => {
  const model = speech();
  mount(<AssistantReplySpeechControls locale={locale} speech={model} />);
  const toggle = button("assistant-auto-read");
  expect(toggle.props.accessibilityRole).toBe("switch");
  expect(toggle.props.accessibilityState.checked).toBe(true);
  act(() => toggle.props.onPress());
  expect(model.setAutoRead).toHaveBeenCalledWith(false);
});

test.each(["loading", "speaking"])("%s can be stopped from the global control", status => {
  const model = speech({ status, activeMessageId: "a" });
  mount(<AssistantReplySpeechControls locale="zh" speech={model} />);
  act(() => button("assistant-stop-reading").props.onPress());
  expect(model.stop).toHaveBeenCalledTimes(1);
});

test.each(["zh", "en"])("%s unavailable voice explains offline voice installation without hiding the reply", locale => {
  mount(<AssistantReplySpeechControls locale={locale} speech={speech({ errorCode: "voiceUnavailable" })} />);
  const error = tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-speech-error");
  expect(error.props.children).toMatch(locale === "en" ? /offline English/ : /離線粵語/);
  expect(error.props.accessibilityLiveRegion).toBe("polite");
});

test.each(["zh", "en"])("%s missing native module hides only the installation notice without reserving blank space", locale => {
  const model = speech();
  mount(<AssistantReplySpeechControls locale={locale} speech={model} />);
  const normalLayout = JSON.stringify(tree.toJSON());
  act(() => tree.update(<AssistantReplySpeechControls locale={locale} speech={{ ...model, errorCode: "missingNativeModule" }} />));
  expect(tree.root.findAllByType(Text).some(node => node.props.testID === "assistant-reply-speech-error")).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toBe(normalLayout);
  act(() => button("assistant-auto-read").props.onPress());
  expect(model.setAutoRead).toHaveBeenCalledWith(false);
});

test.each(["zh", "en"])("%s genuine playback failure remains visible", locale => {
  mount(<AssistantReplySpeechControls locale={locale} speech={speech({ errorCode: "playbackFailed" })} />);
  const error = tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-speech-error");
  expect(error.props.children).toMatch(locale === "en" ? /could not be read aloud/ : /暫時無法朗讀/);
});

test("read passes only the supplied visible text and message ID", () => {
  const onRead = jest.fn();
  mount(<AssistantReplyReadButton locale="zh" speech={speech()} messageId="a1" text="可見簡短回答" onRead={onRead} />);
  act(() => button("assistant-read-a1").props.onPress());
  expect(onRead).toHaveBeenCalledWith("a1", "可見簡短回答");
});

test("suppressing the missing-module notice does not change the per-reply read button", () => {
  const onRead = jest.fn();
  mount(<AssistantReplyReadButton locale="zh" speech={speech({ errorCode: "missingNativeModule" })} messageId="a1" text="可見簡短回答" onRead={onRead} />);
  expect(button("assistant-read-a1").props.disabled).toBe(false);
  act(() => button("assistant-read-a1").props.onPress());
  expect(onRead).toHaveBeenCalledWith("a1", "可見簡短回答");
});

test.each(["loading", "speaking"])("the active %s reply button stops instead of restarting", status => {
  const onRead = jest.fn(), model = speech({ activeMessageId: "a1", status });
  mount(<AssistantReplyReadButton locale="en" speech={model} messageId="a1" text="Visible text" onRead={onRead} disabled />);
  expect(button("assistant-read-a1").props.disabled).toBe(false);
  act(() => button("assistant-read-a1").props.onPress());
  expect(model.stop).toHaveBeenCalledTimes(1);
  expect(onRead).not.toHaveBeenCalled();
});

test.each([["", false], ["  ", false], [null, false], ["A reply", true]])("empty or blocked text %j disables playback", (text, disabled) => {
  mount(<AssistantReplyReadButton locale="en" speech={speech()} messageId="a1" text={text} disabled={disabled} onRead={jest.fn()} />);
  expect(button("assistant-read-a1").props.disabled).toBe(true);
});

test("unrecognized playback failure is honest and never renders raw diagnostic data", () => {
  mount(<AssistantReplySpeechControls locale="zh" speech={speech({ errorCode: "private-server-path" })} />);
  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain("暫時無法朗讀");
  expect(serialized).not.toContain("private-server-path");
});
