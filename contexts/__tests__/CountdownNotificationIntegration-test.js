import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthContext } from "../AuthContext";
import { LocaleContext } from "../LocaleContext";
import { ActiveSessionProvider, useActiveSession } from "../ActiveSessionContext";
import { showAlert } from "../../utils/alert";
import { checkReminderSettingsAsync, openExactAlarmSettingsAsync, openNotificationSettingsAsync } from "../../modules/session-timer-notification";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockSync = jest.fn();
const mockCancel = jest.fn();
const mockSpeak = jest.fn();
const mockStatusSync = jest.fn();
const mockStatusClear = jest.fn();
const mockPrune = jest.fn(async () => ({ status: 'inactive' }));
jest.mock('../../modules/session-timer-notification', () => ({
	checkReminderSettingsAsync: jest.fn(async () => ({ status: 'unavailable' })),
	openExactAlarmSettingsAsync: jest.fn(async () => ({ status: 'opened' })),
	openNotificationSettingsAsync: jest.fn(async () => ({ status: 'opened' })),
}));
jest.mock("../../utils/sessionTimerNotifications", () => ({
	createSessionTimerNotificationManager: () => ({ sync: mockStatusSync, clear: mockStatusClear }),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("../../utils/countdownNotifications", () => ({
	createCountdownNotificationScheduler: () => ({ sync: mockSync, cancel: mockCancel, pruneExpired: mockPrune }),
}));
jest.mock("../../utils/countdownSpeech", () => ({
	createCountdownSpeaker: () => ({ speak: mockSpeak, cancel: jest.fn() }),
}));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => {
	const data = new Map();
	return { __esModule: true, default: {
		getItem: jest.fn(async (key) => data.get(key) ?? null),
		setItem: jest.fn(async (key, value) => { data.set(key, value); }),
		removeItem: jest.fn(async (key) => { data.delete(key); }), __data: data,
	} };
});

const STORAGE_KEY = "@outdoor_fit_active_session_v1";
const CLOCK_START = Date.parse("2026-09-08T01:00:00Z");
let active;
let tree;
let onAppState;
function Probe() { active = useActiveSession(); return null; }
function app({ userId = "notification-a", locale = "zh", isLoading = false } = {}) {
	return <LocaleContext.Provider value={{ locale }}>
		<AuthContext.Provider value={{ user: userId ? { id: userId } : null, isLoading }}>
			<ActiveSessionProvider><Probe /></ActiveSessionProvider>
		</AuthContext.Provider>
	</LocaleContext.Provider>;
}
async function mount(options) { await act(async () => { tree = renderer.create(app(options)); }); }
async function start(seconds = 60) {
	await act(async () => active.chooseMode("outdoor", "countdown", seconds));
	await act(async () => active.startCountdown(seconds));
}
async function advance(seconds) { await act(async () => jest.advanceTimersByTime(seconds * 1000)); }
const latestInput = () => mockSync.mock.calls.at(-1)?.[0];
const runningInputs = () => mockSync.mock.calls.map(([input]) => input).filter((input) => input.session.recordMode === "countdown" && input.session.running);
const latestStatus = () => mockStatusSync.mock.calls.at(-1)?.[0];
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test("countup starts a notification with a persisted identity without requesting permission", async () => {
	await mount();
	await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning());
	expect(latestStatus()).toEqual(expect.objectContaining({ requestPermission: false, ownerKey: "user:notification-a",
		session: expect.objectContaining({ recordMode: "countup", running: true, started: true, timerId: expect.any(String) }) }));
	expect(JSON.parse(AsyncStorage.__data.get(STORAGE_KEY)).session.timerId).toBe(active.timerId);
});

test("a pending old countdown cleanup cannot block a new countup notification", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countup"));
	const delayed = deferred(); mockSync.mockReturnValueOnce(delayed.promise);
	await act(async () => active.toggleRunning());
	expect(latestStatus()).toMatchObject({ session: { recordMode: "countup", running: true }, requestPermission: false });
	await act(async () => delayed.resolve({ status: "inactive" }));
});

