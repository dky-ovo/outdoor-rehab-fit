import React from "react";
import renderer, { act } from "react-test-renderer";
import { Animated, PanResponder } from "react-native";
import { router } from "expo-router";
import FloatingSessionTimer from "../FloatingSessionTimer";
import { getFloatingTimerObstacle } from "../../utils/floatingVoiceLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockPath = "/outdoor/detail";
let mockParams = { id: "0", from: "ai" };
let mockSession = { mode: "outdoor", recordMode: "countup", seconds: 12, started: true, pendingSummary: null };
let gesture;
let tree;

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, usePathname: () => mockPath, useGlobalSearchParams: () => mockParams }));
jest.mock("@/contexts/ActiveSessionContext", () => ({ useActiveSession: () => mockSession }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

beforeEach(() => {
	mockPath = "/outdoor/detail";
	mockParams = { id: "0", from: "ai" };
	mockSession = { mode: "outdoor", recordMode: "countup", seconds: 12, started: true, pendingSummary: null };
	jest.clearAllMocks();
	jest.spyOn(PanResponder, "create").mockImplementation((config) => { gesture = config; return { panHandlers: {} }; });
	jest.spyOn(Animated, "spring").mockReturnValue({ start: jest.fn() });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("tapping the floating timer carries the current facility parameters into its return path", async () => {
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	await act(async () => {
		gesture.onPanResponderGrant();
		gesture.onPanResponderRelease({}, { dx: 0, dy: 0 });
	});
	expect(router.push).toHaveBeenCalledWith({ pathname: "/(tabs)/session/countup", params: { fromFloating: "1", returnTo: "/outdoor/detail?id=0&from=ai" } });
});

test("a legacy countdown draft stays available but never automatically redirects away from another page", async () => {
	mockPath = "/sessionlog/edit";
	mockParams = { id: "session-1" };
	mockSession = { ...mockSession, mode: null, started: false, pendingSummary: { id: "summary-1", recordMode: "countdown", durationSec: 60 } };
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(router.push).not.toHaveBeenCalled();
	expect(tree.toJSON()).not.toBeNull();
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(router.push).not.toHaveBeenCalled();
	mockPath = "/";
	mockParams = {};
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(router.push).not.toHaveBeenCalled();
	await act(async () => {
		gesture.onPanResponderGrant();
		gesture.onPanResponderRelease({}, { dx: 0, dy: 0 });
	});
	expect(router.push).toHaveBeenCalledTimes(1);
	expect(router.push.mock.calls.at(-1)[0].pathname).toBe("/(tabs)/session/countdown");
	expect(mockSession.pendingSummary.id).toBe("summary-1");
});

test("a completed pure countdown hides its floating timer and never opens a summary", async () => {
	mockSession = { ...mockSession, recordMode: "countdown", started: true, completed: true, running: false, seconds: 0 };
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(tree.toJSON()).toBeNull();
	expect(router.push).not.toHaveBeenCalled();
});

test("completing while outside the timer removes the floating control without navigating", async () => {
	mockSession = { ...mockSession, recordMode: "countdown", seconds: 1 };
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(tree.toJSON()).not.toBeNull();
	mockSession = { ...mockSession, completed: true, running: false, seconds: 0 };
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(tree.toJSON()).toBeNull();
	expect(router.push).not.toHaveBeenCalled();
});

test.each(["manual", "countup"])("existing %s summaries retain their automatic return behavior", async (recordMode) => {
	mockSession = { ...mockSession, started: false, pendingSummary: { id: "summary-1", recordMode } };
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: `/(tabs)/session/${recordMode}` }));
});

test("the timer shares only its visible layout and clears it when entering the timer screen", async () => {
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(getFloatingTimerObstacle()).toEqual({ x: expect.any(Number), y: expect.any(Number), width: 112, height: 54 });
	const initial = getFloatingTimerObstacle();
	await act(async () => {
		gesture.onPanResponderGrant(); gesture.onPanResponderMove({}, { dx: -100, dy: 30 });
		gesture.onPanResponderRelease({}, { dx: -100, dy: 30 });
	});
	expect(getFloatingTimerObstacle()).not.toEqual(initial);
	expect(router.push).not.toHaveBeenCalled();
	mockPath = "/session/countdown";
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(getFloatingTimerObstacle()).toBeNull();
	mockPath = "/";
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(getFloatingTimerObstacle()).not.toBeNull();
	await act(async () => tree.unmount()); tree = null;
	expect(getFloatingTimerObstacle()).toBeNull();
});

test("countdown completion removes its voice-ball avoidance rectangle", async () => {
	mockSession = { ...mockSession, recordMode: "countdown", seconds: 1 };
	await act(async () => { tree = renderer.create(<FloatingSessionTimer />); });
	expect(getFloatingTimerObstacle()).not.toBeNull();
	mockSession = { ...mockSession, completed: true, running: false, seconds: 0 };
	await act(async () => tree.update(<FloatingSessionTimer />));
	expect(getFloatingTimerObstacle()).toBeNull();
});
