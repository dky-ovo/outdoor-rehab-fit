import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import LearningYoutubePlayer from "../LearningYoutubePlayer";
import { createPlaybackCoverage } from "../../utils/learningCoverage";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockTime = jest.fn(); const mockDuration = jest.fn();
jest.mock("react-native-youtube-iframe", () => require("react").forwardRef((props, ref) => { require("react").useImperativeHandle(ref, () => ({ getCurrentTime: mockTime, getDuration: mockDuration })); return require("react").createElement("mock-youtube", props); }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
let tree; let sample; let range; let listeners;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); range = jest.fn(); sample = createPlaybackCoverage(range); listeners = new Set(); mockTime.mockResolvedValue(0); mockDuration.mockResolvedValue(100); jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });
const mount = async () => act(async () => { tree = renderer.create(<LearningYoutubePlayer videoId="test" onPlaybackSample={sample} />); });
const tick = async () => act(async () => { jest.advanceTimersByTime(1000); });
test("legacy YouTube polls actual position, rejects seek jump and pauses on background", async () => {
	await mount(); await act(async () => tree.root.findByType("mock-youtube").props.onChangeState("playing"));
	await tick(); mockTime.mockResolvedValue(1); await tick(); expect(range).toHaveBeenLastCalledWith(0, 1000, 100000);
	mockTime.mockResolvedValue(90); await tick(); expect(range).toHaveBeenCalledTimes(1);
	mockTime.mockResolvedValue(91); await tick(); expect(range).toHaveBeenCalledTimes(2);
	await act(async () => listeners.forEach((listener) => listener("background"))); mockTime.mockResolvedValue(99); await tick(); expect(range).toHaveBeenCalledTimes(2);
});
test("late asynchronous player result after leaving cannot record learning", async () => {
	let finish; mockTime.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
	await mount(); await act(async () => tree.root.findByType("mock-youtube").props.onChangeState("playing")); await tick();
	await act(async () => tree.unmount()); tree = null;
	await act(async () => finish(75)); expect(range).not.toHaveBeenCalled();
});
