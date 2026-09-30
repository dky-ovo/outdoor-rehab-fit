import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { adminPageWindow } from "../utils/adminPagination";

export default function AdminPagination({ page = 1, pageSize = 20, total = 0, onPageChange, disabled = false, locale = "zh-CN", testID = "admin-pagination" }) {
	const window = adminPageWindow(total, page, pageSize);
	const en = locale === "en"; const traditional = locale === "zh-HK";
	const previous = en ? "Previous" : traditional ? "上一頁" : "上一页";
	const next = en ? "Next" : traditional ? "下一頁" : "下一页";
	const canPrevious = !disabled && window.page > 1 && typeof onPageChange === "function";
	const canNext = !disabled && window.page < window.totalPages && typeof onPageChange === "function";
	const summary = en ? `${window.total} records · ${window.pageSize} / page · Page ${window.page} / ${window.totalPages}` : `共 ${window.total} ${traditional ? "條" : "条"} · 每${traditional ? "頁" : "页"} ${window.pageSize} ${traditional ? "條" : "条"} · ${window.page} / ${window.totalPages} ${traditional ? "頁" : "页"}`;
	return <View style={styles.row} testID={testID}>
		<Text testID={`${testID}-summary`} accessibilityLiveRegion="polite" style={styles.summary}>{summary}</Text>
		<View testID={`${testID}-buttons`} style={styles.buttons}>
			<TouchableOpacity testID={`${testID}-previous`} accessibilityRole="button" accessibilityLabel={previous} accessibilityState={{ disabled: !canPrevious }} disabled={!canPrevious} onPress={() => { if (canPrevious) onPageChange(window.page - 1); }} style={[styles.button, !canPrevious && styles.disabled]}><Text style={styles.label}>{previous}</Text></TouchableOpacity>
			<TouchableOpacity testID={`${testID}-next`} accessibilityRole="button" accessibilityLabel={next} accessibilityState={{ disabled: !canNext }} disabled={!canNext} onPress={() => { if (canNext) onPageChange(window.page + 1); }} style={[styles.button, !canNext && styles.disabled]}><Text style={styles.label}>{next}</Text></TouchableOpacity>
		</View>
	</View>;
}

const styles = StyleSheet.create({
	row: { width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, marginBottom: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
	summary: { flexShrink: 1, minWidth: 0, maxWidth: "100%", fontSize: 13, lineHeight: 20, color: "#616772" },
	buttons: { flexDirection: "row", gap: 8, flexWrap: "wrap", flexShrink: 1, minWidth: 0, maxWidth: "100%" },
	button: { minHeight: 44, minWidth: 0, maxWidth: "100%", flexShrink: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: "#D9DDE3", backgroundColor: "#FFF", justifyContent: "center" },
	label: { color: "#840B1C", fontWeight: "700", fontSize: 14, lineHeight: 20, textAlign: "center", flexShrink: 1 }, disabled: { opacity: 0.4 },
});
