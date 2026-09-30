import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthContext } from "../AuthContext";
import { LocaleContext } from "../LocaleContext";
import { ActiveSessionProvider, useActiveSession } from "../ActiveSessionContext";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockAndroidIntegrationSync = jest.fn();
const mockAndroidIntegrationClear = jest.fn();
const mockAndroidIntegrationLegacySync = jest.fn();
const mockAndroidIntegrationLegacyCancel = jest.fn();
const mockAndroidIntegrationStatusSync = jest.fn();
const mockAndroidIntegrationStatusClear = jest.fn();
const mockAndroidIntegrationSpeak = jest.fn();
const mockAndroidIntegrationCancelSpeech = jest.fn();

jest.mock("../AuthContext", () => ({ AuthContext: require("react").createContext(null) }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("../../modules/session-timer-notification", () => ({
	isTimerAudioServiceAvailable: () => true,
	checkReminderSettingsAsync: jest.fn(async () => ({ status: "unavailable" })),
	openExactAlarmSettingsAsync: jest.fn(async () => ({ status: "unavailable" })),
	openNotificationSettingsAsync: jest.fn(async () => ({ status: "opened" })),
}));
jest.mock("../../utils/androidTimerAudio", () => ({
	createAndroidTimerAudioManager: () => ({ sync: mockAndroidIntegrationSync, clear: mockAndroidIntegrationClear }),
}));
jest.mock("../../utils/countdownNotifications", () => ({
	createCountdownNotificationScheduler: () => ({ sync: mockAndroidIntegrationLegacySync, cancel: mockAndroidIntegrationLegacyCancel }),
}));
jest.mock("../../utils/sessionTimerNotifications", () => ({
	createSessionTimerNotificationManager: () => ({ sync: mockAndroidIntegrationStatusSync, clear: mockAndroidIntegrationStatusClear }),
}));
jest.mock("../../utils/countdownSpeech", () => ({
	createCountdownSpeaker: () => ({ speak: mockAndroidIntegrationSpeak, cancel: mockAndroidIntegrationCancelSpeech }),
}));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => {
	const mockAndroidIntegrationStorage = new Map();
	return { __esModule: true, default: {
		getItem: jest.fn(async (key) => mockAndroidIntegrationStorage.get(key) ?? null),
		setItem: jest.fn(async (key, value) => { mockAndroidIntegrationStorage.set(key, value); }),
		removeItem: jest.fn(async (key) => { mockAndroidIntegrationStorage.delete(key); }),
		__androidAudioData: mockAndroidIntegrationStorage,
	} };
});

const STORAGE_KEY = "@outdoor_fit_active_session_v1";
const CLOCK_START = Date.parse("2026-09-09T01:00:00Z");
let active;
let tree;
let onAppState;

function Probe() { active = useActiveSession(); return null; }
function app({ userId = "android-audio-a", locale = "zh" } = {}) {
	return <LocaleContext.Provider value={{ locale }}>
		<AuthContext.Provider value={{ user: userId ? { id: userId } : null, isLoading: false }}>
			<ActiveSessionProvider><Probe /></ActiveSessionProvider>
		</AuthContext.Provider>
	</LocaleContext.Provider>;
}
async function mount(options) { await act(async () => { tree = renderer.create(app(options)); }); }
async function startCountdown(seconds = 60) {
	await act(async () => active.chooseMode("outdoor", "countdown", seconds));
	await act(async () => active.startCountdown(seconds));
}
async function advance(seconds) { await act(async () => { jest.advanceTimersByTime(seconds * 1000); }); }
async function changeState(state) {
	await act(async () => { AppState.currentState = state; onAppState(state); });
}
function inputs() { return mockAndroidIntegrationSync.mock.calls.map(([input]) => input); }
function latestInput() { return inputs().at(-1); }
function spokenPhases() { return mockAndroidIntegrationSpeak.mock.calls.map(([phase]) => phase); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function restoreCountdown({ startedAt = CLOCK_START - 10_000, consumedHalfway = false } = {}) {
	AsyncStorage.__androidAudioData.set(STORAGE_KEY, JSON.stringify({
		version: 2, ownerKey: "user:android-audio-a", session: {
			mode: "outdoor", recordMode: "countdown", targetDurationSec: 60,
			started: true, running: true, startedAt, accumulatedSeconds: 0,
			countdownHalfwayAnnounced: consumedHalfway, countdownId: "saved-countdown", timerId: "saved-countdown",
		},
	}));
}

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(CLOCK_START);
	jest.clearAllMocks();
	AsyncStorage.__androidAudioData.clear();
	mockAndroidIntegrationSync.mockReset().mockImplementation(async ({ session }) => session.started
		? { status: "updated", audioOwned: true } : { status: "cleared", audioOwned: false });
	mockAndroidIntegrationClear.mockReset().mockResolvedValue({ status: "cleared", audioOwned: false });
	mockAndroidIntegrationLegacySync.mockReset().mockResolvedValue({ status: "scheduled" });
	mockAndroidIntegrationLegacyCancel.mockReset().mockResolvedValue({ status: "cleared" });
	mockAndroidIntegrationStatusSync.mockReset().mockResolvedValue({ status: "updated" });
	mockAndroidIntegrationStatusClear.mockReset().mockResolvedValue({ status: "cleared" });
	mockAndroidIntegrationSpeak.mockReset().mockResolvedValue("spoken");
	mockAndroidIntegrationCancelSpeech.mockReset();
	AppState.currentState = "active";
	jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
		onAppState = listener;
		return { remove: jest.fn() };
	});
});

afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
	jest.restoreAllMocks();
	jest.useRealTimers();
});

test("the Android service owns foreground cues without legacy scheduling or a second TTS voice", async () => {
	await mount(); await startCountdown();
	expect(latestInput()).toMatchObject({ ownerKey: "user:android-audio-a", locale: "zh", allowStart: true,
		session: { recordMode: "countdown", startedAt: CLOCK_START, targetDurationSec: 60, timerId: active.countdownId } });
	const syncs = mockAndroidIntegrationSync.mock.calls.length;
	await advance(30); await advance(29);
	expect(mockAndroidIntegrationSync).toHaveBeenCalledTimes(syncs);
	expect(mockAndroidIntegrationSpeak).not.toHaveBeenCalled();
	await advance(1);
	expect(active).toMatchObject({ completed: true, seconds: 0, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(mockAndroidIntegrationSpeak).not.toHaveBeenCalled();
	expect(mockAndroidIntegrationLegacySync).not.toHaveBeenCalled();
	expect(mockAndroidIntegrationStatusSync).not.toHaveBeenCalled();
});

test("natural completion preserves the just-due native cue and zero clock without creating a summary", async () => {
	await mount(); await startCountdown();
	const timerId = active.timerId;
	const clears = mockAndroidIntegrationClear.mock.calls.length;
	await advance(60);
	expect(latestInput()).toMatchObject({ allowStart: false, preserveDue: true, session: { completed: true, running: false } });
	expect(mockAndroidIntegrationClear).toHaveBeenCalledTimes(clears);
	expect(active).toMatchObject({ timerId, elapsedSeconds: 60, completedAt: new Date(CLOCK_START + 60_000).toISOString(), pendingSummary: null });
	const completedAt = active.completedAt;
	await advance(30);
	expect(active.completedAt).toBe(completedAt);
	expect(spokenPhases()).toEqual([]);
});

test("restoring an expired countdown never starts a service or replays expired speech", async () => {
	restoreCountdown({ startedAt: CLOCK_START - 120_000 });
	await mount();
	expect(active).toMatchObject({ completed: true, elapsedSeconds: 60, timerId: "saved-countdown", countdownCompletionVoicePending: false, pendingSummary: null });
	expect(inputs().every((input) => input.allowStart === false)).toBe(true);
	expect(latestInput().preserveDue).toBe(true);
	expect(spokenPhases()).toEqual([]);
	await changeState("background"); await changeState("active");
	expect(spokenPhases()).toEqual([]);
});

test("a suspended JS clock crossing both native milestones never replays audio on unlock", async () => {
	await mount(); await startCountdown();
	await changeState("background");
	jest.setSystemTime(CLOCK_START + 90_000);
	await changeState("active");
	expect(active).toMatchObject({ completed: true, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(spokenPhases()).toEqual([]);
	expect(latestInput()).toMatchObject({ preserveDue: true, allowStart: false });
});

test("a clock suspended with five seconds remaining restores to completed zero, not a record or a frozen five", async () => {
	await mount(); await startCountdown(); await advance(55);
	expect(active.seconds).toBe(5);
	const timerId = active.timerId;
	await changeState("background");
	// The native service continues while JS intervals are frozen, as on a locked phone.
	jest.setSystemTime(CLOCK_START + 70_000);
	await changeState("active");
	expect(active).toMatchObject({ timerId, completed: true, seconds: 0, elapsedSeconds: 60, running: false,
		completedAt: new Date(CLOCK_START + 60_000).toISOString(), pendingSummary: null });
	expect(latestInput()).toMatchObject({ preserveDue: true, allowStart: false,
		session: { completed: true, countdownCompletedNaturally: true, accumulatedSeconds: 60 } });
	expect(spokenPhases()).toEqual([]);
	await changeState("background"); await changeState("active"); await advance(15);
	expect(active).toMatchObject({ seconds: 0, running: false, pendingSummary: null });
	expect(spokenPhases()).toEqual([]);
});

test("ending early clears native delivery without preserving a future cue, then starts a new native identity", async () => {
	await mount(); await startCountdown(); await advance(12);
	const timerId = active.timerId;
	mockAndroidIntegrationClear.mockClear();
	let summary;
	await act(async () => { summary = active.finishSession(); });
	expect(summary).toBeNull();
	expect(active).toMatchObject({ timerId, completed: true, seconds: 0, elapsedSeconds: 12, pendingSummary: null });
	expect(mockAndroidIntegrationClear).toHaveBeenCalled();
	expect(latestInput()).toMatchObject({ preserveDue: false, allowStart: false,
		session: { completed: true, countdownCompletedNaturally: false } });
	await act(async () => active.startCountdown(90));
	expect(active.timerId).not.toBe(timerId);
	expect(latestInput()).toMatchObject({ allowStart: true, preserveDue: false,
		session: { completed: false, targetDurationSec: 90, accumulatedSeconds: 0, running: true } });
	expect(spokenPhases()).toEqual([]);
});

test.each(["countdown", "countup"])("%s pause and resume keep identity and exclude paused time", async (recordMode) => {
	await mount();
	await act(async () => active.chooseMode("outdoor", recordMode, 60));
	await act(async () => recordMode === "countdown" ? active.startCountdown(60) : active.toggleRunning());
	const timerId = active.timerId;
	await advance(12); await act(async () => active.toggleRunning());
	expect(latestInput()).toMatchObject({ allowStart: false,
		session: { timerId, recordMode, running: false, accumulatedSeconds: 12, startedAt: null } });
	await advance(20);
	expect(active.elapsedSeconds).toBe(12);
	await act(async () => active.toggleRunning());
	expect(latestInput()).toMatchObject({ allowStart: true,
		session: { timerId, recordMode, running: true, accumulatedSeconds: 12, startedAt: CLOCK_START + 32_000 } });
	expect(JSON.parse(AsyncStorage.__androidAudioData.get(STORAGE_KEY)).session.timerId).toBe(timerId);
});

test("discarding a countdown and immediately starting countup ignores the old pending result", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countdown", 60));
	const oldResult = deferred();
	mockAndroidIntegrationSync.mockReturnValueOnce(oldResult.promise);
	await act(async () => active.startCountdown(60));
	const countdownId = active.timerId;
	await act(async () => active.resetSession());
	await act(async () => active.chooseMode("outdoor", "countup"));
	await act(async () => active.toggleRunning());
	const countupId = active.timerId;
	expect(countupId).not.toBe(countdownId);
	expect(latestInput()).toMatchObject({ allowStart: true, session: { recordMode: "countup", timerId: countupId, running: true } });
	const syncs = mockAndroidIntegrationSync.mock.calls.length;
	await act(async () => oldResult.resolve({ status: "denied", audioOwned: false }));
	expect(mockAndroidIntegrationSync).toHaveBeenCalledTimes(syncs);
	expect(showAlert).not.toHaveBeenCalled();
	await advance(65);
	expect(active).toMatchObject({ timerId: countupId, recordMode: "countup", running: true, pendingSummary: null });
	expect(spokenPhases()).toEqual([]);
});

test("manual entry clears an old timer but never requests a native service start", async () => {
	await mount(); await startCountdown();
	mockAndroidIntegrationSync.mockClear();
	mockAndroidIntegrationClear.mockClear();
	await act(async () => active.chooseMode("home", "manual"));
	expect(active.pendingSummary).toMatchObject({ recordMode: "manual", editableTiming: true });
	expect(mockAndroidIntegrationClear).toHaveBeenCalled();
	expect(inputs().every((input) => !input.allowStart && !input.session.started && !input.session.running)).toBe(true);
	await advance(65);
	expect(spokenPhases()).toEqual([]);
});

test("logout clears native delivery and ignores results belonging to the previous account", async () => {
	await mount(); await act(async () => active.chooseMode("outdoor", "countdown", 60));
	const oldResult = deferred(); mockAndroidIntegrationSync.mockReturnValueOnce(oldResult.promise);
	await act(async () => active.startCountdown(60));
	mockAndroidIntegrationClear.mockClear();
	await act(async () => tree.update(app({ userId: null })));
	expect(mockAndroidIntegrationClear).toHaveBeenCalled();
	expect(latestInput()).toMatchObject({ ownerKey: null, allowStart: false, session: { started: false } });
	await act(async () => oldResult.resolve({ status: "denied", audioOwned: false }));
	await advance(65);
	expect(active.pendingSummary).toBeNull();
	expect(AsyncStorage.__androidAudioData.has(STORAGE_KEY)).toBe(false);
	expect(showAlert).not.toHaveBeenCalled();
	expect(spokenPhases()).toEqual([]);
});

test("only explicit user start and resume permit a service start; ticks and AppState changes do not", async () => {
	await mount();
	expect(inputs().every((input) => input.allowStart === false)).toBe(true);
	await startCountdown();
	expect(inputs().filter((input) => input.allowStart)).toHaveLength(1);
	await advance(5);
	await changeState("background");
	expect(latestInput().allowStart).toBe(false);
	await changeState("active");
	expect(latestInput().allowStart).toBe(false);
	await act(async () => tree.update(app({ locale: "en" })));
	expect(latestInput()).toMatchObject({ locale: "en", allowStart: false });
	await act(async () => active.toggleRunning());
	expect(latestInput().allowStart).toBe(false);
	await act(async () => active.toggleRunning());
	expect(latestInput().allowStart).toBe(true);
	expect(inputs().filter((input) => input.allowStart)).toHaveLength(2);
});

test.each(["active", "background"])("restoring a running timer while %s never creates new start permission", async (state) => {
	AppState.currentState = state;
	restoreCountdown();
	await mount();
	expect(active).toMatchObject({ timerId: "saved-countdown", running: true, elapsedSeconds: 10 });
	expect(inputs().every((input) => input.allowStart === false)).toBe(true);
	await changeState("background"); await changeState("active");
	expect(inputs().every((input) => input.allowStart === false)).toBe(true);
});

test.each(["denied", "needs_start", "failed"])("%s without audio ownership falls back to fresh foreground speech without a permission popup", async (status) => {
	mockAndroidIntegrationSync.mockImplementation(async ({ session }) => session.started
		? { status, audioOwned: false } : { status: "cleared", audioOwned: false });
	await mount(); await startCountdown();
	expect(showAlert).not.toHaveBeenCalled();
	await advance(30);
	expect(spokenPhases()).toEqual(["halfway"]);
	await advance(30);
	expect(spokenPhases()).toEqual(["halfway", "complete"]);
	expect(active).toMatchObject({ completed: true, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(mockAndroidIntegrationLegacySync).not.toHaveBeenCalled();
	expect(mockAndroidIntegrationStatusSync).not.toHaveBeenCalled();
});

test('notification denial with native media ownership never adds fallback speech or permission popups', async () => {
	mockAndroidIntegrationSync.mockImplementation(async ({ session }) => session.started
		? { status: 'updated', audioOwned: true, notificationStatus: 'denied', notificationsEnabled: false }
		: { status: 'cleared', audioOwned: false });
	await mount(); await startCountdown();
	expect(latestInput().allowStart).toBe(true);
	await advance(10); await act(async () => active.toggleRunning());
	await act(async () => active.toggleRunning());
	expect(latestInput().allowStart).toBe(true);
	await advance(20); await advance(30);
	expect(active).toMatchObject({ completed: true, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(spokenPhases()).toEqual([]);
	expect(showAlert).not.toHaveBeenCalled();
	expect(mockAndroidIntegrationLegacySync).not.toHaveBeenCalled();
	expect(mockAndroidIntegrationStatusSync).not.toHaveBeenCalled();
});

test("failed native ownership never turns background time into delayed fallback speech", async () => {
	mockAndroidIntegrationSync.mockResolvedValue({ status: "denied", audioOwned: false });
	await mount(); await startCountdown();
	await changeState("background");
	jest.setSystemTime(CLOCK_START + 90_000);
	await changeState("active");
	expect(active).toMatchObject({ completed: true, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(spokenPhases()).toEqual([]);
});

test("loss of native ownership just after halfway cannot repeat its cue, but future completion can use foreground fallback", async () => {
	await mount(); await startCountdown();
	await advance(31);
	expect(spokenPhases()).toEqual([]);
	mockAndroidIntegrationSync.mockResolvedValue({ status: "failed", audioOwned: false });
	await act(async () => tree.update(app({ locale: "en" })));
	expect(spokenPhases()).toEqual([]);
	await advance(29);
	expect(spokenPhases()).toEqual(["complete"]);
});

test("loss of native ownership before a milestone permits future fresh foreground cues", async () => {
	await mount(); await startCountdown(); await advance(10);
	mockAndroidIntegrationSync.mockResolvedValue({ status: "failed", audioOwned: false });
	await act(async () => tree.update(app({ locale: "en" })));
	await advance(20);
	expect(spokenPhases()).toEqual(["halfway"]);
});

test("the countdown screen no longer instructs users to enable Android alarms", () => {
	const source = require("fs").readFileSync(require("path").resolve(__dirname, "../../app/(tabs)/session/index.js"), "utf8");
	expect(source).not.toMatch(/半程及結束提醒使用 Android 系統鬧鐘|鬧鐘和提醒|下一個鬧鐘圖示|Alarms & reminders|next-alarm icon/);
});
