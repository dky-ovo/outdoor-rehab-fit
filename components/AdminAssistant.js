import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { previewAdminAssistant, sendAdminAssistant } from "../utils/adminAssistantApi";

const COPY = {
  "zh-CN": {
    title: "AI 助手", welcome: "有什么可以帮你？", intro: "查找已发布的设施教学，或将你选择的教学资料整理成清晰草稿。",
    draftOnly: "只读 · 仅生成草稿", privacy: "请勿输入参与者资料、姓名电话、密码、密钥、反馈或运动记录。检测到敏感内容会拒绝发送。",
    document: "本次选择的公开教学文档（可选）", documentHint: "粘贴已审核、不含个人资料的教学文字，最多 30000 字。",
    addDocument: "添加教学资料", selectedDocument: "已添加教学资料", hideDocument: "收起资料", documentCount: count => `${count.toLocaleString()} / 30,000 字`,
    message: "本次整理要求", messageHint: "输入你的问题，或描述想整理的教学内容…", preview: "检查并预览发送范围", sendingHint: "发送前会先预览范围，由你确认。",
    searchPrompt: "查找设施教学", searchRequest: "请检索太极揉推器的使用说明，并整理为操作要点。", organisePrompt: "整理教学资料", organiseRequest: "请将本次选择的教学资料整理成清晰的分点草稿。",
    confirm: "确认发送至 DeepSeek", edit: "返回修改", clearDocument: "移除文档", clear: "清空对话", summary: "发送前确认",
    recipient: "接收方：DeepSeek。范围：本次问题、下列历史条数、已选择文档，以及只读设施教学检索。",
    counts: s => `问题 ${s.messageCharacters} 字 · 历史 ${s.historyMessages} 条 · 文档 ${s.documentCharacters} 字`,
    noWrites: "不会发送账号、权限或其他数据库内容；没有写库、保存或发布权限。", draft: "待人工审核的草稿（尚未发布）", refs: "已查阅设施", busy: "正在处理…",
    sensitive: "检测到敏感信息或受限操作。请移除个人资料、联系方式、密钥等内容后重新检查。不会自动脱敏并发送。",
    expired: "预览已过期或内容改变，请重新检查并确认。", denied: "当前账号没有 AI 助手权限，请重新登录或联系管理员。", config: "请先在 APP 维护中配置 DeepSeek 模型和 API Key。",
    error: "请求未完成，输入仍保留。请重新预览后重试。", changed: "设施内容已被修改，请重新预览后重试。", empty: "请输入整理要求。",
  },
  "zh-HK": {
    title: "AI 助手", welcome: "有甚麼可以幫你？", intro: "查找已發佈的設施教學，或將你選擇的教學資料整理成清晰草稿。",
    draftOnly: "唯讀 · 僅產生草稿", privacy: "請勿輸入參與者資料、姓名電話、密碼、密鑰、回饋或運動紀錄。偵測到敏感內容會拒絕傳送。",
    document: "本次選擇的公開教學文件（可選）", documentHint: "貼上已審核、不含個人資料的教學文字，最多 30000 字。",
    addDocument: "加入教學資料", selectedDocument: "已加入教學資料", hideDocument: "收起資料", documentCount: count => `${count.toLocaleString()} / 30,000 字`,
    message: "本次整理要求", messageHint: "輸入你的問題，或描述想整理的教學內容…", preview: "檢查並預覽傳送範圍", sendingHint: "傳送前會先預覽範圍，由你確認。",
    searchPrompt: "查找設施教學", searchRequest: "請檢索太極揉推器的使用說明，並整理為操作要點。", organisePrompt: "整理教學資料", organiseRequest: "請將本次選擇的教學資料整理成清晰的分點草稿。",
    confirm: "確認傳送至 DeepSeek", edit: "返回修改", clearDocument: "移除文件", clear: "清空對話", summary: "傳送前確認",
    recipient: "接收方：DeepSeek。範圍：本次問題、下列歷史條數、已選文件，以及唯讀設施教學檢索。",
    counts: s => `問題 ${s.messageCharacters} 字 · 歷史 ${s.historyMessages} 條 · 文件 ${s.documentCharacters} 字`,
    noWrites: "不會傳送帳號、權限或其他資料庫內容；沒有寫入、儲存或發佈權限。", draft: "待人工審核的草稿（尚未發佈）", refs: "已查閱設施", busy: "正在處理…",
    sensitive: "偵測到敏感資訊或受限操作。請移除個人資料、聯絡方式、密鑰等內容後重新檢查。不會自動匿名化並傳送。",
    expired: "預覽已過期或內容已改變，請重新檢查並確認。", denied: "目前帳號沒有 AI 助手權限，請重新登入或聯絡管理員。", config: "請先在 APP 維護中設定 DeepSeek 模型和 API Key。",
    error: "未能完成要求，輸入仍保留。請重新預覽後重試。", changed: "設施內容已被修改，請重新預覽後重試。", empty: "請輸入整理要求。",
  },
  en: {
    title: "AI Assistant", welcome: "How can I help?", intro: "Find published Facility Guides, or turn the teaching material you select into a clear draft.",
    draftOnly: "Read-only · Drafts only", privacy: "Do not include participant details, names, phone numbers, passwords, keys, feedback or exercise records. Detected sensitive material is blocked.",
    document: "Selected public teaching document (optional)", documentHint: "Paste reviewed teaching text without personal information. Up to 30,000 characters.",
    addDocument: "Add teaching material", selectedDocument: "Teaching material added", hideDocument: "Hide material", documentCount: count => `${count.toLocaleString()} / 30,000 characters`,
    message: "Drafting request", messageHint: "Ask a question, or describe the teaching content you want to organise…", preview: "Check and preview sending scope", sendingHint: "Review the sending scope before you confirm.",
    searchPrompt: "Find Facility Guides", searchRequest: "Find the Tai Chi Wheel instructions and summarise the steps.", organisePrompt: "Organise teaching material", organiseRequest: "Organise the selected teaching material into a clear bullet-point draft.",
    confirm: "Confirm sending to DeepSeek", edit: "Back to edit", clearDocument: "Remove document", clear: "Clear conversation", summary: "Confirm before sending",
    recipient: "Recipient: DeepSeek. Scope: this question, the history shown below, the selected document, and read-only published teaching search.",
    counts: s => `Question: ${s.messageCharacters} characters · History: ${s.historyMessages} messages · Document: ${s.documentCharacters} characters`,
    noWrites: "Account details, permissions and other database records are not included. This assistant cannot write, save or publish.", draft: "Draft for human review (not published)", refs: "Guides read", busy: "Working…",
    sensitive: "Sensitive information or a restricted operation was detected. Remove personal details, contact information or credentials and check again. Content is not silently redacted and sent.",
    expired: "The preview expired or its content changed. Check and confirm again.", denied: "This account lacks AI Assistant permission. Sign in again or contact an administrator.", config: "Configure a DeepSeek model and API key in APP Maintenance first.",
    error: "The request did not complete. Your input is preserved. Preview again to retry.", changed: "Facility content changed. Preview again and retry.", empty: "Enter a drafting request.",
  },
};