test("countdown status shares the clock identity without requesting a second permission dialog", async () => {
	await mount(); await start();
	expect(active.timerId).toBe(active.countdownId);
	expect(latestStatus()).toEqual(expect.objectContaining({ requestPermission: false,
		session: expect.objectContaining({ timerId: active.countdownId, recordMode: "countdown" }) }));
});

test("pause keeps a static countup notification, resume keeps identity and excludes paused time", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning());
	const id = active.timerId;
	await advance(12); await act(async () => active.toggleRunning());
	expect(latestStatus().session).toEqual(expect.objectContaining({ timerId: id, running: false, accumulatedSeconds: 12 }));
	expect(latestStatus().requestPermission).toBe(false);
	await advance(20); await act(async () => active.toggleRunning());
	expect(latestStatus().session).toEqual(expect.objectContaining({ timerId: id, running: true, startedAt: CLOCK_START + 32_000, accumulatedSeconds: 12 }));
});

test("ordinary ticks do not publish repeated timer status notifications", async () => {
	await mount(); await start();
	const calls = mockStatusSync.mock.calls.length;
	await advance(10);
	expect(mockStatusSync).toHaveBeenCalledTimes(calls);
});

test("status refreshes on foreground return without rescheduling milestone alarms", async () => {
	await mount(); await start();
	const alarms = mockSync.mock.calls.length;
	const statuses = mockStatusSync.mock.calls.length;
	await act(async () => onAppState("background"));
	await act(async () => onAppState("active"));
	expect(mockSync).toHaveBeenCalledTimes(alarms);
	expect(mockStatusSync.mock.calls.length).toBeGreaterThan(statuses);
});

test("finish and discard clear status notifications and new countup cannot reuse old notice identity", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning());
	const id = active.timerId;
	await advance(5); await act(async () => active.finishSession());
	expect(active.pendingSummary.timerId).toBe(id);
	expect(mockStatusClear).toHaveBeenCalled();
	await act(async () => active.resetSession());
	await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning());
	expect(active.timerId).not.toBe(id);
});

test("old persisted countup gets a notification identity without losing elapsed time", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:notification-a", session: {
		mode: "outdoor", recordMode: "countup", started: true, running: true, startedAt: CLOCK_START - 10_000, accumulatedSeconds: 20,
	} }));
	await mount();
	expect(active.timerId).toBeTruthy(); expect(active.elapsedSeconds).toBe(30);
	expect(latestStatus().requestPermission).toBe(false);
});

test("late countdown scheduling result after discard cannot recreate its status notice", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countdown", 60));
	const delayed = deferred(); mockSync.mockReturnValueOnce(delayed.promise);
	await act(async () => active.startCountdown(60));
	const id = active.timerId;
	await act(async () => active.resetSession());
	await act(async () => delayed.resolve({ status: "scheduled" }));
	expect(mockStatusSync.mock.calls.some(([input]) => input.session.timerId === id)).toBe(false);
});

test("denied countdown scheduling does not create popups after an AppState cycle", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countdown", 60));
	const delayed = deferred(); mockSync.mockReturnValueOnce(delayed.promise);
	mockStatusSync.mockResolvedValue({ status: "denied" });
	await act(async () => active.startCountdown(60));
	await act(async () => onAppState("inactive"));
	await act(async () => delayed.resolve({ status: "denied" }));
	expect(showAlert).not.toHaveBeenCalled();
	await act(async () => onAppState("active"));
	expect(showAlert).not.toHaveBeenCalled();
	await act(async () => onAppState("background")); await act(async () => onAppState("active"));
	expect(showAlert).not.toHaveBeenCalled();
	expect(active.running).toBe(true);
	expect(mockSync.mock.calls.every(([input]) => input.requestPermission === false)).toBe(true);
});

