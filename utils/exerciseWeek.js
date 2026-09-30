import { getWeekDates, toDateKey } from "./dates";

// Only persisted exercise records belong here, never the active timer/draft.
export function savedExerciseDays(sessions = []) {
	const days = {};
	for (const session of sessions) {
		if (!session?.date) continue;
		const date = new Date(session.date);
		if (Number.isFinite(date.getTime())) days[toDateKey(date)] = true;
	}
	return days;
}

export function savedExerciseWeek(sessions = [], today = new Date()) {
	const days = savedExerciseDays(sessions);
	return getWeekDates(today).map((date) => ({ date: toDateKey(date), completed: !!days[toDateKey(date)] }));
}
