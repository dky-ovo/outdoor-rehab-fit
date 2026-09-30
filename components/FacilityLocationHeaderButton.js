import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { appText } from "../utils/appText";

export default function FacilityLocationHeaderButton({ locale, onPress }) {
	const english = locale !== "zh";
	return <TouchableOpacity
		testID="facility-header-location"
		accessibilityRole="button"
		accessibilityLabel={appText(locale, "inline.facilityHeader.viewLocations", { zh: "查看設施位置", en: "View facility locations" })}
		onPress={onPress}
		style={[styles.button, { width: english ? 104 : 76 }]}
	>
		<Ionicons name="location" size={20} color="#840B1C" style={styles.icon} />
		<Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.label}>{appText(locale, "inline.facilityHeader.location", { zh: "位置", en: "Location" })}</Text>
	</TouchableOpacity>;
}

const styles = StyleSheet.create({
	button: {
		height: 44,
		minHeight: 44,
		alignSelf: "center",
		flexGrow: 0,
		flexShrink: 0,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 8,
		borderRadius: 8,
		backgroundColor: "#F8ECEF",
	},
	icon: { width: 20, flexShrink: 0, marginRight: 4 },
	label: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: "#840B1C" },
});
