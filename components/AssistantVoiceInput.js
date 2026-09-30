import React, { useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { assistantVoiceCopy } from "../constants/AssistantVoice";

export function AssistantVoiceButton({ locale, status, disabled, onPress }) {
  const copy = assistantVoiceCopy(locale);
  const waiting = status === "requesting" || status === "processing";
  const listening = status === "listening";
  return <TouchableOpacity testID="assistant-voice-button" accessibilityRole="button" accessibilityLabel={listening ? copy.stop : copy.start}
    accessibilityState={{ disabled: disabled || waiting, busy: waiting }} disabled={disabled || waiting} onPress={onPress}
    style={[styles.button, listening && styles.recording, (disabled || waiting) && styles.disabled]}>
    {waiting ? <ActivityIndicator color="#840B1C" /> : <Ionicons name={listening ? "stop" : "mic-outline"} size={26} color={listening ? "#fff" : "#840B1C"} />}
  </TouchableOpacity>;
}

export default function AssistantVoiceInput({ locale, keyboardVisible = false, status, interimText, errorCode, diagnostics, candidate, onCancel, onInsert, onDiscard }) {
  const { height } = useWindowDimensions();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  // The whole panel can scroll and shrink, including its warnings and actions.
  // Keep the composer outside it so long dictated text cannot push Send below
  // the keyboard on compact phones or when the system text size is enlarged.
  const maxHeight = Math.min(keyboardVisible ? 160 : 240, height * (keyboardVisible ? 0.25 : 0.35));
  const copy = assistantVoiceCopy(locale);
  const active = status !== "idle";
  if (!active && !errorCode && !candidate) return null;
  return <ScrollView testID="assistant-voice-panel" style={[styles.panel, { maxHeight }]} contentContainerStyle={styles.panelContent}
    nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
    {active && <View style={styles.heading}>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{copy[status] || copy.listening}</Text>
      <TouchableOpacity testID="assistant-voice-cancel" accessibilityRole="button" accessibilityLabel={copy.cancel} onPress={onCancel} style={styles.cancel}>
        <Text style={styles.actionText}>{copy.cancel}</Text>
      </TouchableOpacity>
    </View>}
    {!!errorCode && <Text testID="assistant-voice-error" accessibilityLiveRegion="polite" style={styles.error}>{copy[errorCode] || copy.startFailed}</Text>}
    {!!errorCode && !!diagnostics && <>
      <TouchableOpacity testID="assistant-voice-diagnostics-toggle" accessibilityRole="button" accessibilityState={{ expanded: showDiagnostics }} style={styles.cancel} onPress={() => setShowDiagnostics(value => !value)}>
        <Text style={styles.actionText}>{showDiagnostics ? copy.hideDiagnostics : copy.diagnostics}</Text>
      </TouchableOpacity>
      {showDiagnostics && <View testID="assistant-voice-diagnostics" style={styles.diagnostics}>
        {[
          [copy.appVersion, diagnostics.installedVersion], [copy.build, diagnostics.installedBuild],
          [copy.system, `${diagnostics.platform} / ${diagnostics.osVersion}`],
          [copy.nativeModule, copy[diagnostics.nativeModule] || diagnostics.nativeModule],
          [diagnostics.engine === "offline" ? copy.offlineEngine : copy.speechService, diagnostics.speechService === "available" ? copy.available : copy.unavailableStatus],
          ...(diagnostics.platform === "android" ? [[copy.recognitionService, diagnostics.recognitionService]] : []),
          [copy.language, diagnostics.language],
        ].map(([label, value]) => <Text key={label} style={styles.diagnosticText}>{label}：{value || "—"}</Text>)}
      </View>}
    </>}
    {errorCode === "permissionDenied" && Platform.OS !== "web" && <TouchableOpacity testID="assistant-voice-settings" accessibilityRole="button" style={styles.cancel}
      onPress={async () => { setSettingsFailed(false); try { await Linking.openSettings(); } catch { setSettingsFailed(true); } }}>
      <Text style={styles.actionText}>{copy.settings}</Text>
    </TouchableOpacity>}
    {settingsFailed && <Text style={styles.error}>{copy.settingsFailed}</Text>}
    {active && !!interimText && <Text testID="assistant-voice-interim" numberOfLines={3} style={styles.transcript}>{interimText}</Text>}
    {!!candidate && <>
      <Text style={styles.status}>{copy.candidate}</Text>
      <View style={styles.actions}>
        <TouchableOpacity testID="assistant-voice-insert" accessibilityRole="button" onPress={onInsert} style={styles.primary}><Text style={styles.primaryText}>{copy.insert}</Text></TouchableOpacity>
        <TouchableOpacity testID="assistant-voice-discard" accessibilityRole="button" accessibilityLabel={copy.discarded} onPress={onDiscard} style={styles.cancel}><Text style={styles.actionText}>{copy.cancel}</Text></TouchableOpacity>
      </View>
      <Text testID="assistant-voice-candidate" style={styles.transcript}>{candidate}</Text>
    </>}
    <Text style={styles.help}>{Platform.OS === "web" ? copy.browserHelp : copy.help}</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  button: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "#F7E9EC", borderWidth: 1, borderColor: "#E8D5D9" },
  recording: { backgroundColor: "#840B1C" }, disabled: { opacity: 0.5 },
  panel: { flexGrow: 0, flexShrink: 1, backgroundColor: "#FFF8F8", borderTopWidth: 1, borderColor: "#E8D5D9" },
  panelContent: { paddingHorizontal: 14, paddingVertical: 10 },
  diagnostics: { backgroundColor: "#fff", padding: 10, borderRadius: 8, gap: 4 },
  diagnosticText: { fontSize: 14, lineHeight: 21, color: "#555" },
  heading: { flexDirection: "row", gap: 8, alignItems: "center" },
  status: { flexShrink: 1, fontSize: 17, lineHeight: 24, fontWeight: "600", color: "#840B1C" },
  transcript: { fontSize: 18, lineHeight: 26, color: "#333", marginVertical: 6 },
  error: { fontSize: 16, lineHeight: 24, color: "#840B1C" },
  help: { fontSize: 14, lineHeight: 21, color: "#666", marginTop: 5 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  cancel: { minHeight: 44, minWidth: 52, padding: 10, justifyContent: "center", alignItems: "center" },
  actionText: { color: "#840B1C", fontSize: 16, fontWeight: "600" },
  primary: { minHeight: 46, padding: 10, borderRadius: 10, backgroundColor: "#840B1C", justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
