import React from "react";
import { act, create } from "react-test-renderer";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import SettingsScreenMotion from "../SettingsScreenMotion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
let tree, animations, changeMotion, removeListener;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const render = async () => { await act(async () => { tree = create(<SettingsScreenMotion>content</SettingsScreenMotion>); }); };
beforeEach(() => {
	mockFocused = true;
	animations = [];
	removeListener = jest.fn();
	jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
	jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((_name, listener) => { changeMotion = listener; return { remove: removeListener }; });
	jest.spyOn(Animated, "timing").mockImplementation((value, options) => {
		const animation = { start: jest.fn(), stop: jest.fn() };
		animations.push({ value, options, animation });
		return animation;
	});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("focus uses a small native-driven scale, never a horizontal transform or measured layout change", async () => {
	await render();
	const first = animations[0];
	expect(first.value.__getValue()).toBe(0.96);
	expect(first.options).toMatchObject({ toValue: 1, duration: 150, useNativeDriver: true, isInteraction: false });
	expect(first.animation.start).toHaveBeenCalledTimes(1);
	const style = StyleSheet.flatten(tree.root.findByProps({ testID: "settings-screen-motion" }).props.style);
	expect(Object.keys(style)).toEqual(["flex", "transform"]);
	expect(style.transform).toEqual([{ scale: first.value }]);
});

test("leaving and returning cancel the prior animation and keep a consistent scale-only effect", async () => {
	await render();
	mockFocused = false;
	await act(async () => tree.update(<SettingsScreenMotion>content</SettingsScreenMotion>));
	expect(animations[0].animation.stop).toHaveBeenCalledTimes(1);
	expect(animations[1].options.toValue).toBe(1.02);
	mockFocused = true;
	await act(async () => tree.update(<SettingsScreenMotion>content</SettingsScreenMotion>));
	expect(animations[1].animation.stop).toHaveBeenCalledTimes(1);
	expect(animations[2].options.toValue).toBe(1);
	expect(animations[2].value.__getValue()).toBe(0.96);
});

test("reduced motion stops scale and keeps both focused and outgoing content at its normal size", async () => {
	AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true);
	await render();
	expect(animations[0].animation.stop).toHaveBeenCalledTimes(1);
	expect(animations[0].value.__getValue()).toBe(1);
	const count = animations.length;
	mockFocused = false;
	await act(async () => tree.update(<SettingsScreenMotion>content</SettingsScreenMotion>));
	expect(animations).toHaveLength(count);
	expect(animations[0].value.__getValue()).toBe(1);
});

test("an old accessibility query cannot undo a newer reduced-motion change", async () => {
	const pending = deferred();
	AccessibilityInfo.isReduceMotionEnabled.mockReturnValue(pending.promise);
	await render();
	await act(async () => changeMotion(true));
	await act(async () => pending.resolve(false));
	expect(animations).toHaveLength(1);
	expect(animations[0].value.__getValue()).toBe(1);
});

test("unmount cancels motion and detaches accessibility updates", async () => {
	await render();
	await act(async () => tree.unmount()); tree = null;
	expect(animations[0].animation.stop).toHaveBeenCalledTimes(1);
	expect(removeListener).toHaveBeenCalledTimes(1);
});
