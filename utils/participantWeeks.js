const DAY_MS = 86400000;
const metrics = ["appSessions", "researchEvents", "screenViews", "audioPlays", "videoPlays", "exerciseSessions", "facilityLearningCount", "exerciseMinutes", "outdoorSessions", "homeSessions"];

function parseDateKey(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

// The API's day keys already use Hong Kong time. UTC calendar arithmetic avoids
// changing those dates with the viewer's device timezone or daylight savings.
export function participantWeekRange(dateKey) {
	const date = parseDateKey(dateKey);
	if (!date) return null;
	const offset = (date.getUTCDay() + 6) % 7;
	const start = date.getTime() - offset * DAY_MS;
	return { start: new Date(start).toISOString().slice(0, 10), end: new Date(start + 6 * DAY_MS).toISOString().slice(0, 10) };
}

export function hasParticipantData(day, view) {
	return view === "exercise" ? Number(day.exerciseSessions || 0) > 0
		: ["appSessions", "researchEvents", "screenViews", "audioPlays", "videoPlays", "facilityLearningCount"].some(key => Number(day[key] || 0) > 0);
}

export function groupParticipantWeeks(days = [], view) {
	const weeks = new Map();
	for (const day of days) {
		const range = participantWeekRange(day?.date);
		if (!range) continue;
		if (!weeks.has(range.start)) weeks.set(range.start, { ...range, days: [], sessions: [], ...Object.fromEntries(metrics.map(key => [key, 0])) });
		const week = weeks.get(range.start);
		week.days.push(day);
		week.sessions.push(...(Array.isArray(day.sessions) ? day.sessions : []));
		for (const key of metrics) week[key] += Number.isFinite(Number(day[key])) ? Number(day[key]) : 0;
	}
	return [...weeks.values()].filter(week => !view || hasParticipantData(week, view)).map(week => {
		week.days.sort((a, b) => b.date.localeCompare(a.date));
		week.sessions.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
		// Round once for the whole week when full sessions are available.
		if (week.sessions.length && week.sessions.length === week.exerciseSessions) week.exerciseMinutes = Math.round(week.sessions.reduce((sum, session) => sum + (Number(session.durationSec) || 0), 0) / 60);
		return week;
	}).sort((a, b) => b.start.localeCompare(a.start));
}

export function formatParticipantWeek(dateKey, locale = "zh") {
	const range = participantWeekRange(dateKey);
	if (!range) return String(dateKey || "");
	const format = key => new Date(`${key}T12:00:00Z`).toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
	return `${format(range.start)} – ${format(range.end)}`;
}
