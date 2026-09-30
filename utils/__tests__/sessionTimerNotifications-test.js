import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { isSessionTimerNotificationAvailable, updateAsync, clearAsync, getStatusAsync, prepareNotificationChannelAsync } from "../../modules/session-timer-notification";
import { createSessionTimerNotificationManager, sessionTimerNotificationPlan,
	SESSION_TIMER_NOTIFICATION_ID, SESSION_TIMER_NOTIFICATION_CHANNEL } from "../sessionTimerNotifications";

jest.mock("../../modules/session-timer-notification", () => ({
	isSessionTimerNotificationAvailable: jest.fn(), updateAsync: jest.fn(), clearAsync: jest.fn(), getStatusAsync: jest.fn(), prepareNotificationChannelAsync: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
	IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
	AndroidImportance: { LOW: 2 }, AndroidNotificationVisibility: { PUBLIC: 1 }, AndroidNotificationPriority: { LOW: "low" },
	setNotificationChannelAsync: jest.fn(), getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
	getPresentedNotificationsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(),
	cancelScheduledNotificationAsync: jest.fn(), dismissNotificationAsync: jest.fn(),
}));

const originalPlatform = Platform.OS;
let delivered;
function session(overrides = {}) {
	return { mode: "outdoor", recordMode: "countup", timerId: "timer-current", started: true,
		running: true, startedAt: Date.now(), accumulatedSeconds: 0, targetDurationSec: 0, ...overrides };
}
function input(overrides = {}) { return { ownerKey: "user:private-owner", session: session(), locale: "zh", ...overrides }; }
function defer() { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }

beforeEach(() => {
	jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-08T08:00:00Z"));
	Platform.OS = "android"; jest.clearAllMocks(); delivered = new Map();
	isSessionTimerNotificationAvailable.mockReset().mockReturnValue(false);
	updateAsync.mockReset().mockResolvedValue({ status: "updated" });
	clearAsync.mockReset().mockResolvedValue({ status: "cleared" });
	getStatusAsync.mockReset().mockResolvedValue({ status: "visible" });
	prepareNotificationChannelAsync.mockReset().mockResolvedValue({ status: 'prepared' });
	Notifications.getPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });
	Notifications.requestPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });
	Notifications.setNotificationChannelAsync.mockReset().mockResolvedValue(null);
	Notifications.getPresentedNotificationsAsync.mockReset().mockImplementation(async () => [...delivered.values()]);
	Notifications.cancelScheduledNotificationAsync.mockReset().mockResolvedValue(undefined);
	Notifications.dismissNotificationAsync.mockReset().mockImplementation(async (id) => { delivered.delete(id); });
	Notifications.scheduleNotificationAsync.mockReset().mockImplementation(async (request) => {
		delivered.set(request.identifier, { request }); return request.identifier;
	});
});
afterEach(() => { Platform.OS = originalPlatform; jest.useRealTimers(); });

test("new Android runtime repairs a system-missing countup row once per lifecycle sync", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager();
	const args = input(); await manager.sync(args);
	getStatusAsync.mockResolvedValueOnce({ status: "missing", recoverableMissing: true });
	expect(await manager.sync(args)).toMatchObject({ status: "updated", mode: "native" });
	expect(updateAsync).toHaveBeenCalledTimes(2);
	await manager.sync(args);
	expect(updateAsync).toHaveBeenCalledTimes(2);
});

test("new Android runtime never repairs the user's explicitly dismissed row until a new start/resume", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager();
	const args = input(); await manager.sync(args);
	getStatusAsync.mockResolvedValue({ status: "suppressed", recoverableMissing: false });
	expect(await manager.sync(args)).toEqual({ status: "suppressed" });
	expect(updateAsync).toHaveBeenCalledTimes(1);
	await manager.sync(input({ requestPermission: true, session: session({ running: false, startedAt: null }) }));
	expect(updateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ restoreDismissed: true }));
});

test("countup fallback describes its current-run start and previous accumulated time, not a frozen live timer", () => {
	const plan = sessionTimerNotificationPlan(input({ session: session({ accumulatedSeconds: 75 }) }));
	expect(plan.status).toBe("ready");
	expect(plan.payload.body).toContain("本段開始");
	expect(plan.payload.body).toContain("開始前已累計：1:15");
	expect(plan.payload.title).toBe("正數計時器 · 計時中");
});

