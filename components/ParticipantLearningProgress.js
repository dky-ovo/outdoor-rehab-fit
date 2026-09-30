import { appText } from "../utils/appText";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { equipmentImageSource } from "../utils/equipmentCatalog";
import { equipmentLearningCoverage, equipmentLearningFlags } from "../utils/learning";

export function participantLearningCopy(locale) {
	return {
    title: appText(locale, "inline.participantLearningProgress.title", {"zh":"設施教學進度","en":"Facility Guide progress"}),
    cumulative: appText(locale, "inline.participantLearningProgress.cumulative", {"zh":"設施教學累計進度","en":"Cumulative Facility Guide progress"}),
    daily: appText(locale, "inline.participantLearningProgress.daily", {"zh":"當日設施教學","en":"Today's Facility Guide"}),
    details: appText(locale, "inline.participantLearningProgress.details", {"zh":"器材學習詳情","en":"Equipment learning details"}),
    read: appText(locale, "inline.participantLearningProgress.read", {"zh":"閱讀","en":"Read"}),
    watched: appText(locale, "inline.participantLearningProgress.watched", {"zh":"觀看","en":"Watched"}),
    listened: appText(locale, "inline.participantLearningProgress.listened", {"zh":"收聽","en":"Listened"}),
    cumulativeHint: appText(locale, "inline.participantLearningProgress.cumulativeHint", {"zh":"累計記錄，包含舊有未註明日期的記錄。","en":"Cumulative records, including older records without dates."}),
    dayHint: appText(locale, "inline.participantLearningProgress.dayHint", {"zh":"當日進度（香港時間），只計算所選日期內的記錄。","en":"Daily progress (Hong Kong time). Only records from this date are included."}),
    contentHint: appText(locale, "inline.participantLearningProgress.contentHint", {"zh":"百分比按目前繁體中文內容計算；各項達到 75% 才會高亮顯示。","en":"Percentages apply to the current English content. Each icon is highlighted only at 75% or above."}),
    empty: appText(locale, "inline.participantLearningProgress.empty", {"zh":"此時段尚未有設施教學學習記錄。參與者更新 APP 並連接網絡後，才會開始同步日別進度。","en":"No Facility Guide learning records in this period. Daily records start syncing after the participant updates the app and connects to the internet."}),
    unavailable: appText(locale, "inline.participantLearningProgress.unavailable", {"zh":"暫時無法取得此記錄，伺服器可能需要更新，或此參與者已無法查看。","en":"These records are unavailable. The server may need updating, or this participant may no longer be available."}),
    access: appText(locale, "inline.participantLearningProgress.access", {"zh":"請使用有權查看此參與者的帳戶登入。","en":"Please sign in with an account permitted to view this participant."}),
    failed: appText(locale, "inline.participantLearningProgress.failed", {"zh":"無法載入學習記錄，請稍後重試。","en":"Unable to load learning records. Please try again."}),
    retry: appText(locale, "inline.participantLearningProgress.retry", {"zh":"重新載入","en":"Try again"}),
    previous: appText(locale, "inline.participantLearningProgress.previous", {"zh":"上一頁","en":"Previous"}),
    next: appText(locale, "inline.participantLearningProgress.next", {"zh":"下一頁","en":"Next"}),
    missing: appText(locale, "inline.participantLearningProgress.missing", {"zh":"目前無法取得此器材的教學內容，暫未能計算進度。","en":"The current content for this equipment is unavailable. Its progress cannot be calculated."}),
    missingEntry: appText(locale, "inline.participantLearningProgress.missingEntry", {"zh":"此器材在所選時段尚未有學習記錄。","en":"No learning record exists for this equipment in the selected period."}),
    unknown: appText(locale, "inline.participantLearningProgress.unknown", {"zh":"器材","en":"Equipment"}),
    threshold: appText(locale, "inline.participantLearningProgress.threshold", {"zh":"已達 75%","en":"75% or above"}),
    below: appText(locale, "inline.participantLearningProgress.below", {"zh":"未達 75%","en":"Below 75%"}),
  };
}

export function ParticipantLearningEntry({ locale, daily = false, onPress }) {
	const copy = participantLearningCopy(locale);
	return <TouchableOpacity testID={daily ? "participant-learning-day-entry" : "participant-learning-total-entry"} accessibilityRole="button" onPress={onPress} style={styles.entry}>
		<Ionicons name="book-outline" size={27} color="#840B1C" />
		<Text style={styles.entryText}>{daily ? copy.daily : copy.cumulative}</Text>
		<Ionicons name="chevron-forward" size={22} color="#777" />
	</TouchableOpacity>;
}

