import { useAccountDataRevision } from '../../../hooks/useAccountDataRevision';
import { appText } from "../../../utils/appText";
// App Upgrade #6: Goal setting - 3 preset weekly goals + SMART goal entry
import React, { useCallback, useContext, useRef, useState } from "react";
import { BackHandler, StyleSheet, View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { DEFAULT_GOALS, getGoalState, setTarget, getCurrentWeekSmartGoals } from "../../../utils/goals";
import { showAlert } from "../../../utils/alert";

const TYPES = [
	{
		key: "aerobic",
		labelKey: "aerobicGoal",
		icon: "run",
		color: "#F0E4C2",
		step: 5,
		max: 1260,
		unitKey: "minutesPerWeek",
		unitFallback: { en: "minutes / week", zh: "分鐘／週" },
		controlKey: "targetWeeklyMinutes",
		controlFallback: { en: "Target minutes per week", zh: "每週目標分鐘" },
	},
	{
		key: "balance",
		labelKey: "balanceGoal",
		icon: "scale-balance",
		color: "#F2CCC0",
		step: 1,
		max: 7,
		unitKey: "daysPerWeek",
		unitFallback: { en: "days / week", zh: "天／週" },
		controlKey: "targetDays",
		controlFallback: { en: "Target days per week", zh: "每週目標天數" },
	},
	{
		key: "muscle",
		labelKey: "muscleGoal",
		icon: "arm-flex",
		color: "#E8CCB0",
		step: 1,
		max: 7,
		unitKey: "daysPerWeek",
		unitFallback: { en: "days / week", zh: "天／週" },
		controlKey: "targetDays",
		controlFallback: { en: "Target days per week", zh: "每週目標天數" },
	},
];

const translatedOrFallback = (i18n, key, fallback) => {
	if (typeof i18n?.has === "function" && i18n.has(key)) return i18n.t(key);
	if (key === "minutesPerWeek") return appText(i18n?.locale, "inline.goals.minutesPerWeek", { zh: "分鐘／週", en: "minutes / week" });
	if (key === "targetWeeklyMinutes") return appText(i18n?.locale, "inline.goals.targetWeeklyMinutes", { zh: "每週目標分鐘", en: "Target minutes per week" });
	if (key === "adjustWeeklyTargets") return appText(i18n?.locale, "inline.goals.adjustWeeklyTargets", { zh: "帶氧運動以每週分鐘設定；平衡運動及肌肉強化以每週天數設定。將目標設為 0 後，首頁將不顯示該目標。", en: "Set aerobic exercise in weekly minutes, and balance and muscle strengthening in weekly days. Set a target to 0 to hide it from the Home screen." });
	const language = String(i18n?.locale || "zh").toLowerCase();
	return language.startsWith("en") ? fallback.en : fallback.zh;
};

const GoalSetting = () => {
	const accountRevision = useAccountDataRevision(['goals']);
	const { i18n, locale } = useContext(LocaleContext);
	const { width } = useWindowDimensions();
	const compact = width <= 400;
	const [targets, setTargets] = useState(() => ({ ...DEFAULT_GOALS }));
	const targetsRef = useRef(targets);
	const loadVersionRef = useRef(0);
	const [smartCount, setSmartCount] = useState(0);
	const [expanded, setExpanded] = useState(null);

	const load = useCallback(async () => {
		const version = ++loadVersionRef.current;
		const state = await getGoalState();
		if (version !== loadVersionRef.current) return;
		targetsRef.current = state.targets;
		setTargets(state.targets);
		setSmartCount(getCurrentWeekSmartGoals(state).length);
	}, []);

	useFocusEffect(
		useCallback(() => {
			load();
			const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
				router.replace("/(tabs)");
				return true;
			});
			return () => subscription.remove();
		}, [load, accountRevision])
	);

	const adjust = async (type, direction) => {
		loadVersionRef.current += 1;
		const current = Number(targetsRef.current[type.key]) || 0;
		const next = Math.min(type.max, Math.max(0, current + direction * type.step));
		targetsRef.current = { ...targetsRef.current, [type.key]: next };
		setTargets(targetsRef.current);
		try {
			await setTarget(type.key, next);
		} catch {
			await load();
			showAlert(i18n.t("warning"), i18n.t("serverError"));
		}
	};

	return (
		<ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: hp("15%") }} showsVerticalScrollIndicator={false}>
			<Text style={styles.sectionTitle}>{i18n.t("presetGoals")}</Text>
			<Text style={styles.hint}>
				{translatedOrFallback(i18n, "adjustWeeklyTargets", {
					en: "Set aerobic exercise in weekly minutes, and balance and muscle strengthening in weekly days. Set a target to 0 to hide it from the Home screen.",
					zh: "帶氧運動以每週分鐘設定；平衡運動及肌肉強化以每週天數設定。將目標設為 0 後，首頁將不顯示該目標。",
				})}
			</Text>

			{TYPES.map((type) => {
				const isOpen = expanded === type.key;
				const unit = translatedOrFallback(i18n, type.unitKey, type.unitFallback);
				const controlLabel = translatedOrFallback(i18n, type.controlKey, type.controlFallback);
				return (
					<View key={type.key} style={[styles.card, compact && styles.cardCompact, { backgroundColor: type.color }]}>
						<TouchableOpacity style={styles.cardHeader} onPress={() => setExpanded(isOpen ? null : type.key)}>
							<MaterialCommunityIcons name={type.icon} size={RFValue(28)} color="#333" />
							<View style={{ flex: 1, marginLeft: 12 }}>
								<Text style={styles.cardTitle} maxFontSizeMultiplier={1.2}>{i18n.t(type.labelKey)}</Text>
								<Text style={styles.cardSub} maxFontSizeMultiplier={1.2}>
									{targets[type.key]} {unit}
								</Text>
							</View>
							<Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={RFValue(20)} color="#333" />
						</TouchableOpacity>
						{isOpen && (
							<View style={styles.controls}>
								<View style={[styles.stepperRow, compact && styles.stepperRowCompact]}>
									<Text style={styles.stepperLabel}>{controlLabel}</Text>
									<View style={[styles.stepper, compact && styles.stepperCompact]}>
										<TouchableOpacity style={styles.stepBtn} onPress={() => adjust(type, -1)}>
											<Ionicons name="remove" size={RFValue(22)} color="#fff" />
										</TouchableOpacity>
										<Text style={styles.stepValue}>{targets[type.key]}</Text>
										<TouchableOpacity style={styles.stepBtn} onPress={() => adjust(type, 1)}>
											<Ionicons name="add" size={RFValue(22)} color="#fff" />
										</TouchableOpacity>
									</View>
								</View>
							</View>
						)}
						<TouchableOpacity
							style={styles.recommendButton}
							accessibilityRole="button"
							onPress={() => router.push({ pathname: "/outdoor/list", params: { categoryId: type.key, categoryName: i18n.t(type.labelKey), from: "goals" } })}
						>
							<Text style={styles.recommendText}>{appText(locale, "inline.goals.viewRecommendedExerciseEquipment", {"zh":"查看推薦運動器材","en":"View Recommended Exercise Equipment"})}</Text>
							<Ionicons name="chevron-forward" size={RFValue(18)} color="#840B1C" />
						</TouchableOpacity>
					</View>
				);
			})}

			<TouchableOpacity style={[styles.card, styles.smartCard]} onPress={() => router.push("/goals/smart")}>
				<View style={styles.cardHeader}>
					<MaterialCommunityIcons name="bullseye-arrow" size={RFValue(28)} color="#fff" />
					<View style={{ flex: 1, marginLeft: 12 }}>
						<Text style={[styles.cardTitle, { color: "#fff" }]}>{i18n.t("smartGoal")}</Text>
						<Text style={[styles.cardSub, { color: "#f2f2f2" }]}>
							{smartCount > 0 ? i18n.t("smartGoals") : i18n.t("noSmartGoals")}
						</Text>
					</View>
					<Ionicons name="chevron-forward" size={RFValue(20)} color="#fff" />
				</View>
			</TouchableOpacity>
		</ScrollView>
	);
};

