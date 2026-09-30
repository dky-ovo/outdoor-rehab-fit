import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { AuthContext } from "../AuthContext";
import { ActiveSessionProvider, useActiveSession } from "../ActiveSessionContext";
import { SessionRecord } from "../../app/(tabs)/session/index";
import { showAlert } from "../../utils/alert";
import AsyncStorage from "@react-native-async-storage/async-storage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/sessionTimerNotifications", () => ({ createSessionTimerNotificationManager: () => ({ clear: jest.fn(async () => ({ status: "cleared" })), sync: jest.fn(async () => ({ status: "updated" })) }) }));
const mockRouteContext = React.createContext("countdown");
let mockFocusedRoute = "countdown";
let mockSessionParams = {};
const mockListeners = new Map();
const mockRemovalGuards = new Map();
const mockNavigation = new Map();
let mockDeferFocusEffects = false;
const mockPendingFocusEffects = [];
let currentSession;
let tree;

jest.mock("expo-router", () => ({
	router: { replace: jest.fn(), dismissTo: jest.fn() },
	useLocalSearchParams: () => mockSessionParams,
	useNavigation: () => {
		const route = require("react").useContext(mockRouteContext);
		if (!mockNavigation.has(route)) mockNavigation.set(route, {
			isFocused: () => mockFocusedRoute === route,
			setOptions: jest.fn(),
			addListener: (_name, callback) => {
				mockListeners.set(route, callback);
				return () => mockListeners.delete(route);
			},
		});
		return mockNavigation.get(route);
	},
}));
jest.mock("@react-navigation/native", () => ({
	useIsFocused: () => require("react").useContext(mockRouteContext) === mockFocusedRoute,
	useFocusEffect: (callback) => {
		const focused = require("react").useContext(mockRouteContext) === mockFocusedRoute;
		require("react").useEffect(() => {
			if (!focused) return undefined;
			if (!mockDeferFocusEffects) return callback();
			let cleanup;
			let active = true;
			mockPendingFocusEffects.push(() => { if (active) cleanup = callback(); });
			return () => { active = false; cleanup?.(); };
		}, [focused, callback]);
	},
	usePreventRemove: (enabled) => {
		const route = require("react").useContext(mockRouteContext);
		mockRemovalGuards.set(route, enabled);
	},
}));
jest.mock("../../contexts/LocaleContext", () => ({
	LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key } }),
}));
jest.mock("../../app/(tabs)/session/summary", () => {
	const React = require("react");
	const { Text, TouchableOpacity } = require("react-native");
	return ({ onExit }) => <TouchableOpacity onPress={onExit}><Text>discardSummary</Text></TouchableOpacity>;
});
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/countdownSpeech", () => ({ createCountdownSpeaker: () => ({ cancel: jest.fn(), speak: jest.fn(async () => "spoken") }) }));
jest.mock("../../utils/countdownNotifications", () => ({ createCountdownNotificationScheduler: () => ({ cancel: jest.fn(async () => ({ status: "inactive" })), sync: jest.fn(async () => ({ status: "unsupported" })) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@react-native-async-storage/async-storage", () => ({
	__esModule: true,
	default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));

function Probe() { currentSession = useActiveSession(); return null; }
function app() {
	return <AuthContext.Provider value={{ user: { id: "timer-test" }, isLoading: false }}>
		<ActiveSessionProvider>
			<Probe />
			{["index", "countup", "countdown", "manual"].map((route) => (
				<mockRouteContext.Provider key={route} value={route}>
					<SessionRecord forcedRecordMode={route === "index" ? undefined : route} />
				</mockRouteContext.Provider>
			))}
		</ActiveSessionProvider>
	</AuthContext.Provider>;
}

async function focus(route) {
	mockFocusedRoute = route;
	await act(async () => { tree.update(app()); });
}

async function restoreLegacyCountup({ running = false } = {}) {
	await act(async () => tree.unmount());
	mockFocusedRoute = "countup";
	AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({
		version: 2, ownerKey: "user:timer-test",
		session: { mode: "outdoor", recordMode: "countup", started: true, running, accumulatedSeconds: 90, startedAt: running ? Date.now() : null, timerId: "legacy-timer" },
		pendingSummary: null,
	}));
	await act(async () => { tree = renderer.create(app()); });
}

function press(label, route = mockFocusedRoute) {
	const screen = tree.root.findAllByType(SessionRecord).find((node) => (node.props.forcedRecordMode || "index") === route);
	const button = screen.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label));
	if (!button) throw new Error(`Button ${label} was not found in ${route}`);
	return button.props.onPress();
}

