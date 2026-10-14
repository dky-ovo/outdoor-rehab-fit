import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AssistantConversationHistory from "../AssistantConversationHistory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 42, bottom: 30 }) }));
const onClose = jest.fn();
const onDelete = jest.fn();
const onClearAll = jest.fn();
const longReply = "完整說明，不省略注意事項。\n".repeat(100);
const conversations = [
  { id: "older", title: "Earlier conversation", createdAt: "2026-09-20T10:00:00Z", messages: [] },
  { id: "newer", title: "最新對話", createdAt: "2026-09-21T10:00:00Z", updatedAt: "2026-09-22T10:00:00Z", messages: [
    { id: "a", sender: "ai", reply: longReply, createdAt: "2026-09-22T10:01:00Z" },
    { id: "u", role: "user", text: "膝蓋痛想查閱器材資料", createdAt: "2026-09-22T10:00:00Z" },
  ] },
];
let tree;
const render = async (extra = {}) => act(async () => {
  const screen = <AssistantConversationHistory visible locale="zh" conversations={conversations} onClose={onClose} onDelete={onDelete} onClearAll={onClearAll} {...extra} />;
  if (tree) tree.update(screen); else tree = renderer.create(screen);
});
const tap = async id => act(async () => tree.root.findAllByType(TouchableOpacity).find(item => item.props.testID === id).props.onPress());
const button = id => tree.root.findAllByType(TouchableOpacity).find(item => item.props.testID === id);
const allText = () => tree.root.findAllByType(Text).map(item => String(item.props.children)).join("\n");
beforeEach(() => { jest.clearAllMocks(); onDelete.mockReset(); onClearAll.mockReset(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("hidden reader has no overlay or active UI", async () => {
  await render({ visible: false }); expect(tree.toJSON()).toBeNull();
});
test.each(["zh", "en"])("%s history uses non-animated full-screen safe-area reader with explicit read-only scope", async locale => {
  await render({ locale });
  expect(tree.root.findByType(Modal).props).toMatchObject({ visible: true, presentationStyle: "fullScreen", animationType: "none" });
  const page = tree.root.findAllByType(View).find(item => item.props.accessibilityViewIsModal);
  expect(page.props.edges).toEqual(["top", "right", "bottom", "left"]);
  expect(StyleSheet.flatten(page.props.style).flex).toBe(1);
  expect(tree.root.findAllByType(Text).some(item => item.props.children === (locale === "en" ? "Conversation history (view only; not used in new conversations)" : "歷史對話（只供查看，不會用於新對話）"))).toBe(true);
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  for (const button of tree.root.findAllByType(TouchableOpacity)) expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(52);
});
test("list is newest-first without mutating caller data", async () => {
  const before = JSON.stringify(conversations); await render();
  expect(tree.root.findAllByType(TouchableOpacity).map(item => item.props.testID)).toEqual(["assistant-history-close", "assistant-history-clear-all", "assistant-history-open-newer", "assistant-history-delete-newer", "assistant-history-open-older", "assistant-history-delete-older"]);
  expect(JSON.stringify(conversations)).toBe(before);
});
test("selected conversation displays complete text in chronological order without send/resume controls", async () => {
  await render(); await tap("assistant-history-open-newer");
  const messages = tree.root.findAllByType(Text).filter(item => item.props.testID === "assistant-history-message-text");
  expect(messages.map(item => item.props.children)).toEqual(["膝蓋痛想查閱器材資料", longReply]);
  for (const message of messages) {
    expect(message.props.selectable).toBe(true); expect(message.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(message.props.style)).toMatchObject({ fontSize: 18, lineHeight: 30 });
  }
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(tree.root.findAllByType(TouchableOpacity).map(item => item.props.testID)).toEqual(["assistant-history-back", "assistant-history-close"]);
  expect(onClose).not.toHaveBeenCalled();
});
test("detail back returns to history list; Android close backs out safely then closes", async () => {
  await render(); const list = tree.root.findByType(ScrollView); await tap("assistant-history-open-newer");
  expect(tree.root.findByType(ScrollView)).not.toBe(list); await tap("assistant-history-back");
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  await tap("assistant-history-open-newer"); await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list"); expect(onClose).not.toHaveBeenCalled();
  await act(async () => tree.root.findByType(Modal).props.onRequestClose()); expect(onClose).toHaveBeenCalledTimes(1);
});
test("close and reopen starts at list with a fresh scroll instead of restoring detail position", async () => {
  await render(); await tap("assistant-history-open-newer"); const detail = tree.root.findByType(ScrollView);
  await tap("assistant-history-close"); expect(onClose).toHaveBeenCalledTimes(1);
  await render({ visible: false }); await render();
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list"); expect(tree.root.findByType(ScrollView)).not.toBe(detail);
});
test("loading and error states hide history, keep close action and never show raw errors", async () => {
  await render({ loading: true }); expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(tree.root.findAllByType(View).some(item => item.props.testID === "assistant-history-loading")).toBe(true);
  await render({ error: "PRIVATE_DIAGNOSTIC_DO_NOT_DISPLAY" }); expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).some(item => String(item.props.children).includes("PRIVATE_DIAGNOSTIC"))).toBe(false);
  await tap("assistant-history-close"); expect(onClose).toHaveBeenCalledTimes(1);
});
test("empty history and empty conversation have readable independent states", async () => {
  await render({ conversations: [] }); expect(tree.root.findAllByType(Text).some(item => item.props.testID === "assistant-history-empty")).toBe(true);
  await render(); await tap("assistant-history-open-older");
  expect(tree.root.findAllByType(Text).some(item => item.props.testID === "assistant-history-empty-conversation")).toBe(true);
});
test("legacy messages without timestamps retain their original order and stale selected IDs return to list", async () => {
  const old = [{ id: "legacy", createdAt: "bad-date", messages: [{ text: "first", sender: "user" }, { reply: "second", sender: "ai" }] }];
  await render({ conversations: old }); await tap("assistant-history-open-legacy");
  expect(tree.root.findAllByType(Text).filter(item => item.props.testID === "assistant-history-message-text").map(item => item.props.children)).toEqual(["first", "second"]);
  await render({ conversations: [] }); expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  await render({ conversations: old }); expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
});

test.each(["zh", "en"])("%s separate delete button opens one scoped confirmation, not the detail or another modal", async locale => {
  await render({ locale });
  for (const node of tree.root.findAllByType(TouchableOpacity)) expect(node.findAllByType(TouchableOpacity)).toHaveLength(1);
  await tap("assistant-history-delete-newer");
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-delete-confirmation");
  expect(allText()).not.toContain(longReply);
  expect(allText()).toContain(locale === "en" ? "Delete this conversation?" : "刪除這段歷史對話？");
  expect(allText()).toContain(locale === "en" ? "for this account and syncs the deletion to other devices when online" : "此帳戶的所選歷史對話，並在連線後同步至其他裝置");
  expect(allText()).toContain(locale === "en" ? "It cannot be undone" : "刪除後無法恢復");
  expect(allText()).toContain(locale === "en" ? "Active conversations, other history and other accounts are not affected" : "進行中的對話、其他歷史對話和其他帳戶不受影響");
  expect(onDelete).not.toHaveBeenCalled();
  await tap("assistant-history-delete-cancel");
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  expect(onDelete).not.toHaveBeenCalled(); expect(onClearAll).not.toHaveBeenCalled();
});

test("confirm only targets one historical ID and waits for parent-confirmed removal", async () => {
  const before = JSON.stringify(conversations);
  await render(); await tap("assistant-history-delete-newer"); await tap("assistant-history-delete-confirm");
  expect(onDelete).toHaveBeenCalledWith("newer"); expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onClearAll).not.toHaveBeenCalled(); expect(JSON.stringify(conversations)).toBe(before);
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-delete-confirmation");
  await render({ conversations: conversations.filter(item => item.id !== "newer") });
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  expect(button("assistant-history-open-newer")).toBeUndefined(); expect(button("assistant-history-open-older")).toBeDefined();
});

