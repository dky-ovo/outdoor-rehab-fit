import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getVolunteerParticipantUsage } from "../../../utils/api";
import { useUsageBack } from "../../../hooks/useUsageBack";
import UsageMetricCards from "../../../components/UsageMetricCards";
import { ParticipantLearningEntry } from "../../../components/ParticipantLearningProgress";

const fieldLabels = locale => ({
	date: appText(locale, "inline.participantDay.completionDateTime", { zh: "完成日期及時間", en: "Completion date and time" }),
	durationSec: appText(locale, "inline.participantDay.duration", { zh: "運動時長", en: "Duration" }),
	mode: appText(locale, "inline.participantDay.exerciseLocation", { zh: "運動地點", en: "Exercise location" }),
	emotion: appText(locale, "inline.participantDay.exerciseMood", { zh: "運動心情", en: "Exercise mood" }),
	rpe: appText(locale, "inline.participantDay.perceivedExertion", { zh: "自覺竭力程度", en: "Perceived exertion" }),
	journal: appText(locale, "inline.participantDay.problemsDuringExercise", { zh: "運動期間遇到的問題", en: "Problems during exercise" }),
	exercises: appText(locale, "inline.participantDay.outdoorEquipmentUsed", { zh: "曾經使用的戶外設施", en: "Outdoor equipment used" }),
	types: appText(locale, "inline.participantDay.exerciseTypes", { zh: "運動類型", en: "Exercise types" }),
});

function minutesLabel(seconds, locale) {
	const minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
	return appText(locale, "inline.participantDay.minutes", { zh: "%{minutes} 分鐘", en: "%{minutes} min" }, { minutes });
}

