import { appText } from "../../../utils/appText";
import React, { useContext, useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useUsageBack } from "../../../hooks/useUsageBack";
import { participantLearningPage, participantLearningParam, useParticipantLearningPage } from "../../../hooks/useParticipantLearningPage";
import { ParticipantLearningEquipment, ParticipantLearningMetrics, ParticipantLearningScope, participantLearningCopy } from "../../../components/ParticipantLearningProgress";

export default function ParticipantLearningDetail() {
	const params = useLocalSearchParams();
	const participantId = participantLearningParam(params.participantId), date = participantLearningParam(params.date), equipmentId = participantLearningParam(params.equipmentId);
	const returnWeek = participantLearningParam(params.returnWeek);
	const view = participantLearningParam(params.view) === "exercise" ? "exercise" : "usage", page = participantLearningPage(params.page);
	const { user } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext); const insets = useSafeAreaInsets();
	const copy = participantLearningCopy(locale);
	// Locate by stable equipment ID, not its former list position: new learning
	// activity can reorder pages while this detail screen is open.
	const { result, catalog, loading, error, retry } = useParticipantLearningPage({ token: user?.token, participantId, date, page: 1, equipmentId, locale, i18n });
	const target = useMemo(() => ({ pathname: "/participant-usage/learning", params: { participantId, ...(date ? { date } : {}), ...(returnWeek ? { returnWeek } : {}), view, page: String(page) } }), [participantId, date, returnWeek, view, page]);
	const back = useUsageBack(target, true);
	const record = result?.items?.find(item => String(item.equipmentId) === equipmentId);
	const equipment = catalog.find(item => String(item.id) === equipmentId);
	return <View style={styles.page}>
		<Stack.Screen options={{ title: copy.details, headerLeft: () => <TouchableOpacity testID="participant-learning-detail-back" accessibilityRole="button" accessibilityLabel={appText(locale, "inline.participantLearningDetail.back", {"zh":"返回","en":"Back"})} onPress={back} style={styles.back}><Ionicons name="chevron-back" size={24} color="#111" /></TouchableOpacity> }} />
		{loading ? <ActivityIndicator testID="participant-learning-loading" style={styles.loading} color="#840B1C" /> : <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
			{error ? <><Text testID="participant-learning-error" style={styles.message}>{copy[error]}</Text><TouchableOpacity testID="participant-learning-retry" style={styles.retry} onPress={retry}><Text style={styles.retryText}>{copy.retry}</Text></TouchableOpacity></> : <>
				<Text style={styles.person}>{result?.participant?.name || ""}</Text>
				<ParticipantLearningScope locale={locale} date={date} />
				{record ? <><ParticipantLearningEquipment item={equipment} equipmentId={equipmentId} locale={locale} /><ParticipantLearningMetrics entry={record.entry} item={equipment} locale={locale} detailed />{!equipment && <Text style={styles.message}>{copy.missing}</Text>}</> : <Text testID="participant-learning-empty" style={styles.message}>{copy.missingEntry}</Text>}
			</>}
		</ScrollView>}
	</View>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F5F6F8" }, back: { padding: 8 }, loading: { marginTop: 40 }, person: { fontSize: RFValue(18), fontWeight: "800", color: "#222", marginBottom: 12 }, message: { fontSize: RFValue(13), lineHeight: RFValue(21), color: "#666", paddingVertical: 12 }, retry: { minHeight: 48, justifyContent: "center", padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: "#840B1C", marginTop: 12 }, retryText: { fontWeight: "700", color: "#FFF", fontSize: RFValue(13) } });
