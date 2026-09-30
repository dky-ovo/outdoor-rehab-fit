import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, TouchableOpacity } from "react-native";
import MediaVideo from "../MediaVideo";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: (value) => value }));
jest.mock("react-native-webview", () => {
	const React = require("react");
	return { WebView: React.forwardRef((props, ref) => { React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() })); return <mock-layout-webview {...props} />; }) };
});

let tree;
beforeEach(() => { jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });
const frame = () => tree.root.findByProps({ testID: "facility-video-frame" });
const player = () => tree.root.findByType("mock-layout-webview");
const layout = async (width) => act(async () => frame().props.onLayout({ nativeEvent: { layout: { width } } }));
const message = (handler, state, metadata = {}) => handler({ nativeEvent: { data: JSON.stringify({ type: "facility-video", state, ...metadata }) } });
const resize = async (videoWidth, videoHeight) => act(async () => message(player().props.onMessage, "dimensions", { videoWidth, videoHeight }));

test("native player uses 16:9 only while metadata is unknown and adapts to intrinsic dimensions without cropping", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" height={400} onChangeState={onChangeState} />); });
	expect(frame().props.style.height).toBe(400);
	await layout(320);
	expect(frame().props.style.height).toBe(180);
	await resize(640, 480);
	expect(frame().props.style.height).toBe(240);
	expect(player().props.containerStyle.height).toBe(240);
	expect(player().props.source.html).toContain("object-fit:contain");
	expect(onChangeState).not.toHaveBeenCalled();
});

test("portrait video and small or rotated layouts retain the whole video at the measured content width", async () => {
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/portrait.mp4" />); });
	await resize(1080, 1920);
	await layout(270);
	expect(frame().props.style.height).toBe(480);
	await layout(360);
	expect(frame().props.style.height).toBe(640);
	await resize(1920, 1080);
	await layout(640);
	expect(frame().props.style.height).toBe(360);
});

test("invalid measurements never collapse a player or overwrite the last good video ratio", async () => {
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" height={NaN} />); });
	expect(frame().props.style.height).toBe(220);
	await layout(300); await resize(600, 600);
	for (const width of [0, -1, NaN, Infinity, "320"]) await layout(width);
	for (const dimensions of [[0, 10], [100, 0], ["10", 10], [1000000, 1]]) await resize(...dimensions);
	expect(frame().props.style.height).toBe(300);
});

test("switching a source resets its ratio and ignores delayed dimensions from the old player", async () => {
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/chinese.mp4" />); });
	await layout(320); await resize(640, 480);
	const old = player().props.onMessage;
	await act(async () => tree.update(<MediaVideo source="https://host/english.mp4" />));
	await layout(320);
	await act(async () => message(old, "dimensions", { videoWidth: 1080, videoHeight: 1920 }));
	expect(frame().props.style.height).toBe(180);
	await resize(1280, 720);
	expect(frame().props.style.height).toBe(180);
});

test("retry resets stale dimensions and layout changes do not reload the WebView HTML or restart watch events", async () => {
	const onChangeState = jest.fn();
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" onChangeState={onChangeState} />); });
	await layout(320); await resize(600, 600);
	const old = player().props.onMessage;
	const source = player().props.source;
	await act(async () => message(old, "playing"));
	await layout(400);
	expect(player().props.source).toBe(source);
	expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing"]);
	await act(async () => message(old, "error"));
	await act(async () => tree.root.findByType(TouchableOpacity).props.onPress());
	await act(async () => message(old, "dimensions", { videoWidth: 1080, videoHeight: 1920 }));
	expect(frame().props.style.height).toBe(225);
	await resize(1280, 720);
	expect(frame().props.style.height).toBe(225);
});

test("native video hides saving menus, rejects external navigation and does not handle requested file downloads", async () => {
	await act(async () => { tree = renderer.create(<MediaVideo source="https://host/video.mp4" />); });
	const props = player().props;
	expect(props.allowsLinkPreview).toBe(false);
	expect(props.menuItems).toEqual([]);
	expect(props.textInteractionEnabled).toBe(false);
	expect(props.allowsPictureInPictureMediaPlayback).toBe(false);
	expect(props.source.html).toContain('controlslist="nodownload noremoteplayback"');
	expect(props.source.html).toContain("event.preventDefault()");
	expect(props.onShouldStartLoadWithRequest({ url: "https://host/video.mp4", isTopFrame: true })).toBe(false);
	expect(props.onShouldStartLoadWithRequest({ url: "https://other.example/save.mp4" })).toBe(false);
	expect(props.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
	expect(props.onFileDownload({ nativeEvent: { downloadUrl: "https://host/video.mp4" } })).toBeUndefined();
	expect(props.onOpenWindow({ nativeEvent: { targetUrl: "https://host/video.mp4" } })).toBeUndefined();
});
