import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getEquipmentCatalog, getVolunteerParticipantLearning } from "../utils/api";
import { mergeEquipmentCatalog } from "../utils/equipmentCatalog";

export const participantLearningParam = value => String((Array.isArray(value) ? value[0] : value) ?? "");
export const participantLearningPage = value => {
	const page = Number(participantLearningParam(value));
	return Number.isSafeInteger(page) && page > 0 ? page : 1;
};

// Only the authorized server endpoint supplies another participant's progress.
// No local learning storage is consulted, even if the request fails/offline.
export function useParticipantLearningPage({ token, participantId, date, page, equipmentId, locale, i18n }) {
	const scope = JSON.stringify([token, participantId, date || "", page, equipmentId ?? "", locale]);
	const [state, setState] = useState(null);
	const [attempt, setAttempt] = useState(0);
	useFocusEffect(useCallback(() => {
		let active = true;
		setState({ scope, loading: true, result: null, catalog: [], error: null });
		if (!token || !participantId) {
			setState({ scope, loading: false, result: null, catalog: [], error: "access" });
			return () => { active = false; };
		}
		Promise.all([
			getVolunteerParticipantLearning(token, participantId, { ...(date ? { date } : {}), ...(equipmentId != null ? { equipmentId } : {}), page, pageSize: 20 }),
			getEquipmentCatalog(),
		]).then(([result, remoteCatalog]) => {
			if (!active) return;
			if (!result || !Array.isArray(result.items) || !result.participant || !remoteCatalog || !Array.isArray(remoteCatalog.items)) throw new Error("Invalid participant learning response");
			const base = i18n.t("equipmentList", { returnObjects: true });
			const catalog = mergeEquipmentCatalog(Array.isArray(base) ? base : [], remoteCatalog.items || [], locale);
			setState({ scope, loading: false, result, catalog, error: null });
		}).catch(error => {
			if (active) setState({ scope, loading: false, result: null, catalog: [], error: Number(error?.status) === 404 ? "unavailable" : [401, 403].includes(Number(error?.status)) ? "access" : "failed" });
		});
		return () => { active = false; };
	}, [scope, token, participantId, date, page, equipmentId, locale, i18n, attempt]));
	// Hide old data immediately during an account/participant/date change, before
	// React runs the effect which cancels the previous request.
	const current = state?.scope === scope ? state : { loading: true, result: null, catalog: [], error: null };
	return { ...current, retry: () => setAttempt(value => value + 1) };
}
