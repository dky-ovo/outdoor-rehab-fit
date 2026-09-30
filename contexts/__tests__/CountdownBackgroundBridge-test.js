import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Native from "../../modules/session-timer-notification";
import { AuthContext } from "../AuthContext";
import { LocaleContext } from "../LocaleContext";
import { ActiveSessionProvider, useActiveSession } from "../ActiveSessionContext";

// Exercise the real provider, audio manager and notification plan together.
// Only the native bridge is simulated: this does not claim System UI/device QA.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockLegacyCancel = jest.fn(async () => ({ status: "cleared" }));
const mockLegacyClear = jest.fn(async () => ({ status: "cleared" }));
const mockSpeak = jest.fn(async () => "spoken");

jest.mock("../AuthContext", () => ({ AuthContext: require("react").createContext(null) }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("expo-notifications", () => ({}));
jest.mock("../../modules/session-timer-notification", () => ({
  isTimerAudioServiceAvailable: jest.fn(() => true),
  prepareNotificationChannelAsync: jest.fn(),
  startTimerAudioServiceAsync: jest.fn(),
  stopTimerAudioServiceAsync: jest.fn(),
  checkReminderSettingsAsync: jest.fn(async () => ({ status: "unavailable" })),
}));
jest.mock("../../utils/countdownNotifications", () => ({
  createCountdownNotificationScheduler: () => ({ cancel: mockLegacyCancel }),
}));
jest.mock("../../utils/sessionTimerNotifications", () => ({
  ...jest.requireActual("../../utils/sessionTimerNotifications"),
  createSessionTimerNotificationManager: () => ({ clear: mockLegacyClear }),
}));
jest.mock("../../utils/countdownSpeech", () => ({
  createCountdownSpeaker: () => ({ speak: mockSpeak, cancel: jest.fn() }),
}));
jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { __esModule: true, default: {
    getItem: jest.fn(async (key) => data.get(key) ?? null),
    setItem: jest.fn(async (key, value) => { data.set(key, value); }),
    removeItem: jest.fn(async (key) => { data.delete(key); }),
    __backgroundBridgeData: data,
  } };
});

const START = Date.parse("2026-09-11T04:00:00Z");
let active;
let tree;
let onAppState;
function Probe() { active = useActiveSession(); return null; }
function app() {
  return <LocaleContext.Provider value={{ locale: "zh" }}>
    <AuthContext.Provider value={{ user: { id: "background-bridge" }, isLoading: false }}>
      <ActiveSessionProvider><Probe /></ActiveSessionProvider>
    </AuthContext.Provider>
  </LocaleContext.Provider>;
}
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
async function mountAndStart() {
  await act(async () => { tree = renderer.create(app()); await flush(); });
  await act(async () => { active.chooseMode("outdoor", "countdown", 60); await flush(); });
  await act(async () => { active.startCountdown(60); await flush(); });
}
async function changeState(state) {
  await act(async () => { AppState.currentState = state; onAppState(state); await flush(); });
}
async function advance(seconds) {
  await act(async () => { jest.advanceTimersByTime(seconds * 1000); await flush(); });
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(START); jest.clearAllMocks();
  AsyncStorage.__backgroundBridgeData.clear();
  AppState.currentState = "active";
  Native.prepareNotificationChannelAsync.mockReset().mockResolvedValue({ status: "prepared" });
  Native.startTimerAudioServiceAsync.mockReset().mockResolvedValue({ status: "updated", audioOwned: true });
  Native.stopTimerAudioServiceAsync.mockReset().mockImplementation(async ({ preserveDue }) => ({
    status: preserveDue ? "finishing" : "cleared", audioOwned: preserveDue,
  }));
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    onAppState = listener; return { remove: jest.fn() };
  });
});
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); await flush(); });
  tree = null; jest.restoreAllMocks(); jest.useRealTimers();
});

test("background entry at eight seconds keeps the original native deadline without per-tick bridge updates", async () => {
  await mountAndStart(); await advance(52);
  expect(active.seconds).toBe(8);
  await changeState("background");
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    timerId: active.timerId, startedAt: START, deadlineAt: START + 60_000, allowStart: false,
  }));
  const calls = Native.startTimerAudioServiceAsync.mock.calls.length;
  const stops = Native.stopTimerAudioServiceAsync.mock.calls.length;
  await advance(7);
  expect(active.seconds).toBe(1);
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledTimes(calls);
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenCalledTimes(stops);
  await advance(1);
  expect(active).toMatchObject({ completed: true, running: false, pendingSummary: null });
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
  expect(mockSpeak).not.toHaveBeenCalled();
});

test("suspension at eight seconds cannot resurrect an expired native timer on unlock", async () => {
  await mountAndStart(); await advance(52); await changeState("background");
  const starts = Native.startTimerAudioServiceAsync.mock.calls.length;
  jest.setSystemTime(START + 64_000); // No JS interval callbacks while suspended.
  await changeState("active");
  expect(active).toMatchObject({ completed: true, running: false, pendingSummary: null });
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledTimes(starts);
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
  expect(mockSpeak).not.toHaveBeenCalled();
});

test("a channel refresh delayed across expiry is cancelled before native start, preserving the end cue", async () => {
  await mountAndStart(); await advance(52);
  const preparation = deferred();
  Native.prepareNotificationChannelAsync.mockReturnValueOnce(preparation.promise);
  await changeState("background");
  const starts = Native.startTimerAudioServiceAsync.mock.calls.length;
  await advance(8);
  await act(async () => { preparation.resolve({ status: "prepared" }); await flush(); });
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledTimes(starts);
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
  expect(active.pendingSummary).toBeNull();
  expect(mockSpeak).not.toHaveBeenCalled();
});

test("a late old expiry result cannot stop the next countdown or borrow its start authorization", async () => {
  await mountAndStart();
  const oldTimerId = active.timerId;
  const stopping = deferred();
  Native.stopTimerAudioServiceAsync.mockReturnValueOnce(stopping.promise);
  await advance(60);
  expect(active.completed).toBe(true);
  await act(async () => { active.startCountdown(120); await flush(); });
  const nextTimerId = active.timerId;
  expect(nextTimerId).not.toBe(oldTimerId);
  await act(async () => { stopping.resolve({ status: "finishing", audioOwned: true }); await flush(); });
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    timerId: nextTimerId, allowStart: true, targetDurationSec: 120, deadlineAt: START + 180_000,
  }));
  const calls = Native.stopTimerAudioServiceAsync.mock.calls.length;
  await advance(1);
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenCalledTimes(calls);
  expect(active).toMatchObject({ timerId: nextTimerId, running: true, completed: false });
  expect(mockSpeak).not.toHaveBeenCalled();
});