// Keep discussions and document text in memory only, never localStorage or logs.
export default function AdminAssistant(props) { return <Workspace key={props.token || "signed-out"} {...props} />; }

function Workspace({ token, locale = "zh-CN", documentText, onDocumentChange, onClearDocument }) {
  const copy = COPY[locale] || COPY["zh-CN"], apiLocale = locale === "en" ? "en" : "zh";
  const { width: windowWidth } = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState(null), [documentOpen, setDocumentOpen] = useState(Boolean(documentText));
  const [message, setMessage] = useState(""), [localDocument, setLocalDocument] = useState("");
  const [history, setHistory] = useState([]), [answers, setAnswers] = useState([]), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controlledDocument = typeof documentText === "string", selectedDocument = controlledDocument ? documentText : localDocument;
  const compact = (layoutWidth || windowWidth) < 640, showDocument = documentOpen;
  const input = { message, history: history.slice(-8), locale: apiLocale, documentText: selectedDocument };
  const fingerprint = JSON.stringify(input), current = useRef(fingerprint), mounted = useRef(true), pending = useRef(false), messageInput = useRef(null);
  current.current = fingerprint;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (selectedDocument) setDocumentOpen(true); }, [selectedDocument]);
  const mapError = failure => failure?.status === 401 || failure?.status === 403 ? "denied" : failure?.code === "adminAssistantSensitiveContent" || failure?.code === "adminAssistantSensitiveResponse" ? "sensitive" : failure?.code === "adminAssistantPreviewExpired" || failure?.code === "adminAssistantPreviewRequired" ? "expired" : failure?.code === "deepSeekNotConfigured" ? "config" : failure?.code === "adminAssistantContentChanged" ? "changed" : "error";
  const activePreview = preview?.fingerprint === fingerprint ? preview : null;
  const check = async () => {
    if (!token || pending.current) return;
    if (!message.trim()) { setError("empty"); return; }
    pending.current = true; setBusy(true); setError(""); setPreview(null);
    const sentFingerprint = fingerprint;
    try {
      const result = await previewAdminAssistant(token, input);
      if (mounted.current && current.current === sentFingerprint) setPreview({ ...result, fingerprint: sentFingerprint });
    } catch (failure) { if (mounted.current) setError(mapError(failure)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const send = async () => {
    if (!token || pending.current || !activePreview) return;
    if (activePreview.expiresAt <= Date.now()) { setPreview(null); setError("expired"); return; }
    pending.current = true; setBusy(true); setError("");
    const sentFingerprint = fingerprint;
    const confirmation = activePreview.previewToken; setPreview(null);
    try {
      const result = await sendAdminAssistant(token, input, confirmation);
      if (mounted.current && current.current === sentFingerprint) {
        setAnswers(value => [...value, { question: message, ...result }].slice(-8));
        setHistory(value => [...value, { role: "user", content: message }, { role: "assistant", content: result.reply }].slice(-8));
        setMessage("");
      }
    } catch (failure) { if (mounted.current) setError(mapError(failure)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const editMessage = value => { setMessage(value); setPreview(null); setError(""); };
  const choosePrompt = (value, withDocument = false) => {
    if (busy) return;
    editMessage(value);
    if (withDocument) setDocumentOpen(true);
    messageInput.current?.focus();
  };
  const removeDocument = () => {
    setPreview(null);
    if (controlledDocument) { if (onClearDocument) onClearDocument(); else onDocumentChange?.(""); }
    else setLocalDocument("");
    setDocumentOpen(false);
  };
  const button = (id, label, onPress, { disabled = false, secondary = false, icon } = {}) => (
    <TouchableOpacity testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}>
      {icon && <Ionicons name={icon} size={17} color={secondary ? "#536176" : "#ffffff"} />}
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </TouchableOpacity>
  );

  return <View testID="admin-assistant" onLayout={event => setLayoutWidth(event.nativeEvent.layout.width)} style={[styles.root, compact && styles.rootCompact]}>
    <View style={styles.toolbar}>
      <View style={styles.brand}><Ionicons name="sparkles-outline" size={21} color="#456BC7" /><Text style={styles.brandText}>{copy.title}</Text></View>
      {button("admin-assistant-clear", copy.clear, () => { setAnswers([]); setHistory([]); setMessage(""); setPreview(null); setError(""); }, { secondary: true, disabled: busy, icon: "refresh-outline" })}
    </View>
    <View style={[styles.content, !answers.length && styles.emptyContent]}>
      {!answers.length && <View testID="admin-assistant-welcome" style={[styles.welcome, compact && styles.welcomeCompact]}>
        <View style={styles.welcomeIcon}><Ionicons name="sparkles" size={29} color="#5677C9" /></View>
        <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>{copy.welcome}</Text>
        <Text style={styles.intro}>{copy.intro}</Text>
      </View>}
      {answers.map((answer, index) => <View testID="admin-assistant-answer" key={index} style={styles.exchange}>
        <View style={styles.questionBubble}><Text selectable style={styles.text}>{answer.question}</Text></View>
        <View style={styles.response}>
          <View style={styles.responseHeading}><Ionicons name="sparkles-outline" size={19} color="#456BC7" /><Text style={styles.responseName}>{copy.title}</Text></View>
          <Text selectable style={styles.text}>{answer.reply}</Text>
          {!!answer.draft && <View style={styles.draftCard}><Text style={styles.draftLabel}>{copy.draft}</Text><Text selectable style={styles.text}>{answer.draft}</Text></View>}
          {!!answer.references?.length && <Text selectable style={styles.hint}>{copy.refs}: {answer.references.map(item => item.name).join("、")}</Text>}
        </View>
      </View>)}
      <View style={styles.inputArea}>
        <View testID="admin-assistant-composer" style={[styles.composer, compact && styles.composerCompact]}>
          <TextInput ref={messageInput} testID="admin-assistant-message" accessibilityLabel={copy.message} style={[styles.messageInput, compact && styles.messageInputCompact]} multiline maxLength={1200} value={message} editable={!busy} onChangeText={editMessage} placeholder={copy.messageHint} placeholderTextColor="#8993A6" />
          <View style={styles.composerActions}>
            <View style={styles.composerTools}>
              <TouchableOpacity testID="admin-assistant-toggle-document" accessibilityRole="button" accessibilityLabel={selectedDocument ? copy.selectedDocument : copy.addDocument} accessibilityState={{ disabled: busy, expanded: showDocument }} disabled={busy} onPress={() => setDocumentOpen(value => !value)} style={[styles.pill, selectedDocument && styles.selectedPill, busy && styles.disabled]}>
                <Ionicons name={selectedDocument ? "document-text-outline" : "add"} size={18} color="#56667B" /><Text style={styles.pillText}>{selectedDocument ? copy.selectedDocument : copy.addDocument}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity testID="admin-assistant-check" accessibilityRole="button" accessibilityLabel={copy.preview} accessibilityHint={copy.sendingHint} accessibilityState={{ disabled: busy || !token || !message.trim() || Boolean(activePreview) }} disabled={busy || !token || !message.trim() || Boolean(activePreview)} onPress={check} style={[styles.sendButton, (busy || !token || !message.trim() || Boolean(activePreview)) && styles.sendDisabled]}>
              {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons name="arrow-up" size={25} color="#ffffff" />}
            </TouchableOpacity>
          </View>
          {showDocument && <View testID="admin-assistant-document-panel" style={styles.documentPanel}>
            <View style={styles.documentHeading}><Text style={styles.label}>{copy.document}</Text>
              <TouchableOpacity testID="admin-assistant-hide-document" accessibilityRole="button" accessibilityLabel={copy.hideDocument} disabled={busy} onPress={() => setDocumentOpen(false)} style={styles.iconButton}><Ionicons name="close" size={19} color="#647084" /></TouchableOpacity>
            </View>
            <TextInput testID="admin-assistant-document" accessibilityLabel={copy.document} style={styles.documentInput} multiline maxLength={30000} value={selectedDocument} editable={!busy && (!controlledDocument || Boolean(onDocumentChange))} onChangeText={value => { setPreview(null); if (controlledDocument) onDocumentChange?.(value); else setLocalDocument(value); }} placeholder={copy.documentHint} placeholderTextColor="#8993A6" />
            <View style={styles.documentFooter}><Text style={styles.hint}>{copy.documentCount(selectedDocument.length)}</Text>
              {!!selectedDocument && button("admin-assistant-remove-document", copy.clearDocument, removeDocument, { secondary: true, disabled: busy || controlledDocument && !onClearDocument && !onDocumentChange, icon: "close-outline" })}
            </View>
          </View>}
        </View>
        {!answers.length && <View style={styles.suggestions}>
          {button("admin-assistant-suggest-search", copy.searchPrompt, () => choosePrompt(copy.searchRequest), { secondary: true, disabled: busy, icon: "search-outline" })}
          {button("admin-assistant-suggest-document", copy.organisePrompt, () => choosePrompt(copy.organiseRequest, true), { secondary: true, disabled: busy, icon: "reader-outline" })}
        </View>}
        {!!error && <Text testID="admin-assistant-error" accessibilityRole="alert" style={styles.error}>{copy[error]}</Text>}
        {busy && <Text accessibilityLiveRegion="polite" style={styles.status}>{copy.busy}</Text>}
        {activePreview && <View testID="admin-assistant-preview" style={styles.preview}>
          <View style={styles.responseHeading}><Ionicons name="shield-checkmark-outline" size={20} color="#456BC7" /><Text style={styles.previewTitle}>{copy.summary}</Text></View>
          <Text style={styles.text}>{copy.recipient}</Text><Text style={styles.previewCounts}>{copy.counts(activePreview.summary)}</Text><Text style={styles.hint}>{copy.noWrites}</Text>
          <View style={styles.previewActions}>{button("admin-assistant-confirm", copy.confirm, send, { disabled: busy || !token, icon: "arrow-up" })}{button("admin-assistant-edit", copy.edit, () => { setPreview(null); messageInput.current?.focus(); }, { secondary: true, disabled: busy })}</View>
        </View>}
        <View style={styles.safety}>
          <View style={styles.safetyHeading}><Ionicons name="shield-checkmark-outline" size={15} color="#728097" /><Text style={styles.safetyTitle}>{copy.draftOnly}</Text><Text style={styles.safetyCaption}>{copy.sendingHint}</Text></View>
          <Text style={styles.privacy}>{copy.privacy}</Text>
        </View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { width: "100%", minWidth: 0, minHeight: 700, padding: 28, paddingBottom: 48, backgroundColor: "#F3F6FB", borderRadius: 20, ...Platform.select({ web: { backgroundImage: "radial-gradient(ellipse at 52% 32%, #e9f1ff 0%, transparent 64%), linear-gradient(140deg, #f5f7fb 0%, #eef3fb 58%, #f9fafc 100%)" } }) },
  rootCompact: { minHeight: 600, padding: 16, paddingBottom: 28, borderRadius: 16 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandText: { color: "#30435F", fontSize: 18, fontWeight: "600" },
  content: { width: "100%", maxWidth: 940, minWidth: 0, alignSelf: "center", paddingTop: 28, gap: 28 },
  emptyContent: { paddingTop: 20 },
  welcome: { alignItems: "center", paddingTop: 38, paddingBottom: 12, gap: 18 },
  welcomeCompact: { paddingTop: 24, paddingBottom: 4, gap: 14 },
  welcomeIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: "#E6EDFD", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#F9FBFF" },
  title: { fontSize: 40, lineHeight: 52, fontWeight: "600", color: "#233650", textAlign: "center", letterSpacing: 0.4 },
  titleCompact: { fontSize: 29, lineHeight: 40 },
  intro: { maxWidth: 630, color: "#66758B", fontSize: 16, lineHeight: 26, textAlign: "center" },
  inputArea: { gap: 14 },
  composer: { width: "100%", minWidth: 0, backgroundColor: "#FFFFFF", borderRadius: 25, borderWidth: 1, borderColor: "#DFE6F0", padding: 20, shadowColor: "#476699", shadowOpacity: 0.08, shadowOffset: { width: 0, height: 8 }, shadowRadius: 24, elevation: 2 },
  composerCompact: { borderRadius: 22, padding: 14 },
  messageInput: { minWidth: 0, width: "100%", minHeight: 126, maxHeight: 260, padding: 4, paddingTop: 5, fontSize: 18, lineHeight: 28, color: "#263950", textAlignVertical: "top", ...Platform.select({ web: { outlineStyle: "none" } }) },
  messageInputCompact: { minHeight: 134, fontSize: 17, lineHeight: 26 },
  composerActions: { flexDirection: "row", gap: 12, alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 },
  composerTools: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minHeight: 40, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: "#F3F5F8", borderWidth: 1, borderColor: "#E9EDF3", borderRadius: 22 },
  selectedPill: { backgroundColor: "#EDF3FE", borderColor: "#DBE6FA" },
  pillText: { fontSize: 14, lineHeight: 20, color: "#56667B", flexShrink: 1 },
  sendButton: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "#5479D1", flexShrink: 0 },
  sendDisabled: { backgroundColor: "#A8BCE6" },
  suggestions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "flex-start", gap: 7, minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, backgroundColor: "#5479D1", maxWidth: "100%" },
  buttonText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22, fontWeight: "600", flexShrink: 1 },
  secondaryButton: { backgroundColor: "#EEF2F8" },
  secondaryButtonText: { color: "#536176", fontWeight: "500" },
  disabled: { opacity: 0.45 },
  documentPanel: { gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#E8ECF3" },
  documentHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { flex: 1, fontSize: 15, lineHeight: 23, color: "#475A73", fontWeight: "600" },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  documentInput: { minHeight: 120, maxHeight: 260, minWidth: 0, borderRadius: 12, padding: 12, backgroundColor: "#F6F8FB", borderWidth: 1, borderColor: "#E4EAF2", fontSize: 15, lineHeight: 24, color: "#344760", textAlignVertical: "top", ...Platform.select({ web: { outlineStyle: "none" } }) },
  documentFooter: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" },
  safety: { maxWidth: 810, alignSelf: "center", gap: 7, paddingHorizontal: 5, paddingTop: 2 },
  safetyHeading: { flexDirection: "row", justifyContent: "center", alignItems: "center", flexWrap: "wrap", columnGap: 6, rowGap: 4 },
  safetyTitle: { fontSize: 14, lineHeight: 21, fontWeight: "600", color: "#62728B" },
  safetyCaption: { fontSize: 14, lineHeight: 21, color: "#62728B", textAlign: "center" },
  privacy: { fontSize: 14, lineHeight: 22, color: "#62728B", textAlign: "center" },
  exchange: { gap: 22 },
  questionBubble: { alignSelf: "flex-end", maxWidth: "92%", borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: "#E3ECFC" },
  response: { gap: 13 },
  responseHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  responseName: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#344A68" },
  text: { fontSize: 16, lineHeight: 28, color: "#30435C" },
  hint: { fontSize: 14, color: "#6B7B90", lineHeight: 23 },
  draftCard: { gap: 8, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DFE7F4", padding: 18, borderRadius: 16 },
  draftLabel: { fontSize: 14, lineHeight: 23, fontWeight: "600", color: "#5272B0" },
  preview: { backgroundColor: "#F9FBFF", borderWidth: 1, borderColor: "#D5E1F6", padding: 20, borderRadius: 20, gap: 12 },
  previewTitle: { fontSize: 18, lineHeight: 26, color: "#344A68", fontWeight: "600" },
  previewCounts: { fontSize: 15, lineHeight: 25, fontWeight: "500", color: "#456397" },
  previewActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
  error: { color: "#A13F43", fontSize: 15, lineHeight: 24, backgroundColor: "#FFF2F2", borderRadius: 12, padding: 14 },
  status: { color: "#607598", fontSize: 14, lineHeight: 22, textAlign: "center" },
});
