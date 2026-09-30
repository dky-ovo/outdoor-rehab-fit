import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { createAudioPlayer } from "expo-audio";
import { ensurePlaybackAudioMode } from "../../utils/audioMode";
import { AuthContext } from "../AuthContext";
import { LocaleContext } from "../LocaleContext";
import { ActiveSessionProvider, useActiveSession } from "../ActiveSessionContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../../utils/sessionTimerNotifications", () => ({ createSessionTimerNotificationManager: () => ({ clear: jest.fn(async () => ({ status: "cleared" })), sync: jest.fn(async () => ({ status: "updated" })) }) }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("expo-speech", () => ({ speak: jest.fn(), stop: jest.fn(async () => {}), getAvailableVoicesAsync: jest.fn(async () => []) }));
jest.mock("expo-audio", () => ({ createAudioPlayer: jest.fn() }));
// Keep the real shared asset selector, with distinct asset identities in Jest.
jest.mock("../../assets/sounds/notifications/countdown_yue_halfway.wav", () => "countdown_yue_halfway.wav");
jest.mock("../../assets/sounds/notifications/countdown_yue_complete.wav", () => "countdown_yue_complete.wav");
jest.mock("../../assets/sounds/notifications/countdown_en_halfway.wav", () => "countdown_en_halfway.wav");
jest.mock("../../assets/sounds/notifications/countdown_en_complete.wav", () => "countdown_en_complete.wav");
jest.mock("../../utils/audioMode", () => ({ ensurePlaybackAudioMode: jest.fn(async () => {}) }));
jest.mock("../../utils/countdownNotifications", () => ({ createCountdownNotificationScheduler: () => ({ cancel: jest.fn(async () => ({ status: "inactive" })), sync: jest.fn(async () => ({ status: "unsupported" })) }) }));
jest.mock("@react-native-async-storage/async-storage", () => {
	const data = new Map();
	return { __esModule: true, default: {
		getItem: jest.fn(async (key) => data.get(key) ?? null),
		setItem: jest.fn(async (key, value) => { data.set(key, value); }),
		removeItem: jest.fn(async (key) => { data.delete(key); }), __data: data,
	} };
});

const STORAGE_KEY = "@outdoor_fit_active_session_v1";
let current;
let tree;
let changeAppState;
let players;
let played;
const ZH_HALF = "countdown_yue_halfway.wav";
const ZH_COMPLETE = "countdown_yue_complete.wav";
const EN_HALF = "countdown_en_halfway.wav";
const EN_COMPLETE = "countdown_en_complete.wav";
function mockPlayer(source, loaded = true) {
	const listeners = new Set();
	const deliveredListeners = [];
	const player = {
		source, isLoaded: loaded, isBuffering: !loaded,
		currentStatus: { isLoaded: loaded, isBuffering: !loaded },
		play: jest.fn(() => { played.push(source); player.emit({ playing: true }); }),
		pause: jest.fn(), remove: jest.fn(),
		addListener: jest.fn((_event, listener) => {
			listeners.add(listener);
			deliveredListeners.push(listener);
			return { remove: jest.fn(() => listeners.delete(listener)) };
		}),
		emit(status, includeRemoved = false) {
			Object.assign(player, status);
			player.currentStatus = { ...player.currentStatus, ...status };
			for (const listener of includeRemoved ? deliveredListeners : [...listeners]) listener(player.currentStatus);
		},
	};
	players.push(player);
	return player;
}
function deferNextPlayer() {
	let player;
	createAudioPlayer.mockImplementationOnce((source) => { player = mockPlayer(source, false); return player; });
	// Deliver even a removed listener to exercise a native callback already queued
	// before cancellation, not merely the mock event emitter's removal behavior.
	return { resolve: () => player.emit({ isLoaded: true, isBuffering: false }, true), get player() { return player; } };
}
function Probe() { current = useActiveSession(); return null; }
function app(userId = "voice-a", locale = "zh") {
	return <LocaleContext.Provider value={{ locale }}>
		<AuthContext.Provider value={{ user: { id: userId }, isLoading: false }}>
			<ActiveSessionProvider><Probe /></ActiveSessionProvider>
		</AuthContext.Provider>
	</LocaleContext.Provider>;
}
async function mount(userId, locale) { await act(async () => { tree = renderer.create(app(userId, locale)); }); }
async function start(seconds = 60) {
	await act(async () => current.chooseMode("outdoor", "countdown", seconds));
	await act(async () => current.startCountdown(seconds));
}
async function advance(seconds) { await act(async () => { jest.advanceTimersByTime(seconds * 1000); }); }
async function flush() { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); }
function spoken() { return [...played]; }
function defer() { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; }

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date("2026-09-08T01:00:00Z"));
	jest.clearAllMocks();
	AsyncStorage.__data.clear();
	players = []; played = [];
	createAudioPlayer.mockReset().mockImplementation((source) => mockPlayer(source));
	Speech.speak.mockReset();
	Speech.stop.mockReset().mockResolvedValue(undefined);
	Speech.getAvailableVoicesAsync.mockReset().mockResolvedValue([]);
	ensurePlaybackAudioMode.mockReset().mockResolvedValue(undefined);
	AppState.currentState = "active";
	jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
		changeAppState = listener;
		return { remove: jest.fn() };
	});
});
afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
	expect(Speech.speak).not.toHaveBeenCalled();
	expect(Speech.getAvailableVoicesAsync).not.toHaveBeenCalled();
	for (const player of players) expect(player.remove).toHaveBeenCalled();
	jest.restoreAllMocks();
	jest.useRealTimers();
});

