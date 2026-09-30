import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthContext } from "../AuthContext";
import { ActiveSessionProvider, activeSessionOwnerKey, useActiveSession } from "../ActiveSessionContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../../utils/sessionTimerNotifications", () => ({ createSessionTimerNotificationManager: () => ({ clear: jest.fn(async () => ({ status: "cleared" })), sync: jest.fn(async () => ({ status: "updated" })) }) }));
jest.mock("../../utils/countdownSpeech", () => ({ createCountdownSpeaker: () => ({ cancel: jest.fn(), speak: jest.fn(async () => "spoken") }) }));
jest.mock("../../utils/countdownNotifications", () => ({ createCountdownNotificationScheduler: () => ({ cancel: jest.fn(async () => ({ status: "inactive" })), sync: jest.fn(async () => ({ status: "unsupported" })) }) }));
jest.mock("@react-native-async-storage/async-storage", () => {
	const data = new Map();
	return {
		__esModule: true,
		default: {
			getItem: jest.fn(async (key) => data.get(key) ?? null),
			setItem: jest.fn(async (key, value) => { data.set(key, value); }),
			removeItem: jest.fn(async (key) => { data.delete(key); }),
			__data: data,
		},
	};
});

const STORAGE_KEY = "@outdoor_fit_active_session_v1";
let currentSession;

function Probe() {
	currentSession = useActiveSession();
	return null;
}

function treeFor(user) {
	return (
		<AuthContext.Provider value={{ user, isLoading: false }}>
			<ActiveSessionProvider><Probe /></ActiveSessionProvider>
		</AuthContext.Provider>
	);
}

async function flushEffects() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	AsyncStorage.__data.clear();
	jest.clearAllMocks();
	currentSession = null;
});

afterEach(() => { jest.useRealTimers(); });

test("derives stable, non-overlapping owner keys", () => {
	expect(activeSessionOwnerKey({ id: "participant-1" })).toBe("user:participant-1");
	expect(activeSessionOwnerKey({ role: "guest", loginAt: "guest-login" })).toBe("guest:guest-login");
	expect(activeSessionOwnerKey(null)).toBeNull();
});

test("persists pending summary drafts for the same account and clears them on identity change", async () => {
	const userA = { id: "participant-a", role: "user" };
	const userB = { id: "participant-b", role: "user" };
	let tree;
	await act(async () => { tree = renderer.create(treeFor(userA)); });
	await flushEffects();

	await act(async () => {
		currentSession.chooseMode("outdoor", "manual");
	});
	const summaryId = currentSession.pendingSummary.id;
	await act(async () => {
		currentSession.updatePendingSummaryDraft(summaryId, { journal: "draft note" });
	});
	await flushEffects();

	const stored = JSON.parse(AsyncStorage.__data.get(STORAGE_KEY));
	expect(stored.ownerKey).toBe("user:participant-a");
	expect(stored.pendingSummary.id).toBe(summaryId);
	expect(stored.pendingSummaryDraft).toEqual(expect.objectContaining({ summaryId, journal: "draft note" }));

	await act(async () => { tree.update(treeFor(userB)); });
	await flushEffects();
	expect(currentSession.hydrated).toBe(true);
	expect(currentSession.mode).toBeNull();
	expect(currentSession.pendingSummary).toBeNull();
	expect(currentSession.pendingSummaryDraft).toBeNull();
	expect(AsyncStorage.__data.has(STORAGE_KEY)).toBe(false);

	await act(async () => tree.unmount());
});

test("restores a pending summary and its draft only for the matching account", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({
		version: 2,
		ownerKey: "user:participant-a",
		session: { mode: null, started: false },
		pendingSummary: { id: "summary-1", mode: "home", recordMode: "manual", editableTiming: true, durationSec: 0, completedAt: new Date().toISOString() },
		pendingSummaryDraft: { summaryId: "summary-1", manualDurationMinutes: "30", journal: "restored" },
	}));

	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a", role: "user" })); });
	await flushEffects();
	expect(currentSession.pendingSummary.id).toBe("summary-1");
	expect(currentSession.pendingSummaryDraft.journal).toBe("restored");

	await act(async () => tree.unmount());
});

test("discards an unowned legacy active session instead of exposing it to the next account", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({
		mode: "outdoor",
		recordMode: "countup",
		started: true,
		running: true,
		startedAt: Date.now() - 60_000,
	}));

	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a", role: "user" })); });
	await flushEffects();
	expect(currentSession.mode).toBeNull();
	expect(currentSession.started).toBe(false);
	expect(AsyncStorage.__data.has(STORAGE_KEY)).toBe(false);

	await act(async () => tree.unmount());
});

