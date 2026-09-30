import React from "react";
import renderer, { act } from "react-test-renderer";
import { Animated, PanResponder, Platform, TouchableOpacity, View } from "react-native";
import FloatingAssistantVoice from "../FloatingAssistantVoice";
import { floatingVoiceBounds, getFloatingTimerObstacle, publishFloatingTimerObstacle, snapVoicePosition, voiceOverlapsTimer } from "../../utils/floatingVoiceLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockWindow = { width: 320, height: 640 }, mockInsets = { top: 24, bottom: 24, left: 0, right: 0 };
jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  return Object.defineProperty(Object.create(native), "useWindowDimensions", { value: () => mockWindow, enumerable: true });
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
let tree, gesture, onPress, now;
const owner = Symbol("timer-test");
const mount = async props => act(async () => { tree = renderer.create(<FloatingAssistantVoice locale="zh" onPress={onPress} {...props} />); });
const button = () => tree.root.findByType(TouchableOpacity);
const point = () => {
  const node = tree.root.findAll(node => node.props.testID === "home-voice-floating-position")[0];
  const transforms = node.props.style[1].transform;
  return { x: transforms[0].translateX.__getValue(), y: transforms[1].translateY.__getValue() };
};
const drag = async (dx, dy, move = true) => act(async () => {
  gesture.onPanResponderGrant();
  if (move) gesture.onPanResponderMove({}, { dx, dy });
  gesture.onPanResponderRelease({}, { dx, dy });
});
beforeEach(() => {
  mockWindow = { width: 320, height: 640 }; mockInsets = { top: 24, bottom: 24, left: 0, right: 0 }; Platform.OS = "android";
  now = 1000; onPress = jest.fn(); jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(PanResponder, "create").mockImplementation(config => { gesture = config; return { panHandlers: {} }; });
  jest.spyOn(Animated, "spring").mockImplementation((value, config) => ({ start: () => value.setValue(config.toValue) }));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; publishFloatingTimerObstacle(owner, null); jest.restoreAllMocks(); });

test("initially docks at the right edge above Android bottom navigation", async () => {
  await mount(); expect(point()).toEqual({ x: 236, y: 450 }); expect(onPress).not.toHaveBeenCalled();
});
test("drag snaps left, stays within safe bounds, and cannot accidentally launch voice", async () => {
  await mount(); await drag(-1000, -1000); expect(point()).toEqual({ x: 8, y: 32 });
  await act(async () => button().props.onPress()); expect(onPress).not.toHaveBeenCalled();
  now += 500; await drag(0, 0); await act(async () => button().props.onPress()); expect(onPress).toHaveBeenCalledTimes(1);
});
test("release displacement prevents an accidental tap even if a move event was dropped", async () => {
  await mount(); await drag(-150, -80, false); expect(onPress).not.toHaveBeenCalled(); expect(point().x).toBe(8);
});
test("dragging away and back is not a tap and cancellation never launches voice", async () => {
  await mount(); await act(async () => {
    gesture.onPanResponderGrant(); gesture.onPanResponderMove({}, { dx: -100, dy: -20 });
    gesture.onPanResponderMove({}, { dx: 0, dy: 0 }); gesture.onPanResponderRelease({}, { dx: 0, dy: 0 });
  }); expect(onPress).not.toHaveBeenCalled();
  await act(async () => { gesture.onPanResponderGrant(); gesture.onPanResponderTerminate(); }); expect(onPress).not.toHaveBeenCalled();
});
test("a timer on the same edge moves the voice ball into the nearest clear vertical slot", async () => {
  await mount(); await act(async () => publishFloatingTimerObstacle(owner, { x: 200, y: 450, width: 112, height: 54 }));
  expect(point()).toEqual({ x: 236, y: 362 }); expect(voiceOverlapsTimer(point(), getFloatingTimerObstacle())).toBe(false);
  expect(onPress).not.toHaveBeenCalled();
});
test("iOS and landscape resizing keep both edges and safe navigation clear", async () => {
  Platform.OS = "ios"; mockInsets = { top: 47, bottom: 34, left: 0, right: 0 }; mockWindow = { width: 390, height: 844 };
  await mount(); expect(point()).toEqual({ x: 306, y: 644 });
  mockWindow = { width: 844, height: 390 }; mockInsets = { top: 0, bottom: 21, left: 44, right: 44 };
  await act(async () => tree.update(<FloatingAssistantVoice locale="zh" onPress={onPress} />));
  expect(point()).toEqual({ x: 716, y: 203 }); expect(onPress).not.toHaveBeenCalled();
});
test("actual scene layout and a changed viewport cancel a drag instead of opening the assistant", async () => {
  await mount(); await act(async () => gesture.onPanResponderGrant());
  const layer = tree.root.findAllByType(View).find(node => node.props.testID === "home-voice-floating-layer");
  await act(async () => layer.props.onLayout({ nativeEvent: { layout: { width: 280, height: 400 } } }));
  await act(async () => gesture.onPanResponderRelease({}, { dx: 0, dy: 0 }));
  expect(point()).toEqual({ x: 196, y: 312 }); expect(onPress).not.toHaveBeenCalled();
});
test("short viewports use the other edge when the timer leaves no vertical slot", () => {
  const bounds = floatingVoiceBounds({ width: 320, height: 140 });
  const timer = { x: 200, y: 24, width: 112, height: 54 };
  const next = snapVoicePosition({ x: 300, y: 35 }, bounds, timer);
  expect(next.x).toBe(8); expect(voiceOverlapsTimer(next, timer)).toBe(false);
});
