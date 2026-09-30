import React, { useCallback, useContext, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getVolunteerParticipantUsage } from "../../../utils/api";
import { useUsageBack } from "../../../hooks/useUsageBack";
import { ParticipantLearningEntry } from "../../../components/ParticipantLearningProgress";

export default function ParticipantUsageDates() {
	const { participantId: rawParticipantId, view } = useLocalSearchParams();
	const participantId = String((Array.isArray(rawParticipantId) ? rawParticipantId[0] : rawParticipantId) || "");
	const dataView = (Array.isArray(view) ? view[0] : view) === "exercise" ? "exercise" : "usage";
	const listTarget = React.useMemo(() => ({ pathname: "/participant-usage", params: { view: dataView } }), [dataView]);
	const back = useUsageBack(listTarget, true);
	const { user } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext);
	const insets = useSafeAreaInsets();
	const [participant, setParticipant] = useState(null); const [days, setDays] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
	const scope = JSON.stringify([user?.token, participantId]);
	const [loadedScope, setLoadedScope] = useState(null);
	useFocusEffect(useCallback(() => {
		let active = true; setLoadedScope(scope); setLoading(true); setError(""); setParticipant(null); setDays([]);
		if (!user?.token || !participantId) { setLoading(false); setError(i18n.t("participantUsageUnavailable")); return () => { active = false; }; }
		getVolunteerParticipantUsage(user?.token, participantId).then((result) => { if (active) { setParticipant(result.participant); setDays(result.days || []); } }).catch(() => active && setError(i18n.t("aiChatError"))).finally(() => active && setLoading(false));
		return () => { active = false; };
	}, [i18n, participantId, user?.token, scope]));
	const visibleDays = days.filter((item) => dataView === "exercise"
		? Number(item.exerciseSessions || 0) > 0
		: Number(item.appSessions || 0) + Number(item.researchEvents || 0) + Number(item.screenViews || 0) + Number(item.audioPlays || 0) + Number(item.videoPlays || 0) + Number(item.facilityLearningCount || 0) > 0);
	return <View style={styles.page}>
		<Stack.Screen options={{ title: i18n.t(dataView === "exercise" ? "dailyExerciseData" : "dailyUsage"), headerLeft: () => <TouchableOpacity onPress={back} style={{ padding: 8 }}><Ionicons name="chevron-back" size={24} color="#111" /></TouchableOpacity> }} />
		{loading || loadedScope !== scope ? <View style={styles.center}><ActivityIndicator size="large" color="#840B1C" /></View> : <>
		{participant && <View style={styles.person}><Ionicons name="person-circle" size={48} color="#840B1C" /><View style={{ flex: 1 }}><Text style={styles.personName}>{participant.name}</Text><Text style={styles.personPhone}>{participant.phone}</Text></View></View>}
		{!!error && <Text style={styles.empty}>{error}</Text>}
		{dataView === "usage" && participant && <ParticipantLearningEntry locale={locale} onPress={() => router.push({ pathname: "/participant-usage/learning", params: { participantId, view: dataView } })} />}
		<Text style={styles.hint}>{i18n.t(dataView === "exercise" ? "participantExerciseDatesHint" : "participantUsageDatesHint")}</Text>
		<FlatList data={visibleDays} keyExtractor={(item) => item.date} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} ListEmptyComponent={!error && <Text style={styles.empty}>{i18n.t(dataView === "exercise" ? "noExerciseData" : "noDailyUsage")}</Text>} renderItem={({ item }) => (
			<TouchableOpacity accessibilityRole="button" style={styles.dayCard} onPress={() => router.push({ pathname: "/participant-usage/day", params: { participantId, date: item.date, view: dataView } })}>
				<Ionicons name="calendar-outline" size={28} color="#840B1C" />
				<Text style={styles.date}>{new Date(item.date + "T12:00:00").toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</Text>
				<Ionicons name="chevron-forward" size={23} color="#777" />
			</TouchableOpacity>
		)} />
		</>}
	</View>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F5F6F8", padding: 16 }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, person: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 15, padding: 14 }, personName: { fontSize: RFValue(17), fontWeight: "800", color: "#222" }, personPhone: { fontSize: RFValue(12), color: "#666", marginTop: 3 }, hint: { fontSize: RFValue(13), color: "#666", marginVertical: 18 }, dayCard: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 78, backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12 }, date: { flex: 1, fontSize: RFValue(15), fontWeight: "700", color: "#333" }, empty: { fontSize: RFValue(13), color: "#777", textAlign: "center", padding: 24 } });
