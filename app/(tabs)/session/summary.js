// Session summary shared by count-up, countdown and manual exercise records.
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	StyleSheet,
	View,
	Text,
	TextInput,
	TouchableOpacity,
	ScrollView,
	Modal,
	Image,
	FlatList,
	KeyboardAvoidingView,
	Platform,
} from "react-native";
import { Redirect, router, useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { AuthContext } from "../../../contexts/AuthContext";
import { getSessions, saveSession } from "../../../utils/sessions";
import { getWeeklyProgress } from "../../../utils/goals";
import { trackGoalAchieved, trackSessionCompleted } from "../../../utils/usage";
import { formatDuration, formatDateTime } from "../../../utils/dates";
import { showAlert } from "../../../utils/alert";
import { useActiveSession } from "../../../contexts/ActiveSessionContext";

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
	const date = new Date(isoValue || Date.now());
	const safe = Number.isNaN(date.getTime()) ? new Date() : date;
	return {
		date: `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}`,
		time: `${pad2(safe.getHours())}:${pad2(safe.getMinutes())}`,
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

const SessionSummary = ({ embedded = false, embeddedSummaryId, onExit } = {}) => {
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const { user } = useContext(AuthContext);
	const {
		pendingSummary,
		pendingSummaryDraft,
		clearPendingSummary,
		getPendingSummary,
		updatePendingSummaryDraft,
	} = useActiveSession();
	const navigation = useNavigation();
	const { summaryId: rawSummaryId } = useLocalSearchParams();
	const routeSummaryId = Array.isArray(rawSummaryId) ? rawSummaryId[0] : rawSummaryId;
	const summaryId = embeddedSummaryId || routeSummaryId;
	const resolvedPendingSummary =
		pendingSummary?.id === summaryId ? pendingSummary : getPendingSummary(summaryId);
	const hasValidPendingSummary = Boolean(resolvedPendingSummary);
	const initialDurationSec = resolvedPendingSummary?.durationSec || 0;
	const mode = resolvedPendingSummary?.mode;
	const editableTiming = Boolean(resolvedPendingSummary?.editableTiming);
	const equipmentData = useMemo(() => {
		const translated = i18n.t("equipmentList", { returnObjects: true });
		return Array.isArray(translated) ? translated : [];
	}, [i18n, locale]);
	const initialDateParts = localDateParts(resolvedPendingSummary?.completedAt);
	const restoredDraft = pendingSummaryDraft?.summaryId === summaryId ? pendingSummaryDraft : null;

	const [completedAt, setCompletedAt] = useState(() => restoredDraft?.completedAt || resolvedPendingSummary?.completedAt || new Date().toISOString());
	const [manualDate, setManualDate] = useState(() => String(restoredDraft?.manualDate || initialDateParts.date));
	const [manualTime, setManualTime] = useState(() => String(restoredDraft?.manualTime || initialDateParts.time));
	const [manualDurationMinutes, setManualDurationMinutes] = useState(() => String(restoredDraft?.manualDurationMinutes ?? (initialDurationSec > 0 ? Math.ceil(initialDurationSec / 60) : "")));
	const [emotion, setEmotion] = useState(() => restoredDraft?.emotion ?? null);
	const [rpe, setRpe] = useState(() => restoredDraft?.rpe ?? null);
	const [journal, setJournal] = useState(() => String(restoredDraft?.journal || ""));
	const [exercises, setExercises] = useState(() => Array.isArray(restoredDraft?.exercises) ? restoredDraft.exercises : []); // [{ name, equipmentId, intensity }]
	const [types, setTypes] = useState(() => ({
		aerobic: Boolean(restoredDraft?.types?.aerobic),
		balance: Boolean(restoredDraft?.types?.balance),
		muscle: Boolean(restoredDraft?.types?.muscle),
	}));
	const [typesTouched, setTypesTouched] = useState(() => Boolean(restoredDraft?.typesTouched));
	const [pickerVisible, setPickerVisible] = useState(false);
	const [customEquipmentVisible, setCustomEquipmentVisible] = useState(false);
	const [customEquipmentName, setCustomEquipmentName] = useState("");
	const [equipmentUsage, setEquipmentUsage] = useState({});
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const allowLeaveRef = useRef(false);
	const leavePromptOpenRef = useRef(false);
	const previousExerciseCountRef = useRef(exercises.length);

	useEffect(() => {
		if (!hasValidPendingSummary) return;
		updatePendingSummaryDraft(summaryId, {
			completedAt,
			manualDate,
			manualTime,
			manualDurationMinutes,
			emotion,
			rpe,
			journal,
			exercises,
			types,
			typesTouched,
		});
	}, [completedAt, emotion, exercises, hasValidPendingSummary, journal, manualDate, manualDurationMinutes, manualTime, rpe, summaryId, types, typesTouched, updatePendingSummaryDraft]);

	const discardSummary = useCallback(() => {
		allowLeaveRef.current = true;
		leavePromptOpenRef.current = false;
		if (embedded && onExit) {
			onExit();
			return;
		}
		clearPendingSummary();
		// Clear the nested session stack so a discarded summary cannot remain
		// underneath Home and reappear when the user opens Session Record again.
		navigation.reset({ index: 0, routes: [{ name: "index" }] });
		requestAnimationFrame(() => router.replace("/(tabs)"));
	}, [clearPendingSummary, embedded, navigation, onExit]);

	const showUnsavedLeavePrompt = useCallback(() => {
		if (leavePromptOpenRef.current || allowLeaveRef.current) return;
		leavePromptOpenRef.current = true;
		showAlert("", i18n.t("summaryUnsavedExitWarning"), [
			{
				text: i18n.t("continueEditingSummary"),
				style: "cancel",
				onPress: () => {
					leavePromptOpenRef.current = false;
				},
			},
			{
				text: i18n.t("exitWithoutSaving"),
				style: "destructive",
				onPress: discardSummary,
			},
		]);
	}, [discardSummary, i18n]);

	// The stack layout used to own the summary header back button and navigated
	// away directly. On the first visit that button could be pressed before this
	// screen's beforeRemove listener had mounted, so the unsaved warning only
	// appeared from the second visit onward. Install the header action from this
	// screen itself so every press uses the same guarded discard flow.
	useLayoutEffect(() => {
		if (embedded) return undefined;
		navigation.setOptions({
			headerLeft: () => (
				<TouchableOpacity
					onPress={showUnsavedLeavePrompt}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("back")}
					style={{ paddingHorizontal: 8, paddingVertical: 6 }}
				>
					<Ionicons name="chevron-back" size={RFValue(18)} color="#000" />
				</TouchableOpacity>
			),
		});
		return undefined;
	}, [embedded, i18n, locale, textRevision, navigation, showUnsavedLeavePrompt]);

	useLayoutEffect(() => {
		if (embedded) return undefined;
		if (!hasValidPendingSummary) return undefined;
		const unsubscribe = navigation.addListener("beforeRemove", (event) => {
			if (allowLeaveRef.current) return;
			event.preventDefault();
			showUnsavedLeavePrompt();
		});
		return unsubscribe;
	}, [embedded, hasValidPendingSummary, navigation, showUnsavedLeavePrompt]);

	useEffect(() => {
		let mounted = true;
		getSessions(user?.token).then((sessions) => {
			const counts = {};
			sessions.forEach((session) => (session.exercises || []).forEach((exercise) => {
				const keys = [exercise.equipmentId, exercise.name].filter(Boolean).map(String);
				keys.forEach((key) => { counts[key] = (counts[key] || 0) + 1; });
			}));
			if (mounted) setEquipmentUsage(counts);
		}).catch(() => {});
		return () => { mounted = false; };
	}, [user?.token]);

	const sortedEquipmentData = useMemo(() => {
		const items = Array.isArray(equipmentData) ? [...equipmentData] : [];
		items.sort((a, b) => {
			const aCount = equipmentUsage[String(a.id)] || equipmentUsage[String(a.name)] || 0;
			const bCount = equipmentUsage[String(b.id)] || equipmentUsage[String(b.name)] || 0;
			return bCount - aCount;
		});
		return [...items, { id: "__other__", name: i18n.t("otherEquipment"), isOther: true }];
	}, [equipmentData, equipmentUsage, i18n, locale, textRevision]);

	// Auto-fill the three type checkboxes from the exercise table (outdoor users);
	// home users can still toggle them manually.
	useEffect(() => {
		const removedAllExercises = previousExerciseCountRef.current > 0 && exercises.length === 0;
		previousExerciseCountRef.current = exercises.length;
		if (removedAllExercises) {
			setTypes({ aerobic: false, balance: false, muscle: false });
			setTypesTouched(false);
			return;
		}
		if (typesTouched) return;
		const next = { aerobic: false, balance: false, muscle: false };
		exercises.forEach((ex) => {
			const item = equipmentData.find((e) => String(e.id) === String(ex.equipmentId));
			if (!item) return;
			["aerobic", "balance", "muscle"].forEach((t) => {
				if ((item.categories || []).includes(t)) next[t] = true;
			});
		});
		setTypes((current) => (
			current.aerobic === next.aerobic && current.balance === next.balance && current.muscle === next.muscle
				? current
				: next
		));
	}, [equipmentData, exercises, typesTouched]);

	const handleSelectEquipment = (item) => {
		setPickerVisible(false);
		if (item.isOther) {
			setCustomEquipmentVisible(true);
			return;
		}
		setExercises((prev) => prev.some((exercise) => String(exercise.equipmentId) === String(item.id))
			? prev
			: [...prev, { name: item.name, intensity: "", equipmentId: item.id }]);
	};

	const addCustomEquipment = () => {
		const name = customEquipmentName.trim();
		if (!name) return;
		const normalizedName = name.toLocaleLowerCase();
		setExercises((prev) => prev.some((exercise) => (
			String(exercise.equipmentId) === "other" && String(exercise.name || "").trim().toLocaleLowerCase() === normalizedName
		)) ? prev : [...prev, { name, intensity: "", equipmentId: "other" }]);
		setCustomEquipmentName("");
		setCustomEquipmentVisible(false);
	};

	const updateIntensity = (index, intensity) => {
		const normalized = String(intensity || "").replace(/[^0-9]/g, "").slice(0, 2);
		setExercises((prev) => prev.map((ex, i) => (i === index ? { ...ex, intensity: normalized } : ex)));
	};

	const removeExercise = (index) => {
		setExercises((prev) => prev.filter((_, i) => i !== index));
	};

	const toggleType = (key) => {
		setTypesTouched(true);
		setTypes((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	const handleSave = async () => {
		if (savingRef.current || !resolvedPendingSummary) return;
		let finalCompletedAt = completedAt;
		let finalDurationSec = Number(initialDurationSec) || 0;
		if (editableTiming) {
			const parsedDate = parseLocalDateTime(manualDate, manualTime);
			if (!parsedDate || parsedDate.getTime() > Date.now()) {
				showAlert("", i18n.t("manualDateTimeInvalid"));
				return;
			}
			const durationMinutes = Number(manualDurationMinutes);
			if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
				showAlert("", i18n.t("manualDurationInvalid"));
				return;
			}
			finalCompletedAt = parsedDate.toISOString();
			finalDurationSec = durationMinutes * 60;
			setCompletedAt(finalCompletedAt);
		}

		let normalizedExercises = [];
		if (mode === "outdoor") {
			const invalidIntensity = exercises.some((exercise) => {
				const raw = String(exercise.intensity ?? "").trim();
				const value = Number(raw);
				return !/^\d{1,2}$/.test(raw) || !Number.isInteger(value) || value < 0 || value > 10;
			});
			if (invalidIntensity) {
				showAlert("", i18n.t("equipmentIntensityInvalid"));
				return;
			}
			normalizedExercises = exercises.map((exercise) => ({
				name: exercise.name,
				equipmentId: exercise.equipmentId,
				intensity: Number(exercise.intensity),
			}));
		}

		const session = {
			id: resolvedPendingSummary.id,
			date: finalCompletedAt,
			durationSec: finalDurationSec,
			mode: mode === "home" ? "home" : "outdoor",
			emotion,
			rpe,
			journal,
			exercises: normalizedExercises,
			types,
		};

		savingRef.current = true;
		setSaving(true);
		try {
			// Saving must work immediately after unlock, even if network requests
			// are still reconnecting. Goals use the local records here; uploading
			// is independent and retains a pending copy until the server accepts it.
			const before = await getWeeklyProgress().catch(() => null);
			await saveSession(session, user?.token, { waitForSync: false });
			// Optional statistics must never turn an already-saved record into a
			// false save failure and invite a duplicate submission.
			await trackSessionCompleted(session.mode).catch(() => {});
			const after = await getWeeklyProgress().catch(() => null);
			let newlyAchieved = 0;
			["aerobic", "balance", "muscle"].forEach((type) => {
				const target = Number(after?.targets?.[type] || 0);
				if (before && after && target > 0 && Number(before.progress?.[type] || 0) < target && Number(after.progress?.[type] || 0) >= target) newlyAchieved += 1;
			});
			if (newlyAchieved > 0) await trackGoalAchieved(newlyAchieved).catch(() => {});
			const savedMessage = newlyAchieved > 0 ? `${i18n.t("sessionSaved")}\n${i18n.t("goalAchievedMsg")}` : i18n.t("sessionSaved");
			showAlert("", savedMessage, [{ text: i18n.t("confirm"), onPress: discardSummary }]);
		} catch (error) {
			console.warn("Unable to save exercise session", error);
			savingRef.current = false;
			setSaving(false);
			showAlert("", i18n.t("serverError"));
		}
	};

	// A summary can only be opened once, using the token created by the most
	// recently finished timer. Saving or discarding clears that token, so an old
	// route left in native navigation history can never display stale data.
	if (!hasValidPendingSummary) return embedded ? null : <Redirect href="/(tabs)" />;

	return (
		<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
			<ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: hp("18%") }} keyboardShouldPersistTaps="handled">
				{editableTiming ? (
					<View style={styles.block}>
						<Text style={styles.blockLabel}>{i18n.t("completionTime")}</Text>
						<View style={styles.timingRow}>
							<View style={styles.timingField}>
								<Text style={styles.fieldCaption}>{i18n.t("manualDate")}</Text>
								<TextInput style={styles.timingInput} value={manualDate} onChangeText={setManualDate} placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10} />
							</View>
							<View style={styles.timingField}>
								<Text style={styles.fieldCaption}>{i18n.t("manualTime")}</Text>
								<TextInput style={styles.timingInput} value={manualTime} onChangeText={setManualTime} placeholder="HH:mm" autoCapitalize="none" maxLength={5} />
							</View>
						</View>
						<Text style={[styles.blockLabel, { marginTop: 14 }]}>{i18n.t("totalDuration")}</Text>
						<View style={styles.manualDurationRow}>
							<TextInput style={styles.durationInput} value={manualDurationMinutes} onChangeText={(value) => setManualDurationMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))} keyboardType="number-pad" maxLength={4} />
							<Text style={styles.durationUnit}>{i18n.t("minutes")}</Text>
						</View>
					</View>
				) : (
					<>
						<View style={styles.block}>
							<Text style={styles.blockLabel}>{i18n.t("completionTime")}</Text>
							<Text style={styles.blockValue}>{formatDateTime(completedAt, locale)}</Text>
						</View>
						<View style={styles.block}>
							<Text style={styles.blockLabel}>{i18n.t("totalDuration")}</Text>
							<Text style={styles.duration}>{formatDuration(Number(initialDurationSec) || 0)}</Text>
						</View>
					</>
				)}

				<View style={styles.block}>
					<Text style={styles.blockLabel}>{i18n.t("typeChecklist")}</Text>
					{[
						{ key: "aerobic", label: i18n.t("aerobicDone") },
						{ key: "balance", label: i18n.t("balanceDone") },
						{ key: "muscle", label: i18n.t("muscleDone") },
					].map(({ key, label }) => (
						<TouchableOpacity key={key} style={styles.checkRow} onPress={() => toggleType(key)}>
							<Ionicons name={types[key] ? "checkbox" : "square-outline"} size={RFValue(24)} color={types[key] ? "#2E8B57" : "#888"} />
							<Text style={styles.checkLabel}>{label}</Text>
						</TouchableOpacity>
					))}
				</View>

				{mode === "outdoor" ? (
					<View style={styles.block}>
						<Text style={styles.blockLabel}>{i18n.t("exerciseTypeRecord")}</Text>
						<Text style={styles.hint}>{i18n.t("exerciseTypeRecordHint")}</Text>
						<TouchableOpacity style={styles.addManualBtn} onPress={() => setPickerVisible(true)}>
							<Ionicons name="add-circle-outline" size={RFValue(20)} color="#840B1C" />
							<Text style={styles.addManualText}>{i18n.t("addExercise")}</Text>
						</TouchableOpacity>
						<Text style={styles.controlHint}>{i18n.t("addExerciseHint")}</Text>
						{exercises.length > 0 ? (
							<View style={styles.table}>
								<Text style={styles.tableHint}>{i18n.t("exerciseEntryHint")}</Text>
								{exercises.map((exercise, index) => (
									<View key={`${exercise.equipmentId || exercise.name}-${index}`} style={styles.tableRow}>
										<Text style={styles.tableName} numberOfLines={2}>{exercise.name}</Text>
										<View style={styles.repsField}>
											<Text style={styles.fieldCaption}>{i18n.t("equipmentIntensity")}</Text>
											<TextInput style={styles.repsInput} placeholder="0" value={String(exercise.intensity ?? "")} onChangeText={(value) => updateIntensity(index, value)} keyboardType="number-pad" maxLength={2} accessibilityLabel={i18n.t("equipmentIntensity")} />
										</View>
										<TouchableOpacity style={styles.removeBtn} onPress={() => removeExercise(index)} accessibilityLabel={i18n.t("removeExercise")}>
											<Ionicons name="trash-outline" size={RFValue(20)} color="#B00020" />
											<Text style={styles.removeBtnText}>{i18n.t("removeExercise")}</Text>
										</TouchableOpacity>
									</View>
								))}
							</View>
						) : null}
					</View>
				) : null}

				<View style={styles.block}>
					<Text style={styles.blockLabel}>{i18n.t("emotionScale")}</Text>
					<View style={styles.emotionRow}>
						{EMOTIONS.map((item) => (
							<TouchableOpacity key={item.value} style={[styles.emotionBtn, emotion === item.value && styles.emotionSelected]} onPress={() => setEmotion(item.value)}>
								<Text style={styles.emoji}>{item.emoji}</Text>
							</TouchableOpacity>
						))}
					</View>
				</View>

				<View style={styles.block}>
					<Text style={styles.blockLabel}>{i18n.t("rpeScale")}</Text>
					<View style={styles.rpeRow}>
						{RPE_VALUES.map((value) => (
							<TouchableOpacity key={value} style={[styles.rpeBtn, rpe === value && styles.rpeSelected]} onPress={() => setRpe(value)}>
								<Text style={[styles.rpeText, rpe === value && styles.rpeTextSelected]}>{value}</Text>
							</TouchableOpacity>
						))}
					</View>
				</View>

				<View style={styles.block}>
					<Text style={styles.blockLabel}>{i18n.t("sessionJournal")}</Text>
					<TextInput style={styles.journalInput} placeholder={i18n.t("journalPlaceholder")} value={journal} onChangeText={setJournal} multiline maxLength={2000} />
				</View>

				{/* Save and continue */}
				<TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.45 }]} onPress={handleSave} disabled={saving}>
					<Text style={styles.saveBtnText}>{i18n.t("saveAndContinue")}</Text>
				</TouchableOpacity>
			</ScrollView>

			{/* Manual equipment picker */}
			<Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
				<View style={styles.modalOverlay}>
					<View style={styles.modalBox}>
						<Text style={styles.modalTitle}>{i18n.t("chooseEquipment")}</Text>
						<FlatList
							data={sortedEquipmentData}
							keyExtractor={(item) => item.id.toString()}
							renderItem={({ item }) => (
								<TouchableOpacity style={styles.modalItem} onPress={() => handleSelectEquipment(item)}>
									{item.isOther ? <View style={[styles.modalIcon, styles.otherIcon]}><Ionicons name="create-outline" size={RFValue(28)} color="#840B1C" /></View> : <Image source={item.icon} style={styles.modalIcon} />}
									<Text style={styles.modalItemText} numberOfLines={2}>
										{item.name}
									</Text>
									{!item.isOther && (equipmentUsage[String(item.id)] || equipmentUsage[String(item.name)] || 0) > 0 ? <Text style={styles.frequentLabel}>{i18n.t("frequentlyUsed")}</Text> : null}
								</TouchableOpacity>
							)}
						/>
						<TouchableOpacity style={styles.modalClose} onPress={() => setPickerVisible(false)}>
							<Text style={styles.modalCloseText}>{i18n.t("cancel")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			</Modal>
			<Modal visible={customEquipmentVisible} animationType="fade" transparent onRequestClose={() => setCustomEquipmentVisible(false)}>
				<View style={styles.centeredOverlay}>
					<View style={styles.customBox}>
						<Text style={styles.modalTitle}>{i18n.t("otherEquipment")}</Text>
						<TextInput style={styles.customInput} value={customEquipmentName} onChangeText={setCustomEquipmentName} placeholder={i18n.t("otherEquipmentPlaceholder")} maxLength={80} autoFocus />
						<View style={styles.customActions}>
							<TouchableOpacity style={styles.customCancel} onPress={() => setCustomEquipmentVisible(false)}><Text style={styles.customCancelText}>{i18n.t("cancel")}</Text></TouchableOpacity>
							<TouchableOpacity style={[styles.customAdd, !customEquipmentName.trim() && { opacity: 0.45 }]} onPress={addCustomEquipment} disabled={!customEquipmentName.trim()}><Text style={styles.customAddText}>{i18n.t("add")}</Text></TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
		paddingHorizontal: wp("5%"),
	},
	block: {
		marginTop: hp("2.5%"),
	},
	blockLabel: {
		fontSize: RFValue(16),
		fontWeight: "bold",
		color: "#333",
		marginBottom: 8,
	},
	blockValue: {
		fontSize: RFValue(16),
		color: "#555",
	},
	timingRow: {
		flexDirection: "row",
		gap: 10,
	},
	timingField: {
		flex: 1,
		minWidth: 0,
	},
	timingInput: {
		width: "100%",
		minHeight: RFValue(50),
		borderWidth: 1,
		borderColor: "#BDBDBD",
		borderRadius: 12,
		paddingHorizontal: 12,
		fontSize: RFValue(15),
		color: "#222",
		backgroundColor: "#FFFFFF",
	},
	manualDurationRow: {
		flexDirection: "row",
		alignItems: "center",
	},
	durationInput: {
		width: RFValue(112),
		minHeight: RFValue(52),
		borderWidth: 1,
		borderColor: "#BDBDBD",
		borderRadius: 12,
		paddingHorizontal: 12,
		fontSize: RFValue(20),
		fontWeight: "800",
		textAlign: "center",
		color: "#840B1C",
		backgroundColor: "#FFFFFF",
	},
	durationUnit: { marginLeft: 10, fontSize: RFValue(15), color: "#555", fontWeight: "700" },
	duration: {
		fontSize: RFValue(40),
		fontWeight: "bold",
		color: "#840B1C",
		fontVariant: ["tabular-nums"],
	},
	emotionRow: {
		flexDirection: "row",
		justifyContent: "space-between",
	},
	emotionBtn: {
		padding: 8,
		borderRadius: 12,
		borderWidth: 2,
		borderColor: "transparent",
	},
	emotionSelected: {
		borderColor: "#840B1C",
		backgroundColor: "#FBEAEA",
	},
	emoji: {
		fontSize: RFValue(30),
	},
	rpeRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
	},
	rpeBtn: {
		width: RFValue(36),
		height: RFValue(36),
		borderRadius: RFValue(18),
		borderWidth: 1,
		borderColor: "#ccc",
		justifyContent: "center",
		alignItems: "center",
		margin: 3,
	},
	rpeSelected: {
		backgroundColor: "#840B1C",
		borderColor: "#840B1C",
	},
	rpeText: {
		fontSize: RFValue(15),
		color: "#555",
	},
	rpeTextSelected: {
		color: "#fff",
		fontWeight: "bold",
	},
	journalInput: {
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 12,
		padding: 12,
		minHeight: hp("12%"),
		fontSize: RFValue(15),
		textAlignVertical: "top",
		backgroundColor: "#f8f9fa",
	},
	hint: {
		fontSize: RFValue(12),
		color: "#888",
		marginBottom: 10,
		lineHeight: RFValue(18),
	},
	addManualBtn: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 12,
		gap: 6,
	},
	addManualText: {
		color: "#840B1C",
		fontSize: RFValue(14),
		fontWeight: "600",
		marginLeft: 4,
	},
	controlHint: {
		fontSize: RFValue(11),
		lineHeight: RFValue(16),
		color: "#666",
		textAlign: "center",
		marginBottom: 8,
	},
	table: {
		marginTop: 6,
		borderWidth: 1,
		borderColor: "#eee",
		borderRadius: 12,
		overflow: "hidden",
	},
	tableHint: {
		fontSize: RFValue(11),
		lineHeight: RFValue(16),
		color: "#666",
		backgroundColor: "#F7F7F7",
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderBottomWidth: 1,
		borderBottomColor: "#E5E5E5",
	},
	tableRow: {
		flexDirection: "row",
		alignItems: "center",
		padding: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#eee",
		gap: 8,
	},
	tableName: {
		flex: 1,
		fontSize: RFValue(14),
		color: "#333",
	},
	repsField: {
		width: wp("25%"),
		minWidth: 82,
		maxWidth: 120,
		alignItems: "center",
	},
	fieldCaption: {
		fontSize: RFValue(10),
		color: "#666",
		marginBottom: 3,
		textAlign: "center",
	},
	repsInput: {
		width: "100%",
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 8,
		padding: 8,
		fontSize: RFValue(14),
		textAlign: "center",
	},
	removeBtn: {
		width: wp("14%"),
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 4,
	},
	removeBtnText: {
		fontSize: RFValue(9),
		color: "#B00020",
		marginTop: 2,
	},
	checkRow: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 10,
	},
	checkLabel: {
		fontSize: RFValue(15),
		color: "#333",
		marginLeft: 10,
	},
	saveBtn: {
		backgroundColor: "#840B1C",
		borderRadius: 50,
		paddingVertical: hp("2.2%"),
		alignItems: "center",
		marginTop: hp("4%"),
	},
	saveBtnText: {
		color: "#fff",
		fontSize: RFValue(18),
		fontWeight: "bold",
	},
	modalOverlay: {
		flex: 1,
		backgroundColor: "rgba(0,0,0,0.5)",
		justifyContent: "flex-end",
	},
	modalBox: {
		backgroundColor: "#fff",
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		padding: 20,
		maxHeight: hp("70%"),
	},
	modalTitle: {
		fontSize: RFValue(17),
		fontWeight: "bold",
		marginBottom: 12,
		textAlign: "center",
	},
	modalItem: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 104,
		paddingVertical: 9,
		borderBottomWidth: 1,
		borderBottomColor: "#eee",
	},
	modalIcon: {
		width: 88,
		height: 88,
		borderRadius: 10,
		marginRight: 14,
		resizeMode: "cover",
	},
	otherIcon: { backgroundColor: "#F4E9EB", alignItems: "center", justifyContent: "center" },
	frequentLabel: { color: "#840B1C", fontSize: RFValue(10), fontWeight: "700", marginLeft: 8 },
	centeredOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,.35)", alignItems: "center", justifyContent: "center", padding: 24 },
	customBox: { width: "100%", maxWidth: 460, borderRadius: 16, backgroundColor: "#fff", padding: 20 },
	customInput: { minHeight: 50, borderWidth: 1, borderColor: "#ccc", borderRadius: 10, paddingHorizontal: 14, fontSize: RFValue(15) },
	customActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
	customCancel: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#bbb" },
	customCancelText: { color: "#444", fontWeight: "700" },
	customAdd: { minHeight: 44, paddingHorizontal: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#840B1C" },
	customAddText: { color: "#fff", fontWeight: "800" },
	modalItemText: {
		flex: 1,
		fontSize: RFValue(15),
		lineHeight: RFValue(21),
		color: "#333",
	},
	modalClose: {
		paddingVertical: 14,
		alignItems: "center",
	},
	modalCloseText: {
		color: "#840B1C",
		fontSize: RFValue(15),
		fontWeight: "bold",
	},
});

export default SessionSummary;
