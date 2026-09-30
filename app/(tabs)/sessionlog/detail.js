// Review a saved session, including new intensity values and legacy reps.
import React, { useContext, useMemo, useState } from "react";
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { AuthContext } from "../../../contexts/AuthContext";
import { getSessionById } from "../../../utils/sessions";
import { formatDuration, formatDateTime } from "../../../utils/dates";
import { shareSession } from "../../../utils/share";
import { showAlert } from "../../../utils/alert";

const EMOJIS = { 1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😄" };

const SessionDetail = () => {
	const { i18n, locale } = useContext(LocaleContext);
	const { user } = useContext(AuthContext);
	const { id: rawId } = useLocalSearchParams();
	const id = Array.isArray(rawId) ? rawId[0] : rawId;
	const [session, setSession] = useState(null);
	const equipmentNames = useMemo(() => {
		const catalog = i18n.t("equipmentList", { returnObjects: true });
		return new Map((Array.isArray(catalog) ? catalog : []).map((item) => [String(item.id), item.name]));
	}, [i18n, locale]);

	useFocusEffect(
		React.useCallback(() => {
			let active = true;
			setSession(null);
			getSessionById(id, user?.token).then((record) => {
				if (!active) return;
				if (!record) { router.dismissTo("/sessionlog"); return; }
				setSession(record);
			}).catch(() => {
				if (!active) return;
				showAlert("", i18n.t("serverError"));
				router.dismissTo("/sessionlog");
			});
			return () => { active = false; };
		}, [i18n, id, user?.token])
	);

	if (!session || String(session.id) !== String(id)) return null;

	const typeRows = [
		{ key: "aerobic", label: i18n.t("aerobicDone") },
		{ key: "balance", label: i18n.t("balanceDone") },
		{ key: "muscle", label: i18n.t("muscleDone") },
	];

	return (<>
		<ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: hp("15%") }}>
			<View style={styles.header}>
				<MaterialCommunityIcons
					name={session.mode === "home" ? "home-variant" : "tree"}
					size={RFValue(32)}
					color={session.mode === "home" ? "#007BFF" : "#2E8B57"}
				/>
				<Text style={styles.headerTitle}>{i18n.t(session.mode === "home" ? "homeSession" : "outdoorSession")}</Text>
			</View>

			<View style={styles.block}>
				<Text style={styles.label}>{i18n.t("completionTime")}</Text>
				<Text style={styles.value}>{formatDateTime(session.date, locale)}</Text>
			</View>

			<View style={styles.block}>
				<Text style={styles.label}>{i18n.t("totalDuration")}</Text>
				<Text style={styles.duration}>{formatDuration(session.durationSec)}</Text>
			</View>

			<View style={styles.block}>
				<Text style={styles.label}>{i18n.t("typeChecklist")}</Text>
				{typeRows.map(({ key, label }) => (
					<View key={key} style={styles.checkRow}>
						<Ionicons
							name={session.types?.[key] ? "checkmark-circle" : "close-circle-outline"}
							size={RFValue(22)}
							color={session.types?.[key] ? "#2E8B57" : "#bbb"}
						/>
						<Text style={styles.checkLabel}>{label}</Text>
					</View>
				))}
			</View>

			{session.mode === "outdoor" && session.exercises?.length > 0 && (
				<View style={styles.block}>
					<Text style={styles.label}>{i18n.t("exerciseTypeRecord")}</Text>
					{session.exercises.map((ex, i) => (
						<View key={i} style={styles.exerciseRow}>
							<Text style={styles.exerciseName}>{equipmentNames.get(String(ex.equipmentId)) || ex.name}</Text>
							{ex.intensity !== null && ex.intensity !== undefined && ex.intensity !== "" ? (
								<Text style={styles.exerciseReps}>
									{i18n.t("equipmentIntensity")}: {ex.intensity} / 10
								</Text>
							) : ex.reps ? (
								<Text style={styles.exerciseReps}>
									{i18n.t("legacyReps")}: {ex.reps}
								</Text>
							) : null}
						</View>
					))}
				</View>
			)}

			{session.emotion ? (
				<View style={styles.block}>
					<Text style={styles.label}>{i18n.t("emotionScale")}</Text>
					<Text style={styles.emoji}>{EMOJIS[session.emotion]}</Text>
				</View>
			) : null}

			{session.rpe !== null && session.rpe !== undefined ? (
				<View style={styles.block}>
					<Text style={styles.label}>{i18n.t("rpeScale")}</Text>
					<Text style={styles.value}>{session.rpe} / 10</Text>
				</View>
			) : null}

			{session.journal ? (
				<View style={styles.block}>
					<Text style={styles.label}>{i18n.t("sessionJournal")}</Text>
					<Text style={styles.value}>{session.journal}</Text>
				</View>
			) : null}

			<View style={styles.actionRow}>
				<TouchableOpacity style={styles.editBtn} onPress={() => router.push({ pathname: "/sessionlog/edit", params: { id: session.id } })}>
					<Ionicons name="create-outline" size={RFValue(20)} color="#840B1C" />
					<Text style={styles.editBtnText}>{i18n.t("editSession")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={styles.shareBtn} onPress={() => shareSession(session, i18n, locale, { allowChat: false })}>
					<Ionicons name="share-social" size={RFValue(20)} color="#fff" />
					<Text style={styles.shareBtnText}>{i18n.t("share")}</Text>
				</TouchableOpacity>
			</View>
		</ScrollView>
	</>);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
		paddingHorizontal: wp("5%"),
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		marginTop: hp("2%"),
		gap: 10,
	},
	headerTitle: {
		fontSize: RFValue(20),
		fontWeight: "bold",
		color: "#333",
		marginLeft: 8,
	},
	block: {
		marginTop: hp("2.5%"),
	},
	label: {
		fontSize: RFValue(14),
		fontWeight: "bold",
		color: "#888",
		marginBottom: 6,
	},
	value: {
		fontSize: RFValue(16),
		color: "#333",
		lineHeight: RFValue(24),
	},
	duration: {
		fontSize: RFValue(36),
		fontWeight: "bold",
		color: "#840B1C",
		fontVariant: ["tabular-nums"],
	},
	emoji: {
		fontSize: RFValue(32),
	},
	exerciseRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		backgroundColor: "#f8f9fa",
		borderRadius: 10,
		padding: 12,
		marginBottom: 8,
	},
	exerciseName: {
		flex: 1,
		fontSize: RFValue(14),
		color: "#333",
	},
	exerciseReps: {
		maxWidth: "48%",
		flexShrink: 1,
		fontSize: RFValue(14),
		fontWeight: "bold",
		color: "#840B1C",
		textAlign: "right",
	},
	checkRow: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 6,
	},
	checkLabel: {
		fontSize: RFValue(15),
		color: "#333",
		marginLeft: 10,
	},
	actionRow: { flexDirection: "row", gap: 10, marginTop: hp("4%") },
	editBtn: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 2,
		borderColor: "#840B1C",
		borderRadius: 50,
		paddingVertical: hp("2%"),
	},
	editBtnText: { color: "#840B1C", fontSize: RFValue(14), fontWeight: "bold", marginLeft: 6 },
	shareBtn: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#007BFF",
		borderRadius: 50,
		paddingVertical: hp("2%"),
		gap: 8,
	},
	shareBtnText: {
		color: "#fff",
		fontSize: RFValue(17),
		fontWeight: "bold",
		marginLeft: 6,
	},
});

export default SessionDetail;
