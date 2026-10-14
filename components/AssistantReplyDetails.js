import { appText } from "../utils/appText";
import React from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ModalSafeAreaView from './ModalSafeAreaView';
import { RFValue } from "react-native-responsive-fontsize";

// A separate reader avoids changing the height/anchor of an inverted chat row.
// A fresh ScrollView on each opening starts at the beginning of that reply.
export default function AssistantReplyDetails({ detail, locale, onClose }) {
  if (!detail) return null;
  const en = locale === "en";
  const back = appText(en ? "en" : "zh", "inline.assistantDetails.backToChat", {"zh":"返回對話","en":"Back to chat"});
  return <Modal testID="assistant-reply-details-modal" visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose}>
    <ModalSafeAreaView accessibilityViewIsModal style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity testID="assistant-reply-details-close" onPress={onClose} accessibilityRole="button" accessibilityLabel={back} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color="#840B1C" /><Text style={styles.backText}>{back}</Text>
        </TouchableOpacity>
        <Text accessibilityRole="header" style={styles.title}>{appText(en ? "en" : "zh", "inline.assistantDetails.detailedExplanation", {"zh":"詳細說明","en":"Detailed explanation"})}</Text>
      </View>
      <ScrollView key={detail.messageId} testID="assistant-reply-details-scroll" style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text testID="assistant-reply-details-text" selectable style={styles.text}>{detail.text}</Text>
        <TouchableOpacity testID="assistant-reply-details-done" onPress={onClose} accessibilityRole="button" accessibilityLabel={back} style={styles.done}>
          <Text style={styles.doneText}>{back}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ModalSafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E8D9DC" },
  back: { minHeight: 52, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingRight: 16 },
  backText: { flexShrink: 1, color: "#840B1C", fontSize: Math.max(18, RFValue(13)), fontWeight: "700" },
  title: { color: "#292929", fontSize: Math.max(21, RFValue(16)), fontWeight: "800", paddingVertical: 8 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 30 },
  text: { color: "#292929", fontSize: Math.max(18, RFValue(13)), lineHeight: Math.max(30, RFValue(22)) },
  done: { minHeight: 52, marginTop: 28, borderRadius: 12, padding: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#840B1C" },
  doneText: { color: "#fff", fontSize: Math.max(18, RFValue(13)), fontWeight: "700", textAlign: "center" },
});