export function ParticipantLearningScope({ locale, date }) {
	const copy = participantLearningCopy(locale);
	return <View style={styles.scope} testID="participant-learning-scope">
		<Text style={styles.scopeTitle}>{date || copy.cumulative}</Text>
		<Text style={styles.hint}>{date ? copy.dayHint : copy.cumulativeHint}</Text>
		<Text style={styles.hint}>{copy.contentHint}</Text>
	</View>;
}

export function ParticipantLearningMetrics({ entry, item, locale, detailed = false }) {
	const copy = participantLearningCopy(locale);
	const coverage = item ? equipmentLearningCoverage(entry, item, locale) : {};
	const flags = item ? equipmentLearningFlags(entry, item, locale) : {};
	return <View style={detailed ? styles.metricsDetails : styles.metrics}>
		{["read", "watched", "listened"].map(field => {
			const ratio = Math.max(0, Math.min(1, Number(coverage[field]) || 0));
			const percent = item ? `${Math.floor(ratio * 100)}%` : "—";
			const complete = Boolean(flags[field]);
			const names = { read: complete ? "book" : "book-outline", watched: complete ? "videocam" : "videocam-outline", listened: complete ? "volume-high" : "volume-mute-outline" };
			return <View key={field} testID={`participant-learning-${field}`} style={detailed ? styles.metricDetail : styles.metric} accessibilityLabel={`${copy[field]} ${percent} ${complete ? copy.threshold : copy.below}`}>
				<View style={styles.metricHeading}><Ionicons testID={`participant-learning-icon-${field}`} name={names[field]} size={detailed ? 28 : 21} color={complete ? "#2E8B57" : "#989898"} /><Text style={styles.metricName}>{copy[field]}</Text><Text testID={`participant-learning-percent-${field}`} style={[styles.percent, complete && styles.complete]}>{percent}</Text></View>
				{detailed && <><View style={styles.track}><View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: complete ? "#2E8B57" : "#AAB2BC" }]} /></View><Text style={styles.hint}>{item ? (complete ? copy.threshold : copy.below) : copy.missing}</Text></>}
			</View>;
		})}
	</View>;
}

export function ParticipantLearningEquipment({ item, equipmentId, locale, children }) {
	const copy = participantLearningCopy(locale);
	return <View>
		<View style={styles.equipmentHeading}>
			{item?.icon ? <Image source={equipmentImageSource(item.icon)} style={styles.image} accessibilityIgnoresInvertColors /> : <View style={[styles.image, styles.placeholder]}><Ionicons name="barbell-outline" size={30} color="#8A6270" /></View>}
			<Text style={styles.name}>{item?.name || `${copy.unknown} ${equipmentId}`}</Text>
		</View>
		{children}
	</View>;
}

const styles = StyleSheet.create({
	entry: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 74, padding: 15, borderRadius: 14, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#E6D8DC", marginTop: 16, marginBottom: 6 },
	entryText: { flex: 1, fontSize: RFValue(15), fontWeight: "700", color: "#840B1C" },
	scope: { backgroundColor: "#F8F3F4", borderRadius: 12, padding: 14, marginBottom: 16 },
	scopeTitle: { fontSize: RFValue(15), fontWeight: "700", color: "#333" }, hint: { fontSize: RFValue(11), lineHeight: RFValue(17), color: "#666", marginTop: 6 },
	equipmentHeading: { flexDirection: "row", alignItems: "center", gap: 12 }, image: { width: 84, height: 76, borderRadius: 10, resizeMode: "cover" }, placeholder: { backgroundColor: "#F4EBED", alignItems: "center", justifyContent: "center" },
	name: { flex: 1, fontSize: RFValue(16), fontWeight: "800", lineHeight: RFValue(22), color: "#222" },
	metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 }, metricsDetails: { marginTop: 20, gap: 14 }, metric: { flexGrow: 1 }, metricDetail: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#E4E6EA", backgroundColor: "#FFF" },
	metricHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }, metricName: { fontSize: RFValue(11), color: "#555" }, percent: { fontSize: RFValue(12), fontWeight: "700", color: "#666" }, complete: { color: "#2E8B57" },
	track: { height: 9, borderRadius: 5, backgroundColor: "#EDEFF1", overflow: "hidden", marginTop: 12 }, fill: { height: "100%", borderRadius: 5 },
});
