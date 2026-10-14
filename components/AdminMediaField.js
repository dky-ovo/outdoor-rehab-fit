import React, { useState } from "react";
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { resolveApiAssetUrl } from "../utils/api";
import AdminMediaLibrary from "./AdminMediaLibrary";

export default function AdminMediaField({ label, value = "", legacyValue = "", kind = "image", token, permissions, onChange, disabled = false }) {
	const [view, setView] = useState(null);
	return <View style={styles.field}>
		<Text style={styles.label}>{label}</Text>
		<View style={styles.buttons}>
			<TouchableOpacity testID={`media-field-library-${kind}`} style={styles.button} onPress={() => setView("library")} disabled={disabled}><Text style={styles.buttonText}>从文件存储导入</Text></TouchableOpacity>
		</View>
		{!!value && <><Text style={styles.note}>已选择文件；保存本页后应用更改。</Text>{kind !== "video" && <Image source={{ uri: resolveApiAssetUrl(value) }} style={styles.preview} resizeMode="contain" />}<TouchableOpacity style={styles.clear} disabled={disabled} onPress={() => onChange("")}><Text style={styles.clearText}>移除此处选择（不删除文件）</Text></TouchableOpacity></>}
		{!value && !!legacyValue && <Text style={styles.note}>旧版共用视频尚未按语言分类；请在对应中文或英文通道导入后替换。</Text>}
		{kind === "video" && <Text style={styles.note}>推荐 MP4（H.264/AAC），最大 250 MB；请先在「文件存储」上传，再选择并保存本页内容。</Text>}
		{view && <Modal visible transparent animationType="fade" onRequestClose={() => setView(null)}><View style={styles.overlay}><View style={[styles.dialog, Platform.OS === "web" && { maxWidth: 1180 }]}><View style={styles.dialogHeader}><Text style={styles.label}>{label}</Text><TouchableOpacity testID="media-field-close" style={styles.button} onPress={() => setView(null)}><Text style={styles.buttonText}>关闭 / 取消</Text></TouchableOpacity></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogBody}><AdminMediaLibrary token={token} permissions={permissions} kind={kind} initialView={view} onSelect={(item) => { onChange(item.url); setView(null); }} /></ScrollView></View></View></Modal>}
	</View>;
}

const styles = StyleSheet.create({ field: { gap: 8, marginTop: 16, minWidth: 0 }, label: { color: "#333", fontSize: 15, fontWeight: "700", flexShrink: 1 }, buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, alignSelf: "flex-start", maxWidth: "100%" }, buttonText: { color: "#840B1C", fontSize: 14, fontWeight: "600", flexShrink: 1 }, note: { fontSize: 13, lineHeight: 20, color: "#777", flexShrink: 1 }, preview: { width: "100%", height: 150, backgroundColor: "#f6f6f6", borderRadius: 8 }, clear: { alignSelf: "flex-start", paddingVertical: 8 }, clearText: { color: "#840B1C", fontSize: 13 }, overlay: { flex: 1, padding: 12, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" }, dialog: { backgroundColor: "#fff", borderRadius: 14, width: "100%", maxWidth: 780, maxHeight: "94%", overflow: "hidden" }, dialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: 16, borderBottomWidth: 1, borderColor: "#eee" }, dialogBody: { padding: 16 } });