beforeEach(async () => {
	mockFocusedRoute = "countdown";
	mockSessionParams = {};
	mockListeners.clear();
	mockRemovalGuards.clear();
	mockNavigation.clear();
	mockDeferFocusEffects = false;
	mockPendingFocusEffects.length = 0;
	jest.clearAllMocks();
	AsyncStorage.getItem.mockResolvedValue(null);
	await act(async () => { tree = renderer.create(app()); });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.useRealTimers(); });

test("countdown can be started, paused, discarded and reopened repeatedly", async () => {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		expect(currentSession).toEqual(expect.objectContaining({ recordMode: "countdown", started: false, seconds: 1800 }));
		await act(async () => press("start"));
		expect(currentSession.running).toBe(true);
		await act(async () => press("pause"));
		expect(currentSession.running).toBe(false);
		await act(async () => press("discardSession"));
		await act(async () => showAlert.mock.calls.at(-1)[2].find((button) => button.style === "destructive").onPress());
		await focus("home");
		expect(currentSession.mode).toBeNull();
		await focus("countdown");
	}
});

test("cached inactive timer pages do not intercept another page being removed", () => {
	const event = { preventDefault: jest.fn() };
	mockListeners.get("index")?.(event);
	expect(event.preventDefault).not.toHaveBeenCalled();
	expect(router.replace).not.toHaveBeenCalled();
});

test("reopening a cached timer initialises after a delayed native focus event clears its leave guard", async () => {
	await act(async () => press("start"));
	await act(async () => press("pause"));
	await act(async () => press("discardSession"));
	await act(async () => showAlert.mock.calls.at(-1)[2].find((button) => button.style === "destructive").onPress());
	await focus("home");
	mockDeferFocusEffects = true;
	await focus("countdown");
	expect(currentSession.mode).toBeNull();
	await act(async () => {
		mockDeferFocusEffects = false;
		mockPendingFocusEffects.splice(0).forEach((effect) => effect());
	});
	expect(currentSession).toEqual(expect.objectContaining({ mode: "outdoor", recordMode: "countdown", started: false, seconds: 1800 }));
	await act(async () => press("start"));
	expect(currentSession.running).toBe(true);
});

test("only the visible manual summary guards removal, and countdown reopens cleanly after discard", async () => {
	await focus("manual");
	await act(async () => press("outdoorSession"));
	expect(tree.root.findAllByType(Text).filter((node) => node.props.children === "discardSummary")).toHaveLength(1);
	expect(mockRemovalGuards.get("countdown")).toBe(false);
	expect(mockRemovalGuards.get("index")).toBe(false);
	expect(mockRemovalGuards.get("countup")).toBe(false);
	expect(mockRemovalGuards.get("manual")).toBe(true);
	await act(async () => press("discardSummary"));
	await focus("home");
	router.replace.mockClear();
	await focus("countdown");
	expect(currentSession.pendingSummary).toBeNull();
	expect(currentSession.started).toBe(false);
	expect(currentSession.mode).toBe("outdoor");
	expect(router.replace).not.toHaveBeenCalled();
});

test("natural countdown expiry returns to duration setup without opening a record or restarting", async () => {
	jest.useFakeTimers();
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("1"));
	await act(async () => press("start"));
	await act(async () => jest.advanceTimersByTime(55_000));
	expect(currentSession.seconds).toBe(5);
	await act(async () => jest.advanceTimersByTime(5_000));
	expect(currentSession).toEqual(expect.objectContaining({ completed: true, running: false, seconds: 0, pendingSummary: null }));
	expect(tree.root.findAllByType(Text).some((node) => node.props.children === "countdownDuration")).toBe(true);
	expect(tree.root.findAllByType(Text).some((node) => node.props.children === "timerReady")).toBe(true);
	expect(tree.root.findByType(TextInput).props.value).toBe("1");
	expect(() => press("restartTimer")).toThrow("was not found");
	expect(() => press("discardSummary")).toThrow("was not found");
	expect(mockRemovalGuards.get("countdown")).toBe(false);
	expect(router.replace).not.toHaveBeenCalled();
	await act(async () => jest.advanceTimersByTime(15_000));
	expect(currentSession.seconds).toBe(0);
	const oldId = currentSession.timerId;
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("3"));
	expect(currentSession.running).toBe(false);
	await act(async () => press("start"));
	expect(currentSession).toEqual(expect.objectContaining({ running: true, completed: false, seconds: 180, pendingSummary: null }));
	expect(currentSession.timerId).not.toBe(oldId);
});

