import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import { isNativeCountdownReminderAvailable, scheduleCountdownRemindersAsync, clearCountdownRemindersAsync } from "../../modules/session-timer-notification";
import {
	COUNTDOWN_NOTIFICATION_CHANNEL, COUNTDOWN_NOTIFICATION_STORAGE_KEY, COUNTDOWN_NOTIFICATION_SOUNDS,
	countdownNotificationPlan, countdownNotificationSoundsForRuntime, createCountdownNotificationScheduler,
} from "../countdownNotifications";

jest.mock("expo-updates", () => ({ runtimeVersion: null }));
jest.mock("../../modules/session-timer-notification", () => ({
	isNativeCountdownReminderAvailable: jest.fn(() => false),
	scheduleCountdownRemindersAsync: jest.fn(), clearCountdownRemindersAsync: jest.fn(),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
	const data = new Map();
	return { __esModule: true, default: {
		getItem: jest.fn(async (key) => data.get(key) ?? null),
		setItem: jest.fn(async (key, value) => { data.set(key, value); }),
		removeItem: jest.fn(async (key) => { data.delete(key); }), __data: data,
	} };
});
jest.mock("expo-notifications", () => ({
	SchedulableTriggerInputTypes: { DATE: "date" },
	IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
	AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PUBLIC: 1 },
	setNotificationChannelAsync: jest.fn(), getNotificationChannelAsync: jest.fn(), getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
	getAllScheduledNotificationsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(),
}));

let requests;
const originalPlatform = Platform.OS;
function session(overrides = {}) {
	return { mode: "outdoor", recordMode: "countdown", countdownId: "timer-a", targetDurationSec: 60,
		started: true, running: true, startedAt: Date.now(), accumulatedSeconds: 0, ...overrides };
}
function input(overrides = {}) { return { ownerKey: "user:private-test-user", locale: "zh", session: session(), ...overrides }; }
function defer() { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }

beforeEach(() => {
	jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-08T08:00:00Z"));
	Platform.OS = "android";
	Updates.runtimeVersion = null;
	isNativeCountdownReminderAvailable.mockReset().mockReturnValue(false);
	scheduleCountdownRemindersAsync.mockReset().mockResolvedValue({ status: "scheduled", exactAlarmsAllowed: true });
	clearCountdownRemindersAsync.mockReset().mockResolvedValue({ status: "cleared" });
	jest.clearAllMocks();
	AsyncStorage.__data.clear();
	requests = new Map();
	Notifications.getAllScheduledNotificationsAsync.mockReset().mockImplementation(async () => [...requests.values()]);
	Notifications.cancelScheduledNotificationAsync.mockReset().mockImplementation(async (id) => { requests.delete(id); });
	Notifications.scheduleNotificationAsync.mockReset().mockImplementation(async (request) => { requests.set(request.identifier, request); return request.identifier; });
	Notifications.setNotificationChannelAsync.mockReset().mockResolvedValue(null);
	Notifications.getNotificationChannelAsync.mockReset().mockResolvedValue(null);
	Notifications.getPermissionsAsync.mockReset().mockResolvedValue({ status: "granted", granted: true });
	Notifications.requestPermissionsAsync.mockReset().mockResolvedValue({ status: "granted", granted: true });
});

test("new Android bridge replaces Expo alarms with one native plan and no user identity in receiver payload", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const args = input();
	await scheduler.sync(args);
	expect(requests.size).toBe(2);
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	const result = await scheduler.sync(args);
	expect(result).toMatchObject({ status: "scheduled", mode: "native-alarm", exactAlarmsAllowed: true, soundEnabled: true });
	expect(requests.size).toBe(0);
	expect(scheduleCountdownRemindersAsync).toHaveBeenCalledWith(expect.objectContaining({
		timerId: "timer-a", halfwayAt: Date.now() + 30_000, deadlineAt: Date.now() + 60_000,
		halfwayChannel: COUNTDOWN_NOTIFICATION_CHANNEL, completeChannel: COUNTDOWN_NOTIFICATION_CHANNEL,
		halfwaySound: "default", completeSound: "default",
	}));
	expect(result.scheduled).toEqual([{ phase: "halfway", at: Date.now() + 30_000 }, { phase: "complete", at: Date.now() + 60_000 }]);
	expect(clearCountdownRemindersAsync).not.toHaveBeenCalled();
});

