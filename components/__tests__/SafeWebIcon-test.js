import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import createSafeIconSet from "../createSafeIconSet.web";
import { loadWebIconFont, isWebIconFontLoaded, subscribeWebIconFont } from "../../utils/webIconFont";
jest.mock("../../utils/webIconFont", () => ({ loadWebIconFont: jest.fn(), isWebIconFontLoaded: jest.fn(), subscribeWebIconFont: jest.fn() }));
jest.mock("@expo/vector-icons/build/vendor/react-native-vector-icons/lib/icon-button", () => Icon => Icon);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, originalWindow, originalDocument, listeners;
beforeEach(() => {
  jest.useFakeTimers(); originalWindow = global.window; originalDocument = global.document; listeners = {};
  global.window = { addEventListener: jest.fn((name, fn) => { listeners[name] = fn; }), removeEventListener: jest.fn() };
  global.document = { visibilityState: "visible", addEventListener: jest.fn(), removeEventListener: jest.fn() };
  isWebIconFontLoaded.mockReturnValue(false); subscribeWebIconFont.mockReturnValue(jest.fn());
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount()); tree = null;
  global.window = originalWindow; global.document = originalDocument;
  jest.clearAllMocks(); jest.useRealTimers();
});
test("pending font reserves the final size without private glyphs, words or substitute emoji", async () => {
  let finish; loadWebIconFont.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const Icon = createSafeIconSet({ play: 0xe001 }, "original-family", 1);
  await act(async () => { tree = renderer.create(<Icon name="play" size={28} color="red" accessibilityLabel="Play audio" />); });
  const pending = tree.root.findByType(Text).props;
  expect(pending.children[0]).toBe("\u2007"); expect(pending.accessibilityLabel).toBe("Play audio");
  expect(pending.style[0]).toMatchObject({ width: 28, height: 28, lineHeight: 28 });
  await act(async () => finish(true)); const loaded = tree.root.findByType(Text).props;
  expect(loaded.children[0]).toBe(String.fromCodePoint(0xe001)); expect(loaded.style.at(-1).fontFamily).toBe("original-family");
  expect(loaded.style[0]).toEqual(pending.style[0]);
  expect(Icon.getRawGlyphMap()).toEqual({ play: 0xe001 }); expect(Icon.getFontFamily()).toBe("original-family");
});
test("cached font renders its real icon immediately on page entry, even before effects settle", async () => {
  isWebIconFontLoaded.mockReturnValue(true); loadWebIconFont.mockReturnValue(new Promise(() => {}));
  const Icon = createSafeIconSet({ edit: 0xe002 }, "cached-family", 2);
  await act(async () => { tree = renderer.create(<Icon name="edit" />); });
  expect(tree.root.findByType(Text).props.children[0]).toBe(String.fromCodePoint(0xe002));
  expect(tree.root.findByType(Text).props.dataSet.iconFont).toBe("loaded");
});
test("failed font stays quiet and recovers online without remounting", async () => {
  loadWebIconFont.mockResolvedValue(false);
  const Icon = createSafeIconSet({ play: 0xe001 }, "failed-family", 3);
  await act(async () => { tree = renderer.create(<Icon name="play" size={20} />); });
  expect(tree.root.findByType(Text).props.children[0]).toBe("\u2007");
  loadWebIconFont.mockResolvedValue(true);
  await act(async () => listeners.online());
  expect(tree.root.findByType(Text).props.dataSet.iconFont).toBe("loaded");
  await act(async () => tree.unmount()); tree = null;
  expect(window.removeEventListener).toHaveBeenCalledWith("online", listeners.online);
  const calls = loadWebIconFont.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(3000));
  expect(loadWebIconFont).toHaveBeenCalledTimes(calls);
});
test("unknown icons never print an internal identifier into the UI", async () => {
  isWebIconFontLoaded.mockReturnValue(true); loadWebIconFont.mockResolvedValue(true);
  const Icon = createSafeIconSet({}, "unknown-family", 4);
  await act(async () => { tree = renderer.create(<Icon name="unavailable-feature" />); });
  expect(tree.root.findByType(Text).props.children[0]).toBe("\u2007");
});

test("a slow failure retries after settling, without waiting for another navigation or online event", async () => {
  let fail;
  loadWebIconFont.mockReturnValueOnce(new Promise(resolve => { fail = resolve; })).mockResolvedValue(true);
  const Icon = createSafeIconSet({ play: 0xe001 }, "slow-failure", 6);
  await act(async () => { tree = renderer.create(<Icon name="play" />); });
  await act(async () => jest.advanceTimersByTime(7000));
  expect(loadWebIconFont).toHaveBeenCalledTimes(1);
  await act(async () => fail(false));
  await act(async () => jest.advanceTimersByTime(2201));
  expect(loadWebIconFont).toHaveBeenCalledTimes(2);
  expect(tree.root.findByType(Text).props.dataSet.iconFont).toBe("loaded");
});
