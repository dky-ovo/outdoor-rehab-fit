import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	BackHandler,
	FlatList,
	Image,
	KeyboardAvoidingView,
	Modal,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { AuthContext } from "../../../contexts/AuthContext";
import { getSessionById, saveSession } from "../../../utils/sessions";
import { showAlert } from "../../../utils/alert";
import { useSessionEquipment } from "../../../hooks/useSessionEquipment";
import { equipmentUseCount, sortSessionEquipment } from "../../../utils/sessionEquipment";

const EMOTIONS = [
	{ value: 1, emoji: "😞" },
	{ value: 2, emoji: "🙁" },
	{ value: 3, emoji: "😐" },
	{ value: 4, emoji: "🙂" },
	{ value: 5, emoji: "😄" },
];
const RPE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const pad2 = (value) => String(value).padStart(2, "0");

const localDateParts = (isoValue) => {
	const value = new Date(isoValue);
	const date = Number.isNaN(value.getTime()) ? new Date() : value;
	return {
		date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
		time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
	};
};

const parseLocalDateTime = (dateText, timeText) => {
	const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
	const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText || "").trim());
	if (!dateMatch || !timeMatch) return null;
	const year = Number(dateMatch[1]);
	const month = Number(dateMatch[2]);
	const day = Number(dateMatch[3]);
	const hour = Number(timeMatch[1]);
	const minute = Number(timeMatch[2]);
	const value = new Date(year, month - 1, day, hour, minute, 0, 0);
	if (
		value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day ||
		value.getHours() !== hour || value.getMinutes() !== minute
	) return null;
	return value;
};

const editableSnapshot = ({ completedDate, completedTime, durationMinutes, emotion, rpe, journal, exercises, types }) => JSON.stringify({
	completedDate,
	completedTime,
	durationMinutes,
	emotion: emotion ?? null,
	rpe: rpe ?? null,
	journal: journal || "",
	exercises: (exercises || []).map((item) => ({
		name: item.name || "",
		reps: String(item.reps ?? ""),
		intensity: item.intensity === null || item.intensity === undefined ? "" : String(item.intensity),
		equipmentId: item.equipmentId ?? null,
	})),
	types: {
		aerobic: Boolean(types?.aerobic),
		balance: Boolean(types?.balance),
		muscle: Boolean(types?.muscle),
	},
});

