import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";

export default function UsageMetricCards({ rows, i18n }) {
	return rows.map((row) => <View key={row.labelKey} style={styles.card}>
		<View style={[styles.iconCircle, { backgroundColor: row.color }]}><Ionicons name={row.icon} size={RFValue(22)} color="#fff" /></View>
		<Text style={styles.label}>{i18n.t(row.labelKey)}</Text>
		<View style={styles.valueBox}><Text style={[styles.value, { color: row.color }]}>{row.value ?? 0}</Text><Text style={styles.unit}>{i18n.t(row.unitKey || "times")}</Text></View>
	</View>);
}
const styles = StyleSheet.create({ card: { flexDirection: "row", alignItems: "center", backgroundColor: "#f8f9fa", borderRadius: 14, padding: 16, marginBottom: 12 }, iconCircle: { width: RFValue(44), height: RFValue(44), borderRadius: RFValue(22), justifyContent: "center", alignItems: "center" }, label: { flex: 1, fontSize: RFValue(14), color: "#333", marginLeft: 12, marginRight: 8 }, valueBox: { alignItems: "center", flexShrink: 1 }, value: { fontSize: RFValue(22), fontWeight: "bold" }, unit: { fontSize: RFValue(11), color: "#888" } });
