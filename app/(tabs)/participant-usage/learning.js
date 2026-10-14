import { appText } from "../../../utils/appText";
import React, { useContext, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useUsageBack } from "../../../hooks/useUsageBack";
import { participantLearningPage, participantLearningParam, useParticipantLearningPage } from "../../../hooks/useParticipantLearningPage";
import { ParticipantLearningEquipment, ParticipantLearningMetrics, ParticipantLearningScope, participantLearningCopy } from "../../../components/ParticipantLearningProgress";

export default function ParticipantLearningList() {
	const params = useLocalSearchParams();
	const participantId = participantLearningParam(params.participantId), date = participantLearningParam(params.date);
	const returnWeek = participantLearningParam(params.returnWeek);
	const view = participantLearningParam(params.view) === "exercise" ? "exercise" : "usage";
	const { user } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext); const insets = useSafeAreaInsets();
	const copy = participantLearningCopy(locale);
	const initialPage = participantLearningPage(params.page);
	const paginationScope = JSON.stringify([user?.token, participantId, date, view, locale, initialPage]);
	const [selection, setSelection] = useState(null);
	const page = selection?.scope === paginationScope ? selection.page : initialPage;
	const { result, catalog, loading, error, retry } = useParticipantLearningPage({ token: user?.token, participantId, date, page, locale, i18n });
	const target = useMemo(() => ({ pathname: date ? "/participant-usage/day" : "/participant-usage/detail", params: { participantId, ...(date ? { date } : {}), ...(returnWeek ? { returnWeek } : {}), view } }), [participantId, date, returnWeek, view]);
	const back = useUsageBack(target, true);
	const items = Array.isArray(result?.items) ? result.items : [];
	const catalogById = useMemo(() => new Map(catalog.map(item => [String(item.id), item])), [catalog]);
	const totalPages = Math.max(1, Number(result?.totalPages) || 1);
	const currentPage = Math.min(totalPages, Math.max(1, Number(result?.page) || page));
	const changePage = value => setSelection({ scope: paginationScope, page: value });
	return <View style={styles.page}>
		<Stack.Screen options={{ title: copy.title, headerLeft: () => <TouchableOpacity testID="participant-learning-back" accessibilityRole="button" accessibilityLabel={appText(locale, "inline.participantLearning.back", {"zh":"返回","en":"Back"})} onPress={back} style={styles.back}><Ionicons name="chevron-back" size={24} color="#111" /></TouchableOpacity> }} />
		{loading ? <ActivityIndicator testID="participant-learning-loading" style={styles.loading} color="#840B1C" /> : error ? <View style={styles.state}><Text testID="participant-learning-error" style={styles.message}>{copy[error]}</Text><TouchableOpacity testID="participant-learning-retry" onPress={retry} style={styles.retry}><Text style={styles.retryText}>{copy.retry}</Text></TouchableOpacity></View> : <FlatList
			testID="participant-learning-list" data={items} keyExtractor={item => String(item.equipmentId)} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
			ListHeaderComponent={<><Text style={styles.person}>{result?.participant?.name || ""}</Text><ParticipantLearningScope locale={locale} date={date} /></>}
			ListEmptyComponent={<Text testID="participant-learning-empty" style={styles.message}>{copy.empty}</Text>}
			renderItem={({ item: record }) => {
				const equipment = catalogById.get(String(record.equipmentId));
				return <TouchableOpacity testID={`participant-learning-equipment-${record.equipmentId}`} accessibilityRole="button" style={styles.card} onPress={() => router.push({ pathname: "/participant-usage/learning-detail", params: { participantId, ...(date ? { date } : {}), ...(returnWeek ? { returnWeek } : {}), view, page: String(currentPage), equipmentId: String(record.equipmentId) } })}>
					<ParticipantLearningEquipment item={equipment} equipmentId={record.equipmentId} locale={locale}><ParticipantLearningMetrics entry={record.entry} item={equipment} locale={locale} /></ParticipantLearningEquipment>
					{!equipment && <Text style={styles.message}>{copy.missing}</Text>}
				</TouchableOpacity>;
			}}
			ListFooterComponent={<View style={styles.pagination}>
				<TouchableOpacity testID="participant-learning-previous" accessibilityRole="button" style={[styles.pagerButton, currentPage <= 1 && styles.disabled]} disabled={currentPage <= 1} onPress={() => changePage(currentPage - 1)}><Text style={styles.pagerText}>{copy.previous}</Text></TouchableOpacity>
				<Text testID="participant-learning-page" style={styles.pageLabel}>{currentPage} / {totalPages}</Text>
				<TouchableOpacity testID="participant-learning-next" accessibilityRole="button" style={[styles.pagerButton, currentPage >= totalPages && styles.disabled]} disabled={currentPage >= totalPages} onPress={() => changePage(currentPage + 1)}><Text style={styles.pagerText}>{copy.next}</Text></TouchableOpacity>
			</View>}
		/>}
	</View>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F5F6F8" }, back: { padding: 8 }, loading: { marginTop: 40 }, state: { padding: 24 }, person: { fontSize: RFValue(18), fontWeight: "800", color: "#222", marginBottom: 12 }, card: { padding: 16, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#E4E6EA", borderRadius: 14, marginBottom: 12 }, message: { fontSize: RFValue(13), lineHeight: RFValue(21), color: "#666", paddingVertical: 12 }, retry: { padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: "#840B1C", marginTop: 12 }, retryText: { fontWeight: "700", color: "#FFF", fontSize: RFValue(13) }, pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }, pagerButton: { minHeight: 46, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#D8D9DC" }, pagerText: { fontSize: RFValue(12), color: "#840B1C", fontWeight: "700" }, pageLabel: { color: "#666", fontSize: RFValue(12) }, disabled: { opacity: 0.4 } });
