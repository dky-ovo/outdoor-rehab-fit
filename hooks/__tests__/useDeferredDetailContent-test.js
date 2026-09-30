import React from "react";
import { act, create } from "react-test-renderer";
import { Platform } from "react-native";
import useDeferredDetailContent from "../useDeferredDetailContent";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
const mockNavigation = { addListener: jest.fn() };
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ useNavigation: () => mockNavigation }));
let tree, ready, endTransition, unsubscribe;
const originalOS = Platform.OS;
function Probe({ id = "0" }) { ready = useDeferredDetailContent(id); return null; }
beforeEach(() => {
	jest.useFakeTimers(); jest.clearAllMocks(); Platform.OS = "android"; mockFocused = true;
	jest.spyOn(global, "setTimeout"); jest.spyOn(global, "clearTimeout");
	unsubscribe = jest.fn(); endTransition = null;
	mockNavigation.addListener.mockImplementation((name, listener) => { expect(name).toBe("transitionEnd"); endTransition = listener; return unsubscribe; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; jest.restoreAllMocks(); jest.useRealTimers(); });
const mount = async () => act(async () => { tree = create(<Probe />); });
const pendingFallback = () => setTimeout.mock.results[setTimeout.mock.calls.findIndex(call => call[1] === 400)].value;

test("native content is deferred until opening transition completes, then timer/listener are removed", async () => {
	await mount(); expect(ready).toBe(false); const timer = pendingFallback();
	await act(async () => endTransition({ data: { closing: true } })); expect(ready).toBe(false);
	await act(async () => endTransition({ data: { closing: false } })); expect(ready).toBe(true);
	expect(unsubscribe).toHaveBeenCalledTimes(1); expect(clearTimeout).toHaveBeenCalledWith(timer);
});

test("a native deep link without a transition event uses a bounded 400ms fallback", async () => {
	await mount(); await act(async () => jest.advanceTimersByTime(399)); expect(ready).toBe(false);
	await act(async () => jest.advanceTimersByTime(1)); expect(ready).toBe(true);
});

test("blur cancels pending work and stale transition callbacks; refocus starts a new bounded wait", async () => {
	await mount(); const stale = endTransition;
	mockFocused = false; await act(async () => tree.update(<Probe />));
	await act(async () => { jest.advanceTimersByTime(800); stale({ data: { closing: false } }); });
	expect(ready).toBe(false); expect(unsubscribe).toHaveBeenCalledTimes(1);
	mockFocused = true; await act(async () => tree.update(<Probe />));
	await act(async () => jest.advanceTimersByTime(400)); expect(ready).toBe(true);
});

test("already mounted players are retained across blur and return", async () => {
	await mount(); await act(async () => endTransition({ data: { closing: false } }));
	mockFocused = false; await act(async () => tree.update(<Probe />)); expect(ready).toBe(true);
	mockFocused = true; await act(async () => tree.update(<Probe />)); expect(ready).toBe(true);
	expect(mockNavigation.addListener).toHaveBeenCalledTimes(1);
});

test("changing equipment cancels the old completion and waits for the new screen", async () => {
	await mount(); const stale = endTransition;
	await act(async () => tree.update(<Probe id="1" />));
	await act(async () => stale({ data: { closing: false } })); expect(ready).toBe(false);
	await act(async () => endTransition({ data: { closing: false } })); expect(ready).toBe(true);
});

test("web content is immediate and never registers a native timer or event", async () => {
	Platform.OS = "web"; await mount(); expect(ready).toBe(true);
	expect(mockNavigation.addListener).not.toHaveBeenCalled(); expect(setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 400);
});

test("unmount clears the fallback and rejects late transition completion", async () => {
	await mount(); const stale = endTransition; const timer = pendingFallback();
	await act(async () => tree.unmount()); tree = null;
	expect(clearTimeout).toHaveBeenCalledWith(timer); expect(unsubscribe).toHaveBeenCalledTimes(1);
	await act(async () => stale({ data: { closing: false } })); expect(ready).toBe(false);
});
