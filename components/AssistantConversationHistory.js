import { appText } from "../utils/appText";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ModalSafeAreaView from './ModalSafeAreaView';
import { RFValue } from "react-native-responsive-fontsize";

const timestamp = value => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
function displayDate(value, en) {
  const time = timestamp(value);
  if (time === null) return appText(en ? "en" : "zh", "inline.assistantHistory.dateUnavailable", {"zh":"未有日期","en":"Date unavailable"});
  return new Date(time).toLocaleString(en ? "en-GB" : "zh-HK", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// Parent supplies safely formatted historical answers. This reader deliberately
// has no send, resume, speech, network, or active-chat-context callbacks.
export default function AssistantConversationHistory({ visible, locale, conversations = [], onClose, loading = false, error = null, onDelete, onClearAll, deleting = false, deleteError = null }) {
  const [selectedId, setSelectedId] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const confirming = useRef(false);
  const en = locale === "en";
  useEffect(() => { if (!visible) { setSelectedId(null); setConfirmation(null); } }, [visible]);
  const ordered = useMemo(() => (Array.isArray(conversations) ? conversations : [])
    .filter(item => item && item.id !== undefined && item.id !== null)
    .map((item, index) => ({ item, index, time: timestamp(item.updatedAt) ?? timestamp(item.createdAt) ?? 0 }))
    .sort((a, b) => b.time - a.time || a.index - b.index).map(({ item }) => item), [conversations]);
  useEffect(() => {
    if (selectedId !== null && !ordered.some(item => item.id === selectedId)) setSelectedId(null);
    if (confirmation && (confirmation.kind === "all" ? !ordered.length : !ordered.some(item => item.id === confirmation.id))) setConfirmation(null);
  }, [ordered, selectedId, confirmation]);
  const selected = selectedId === null ? null : ordered.find(item => item.id === selectedId);
  const messages = useMemo(() => (Array.isArray(selected?.messages) ? selected.messages : [])
    .map((item, index) => ({ item, index, time: timestamp(item?.createdAt) ?? timestamp(item?.timestamp) }))
    .filter(({ item }) => item && typeof (item.text || item.reply) === "string")
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time || a.index - b.index;
    }).map(({ item }) => item), [selected]);
  if (!visible) return null;
  const close = () => { setSelectedId(null); setConfirmation(null); onClose?.(); };
  const closeLabel = appText(en ? "en" : "zh", "inline.assistantHistory.closeHistory", {"zh":"關閉歷史對話","en":"Close history"});
  const backLabel = appText(en ? "en" : "zh", "inline.assistantHistory.backToHistoryList", {"zh":"返回歷史列表","en":"Back to history list"});
  const title = appText(en ? "en" : "zh", "inline.assistantHistory.conversationHistoryViewOnlyNotUsedInNew", {"zh":"歷史對話（只供查看，不會用於新對話）","en":"Conversation history (view only; not used in new conversations)"});
  const busy = loading || Boolean(error);
  const deleteLabel = appText(en ? "en" : "zh", "inline.assistantHistory.delete", {"zh":"刪除","en":"Delete"});
  const clearLabel = appText(en ? "en" : "zh", "inline.assistantHistory.clearHistory", {"zh":"清空歷史對話","en":"Clear history"});
  const canDelete = !deleting && typeof onDelete === "function";
  const canClear = !deleting && ordered.some(item => item.canDelete !== false) && typeof onClearAll === "function";
  const confirmDelete = async () => {
    if (!confirmation || deleting || confirming.current) return;
    const action = confirmation.kind === "all" ? onClearAll : onDelete;
    if (typeof action !== "function") return;
    confirming.current = true;
    try { await (confirmation.kind === "all" ? action() : action(confirmation.id)); }
    catch { /* Parent owns the error message and keeps the stored history intact. */ }
    finally { confirming.current = false; }
  };
  const requestClose = confirmation && !busy
    ? (deleting ? close : () => setConfirmation(null))
    : selected && !busy ? () => setSelectedId(null) : close;
  return <Modal testID="assistant-conversation-history-modal" visible animationType="none" presentationStyle="fullScreen" onRequestClose={requestClose}>
    <ModalSafeAreaView accessibilityViewIsModal style={styles.page}>
      <View style={styles.header}>
        <View style={styles.toolbar}>
          {selected && !busy && !confirmation ? <TouchableOpacity testID="assistant-history-back" onPress={() => setSelectedId(null)} accessibilityRole="button" accessibilityLabel={backLabel} style={styles.back}>
            <Ionicons name="chevron-back" size={26} color="#840B1C" /><Text style={styles.buttonText}>{backLabel}</Text>
          </TouchableOpacity> : <View style={styles.toolbarSpacer} />}
          <TouchableOpacity testID="assistant-history-close" onPress={close} accessibilityRole="button" accessibilityLabel={closeLabel} style={styles.close}>
            <Ionicons name="close" size={26} color="#840B1C" /><Text style={styles.buttonText}>{appText(en ? "en" : "zh", "inline.assistantHistory.close", {"zh":"關閉","en":"Close"})}</Text>
          </TouchableOpacity>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {deleteError && <Text testID="assistant-history-delete-error" accessibilityRole="alert" style={styles.deleteError}>{appText(en ? "en" : "zh", "inline.assistantHistory.historyCouldNotBeDeletedItHasBeen", {"zh":"暫時無法刪除，本機歷史對話仍然保留，請重試。","en":"History could not be deleted. It has been kept on this device. Please try again."})}</Text>}
      </View>
      {loading ? <View testID="assistant-history-loading" style={styles.state} accessibilityRole="progressbar" accessibilityLabel={appText(en ? "en" : "zh", "inline.assistantHistory.loadingHistory", {"zh":"正在載入歷史對話","en":"Loading history"})}>
        <ActivityIndicator size="large" color="#840B1C" /><Text style={styles.stateText}>{appText(en ? "en" : "zh", "inline.assistantHistory.loadingHistory62e9fd", {"zh":"正在載入歷史對話…","en":"Loading history…"})}</Text>
      </View> : error ? <View testID="assistant-history-error" style={styles.state}>
        <Text accessibilityRole="alert" style={styles.stateText}>{appText(en ? "en" : "zh", "inline.assistantHistory.historyCouldNotBeLoadedCloseThisPage", {"zh":"暫時無法載入歷史對話，請關閉後再試。","en":"History could not be loaded. Close this page and try again."})}</Text>
      </View> : confirmation ? <ScrollView key="delete-confirmation" testID="assistant-history-delete-confirmation" style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.conversationTitle}>{confirmation.kind === "all" ? (appText(en ? "en" : "zh", "inline.assistantHistory.clearListedConversations", {"zh":"清空此列表的歷史對話？","en":"Clear the conversations in this history list?"})) : (appText(en ? "en" : "zh", "inline.assistantHistory.deleteThisConversation", {"zh":"刪除這段歷史對話？","en":"Delete this conversation?"}))}</Text>
        {confirmation.kind === "one" && <Text style={styles.confirmationName}>{confirmation.title}</Text>}
        <Text style={styles.confirmationText}>{confirmation.kind === "all"
          ? appText(locale, "inline.assistantHistory.clearListedAccountWarning", { zh: "這會永久刪除此帳戶在本列表中可刪除的中英文歷史對話，並在連線後同步至其他裝置。刪除後無法恢復；進行中的對話、未列出的歷史對話和其他帳戶不受影響。", en: "This permanently deletes this account's Chinese and English conversations that can be deleted from this history list. The deletion syncs to other devices when online and cannot be undone. Active conversations, history outside this list and other accounts are not affected." })
          : appText(locale, "inline.assistantHistory.deleteAccountWarning", { zh: "這會永久刪除此帳戶的所選歷史對話，並在連線後同步至其他裝置。刪除後無法恢復；進行中的對話、其他歷史對話和其他帳戶不受影響。", en: "This permanently deletes the selected conversation for this account and syncs the deletion to other devices when online. It cannot be undone. Active conversations, other history and other accounts are not affected." })}</Text>
        {deleting && <View testID="assistant-history-deleting" style={styles.deleting} accessibilityRole="progressbar" accessibilityLabel={appText(en ? "en" : "zh", "inline.assistantHistory.deletingHistory", {"zh":"正在刪除歷史對話","en":"Deleting history"})}><ActivityIndicator color="#840B1C" /><Text style={styles.buttonText}>{appText(en ? "en" : "zh", "inline.assistantHistory.deleting", {"zh":"正在刪除…","en":"Deleting…"})}</Text></View>}
        <View style={styles.confirmationActions}>
          <TouchableOpacity testID="assistant-history-delete-cancel" accessibilityRole="button" accessibilityLabel={appText(en ? "en" : "zh", "inline.assistantHistory.cancelDeletion", {"zh":"取消刪除","en":"Cancel deletion"})} disabled={deleting} accessibilityState={{ disabled: deleting }} style={[styles.cancelButton, deleting && styles.disabled]} onPress={() => { if (!deleting) setConfirmation(null); }}><Text style={styles.buttonText}>{appText(en ? "en" : "zh", "inline.assistantHistory.cancel", {"zh":"取消","en":"Cancel"})}</Text></TouchableOpacity>
          <TouchableOpacity testID="assistant-history-delete-confirm" accessibilityRole="button" accessibilityLabel={confirmation.kind === "all" ? (appText(en ? "en" : "zh", "inline.assistantHistory.confirmClearingHistory", {"zh":"確認清空歷史對話","en":"Confirm clearing history"})) : (appText(en ? "en" : "zh", "inline.assistantHistory.confirmDeletion", {"zh":"確認刪除","en":"Confirm deletion"}))} disabled={deleting} accessibilityState={{ disabled: deleting }} style={[styles.confirmButton, deleting && styles.disabled]} onPress={confirmDelete}><Text style={styles.confirmButtonText}>{confirmation.kind === "all" ? (appText(en ? "en" : "zh", "inline.assistantHistory.clearHistory", {"zh":"清空歷史對話","en":"Clear history"})) : (appText(en ? "en" : "zh", "inline.assistantHistory.deletePermanently", {"zh":"永久刪除","en":"Delete permanently"}))}</Text></TouchableOpacity>
        </View>
      </ScrollView> : selected ? <ScrollView key={`conversation:${selected.id}`} testID="assistant-history-messages" style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.conversationTitle}>{selected.title || (appText(en ? "en" : "zh", "inline.assistantHistory.conversation", {"zh":"對話","en":"Conversation"}))}</Text>
        <Text style={styles.date}>{displayDate(selected.updatedAt || selected.createdAt, en)}</Text>
        {messages.length ? messages.map((message, index) => {
          const user = message.sender === "user" || message.role === "user";
          return <View key={`${message.id ?? "message"}:${index}`} testID="assistant-history-message" style={[styles.message, user ? styles.userMessage : styles.assistantMessage]}>
            <Text style={styles.speaker}>{user ? (appText(en ? "en" : "zh", "inline.assistantHistory.you", {"zh":"您","en":"You"})) : (appText(en ? "en" : "zh", "inline.assistantHistory.aiAssistant", {"zh":"AI 助手","en":"AI assistant"}))}</Text>
            <Text testID="assistant-history-message-text" selectable style={styles.text}>{message.text || message.reply}</Text>
          </View>;
        }) : <Text testID="assistant-history-empty-conversation" style={styles.stateText}>{appText(en ? "en" : "zh", "inline.assistantHistory.noMessagesWereSavedInThisConversation", {"zh":"這個對話未有已儲存的訊息。","en":"No messages were saved in this conversation."})}</Text>}
      </ScrollView> : <ScrollView key="history-list" testID="assistant-history-list" style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity testID="assistant-history-clear-all" accessibilityRole="button" accessibilityLabel={clearLabel} accessibilityState={{ disabled: !canClear }} disabled={!canClear} style={[styles.clearButton, !canClear && styles.disabled]} onPress={() => { if (canClear) setConfirmation({ kind: "all" }); }}><Ionicons name="trash-outline" size={23} color="#840B1C" /><Text style={styles.buttonText}>{clearLabel}</Text></TouchableOpacity>
        {ordered.length ? ordered.map((conversation, index) => <View key={`${conversation.id}:${index}`} style={styles.row}>
          <TouchableOpacity testID={`assistant-history-open-${conversation.id}`} onPress={() => setSelectedId(conversation.id)} accessibilityRole="button" accessibilityLabel={`${conversation.title || (appText(en ? "en" : "zh", "inline.assistantHistory.conversation", {"zh":"對話","en":"Conversation"}))}, ${displayDate(conversation.updatedAt || conversation.createdAt, en)}`} style={styles.openButton}>
            <View style={styles.rowContent}><Text style={styles.conversationTitle}>{conversation.title || (appText(en ? "en" : "zh", "inline.assistantHistory.conversation", {"zh":"對話","en":"Conversation"}))}</Text><Text style={styles.date}>{displayDate(conversation.updatedAt || conversation.createdAt, en)}</Text></View>
            <Ionicons name="chevron-forward" size={24} color="#840B1C" />
          </TouchableOpacity>
          <TouchableOpacity testID={`assistant-history-delete-${conversation.id}`} accessibilityRole="button" accessibilityLabel={`${deleteLabel} ${conversation.title || (appText(en ? "en" : "zh", "inline.assistantHistory.conversation679821", {"zh":"歷史對話","en":"conversation"}))}`} accessibilityState={{ disabled: !canDelete || conversation.canDelete === false }} disabled={!canDelete || conversation.canDelete === false} style={[styles.deleteButton, (!canDelete || conversation.canDelete === false) && styles.disabled]} onPress={() => { if (canDelete && conversation.canDelete !== false) setConfirmation({ kind: "one", id: conversation.id, title: conversation.title || (appText(en ? "en" : "zh", "inline.assistantHistory.conversation", {"zh":"對話","en":"Conversation"})) }); }}><Ionicons name="trash-outline" size={22} color="#840B1C" /><Text style={styles.buttonText}>{deleteLabel}</Text></TouchableOpacity>
        </View>) : <Text testID="assistant-history-empty" style={styles.stateText}>{appText(en ? "en" : "zh", "inline.assistantHistory.noPreviousConversationsYet", {"zh":"暫時未有歷史對話。","en":"No previous conversations yet."})}</Text>}
      </ScrollView>}
    </ModalSafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E8D9DC" },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  toolbarSpacer: { flex: 1 },
  back: { minHeight: 52, flex: 1, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingRight: 12 },
  close: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 6, marginLeft: "auto" },
  buttonText: { flexShrink: 1, color: "#840B1C", fontSize: Math.max(18, RFValue(13)), fontWeight: "700" },
  title: { color: "#292929", fontSize: Math.max(21, RFValue(16)), fontWeight: "800", paddingVertical: 8 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 30 },
  row: { borderRadius: 12, borderWidth: 1, borderColor: "#E8D9DC", marginBottom: 14, backgroundColor: "#FFFAFB", overflow: "hidden" },
  openButton: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  deleteButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E8D9DC" },
  clearButton: { minHeight: 52, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E8D9DC", marginBottom: 20 },
  confirmationName: { color: "#686868", fontSize: Math.max(19, RFValue(14)), lineHeight: Math.max(29, RFValue(21)), marginTop: 12 },
  confirmationText: { color: "#292929", fontSize: Math.max(18, RFValue(13)), lineHeight: Math.max(30, RFValue(22)), marginTop: 18 },
  confirmationActions: { marginTop: 24, gap: 14 },
  cancelButton: { minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#E8D9DC", padding: 14 },
  confirmButton: { minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#840B1C", padding: 14 },
  confirmButtonText: { color: "#fff", fontSize: Math.max(18, RFValue(13)), fontWeight: "700", textAlign: "center" },
  deleteError: { color: "#8E361D", fontSize: Math.max(17, RFValue(12)), lineHeight: Math.max(27, RFValue(20)), paddingVertical: 8 },
  deleting: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 },
  disabled: { opacity: 0.45 },
  rowContent: { flex: 1 },
  conversationTitle: { color: "#292929", fontSize: Math.max(19, RFValue(14)), lineHeight: Math.max(29, RFValue(21)), fontWeight: "700" },
  date: { color: "#686868", fontSize: Math.max(16, RFValue(12)), marginTop: 6, marginBottom: 4 },
  message: { padding: 16, marginTop: 16, borderRadius: 12 },
  userMessage: { backgroundColor: "#F7E6EB", marginLeft: 16 },
  assistantMessage: { backgroundColor: "#F6F6F6", marginRight: 16 },
  speaker: { color: "#840B1C", fontSize: Math.max(17, RFValue(12)), fontWeight: "700", marginBottom: 8 },
  text: { color: "#292929", fontSize: Math.max(18, RFValue(13)), lineHeight: Math.max(30, RFValue(22)) },
  state: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 18 },
  stateText: { color: "#686868", fontSize: Math.max(18, RFValue(13)), lineHeight: Math.max(30, RFValue(22)), textAlign: "center", paddingVertical: 16 },
});