export default function EditSession() {
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const { user } = useContext(AuthContext);
	const navigation = useNavigation();
	const { id: rawId } = useLocalSearchParams();
	const id = Array.isArray(rawId) ? rawId[0] : rawId;
	const equipmentData = i18n.t("equipmentList", { returnObjects: true });

	const [session, setSession] = useState(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [completedDate, setCompletedDate] = useState("");
	const [completedTime, setCompletedTime] = useState("");
	const [durationMinutes, setDurationMinutes] = useState("");
	const [emotion, setEmotion] = useState(null);
	const [rpe, setRpe] = useState(null);
	const [journal, setJournal] = useState("");
	const [exercises, setExercises] = useState([]);
	const [types, setTypes] = useState({ aerobic: false, balance: false, muscle: false });
	const [pickerVisible, setPickerVisible] = useState(false);
	const [customEquipmentVisible, setCustomEquipmentVisible] = useState(false);
	const [customEquipmentName, setCustomEquipmentName] = useState("");
	const { bookmarks, usage: equipmentUsage } = useSessionEquipment(user?.token);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const initialSnapshotRef = useRef("");
	const initialTimingRef = useRef(null);
	const allowLeaveRef = useRef(false);
	const promptOpenRef = useRef(false);

	useEffect(() => {
		let active = true;
		setSession(null);
		setLoadFailed(false);
		allowLeaveRef.current = false;
		promptOpenRef.current = false;
		savingRef.current = false;
		setSaving(false);
		initialSnapshotRef.current = "";
		getSessionById(id, user?.token).then((record) => {
			if (!active) return;
			if (!record) {
				setLoadFailed(true);
				return;
			}
			const timing = localDateParts(record.date);
			const initialDurationMinutes = String(Math.max(1, Math.min(1440, Math.ceil((Number(record.durationSec) || 0) / 60))));
			const next = {
				completedDate: timing.date,
				completedTime: timing.time,
				durationMinutes: initialDurationMinutes,
				emotion: record.emotion ?? null,
				rpe: record.rpe ?? null,
				journal: record.journal || "",
				exercises: (record.exercises || []).map((item) => ({
					...item,
					reps: String(item.reps ?? ""),
					intensity: item.intensity === null || item.intensity === undefined ? "" : String(item.intensity),
					legacy: item.intensity === null || item.intensity === undefined,
				})),
				types: {
					aerobic: Boolean(record.types?.aerobic),
					balance: Boolean(record.types?.balance),
					muscle: Boolean(record.types?.muscle),
				},
			};
			setSession(record);
			setCompletedDate(next.completedDate);
			setCompletedTime(next.completedTime);
			setDurationMinutes(next.durationMinutes);
			setEmotion(next.emotion);
			setRpe(next.rpe);
			setJournal(next.journal);
			setExercises(next.exercises);
			setTypes(next.types);
			initialSnapshotRef.current = editableSnapshot(next);
			initialTimingRef.current = {
				completedDate: next.completedDate,
				completedTime: next.completedTime,
				durationMinutes: next.durationMinutes,
				date: record.date,
				durationSec: Number(record.durationSec),
			};
		}).catch(() => {
			if (!active) return;
			setLoadFailed(true);
			if (navigation.isFocused()) showAlert("", i18n.t("serverError"));
		});
		return () => { active = false; };
	}, [i18n, id, navigation, user?.token]);

	const currentSnapshot = useMemo(() => editableSnapshot({ completedDate, completedTime, durationMinutes, emotion, rpe, journal, exercises, types }), [completedDate, completedTime, durationMinutes, emotion, exercises, journal, rpe, types]);
	const isDirty = Boolean(session && initialSnapshotRef.current && currentSnapshot !== initialSnapshotRef.current);

	const leaveEditor = useCallback(() => {
		allowLeaveRef.current = true;
		promptOpenRef.current = false;
		router.dismissTo({ pathname: "/sessionlog/detail", params: { id } });
	}, [id]);

	const attemptLeave = useCallback(() => {
		if (!isDirty) {
			leaveEditor();
			return;
		}
		if (promptOpenRef.current) return;
		promptOpenRef.current = true;
		showAlert("", i18n.t("discardSessionChanges"), [
			{ text: i18n.t("cancel"), style: "cancel", onPress: () => { promptOpenRef.current = false; } },
			{ text: i18n.t("discardSession"), style: "destructive", onPress: leaveEditor },
		]);
	}, [i18n, isDirty, leaveEditor]);

	useLayoutEffect(() => {
		navigation.setOptions({
			headerLeft: () => (
				<TouchableOpacity onPress={attemptLeave} style={styles.headerBack} accessibilityRole="button" accessibilityLabel={i18n.t("back")}>
					<Ionicons name="chevron-back" size={RFValue(18)} color="#000" />
				</TouchableOpacity>
			),
		});
	}, [attemptLeave, i18n, locale, textRevision, navigation]);

	useFocusEffect(useCallback(() => {
		allowLeaveRef.current = false;
		promptOpenRef.current = false;
		return undefined;
	}, []));

	useFocusEffect(useCallback(() => {
		if (!loadFailed) return undefined;
		allowLeaveRef.current = true;
		router.dismissTo("/sessionlog");
		return undefined;
	}, [loadFailed]));

	useFocusEffect(useCallback(() => {
		const unsubscribe = navigation.addListener("beforeRemove", (event) => {
			if (!navigation.isFocused() || allowLeaveRef.current) return;
			event.preventDefault();
			attemptLeave();
		});
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			attemptLeave();
			return true;
		});
		return () => { subscription.remove(); unsubscribe(); };
	}, [attemptLeave, navigation]));

	const sortedEquipmentData = useMemo(() => {
		const items = sortSessionEquipment(equipmentData, bookmarks, equipmentUsage);
		return [...items, { id: "__other__", name: i18n.t("otherEquipment"), isOther: true }];
	}, [bookmarks, equipmentData, equipmentUsage, i18n, locale, textRevision]);

	const selectEquipment = (item) => {
		setPickerVisible(false);
		if (item.isOther) {
			setCustomEquipmentVisible(true);
			return;
		}
		setExercises((previous) => previous.some((exercise) => String(exercise.equipmentId) === String(item.id))
			? previous
			: [...previous, { name: item.name, intensity: "", reps: "", equipmentId: item.id, legacy: false }]);
	};

	const addCustomEquipment = () => {
		const name = customEquipmentName.trim();
		if (!name) return;
		const normalizedName = name.toLocaleLowerCase();
		setExercises((previous) => previous.some((exercise) => (
			String(exercise.equipmentId) === "other" && String(exercise.name || "").trim().toLocaleLowerCase() === normalizedName
		)) ? previous : [...previous, { name, intensity: "", reps: "", equipmentId: "other", legacy: false }]);
		setCustomEquipmentName("");
		setCustomEquipmentVisible(false);
	};

	const saveChanges = async () => {
		if (!session || String(session.id) !== String(id) || savingRef.current) return;
		const parsedDate = parseLocalDateTime(completedDate, completedTime);
		if (!parsedDate || parsedDate.getTime() > Date.now()) {
			showAlert("", i18n.t("manualDateTimeInvalid"));
			return;
		}
		const parsedDurationMinutes = Number(durationMinutes);
		if (!Number.isInteger(parsedDurationMinutes) || parsedDurationMinutes < 1 || parsedDurationMinutes > 1440) {
			showAlert("", i18n.t("manualDurationInvalid"));
			return;
		}
		if (session.mode === "outdoor") {
			const invalidIntensity = exercises.some((item) => {
				const raw = String(item.intensity ?? "").trim();
				if (!raw && item.legacy) return false;
				const value = Number(raw);
				return !/^\d{1,2}$/.test(raw) || !Number.isInteger(value) || value < 0 || value > 10;
			});
			if (invalidIntensity) {
				showAlert("", i18n.t("equipmentIntensityInvalid"));
				return;
			}
		}
		savingRef.current = true;
		setSaving(true);
		const normalizedExercises = session.mode === "outdoor" ? exercises.map((item) => {
			const rawIntensity = String(item.intensity ?? "").trim();
			const legacyReps = String(item.reps ?? "").trim();
			return {
				name: item.name,
				equipmentId: item.equipmentId,
				...(rawIntensity ? { intensity: Number(rawIntensity) } : {}),
				...(!rawIntensity && legacyReps ? { reps: legacyReps } : {}),
			};
		}) : [];
		const initialTiming = initialTimingRef.current;
		const dateChanged = !initialTiming || completedDate !== initialTiming.completedDate || completedTime !== initialTiming.completedTime;
		const durationChanged = !initialTiming || durationMinutes !== initialTiming.durationMinutes;
		const originalDurationIsValid = Number.isInteger(initialTiming?.durationSec) && initialTiming.durationSec >= 1 && initialTiming.durationSec <= 86400;
		const updated = {
			...session,
			date: dateChanged ? parsedDate.toISOString() : initialTiming.date,
			durationSec: durationChanged || !originalDurationIsValid ? parsedDurationMinutes * 60 : initialTiming.durationSec,
			emotion,
			rpe,
			journal: journal.trim(),
			exercises: normalizedExercises,
			types,
		};
		try {
			await saveSession(updated, user?.token);
			allowLeaveRef.current = true;
			showAlert("", i18n.t("sessionChangesSaved"), [{ text: i18n.t("confirm"), onPress: leaveEditor }]);
		} catch (error) {
			console.warn("Unable to update exercise session", error);
			savingRef.current = false;
			setSaving(false);
			showAlert("", i18n.t("serverError"));
		}
	};

	if (!session || String(session.id) !== String(id)) return <View style={styles.loading} />;

	return (
		<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
			<ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
				<View style={styles.notice}><Ionicons name="information-circle-outline" size={22} color="#840B1C" /><Text style={styles.noticeText}>{i18n.t("editSessionHint")}</Text></View>

				<View style={styles.timingBlock}>
					<Text style={styles.label}>{i18n.t("completionTime")}</Text>
					<View style={styles.timingRow}>
						<View style={styles.timingField}><Text style={styles.fieldCaption}>{i18n.t("manualDate")}</Text><TextInput style={styles.timingInput} value={completedDate} onChangeText={setCompletedDate} placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10} /></View>
						<View style={styles.timingField}><Text style={styles.fieldCaption}>{i18n.t("manualTime")}</Text><TextInput style={styles.timingInput} value={completedTime} onChangeText={setCompletedTime} placeholder="HH:mm" autoCapitalize="none" maxLength={5} /></View>
					</View>
					<Text style={[styles.label, { marginTop: 14 }]}>{i18n.t("totalDuration")}</Text>
					<View style={styles.durationInputRow}><TextInput style={styles.durationInput} value={durationMinutes} onChangeText={(value) => setDurationMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))} placeholder="--" keyboardType="number-pad" maxLength={4} /><Text style={styles.durationUnit}>{i18n.t("minutes")}</Text></View>
				</View>

				{session.mode === "outdoor" ? <View style={styles.block}>
					<Text style={styles.label}>{i18n.t("exerciseTypeRecord")}</Text>
					<TouchableOpacity style={styles.addButton} onPress={() => setPickerVisible(true)}><Ionicons name="add-circle-outline" size={20} color="#840B1C" /><Text style={styles.addButtonText}>{i18n.t("addExercise")}</Text></TouchableOpacity>
					{exercises.map((item, index) => (
						<View key={`${item.equipmentId || item.name}-${index}`} style={styles.exerciseRow}>
							<Text style={styles.exerciseName} numberOfLines={2}>{item.name}</Text>
							<View style={styles.repsField}>
								<Text style={styles.fieldCaption}>{i18n.t("equipmentIntensity")}</Text>
								<TextInput style={styles.repsInput} value={String(item.intensity ?? "")} onChangeText={(value) => setExercises((previous) => previous.map((exercise, itemIndex) => itemIndex === index ? { ...exercise, intensity: value.replace(/[^0-9]/g, "").slice(0, 2) } : exercise))} keyboardType="number-pad" maxLength={2} />
								{!String(item.intensity ?? "").trim() && String(item.reps ?? "").trim() ? <Text style={styles.legacyText}>{i18n.t("legacyReps")}: {item.reps}</Text> : null}
							</View>
							<TouchableOpacity style={styles.removeButton} onPress={() => setExercises((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}><Ionicons name="trash-outline" size={20} color="#B00020" /><Text style={styles.removeText}>{i18n.t("removeExercise")}</Text></TouchableOpacity>
						</View>
					))}
				</View> : null}

				<View style={styles.block}><Text style={styles.label}>{i18n.t("typeChecklist")}</Text>{[
					["aerobic", "aerobicDone"], ["balance", "balanceDone"], ["muscle", "muscleDone"],
				].map(([key, labelKey]) => <TouchableOpacity key={key} style={styles.checkRow} onPress={() => setTypes((previous) => ({ ...previous, [key]: !previous[key] }))}><Ionicons name={types[key] ? "checkbox" : "square-outline"} size={24} color={types[key] ? "#2E8B57" : "#888"} /><Text style={styles.checkText}>{i18n.t(labelKey)}</Text></TouchableOpacity>)}</View>

				<View style={styles.block}><Text style={styles.label}>{i18n.t("emotionScale")}</Text><View style={styles.emotionRow}>{EMOTIONS.map((item) => <TouchableOpacity key={item.value} style={[styles.emotionButton, emotion === item.value && styles.selectedEmotion]} onPress={() => setEmotion(item.value)}><Text style={styles.emoji}>{item.emoji}</Text></TouchableOpacity>)}</View></View>

				<View style={styles.block}><Text style={styles.label}>{i18n.t("rpeScale")}</Text><View style={styles.rpeRow}>{RPE_VALUES.map((value) => <TouchableOpacity key={value} style={[styles.rpeButton, rpe === value && styles.selectedRpe]} onPress={() => setRpe(value)}><Text style={[styles.rpeText, rpe === value && styles.selectedRpeText]}>{value}</Text></TouchableOpacity>)}</View></View>

				<View style={styles.block}><Text style={styles.label}>{i18n.t("sessionJournal")}</Text><TextInput style={styles.journalInput} value={journal} onChangeText={setJournal} placeholder={i18n.t("journalPlaceholder")} multiline maxLength={2000} /></View>

				<View style={styles.bottomActions}><TouchableOpacity style={styles.cancelButton} onPress={attemptLeave}><Text style={styles.cancelText}>{i18n.t("cancel")}</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={saveChanges} disabled={saving}><Text style={styles.saveText}>{i18n.t("saveSessionChanges")}</Text></TouchableOpacity></View>
			</ScrollView>

			<Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalBox}><Text style={styles.modalTitle}>{i18n.t("chooseEquipment")}</Text><FlatList data={sortedEquipmentData} keyExtractor={(item) => String(item.id)} renderItem={({ item }) => <TouchableOpacity style={styles.modalItem} onPress={() => selectEquipment(item)}>{item.isOther ? <View style={[styles.modalIcon, styles.otherIcon]}><Ionicons name="create-outline" size={28} color="#840B1C" /></View> : <Image source={item.icon} style={styles.modalIcon} />}<Text style={styles.modalItemText} numberOfLines={2}>{item.name}</Text>{!item.isOther && bookmarks[String(item.id)] ? <Ionicons name="heart" size={RFValue(20)} color="#840B1C" accessibilityLabel={i18n.t("favorite")} style={{ marginLeft: 8 }} /> : null}{!item.isOther && equipmentUseCount(item, equipmentUsage) > 0 ? <Text style={styles.frequentLabel}>{i18n.t("frequentlyUsed")}</Text> : null}</TouchableOpacity>} /><TouchableOpacity style={styles.modalClose} onPress={() => setPickerVisible(false)}><Text style={styles.modalCloseText}>{i18n.t("cancel")}</Text></TouchableOpacity></View></View></Modal>

			<Modal visible={customEquipmentVisible} animationType="fade" transparent onRequestClose={() => setCustomEquipmentVisible(false)}><View style={styles.centeredOverlay}><View style={styles.customBox}><Text style={styles.modalTitle}>{i18n.t("otherEquipment")}</Text><TextInput style={styles.customInput} value={customEquipmentName} onChangeText={setCustomEquipmentName} placeholder={i18n.t("otherEquipmentPlaceholder")} maxLength={80} autoFocus /><View style={styles.customActions}><TouchableOpacity style={styles.customCancel} onPress={() => setCustomEquipmentVisible(false)}><Text style={styles.customCancelText}>{i18n.t("cancel")}</Text></TouchableOpacity><TouchableOpacity style={[styles.customAdd, !customEquipmentName.trim() && styles.disabled]} onPress={addCustomEquipment} disabled={!customEquipmentName.trim()}><Text style={styles.customAddText}>{i18n.t("add")}</Text></TouchableOpacity></View></View></View></Modal>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	flex: { flex: 1 }, loading: { flex: 1, backgroundColor: "#fff" }, container: { flex: 1, backgroundColor: "#fff", paddingHorizontal: wp("5%") }, content: { paddingBottom: hp("15%") },
	headerBack: { paddingHorizontal: 8, paddingVertical: 6 },
	notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: "#FBEDEF" }, noticeText: { flex: 1, color: "#5E0A17", fontSize: RFValue(12), lineHeight: RFValue(18) },
	timingBlock: { marginTop: 18, padding: 16, borderRadius: 14, backgroundColor: "#F7F7F7" }, timingRow: { flexDirection: "row", gap: 10 }, timingField: { flex: 1, minWidth: 0 }, timingInput: { width: "100%", minHeight: 50, borderWidth: 1, borderColor: "#BDBDBD", borderRadius: 12, paddingHorizontal: 12, fontSize: RFValue(14), color: "#222", backgroundColor: "#fff" }, durationInputRow: { flexDirection: "row", alignItems: "center" }, durationInput: { width: RFValue(112), minHeight: 52, borderWidth: 1, borderColor: "#BDBDBD", borderRadius: 12, paddingHorizontal: 12, fontSize: RFValue(20), fontWeight: "800", textAlign: "center", color: "#840B1C", backgroundColor: "#fff" }, durationUnit: { marginLeft: 10, fontSize: RFValue(14), color: "#555", fontWeight: "700" }, label: { color: "#333", fontSize: RFValue(15), fontWeight: "800", marginBottom: 8 }, value: { color: "#555", fontSize: RFValue(14) },
	block: { marginTop: hp("2.5%") }, emotionRow: { flexDirection: "row", justifyContent: "space-between" }, emotionButton: { padding: 8, borderRadius: 12, borderWidth: 2, borderColor: "transparent" }, selectedEmotion: { borderColor: "#840B1C", backgroundColor: "#FBEAEA" }, emoji: { fontSize: RFValue(28) },
	rpeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, rpeButton: { width: RFValue(36), height: RFValue(36), borderRadius: RFValue(18), borderWidth: 1, borderColor: "#ccc", alignItems: "center", justifyContent: "center", margin: 3 }, selectedRpe: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, rpeText: { color: "#555", fontSize: RFValue(14) }, selectedRpeText: { color: "#fff", fontWeight: "800" },
	journalInput: { minHeight: hp("12%"), borderWidth: 1, borderColor: "#ccc", borderRadius: 12, padding: 12, backgroundColor: "#F8F9FA", fontSize: RFValue(14), textAlignVertical: "top" },
	addButton: { minHeight: 46, borderWidth: 1, borderColor: "#840B1C", borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 }, addButtonText: { color: "#840B1C", fontSize: RFValue(14), fontWeight: "700" },
	exerciseRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 8 }, exerciseName: { flex: 1, color: "#333", fontSize: RFValue(13) }, repsField: { width: wp("24%"), maxWidth: 120, alignItems: "center" }, fieldCaption: { color: "#666", fontSize: RFValue(9), marginBottom: 3, textAlign: "center" }, repsInput: { width: "100%", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 8, textAlign: "center", fontSize: RFValue(13) }, legacyText: { color: "#777", fontSize: RFValue(8), marginTop: 3, textAlign: "center" }, removeButton: { width: wp("14%"), alignItems: "center" }, removeText: { color: "#B00020", fontSize: RFValue(8), marginTop: 2 },
	checkRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 }, checkText: { marginLeft: 10, color: "#333", fontSize: RFValue(14) },
	bottomActions: { flexDirection: "row", gap: 12, marginTop: hp("4%") }, cancelButton: { flex: 1, minHeight: 54, borderWidth: 2, borderColor: "#840B1C", borderRadius: 27, alignItems: "center", justifyContent: "center" }, cancelText: { color: "#840B1C", fontSize: RFValue(15), fontWeight: "800" }, saveButton: { flex: 1.25, minHeight: 54, borderRadius: 27, backgroundColor: "#840B1C", alignItems: "center", justifyContent: "center" }, saveText: { color: "#fff", fontSize: RFValue(15), fontWeight: "800" }, disabled: { opacity: 0.45 },
	modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "flex-end" }, modalBox: { maxHeight: hp("72%"), backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }, modalTitle: { textAlign: "center", fontSize: RFValue(17), fontWeight: "800", marginBottom: 12 }, modalItem: { minHeight: 104, flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#eee" }, modalIcon: { width: 88, height: 88, borderRadius: 10, marginRight: 14, resizeMode: "cover" }, otherIcon: { backgroundColor: "#F4E9EB", alignItems: "center", justifyContent: "center" }, modalItemText: { flex: 1, color: "#333", fontSize: RFValue(15), lineHeight: RFValue(21) }, frequentLabel: { color: "#840B1C", fontSize: RFValue(10), fontWeight: "700", marginLeft: 8 }, modalClose: { paddingVertical: 14, alignItems: "center" }, modalCloseText: { color: "#840B1C", fontSize: RFValue(15), fontWeight: "800" },
	centeredOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,.35)", alignItems: "center", justifyContent: "center", padding: 24 }, customBox: { width: "100%", maxWidth: 460, borderRadius: 16, backgroundColor: "#fff", padding: 20 }, customInput: { minHeight: 50, borderWidth: 1, borderColor: "#ccc", borderRadius: 10, paddingHorizontal: 14, fontSize: RFValue(14) }, customActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 }, customCancel: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: "#bbb", alignItems: "center", justifyContent: "center" }, customCancelText: { color: "#444", fontWeight: "700" }, customAdd: { minHeight: 44, paddingHorizontal: 20, borderRadius: 10, backgroundColor: "#840B1C", alignItems: "center", justifyContent: "center" }, customAddText: { color: "#fff", fontWeight: "800" },
});
