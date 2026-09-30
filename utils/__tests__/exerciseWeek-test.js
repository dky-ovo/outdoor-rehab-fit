import { savedExerciseDays, savedExerciseWeek } from "../exerciseWeek";

const today = new Date("2026-09-11T12:00:00");
const selected = (sessions) => savedExerciseWeek(sessions, today).filter((day) => day.completed).map((day) => day.date);

test("saved logs mark Monday through Sunday, deduplicate days and exclude other weeks", () => {
	const records = [{ date: "2026-09-07T09:00:00" }, { date: "2026-09-07T10:00:00" }, { date: "2026-09-10T20:00:00" }, { date: "2026-09-06T12:00:00" }];
	expect(selected(records)).toEqual(["2026-09-07", "2026-09-10"]);
	expect(savedExerciseWeek(records, today).map((day) => day.date)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
});

test("moving a saved log date and deleting it rebuild the marks without stale days", () => {
	const records = [{ id: "one", date: "2026-09-07T09:00:00" }];
	expect(selected(records)).toEqual(["2026-09-07"]);
	expect(selected([{ ...records[0], date: "2026-09-09T10:00:00" }])).toEqual(["2026-09-09"]);
	expect(selected([])).toEqual([]);
});

test("empty saved records do not count timer drafts and invalid dates never create a mark", () => {
	expect(savedExerciseDays([{ started: true, seconds: 300 }, { date: "invalid" }, { date: null }])).toEqual({});
	expect(savedExerciseWeek([], today).every((day) => !day.completed)).toBe(true);
});
