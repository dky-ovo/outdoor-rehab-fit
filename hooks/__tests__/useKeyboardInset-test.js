import React from "react";
import { act, create } from "react-test-renderer";
import { Dimensions, Keyboard, Platform, StatusBar } from "react-native";
import { useKeyboardInset } from "../useKeyboardInset";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, state, events, onDimensions, bounds, size, screen, metrics;
const originalOS = Platform.OS;
function Probe({ nativeAndroid = false }) { state = useKeyboardInset({ nativeAndroid }); return null; }
beforeEach(() => {
	events = {}; bounds = { y: 90, height: 710 }; size = { width: 400, height: 800 }; screen = { width: 400, height: 800 + (StatusBar.currentHeight || 0) }; metrics = null; Platform.OS = "android";
	jest.spyOn(Dimensions, "get").mockImplementation(name => name === 'screen' ? screen : size);
	jest.spyOn(Dimensions, "addEventListener").mockImplementation((_event, listener) => { onDimensions = listener; return { remove: jest.fn() }; });
	jest.spyOn(Keyboard, "addListener").mockImplementation((name, callback) => { events[name] = callback; return { remove: jest.fn() }; });
	jest.spyOn(Keyboard, "metrics").mockImplementation(() => metrics);
	jest.spyOn(Keyboard, "isVisible").mockImplementation(() => Boolean(metrics));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; jest.restoreAllMocks(); });
async function mount(measured = true) {
	await act(async () => { tree = create(<Probe />); });
	if (measured) state.containerRef.current = { measureInWindow: callback => callback(0, bounds.y, 400, bounds.height) };
	await act(async () => state.onLayout());
}
async function show(screenY = 500, height = 300) {
	metrics = { screenY, height };
	await act(async () => events[Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"]({ endCoordinates: metrics }));
}
test("Android adjustResize adds no second lift; overlay adds only measured overlap", async () => {
	await mount(); bounds.height = 410; size.height = 500; await show();
	expect(state.visible).toBe(true); expect(state.inset).toBe(0);
	bounds.height = 710; size.height = 800; await act(async () => state.onLayout()); expect(state.inset).toBe(300);
	bounds.height = 610; await act(async () => state.onLayout()); expect(state.inset).toBe(200);
});
test("Dimensions resize cannot hide an unchanged measured container behind the keyboard", async () => {
	await mount();
	size = { width: 400, height: 500 };
	await act(async () => onDimensions({ window: size }));
	await show(); // Window reports shrink first; actual View still ends at 800.
	expect(state.visible).toBe(true); expect(state.inset).toBe(300);
	bounds.height = 610;
	await act(async () => state.onLayout()); expect(state.inset).toBe(200);
	bounds.height = 410;
	await act(async () => state.onLayout()); expect(state.inset).toBe(0);
});
test("invalid native measurement falls back to window resize without adding a second lift", async () => {
	await mount();
	size = { width: 400, height: 500 };
	bounds.height = 0;
	await show(); expect(state.inset).toBe(0);
});
test("late native resize, IME height changes and rotations update measured overlap", async () => {
	await mount(); await show(); expect(state.inset).toBe(300);
	bounds.height = 410; await act(async () => state.onLayout()); expect(state.inset).toBe(0);
	metrics = { screenY: 450, height: 350 };
	await act(async () => events.keyboardDidChangeFrame({ endCoordinates: metrics })); expect(state.inset).toBe(50);
	bounds = { y: 50, height: 350 }; size = { width: 800, height: 400 }; screen = { width: 800, height: 400 + (StatusBar.currentHeight || 0) }; metrics = { screenY: 200, height: 200 };
	await act(async () => onDimensions({ window: size })); expect(state.inset).toBe(200);
});
test('Android status-bar origin cancels between closed/current container measurements', async () => {
	bounds = { y: 64, height: 712 }; // bottom=776 in window coords, not screen bottom=800
	await mount();
	await show(500, 300); expect(state.inset).toBe(300);
	bounds.height = 412; size.height = 500;
	await act(async () => state.onLayout()); expect(state.inset).toBe(0);
});
test('mounting while adjustResize already applied does not add a second keyboard height', async () => {
	size = { width: 400, height: 500 };
	metrics = { screenY: 500 + (StatusBar.currentHeight || 0), height: 300 };
	bounds.height = 410;
	await mount(); expect(state.visible).toBe(true); expect(state.inset).toBe(0);
});
test('layout shrinking before both show and Dimensions events cannot replace the closed baseline', async () => {
	await mount();
	bounds.height = 410;
	await act(async () => state.onLayout()); // Dimensions still says 800; keyboard event is late
	await show(); expect(state.inset).toBe(0);
});
test('rotation estimates native resize using the new keyboard frame and independent screen size', async () => {
	await mount(); await show();
	size = { width: 800, height: 200 };
	screen = { width: 800, height: 400 + (StatusBar.currentHeight || 0) };
	metrics = { screenY: 200 + (StatusBar.currentHeight || 0), height: 200 };
	bounds = { y: 50, height: 150 };
	await act(async () => onDimensions({ window: size }));
	expect(state.visible).toBe(true); expect(state.inset).toBe(0);
});
test("keyboard hiding invalidates a pending native measurement", async () => {
	await mount(); let delayed;
	state.containerRef.current = { measureInWindow: callback => { delayed = callback; } };
	await show(); metrics = null; await act(async () => events.keyboardDidHide());
	await act(async () => delayed(0, 90, 400, 710)); expect(state.visible).toBe(false); expect(state.inset).toBe(0);
});
test("legacy unmeasured caller tolerates resize before the show event", async () => {
	await mount(false); size = { width: 400, height: 500 };
	await act(async () => onDimensions({ window: size })); await show(); expect(state.inset).toBe(0);
});
test("iOS leaves avoidance to KeyboardAvoidingView and hardware keyboard has no inset", async () => {
	Platform.OS = "ios"; await mount(); await show(); expect(state.visible).toBe(true); expect(state.inset).toBe(0);
	await act(async () => events.keyboardWillHide()); expect(state.visible).toBe(false); expect(state.inset).toBe(0);
});


test("native Android chat opts out of JS keyboard, Dimensions and measurement layout work", async () => {
	await act(async () => { tree = create(<Probe nativeAndroid />); });
	const measure = jest.fn(); state.containerRef.current = { measureInWindow: measure };
	await act(async () => state.onLayout());
	expect(Keyboard.addListener).not.toHaveBeenCalled();
	expect(Dimensions.addEventListener).not.toHaveBeenCalled();
	expect(measure).not.toHaveBeenCalled();
	expect(state.inset).toBe(0);
});
