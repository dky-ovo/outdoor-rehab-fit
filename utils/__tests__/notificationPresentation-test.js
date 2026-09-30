import { countdownNotificationMatches, notificationPresentation, sessionTimerNotificationRoute } from "../notificationPresentation";

const notification = (data) => ({ request: { content: { data } } });
const countdown = notification({ type: "countdown", timerId: "timer-a", phase: "complete" });
const running = { hydrated: true, recordMode: "countdown", started: true, running: true, countdownId: "timer-a" };

test.each(["active", "background", "inactive"])("timer status remains in notification list without sound/banner (%s)", (state) => {
	expect(notificationPresentation(notification({ type: "session-timer" }), state)).toEqual({
		shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
	});
});

test("foreground countdown notifications are silent and hidden to avoid duplicating timer speech", () => {
	expect(notificationPresentation(countdown, "active")).toEqual({
		shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
	});
});

test.each(["background", "inactive", null, undefined])("countdown notifications remain visible and audible outside active state (%s)", (state) => {
	expect(notificationPresentation(countdown, state)).toEqual({
		shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
	});
});

test("a late halfway notification cannot replay stale speech after JS resumes", () => {
	expect(notificationPresentation(notification({ type: "countdown", phase: "halfway", notificationAt: Date.now() - 30_000 }), "background")).toEqual({
		shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
	});
});

test("a late completion remains in the notification list without replaying its old voice", () => {
	expect(notificationPresentation(notification({ type: "countdown", phase: "complete", notificationAt: Date.now() - 30_000 }), "background")).toEqual({
		shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
	});
});

test("a timely background notification still plays its bundled voice", () => {
	expect(notificationPresentation(notification({ type: "countdown", phase: "halfway", notificationAt: Date.now() - 1000 }), "background").shouldPlaySound).toBe(true);
});

test.each(["active", "background"])("other notifications retain presentation and badge behavior in %s", (state) => {
	expect(notificationPresentation(notification({ type: "announcement" }), state)).toEqual({
		shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
	});
});

test("a notification click matches only the current hydrated countdown identity", () => {
	expect(countdownNotificationMatches({ type: "countdown", timerId: "timer-a" }, running)).toBe(true);
	expect(countdownNotificationMatches({ type: "countdown", timerId: "timer-b" }, running)).toBe(false);
	expect(countdownNotificationMatches({ type: "countdown", timerId: "timer-a" }, { ...running, hydrated: false })).toBe(false);
});

test("a matching legacy pending summary is still explicitly recoverable", () => {
	expect(countdownNotificationMatches({ type: "countdown", timerId: "timer-a" }, {
		hydrated: true, started: false, recordMode: "countup",
		pendingSummary: { recordMode: "countdown", countdownId: "timer-a" },
	})).toBe(true);
});

test.each(["countdown", "session-timer"])("a completed pure countdown accepts only its same-identity %s notification", (type) => {
	const active = { ...running, completed: true, running: false, seconds: 0, pendingSummary: null };
	const data = { type, recordMode: "countdown", timerId: "timer-a" };
	expect(sessionTimerNotificationRoute(data, active)).toBe("/session/countdown");
	expect(sessionTimerNotificationRoute({ ...data, timerId: "timer-b" }, active)).toBeNull();
	expect(active.pendingSummary).toBeNull();
});

test.each(["countdown", "session-timer"])("a stale %s notice cannot select a legacy draft over a different current timer", (type) => {
	const active = { ...running, countdownId: "timer-b", pendingSummary: { recordMode: "countdown", countdownId: "timer-a" } };
	expect(sessionTimerNotificationRoute({ type, recordMode: "countdown", timerId: "timer-a" }, active)).toBeNull();
});

test("a countdown reminder can match restored state using the common timerId", () => {
	expect(countdownNotificationMatches({ type: "countdown", timerId: "timer-a" }, {
		...running, countdownId: null, timerId: "timer-a", completed: true,
	})).toBe(true);
});

test("abandoned timers and another account's different restored timer cannot be opened", () => {
	const data = { type: "countdown", timerId: "old-user-timer" };
	expect(countdownNotificationMatches(data, { hydrated: true, started: false, pendingSummary: null })).toBe(false);
	expect(countdownNotificationMatches(data, { ...running, countdownId: "new-user-timer" })).toBe(false);
	expect(countdownNotificationMatches(data, { hydrated: true, pendingSummary: { recordMode: "countdown", countdownId: "new-user-timer" } })).toBe(false);
});

test.each([null, undefined, {}, { type: "other", timerId: "timer-a" }, { type: "countdown", timerId: "" },
	{ type: "countdown", timerId: 123 }])("invalid notification data cannot match a countdown (%j)", (data) => {
	expect(countdownNotificationMatches(data, running)).toBe(false);
});

test("countup, manual, and unstarted countdown state cannot be opened by an old countdown notification", () => {
	const data = { type: "countdown", timerId: "timer-a" };
	expect(countdownNotificationMatches(data, { ...running, recordMode: "countup" })).toBe(false);
	expect(countdownNotificationMatches(data, { ...running, recordMode: "manual" })).toBe(false);
	expect(countdownNotificationMatches(data, { ...running, started: false })).toBe(false);
	expect(countdownNotificationMatches(data, null)).toBe(false);
});
