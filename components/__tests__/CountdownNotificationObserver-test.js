import React from "react";
import renderer, { act } from "react-test-renderer";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import CountdownNotificationObserver from "../CountdownNotificationObserver";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockActive;
let mockPathname = "/";
let mockSegments = ["(tabs)"];
let listener;
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => mockPathname, useSegments: () => mockSegments }));
jest.mock("../../contexts/ActiveSessionContext", () => ({ useActiveSession: () => mockActive }));
jest.mock("expo-notifications", () => ({
	setNotificationHandler: jest.fn(), addNotificationResponseReceivedListener: jest.fn(),
	getLastNotificationResponseAsync: jest.fn(), clearLastNotificationResponseAsync: jest.fn(async () => {}),
}));
const response = (timerId = "timer-a", id = "notice-a") => ({ notification: { request: { identifier: id, content: { data: { type: "countdown", timerId, phase: "complete" } } } } });
let tree;
const mount = async () => { await act(async () => { tree = renderer.create(<CountdownNotificationObserver />); }); };
beforeEach(() => {
	jest.clearAllMocks();
	mockActive = { hydrated: true, recordMode: "countdown", started: true, countdownId: "timer-a" };
	mockPathname = "/";
	mockSegments = ["(tabs)"];
	Notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
	Notifications.addNotificationResponseReceivedListener.mockImplementation((callback) => { listener = callback; return { remove: jest.fn() }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("tapping a current timer notification opens its route once", async () => {
	Notifications.getLastNotificationResponseAsync.mockResolvedValue(response());
	await mount();
	await act(async () => listener(response()));
	expect(router.navigate).toHaveBeenCalledTimes(1);
	expect(router.navigate).toHaveBeenCalledWith("/session/countdown");
});
test("a legacy pending summary accepts an explicit matching notification tap", async () => {
	mockActive = { hydrated: true, pendingSummary: { recordMode: "countdown", countdownId: "timer-a" } };
	await mount(); await act(async () => listener(response()));
	expect(router.navigate).toHaveBeenCalledTimes(1);
});
test("a pure completed countdown notification returns to its zero screen without creating a record", async () => {
	mockActive = { ...mockActive, completed: true, running: false, seconds: 0, pendingSummary: null };
	await mount(); await act(async () => listener(response()));
	expect(router.navigate).toHaveBeenCalledWith("/session/countdown");
	expect(mockActive.pendingSummary).toBeNull();
});
test("a completed timer does not navigate without a user notification response", async () => {
	mockActive = { ...mockActive, completed: true, running: false, seconds: 0, pendingSummary: null };
	await mount();
	expect(router.navigate).not.toHaveBeenCalled();
});
test("the grouped countdown pathname does not push a duplicate screen", async () => {
	mockPathname = "/(tabs)/session/countdown";
	await mount(); await act(async () => listener(response()));
	expect(router.navigate).not.toHaveBeenCalled();
});
test("already viewing countdown does not push a duplicate screen", async () => {
	mockPathname = "/session/countdown";
	await mount(); await act(async () => listener(response()));
	expect(router.navigate).not.toHaveBeenCalled();
	expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
});
test("old or abandoned timer notifications cannot revive a discarded record", async () => {
	mockActive = { hydrated: true, started: false, countdownId: null, pendingSummary: null };
	await mount(); await act(async () => listener(response()));
	expect(router.navigate).not.toHaveBeenCalled();
});
test("a notification for a previous login cannot open the new account's timer", async () => {
	await mount();
	mockActive = { hydrated: true, recordMode: "countdown", started: true, countdownId: "timer-b" };
	await act(async () => tree.update(<CountdownNotificationObserver />));
	await act(async () => listener(response()));
	expect(router.navigate).not.toHaveBeenCalled();
});
test("cold launch waits until restored timer identity is available", async () => {
	mockActive = { hydrated: false };
	Notifications.getLastNotificationResponseAsync.mockResolvedValue(response());
	await mount();
	expect(Notifications.getLastNotificationResponseAsync).not.toHaveBeenCalled();
	mockActive = { hydrated: true, recordMode: "countdown", started: true, countdownId: "timer-a" };
	await act(async () => tree.update(<CountdownNotificationObserver />));
	expect(router.navigate).toHaveBeenCalledTimes(1);
});

test("a startup Home redirect cannot replace the notification destination", async () => {
	mockSegments = [];
	Notifications.getLastNotificationResponseAsync.mockResolvedValue(response());
	await mount();
	expect(Notifications.getLastNotificationResponseAsync).not.toHaveBeenCalled();
	mockSegments = ["(tabs)"];
	await act(async () => tree.update(<CountdownNotificationObserver />));
	expect(router.navigate).toHaveBeenCalledWith("/session/countdown");
});

test.each(["countup", "countdown"])("a %s status notification opens the matching timer", async (recordMode) => {
	mockActive = { hydrated: true, recordMode, started: true, timerId: "timer-a" };
	await mount();
	await act(async () => listener({ notification: { request: { identifier: "status-notice", content: { data: {
		type: "session-timer", timerId: "timer-a", recordMode,
	} } } } }));
	expect(router.navigate).toHaveBeenCalledWith(`/session/${recordMode}`);
});

test("reusing the status identifier for a new timer does not block its click", async () => {
	mockActive = { hydrated: true, recordMode: "countup", started: true, timerId: "timer-a" };
	const status = (timerId) => ({ notification: { request: { identifier: "status-notice", content: { data: { type: "session-timer", recordMode: "countup", timerId } } } } });
	await mount(); await act(async () => listener(status("timer-a")));
	mockActive = { ...mockActive, timerId: "timer-b" };
	await act(async () => tree.update(<CountdownNotificationObserver />));
	await act(async () => listener(status("timer-b")));
	expect(router.navigate).toHaveBeenCalledTimes(2);
});