test.each(["zh", "en"])("%s clearing all history requires its own confirmation and resets when emptied", async locale => {
  await render({ locale }); await tap("assistant-history-clear-all");
  expect(allText()).toContain(locale === "en" ? "Clear the conversations in this history list?" : "清空此列表的歷史對話？");
  expect(allText()).toContain(locale === "en" ? "conversations that can be deleted from this history list" : "本列表中可刪除的中英文歷史對話");
  expect(allText()).toContain(locale === "en" ? "Active conversations, history outside this list and other accounts are not affected" : "進行中的對話、未列出的歷史對話和其他帳戶不受影響");
  expect(onClearAll).not.toHaveBeenCalled();
  await tap("assistant-history-delete-cancel"); expect(onClearAll).not.toHaveBeenCalled();
  await tap("assistant-history-clear-all"); await tap("assistant-history-delete-confirm");
  expect(onClearAll).toHaveBeenCalledTimes(1); expect(onClearAll).toHaveBeenCalledWith(); expect(onDelete).not.toHaveBeenCalled();
  await render({ locale, conversations: [] });
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  expect(button("assistant-history-clear-all").props.disabled).toBe(true);
  await tap("assistant-history-clear-all"); expect(onClearAll).toHaveBeenCalledTimes(1);
});

test.each(['zh', 'en'])('%s history omits provider and model metadata without changing messages or deletion scope', async locale => {
  const source = [{ ...conversations[1], provider: 'deepseek', messages: [{ id: 'answer', sender: 'ai', model: 'deepseek-v4-flash', reply: '完整回答。' }] }];
  const before = JSON.stringify(source);
  await render({ locale, providerLabel: 'DeepSeek / 阿里百煉', conversations: source });
  expect(allText()).not.toMatch(/DeepSeek|百煉|Bailian|deepseek-v4-flash/);
  expect(tree.root.findAllByProps({ testID: 'assistant-history-provider' })).toHaveLength(0);
  await tap('assistant-history-open-newer');
  expect(allText()).toContain('完整回答。'); expect(allText()).not.toContain('deepseek-v4-flash');
  await tap('assistant-history-back'); await tap('assistant-history-clear-all');
  expect(allText()).not.toMatch(/DeepSeek|百煉|Bailian|deepseek-v4-flash/);
  expect(allText()).not.toContain(locale === 'en' ? 'all history in Chinese and English for this account' : '此帳戶中英文的全部歷史對話');
  await tap('assistant-history-delete-confirm'); expect(onClearAll).toHaveBeenCalledWith();
  expect(JSON.stringify(source)).toBe(before);
});