test("countdown fallback describes the absolute finish clock, independent of current elapsed render", () => {
	const args = input({ session: session({ recordMode: "countdown", targetDurationSec: 90, accumulatedSeconds: 30 }) });
	const initial = sessionTimerNotificationPlan(args);
	jest.setSystemTime(Date.now() + 15_000);
	const later = sessionTimerNotificationPlan(args);
	expect(initial.payload.body).toContain("預計結束");
	expect(later.payload.body).toBe(initial.payload.body);
	expect(later.key).toBe(initial.key);
});

test.each([
	["countup", "已計時：1:05"], ["countdown", "剩餘：0:55"],
])("paused %s uses a stable duration and native-compatible zero start", (recordMode, body) => {
	const plan = sessionTimerNotificationPlan(input({ session: session({ recordMode, running: false, startedAt: null, accumulatedSeconds: 65, targetDurationSec: 120 }) }));
	expect(plan.payload.title).toContain("已暫停");
	expect(plan.payload.body).toContain(body);
	expect(plan.payload.startedAt).toBe(0);
});

test.each([
	{ started: false }, { recordMode: "manual" },
])("inactive and manual records do not create a timer status: %j", (overrides) => {
	expect(sessionTimerNotificationPlan(input({ session: session(overrides) })).status).toBe("cleared");
});

test.each([
	{ timerId: "", countdownId: "" }, { startedAt: null }, { accumulatedSeconds: -1 },
	{ recordMode: "countdown", targetDurationSec: NaN }, { recordMode: "countdown", targetDurationSec: 0 },
	{ accumulatedSeconds: 31536001 }, { recordMode: "countdown", targetDurationSec: 31536001 },
	{ timerId: "x".repeat(201) }, { startedAt: Number.MAX_SAFE_INTEGER + 1 },
])("invalid native timer values are rejected: %j", (overrides) => {
	expect(sessionTimerNotificationPlan(input({ session: session(overrides) })).status).toBe("invalid");
});

test("missing owner clears and expired countdown cannot reappear as running", () => {
	expect(sessionTimerNotificationPlan(input({ ownerKey: null })).status).toBe("cleared");
	expect(sessionTimerNotificationPlan(input({ session: session({ recordMode: "countdown", targetDurationSec: 60, startedAt: Date.now() - 60_000 }) })).status).toBe("expired");
});

