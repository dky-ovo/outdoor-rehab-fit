import { appText } from "../utils/appText";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const copy = locale => ({
    auto: appText(locale, "inline.assistantSpeech.auto", {"zh":"自動朗讀新回覆","en":"Read new replies aloud"}),
    read: appText(locale, "inline.assistantSpeech.read", {"zh":"朗讀回覆","en":"Read reply aloud"}),
    stop: appText(locale, "inline.assistantSpeech.stop", {"zh":"停止朗讀","en":"Stop reading"}),
    loading: appText(locale, "inline.assistantSpeech.loading", {"zh":"準備語音中…","en":"Preparing voice…"}),
    voiceUnavailable: appText(locale, "inline.assistantSpeech.voiceUnavailable", {"zh":"手機未有可用的離線粵語聲音。請在手機設定安裝離線粵語朗讀聲音，您仍可閱讀回覆。","en":"An offline English voice is unavailable. Install an offline English text-to-speech voice in phone settings; the reply remains available to read."}),
    playbackFailed: appText(locale, "inline.assistantSpeech.playbackFailed", {"zh":"暫時無法朗讀，請重試。文字回覆仍然保留。","en":"The reply could not be read aloud. Please try again; the text is still available."}),
  });

export function AssistantReplyReadButton({ locale, messageId, text, speech, disabled = false, onRead }) {
  const labels = copy(locale);
  const active = speech.activeMessageId === messageId && speech.status !== "idle";
  const blocked = !active && (disabled || typeof text !== "string" || !text.trim());
  return <TouchableOpacity testID={`assistant-read-${messageId}`} accessibilityRole="button"
    accessibilityLabel={active ? labels.stop : labels.read} accessibilityState={{ disabled: blocked, busy: active && speech.status === "loading" }}
    disabled={blocked} style={[styles.read, blocked && styles.disabled]}
    onPress={() => active ? speech.stop() : onRead(messageId, text)}>
    {active && speech.status === "loading" ? <ActivityIndicator size="small" color="#840B1C" />
      : <Ionicons name={active ? "stop-circle-outline" : "volume-high-outline"} size={21} color="#840B1C" />}
    <Text style={styles.readText}>{active ? labels.stop : labels.read}</Text>
  </TouchableOpacity>;
}

export default function AssistantReplySpeechControls({ locale, speech }) {
  const labels = copy(locale);
  const error = speech.errorCode && speech.errorCode !== "missingNativeModule"
    ? labels[speech.errorCode] || labels.playbackFailed : null;
  return <View testID="assistant-reply-speech-controls" style={styles.container}>
    <View style={styles.row}>
      <TouchableOpacity testID="assistant-auto-read" accessibilityRole="switch"
        accessibilityLabel={labels.auto} accessibilityState={{ checked: !!speech.autoRead }}
        style={styles.auto} onPress={() => speech.setAutoRead(!speech.autoRead)}>
        <Ionicons name={speech.autoRead ? "checkbox" : "square-outline"} size={22} color="#840B1C" />
        <Text style={styles.autoText}>{labels.auto}</Text>
      </TouchableOpacity>
      {speech.status !== "idle" && <TouchableOpacity testID="assistant-stop-reading" accessibilityRole="button"
        accessibilityLabel={labels.stop} onPress={speech.stop} style={styles.stop}>
        <Ionicons name="stop-circle-outline" size={21} color="#840B1C" /><Text style={styles.readText}>{labels.stop}</Text>
      </TouchableOpacity>}
    </View>
    {speech.status === "loading" && <Text accessibilityLiveRegion="polite" style={styles.status}>{labels.loading}</Text>}
    {error && <Text testID="assistant-reply-speech-error" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#fff", paddingHorizontal: 12, paddingTop: 3, borderTopWidth: 1, borderTopColor: "#EEE8E9" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 12 },
  auto: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  autoText: { color: "#5A4247", fontSize: 14, flexShrink: 1 },
  read: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 4 },
  readText: { color: "#840B1C", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  stop: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5 },
  status: { fontSize: 13, lineHeight: 19, color: "#666", paddingBottom: 5 },
  error: { fontSize: 13, lineHeight: 19, color: "#8E361D", paddingBottom: 7 },
  disabled: { opacity: 0.45 },
});