test("countup notification denial during inactive state never triggers permission or help popups", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countup"));
	const delayed = deferred(); mockStatusSync.mockReturnValueOnce(delayed.promise);
	await act(async () => active.toggleRunning());
	await act(async () => onAppState("inactive"));
	mockStatusSync.mockResolvedValue({ status: "denied" });
	await act(async () => delayed.resolve({ status: "denied" }));
	await act(async () => onAppState("active"));
	expect(mockStatusSync.mock.calls.filter(([input]) => input.requestPermission)).toHaveLength(0);
	expect(showAlert).not.toHaveBeenCalled();
	expect(active.running).toBe(true);
});

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(CLOCK_START);
	jest.clearAllMocks();
	AsyncStorage.__data.clear();
	mockSync.mockReset().mockResolvedValue({ status: "scheduled", ids: ["halfway", "complete"] });
	mockCancel.mockReset().mockResolvedValue({ status: "inactive", ids: [] });
	mockSpeak.mockReset().mockResolvedValue("spoken");
	mockStatusSync.mockReset().mockResolvedValue({ status: "updated" });
	mockStatusClear.mockReset().mockResolvedValue({ status: "cleared" });
	checkReminderSettingsAsync.mockReset().mockResolvedValue({ status: 'unavailable' });
	openExactAlarmSettingsAsync.mockReset().mockResolvedValue({ status: 'opened' });
	openNotificationSettingsAsync.mockReset().mockResolvedValue({ status: 'opened' });
	AppState.currentState = "active";
	jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
		onAppState = callback;
		return { remove: jest.fn() };
	});
	jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
});
afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
	jest.restoreAllMocks();
	jest.useRealTimers();
});

test("starting a countdown immediately schedules against its real clock without requesting permission", async () => {
	await mount(); await start(60);
	expect(runningInputs()).toHaveLength(1);
	expect(latestInput()).toEqual(expect.objectContaining({
		ownerKey: "user:notification-a", locale: "zh", requestPermission: false, preserveDue: false,
		session: expect.objectContaining({ recordMode: "countdown", started: true, running: true,
			startedAt: CLOCK_START, accumulatedSeconds: 0, targetDurationSec: 60, countdownId: expect.any(String) }),
	}));
	expect(active.countdownId).toBeTruthy();
	expect(JSON.parse(AsyncStorage.__data.get(STORAGE_KEY)).session.countdownId).toBe(active.countdownId);
});

test("per-second ticks, halfway voice consumption and background transitions do not reschedule alarms", async () => {
	await mount(); await start();
	const scheduledCalls = mockSync.mock.calls.length;
	await advance(29); await advance(1);
	expect(active.countdownHalfwayAnnounced).toBe(true);
	await advance(5);
	await act(async () => onAppState("background"));
	await act(async () => onAppState("active"));
	expect(mockSync).toHaveBeenCalledTimes(scheduledCalls);
	expect(runningInputs()).toHaveLength(1);
});

test("pausing makes the plan inactive and resuming reschedules the same timer with its remaining duration", async () => {
	await mount(); await start();
	const timerId = active.countdownId;
	await advance(20); await act(async () => active.toggleRunning());
	expect(latestInput().session).toEqual(expect.objectContaining({ running: false, startedAt: null, accumulatedSeconds: 20, countdownId: timerId }));
	const pausedCalls = mockSync.mock.calls.length;
	await advance(120); expect(mockSync).toHaveBeenCalledTimes(pausedCalls);
	await act(async () => active.toggleRunning());
	expect(latestInput()).toEqual(expect.objectContaining({ requestPermission: false,
		session: expect.objectContaining({ running: true, startedAt: CLOCK_START + 140_000, accumulatedSeconds: 20,
			targetDurationSec: 60, countdownId: timerId }) }));
	expect(active.seconds).toBe(40);
	expect(runningInputs()).toHaveLength(2);
});

