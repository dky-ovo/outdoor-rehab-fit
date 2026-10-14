import { useAccountDataRevision } from '../../../hooks/useAccountDataRevision';
import { appText } from "../../../utils/appText";
// App Upgrade #6: SMART goal setting with written guidance + carry over to next week
import React, { useCallback, useContext, useRef, useState } from "react";
import {
	StyleSheet,
	View,
	Text,
	TextInput,
	TouchableOpacity,
	ScrollView,
	KeyboardAvoidingView,
	Platform,
	useWindowDimensions,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { showAlert } from "../../../utils/alert";
import { useUsageBack } from "../../../hooks/useUsageBack";
import {
	getGoalState,
	addSmartGoal,
	updateSmartGoal,
	toggleSmartGoal,
	removeSmartGoal,
	carryOverSmartGoals,
	getCurrentWeekSmartGoals,
	getPastWeekSmartGoals,
} from "../../../utils/goals";

const SmartGoal = () => {
	const accountRevision = useAccountDataRevision(['goals']);
	const { from } = useLocalSearchParams();
	const cameFromHome = (Array.isArray(from) ? from[0] : from) === "home";
	useUsageBack(cameFromHome ? "/(tabs)" : "/(tabs)/goals", !cameFromHome);
	const { i18n, locale } = useContext(LocaleContext);
	const { width } = useWindowDimensions();
	const compact = width <= 400;
	const [what, setWhat] = useState("");
	const [frequency, setFrequency] = useState("");
	const [duration, setDuration] = useState("");
	const [currentGoals, setCurrentGoals] = useState([]);
	const [pastGoals, setPastGoals] = useState([]);
	const addingRef = useRef(false);
	const [editing, setEditing] = useState(null);
	const [savingEdit, setSavingEdit] = useState(false);
	const savingEditRef = useRef(false);
	const focusedRef = useRef(false);
	const loadVersionRef = useRef(0);
	const changeGoals = async (change) => {
		try {
			await change();
			await load();
			return true;
		} catch {
			if (focusedRef.current) showAlert(i18n.t("warning"), i18n.t("serverError"));
			return false;
		}
	};

	const load = useCallback(async () => {
		const version = ++loadVersionRef.current;
		try {
			const state = await getGoalState();
			if (!focusedRef.current || version !== loadVersionRef.current) return;
			setCurrentGoals(getCurrentWeekSmartGoals(state));
			setPastGoals(getPastWeekSmartGoals(state));
		} catch {
			if (focusedRef.current && version === loadVersionRef.current) showAlert(i18n.t("warning"), i18n.t("serverError"));
		}
	}, [i18n]);

	useFocusEffect(
		useCallback(() => {
			focusedRef.current = true;
			void load();
			return () => { focusedRef.current = false; loadVersionRef.current += 1; };
		}, [load, accountRevision])
	);

	const handleAdd = async () => {
		if (addingRef.current) return;
		if (!what.trim() || !frequency.trim() || !duration.trim()) {
			showAlert("", appText(locale, "inline.personalGoal.completeWhatFrequencyAndDurationBeforeSaving", {"zh":"請完成「做什麼、多久一次、每次多長時間」三項內容。","en":"Complete What, Frequency and Duration before saving."}));
			return;
		}
		addingRef.current = true;
		try {
			if (await changeGoals(() => addSmartGoal({ what: what.trim(), frequency: frequency.trim(), duration: duration.trim() }))) {
				setWhat("");
				setFrequency("");
				setDuration("");
			}
		} finally { addingRef.current = false; }
	};
	const goalText = (goal) => goal.what
		? `${goal.what} · ${goal.frequency || "—"} · ${goal.duration || "—"}`
		: goal.text;

	const handleToggle = async (id) => {
		await changeGoals(() => toggleSmartGoal(id));
	};
	const startEdit = (goal) => setEditing(goal.what
		? { id: goal.id, what: goal.what, frequency: goal.frequency || "", duration: goal.duration || "" }
		: { id: goal.id, text: goal.text || "" });
	const saveEdit = async () => {
		if (!editing || savingEditRef.current) return;
		const structured = Object.prototype.hasOwnProperty.call(editing, "what");
		const fields = structured ? [editing.what, editing.frequency, editing.duration] : [editing.text];
		if (fields.some((value) => !String(value).trim())) {
			showAlert("", appText(locale, "inline.personalGoal.completeAllGoalFieldsBeforeSaving", {"zh":"請完成所有目標內容後再儲存。","en":"Complete all goal fields before saving."}));
			return;
		}
		savingEditRef.current = true;
		setSavingEdit(true);
		try {
			if (await changeGoals(() => updateSmartGoal(editing.id, structured ? editing : editing.text))) setEditing(null);
		} finally { savingEditRef.current = false; setSavingEdit(false); }
	};

	const handleRemove = (id) => {
		showAlert("", i18n.t("deletePersonalisedGoalConfirm"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{
				text: i18n.t("delete"),
				style: "destructive",
				onPress: async () => {
						if (await changeGoals(() => removeSmartGoal(id))) setEditing((draft) => draft?.id === id ? null : draft);
				},
			},
		]);
	};

	// After each week there is an option to keep the same goals for the following week
	const handleCarryOver = async () => {
		if (await changeGoals(carryOverSmartGoals)) showAlert("", i18n.t("goalsCarriedOver"));
	};

	return (
		<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
			<ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.container} contentContainerStyle={{ paddingBottom: hp("15%") }}>
				<View style={[styles.guidanceBox, compact && styles.guidanceBoxCompact]}>
					<Text style={styles.guidanceTitle}>{appText(locale, "inline.personalGoal.createAPersonalisedGoal", {"zh":"建立個人化目標","en":"Create a Personalised Goal"})}</Text>
					<Text style={styles.guidanceText}>{appText(locale, "inline.personalGoal.answerThreeSimpleQuestionsToMakeYourGoal", {"zh":"只需回答三個簡單問題，讓目標清楚又容易執行。","en":"Answer three simple questions to make your goal clear and practical."})}</Text>
				</View>

				<View style={styles.goalForm}>
					<Text style={styles.fieldLabel}>{appText(locale, "inline.personalGoal.1What", {"zh":"1. 做什麼？","en":"1. What?"})}</Text>
					<TextInput style={[styles.input, styles.multilineInput]} placeholder={appText(locale, "inline.personalGoal.eGWalkInThePark", {"zh":"例如：在公園步行","en":"e.g. Walk in the park"})} value={what} onChangeText={setWhat} multiline />
					<Text style={styles.fieldLabel}>{appText(locale, "inline.personalGoal.2Frequency", {"zh":"2. 多久一次？","en":"2. Frequency"})}</Text>
					<TextInput style={styles.input} placeholder={appText(locale, "inline.personalGoal.eGThreeTimesPerWeek", {"zh":"例如：每星期三次","en":"e.g. Three times per week"})} value={frequency} onChangeText={setFrequency} />
					<Text style={styles.fieldLabel}>{appText(locale, "inline.personalGoal.3Duration", {"zh":"3. 每次多長時間？","en":"3. Duration"})}</Text>
					<TextInput style={styles.input} placeholder={appText(locale, "inline.personalGoal.eG20MinutesEachTime", {"zh":"例如：每次 20 分鐘","en":"e.g. 20 minutes each time"})} value={duration} onChangeText={setDuration} />
					<TouchableOpacity style={styles.saveGoalButton} onPress={handleAdd}>
						<Ionicons name="add-circle-outline" size={RFValue(22)} color="#fff" />
						<Text style={styles.saveGoalText}>{appText(locale, "inline.personalGoal.addPersonalisedGoal", {"zh":"新增個人化目標","en":"Add Personalised Goal"})}</Text>
					</TouchableOpacity>
				</View>

				<Text style={styles.sectionTitle}>{i18n.t("smartGoals")}</Text>
				{currentGoals.length === 0 && <Text style={styles.empty}>{i18n.t("noSmartGoals")}</Text>}
				{currentGoals.map((goal) => (
					<View key={goal.id}>
					<View style={styles.goalRow}>
						<TouchableOpacity onPress={() => handleToggle(goal.id)} style={styles.checkArea}>
							<Ionicons
								name={goal.done ? "checkbox" : "square-outline"}
								size={RFValue(24)}
								color={goal.done ? "#2E8B57" : "#888"}
							/>
						</TouchableOpacity>
						<View style={styles.goalTextWrap}><Text style={[styles.goalText, goal.done && styles.goalDone]}>{goalText(goal)}</Text></View>
						<TouchableOpacity style={styles.rowAction} disabled={savingEdit} accessibilityRole="button" accessibilityLabel={appText(locale, "inline.personalGoal.editGoal", {"zh":"編輯目標","en":"Edit goal"})} onPress={() => startEdit(goal)}>
							<Ionicons name="create-outline" size={RFValue(22)} color="#840B1C" />
						</TouchableOpacity>
						<TouchableOpacity style={styles.rowAction} disabled={savingEdit} accessibilityRole="button" accessibilityLabel={i18n.t("delete")} onPress={() => handleRemove(goal.id)}>
							<Ionicons name="trash-outline" size={RFValue(20)} color="#B00020" />
						</TouchableOpacity>
					</View>
					{editing?.id === goal.id && <View style={styles.editForm}>
						{(Object.prototype.hasOwnProperty.call(editing, "what") ? [
							["what", appText(locale, "inline.personalGoal.what", {"zh":"做什麼？","en":"What?"})],
							["frequency", appText(locale, "inline.personalGoal.frequency", {"zh":"多久一次？","en":"Frequency"})],
							["duration", appText(locale, "inline.personalGoal.duration", {"zh":"每次多長時間？","en":"Duration"})],
						] : [["text", appText(locale, "inline.personalGoal.goal", {"zh":"目標內容","en":"Goal"})]]).map(([field, label]) => <View key={field}>
							<Text style={styles.fieldLabel}>{label}</Text>
							<TextInput accessibilityLabel={label} style={styles.input} value={editing[field]} editable={!savingEdit} onChangeText={(value) => setEditing((draft) => ({ ...draft, [field]: value }))} multiline={field === "what" || field === "text"} />
						</View>)}
						<View style={styles.editActions}>
							<TouchableOpacity style={styles.cancelEdit} disabled={savingEdit} onPress={() => setEditing(null)}><Text>{i18n.t("cancel")}</Text></TouchableOpacity>
							<TouchableOpacity style={[styles.saveGoalButton, styles.editSave]} disabled={savingEdit} onPress={saveEdit}><Text style={styles.saveGoalText}>{appText(locale, "inline.personalGoal.saveChanges", {"zh":"儲存修改","en":"Save changes"})}</Text></TouchableOpacity>
						</View>
					</View>}
					</View>
				))}

				{pastGoals.length > 0 && (
					<TouchableOpacity style={styles.carryBtn} onPress={handleCarryOver}>
						<Ionicons name="repeat" size={RFValue(18)} color="#fff" />
						<Text style={styles.carryBtnText}>{i18n.t("keepSameGoals")}</Text>
					</TouchableOpacity>
				)}
			</ScrollView>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
		paddingHorizontal: wp("5%"),
	},
	guidanceBox: {
		backgroundColor: "#FFF7E6",
		borderRadius: 12,
		padding: 14,
		marginTop: hp("2%"),
		borderWidth: 1,
		borderColor: "#F0E4C2",
	},
	guidanceBoxCompact: { paddingHorizontal: 8, paddingVertical: 10 },
	guidanceText: {
		fontSize: RFValue(14),
		lineHeight: RFValue(22),
		color: "#444",
	},
	guidanceTitle: { fontSize: RFValue(17), fontWeight: "900", color: "#333", marginBottom: 7 },
	goalForm: { marginTop: hp("2%"), borderWidth: 1, borderColor: "#E8E0D3", borderRadius: 14, padding: 14, backgroundColor: "#FFFCF8" },
	fieldLabel: { fontSize: RFValue(13), fontWeight: "800", color: "#333", marginBottom: 7, marginTop: 8 },
	input: {
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 12,
		padding: 12,
		fontSize: RFValue(15),
		minHeight: RFValue(48),
		backgroundColor: "#f8f9fa",
	},
	multilineInput: { minHeight: RFValue(72), textAlignVertical: "top" },
	saveGoalButton: {
		flexDirection: "row",
		backgroundColor: "#840B1C",
		borderRadius: 12,
		minHeight: RFValue(50),
		justifyContent: "center",
		alignItems: "center",
		gap: 8,
		marginTop: 16,
	},
	saveGoalText: { color: "#fff", fontSize: RFValue(14), fontWeight: "800" },
	sectionTitle: {
		fontSize: RFValue(18),
		fontWeight: "bold",
		marginTop: hp("3%"),
		marginBottom: hp("1%"),
		color: "#333",
	},
	empty: {
		fontSize: RFValue(14),
		color: "#999",
		marginVertical: hp("1%"),
	},
	goalRow: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#f8f9fa",
		borderRadius: 12,
		padding: 14,
		marginBottom: 10,
	},
	checkArea: {
		marginRight: 10,
	},
	goalTextWrap: { flex: 1, marginRight: 10 },
	goalText: {
		flex: 1,
		fontSize: RFValue(15),
		color: "#333",
	},
	rowAction: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
	editForm: { padding: 14, backgroundColor: "#FFFCF8", borderRadius: 12, borderWidth: 1, borderColor: "#E8E0D3", marginBottom: 12 },
	editActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 12 },
	cancelEdit: { minHeight: 48, paddingHorizontal: 14, justifyContent: "center" },
	editSave: { marginTop: 0, paddingHorizontal: 18 },
	goalDone: {
		textDecorationLine: "line-through",
		color: "#999",
	},
	carryBtn: {
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#2E8B57",
		borderRadius: 12,
		paddingVertical: 14,
		marginTop: hp("2%"),
		gap: 8,
	},
	carryBtnText: {
		color: "#fff",
		fontSize: RFValue(15),
		fontWeight: "bold",
		marginLeft: 6,
	},
});

export default SmartGoal;