test("a one-minute countdown announces once at 30 seconds and once on natural completion", async () => {
	await mount(); await start();
	await advance(29); expect(spoken()).toEqual([]);
	await advance(1); expect(spoken()).toEqual([ZH_HALF]);
	expect(JSON.parse(AsyncStorage.__data.get(STORAGE_KEY)).session.countdownHalfwayAnnounced).toBe(true);
	await advance(29); expect(spoken()).toHaveLength(1);
	await advance(1); expect(spoken()).toEqual([ZH_HALF, ZH_COMPLETE]);
	const completedAt = current.completedAt;
	await advance(10);
	expect(current).toMatchObject({ completed: true, completedAt, seconds: 0, elapsedSeconds: 60, countdownCompletionVoicePending: false, pendingSummary: null });
	expect(spoken()).toHaveLength(2);
});

test("odd durations do not announce halfway before the halfway threshold", async () => {
	await mount(); await start(5);
	await advance(2); expect(spoken()).toEqual([]);
	await advance(1); expect(spoken()).toEqual([ZH_HALF]);
});

test("paused time does not advance milestones and resuming does not repeat halfway", async () => {
	await mount(); await start();
	await advance(20); await act(async () => current.toggleRunning());
	await advance(120); expect(current.seconds).toBe(40); expect(spoken()).toEqual([]);
	await act(async () => current.toggleRunning()); await advance(10);
	expect(spoken()).toEqual([ZH_HALF]);
	await act(async () => current.toggleRunning()); await advance(120);
	await act(async () => current.toggleRunning()); await advance(30);
	expect(spoken()).toEqual([ZH_HALF, ZH_COMPLETE]);
});

test("discarding and reopening gives a new countdown its own milestones", async () => {
	await mount(); await start(); await advance(30);
	await act(async () => current.resetSession()); await advance(90);
	expect(spoken()).toHaveLength(1);
	await start(); await advance(30); await advance(30);
	expect(spoken()).toEqual([ZH_HALF, ZH_HALF, ZH_COMPLETE]);
});

test("restoring the same owner's already-announced halfway point does not repeat it", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:voice-a", session: {
		mode: "outdoor", recordMode: "countdown", targetDurationSec: 60, started: true, running: true,
		startedAt: Date.now() - 35_000, accumulatedSeconds: 0, countdownHalfwayAnnounced: true,
	} }));
	await mount(); expect(spoken()).toEqual([]);
	await advance(25); expect(spoken()).toEqual([ZH_COMPLETE]);
});

test("restoring an expired countdown finishes at zero without a summary or replaying completion", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:voice-a", session: {
		mode: "outdoor", recordMode: "countdown", targetDurationSec: 60, started: true, running: true,
		startedAt: Date.now() - 120_000, accumulatedSeconds: 0,
	} }));
	await mount(); expect(spoken()).toEqual([]);
	expect(current).toMatchObject({ completed: true, elapsedSeconds: 60, seconds: 0, pendingSummary: null });
});

test("backgrounding across both milestones never queues foreground speech on return", async () => {
	await mount(); await start();
	await act(async () => changeAppState("background"));
	await advance(80); expect(spoken()).toEqual([]);
	expect(current.countdownCompletionVoicePending).toBe(false);
	await act(async () => changeAppState("active"));
	expect(spoken()).toEqual([]);
	await act(async () => changeAppState("background"));
	await act(async () => changeAppState("active"));
	expect(spoken()).toHaveLength(0);
});

test("a suspended JS clock crossing both milestones also skips the outdated halfway cue", async () => {
	await mount(); await start();
	await act(async () => changeAppState("background"));
	jest.setSystemTime(new Date(Date.now() + 90_000));
	await act(async () => changeAppState("active"));
	expect(spoken()).toEqual([]);
});