test("native scheduler uses installed English sounds but keeps user's silenced legacy channel", async () => {
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	Updates.runtimeVersion = "1.1.4";
	Notifications.getNotificationChannelAsync.mockResolvedValue({ importance: 2, sound: null });
	await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect(scheduleCountdownRemindersAsync).toHaveBeenCalledWith(expect.objectContaining({
		halfwayChannel: COUNTDOWN_NOTIFICATION_CHANNEL, completeChannel: COUNTDOWN_NOTIFICATION_CHANNEL,
		halfwaySound: "", completeSound: "",
	}));
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("native permission failure is reported, not masked by adding a second Expo alarm pair", async () => {
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	scheduleCountdownRemindersAsync.mockResolvedValue({ status: "failed", exactAlarmsAllowed: false });
	expect(await createCountdownNotificationScheduler().sync(input())).toMatchObject({ status: "failed", exactAlarmsAllowed: false });
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("native unavailable exact access preserves the system's inexact result for UI guidance", async () => {
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	scheduleCountdownRemindersAsync.mockResolvedValue({ status: "scheduled", exactAlarmsAllowed: false });
	expect(await createCountdownNotificationScheduler().sync(input())).toMatchObject({ status: "scheduled", exactAlarmsAllowed: false });
});

test("pausing, abandonment and expired pruning invoke native cancellation with the right policy", async () => {
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	const scheduler = createCountdownNotificationScheduler();
	await scheduler.sync(input({ session: session({ running: false }) }));
	expect(clearCountdownRemindersAsync).toHaveBeenLastCalledWith({ preserveDue: false, expiredOnly: false });
	await scheduler.cancel({ preserveDue: true });
	expect(clearCountdownRemindersAsync).toHaveBeenLastCalledWith({ preserveDue: true, expiredOnly: false });
	await scheduler.pruneExpired();
	expect(clearCountdownRemindersAsync).toHaveBeenLastCalledWith({ preserveDue: false, expiredOnly: true });
});

test("discard during native scheduling cancels its late result instead of resurrecting alarms", async () => {
	isNativeCountdownReminderAvailable.mockReturnValue(true);
	const delayed = defer(); scheduleCountdownRemindersAsync.mockReturnValueOnce(delayed.promise);
	const scheduler = createCountdownNotificationScheduler();
	const scheduled = scheduler.sync(input()); await flush();
	expect(scheduleCountdownRemindersAsync).toHaveBeenCalledTimes(1);
	const cancelled = scheduler.cancel(); delayed.resolve({ status: "scheduled" });
	expect(await scheduled).toMatchObject({ status: "cancelled" });
	await cancelled; expect(clearCountdownRemindersAsync).toHaveBeenCalled();
});
afterEach(() => { Platform.OS = originalPlatform; jest.useRealTimers(); });

test("plans halfway and complete using absolute times with odd-duration precision", () => {
	const now = Date.now();
	expect(countdownNotificationPlan(input({ session: session({ targetDurationSec: 5 }) })).milestones).toEqual([
		{ phase: "halfway", at: now + 2500 }, { phase: "complete", at: now + 5000 },
	]);
});

test.each([
	{ recordMode: "countup" }, { recordMode: "manual" }, { running: false }, { started: false }, { completed: true },
	{ targetDurationSec: 0 }, { targetDurationSec: NaN }, { accumulatedSeconds: -1 }, { startedAt: null },
])("invalid or inactive timers do not plan notifications: %j", (overrides) => {
	expect(countdownNotificationPlan(input({ session: session(overrides) }))).toBeNull();
});

test("no owner or elapsed timer does not plan a new delayed completion", () => {
	expect(countdownNotificationPlan(input({ ownerKey: null }))).toBeNull();
	expect(countdownNotificationPlan(input({ session: session({ startedAt: Date.now() - 90_000 }) })).milestones).toEqual([]);
});

test("resuming excludes paused time and does not replan an already reached halfway cue", () => {
	const now = Date.now();
	expect(countdownNotificationPlan(input({ session: session({ accumulatedSeconds: 20 }) })).milestones).toEqual([
		{ phase: "halfway", at: now + 10_000 }, { phase: "complete", at: now + 40_000 },
	]);
	expect(countdownNotificationPlan(input({ session: session({ accumulatedSeconds: 40 }) })).milestones).toEqual([
		{ phase: "complete", at: now + 20_000 },
	]);
});

test("schedules two persistent native date requests with localized content and no personal owner data", async () => {
	const result = await createCountdownNotificationScheduler().sync(input());
	expect(result.status).toBe("scheduled");
	expect(result.ids).toHaveLength(2);
	const scheduled = [...requests.values()];
	expect(scheduled.map((item) => item.content.body)).toEqual([
		"倒數計時已過一半。", "倒數計時已結束。",
	]);
	expect(scheduled[0].trigger).toEqual({ type: "date", date: new Date(Date.now() + 30_000), channelId: COUNTDOWN_NOTIFICATION_CHANNEL });
	expect(scheduled[0].content.data).toMatchObject({ type: "countdown", phase: "halfway", timerId: "timer-a" });
	expect(JSON.stringify(scheduled)).not.toContain("private-test-user");
	expect(JSON.parse(AsyncStorage.__data.get(COUNTDOWN_NOTIFICATION_STORAGE_KEY)).scheduled.map((item) => item.id)).toEqual(result.ids);
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test("repeated sync preserves the same schedule instead of resetting deadlines", async () => {
	const scheduler = createCountdownNotificationScheduler(); const args = input();
	const initial = await scheduler.sync(args);
	jest.setSystemTime(Date.now() + 5000);
	const next = await scheduler.sync(args);
	expect(next.ids).toEqual(initial.ids);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
	expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

test("granting exact alarms rebuilds the original deadlines instead of retaining inexact requests", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const args = input({ exactAlarmsAllowed: false });
	const originalTimes = [Date.now() + 30_000, Date.now() + 60_000];
	await scheduler.sync(args);
	jest.setSystemTime(Date.now() + 5000);
	await scheduler.sync({ ...args, exactAlarmsAllowed: true });
	expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(4);
	expect([...requests.values()].map((item) => Number(item.trigger.date))).toEqual(originalTimes);
});

test("pausing cancels timer notifications only; resume schedules from the remaining timer clock", async () => {
	requests.set("chat-1", { identifier: "chat-1", content: { data: { type: "chat" } } });
	const scheduler = createCountdownNotificationScheduler();
	await scheduler.sync(input());
	await scheduler.sync(input({ session: session({ running: false, accumulatedSeconds: 20 }) }));
	expect([...requests.keys()]).toEqual(["chat-1"]);
	jest.setSystemTime(Date.now() + 120_000);
	await scheduler.sync(input({ session: session({ accumulatedSeconds: 20 }) }));
	const timer = [...requests.values()].filter((item) => item.content.data.type === "countdown");
	expect(timer.map((item) => Number(item.trigger.date))).toEqual([Date.now() + 10_000, Date.now() + 40_000]);
});

test("a different owner and restarted countdown remove every prior timer request", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const old = await scheduler.sync(input());
	const next = await scheduler.sync(input({ ownerKey: "user:b", session: session({ countdownId: "timer-b" }) }));
	expect(next.ids).toHaveLength(2);
	for (const id of old.ids) expect(requests.has(id)).toBe(false);
	for (const request of requests.values()) expect(request.content.data.timerId).toBe("timer-b");
});

test("restored app reuses persisted IDs and explicit cancellation removes them", async () => {
	const args = input();
	const first = await createCountdownNotificationScheduler().sync(args);
	const restored = createCountdownNotificationScheduler();
	const next = await restored.sync(args);
	expect(next.ids).toEqual(first.ids);
	await restored.cancel();
	expect(requests.size).toBe(0);
	expect(AsyncStorage.__data.has(COUNTDOWN_NOTIFICATION_STORAGE_KEY)).toBe(false);
});

test("native enumeration cleans timer orphans even if local metadata is missing", async () => {
	await createCountdownNotificationScheduler().sync(input());
	AsyncStorage.__data.clear();
	requests.set("ordinary", { identifier: "ordinary", content: { data: { type: "countdown" } } });
	await createCountdownNotificationScheduler().cancel();
	expect([...requests.keys()]).toEqual(["ordinary"]);
});

test("natural completion preserves the just-due completion but cancels the old halfway alert", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const scheduled = await scheduler.sync(input());
	jest.setSystemTime(Date.now() + 60_000);
	await scheduler.sync({ session: null, preserveDue: true });
	expect([...requests.keys()]).toEqual([scheduled.ids[1]]);
	await scheduler.cancel();
	expect(requests.size).toBe(0);
});

test("reconciling the expired running clock never cancels its due completion", async () => {
	const scheduler = createCountdownNotificationScheduler(); const args = input();
	const scheduled = await scheduler.sync(args);
	jest.setSystemTime(Date.now() + 60_000);
	await scheduler.sync(args);
	expect([...requests.keys()]).toEqual([scheduled.ids[1]]);
});

test("restoring long after completion cancels all overdue native alarms instead of keeping a backlog", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const args = input();
	await scheduler.sync(args);
	jest.setSystemTime(Date.now() + 90_000);
	await scheduler.sync(args);
	expect(requests.size).toBe(0);
});

test("foreground pruning removes only expired cues and preserves the current deadline", async () => {
	const scheduler = createCountdownNotificationScheduler();
	const scheduled = await scheduler.sync(input());
	jest.setSystemTime(Date.now() + 35_000);
	await scheduler.pruneExpired();
	expect([...requests.keys()]).toEqual([scheduled.ids[1]]);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
	jest.setSystemTime(Date.now() + 25_000);
	await scheduler.pruneExpired();
	expect([...requests.keys()]).toEqual([scheduled.ids[1]]);
	jest.setSystemTime(Date.now() + 2001);
	await scheduler.pruneExpired();
	expect(requests.size).toBe(0);
});

test("request permission only when explicitly authorized and after channel setup", async () => {
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
	const scheduler = createCountdownNotificationScheduler();
	expect((await scheduler.sync(input())).status).toBe("denied");
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
	expect((await scheduler.sync(input({ requestPermission: true }))).status).toBe("scheduled");
	expect(Notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(Notifications.requestPermissionsAsync.mock.invocationCallOrder[0]);
});

test("denied non-repeatable permission does not prompt or schedule", async () => {
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
	expect((await createCountdownNotificationScheduler().sync(input({ requestPermission: true }))).status).toBe("denied");
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
	expect(requests.size).toBe(0);
});

test("permission delay does not move the deadline or add an outdated halfway reminder", async () => {
	const pending = defer();
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
	Notifications.requestPermissionsAsync.mockReturnValue(pending.promise);
	const initial = Date.now();
	const result = createCountdownNotificationScheduler().sync(input({ requestPermission: true }));
	await flush(); jest.setSystemTime(initial + 40_000);
	pending.resolve({ status: "granted" });
	await result;
	expect([...requests.values()].map((item) => Number(item.trigger.date))).toEqual([initial + 60_000]);
});

test("cancel while native scheduling is pending removes its late-created notification", async () => {
	const pending = defer();
	Notifications.scheduleNotificationAsync.mockImplementationOnce(async (request) => {
		await pending.promise; requests.set(request.identifier, request); return request.identifier;
	});
	const scheduler = createCountdownNotificationScheduler();
	const result = scheduler.sync(input());
	await flush(); expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
	const cancelled = scheduler.cancel(); pending.resolve();
	expect((await result).status).toBe("cancelled");
	await cancelled;
	expect(requests.size).toBe(0);
});

test("same pending request is deduplicated while rapid restart cancels its stale continuation", async () => {
	const pending = defer();
	Notifications.getPermissionsAsync.mockReturnValueOnce(pending.promise);
	const scheduler = createCountdownNotificationScheduler(); const args = input();
	const old = scheduler.sync(args);
	expect(scheduler.sync(args)).toBe(old);
	await flush();
	const next = scheduler.sync(input({ session: session({ countdownId: "replacement" }) }));
	pending.resolve({ status: "granted" });
	expect((await old).status).toBe("cancelled");
	expect((await next).status).toBe("scheduled");
	for (const item of requests.values()) expect(item.content.data.timerId).toBe("replacement");
});

test("English iOS content uses date triggers without Android channels and accepts provisional permissions", async () => {
	Platform.OS = "ios";
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", ios: { status: 3 } });
	await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	const items = [...requests.values()];
	expect(items[0].content.body).toBe("The countdown is halfway complete.");
	expect(items[1].content.body).toBe("The countdown has finished.");
	expect(items[0].trigger).not.toHaveProperty("channelId");
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
});

test("starting explicitly with provisional iOS permission requests audible authorization", async () => {
	Platform.OS = "ios";
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted", ios: { status: 3, allowsSound: false } });
	Notifications.requestPermissionsAsync.mockResolvedValue({ status: "granted", ios: { status: 2, allowsSound: true } });
	const result = await createCountdownNotificationScheduler().sync(input({ requestPermission: true }));
	expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
	expect(result).toMatchObject({ status: "scheduled", soundEnabled: true });
});

test("sound-disabled iOS permission is reported separately from successful scheduling", async () => {
	Platform.OS = "ios";
	Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted", ios: { status: 2, allowsSound: false } });
	const result = await createCountdownNotificationScheduler().sync(input({ requestPermission: true }));
	expect(result).toMatchObject({ status: "scheduled", soundEnabled: false });
	expect(result.ids).toHaveLength(2);
	expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test("optional pre-bundled speech sounds use separate Android channels for each phase", async () => {
	await createCountdownNotificationScheduler({ sounds: { en: { halfway: "halfway-en.wav", complete: "complete-en.wav" } } }).sync(input({ locale: "en" }));
	const items = [...requests.values()];
	expect(items.map((item) => item.content.sound)).toEqual(["halfway-en.wav", "complete-en.wav"]);
	expect(items[0].trigger.channelId).not.toBe(items[1].trigger.channelId);
});

test.each([null, undefined, "", "1.1.2", "1.0.20", "0.9.9", "1.1.3-preview", "v1.1.3", "01.1.3", "garbage", "9007199254740992.1.3"])("an old or unknown installed runtime cannot reference unbundled speech files (%s)", (version) => {
	expect(countdownNotificationSoundsForRuntime(version)).toEqual({});
});

test.each(["1.1.3", "1.1.4", "1.1.5"])("installed runtime %s only references its existing English reminder voices", (version) => {
	expect(countdownNotificationSoundsForRuntime(version)).toEqual({ en: COUNTDOWN_NOTIFICATION_SOUNDS.en });
});

test.each(["1.1.6", "1.2.0", "2.0.0"])("installed runtime %s can use bundled Cantonese and English speech", (version) => {
	expect(countdownNotificationSoundsForRuntime(version)).toEqual(COUNTDOWN_NOTIFICATION_SOUNDS);
});

test.each(["android", "ios"])("runtime 1.1.6 uses real Cantonese notification speech on %s", async (platform) => {
	Platform.OS = platform;
	Updates.runtimeVersion = "1.1.6";
	await createCountdownNotificationScheduler().sync(input({ locale: "zh" }));
	expect([...requests.values()].map((item) => item.content.sound)).toEqual(["countdown_yue_halfway.wav", "countdown_yue_complete.wav"]);
});

test.each(["android", "ios"])("the new %s native runtime schedules the actual bundled English voice files by default", async (platform) => {
	Platform.OS = platform;
	Updates.runtimeVersion = "1.1.3";
	await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	const items = [...requests.values()];
	expect(items.map((item) => item.content.sound)).toEqual(["countdown_en_halfway.wav", "countdown_en_complete.wav"]);
	if (platform === "android") {
		expect(items[0].trigger.channelId).not.toBe(items[1].trigger.channelId);
		expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(items[0].trigger.channelId,
			expect.objectContaining({ sound: "countdown_en_halfway.wav" }));
	}
});

test("the older native runtime uses a real system sound even when newer JS requests English reminders", async () => {
	Updates.runtimeVersion = "1.1.2";
	await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect([...requests.values()].map((item) => item.content.sound)).toEqual(["default", "default"]);
});

test("Chinese uses the system sound until a matching localized voice resource is bundled", async () => {
	Updates.runtimeVersion = "1.1.3";
	await createCountdownNotificationScheduler().sync(input({ locale: "zh" }));
	expect([...requests.values()].map((item) => item.content.sound)).toEqual(["default", "default"]);
});

test.each([
	{ importance: 0, sound: "default" },
	{ importance: 4, sound: null },
	{ importance: 2, sound: "default" },
])("a muted legacy Android channel is reused instead of bypassed with new voice channels (%j)", async (preferences) => {
	Updates.runtimeVersion = "1.1.3";
	Notifications.getNotificationChannelAsync.mockResolvedValue({ id: COUNTDOWN_NOTIFICATION_CHANNEL, ...preferences });
	const result = await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect(result).toMatchObject({ status: "scheduled", soundEnabled: false });
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	for (const item of requests.values()) {
		expect(item.trigger.channelId).toBe(COUNTDOWN_NOTIFICATION_CHANNEL);
		expect(item.content.sound).toBe(false);
	}
});

test.each([
	{ importance: 3, sound: "default" },
	{ importance: 4, sound: "custom" },
	{ importance: 4, sound: "default", enableVibrate: false },
	{ importance: 4, sound: "default", lockscreenVisibility: 0 },
	{ importance: 4, sound: "default", lockscreenVisibility: -1 },
])("migration preserves customized legacy Android reminder preferences (%j)", async (preferences) => {
	Updates.runtimeVersion = "1.1.3";
	Notifications.getNotificationChannelAsync.mockResolvedValue({ id: COUNTDOWN_NOTIFICATION_CHANNEL, ...preferences });
	const result = await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect(result.soundEnabled).toBe(true);
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	for (const item of requests.values()) expect(item.trigger.channelId).toBe(COUNTDOWN_NOTIFICATION_CHANNEL);
});

test.each([1, -1000])("an untouched default legacy channel can adopt bundled voices with lockscreen visibility %s", async (lockscreenVisibility) => {
	Updates.runtimeVersion = "1.1.3";
	Notifications.getNotificationChannelAsync.mockImplementation(async (id) => id === COUNTDOWN_NOTIFICATION_CHANNEL
		? { id, importance: 4, sound: "default", enableVibrate: true, lockscreenVisibility } : null);
	const result = await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect(result.soundEnabled).toBe(true);
	expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(2);
	for (const item of requests.values()) expect(item.trigger.channelId).not.toBe(COUNTDOWN_NOTIFICATION_CHANNEL);
});

test("an existing voice channel stays silent after the user disables its sound", async () => {
	Updates.runtimeVersion = "1.1.3";
	Notifications.getNotificationChannelAsync.mockImplementation(async (id) => ({
		id, importance: 4, sound: id === COUNTDOWN_NOTIFICATION_CHANNEL ? "default" : null,
	}));
	const result = await createCountdownNotificationScheduler().sync(input({ locale: "en" }));
	expect(result.soundEnabled).toBe(false);
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	for (const item of requests.values()) expect(item.content.sound).toBe(false);
});

test("silencing the legacy channel replaces already-scheduled voice requests without changing deadlines", async () => {
	Updates.runtimeVersion = "1.1.3";
	let legacy = { importance: 4, sound: "default" };
	Notifications.getNotificationChannelAsync.mockImplementation(async (id) => id === COUNTDOWN_NOTIFICATION_CHANNEL ? legacy : null);
	const scheduler = createCountdownNotificationScheduler();
	const args = input({ locale: "en" });
	await scheduler.sync(args);
	const originalTimes = [...requests.values()].map((item) => Number(item.trigger.date));
	legacy = { importance: 0, sound: null };
	jest.setSystemTime(Date.now() + 5000);
	const result = await scheduler.sync(args);
	expect(result.soundEnabled).toBe(false);
	expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
	expect([...requests.values()].map((item) => Number(item.trigger.date))).toEqual(originalTimes);
	for (const item of requests.values()) expect(item.trigger.channelId).toBe(COUNTDOWN_NOTIFICATION_CHANNEL);
});

test("an unavailable channel lookup never creates a new high-importance channel", async () => {
	Updates.runtimeVersion = "1.1.3";
	Notifications.getNotificationChannelAsync.mockRejectedValue(new Error("Unable to read system settings"));
	expect((await createCountdownNotificationScheduler().sync(input({ locale: "en" }))).status).toBe("failed");
	expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("older notification environments without channel lookup remain compatible", async () => {
	const lookup = Notifications.getNotificationChannelAsync;
	Notifications.getNotificationChannelAsync = undefined;
	try {
		expect((await createCountdownNotificationScheduler().sync(input())).status).toBe("scheduled");
	} finally {
		Notifications.getNotificationChannelAsync = lookup;
	}
});

test("an installed sound change replaces an older default-sound schedule for the same clock", async () => {
	const args = input({ locale: "en" });
	await createCountdownNotificationScheduler().sync(args);
	await createCountdownNotificationScheduler({ sounds: { en: { halfway: "halfway-en.wav", complete: "complete-en.wav" } } }).sync(args);
	expect([...requests.values()].map((item) => item.content.sound)).toEqual(["halfway-en.wav", "complete-en.wav"]);
	expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
});

test("notification API errors never reject timer operations and failed scheduling IDs remain recoverable", async () => {
	Notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error("OS scheduler unavailable"));
	const scheduler = createCountdownNotificationScheduler();
	expect((await scheduler.sync(input())).status).toBe("failed");
	expect(JSON.parse(AsyncStorage.__data.get(COUNTDOWN_NOTIFICATION_STORAGE_KEY)).scheduled).toHaveLength(1);
	await scheduler.cancel();
	expect(AsyncStorage.__data.has(COUNTDOWN_NOTIFICATION_STORAGE_KEY)).toBe(false);
});

test("failed cancellation prevents new overlapping alerts and retains recoverable IDs", async () => {
	const scheduler = createCountdownNotificationScheduler();
	await scheduler.sync(input());
	Notifications.cancelScheduledNotificationAsync.mockRejectedValue(new Error("OS unavailable"));
	expect((await scheduler.sync(input({ ownerKey: "user:b" }))).status).toBe("failed");
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
	expect(JSON.parse(AsyncStorage.__data.get(COUNTDOWN_NOTIFICATION_STORAGE_KEY)).scheduled).toHaveLength(2);
});

test("web never requests native permissions or notifications", async () => {
	Platform.OS = "web";
	const scheduler = createCountdownNotificationScheduler();
	expect((await scheduler.sync(input({ requestPermission: true }))).status).toBe("unsupported");
	expect((await scheduler.cancel()).status).toBe("unsupported");
	expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