test("early stop only finishes the timer and manual logging remains independently reachable", async () => {
	await act(async () => press("start"));
	await act(async () => press("stopCountdown"));
	const confirms = tree.root.findAllByType(TouchableOpacity).filter((node) => node.findAllByType(Text).some((text) => text.props.children === "stopCountdown"));
	await act(async () => confirms.at(-1).props.onPress());
	expect(currentSession).toEqual(expect.objectContaining({ completed: true, running: false, seconds: 0, pendingSummary: null }));
	expect(tree.root.findAllByType(Text).some((node) => node.props.children === "countdownDuration")).toBe(true);
	expect(() => press("restartTimer")).toThrow("was not found");
	await focus("manual");
	expect(() => press("discardAndSwitchTimer")).toThrow("was not found");
	await act(async () => press("homeSession"));
	expect(currentSession.pendingSummary).toEqual(expect.objectContaining({ recordMode: "manual", mode: "home", editableTiming: true }));
});

test("editing a completed countdown validates the new duration without resetting its completed identity", async () => {
	jest.useFakeTimers();
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("1"));
	await act(async () => press("start"));
	await act(async () => jest.advanceTimersByTime(60_000));
	const completedId = currentSession.timerId;
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("0"));
	await act(async () => press("start"));
	expect(showAlert).toHaveBeenLastCalledWith("", "countdownDurationInvalid");
	expect(currentSession).toEqual(expect.objectContaining({ timerId: completedId, completed: true, running: false, seconds: 0 }));
	// A preset changes the next setup only; it cannot cancel the old ending cue.
	await act(async () => press(5));
	expect(tree.root.findByType(TextInput).props.value).toBe("5");
	expect(currentSession).toEqual(expect.objectContaining({ timerId: completedId, completed: true, targetDurationSec: 60 }));
	await act(async () => press("start"));
	expect(currentSession).toEqual(expect.objectContaining({ completed: false, running: true, seconds: 300 }));
	expect(currentSession.timerId).not.toBe(completedId);
});

test("reopening a completed countdown shows editable original duration instead of a restart shortcut", async () => {
	await act(async () => tree.unmount());
	AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({ version: 2, ownerKey: "user:timer-test",
		session: { mode: "outdoor", recordMode: "countdown", started: true, running: false,
			targetDurationSec: 60, accumulatedSeconds: 60, startedAt: null, timerId: "completed-one-minute",
			countdownId: "completed-one-minute", completed: true, countdownCompletedNaturally: true,
			completedAt: new Date(Date.now() - 10_000).toISOString() }, pendingSummary: null }));
	await act(async () => { tree = renderer.create(app()); });
	expect(currentSession.seconds).toBe(0);
	expect(tree.root.findByType(TextInput).props.value).toBe("1");
	expect(() => press("restartTimer")).toThrow("was not found");
	await act(async () => press("start"));
	expect(currentSession).toEqual(expect.objectContaining({ targetDurationSec: 60, seconds: 60, running: true, completed: false }));
});

test("expiry while early-stop confirmation is open closes it and back returns home", async () => {
	jest.useFakeTimers();
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("1"));
	await act(async () => press("start"));
	await act(async () => press("stopCountdown"));
	await act(async () => jest.advanceTimersByTime(60_000));
	expect(currentSession.completed).toBe(true);
	const { Modal } = require("react-native");
	expect(tree.root.findAllByType(Modal).every((node) => !node.props.visible)).toBe(true);
	const header = mockNavigation.get("countdown").setOptions.mock.calls.at(-1)[0].headerLeft();
	await act(async () => header.props.onPress());
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)");
	expect(currentSession.pendingSummary).toBeNull();
});

test("returning from a mode conflict opens the active timer instead of being sent home", async () => {
	await restoreLegacyCountup({ running: true });
	await focus("countdown");
	router.replace.mockImplementationOnce(() => {
		mockListeners.get("countdown")?.({ preventDefault: jest.fn() });
	});
	await act(async () => press("returnToActiveTimer"));
	expect(router.replace.mock.calls).toEqual([["/(tabs)/session/countup"]]);
});

