import React, { createRef } from "react";
import renderer, { act } from "react-test-renderer";
import { WebView } from "../YoutubeWebView.web";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
let originalWindow;
let listeners;
beforeEach(() => {
	originalWindow = global.window;
	listeners = new Set();
	global.window = {
		location: { origin: "https://app.example.test" },
		addEventListener: (_type, callback) => listeners.add(callback),
		removeEventListener: (_type, callback) => listeners.delete(callback),
	};
});
afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
	global.window = originalWindow;
});

test("each Web player receives only its own same-origin iframe messages", async () => {
	const first = jest.fn(); const second = jest.fn();
	const frames = [{ contentWindow: {} }, { contentWindow: {} }];
	let nextFrame = 0;
	await act(async () => {
		tree = renderer.create(<><WebView source={{ html: "<html><head></head><body>first</body></html>" }} onMessage={first} /><WebView source={{ html: "<html><head></head><body>second</body></html>" }} onMessage={second} /></>, { createNodeMock: () => frames[nextFrame++] });
	});
	const deliver = (event) => listeners.forEach((listener) => listener(event));
	const event = { data: JSON.stringify({ eventType: "playerStateChange", data: 1 }), source: frames[0].contentWindow, origin: "https://app.example.test" };
	deliver({ ...event, source: {} });
	deliver({ ...event, origin: "https://untrusted.example.test" });
	deliver({ ...event, data: {} });
	expect(first).not.toHaveBeenCalled();
	expect(second).not.toHaveBeenCalled();
	deliver(event);
	expect(first).toHaveBeenCalledTimes(1);
	expect(first).toHaveBeenCalledWith({ nativeEvent: event });
	expect(second).not.toHaveBeenCalled();
	const source = tree.root.findAllByType("iframe")[0].props.srcDoc;
	expect(source).toContain('<head><script>window.ReactNativeWebView=');
	expect(source).toContain('window.parent.postMessage(String(message),"https://app.example.test")');
	await act(async () => tree.unmount()); tree = null;
	expect(listeners.size).toBe(0);
});

test("the existing YouTube command API stays scoped to the local player frame", async () => {
	const player = createRef();
	const contentWindow = { postMessage: jest.fn(), eval: jest.fn() };
	await act(async () => {
		tree = renderer.create(<WebView ref={player} source={{ html: "<head></head><body></body>" }} />, { createNodeMock: () => ({ contentWindow }) });
	});
	player.current.postMessage("pause");
	player.current.injectJavaScript("player.pauseVideo(); true;");
	expect(contentWindow.postMessage).toHaveBeenCalledWith("pause", "https://app.example.test");
	expect(contentWindow.eval).toHaveBeenCalledWith("player.pauseVideo(); true;");
});