function dateTimeLabel(value, locale) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value || "-");
	return date.toLocaleString(locale === "zh" ? "zh-HK" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function SessionSnapshot({ session, locale, muted = false }) {
	const typeNames = [session?.types?.aerobic && (appText(locale, "inline.participantDay.aerobic", {"zh":"帶氧運動","en":"Aerobic"})), session?.types?.balance && (appText(locale, "inline.participantDay.balance", {"zh":"平衡運動","en":"Balance"})), session?.types?.muscle && (appText(locale, "inline.participantDay.muscleStrengthening", {"zh":"肌肉強化","en":"Muscle strengthening"}))].filter(Boolean);
	return <View style={[styles.snapshot, muted && styles.snapshotMuted]}>
		<Text style={styles.snapshotLine}>{dateTimeLabel(session?.date, locale)} · {minutesLabel(session?.durationSec, locale)}</Text>
		<Text style={styles.snapshotMeta}>{session?.mode === "home" ? (appText(locale, "inline.participantDay.homeExercise", {"zh":"居家運動","en":"Home exercise"})) : (appText(locale, "inline.participantDay.outdoorExercise", {"zh":"戶外運動","en":"Outdoor exercise"}))}{typeNames.length ? ` · ${typeNames.join("、")}` : ""}</Text>
		{Array.isArray(session?.exercises) && session.exercises.length > 0 && <View style={styles.equipmentList}>{session.exercises.map((exercise, index) => <Text key={`${exercise.equipmentId || exercise.name}-${index}`} style={styles.equipmentText}>• {exercise.name || (appText(locale, "inline.participantDay.unnamedEquipment", {"zh":"未命名設施","en":"Unnamed equipment"}))}{Number.isInteger(exercise.intensity) ? ` · ${appText(locale, "inline.participantDay.exertion", {"zh":"竭力程度","en":"Exertion"})} ${exercise.intensity}/10` : ""}</Text>)}</View>}
		<View style={styles.detailRow}><Text style={styles.detailLabel}>{appText(locale, "inline.participantDay.mood", {"zh":"心情","en":"Mood"})}</Text><Text style={styles.detailValue}>{session?.emotion ?? "-"}/5</Text></View>
		<View style={styles.detailRow}><Text style={styles.detailLabel}>{appText(locale, "inline.participantDay.rpe", {"zh":"自覺竭力","en":"RPE"})}</Text><Text style={styles.detailValue}>{session?.rpe ?? "-"}/10</Text></View>
		{!!session?.journal && <Text style={styles.journal}>{session.journal}</Text>}
	</View>;
}

export default function ParticipantUsageDay() {
	const { participantId: rawParticipantId, date: rawDate, view } = useLocalSearchParams();
	const participantId = String((Array.isArray(rawParticipantId) ? rawParticipantId[0] : rawParticipantId) || "");
	const date = String((Array.isArray(rawDate) ? rawDate[0] : rawDate) || "");
	const dataView = (Array.isArray(view) ? view[0] : view) === "exercise" ? "exercise" : "usage";
	const target = useMemo(() => ({ pathname: "/participant-usage/detail", params: { participantId, view: dataView } }), [dataView, participantId]);
	const back = useUsageBack(target, true);
	const { user } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext); const insets = useSafeAreaInsets();
	const [result, setResult] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
	const [expandedHistory, setExpandedHistory] = useState({});
	const labels = fieldLabels(locale);
	const scope = JSON.stringify([user?.token, participantId, date]);
	const [loadedScope, setLoadedScope] = useState(null);
	useFocusEffect(useCallback(() => {
		let active = true; setLoadedScope(scope); setLoading(true); setError(false); setResult(null); setExpandedHistory({});
		if (!user?.token || !participantId) { setLoading(false); setError(true); return () => { active = false; }; }
		getVolunteerParticipantUsage(user?.token, participantId).then((value) => active && setResult(value)).catch(() => active && setError(true)).finally(() => active && setLoading(false));
		return () => { active = false; };
	}, [participantId, date, user?.token, scope]));
	const day = result?.days?.find((item) => item.date === date);
	const rows = day ? [
		{ icon: "log-in", labelKey: "appStarts", value: day.appSessions, color: "#007BFF" },
		{ icon: "eye", labelKey: "screenViews", value: day.screenViews, color: "#E9A23B" },
		{ icon: "volume-high", labelKey: "usageAudioPlays", value: day.audioPlays, color: "#9B59B6" },
		{ icon: "leaf", labelKey: "usageOutdoorSessions", value: day.outdoorSessions, color: "#27AE60" },
		{ icon: "home", labelKey: "usageHomeSessions", value: day.homeSessions, color: "#3498DB" },
		{ icon: "fitness", labelKey: "exerciseSessions", value: day.exerciseSessions, color: "#840B1C" },
		{ icon: "time", labelKey: "exerciseMinutes", value: day.exerciseMinutes, unitKey: "minutes", color: "#E67E22" },
		{ icon: "analytics", labelKey: "researchActivities", value: day.researchEvents, color: "#2E8B57" },
	] : [];
	return <View style={styles.page}>
		<Stack.Screen options={{ title: String(date || i18n.t(dataView === "exercise" ? "dailyExerciseData" : "dailyUsage")), headerLeft: () => <TouchableOpacity onPress={back} style={{ padding: 8 }}><Ionicons name="chevron-back" size={24} /></TouchableOpacity> }} />
		{loading || loadedScope !== scope ? <ActivityIndicator style={{ marginTop: 40 }} color="#840B1C" /> : <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
			{result?.participant && <Text style={styles.title}>{result.participant.name} · {date}</Text>}
			{dataView === "usage" && result?.participant && <ParticipantLearningEntry locale={locale} daily onPress={() => router.push({ pathname: "/participant-usage/learning", params: { participantId, date, view: dataView } })} />}
			{day ? <>{dataView === "usage" && <UsageMetricCards rows={rows.filter((row) => !["usageOutdoorSessions", "usageHomeSessions", "exerciseSessions", "exerciseMinutes"].includes(row.labelKey))} i18n={i18n} />}
				{dataView === "exercise" && <><UsageMetricCards rows={rows.filter((row) => ["usageOutdoorSessions", "usageHomeSessions", "exerciseSessions", "exerciseMinutes"].includes(row.labelKey))} i18n={i18n} />
				<Text style={styles.sectionTitle}>{appText(locale, "inline.participantDay.exerciseRecords", {"zh":"當日運動記錄","en":"Exercise records"})}</Text>
				{(day.sessions || []).map((session, index) => {
					const expanded = Boolean(expandedHistory[session.id]);
					return <View key={session.id || index} style={styles.sessionCard}>
						<View style={styles.sessionHeader}><Ionicons name={session.mode === "home" ? "home" : "leaf"} size={24} color="#840B1C" /><Text style={styles.sessionName}>{appText(locale, "inline.participantDay.sessionNumber", { zh: "第 %{number} 節運動", en: "Session %{number}" }, { number: index + 1 })}</Text>{session.isModified && <View style={styles.modifiedBadge}><Text style={styles.modifiedBadgeText}>{appText(locale, "inline.participantDay.modified", {"zh":"已修改","en":"Modified"})}</Text></View>}</View>
						<SessionSnapshot session={session} locale={locale} />
						{session.isModified && <><Text style={styles.modifiedFields}>{appText(locale, "inline.participantDay.changed", {"zh":"本次修改：","en":"Changed: "})}{(session.modifiedFields || []).map((field) => labels[field] || field).join(locale === "zh" ? "、" : ", ")}</Text>
							<TouchableOpacity style={styles.historyButton} onPress={() => setExpandedHistory((current) => ({ ...current, [session.id]: !expanded }))}><Ionicons name="time-outline" size={20} color="#840B1C" /><Text style={styles.historyButtonText}>{expanded ? (appText(locale, "inline.participantDay.hidePreviousData", {"zh":"收起修改記錄","en":"Hide previous data"})) : (appText(locale, "inline.participantDay.viewPreviousData", {"zh":"查看修改前資料","en":"View previous data"}))}</Text></TouchableOpacity>
							{expanded && <View style={styles.historyPanel}>{(session.history || []).map((revision) => <View key={revision.versionNumber} style={styles.historyItem}><Text style={styles.historyTitle}>{appText(locale, "inline.participantDay.previousVersion", { zh: "修改前版本 %{version}", en: "Previous version %{version}" }, { version: revision.versionNumber })}</Text><Text style={styles.historyTime}>{dateTimeLabel(revision.changedAt, locale)}</Text><Text style={styles.historyChanges}>{(revision.changedFields || []).map((field) => labels[field] || field).join(locale === "zh" ? "、" : ", ")}</Text><SessionSnapshot session={revision.snapshot} locale={locale} muted /></View>)}</View>}
						</>}
					</View>;
				})}</>}
			</> : <Text>{i18n.t(error ? "aiChatError" : dataView === "exercise" ? "noExerciseData" : "noDailyUsage")}</Text>}
		</ScrollView>}
	</View>;
}