test("discarding an active timer to enter manual mode opens only the chosen manual summary", async () => {
	await act(async () => press("start"));
	await focus("manual");
	await act(async () => press("discardAndSwitchTimer"));
	expect(currentSession.started).toBe(false);
	expect(currentSession.mode).toBeNull();
	await act(async () => press("homeSession"));
	expect(currentSession.pendingSummary).toEqual(expect.objectContaining({ mode: "home", recordMode: "manual", editableTiming: true }));
	await act(async () => currentSession.updatePendingSummaryDraft(currentSession.pendingSummary.id, { journal: "first draft" }));
	await act(async () => press("discardSummary"));
	await focus("home");
	await focus("manual");
	await act(async () => press("outdoorSession"));
	expect(currentSession.pendingSummary).toEqual(expect.objectContaining({ mode: "outdoor", recordMode: "manual" }));
	expect(currentSession.pendingSummaryDraft).toBeNull();
});

test("invalid countdown duration can be corrected and started without leaving the screen", async () => {
	await focus("countdown");
	const input = tree.root.findByType(TextInput);
	await act(async () => input.props.onChangeText("0"));
	await act(async () => press("start"));
	expect(showAlert).toHaveBeenLastCalledWith("", "countdownDurationInvalid");
	expect(currentSession.started).toBe(false);
	await act(async () => input.props.onChangeText("1"));
	await act(async () => press("start"));
	expect(currentSession).toEqual(expect.objectContaining({ recordMode: "countdown", running: true, targetDurationSec: 60 }));
});

test("back from a floating timer returns to the same facility including its id and source", async () => {
	await act(async () => press("start"));
	mockSessionParams = { fromFloating: "1", returnTo: "/outdoor/detail?id=0&from=ai" };
	await act(async () => tree.update(app()));
	const header = mockNavigation.get("countdown").setOptions.mock.calls.at(-1)[0].headerLeft();
	await act(async () => header.props.onPress());
	expect(router.dismissTo).toHaveBeenCalledWith("/outdoor/detail?id=0&from=ai");
	expect(currentSession.started).toBe(true);
	expect(currentSession.running).toBe(true);
});

test("a persisted legacy count-up can resume and pause, but discard and reopening never create another timer", async () => {
	await restoreLegacyCountup();
	expect(currentSession).toEqual(expect.objectContaining({ recordMode: "countup", started: true, running: false, seconds: 90 }));
	await act(async () => press("resume"));
	expect(currentSession.running).toBe(true);
	await act(async () => press("pause"));
	expect(currentSession.running).toBe(false);
	await act(async () => press("discardSession"));
	await act(async () => showAlert.mock.calls.at(-1)[2].find((button) => button.style === "destructive").onPress());
	await focus("home");
	router.replace.mockClear();
	await focus("countup");
	expect(currentSession).toEqual(expect.objectContaining({ mode: null, started: false, pendingSummary: null }));
	expect(router.replace).toHaveBeenCalledTimes(1);
	expect(router.replace).toHaveBeenCalledWith("/(tabs)");
	expect(() => press("start")).toThrow("was not found");
});

test("finishing a persisted legacy count-up keeps its real summary until explicitly discarded", async () => {
	await restoreLegacyCountup();
	await act(async () => currentSession.finishSession());
	expect(currentSession.pendingSummary).toEqual(expect.objectContaining({ recordMode: "countup", durationSec: 90 }));
	expect(mockRemovalGuards.get("countup")).toBe(true);
	expect(tree.root.findAllByType(Text).filter((node) => node.props.children === "discardSummary")).toHaveLength(1);
	await act(async () => press("discardSummary"));
	await focus("home");
	router.replace.mockClear();
	await focus("countup");
	expect(currentSession.pendingSummary).toBeNull();
	expect(currentSession.mode).toBeNull();
	expect(router.replace).toHaveBeenCalledWith("/(tabs)");
});

test("retired count-up and old default routes never reset or take over a running countdown", async () => {
	await act(async () => press("start"));
	const timerId = currentSession.timerId;
	for (const route of ["countup", "index"]) {
		await focus("home");
		router.replace.mockClear();
		await focus(route);
		expect(router.replace).toHaveBeenCalledTimes(1);
		expect(router.replace).toHaveBeenCalledWith("/(tabs)");
		expect(currentSession).toEqual(expect.objectContaining({ timerId, started: true, running: true, recordMode: "countdown" }));
		expect(() => press("discardAndSwitchTimer")).toThrow("was not found");
	}
});
