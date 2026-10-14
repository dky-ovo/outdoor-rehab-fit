import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform, TouchableOpacity } from "react-native";
import DeferredDetailMedia from "../DeferredDetailMedia";
let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, notify, disconnect, originalObserver, originalOS;
beforeEach(() => {
  originalOS = Platform.OS; Platform.OS = "web"; mockFocused = true; originalObserver = global.IntersectionObserver;
  disconnect = jest.fn(); global.IntersectionObserver = jest.fn(callback => { notify = callback; return { observe: jest.fn(), disconnect }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; global.IntersectionObserver = originalObserver; });
const mount = async () => act(async () => { tree = renderer.create(<DeferredDetailMedia><mock-player /></DeferredDetailMedia>, { createNodeMock: () => ({}) }); });

test("offscreen media makes no player until intersecting and stays mounted after scrolling or blur", async () => {
  await mount(); expect(tree.root.findAllByType("mock-player")).toHaveLength(0);
  await act(async () => notify([{ isIntersecting: false }])); expect(tree.root.findAllByType("mock-player")).toHaveLength(0);
  await act(async () => notify([{ isIntersecting: true }])); expect(tree.root.findAllByType("mock-player")).toHaveLength(1);
  mockFocused = false; await act(async () => tree.update(<DeferredDetailMedia><mock-player /></DeferredDetailMedia>));
  expect(tree.root.findAllByType("mock-player")).toHaveLength(1); expect(disconnect).toHaveBeenCalled();
});

test("manual activation works without IntersectionObserver", async () => {
  global.IntersectionObserver = undefined; await mount();
  await act(async () => tree.root.findByType(TouchableOpacity).props.onPress());
  expect(tree.root.findAllByType("mock-player")).toHaveLength(1);
});

test("native content remains immediate without a web observer", async () => {
  Platform.OS = "android"; await mount();
  expect(tree.root.findAllByType("mock-player")).toHaveLength(1); expect(global.IntersectionObserver).not.toHaveBeenCalled();
});