test("fallback displays one silent ongoing notification without owner PII", async () => {
	const result = await createSessionTimerNotificationManager().sync(input());
	expect(result).toEqual({ status: "updated", mode: "fallback" });
	const request = delivered.get(SESSION_TIMER_NOTIFICATION_ID).request;
	expect(request.content).toMatchObject({ sound: false, priority: "low", sticky: true, autoDismiss: false,
		data: { type: "session-timer", timerId: "timer-current", recordMode: "countup" } });
	expect(request.trigger).toEqual({ channelId: SESSION_TIMER_NOTIFICATION_CHANNEL });
	expect(JSON.stringify(request)).not.toContain("private-owner");
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('native path leaves channel migration to native code and exposes lock-screen restrictions', async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	updateAsync.mockResolvedValue({ status: 'updated', channelId: 'session-timer-status-v1', lockscreenRestricted: true, lockscreenReason: 'channel_silent' });
	const manager = createSessionTimerNotificationManager();
	const args = input();
	expect(await manager.sync(args)).toMatchObject({ status: 'updated', lockscreenRestricted: true, lockscreenReason: 'channel_silent' });
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	getStatusAsync.mockResolvedValue({ status: 'visible', lockscreenRestricted: true, lockscreenReason: 'channel_privacy' });
	expect(await manager.sync(args)).toMatchObject({ unchanged: true, lockscreenRestricted: true, lockscreenReason: 'channel_privacy' });
});

test('older native module without channel preparation still creates its original channel before requesting permission', async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	prepareNotificationChannelAsync.mockResolvedValue({ status: 'unavailable' });
	Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
	await createSessionTimerNotificationManager().sync(input({ requestPermission: true }));
	expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(SESSION_TIMER_NOTIFICATION_CHANNEL, expect.any(Object));
	expect(Notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(Notifications.requestPermissionsAsync.mock.invocationCallOrder[0]);
});

test("unchanged structure does not publish a new notification on every clock render", async () => {
	const manager = createSessionTimerNotificationManager(); const args = input();
	await manager.sync(args);
	jest.setSystemTime(Date.now() + 5000);
	expect(await manager.sync({ ...args, session: { ...args.session, countdownHalfwayAnnounced: true } })).toMatchObject({ unchanged: true });
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test("dismissed fallback can be restored by a later explicit sync without duplicates", async () => {
	const manager = createSessionTimerNotificationManager(); const args = input();
	await manager.sync(args); delivered.clear();
	await manager.sync(args);
	expect(delivered.size).toBe(1);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

test("pause resume mode and account changes replace only the one owned status", async () => {
	delivered.set("chat-1", { request: { identifier: "chat-1", content: { data: { type: "chat" } } } });
	const manager = createSessionTimerNotificationManager();
	await manager.sync(input());
	await manager.sync(input({ session: session({ running: false, startedAt: null, accumulatedSeconds: 20 }) }));
	expect(delivered.get(SESSION_TIMER_NOTIFICATION_ID).request.content.title).toContain("已暫停");
	await manager.sync(input({ session: session({ accumulatedSeconds: 20 }) }));
	await manager.sync(input({ ownerKey: "user:another", session: session({ timerId: "other-timer", recordMode: "countdown", targetDurationSec: 60 }) }));
	expect([...delivered.keys()]).toEqual(["chat-1", SESSION_TIMER_NOTIFICATION_ID]);
	expect(delivered.get(SESSION_TIMER_NOTIFICATION_ID).request.content.data.timerId).toBe("other-timer");
	expect(Notifications.cancelScheduledNotificationAsync.mock.calls.every(([id]) => id === SESSION_TIMER_NOTIFICATION_ID)).toBe(true);
	expect(Notifications.dismissNotificationAsync.mock.calls.every(([id]) => id === SESSION_TIMER_NOTIFICATION_ID)).toBe(true);
});

test("clear and inactive sync remove both scheduled and already delivered owned status", async () => {
	const manager = createSessionTimerNotificationManager();
	await manager.sync(input());
	expect((await manager.clear()).status).toBe("cleared");
	expect(delivered.size).toBe(0);
	await manager.sync(input());
	await manager.sync({ ownerKey: null, session: null });
	expect(delivered.size).toBe(0);
	expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(SESSION_TIMER_NOTIFICATION_ID);
	expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(SESSION_TIMER_NOTIFICATION_ID);
});

test("new Android uses native chronometer once and reuses same structure", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager(); const args = input();
	expect(await manager.sync(args)).toEqual({ status: "updated", mode: "native" });
	expect(updateAsync).toHaveBeenCalledWith(expect.objectContaining({ timerId: "timer-current", recordMode: "countup", running: true,
		url: "myapp://timer-notification?timerId=timer-current&recordMode=countup", body: "點按返回計時器。", channelName: "目前運動計時器" }));
	expect(await manager.sync(args)).toMatchObject({ unchanged: true });
	expect(updateAsync).toHaveBeenCalledTimes(1);
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
	await manager.clear(); expect(clearAsync).toHaveBeenCalled();
});

test("paused native state has no null bridge number and encoded deep link is safe", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	await createSessionTimerNotificationManager().sync(input({ locale: "en", session: session({ timerId: "timer/a?b&c", running: false, startedAt: null, accumulatedSeconds: 12 }) }));
	expect(updateAsync).toHaveBeenCalledWith(expect.objectContaining({ startedAt: 0, accumulatedSeconds: 12, running: false,
		body: "Tap to return to the timer.", url: "myapp://timer-notification?timerId=timer%2Fa%3Fb%26c&recordMode=countup" }));
});

test("native unavailable return safely falls back while native failures do not produce duplicate status", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	updateAsync.mockResolvedValueOnce({ status: "unavailable" });
	expect(await createSessionTimerNotificationManager().sync(input())).toEqual({ status: "updated", mode: "fallback" });
	await createSessionTimerNotificationManager().clear();
	Notifications.scheduleNotificationAsync.mockClear();
	updateAsync.mockRejectedValueOnce(new Error("bridge failed"));
	expect((await createSessionTimerNotificationManager().sync(input())).status).toBe("failed");
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("old iOS binary uses one English silent list item", async () => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(false);
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", ios: { status: 3 } });
	expect(await createSessionTimerNotificationManager().sync(input({ locale: "en" }))).toEqual({ status: "updated", mode: "fallback" });
	const request = delivered.get(SESSION_TIMER_NOTIFICATION_ID).request;
	expect(request.content.title).toBe("Count-up timer · Running");
	expect(request.content.body).toContain("Current run started");
	expect(request.trigger).toBeNull();
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	expect(updateAsync).not.toHaveBeenCalled();
});

test("iOS Live Activity works independently of denied notification permission", async () => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", ios: { status: 1 } });
	expect(await createSessionTimerNotificationManager().sync(input({ requestPermission: true }))).toEqual({ status: "updated", mode: "native" });
	expect(updateAsync).toHaveBeenCalledWith(expect.objectContaining({ locale: "zh", modeLabel: "正數計時器", statusLabel: "計時中", timeLabel: "已計時間" }));
	expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test.each(["denied", "unavailable"])("iOS native %s falls back only when ordinary notifications are allowed", async (status) => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	updateAsync.mockResolvedValue({ status });
	const manager = createSessionTimerNotificationManager();
	expect(await manager.sync(input())).toEqual({ status: "updated", mode: "fallback" });
	expect(clearAsync).toHaveBeenCalled();
	expect(delivered.size).toBe(1);
	expect(await manager.sync(input())).toMatchObject({ status: "updated", mode: "fallback", unchanged: true });
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
	expect((await manager.sync(input())).status).toBe("denied");
	expect(delivered.size).toBe(0);
});

test("Android unchanged state rechecks channel permission without blindly claiming success", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager(); const args = input();
	await manager.sync(args);
	getStatusAsync.mockResolvedValueOnce({ status: "denied" });
	expect(await manager.sync(args)).toEqual({ status: "denied" });
	expect(clearAsync).toHaveBeenCalled();
	expect(updateAsync).toHaveBeenCalledTimes(1);
});

test("Android dismissed notification stays dismissed until a new explicit timer state", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager(); const args = input();
	await manager.sync(args);
	getStatusAsync.mockResolvedValue({ status: "missing" });
	expect(await manager.sync(args)).toEqual({ status: "suppressed" });
	expect(await manager.sync(args)).toEqual({ status: "suppressed" });
	expect(updateAsync).toHaveBeenCalledTimes(1);
	await manager.sync({ ...args, session: session({ running: false, startedAt: null, accumulatedSeconds: 12 }) });
	expect(updateAsync).toHaveBeenCalledTimes(2);
});

test.each(["suppressed", "deferred"])("iOS %s never spams a replacement notification", async (status) => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	updateAsync.mockResolvedValueOnce({ status });
	const manager = createSessionTimerNotificationManager(); const args = input();
	expect(await manager.sync(args)).toEqual({ status });
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
	expect(await manager.sync(args)).toEqual({ status: "updated", mode: "native" });
});