test("countup, manual records and early manual finish do not announce countdown completion", async () => {
	await mount();
	await act(async () => current.chooseMode("outdoor", "countup"));
	await act(async () => current.toggleRunning()); await advance(120);
	await act(async () => current.finishSession());
	await act(async () => current.chooseMode("home", "manual"));
	await advance(120);
	await start(); await advance(10); await act(async () => current.finishSession()); await advance(120);
	expect(spoken()).toEqual([]);
});

test("English UI plays the exact packaged English half and completion voice files", async () => {
	await mount("voice-a", "en"); await start(); await advance(30); await advance(30);
	expect(spoken()).toEqual([EN_HALF, EN_COMPLETE]);
	expect(createAudioPlayer).toHaveBeenNthCalledWith(1, EN_HALF, expect.objectContaining({ downloadFirst: false }));
	expect(createAudioPlayer).toHaveBeenLastCalledWith(EN_COMPLETE, expect.objectContaining({ downloadFirst: false }));
});

test("Chinese UI uses packaged Cantonese even when the device only provides Mandarin", async () => {
	Speech.getAvailableVoicesAsync.mockResolvedValue([
		{ identifier: "mandarin", language: "zh-CN" },
	]);
	await mount(); await start(); await advance(30); await advance(30);
	expect(spoken()).toEqual([ZH_HALF, ZH_COMPLETE]);
	expect(createAudioPlayer).toHaveBeenNthCalledWith(1, ZH_HALF, expect.objectContaining({ downloadFirst: false }));
	expect(createAudioPlayer).toHaveBeenLastCalledWith(ZH_COMPLETE, expect.objectContaining({ downloadFirst: false }));
});

test("an unavailable system speech service does not affect packaged Cantonese playback", async () => {
	Speech.getAvailableVoicesAsync.mockRejectedValue(new Error("voices unavailable"));
	await mount(); await start(); await advance(60);
	expect(spoken()).toEqual([ZH_COMPLETE]);
	expect(current).toMatchObject({ completed: true, elapsedSeconds: 60, pendingSummary: null });
});

test.each(["audio", "create", "play", "stop"])("a %s failure cannot prevent natural completion or cause retries", async (failure) => {
	if (failure === "audio") ensurePlaybackAudioMode.mockRejectedValue(new Error("audio unavailable"));
	if (failure === "create") createAudioPlayer.mockImplementation(() => { throw new Error("player unavailable"); });
	if (failure === "play") createAudioPlayer.mockImplementation((source) => {
		const player = mockPlayer(source);
		player.play.mockImplementation(() => { throw new Error("playback unavailable"); });
		return player;
	});
	if (failure === "stop") Speech.stop.mockRejectedValue(new Error("stop unavailable"));
	await mount(); await start(); await advance(60);
	expect(current).toMatchObject({ completed: true, elapsedSeconds: 60, pendingSummary: null });
	const attempts = createAudioPlayer.mock.calls.length;
	const audioModeAttempts = ensurePlaybackAudioMode.mock.calls.length;
	await advance(30); expect(createAudioPlayer).toHaveBeenCalledTimes(attempts);
	expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(audioModeAttempts);
});

test.each(["discard", "countup", "account", "unmount", "background", "pause"])("late bundled-audio loading is ignored after %s", async (action) => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(30);
	expect(spoken()).toEqual([]);
	await act(async () => {
		if (action === "discard") current.resetSession();
		if (action === "countup") current.chooseMode("outdoor", "countup");
		if (action === "account") tree.update(app("voice-b"));
		if (action === "unmount") { tree.unmount(); tree = null; }
		if (action === "background") changeAppState("background");
		if (action === "pause") current.toggleRunning();
	});
	pendingPlayer.resolve(); await flush();
	expect(spoken()).toEqual([]);
	expect(pendingPlayer.player.play).not.toHaveBeenCalled();
	expect(pendingPlayer.player.remove).toHaveBeenCalled();
});

test("completion supersedes a still-resolving halfway cue", async () => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(30);
	await advance(30); expect(spoken()).toEqual([ZH_COMPLETE]);
	pendingPlayer.resolve(); await flush(); expect(spoken()).toEqual([ZH_COMPLETE]);
});

test("discarding a completed clock while completion audio prepares cancels the late speech", async () => {
	const audio = defer(); ensurePlaybackAudioMode.mockReturnValueOnce(audio.promise);
	await mount(); await start(); await advance(60);
	await act(async () => current.resetSession());
	audio.resolve(); await flush(); expect(spoken()).toEqual([]);
});

