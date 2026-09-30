// Shared progress bars for the three preset weekly goals (App Upgrade #6)
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { RFValue } from "react-native-responsive-fontsize";

const BAR_CONFIG = [
	{ key: "aerobic", labelKey: "aerobicGoal", unitKey: "minutes", fallbackUnit: { en: "minutes", zh: "分鐘" }, color: "#E9B44C" },
	{ key: "balance", labelKey: "balanceGoal", unitKey: "days", fallbackUnit: { en: "days", zh: "天" }, color: "#EB9481" },
	{ key: "muscle", labelKey: "muscleGoal", unitKey: "days", fallbackUnit: { en: "days", zh: "天" }, color: "#9B2226" },
];

const translatedOrFallback = (i18n, key, fallback) => {
	if (typeof i18n?.has === "function" && i18n.has(key)) return i18n.t(key);
	const language = String(i18n?.locale || "zh").toLowerCase();
	return language.startsWith("en") ? fallback.en : fallback.zh;
};

const GoalProgressBars = ({ i18n, progress, targets }) => {
	const visibleGoals = BAR_CONFIG.filter(({ key }) => Number(targets?.[key] ?? 0) > 0);
	if (visibleGoals.length === 0) return null;
	return (
		<View style={styles.container}>
			{visibleGoals.map(({ key, labelKey, unitKey, fallbackUnit, color }) => {
				const target = Number(targets?.[key] ?? 0);
				const rawValue = Number(progress?.[key] ?? 0);
				const value = Number.isFinite(rawValue) ? Math.max(0, Math.round(rawValue)) : 0;
				const pct = Math.min(1, value / target);
				const achieved = value >= target;
				const unit = translatedOrFallback(i18n, unitKey, fallbackUnit);
				return (
					<View key={key} style={styles.row}>
						<View style={styles.labelRow}>
							<Text style={styles.label} maxFontSizeMultiplier={1.2}>{i18n.t(labelKey)}</Text>
							<Text style={[styles.value, achieved && styles.achieved]} maxFontSizeMultiplier={1.2}>
								{value} / {target} {unit} {achieved ? "✓" : ""}
							</Text>
						</View>
						<View style={styles.track}>
							<View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
						</View>
					</View>
				);
			})}
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		width: "100%",
	},
	row: {
		marginBottom: 12,
	},
	labelRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: 8,
		marginBottom: 4,
	},
	label: {
		flex: 1,
		minWidth: 0,
		flexShrink: 1,
		fontSize: RFValue(13),
		color: "#444",
		fontWeight: "600",
	},
	value: {
		flexShrink: 0,
		fontSize: RFValue(13),
		color: "#666",
	},
	achieved: {
		color: "#2E8B57",
		fontWeight: "bold",
	},
	track: {
		height: RFValue(12),
		backgroundColor: "#eee",
		borderRadius: RFValue(6),
		overflow: "hidden",
	},
	fill: {
		height: "100%",
		borderRadius: RFValue(6),
	},
});

export default GoalProgressBars;