test("discard cancels scheduled alarms and a new countdown has a different timer identity", async () => {
	await mount(); await start();
	const timerId = active.countdownId;
	mockCancel.mockClear();
	await act(async () => active.resetSession());
	expect(mockCancel).toHaveBeenCalled();
	expect(latestInput().session.running).toBe(false);
	expect(latestInput().preserveDue).toBe(false);
	await start(); expect(active.countdownId).not.toBe(timerId);
});

test("switching accounts cancels old alarms and does not carry the old timer or summary forward", async () => {
	await mount(); await start();
	const timerId = active.countdownId;
	mockCancel.mockClear();
	await act(async () => tree.update(app({ userId: "notification-b" })));
	expect(mockCancel).toHaveBeenCalled();
	expect(active.countdownId).not.toBe(timerId);
	expect(active.started).toBe(false);
	expect(active.pendingSummary).toBeNull();
	expect(latestInput()).toEqual(expect.objectContaining({ ownerKey: "user:notification-b", preserveDue: false }));
});

test("natural completion preserves due reminders and records the deadline instead of the later wake time", async () => {
	await mount(); await start();
	const timerId = active.countdownId;
	mockCancel.mockClear();
	await act(async () => onAppState("background"));
	jest.setSystemTime(CLOCK_START + 180_000);
	await act(async () => onAppState("active"));
	expect(active).toMatchObject({ countdownId: timerId, recordMode: "countdown", completed: true, pendingSummary: null,
		elapsedSeconds: 60, seconds: 0, completedAt: new Date(CLOCK_START + 60_000).toISOString() });
	expect(latestInput()).toEqual(expect.objectContaining({ preserveDue: true, session: expect.objectContaining({ running: false }) }));
	expect(mockCancel).not.toHaveBeenCalled();
	const callsAfterCompletion = mockSync.mock.calls.length;
	await advance(10);
	expect(mockSync).toHaveBeenCalledTimes(callsAfterCompletion);
});

test("a paused and resumed timer uses the adjusted deadline when unlocked late", async () => {
	await mount(); await start(); await advance(20);
	await act(async () => active.toggleRunning()); await advance(120);
	await act(async () => active.toggleRunning());
	await act(async () => onAppState("background"));
	jest.setSystemTime(CLOCK_START + 300_000);
	await act(async () => onAppState("active"));
	expect(active.completedAt).toBe(new Date(CLOCK_START + 180_000).toISOString());
	expect(active.elapsedSeconds).toBe(60);
	expect(active.pendingSummary).toBeNull();
});

test("resetting a completed clock cancels its reminders and disables due preservation", async () => {
	await mount(); await start(); await advance(60);
	expect(latestInput().preserveDue).toBe(true);
	mockCancel.mockClear();
	await act(async () => active.resetSession());
	expect(mockCancel).toHaveBeenCalled();
	expect(latestInput().preserveDue).toBe(false);
});

test("finishing early cancels alarms without preserving a future completion notification", async () => {
	await mount(); await start(); await advance(10);
	mockCancel.mockClear();
	await act(async () => active.finishSession());
	expect(mockCancel).toHaveBeenCalled();
	expect(active.pendingSummary).toBeNull();
	expect(active.countdownCompletionVoicePending).toBe(false);
	expect(latestInput().preserveDue).toBe(false);
});

test("restoring a running countdown keeps its saved identity and does not prompt for permission", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:notification-a", session: {
		mode: "outdoor", recordMode: "countdown", started: true, running: true, startedAt: CLOCK_START - 10_000,
		accumulatedSeconds: 0, targetDurationSec: 60, countdownId: "saved-countdown", countdownHalfwayAnnounced: false,
	} }));
	await mount();
	expect(active.countdownId).toBe("saved-countdown");
	expect(runningInputs()).toHaveLength(1);
	expect(latestInput()).toEqual(expect.objectContaining({ requestPermission: false,
		session: expect.objectContaining({ countdownId: "saved-countdown", startedAt: CLOCK_START - 10_000 }) }));
	expect(mockCancel).not.toHaveBeenCalled();
});

