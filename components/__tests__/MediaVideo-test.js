import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, TouchableOpacity } from "react-native";
import MediaVideo from "../MediaVideo";
import WebMediaVideo from "../MediaVideo.web";
import useVideoPlaybackEvents from "../../hooks/useVideoPlaybackEvents";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
const mockInject = jest.fn();
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: (value) => value }));
jest.mock("react-native-webview", () => {
	const React = require("react");
	return { WebView: React.forwardRef((props, ref) => { React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject })); return <mock-webview {...props} />; }) };
});
let tree;
let onAppState;
let stateSubscription;
beforeEach(() => {
	jest.clearAllMocks(); mockFocused = true;
	stateSubscription = { remove: jest.fn() };
	jest.spyOn(AppState, "addEventListener").mockImplementation((_name, callback) => { onAppState = callback; return stateSubscription; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("native video is inline, pauses in background, and never sends duplicate playing events", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" onChangeState={onChangeState} />); });
	const player = tree.root.findByType("mock-webview");
	expect(player.props.mediaPlaybackRequiresUserAction).toBe(true);
	expect(player.props.allowFileAccess).toBe(false);
	expect(player.props.onShouldStartLoadWithRequest({ url: "https://untrusted.example" })).toBe(false);
	const message = (state) => player.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "facility-video", state }) } });
	await act(async () => { message("playing"); message("playing"); onAppState("background"); });
	expect(mockInject).toHaveBeenCalledWith(expect.stringContaining("pause()"));
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
	await act(async () => tree.unmount()); tree = null;
	expect(stateSubscription.remove).toHaveBeenCalled();
});

test("web video uses native browser controls and pauses when its navigation screen loses focus", async () => {
	const pause = jest.fn(); const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<WebMediaVideo source="/api/media/id/file.mp4" onChangeState={onChangeState} />, { createNodeMock: () => ({ pause }) }); });
	const player = tree.root.findByType("video");
	expect(player.props.controls).toBe(true);
	expect(player.props.autoPlay).toBeUndefined();
	await act(async () => player.props.onPlaying());
	mockFocused = false;
	await act(async () => tree.update(<WebMediaVideo source="/api/media/id/file.mp4" onChangeState={onChangeState} />));
	expect(pause).toHaveBeenCalled();
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
});

test("changing a video source closes the old watch interval using the old callback", async () => {
	let emit;
	function Probe({ source, onChangeState }) { emit = useVideoPlaybackEvents(source, onChangeState); return null; }
	const first = jest.fn(); const second = jest.fn();
	await act(async () => { tree = renderer.create(<Probe source="first" onChangeState={first} />); });
	await act(async () => emit("playing"));
	await act(async () => tree.update(<Probe source="second" onChangeState={second} />));
	expect(first.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
	expect(second).not.toHaveBeenCalled();
	await act(async () => emit("playing"));
	await act(async () => tree.unmount()); tree = null;
	expect(second.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
});

test("web video reports waiting and seeking as paused and resumes only after playable seek completion", async () => {
	const onChangeState = jest.fn(); const video = { currentTime: 0, duration: 10, paused: false, ended: false, readyState: 4, pause: jest.fn() };
	await act(async () => { tree = renderer.create(<WebMediaVideo source="https://host/english.mp4" onChangeState={onChangeState} />, { createNodeMock: () => video }); });
	const events = tree.root.findByType("video").props; const event = { currentTarget: video };
	await act(async () => events.onEnded(event)); expect(onChangeState).not.toHaveBeenCalled();
	await act(async () => events.onPlaying(event));
	video.currentTime = 1; await act(async () => events.onTimeUpdate(event)); expect(onChangeState).toHaveBeenCalledTimes(1);
	video.currentTime = 2; await act(async () => events.onWaiting(event));
	await act(async () => events.onPlaying(event));
	video.currentTime = 8; await act(async () => events.onSeeking(event));
	video.paused = true; await act(async () => events.onSeeked(event));
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused", "playing", "paused"]);
	video.paused = false; await act(async () => events.onSeeked(event));
	video.currentTime = 10; video.ended = true;
	await act(async () => { events.onPause(event); events.onEnded(event); events.onEnded(event); });
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused", "playing", "paused", "playing", "ended"]);
	expect(onChangeState).toHaveBeenLastCalledWith("ended", { positionMs: 10000, durationMs: 10000, progressPercent: 100 });
});

test("web errors close a watch segment and invalidate late ended or playing events until retry", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<WebMediaVideo source="https://host/english.mp4" onChangeState={onChangeState} />); });
	const events = tree.root.findByType("video").props;
	await act(async () => events.onPlaying());
	await act(async () => events.onError());
	await act(async () => { events.onPlaying(); events.onEnded(); });
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
});

test("web callbacks from a replaced file cannot append progress or completion to its replacement", async () => {
	const first = jest.fn(); const second = jest.fn();
	await act(async () => { tree = renderer.create(<WebMediaVideo source="https://host/chinese.mp4" onChangeState={first} />); });
	const old = tree.root.findByType("video").props;
	await act(async () => old.onPlaying());
	await act(async () => tree.update(<WebMediaVideo source="https://host/english.mp4" onChangeState={second} />));
	await act(async () => { old.onTimeUpdate({ currentTarget: { currentTime: 10, duration: 10 } }); old.onEnded(); old.onPlaying(); });
	await act(async () => tree.root.findByType("video").props.onPlaying());
	expect(first.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
	expect(second.mock.calls.map(([state]) => state)).toEqual(["playing"]);
});

test("native play and ended messages arriving after backgrounding cannot restart or complete the watch clock", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" onChangeState={onChangeState} />); });
	const events = tree.root.findByType("mock-webview").props;
	const emit = (state) => events.onMessage({ nativeEvent: { data: JSON.stringify({ type: "facility-video", state }) } });
	await act(async () => emit("playing"));
	await act(async () => onAppState("background"));
	await act(async () => { emit("playing"); emit("ended"); });
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
});

test("retrying a failed native file starts a fresh watch session and rejects messages from the failed attempt", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" onChangeState={onChangeState} />); });
	const old = tree.root.findByType("mock-webview").props;
	const send = (props, state) => props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "facility-video", state }) } });
	await act(async () => { send(old, "playing"); send(old, "error"); });
	await act(async () => tree.root.findByType(TouchableOpacity).props.onPress());
	const retry = tree.root.findByType("mock-webview").props;
	await act(async () => { send(old, "ended"); send(retry, "playing"); send(retry, "ended"); });
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused", "playing", "ended"]);
});
