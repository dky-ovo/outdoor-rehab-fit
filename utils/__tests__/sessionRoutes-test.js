import { isRetiredCountupBlocked, sessionInitializationAction, sessionPathForMode, sessionReturnPath } from "../sessionRoutes";

test("each session mode has its own route", () => {
	const routes = [sessionPathForMode("countdown"), sessionPathForMode("countup"), sessionPathForMode("manual")];
	expect(routes).toEqual([
		"/(tabs)/session/countdown",
		"/(tabs)/session/countup",
		"/(tabs)/session/manual",
	]);
	expect(new Set(routes).size).toBe(3);
});

test("floating timers retain the source facility and navigation parameters", () => {
	expect(sessionReturnPath("/outdoor/detail", { id: "0", from: "ai", name: "太極揉推器" })).toBe("/outdoor/detail?id=0&from=ai&name=%E5%A4%AA%E6%A5%B5%E6%8F%89%E6%8E%A8%E5%99%A8");
	expect(sessionReturnPath("/session/countup", { returnTo: "/outdoor/detail" })).toBe("/(tabs)");
	expect(sessionReturnPath("/session?recordMode=countup")).toBe("/(tabs)");
	expect(sessionReturnPath("//example.com")).toBe("/(tabs)");
});

test("only the focused non-leaving timer route may initialise shared state", () => {
	const base = {
		hydrated: true,
		pendingSummary: null,
		started: false,
		mode: null,
		recordMode: "countup",
		requestedRecordMode: "countdown",
	};
	expect(sessionInitializationAction({ ...base, hydrated: false, isFocused: true, isLeaving: false })).toBeNull();
	expect(sessionInitializationAction({ ...base, isFocused: false, isLeaving: false, requestedRecordMode: "countdown" })).toBeNull();
	expect(sessionInitializationAction({ ...base, isFocused: true, isLeaving: true, requestedRecordMode: "countdown" })).toBeNull();
	expect(sessionInitializationAction({ ...base, isFocused: true, isLeaving: false })).toBe("choose");
	expect(sessionInitializationAction({ ...base, isFocused: true, isLeaving: false, mode: "outdoor", recordMode: "countdown" })).toBeNull();
	expect(sessionInitializationAction({ ...base, isFocused: true, isLeaving: false, mode: "outdoor", requestedRecordMode: "manual" })).toBe("reset");
});

test("retired count-up deep links cannot start new timers but preserve legacy running, paused and summary states", () => {
	const base = { requestedRecordMode: "countup", recordMode: "countup", started: false, pendingSummary: null };
	expect(isRetiredCountupBlocked(base)).toBe(true);
	expect(sessionInitializationAction({ ...base, hydrated: true, isFocused: true, isLeaving: false, mode: null })).toBeNull();
	expect(isRetiredCountupBlocked({ ...base, started: true, running: true })).toBe(false);
	expect(isRetiredCountupBlocked({ ...base, started: true, running: false })).toBe(false);
	expect(isRetiredCountupBlocked({ ...base, pendingSummary: { id: "old-summary" } })).toBe(false);
	expect(isRetiredCountupBlocked({ ...base, pendingSummary: { id: "manual-summary", recordMode: "manual" } })).toBe(true);
	expect(isRetiredCountupBlocked({ ...base, pendingSummary: { id: "countdown-summary", recordMode: "countdown" } })).toBe(true);
	expect(isRetiredCountupBlocked({ ...base, started: true, recordMode: "countdown" })).toBe(true);
	expect(isRetiredCountupBlocked({ ...base, requestedRecordMode: "manual" })).toBe(false);
});

test("a completed countdown is retained on its page but never blocks a new manual record", () => {
	const completed = { hydrated: true, isFocused: true, isLeaving: false, pendingSummary: null,
		started: true, completed: true, mode: "outdoor", recordMode: "countdown" };
	expect(sessionInitializationAction({ ...completed, requestedRecordMode: "countdown" })).toBeNull();
	expect(sessionInitializationAction({ ...completed, requestedRecordMode: "manual" })).toBe("reset");
	expect(sessionInitializationAction({ ...completed, requestedRecordMode: "manual", isFocused: false })).toBeNull();
});
