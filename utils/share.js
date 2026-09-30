// App Upgrade #7: share a logged session to the in-app group or external apps
import { Share } from "react-native";
import { showAlert } from "./alert";
import { formatDuration, formatDateTime } from "./dates";

export const buildSessionSummary = async (session, i18n, locale) => {
	const lines = [];
	const catalog = i18n.t("equipmentList", { returnObjects: true });
	const equipmentNames = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [String(item.id), item.name]));
	lines.push(`🏃 ${i18n.t("sharedSessionTitle")}`);
	lines.push(`📅 ${formatDateTime(session.date, locale)}`);
	lines.push(`⏱️ ${i18n.t("totalDuration")}: ${formatDuration(session.durationSec)}`);
	lines.push(`📍 ${i18n.t(session.mode === "home" ? "homeSession" : "outdoorSession")}`);
	const completedTypes = [
		["aerobic", "aerobicDone"],
		["balance", "balanceDone"],
		["muscle", "muscleDone"],
	].filter(([key]) => session.types?.[key]);
	if (completedTypes.length) {
		lines.push(`✅ ${i18n.t("typeChecklist")}:`);
		completedTypes.forEach(([, labelKey]) => lines.push(`  • ${i18n.t(labelKey)}`));
	}
	if (session.mode === "outdoor" && session.exercises?.length) {
		lines.push(`💪 ${i18n.t("exerciseTypeRecord")}:`);
		session.exercises.forEach((ex) => {
			const displayName = equipmentNames.get(String(ex.equipmentId)) || ex.name;
			const detail = ex.intensity !== null && ex.intensity !== undefined && ex.intensity !== ""
				? `${i18n.t("equipmentIntensity")}: ${ex.intensity}/10`
				: ex.reps ? `${i18n.t("legacyReps")}: ${ex.reps}` : "";
			lines.push(`  • ${displayName}${detail ? ` — ${detail}` : ""}`);
		});
	}
	if (session.emotion != null) {
		lines.push(`😊 ${i18n.t("emotionScale")}: ${session.emotion}`);
	}
	if (session.rpe != null) {
		lines.push(`💪 ${i18n.t("rpeScale")}: ${session.rpe}`);
	}
	if (session.journal) {
		lines.push(`📝 ${i18n.t("sessionJournal")}: ${session.journal}`);
	}
	return lines.join("\n");
};

export const shareSession = async (session, i18n, locale, { onShareToGroup, allowChat = false } = {}) => {
	const summary = await buildSessionSummary(session, i18n, locale);
	const actions = [
		{ text: i18n.t("cancel"), style: "cancel" },
	];
	if (allowChat) {
		actions.push({
			text: i18n.t("shareToChat"),
			onPress: () => onShareToGroup?.(),
		});
	}
	actions.push({
			text: i18n.t("shareToExternal"),
			onPress: () => Share.share({ message: summary }),
		});
	showAlert(i18n.t("share"), "", actions);
};
