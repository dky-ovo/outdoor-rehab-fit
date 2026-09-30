import React from "react";
import renderer, { act } from "react-test-renderer";
import { router } from "expo-router";
import TimerNotificationRoute from "../../app/timer-notification";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockActive;
let mockParams;
jest.mock("expo-router", () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock("../../contexts/ActiveSessionContext", () => ({ useActiveSession: () => mockActive }));
let tree;
const mount = async () => { await act(async () => { tree = renderer.create(<TimerNotificationRoute />); }); };
beforeEach(() => {
	jest.clearAllMocks();
	mockActive = { hydrated: true, started: true, recordMode: "countup", timerId: "current-timer" };
	mockParams = { recordMode: "countup", timerId: "current-timer" };
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each(["countup", "countdown"])("native %s notice enters its matching timer", async (recordMode) => {
	mockActive.recordMode = recordMode; mockParams.recordMode = recordMode;
	await mount(); expect(router.replace).toHaveBeenCalledWith(`/(tabs)/session/${recordMode}`);
});
test("cold start waits for account and timer hydration", async () => {
	mockActive.hydrated = false; await mount(); expect(router.replace).not.toHaveBeenCalled();
	mockActive = { ...mockActive, hydrated: true };
	await act(async () => tree.update(<TimerNotificationRoute />));
	expect(router.replace).toHaveBeenCalledWith("/(tabs)/session/countup");
});
test.each([
	{ timerId: "old-account-timer", recordMode: "countup" },
	{ timerId: "current-timer", recordMode: "countdown" },
	{ timerId: ["current-timer", "old-timer"], recordMode: "countup" },
	{ timerId: "current-timer", recordMode: "manual" },
])( "invalid or stale deep links do not open or initialise a timer (%j)", async (params) => {
	mockParams = params; await mount(); expect(router.replace).toHaveBeenCalledWith("/");
});
test("completed unsaved summary can still be opened from its notice", async () => {
	mockActive = { hydrated: true, started: false, pendingSummary: { timerId: "current-timer", recordMode: "countup" } };
	await mount(); expect(router.replace).toHaveBeenCalledWith("/(tabs)/session/countup");
});
test("a pure completed countdown deep link opens only its existing zero-state timer", async () => {
	mockActive = { hydrated: true, started: true, running: false, completed: true,
		recordMode: "countdown", timerId: "current-timer", seconds: 0, pendingSummary: null };
	mockParams.recordMode = "countdown";
	await mount();
	expect(router.replace).toHaveBeenCalledWith("/(tabs)/session/countdown");
	expect(mockActive.pendingSummary).toBeNull();
});
test("a retired completed timer link cannot open a newer countdown", async () => {
	mockActive = { hydrated: true, started: true, completed: true, recordMode: "countdown", timerId: "new-timer" };
	mockParams.recordMode = "countdown";
	await mount(); expect(router.replace).toHaveBeenCalledWith("/");
});
test("an explicit legacy countdown draft link remains recoverable", async () => {
	mockActive = { hydrated: true, started: false, pendingSummary: { id: "legacy-draft", timerId: "current-timer", recordMode: "countdown" } };
	mockParams.recordMode = "countdown";
	await mount(); expect(router.replace).toHaveBeenCalledWith("/(tabs)/session/countdown");
});
test("abandoning a timer makes its notice return to normal startup", async () => {
	mockActive = { hydrated: true, started: false, pendingSummary: null };
	await mount(); expect(router.replace).toHaveBeenCalledWith("/");
});
