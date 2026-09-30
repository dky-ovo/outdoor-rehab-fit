import React, { useContext } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";
import { FEATURES, canAccess } from "../../constants/permissions";
import { guardGuestAccess } from "../../utils/accessControl";
import { useAndroidBackTarget } from "../../hooks/useAndroidBackTarget";

const OTHER_ITEMS = [
	{ key: "risk", labelKey: "risk", descriptionKey: "riskManagementHint", icon: "heart-pulse", color: "#F7D6C7", route: "/risk", feature: FEATURES.RISK },
	{ key: "research", labelKey: "research", descriptionKey: "universityResearchHint", icon: "school", color: "#F6E59B", route: "/research", feature: FEATURES.RESEARCH },
	{ key: "activityAdvice", labelKey: "physicalActivityAdvice", descriptionKey: "physicalActivityAdviceHint", icon: "walk", color: "#DCE8F8", route: "/activity-advice", feature: FEATURES.RESEARCH },
	{ key: "usage", labelKey: "statistics", descriptionKey: "usageRecordsHint", icon: "chart-box", color: "#CFEDE7", route: "/stats", feature: FEATURES.USAGE_STATS },
];

// APP usage and exercise records are separate entry points. They share the
// participant selector, but never mix their daily detail views.
const PARTICIPANT_DATA_ITEMS = [
	{
		key: "participantUsage",
		labelKey: "participantUsage",
		descriptionKey: "participantUsageHint",
		icon: "account-group",
		color: "#DCE8F8",
		route: { pathname: "/participant-usage", params: { view: "usage" } },
		feature: FEATURES.USAGE_STATS,
	},
	{
		key: "participantExerciseData",
		labelKey: "participantExerciseData",
		descriptionKey: "participantExerciseDataHint",
		icon: "clipboard-pulse-outline",
		color: "#F4D9DE",
		route: { pathname: "/participant-usage", params: { view: "exercise" } },
		feature: FEATURES.USAGE_STATS,
	},
];

const PARTICIPANT_USAGE_ROLES = ["participant", "volunteer", "caregiver", "staff"];

export default function OtherScreen() {
	useAndroidBackTarget("/(tabs)");
	const { i18n } = useContext(LocaleContext);
	const { isGuest, user } = useContext(AuthContext);
	const open = (item) => guardGuestAccess(item.feature, isGuest, i18n, () => router.push(item.route));

	const showParticipantUsage = !isGuest && PARTICIPANT_USAGE_ROLES.includes(user?.profileRole);
	const renderItem = (item, separate = false) => {
		const locked = isGuest && !canAccess(item.feature, isGuest);
		return <TouchableOpacity
			key={item.key}
			style={[styles.card, separate && styles.participantCard]}
			onPress={() => open(item)}
			accessibilityRole="button"
			accessibilityLabel={item.label || i18n.t(item.labelKey)}
		>
			<View style={[styles.iconCircle, { backgroundColor: item.color }]}>
				<MaterialCommunityIcons name={locked ? "lock" : item.icon} size={RFValue(32)} color={locked ? "#840B1C" : "#444"} />
			</View>
			<View style={styles.textWrap}>
				<Text style={styles.title}>{item.label || i18n.t(item.labelKey)}</Text>
				<Text style={styles.description}>{item.description || i18n.t(item.descriptionKey)}</Text>
			</View>
			<MaterialCommunityIcons name="chevron-right" size={RFValue(26)} color="#888" />
		</TouchableOpacity>;
	};

	return <ScrollView contentContainerStyle={styles.page}>
		<Text style={styles.heading}>{i18n.t("otherTab")}</Text>
		<Text style={styles.intro}>{i18n.t("otherTabHint")}</Text>
		{OTHER_ITEMS.map((item) => renderItem(item))}
		{showParticipantUsage && <View style={styles.participantEntry}>
			<View style={styles.sectionHeader}>
				<View style={styles.sectionLine} />
				<Text style={styles.sectionLabel}>{i18n.t("participantDataSection")}</Text>
				<View style={styles.sectionLine} />
			</View>
			{PARTICIPANT_DATA_ITEMS.map((item) => renderItem(item, true))}
		</View>}
	</ScrollView>;
}

const styles = StyleSheet.create({
	page: { flexGrow: 1, backgroundColor: "#F7F7F7", padding: 20, paddingBottom: 130 },
	heading: { fontSize: RFValue(24), fontWeight: "900", color: "#222", marginTop: 8 },
	intro: { fontSize: RFValue(13), lineHeight: RFValue(20), color: "#666", marginTop: 7, marginBottom: 20 },
	card: { minHeight: 108, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#E7E7E7" },
	participantEntry: { marginTop: 8 },
	sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
	sectionLine: { flex: 1, height: 1, backgroundColor: "#D7DCE5" },
	sectionLabel: { fontSize: RFValue(12), fontWeight: "800", color: "#4D5968", textAlign: "center" },
	participantCard: { borderWidth: 2, borderColor: "#C8D8EC", backgroundColor: "#FBFDFF" },
	iconCircle: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center" },
	textWrap: { flex: 1, marginHorizontal: 15 },
	title: { fontSize: RFValue(17), fontWeight: "800", color: "#272727" },
	description: { fontSize: RFValue(11), lineHeight: RFValue(17), color: "#777", marginTop: 5 },
});
