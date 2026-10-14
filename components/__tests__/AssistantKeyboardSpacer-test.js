import React from "react";
import { act, create } from "react-test-renderer";
import { Keyboard, StyleSheet, View } from "react-native";
import AssistantKeyboardSpacer from "../AssistantKeyboardSpacer.android";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockKeyboard = { height: { value: 0 }, state: { value: 4 } };
const mockSubscribe = jest.fn(), mockUnsubscribe = jest.fn();
const mockStyles = [], mockReactions = [], mockJSQueue = [];
jest.mock("react-native-is-edge-to-edge", () => ({ isEdgeToEdge: () => true }));
jest.mock("react-native-reanimated", () => {
	const React = require("react");
	return {
		__esModule: true, default: { View: "AnimatedView" },
		KeyboardState: { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 },
		useAnimatedKeyboard: options => {
			React.useEffect(() => { mockSubscribe(options); return mockUnsubscribe; }, []);
			return mockKeyboard;
		},
		useAnimatedStyle: factory => { mockStyles.push(factory); return factory(); },
		useSharedValue: initial => React.useRef({ value: initial }).current,
		runOnJS: fn => (...args) => { mockJSQueue.push(() => fn(...args)); },
		useAnimatedReaction: (prepare, react) => {
			const latest = React.useRef(); latest.current = () => react(prepare());
			React.useEffect(() => {
				const callback = () => latest.current();
				mockReactions.push(callback);
				return () => { mockReactions.splice(mockReactions.indexOf(callback), 1); };
			}, []);
			React.useEffect(() => { latest.current(); });
		},
	};
});
let tree, events, visible, metrics;
const onInsetChange = jest.fn();
const childMounted = jest.fn(), childUnmounted = jest.fn();
function Child() { React.useEffect(() => { childMounted(); return childUnmounted; }, []); return <View testID="composer-child" />; }
const render = async (active = true, bottomInset = 24) => act(async () => {
	const component = <AssistantKeyboardSpacer active={active} bottomInset={bottomInset} onInsetChange={onInsetChange}><Child /></AssistantKeyboardSpacer>;
	if (tree) tree.update(component); else tree = create(component);
});
const style = () => mockStyles.at(-1)();
const nativeFrame = (state, height) => { mockKeyboard.state.value = state; mockKeyboard.height.value = height; mockReactions.forEach(callback => callback()); return -style().transform[0].translateY; };
const flushJS = async () => act(async () => { while (mockJSQueue.length) mockJSQueue.shift()(); jest.advanceTimersByTime(60); });
beforeEach(() => {
	jest.useFakeTimers(); events = {}; visible = false; metrics = null;
	mockKeyboard.height.value = 0; mockKeyboard.state.value = 4;
	mockStyles.length = 0; mockReactions.length = 0; mockJSQueue.length = 0; jest.clearAllMocks();
	jest.spyOn(Keyboard, "isVisible").mockImplementation(() => visible);
	jest.spyOn(Keyboard, "metrics").mockImplementation(() => metrics);
	jest.spyOn(Keyboard, "addListener").mockImplementation((name, fn) => { events[name] = fn; return { remove: jest.fn() }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test("composer follows native opening/end frames while JS events and layout updates are blocked", async () => {
	await render(); await flushJS(); onInsetChange.mockClear();
	expect(mockSubscribe).toHaveBeenCalledWith(undefined);
	expect(nativeFrame(1, 120)).toBe(106);
	expect(nativeFrame(1, 240)).toBe(226);
	expect(nativeFrame(2, 300)).toBe(286); // no keyboardDidShow and no JS drain
	expect(onInsetChange).not.toHaveBeenCalled();
	expect(style()).toEqual({ transform: [{ translateY: -286 }] });
	expect(style()).not.toHaveProperty("height");
	expect(style()).not.toHaveProperty("paddingBottom");
	await flushJS(); expect(onInsetChange).toHaveBeenLastCalledWith(286);
});

test("open emoji/panel heights move immediately, coalescing only the oldest-message scroll allowance", async () => {
	visible = true; metrics = { height: 276 }; await render(); await flushJS(); onInsetChange.mockClear();
	expect(nativeFrame(2, 300)).toBe(286);
	expect(nativeFrame(2, 440)).toBe(426);
	expect(nativeFrame(2, 210)).toBe(196);
	expect(onInsetChange).not.toHaveBeenCalled();
	await flushJS(); expect(onInsetChange.mock.calls).toEqual([[196]]);
});

test("safe area is reserved once for gesture and three-button navigation", async () => {
	visible = true; await render(true, 48);
	expect(nativeFrame(4, 0) + 48).toBe(48);
	expect(nativeFrame(2, 348) + 48).toBe(358);
	await render(true, 0);
	expect(nativeFrame(2, 300) + 10).toBe(310);
	expect(nativeFrame(2, -1)).toBe(0);
	expect(mockSubscribe).toHaveBeenCalledTimes(1);
});

test("blur releases the global observer but keeps input/list mounted and discards queued JS insets", async () => {
	await render(false); expect(mockSubscribe).not.toHaveBeenCalled();
	await render(true); await render(true); await render(true, 32);
	expect(mockSubscribe).toHaveBeenCalledTimes(1);
	nativeFrame(1, 140); nativeFrame(2, 320);
	await render(false); onInsetChange.mockClear(); await flushJS();
	expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
	expect(style().transform[0].translateY).toBe(0);
	expect(onInsetChange).not.toHaveBeenCalled();
	expect(childMounted).toHaveBeenCalledTimes(1); expect(childUnmounted).not.toHaveBeenCalled();
	await render(true); expect(mockSubscribe).toHaveBeenCalledTimes(2);
	expect(childMounted).toHaveBeenCalledTimes(1);
});

test("return after IME closed elsewhere ignores persistent native OPEN height", async () => {
	await render(); nativeFrame(1, 100); expect(nativeFrame(2, 300)).toBe(286);
	await render(false); mockKeyboard.state.value = 0; mockKeyboard.height.value = 0;
	await render(); expect(nativeFrame(0, 0)).toBe(0);
	expect(nativeFrame(2, 300)).toBe(0);
});

test("already-open UNKNOWN mount uses metrics, while closing and CLOSED beat delayed RN hide", async () => {
	visible = true; metrics = { height: 276 }; mockKeyboard.state.value = 0;
	await render(); expect(nativeFrame(0, 0)).toBe(286);
	expect(nativeFrame(3, 100)).toBe(86);
	expect(nativeFrame(4, 0)).toBe(0);
	await flushJS(); expect(onInsetChange).toHaveBeenLastCalledWith(0);
});

test("rapid close/open follows every native frame and does not resurrect a closed keyboard", async () => {
	await render(); expect(nativeFrame(1, 120)).toBe(106);
	expect(nativeFrame(2, 300)).toBe(286);
	expect(nativeFrame(3, 80)).toBe(66);
	expect(nativeFrame(4, 0)).toBe(0);
	expect(nativeFrame(1, 90)).toBe(76);
	expect(nativeFrame(2, 290)).toBe(276);
	await flushJS(); expect(onInsetChange).toHaveBeenLastCalledWith(276);
	await act(async () => events.keyboardDidHide()); // queued old RN event
	expect(nativeFrame(2, 290)).toBe(276);
});

test("viewport clips only the translated body and uses a transform with normal Fabric hit testing", async () => {
	await render();
	const viewport = tree.root.findByProps({ testID: "assistant-keyboard-viewport" });
	expect(StyleSheet.flatten(viewport.props.style)).toEqual({ flex: 1, overflow: "hidden" });
	const body = tree.root.findByType("AnimatedView");
	expect(body.findByProps({ testID: "composer-child" })).toBeDefined();
	expect(StyleSheet.flatten(body.props.style).flex).toBe(1);
	expect(body.props.pointerEvents).toBeUndefined();
});


test("first native OPEN and later CLOSED to OPEN do not depend on JS or observing OPENING", async () => {
	mockKeyboard.state.value = 0; await render(); await flushJS(); onInsetChange.mockClear();
	expect(nativeFrame(2, 300)).toBe(286); // system disabled/coalesced animation
	expect(nativeFrame(4, 0)).toBe(0);
	expect(nativeFrame(2, 320)).toBe(306);
	expect(onInsetChange).not.toHaveBeenCalled();
});

test("after suppressing only the initial stale OPEN, a changed native height is fresh without JS", async () => {
	await render(); nativeFrame(2, 300); await render(false);
	mockKeyboard.state.value = 0; mockKeyboard.height.value = 0; await render();
	expect(nativeFrame(2, 300)).toBe(0);
	expect(nativeFrame(2, 340)).toBe(326);
	expect(nativeFrame(2, 300)).toBe(286); // original size is not permanently blacklisted
});
