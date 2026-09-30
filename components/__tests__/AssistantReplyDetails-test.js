import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AssistantReplyDetails from "../AssistantReplyDetails";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 42, bottom: 30 }) }));

let tree;
const detail = { messageId: "historical-answer", text: "使用步驟\n1\n雙手握穩手柄。\n2\n保持肩膊放鬆。\n\n從中醫學角度：配合呼吸。\n\n如果疼痛加劇，請停止。" };
const onClose = jest.fn();
const render = async (value = detail, locale = "zh") => act(async () => {
  const screen = <AssistantReplyDetails detail={value} locale={locale} onClose={onClose} />;
  if (tree) tree.update(screen); else tree = renderer.create(screen);
});
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("closed reader renders nothing and does not reserve space over the chat", async () => {
  await render(null);
  expect(tree.toJSON()).toBeNull();
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
});

test.each(["zh", "en"])("%s reader shows the entire original explanation in an independent full-screen scroll area", async locale => {
  await render(detail, locale);
  const modal = tree.root.findByType(Modal);
  expect(modal.props).toMatchObject({ visible: true, presentationStyle: "fullScreen", animationType: "none" });
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.testID).toBe("assistant-reply-details-scroll");
  const text = scroll.findAllByType(Text).find(node => node.props.testID === "assistant-reply-details-text");
  expect(text.props.children).toBe(detail.text);
  expect(text.props.selectable).toBe(true);
  expect(text.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(text.props.style)).toMatchObject({ fontSize: 18, lineHeight: 30 });
  const page = tree.root.findAllByType(View).find(node => node.props.accessibilityViewIsModal);
  expect(StyleSheet.flatten(page.props.style)).toMatchObject({ paddingTop: 42, paddingBottom: 30 });
  const buttons = tree.root.findAllByType(TouchableOpacity);
  expect(buttons.map(node => node.props.testID)).toEqual(["assistant-reply-details-close", "assistant-reply-details-done"]);
  for (const button of buttons) {
    expect(button.props.accessibilityLabel).toBe(locale === "en" ? "Back to chat" : "返回對話");
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
    await act(async () => button.props.onPress());
  }
  await act(async () => modal.props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(3);
});

test("closing destroys the scrolled reader so reopening starts a fresh scroll instance", async () => {
  await render();
  const firstScroll = tree.root.findByType(ScrollView);
  await render(null);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  await render();
  expect(tree.root.findByType(ScrollView)).not.toBe(firstScroll);
  expect(tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-details-text").props.children).toBe(detail.text);
});

test("selecting a different message uses its own complete content and a fresh scroll instance", async () => {
  await render();
  const previousScroll = tree.root.findByType(ScrollView);
  const second = { messageId: "another-answer", text: "第二條回覆，並非之前的器材說明。" };
  await render(second);
  expect(tree.root.findByType(ScrollView)).not.toBe(previousScroll);
  expect(tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-details-text").props.children).toBe(second.text);
});