test("iOS revalidates unchanged native state and notices a disabled Live Activity", async () => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager(); const args = input();
	await manager.sync(args);
	updateAsync.mockResolvedValueOnce({ status: "updated", unchanged: true });
	expect(await manager.sync(args)).toEqual({ status: "updated", mode: "native", unchanged: true });
	updateAsync.mockResolvedValueOnce({ status: "denied" });
	expect(await manager.sync(args)).toEqual({ status: "updated", mode: "fallback" });
	expect(updateAsync).toHaveBeenCalledTimes(3);
	expect(delivered.size).toBe(1);
});

test("iOS discard clears an activity created by a late native response", async () => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	const pending = defer(); updateAsync.mockReturnValueOnce(pending.promise);
	const manager = createSessionTimerNotificationManager(); const job = manager.sync(input());
	await flush(); expect(updateAsync).toHaveBeenCalledTimes(1);
	const clearing = manager.clear(); pending.resolve({ status: "updated" });
	expect((await job).status).toBe("cancelled");
	expect((await clearing).status).toBe("cleared");
	expect(clearAsync).toHaveBeenCalled();
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("iOS expired countdown clears native activity without restarting it", async () => {
	Platform.OS = "ios"; isSessionTimerNotificationAvailable.mockReturnValue(true);
	const manager = createSessionTimerNotificationManager();
	expect((await manager.sync(input({ session: session({ recordMode: "countdown", targetDurationSec: 30, startedAt: Date.now() - 31_000 }) }))).status).toBe("expired");
	expect(clearAsync).toHaveBeenCalled();
	expect(updateAsync).not.toHaveBeenCalled();
});

test("native lock screen labels follow the selected language and contain no user information", () => {
	const payload = sessionTimerNotificationPlan(input({ locale: "en", session: session({ recordMode: "countdown", targetDurationSec: 90, running: false }) })).payload;
	expect(payload).toMatchObject({ locale: "en", modeLabel: "Countdown timer", statusLabel: "Paused", timeLabel: "Remaining", openLabel: "Tap to open timer", finishedLabel: "Finished" });
	expect(JSON.stringify(payload)).not.toContain("private-owner");
});

test("requests permission only with caller authorization and Android channel already exists", async () => {
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
	const manager = createSessionTimerNotificationManager();
	expect((await manager.sync(input())).status).toBe("denied");
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
	expect((await manager.sync(input({ requestPermission: true }))).status).toBe("updated");
	expect(Notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(Notifications.requestPermissionsAsync.mock.invocationCallOrder[0]);
	expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
});

test("denied permission removes status and cannot be repeatedly requested when canAskAgain is false", async () => {
	const manager = createSessionTimerNotificationManager(); await manager.sync(input());
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
	expect((await manager.sync(input({ requestPermission: true }))).status).toBe("denied");
	expect(delivered.size).toBe(0);
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test("countdown expiring during permission prompt never publishes a stale timer", async () => {
	const pending = defer();
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
	Notifications.requestPermissionsAsync.mockReturnValue(pending.promise);
	const manager = createSessionTimerNotificationManager();
	const job = manager.sync(input({ requestPermission: true, session: session({ recordMode: "countdown", targetDurationSec: 30 }) }));
	await flush(); jest.setSystemTime(Date.now() + 40_000); pending.resolve({ status: "granted" });
	expect((await job).status).toBe("expired");
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("late fallback scheduling after discard is withdrawn and cannot resurrect a status", async () => {
	const pending = defer();
	Notifications.scheduleNotificationAsync.mockImplementationOnce(async (request) => {
		await pending.promise; delivered.set(request.identifier, { request }); return request.identifier;
	});
	const manager = createSessionTimerNotificationManager(); const job = manager.sync(input());
	await flush(); expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
	const clearing = manager.clear(); pending.resolve();
	expect((await job).status).toBe("cancelled"); await clearing;
	expect(delivered.size).toBe(0);
});

test("late native update after discard is cleared before any later request", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true); const pending = defer();
	updateAsync.mockReturnValueOnce(pending.promise);
	const manager = createSessionTimerNotificationManager(); const job = manager.sync(input());
	await flush(); expect(updateAsync).toHaveBeenCalledTimes(1);
	const clearing = manager.clear(); pending.resolve({ status: "updated" });
	expect((await job).status).toBe("cancelled"); await clearing;
	expect(clearAsync).toHaveBeenCalled();
});

test("deduplicates pending structure then newer pause supersedes delayed permission continuation", async () => {
	const pending = defer(); Notifications.getPermissionsAsync.mockReturnValueOnce(pending.promise);
	const manager = createSessionTimerNotificationManager(); const args = input(); const old = manager.sync(args);
	expect(manager.sync(args)).toBe(old); await flush();
	const paused = manager.sync(input({ session: session({ running: false, startedAt: null, accumulatedSeconds: 20 }) }));
	pending.resolve({ status: "granted" });
	expect((await old).status).toBe("cancelled"); await paused;
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
	expect(delivered.get(SESSION_TIMER_NOTIFICATION_ID).request.content.title).toContain("已暫停");
});

test("clear failure is surfaced and does not layer a fallback onto an uncleared native notification", async () => {
	isSessionTimerNotificationAvailable.mockReturnValue(true);
	updateAsync.mockResolvedValue({ status: "unavailable" });
	clearAsync.mockResolvedValue({ status: "invalid" });
	expect((await createSessionTimerNotificationManager().sync(input())).status).toBe("failed");
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("web never calls native notifications or asks for permission", async () => {
	Platform.OS = "web"; const manager = createSessionTimerNotificationManager();
	expect((await manager.sync(input({ requestPermission: true }))).status).toBe("unsupported");
	expect((await manager.clear()).status).toBe("unsupported");
	expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
	expect(updateAsync).not.toHaveBeenCalled();
});
