import { useAccountDataRevision } from '../../../hooks/useAccountDataRevision';
// App Upgrade #5: Session log - list of saved sessions, each with a share button (#7)
import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { StyleSheet, View, Text, SectionList, TextInput, TouchableOpacity } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { AuthContext } from "../../../contexts/AuthContext";
import { getSessions, deleteSession } from "../../../utils/sessions";
import { formatDuration, formatDateTime, toDateKey } from "../../../utils/dates";
import { shareSession } from "../../../utils/share";
import { showAlert } from "../../../utils/alert";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

const SessionLog = () => {
	const accountRevision = useAccountDataRevision(['sessions']);
	useAndroidBackTarget("/(tabs)");
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const { user } = useContext(AuthContext);
	const { date: rawDate } = useLocalSearchParams();
	const selectedDate = Array.isArray(rawDate) ? rawDate[0] : rawDate || "";
	const [sessions, setSessions] = useState([]);
	const [query, setQuery] = useState("");
	const [modeFilter, setModeFilter] = useState("all");
	const focusedRef = useRef(false);
	const deletingIdsRef = useRef(new Set());
	const equipmentNames = useMemo(() => {
		const catalog = i18n.t("equipmentList", { returnObjects: true });
		return new Map((Array.isArray(catalog) ? catalog : []).map((item) => [String(item.id), item.name]));
	}, [i18n, locale]);
	const exerciseName = useCallback((exercise) => equipmentNames.get(String(exercise?.equipmentId)) || exercise?.name || "", [equipmentNames]);

	useFocusEffect(
		useCallback(() => {
			let active = true;
			focusedRef.current = true;
			getSessions(user?.token).then((records) => { if (active) setSessions(records); }).catch(() => {
				if (active) showAlert("", i18n.t("serverError"));
			});
			return () => { active = false; focusedRef.current = false; };
		}, [i18n, user?.token, accountRevision])
	);

	const handleShare = (session) => {
		shareSession(session, i18n, locale, { allowChat: false });
	};

	const handleEdit = (session) => {
		router.push({ pathname: "/sessionlog/edit", params: { id: session.id } });
	};

	const handleDelete = (session) => {
		showAlert("", i18n.t("deleteSessionConfirm"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{
				text: i18n.t("delete"),
				style: "destructive",
				onPress: async () => {
					if (deletingIdsRef.current.has(String(session.id))) return;
					deletingIdsRef.current.add(String(session.id));
					try {
						const next = await deleteSession(session.id, user?.token);
						if (focusedRef.current) setSessions(next);
					} catch {
						if (focusedRef.current) showAlert("", i18n.t("serverError"));
					} finally { deletingIdsRef.current.delete(String(session.id)); }
				},
			},
		]);
	};

	const EMOJIS = { 1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😄" };
	const sections = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase(locale === "zh" ? "zh-HK" : "en-US");
		const filtered = sessions.filter((session) => {
			if (selectedDate && toDateKey(new Date(session.date)) !== selectedDate) return false;
			if (modeFilter !== "all" && session.mode !== modeFilter) return false;
			if (!needle) return true;
			const searchable = [
				session.date,
				formatDateTime(session.date, locale),
				session.journal,
				i18n.t(session.mode === "home" ? "homeSession" : "outdoorSession"),
				...(session.exercises || []).map(exerciseName),
			].filter(Boolean).join(" ").toLocaleLowerCase(locale === "zh" ? "zh-HK" : "en-US");
			return searchable.includes(needle);
		});
		const groups = new Map();
		filtered.forEach((session) => {
			const date = new Date(session.date);
			const key = Number.isNaN(date.getTime()) ? String(session.date || "") : date.toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "long", day: "numeric" });
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(session);
		});
		return [...groups.entries()].map(([title, data]) => ({ title, data }));
	}, [exerciseName, i18n, locale, textRevision, modeFilter, query, selectedDate, sessions]);

	const selectedDateLabel = useMemo(() => {
		if (!selectedDate) return "";
		const date = new Date(`${selectedDate}T12:00:00`);
		return date.toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "long", day: "numeric" });
	}, [locale, selectedDate]);

	return (
		<View style={styles.container}>
			<View style={styles.searchPanel}>
				{selectedDate ? <View style={styles.dateFilterBanner}><View><Text style={styles.dateFilterTitle}>{i18n.t("recordsOnDate")}</Text><Text style={styles.dateFilterValue}>{selectedDateLabel}</Text></View><TouchableOpacity style={styles.clearDateButton} onPress={() => router.setParams({ date: "" })}><Text style={styles.clearDateText}>{i18n.t("showAllDates")}</Text></TouchableOpacity></View> : null}
				<View style={styles.searchBox}><Ionicons name="search" size={20} color="#666" /><TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={i18n.t("sessionSearchPlaceholder")} /></View>
				<View style={styles.filterRow}>{[
					["all", "allSessions"], ["outdoor", "outdoorSession"], ["home", "homeSession"],
				].map(([value, label]) => <TouchableOpacity key={value} style={[styles.filterChip, modeFilter === value && styles.filterChipActive]} onPress={() => setModeFilter(value)}><Text style={[styles.filterText, modeFilter === value && styles.filterTextActive]}>{i18n.t(label)}</Text></TouchableOpacity>)}</View>
			</View>
			<SectionList
				sections={sections}
				keyExtractor={(item) => String(item.id)}
				contentContainerStyle={{ padding: wp("4%"), paddingBottom: hp("15%") }}
				renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
				renderItem={({ item }) => (
					<TouchableOpacity
						style={styles.card}
						onPress={() => router.push({ pathname: "/sessionlog/detail", params: { id: item.id } })}
					>
						<View style={styles.cardTop}>
							<MaterialCommunityIcons
								name={item.mode === "home" ? "home-variant" : "tree"}
								size={RFValue(24)}
								color={item.mode === "home" ? "#007BFF" : "#2E8B57"}
							/>
							<View style={{ flex: 1, marginLeft: 10 }}>
								<Text style={styles.cardTitle}>{i18n.t(item.mode === "home" ? "homeSession" : "outdoorSession")}</Text>
								<Text style={styles.cardDate}>{formatDateTime(item.date, locale)}</Text>
							</View>
							{item.emotion ? <Text style={styles.emotion}>{EMOJIS[item.emotion]}</Text> : null}
						</View>
						<View style={styles.cardBottom}>
							<View style={styles.durationBox}>
								<Ionicons name="time-outline" size={RFValue(16)} color="#840B1C" />
								<Text style={styles.duration}>{formatDuration(item.durationSec)}</Text>
							</View>
							{item.exercises?.length > 0 && (
								<Text style={styles.exerciseCount}>
									{i18n.t("exercisesDone")}: {item.exercises.length}
								</Text>
							)}
							<View style={styles.actions}>
								<TouchableOpacity style={styles.actionBtn} onPress={(event) => { event.stopPropagation?.(); handleEdit(item); }} accessibilityLabel={i18n.t("editSession")}>
									<Ionicons name="create-outline" size={RFValue(20)} color="#840B1C" />
								</TouchableOpacity>
								{/* Share button on every saved session (App Upgrade #5/#7) */}
								<TouchableOpacity style={styles.actionBtn} onPress={(event) => { event.stopPropagation?.(); handleShare(item); }}>
									<Ionicons name="share-social" size={RFValue(20)} color="#007BFF" />
								</TouchableOpacity>
								<TouchableOpacity style={styles.actionBtn} accessibilityLabel={i18n.t("delete")} onPress={(event) => { event.stopPropagation?.(); handleDelete(item); }}>
									<Ionicons name="trash-outline" size={RFValue(20)} color="#B00020" />
								</TouchableOpacity>
							</View>
						</View>
					</TouchableOpacity>
				)}
				ListEmptyComponent={() => (
					<View style={styles.empty}>
						<Ionicons name="clipboard-outline" size={RFValue(48)} color="#ccc" />
						<Text style={styles.emptyText}>{i18n.t("noSessions")}</Text>
					</View>
				)}
			/>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
	},
	searchPanel: { padding: wp("4%"), paddingBottom: 4, backgroundColor: "#fff" },
	dateFilterBanner: { minHeight: 64, borderRadius: 12, backgroundColor: "#FBEDEF", paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	dateFilterTitle: { color: "#840B1C", fontSize: RFValue(10), fontWeight: "700" },
	dateFilterValue: { color: "#333", fontSize: RFValue(14), fontWeight: "800", marginTop: 3 },
	clearDateButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 19, backgroundColor: "#840B1C", alignItems: "center", justifyContent: "center" },
	clearDateText: { color: "#fff", fontSize: RFValue(10), fontWeight: "700" },
	searchBox: { minHeight: 48, borderWidth: 1, borderColor: "#D5D5D5", borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, backgroundColor: "#FAFAFA" },
	searchInput: { flex: 1, minHeight: 46, paddingHorizontal: 10, fontSize: RFValue(14), color: "#222" },
	filterRow: { flexDirection: "row", gap: 8, marginTop: 10 },
	filterChip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: "#C9C9C9", alignItems: "center", justifyContent: "center" },
	filterChipActive: { backgroundColor: "#840B1C", borderColor: "#840B1C" },
	filterText: { color: "#555", fontSize: RFValue(12), fontWeight: "600" },
	filterTextActive: { color: "#fff" },
	sectionHeader: { backgroundColor: "#fff", color: "#333", fontSize: RFValue(15), fontWeight: "800", paddingVertical: 8 },
	card: {
		backgroundColor: "#fff",
		borderRadius: 14,
		padding: 16,
		marginBottom: 14,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 4,
		elevation: 3,
	},
	cardTop: {
		flexDirection: "row",
		alignItems: "center",
	},
	cardTitle: {
		fontSize: RFValue(15),
		fontWeight: "bold",
		color: "#333",
	},
	cardDate: {
		fontSize: RFValue(12),
		color: "#888",
		marginTop: 2,
	},
	emotion: {
		fontSize: RFValue(24),
	},
	cardBottom: {
		flexDirection: "row",
		alignItems: "center",
		marginTop: 12,
	},
	durationBox: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FBEAEA",
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 5,
		gap: 4,
	},
	duration: {
		fontSize: RFValue(14),
		fontWeight: "bold",
		color: "#840B1C",
		marginLeft: 4,
	},
	exerciseCount: {
		fontSize: RFValue(12),
		color: "#666",
		marginLeft: 12,
		flex: 1,
	},
	actions: {
		flexDirection: "row",
		marginLeft: "auto",
	},
	actionBtn: {
		padding: 6,
		marginLeft: 6,
	},
	empty: {
		alignItems: "center",
		marginTop: hp("15%"),
	},
	emptyText: {
		marginTop: 12,
		fontSize: RFValue(15),
		color: "#999",
	},
});

export default SessionLog;
