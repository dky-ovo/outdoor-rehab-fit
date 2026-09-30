import React from "react";
import renderer, { act } from "react-test-renderer";
import WebMediaVideo from "../MediaVideo.web";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: (value) => value }));

let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const video = () => tree.root.findByType("video");
async function mount(source = "https://host/video.mp4") {
  await act(async () => { tree = renderer.create(<WebMediaVideo source={source} height={600} />); });
}

test("web player uses a responsive safe fallback instead of a fixed screen height", async () => {
  await mount();
  expect(video().props.style).toMatchObject({ width: "100%", height: "auto", aspectRatio: 16 / 9, objectFit: "contain" });
});

test("metadata adapts landscape, portrait and changing video dimensions without cropping", async () => {
  await mount();
  await act(async () => video().props.onLoadedMetadata({ currentTarget: { videoWidth: 1920, videoHeight: 1080 } }));
  expect(video().props.style.aspectRatio).toBeCloseTo(16 / 9);
  await act(async () => video().props.onResize({ currentTarget: { videoWidth: 1080, videoHeight: 1920 } }));
  expect(video().props.style.aspectRatio).toBeCloseTo(9 / 16);
  await act(async () => video().props.onResize({ currentTarget: { videoWidth: 640, videoHeight: 480 } }));
  expect(video().props.style.aspectRatio).toBeCloseTo(4 / 3);
  expect(video().props.style.objectFit).toBe("contain");
});

test("invalid metadata and late dimensions from a replaced source cannot corrupt the layout", async () => {
  await mount();
  const oldPlayer = video().props;
  await act(async () => oldPlayer.onLoadedMetadata({ currentTarget: { videoWidth: 0, videoHeight: NaN } }));
  expect(video().props.style.aspectRatio).toBeCloseTo(16 / 9);
  await act(async () => tree.update(<WebMediaVideo source="https://host/next.mp4" />));
  await act(async () => oldPlayer.onResize({ currentTarget: { videoWidth: 100, videoHeight: 200 } }));
  expect(video().props.style.aspectRatio).toBeCloseTo(16 / 9);
});

test("download controls and the context save menu are suppressed without losing playback controls", async () => {
  await mount();
  expect(video().props.controls).toBe(true);
  expect(video().props.playsInline).toBe(true);
  expect(video().props.controlsList).toBe("nodownload");
  expect(video().props.style.WebkitTouchCallout).toBe("none");
  const preventDefault = jest.fn();
  video().props.onContextMenu({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(video().props.download).toBeUndefined();
});

test("opt-in admin preview fits a portrait clip within the viewport without fixed letterboxing", async () => {
  await act(async () => { tree = renderer.create(<WebMediaVideo source="https://host/portrait.mp4" maxViewportHeight={65} />); });
  await act(async () => video().props.onLoadedMetadata({ currentTarget: { videoWidth: 810, videoHeight: 1080 } }));
  expect(video().props.style).toMatchObject({ width: "100%", maxWidth: "48.75vh", height: "auto", aspectRatio: 0.75, objectFit: "contain" });
  await act(async () => tree.update(<WebMediaVideo source="https://host/portrait.mp4" maxViewportHeight={Infinity} />));
  expect(video().props.style.maxWidth).toBe("100%");
});