const styles = StyleSheet.create({
	page:{flex:1,backgroundColor:"#fff"},title:{fontSize:RFValue(19),fontWeight:"800",marginBottom:18,color:"#222"},sectionTitle:{fontSize:RFValue(17),fontWeight:"800",color:"#222",marginTop:24,marginBottom:12},sessionCard:{borderWidth:1,borderColor:"#E2E4E8",borderRadius:16,padding:14,marginBottom:14,backgroundColor:"#fff"},sessionHeader:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:10},sessionName:{flex:1,fontSize:RFValue(15),fontWeight:"800",color:"#222"},modifiedBadge:{backgroundColor:"#FDE8EB",borderRadius:999,paddingHorizontal:10,paddingVertical:5},modifiedBadgeText:{fontSize:RFValue(10),fontWeight:"800",color:"#9B1C2C"},snapshot:{backgroundColor:"#FAFAFB",borderRadius:12,padding:12},snapshotMuted:{backgroundColor:"#F2F3F5"},snapshotLine:{fontSize:RFValue(13),fontWeight:"800",color:"#333"},snapshotMeta:{fontSize:RFValue(11),color:"#666",marginTop:4},equipmentList:{marginTop:9},equipmentText:{fontSize:RFValue(11),lineHeight:RFValue(18),color:"#333"},detailRow:{flexDirection:"row",justifyContent:"space-between",marginTop:8},detailLabel:{fontSize:RFValue(11),color:"#666"},detailValue:{fontSize:RFValue(11),fontWeight:"700",color:"#333"},journal:{fontSize:RFValue(11),lineHeight:RFValue(18),color:"#444",marginTop:10,paddingTop:9,borderTopWidth:1,borderTopColor:"#E4E5E7"},modifiedFields:{fontSize:RFValue(10),lineHeight:RFValue(16),color:"#9B1C2C",marginTop:10},historyButton:{minHeight:46,marginTop:10,borderWidth:1,borderColor:"#840B1C",borderRadius:10,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},historyButtonText:{fontSize:RFValue(12),fontWeight:"800",color:"#840B1C"},historyPanel:{marginTop:12,borderTopWidth:1,borderTopColor:"#E2E4E8",paddingTop:12},historyItem:{marginBottom:14},historyTitle:{fontSize:RFValue(12),fontWeight:"800",color:"#555"},historyTime:{fontSize:RFValue(10),color:"#777",marginTop:3},historyChanges:{fontSize:RFValue(10),color:"#9B1C2C",marginVertical:7},
});