test("discarding countdown state before manual entry cannot reuse countdown content", async () => {
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a", role: "user" })); });
	await flushEffects();

	await act(async () => currentSession.chooseMode("outdoor", "countdown", 600));
	expect(currentSession.recordMode).toBe("countdown");
	expect(currentSession.targetDurationSec).toBe(600);

	await act(async () => currentSession.resetSession());
	await act(async () => currentSession.chooseMode("home", "manual"));
	expect(currentSession.mode).toBeNull();
	expect(currentSession.started).toBe(false);
	expect(currentSession.pendingSummary).toEqual(expect.objectContaining({ mode: "home", recordMode: "manual", editableTiming: true }));

	await act(async () => tree.unmount());
});

test("countdown pause excludes paused time and completion stays at zero without a summary", async () => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date("2026-09-07T01:00:00Z"));
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a", role: "user" })); });
	await flushEffects();
	await act(async () => currentSession.chooseMode("outdoor", "countdown", 60));
	await act(async () => currentSession.startCountdown(60));
	await act(async () => jest.advanceTimersByTime(20_000));
	expect(currentSession.seconds).toBe(40);
	await act(async () => currentSession.toggleRunning());
	await act(async () => jest.advanceTimersByTime(300_000));
	expect(currentSession.seconds).toBe(40);
	expect(currentSession.pendingSummary).toBeNull();
	await act(async () => currentSession.toggleRunning());
	await act(async () => jest.advanceTimersByTime(40_000));
	expect(currentSession).toMatchObject({ completed: true, recordMode: "countdown", seconds: 0, elapsedSeconds: 60, pendingSummary: null });
	const completedAt = currentSession.completedAt;
	await act(async () => jest.advanceTimersByTime(120_000));
	expect(currentSession.completedAt).toBe(completedAt);
	expect(currentSession.pendingSummary).toBeNull();
	expect(currentSession.running).toBe(false);
	await act(async () => tree.unmount());
});

test("restarting with an expired running countdown restores completed zero without a summary", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({
		version: 2,
		ownerKey: "user:participant-a",
		session: { mode: "outdoor", recordMode: "countdown", targetDurationSec: 60, started: true, running: true, startedAt: Date.now() - 120_000, accumulatedSeconds: 0 },
	}));
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a", role: "user" })); });
	await flushEffects();
	expect(currentSession).toMatchObject({ completed: true, running: false, seconds: 0, elapsedSeconds: 60, recordMode: "countdown", pendingSummary: null });
	await act(async () => tree.unmount());
});

test("ending a countdown early never creates an exercise record and can start a fresh countdown", async () => {
	jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-11T03:00:00Z"));
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a" })); });
	await act(async () => currentSession.chooseMode("outdoor", "countdown", 60));
	await act(async () => currentSession.startCountdown(60));
	const oldId = currentSession.timerId;
	await act(async () => jest.advanceTimersByTime(12_000));
	let result;
	await act(async () => { result = currentSession.finishSession(); });
	expect(result).toBeNull();
	expect(currentSession).toMatchObject({ completed: true, seconds: 0, elapsedSeconds: 12, running: false,
		countdownCompletedNaturally: false, pendingSummary: null, countdownCompletionVoicePending: false });
	await act(async () => currentSession.toggleRunning());
	expect(currentSession.running).toBe(false);
	await act(async () => currentSession.startCountdown(90));
	expect(currentSession).toMatchObject({ completed: false, seconds: 90, elapsedSeconds: 0, running: true, pendingSummary: null });
	expect(currentSession.timerId).not.toBe(oldId);
	await act(async () => tree.unmount());
});

test.each(["manual", "countup", "countdown"])("countdown completion preserves an existing %s draft and its original identity", async (recordMode) => {
	const draft = { summaryId: "legacy-draft", journal: "Do not lose this", completedTypes: ["aerobic"] };
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:participant-a",
		session: { mode: "outdoor", recordMode: "countdown", targetDurationSec: 60, started: true, running: true,
			startedAt: Date.now() - 120_000, accumulatedSeconds: 0, timerId: "standalone-clock" },
		pendingSummary: { id: "legacy-draft", mode: "home", recordMode, durationSec: 30 }, pendingSummaryDraft: draft }));
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a" })); });
	expect(currentSession).toMatchObject({ completed: true, seconds: 0, pendingSummary: { id: "legacy-draft", recordMode } });
	expect(currentSession.pendingSummaryDraft).toEqual(draft);
	expect(JSON.parse(AsyncStorage.__data.get(STORAGE_KEY)).pendingSummaryDraft).toEqual(draft);
	await act(async () => tree.unmount());
});

test("restoring a completed pure countdown keeps zero without starting or replaying its cue", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:participant-a",
		session: { mode: "outdoor", recordMode: "countdown", targetDurationSec: 60, started: true, running: false,
			accumulatedSeconds: 60, completed: true, completedAt: new Date().toISOString(),
			countdownCompletedNaturally: true, countdownCompletionVoicePending: true, timerId: "completed-clock" } }));
	let tree;
	await act(async () => { tree = renderer.create(treeFor({ id: "participant-a" })); });
	expect(currentSession).toMatchObject({ completed: true, seconds: 0, running: false, pendingSummary: null,
		countdownCompletionVoicePending: false, timerId: "completed-clock" });
	await act(async () => tree.unmount());
});