test("deleting disables destructive actions but still permits closing the history window", async () => {
  await render({ deleting: true });
  expect(button("assistant-history-clear-all").props.disabled).toBe(true);
  expect(button("assistant-history-delete-newer").props.disabled).toBe(true);
  await tap("assistant-history-delete-newer"); await tap("assistant-history-clear-all");
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  await render(); await tap("assistant-history-delete-newer"); await render({ deleting: true });
  expect(button("assistant-history-delete-confirm").props.disabled).toBe(true);
  await tap("assistant-history-delete-confirm"); expect(onDelete).not.toHaveBeenCalled();
  await tap("assistant-history-close"); expect(onClose).toHaveBeenCalledTimes(1);
});

test("failed deletion keeps existing data visible and confirmation can retry without displaying raw errors", async () => {
  onDelete.mockResolvedValue(false);
  await render(); await tap("assistant-history-delete-newer"); await tap("assistant-history-delete-confirm");
  await render({ deleteError: "PRIVATE_STORAGE_PATH_OR_ACCOUNT" });
  expect(allText()).not.toContain("PRIVATE_STORAGE_PATH_OR_ACCOUNT");
  expect(allText()).toContain("本機歷史對話仍然保留");
  expect(button("assistant-history-delete-confirm").props.disabled).toBe(false);
  await tap("assistant-history-delete-confirm"); expect(onDelete).toHaveBeenCalledTimes(2);
  await tap("assistant-history-delete-cancel");
  expect(button("assistant-history-open-newer")).toBeDefined(); expect(button("assistant-history-open-older")).toBeDefined();
});

test("a pending confirmation callback is protected against same-frame duplicate taps", async () => {
  let finish;
  onDelete.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await tap("assistant-history-delete-newer");
  const confirm = button("assistant-history-delete-confirm").props.onPress;
  let first, second;
  await act(async () => { first = confirm(); second = confirm(); });
  expect(onDelete).toHaveBeenCalledTimes(1);
  await act(async () => { finish(false); await Promise.all([first, second]); });
});

test("Android back cancels an unsubmitted confirmation; hiding clears it before reopening", async () => {
  await render(); await tap("assistant-history-delete-newer");
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  expect(onDelete).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  await tap("assistant-history-clear-all"); await render({ visible: false }); await render();
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  expect(onClearAll).not.toHaveBeenCalled();
});

test("deleting the selected conversation externally returns the detail reader to the list", async () => {
  await render(); await tap("assistant-history-open-newer");
  await render({ conversations: conversations.filter(item => item.id !== "newer") });
  expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
  await render(); expect(tree.root.findByType(ScrollView).props.testID).toBe("assistant-history-list");
});

test('both language histories are readable while an active composer in the other language cannot be deleted', async () => {
  await render({conversations:[{...conversations[0],id:'en:shared-id',locale:'en',canDelete:false},{...conversations[1],id:'zh:shared-id',locale:'zh',canDelete:true}]});
  expect(button('assistant-history-delete-en:shared-id').props.disabled).toBe(true);
  expect(button('assistant-history-delete-zh:shared-id').props.disabled).toBe(false);
  await tap('assistant-history-delete-en:shared-id');
  expect(tree.root.findByType(ScrollView).props.testID).toBe('assistant-history-list');
  await tap('assistant-history-open-en:shared-id');
  expect(tree.root.findByType(ScrollView).props.testID).toBe('assistant-history-messages');
});