test("rerenders and language switches after halfway do not replay the halfway cue", async () => {
	await mount(); await start(); await advance(30);
	await act(async () => tree.update(app("voice-a", "en")));
	await advance(1); expect(spoken()).toEqual([ZH_HALF]);
	await advance(29); expect(spoken()).toEqual([ZH_HALF, EN_COMPLETE]);
});

test("mounting and cancelling a timer without its own speech does not stop another section reading", async () => {
	await mount(); await start(); await advance(5);
	await act(async () => current.toggleRunning()); await act(async () => current.resetSession());
	expect(Speech.stop).not.toHaveBeenCalled();
});

test("completion cancelled during preparation is not replayed on foreground return", async () => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(60);
	expect(current.countdownCompletionVoicePending).toBe(true);
	await act(async () => changeAppState("background"));
	pendingPlayer.resolve(); await flush(); expect(spoken()).toEqual([]);
	expect(current.countdownCompletionVoicePending).toBe(false);
	await act(async () => changeAppState("active"));
	expect(spoken()).toEqual([]);
	expect(current.countdownCompletionVoicePending).toBe(false);
});

test("pausing after halfway discards the delayed halfway cue instead of replaying on resume", async () => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(30);
	await act(async () => current.toggleRunning());
	pendingPlayer.resolve(); await flush(); expect(spoken()).toEqual([]);
	expect(current.countdownHalfwayAnnounced).toBe(true);
	await advance(120); await act(async () => current.toggleRunning());
	expect(spoken()).toEqual([]);
	await advance(30); expect(spoken()).toEqual([ZH_COMPLETE]);
});

test("multiple ticks and StrictMode rerenders cannot enqueue duplicate in-flight cues", async () => {
	const pendingPlayer = deferNextPlayer();
	await act(async () => { tree = renderer.create(<React.StrictMode>{app()}</React.StrictMode>); });
	await start(); await advance(30); await advance(1);
	await act(async () => tree.update(<React.StrictMode>{app()}</React.StrictMode>));
	expect(createAudioPlayer).toHaveBeenCalledTimes(1);
	pendingPlayer.resolve(); await flush(); expect(spoken()).toEqual([ZH_HALF]);
});

test("a late completion request cannot speak after changing to another account", async () => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(60);
	await act(async () => tree.update(app("voice-b")));
	pendingPlayer.resolve(); await flush();
	expect(spoken()).toEqual([]); expect(current.pendingSummary).toBeNull();
});

test("cancellation also guards the asynchronous stop operation before speech is queued", async () => {
	const stopping = defer(); Speech.stop.mockReturnValueOnce(stopping.promise);
	await mount(); await start(); await advance(30);
	await act(async () => current.resetSession());
	stopping.resolve(); await flush(); expect(spoken()).toEqual([]);
});

test("changing language during bundled-audio preparation replaces the unspoken cue without duplicating it", async () => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(30);
	await act(async () => tree.update(app("voice-a", "en")));
	expect(spoken()).toEqual([EN_HALF]);
	pendingPlayer.resolve(); await flush();
	expect(spoken()).toEqual([EN_HALF]);
});

test("unlocking just after halfway does not replay the OS-owned cue", async () => {
	await mount(); await start();
	await act(async () => changeAppState("background"));
	jest.setSystemTime(Date.now() + 31_000);
	await act(async () => changeAppState("active"));
	expect(spoken()).toEqual([]);
	expect(current.countdownHalfwayAnnounced).toBe(true);
	await advance(29);
	expect(spoken()).toEqual([ZH_COMPLETE]);
});

test.each(["halfway", "complete"])("slow bundled-audio loading never announces stale %s audio", async (phase) => {
	const pendingPlayer = deferNextPlayer();
	await mount(); await start(); await advance(phase === "halfway" ? 30 : 60);
	await advance(4); pendingPlayer.resolve(); await flush();
	expect(spoken()).toEqual([]);
});

test("old saved pending completion audio is discarded on process restart", async () => {
	AsyncStorage.__data.set(STORAGE_KEY, JSON.stringify({ version: 2, ownerKey: "user:voice-a", session: {},
		pendingSummary: { id: "old-summary", mode: "outdoor", recordMode: "countdown", durationSec: 60,
			completedAt: new Date(Date.now() - 30_000).toISOString(), countdownCompletionVoicePending: true } }));
	await mount();
	expect(spoken()).toEqual([]);
	expect(current.pendingSummary.id).toBe("old-summary");
	expect(current.pendingSummary.countdownCompletionVoicePending).toBe(false);
});

test('a null AppState during startup does not suppress the first foreground countdown', async () => {
	AppState.currentState = null;
	await mount(); await act(async () => changeAppState('active'));
	await start(); await advance(30); await advance(30);
	expect(spoken()).toEqual([ZH_HALF, ZH_COMPLETE]);
});
