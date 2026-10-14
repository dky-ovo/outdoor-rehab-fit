import React from "react";
import renderer, { act } from "react-test-renderer";
import { TouchableOpacity } from "react-native";
import WebMediaVideo from "../MediaVideo.web";
import { createPlaybackCoverage } from "../../utils/learningCoverage";
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: value => value }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
beforeEach(() => jest.useFakeTimers());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.useRealTimers(); });
const player = () => tree.root.findByType("video");
async function mount(props = {}, node = { pause: jest.fn(), currentTime: 0, duration: 100, paused: false }) {
  await act(async () => { tree = renderer.create(<WebMediaVideo source="https://host/video.mp4" {...props} />, { createNodeMock: element => element.type === "video" ? node : null }); });
  return node;
}

test("initial loading is announced without claiming playback; slow loading offers manual retry", async () => {
  const change = jest.fn(); await mount({ onChangeState: change });
  await act(async () => player().props.onPlay());
  expect(tree.root.findByProps({ testID: "media-video-loading-status" }).props.children).toBe("載入影片中…");
  expect(change).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(12000));
  expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(1);
  await act(async () => player().props.onPlaying());
  expect(tree.root.findAllByProps({ testID: "media-video-loading-status" })).toHaveLength(0);
  expect(change.mock.calls.map(([state]) => state)).toEqual(["playing"]);
});

test("buffered time is not learning coverage and restored playback starts a new real interval", async () => {
  const ranges = jest.fn(), coverage = createPlaybackCoverage(ranges);
  const node = await mount({ onPlaybackSample: coverage });
  await act(async () => player().props.onPlaying({ currentTarget: node }));
  await act(async () => { jest.advanceTimersByTime(1000); node.currentTime = 1; player().props.onTimeUpdate({ currentTarget: node }); });
  expect(ranges).toHaveBeenLastCalledWith(0, 1000, 100000);
  await act(async () => player().props.onWaiting({ currentTarget: node }));
  expect(tree.root.findByProps({ testID: "media-video-loading-status" }).props.children).toBe("影片緩衝中…");
  await act(async () => { jest.advanceTimersByTime(1000); node.currentTime = 2; player().props.onTimeUpdate({ currentTarget: node }); });
  expect(ranges).toHaveBeenCalledTimes(1);
  await act(async () => player().props.onPlaying({ currentTarget: node }));
  await act(async () => { jest.advanceTimersByTime(1000); node.currentTime = 3; player().props.onTimeUpdate({ currentTarget: node }); });
  expect(ranges.mock.calls).toEqual([[0, 1000, 100000], [2000, 3000, 100000]]);
});

test("manual retry restores the prior position and rejects late events from the replaced player", async () => {
  const change = jest.fn(), node = { currentTime: 30, duration: 100, paused: false, pause: jest.fn(), play: jest.fn(() => Promise.resolve()) };
  await mount({ onChangeState: change }, node); const old = player().props;
  await act(async () => { old.onPlaying({ currentTarget: node }); old.onWaiting({ currentTarget: node }); });
  await act(async () => jest.advanceTimersByTime(12000));
  await act(async () => tree.root.findByType(TouchableOpacity).props.onPress());
  node.currentTime = 0;
  await act(async () => player().props.onLoadedMetadata({ currentTarget: node }));
  expect(node.currentTime).toBe(30); expect(node.play).toHaveBeenCalledTimes(1);
  await act(async () => { old.onPlaying({ currentTarget: node }); old.onEnded({ currentTarget: node }); });
  expect(change.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
  await act(async () => player().props.onPlaying({ currentTarget: node }));
  expect(change.mock.calls.map(([state]) => state)).toEqual(["playing", "paused", "playing"]);
});

test("additional players can opt out of metadata preloading", async () => {
  await mount({ preload: "none" }); expect(player().props.preload).toBe("none");
});
