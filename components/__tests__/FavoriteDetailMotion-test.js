import React from "react";
import { act, create } from "react-test-renderer";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import FavoriteDetailMotion from "../FavoriteDetailMotion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
let tree, animations, changeMotion;
beforeEach(() => {
	mockFocused = true; animations = [];
	jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
	jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((_name, listener) => { changeMotion = listener; return { remove: jest.fn() }; });
	jest.spyOn(Animated, "timing").mockImplementation((value, options) => {
		const animation = { start: jest.fn(), stop: jest.fn() }; animations.push({ value, options, animation }); return animation;
	});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });
const mount = async () => act(async () => { tree = create(<FavoriteDetailMotion>detail</FavoriteDetailMotion>); });

test("incoming detail scales from 0.96 to 1 using the native driver without translation", async () => {
	await mount(); const first = animations[0];
	expect(first.value.__getValue()).toBe(0.96);
	expect(first.options).toMatchObject({ toValue: 1, duration: 150, useNativeDriver: true, isInteraction: false });
	expect(StyleSheet.flatten(tree.root.findByProps({ testID: "favorite-detail-motion" }).props.style).transform).toEqual([{ scale: first.value }]);
});

test("outgoing detail stops at its natural size and never animates larger", async () => {
	await mount(); mockFocused = false;
	await act(async () => tree.update(<FavoriteDetailMotion>detail</FavoriteDetailMotion>));
	expect(animations).toHaveLength(1); expect(animations[0].animation.stop).toHaveBeenCalledTimes(1);
	expect(animations[0].value.__getValue()).toBe(1);
});

test("reduced motion cancels the incoming scale", async () => {
	await mount(); await act(async () => changeMotion(true));
	expect(animations).toHaveLength(1); expect(animations[0].value.__getValue()).toBe(1);
});