test("authentication hydration completes before the scheduler can remove or schedule reminders", async () => {
	await mount({ isLoading: true });
	expect(mockSync).not.toHaveBeenCalled();
	expect(mockCancel).not.toHaveBeenCalled();
	await act(async () => tree.update(app({ isLoading: false })));
	expect(mockSync).toHaveBeenCalled();
});

test("countup and manual records never send an active countdown plan", async () => {
	await mount();
	await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning()); await advance(120);
	await act(async () => active.finishSession());
	await act(async () => active.chooseMode("home", "manual"));
	expect(runningInputs()).toEqual([]);
});

test("changing language reschedules once with the same timer identity and the new language", async () => {
	await mount(); await start();
	const timerId = active.countdownId;
	const callsBefore = mockSync.mock.calls.length;
	await act(async () => tree.update(app({ locale: "en" })));
	expect(mockSync).toHaveBeenCalledTimes(callsBefore + 1);
	expect(latestInput()).toEqual(expect.objectContaining({ locale: "en", requestPermission: false,
		session: expect.objectContaining({ countdownId: timerId }) }));
});

test("permission denial leaves the timer running without opening or offering settings", async () => {
	await mount();
	mockSync.mockImplementation(async (input) => ({ status: input.session.running ? "denied" : "inactive" }));
	await start();
	expect(active.running).toBe(true);
	expect(showAlert).not.toHaveBeenCalled();
	expect(Linking.openSettings).not.toHaveBeenCalled();
	await advance(60); expect(active).toMatchObject({ elapsedSeconds: 60, completed: true, pendingSummary: null });
});

test("late scheduling results after discard do not show a stale warning", async () => {
	const scheduling = deferred();
	await mount();
	mockSync.mockImplementation((input) => input.session.running ? scheduling.promise : Promise.resolve({ status: "inactive" }));
	await start();
	await act(async () => active.resetSession());
	await act(async () => scheduling.resolve({ status: "denied" }));
	expect(showAlert).not.toHaveBeenCalled();
	expect(active.running).toBe(false);
});

test('exact reminder settings are only observed and a manual settings change updates scheduling precision', async () => {
	checkReminderSettingsAsync.mockResolvedValue({ status: 'available', exactAlarmsAllowed: false });
	await mount(); await start();
	const first = latestInput();
	expect(first.exactAlarmsAllowed).toBe(false);
	expect(showAlert).not.toHaveBeenCalled();
	expect(openExactAlarmSettingsAsync).not.toHaveBeenCalled();
	await act(async () => onAppState('background'));
	checkReminderSettingsAsync.mockResolvedValue({ status: 'available', exactAlarmsAllowed: true });
	await act(async () => onAppState('active'));
	expect(latestInput()).toMatchObject({ exactAlarmsAllowed: true, session: first.session });
	expect(mockPrune).toHaveBeenCalledTimes(1);
	expect(active.running).toBe(true);
	expect(showAlert).not.toHaveBeenCalled();
	expect(openExactAlarmSettingsAsync).not.toHaveBeenCalled();
});

test('lock-screen restriction is respected without opening settings or interrupting the timer', async () => {
	mockStatusSync.mockResolvedValue({ status: 'updated', lockscreenRestricted: true, lockscreenReason: 'channel_silent' });
	await mount(); await start();
	expect(showAlert).not.toHaveBeenCalled();
	expect(openNotificationSettingsAsync).not.toHaveBeenCalled();
	expect(openExactAlarmSettingsAsync).not.toHaveBeenCalled();
	await advance(60);
	expect(active).toMatchObject({ elapsedSeconds: 60, completed: true, pendingSummary: null });
});

