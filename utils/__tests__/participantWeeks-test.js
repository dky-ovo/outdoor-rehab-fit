import { formatParticipantWeek, groupParticipantWeeks, participantWeekRange } from "../participantWeeks";

test("Hong Kong day keys group Monday through Sunday across months and years", () => {
	expect(participantWeekRange("2026-09-27")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
	expect(participantWeekRange("2026-09-28")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
	expect(participantWeekRange("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
	expect(participantWeekRange("2026-02-30")).toBeNull();
	expect(participantWeekRange("2026-09-27T16:00:00Z")).toBeNull();
	expect(formatParticipantWeek("2027-01-01", "en")).toContain("2026");
	expect(formatParticipantWeek("2027-01-01", "en")).toContain("2027");
});

test("weekly totals include every matching day, keep revisions, and round duration once", () => {
	const history = [{ versionNumber: 1, snapshot: { durationSec: 20 } }];
	const days = [
		{ date: "2026-09-28", appSessions: 9, exerciseSessions: 1, exerciseMinutes: 5 },
		{ date: "2026-09-27", appSessions: 2, audioPlays: 3, exerciseSessions: 1, exerciseMinutes: 1, outdoorSessions: 1, sessions: [{ id: "sunday", date: "2026-09-27T15:59:59Z", durationSec: 31, isModified: true, history }] },
		{ date: "2026-09-21", appSessions: 1, videoPlays: 4, exerciseSessions: 1, exerciseMinutes: 1, homeSessions: 1, sessions: [{ id: "monday", date: "2026-09-20T16:00:00Z", durationSec: 31 }] },
		{ date: "invalid", appSessions: 100 },
	];
	const weeks = groupParticipantWeeks(days, "exercise");
	expect(weeks.map(week => week.start)).toEqual(["2026-09-28", "2026-09-21"]);
	expect(weeks[1]).toMatchObject({ appSessions: 3, audioPlays: 3, videoPlays: 4, exerciseSessions: 2, exerciseMinutes: 1, outdoorSessions: 1, homeSessions: 1 });
	expect(weeks[1].sessions.map(session => session.id)).toEqual(["sunday", "monday"]);
	expect(weeks[1].sessions[0].history).toBe(history);
	expect(days[0].date).toBe("2026-09-28");
});

test("usage includes learning-only weeks and exercise omits them", () => {
	const days = [{ date: "2026-09-22", facilityLearningCount: 1 }, { date: "2026-09-28", exerciseSessions: 1 }];
	expect(groupParticipantWeeks(days, "usage").map(week => week.start)).toEqual(["2026-09-21"]);
	expect(groupParticipantWeeks(days, "exercise").map(week => week.start)).toEqual(["2026-09-28"]);
	expect(groupParticipantWeeks([], "usage")).toEqual([]);
});