const styles = StyleSheet.create({
	recommendButton: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.1)" },
	recommendText: { flex: 1, fontSize: RFValue(13), lineHeight: RFValue(19), color: "#840B1C", fontWeight: "700" },
	container: {
		flex: 1,
		backgroundColor: "#fff",
		paddingHorizontal: wp("5%"),
	},
	sectionTitle: {
		fontSize: RFValue(20),
		fontWeight: "bold",
		marginTop: hp("2%"),
		color: "#333",
	},
	hint: {
		fontSize: RFValue(13),
		color: "#888",
		marginTop: 4,
		marginBottom: hp("1.5%"),
	},
	card: {
		borderRadius: 14,
		padding: 16,
		marginBottom: hp("1.5%"),
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.15,
		shadowRadius: 4,
		elevation: 3,
	},
	cardCompact: { padding: 13 },
	cardHeader: {
		flexDirection: "row",
		alignItems: "center",
	},
	cardTitle: {
		fontSize: RFValue(17),
		fontWeight: "bold",
		color: "#333",
	},
	cardSub: {
		flexShrink: 1,
		fontSize: RFValue(13),
		color: "#555",
		marginTop: 2,
	},
	stepperRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginTop: 10,
	},
	stepperRowCompact: {
		alignItems: "flex-start",
		flexDirection: "column",
	},
	controls: {
		marginTop: 16,
		paddingTop: 8,
		borderTopWidth: 1,
		borderTopColor: "rgba(0,0,0,0.1)",
	},
	stepperLabel: {
		fontSize: RFValue(14),
		color: "#333",
		fontWeight: "600",
	},
	stepper: {
		flexDirection: "row",
		alignItems: "center",
	},
	stepperCompact: { alignSelf: "flex-end", marginTop: 7 },
	stepBtn: {
		backgroundColor: "#840B1C",
		borderRadius: 20,
		width: RFValue(34),
		height: RFValue(34),
		justifyContent: "center",
		alignItems: "center",
	},
	stepValue: {
		fontSize: RFValue(20),
		fontWeight: "bold",
		marginHorizontal: 20,
		color: "#333",
		minWidth: RFValue(24),
		textAlign: "center",
	},
	smartCard: {
		backgroundColor: "#840B1C",
	},
});

export default GoalSetting;