test('sound disabled does not produce repeated help or block pure countdown completion', async () => {
	mockSync.mockResolvedValue({ status: 'scheduled', soundEnabled: false });
	await mount(); await start();
	expect(showAlert).not.toHaveBeenCalled();
	await advance(60);
	expect(active).toMatchObject({ elapsedSeconds: 60, completed: true, pendingSummary: null });
});

test('a late settings lookup cannot schedule reminders or display advice for a discarded timer', async () => {
	await mount(); await act(async () => active.chooseMode('outdoor', 'countdown', 60));
	const settings = deferred(); checkReminderSettingsAsync.mockReturnValueOnce(settings.promise);
	await act(async () => active.startCountdown(60));
	await act(async () => active.resetSession());
	const calls = mockSync.mock.calls.length;
	await act(async () => settings.resolve({ status: 'available', exactAlarmsAllowed: false }));
	expect(mockSync).toHaveBeenCalledTimes(calls);
	expect(active.running).toBe(false);
	expect(showAlert).not.toHaveBeenCalled();
	expect(openExactAlarmSettingsAsync).not.toHaveBeenCalled();
});

test('notification permission granted in settings retries the previously denied reminder plan', async () => {
	mockSync.mockImplementation(async (input) => ({ status: input.session.running ? 'denied' : 'inactive' }));
	await mount(); await start();
	const calls = mockSync.mock.calls.length;
	await act(async () => onAppState('background'));
	mockSync.mockResolvedValue({ status: 'scheduled' });
	await act(async () => onAppState('active'));
	expect(mockSync.mock.calls.length).toBeGreaterThan(calls);
	expect(latestInput().session.running).toBe(true);
	expect(showAlert).not.toHaveBeenCalled();
});

test('backgrounding during settings lookup retains the actual clock without requesting permission on return', async () => {
	await mount(); await act(async () => active.chooseMode('outdoor', 'countdown', 60));
	const pending = deferred(); checkReminderSettingsAsync.mockReturnValueOnce(pending.promise);
	await act(async () => active.startCountdown(60));
	await act(async () => onAppState('background'));
	await act(async () => pending.resolve({ status: 'unavailable' }));
	expect(runningInputs().every((input) => input.requestPermission === false)).toBe(true);
	await act(async () => onAppState('active'));
	expect(latestInput()).toMatchObject({ requestPermission: false,
		session: { startedAt: CLOCK_START, targetDurationSec: 60, running: true } });
	expect(showAlert).not.toHaveBeenCalled();
});

test.each(['countdown', 'countup'])('repeated %s starts and resumes never request permission or display settings advice', async (mode) => {
	checkReminderSettingsAsync.mockResolvedValue({ status: 'available', exactAlarmsAllowed: false });
	mockStatusSync.mockResolvedValue({ status: 'denied', lockscreenRestricted: true });
	mockSync.mockResolvedValue({ status: 'denied', soundEnabled: false });
	await mount();
	for (let round = 0; round < 3; round += 1) {
		await act(async () => active.chooseMode('outdoor', mode, 60));
		await act(async () => mode === 'countdown' ? active.startCountdown(60) : active.toggleRunning());
		await advance(1); await act(async () => active.toggleRunning());
		await act(async () => active.toggleRunning());
		expect(active.running).toBe(true);
		await act(async () => active.resetSession());
	}
	expect(mockSync.mock.calls.every(([input]) => input.requestPermission === false)).toBe(true);
	expect(mockStatusSync.mock.calls.every(([input]) => input.requestPermission === false)).toBe(true);
	expect(showAlert).not.toHaveBeenCalled();
	expect(Linking.openSettings).not.toHaveBeenCalled();
	expect(openExactAlarmSettingsAsync).not.toHaveBeenCalled();
	expect(openNotificationSettingsAsync).not.toHaveBeenCalled();
});
