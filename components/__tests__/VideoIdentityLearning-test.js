import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import useEquipmentLearning from "../../hooks/useEquipmentLearning";
import { getLearningProgress, learningVideoKey, recordLearningCoverage } from "../../utils/learning";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockOwner = "one", mockFocused = true, learning, tree;
jest.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, View: "mock-view" }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../utils/userStorage", () => ({ getCurrentOwnerKey: () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));

const original = { id: 0, videoUrl: "/api/media/original/original.mp4" };
const delivery = { ...original, videoUrl: "https://cdn.example/api/media/original/hash.mp4", videoIdentityUrl: original.videoUrl, videoIdentityDurationSeconds: 24.557875 };
const originalGroup = `zh:${learningVideoKey(original)}:24558`;
function Probe({ item = delivery, blocked = false }) {
  learning = useEquipmentLearning({ item, locale: "zh", enabled: true, blocked, identity: mockOwner });
  return null;
}
beforeEach(async () => { jest.useFakeTimers(); mockOwner = "one"; mockFocused = true; await AsyncStorage.clear(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.useRealTimers(); });
const mount = async (props) => act(async () => { tree = renderer.create(<Probe {...props} />); });
const sample = async (state, positionMs, elapsed = 0) => act(async () => {
  jest.advanceTimersByTime(elapsed);
  learning.video(state, { positionMs, durationMs: 24602 });
});

test("a rendition resumes the exact historical group and keeps real positions across delivery-host changes", async () => {
  await recordLearningCoverage({ equipmentId: 0, field: "watched", groupKey: originalGroup, parts: [{ key: "media", total: 24558 }], partKey: "media", start: 0, end: 1000 });
  await mount();
  await sample("playing", 1000); await sample("progress", 2000, 1000);
  const session = learning;
  await act(async () => tree.update(<Probe item={{ ...delivery, videoUrl: "https://another-cdn.example/api/media/original/another-hash.mp4" }} />));
  expect(learning).toBe(session);
  await sample("progress", 3000, 1000);
  const groups = (await getLearningProgress())[0].evidence.watched;
  expect(Object.keys(groups)).toEqual([originalGroup]);
  expect(groups[originalGroup].parts).toEqual([{ key: "media", total: 24558 }]);
  expect(groups[originalGroup].ranges.media).toEqual([[0, 3000]]);
});

test("buffering, focus loss and stale lesson callbacks cannot bridge watched coverage", async () => {
  await mount();
  await sample("playing", 0); await sample("progress", 1000, 1000);
  await sample("buffering", 1000); await sample("progress", 2000, 1000);
  await sample("playing", 2000); await sample("progress", 3000, 1000);
  mockFocused = false; await act(async () => tree.update(<Probe />));
  await sample("progress", 4000, 1000);
  mockFocused = true; await act(async () => tree.update(<Probe />));
  const old = learning;
  await act(async () => tree.update(<Probe item={{ ...delivery, id: 1, videoIdentityUrl: "/api/media/new/new.mp4" }} />));
  await act(async () => { jest.advanceTimersByTime(1000); old.video("progress", { positionMs: 5000, durationMs: 24602 }); });
  const data = await getLearningProgress();
  expect(data[0].evidence.watched[originalGroup].ranges.media).toEqual([[0, 1000], [2000, 3000]]);
  expect(data[1]).toBeUndefined();
});
