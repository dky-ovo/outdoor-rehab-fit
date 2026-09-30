import vm from "node:vm";
import { directVideoHtml, videoAspectRatio, videoMessageEvent } from "../contentVideo";

jest.mock("../api", () => ({ resolveApiAssetUrl: (value) => value }));

test.each([[1920, 1080, 16 / 9], [1080, 1920, 9 / 16], [640, 480, 4 / 3], [100, 100, 1]])("video ratio uses intrinsic %s x %s dimensions", (videoWidth, videoHeight, expected) => {
	expect(videoAspectRatio({ videoWidth, videoHeight })).toBe(expected);
});

test.each([null, {}, { videoWidth: 0, videoHeight: 10 }, { videoWidth: 100, videoHeight: 0 }, { videoWidth: "100", videoHeight: 100 }, { videoWidth: Infinity, videoHeight: 100 }, { videoWidth: NaN, videoHeight: 100 }, { videoWidth: 100, videoHeight: -1 }, { videoWidth: 1, videoHeight: 32768 }, { videoWidth: 32769, videoHeight: 32769 }])("malformed or impossible dimensions are not used: %p", (value) => {
	expect(videoAspectRatio(value)).toBeNull();
});

test("dimensions are a separate validated bridge message and cannot fabricate video completion", () => {
	expect(videoMessageEvent(JSON.stringify({ type: "facility-video", state: "dimensions", videoWidth: 1920, videoHeight: 1080, positionMs: 100, durationMs: 100 }))).toEqual({ state: "dimensions", aspectRatio: 16 / 9 });
	expect(videoMessageEvent(JSON.stringify({ type: "facility-video", state: "dimensions", videoWidth: 0, videoHeight: 1080 }))).toBeNull();
	expect(videoMessageEvent(JSON.stringify({ type: "other", state: "dimensions", videoWidth: 1920, videoHeight: 1080 }))).toBeNull();
});

test("native HTML emits metadata and resize dimensions while suppressing only the save context menu", () => {
	const videoEvents = {}; const documentEvents = {}; const messages = [];
	const video = { videoWidth: 0, videoHeight: 0, addEventListener: (name, callback) => { videoEvents[name] = callback; } };
	const document = { getElementById: () => video, addEventListener: (name, callback) => { documentEvents[name] = callback; } };
	const html = directVideoHtml("https://host/video.mp4");
	vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document, window: { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) } } });
	videoEvents.loadedmetadata(); expect(messages).toEqual([]);
	video.videoWidth = 1920; video.videoHeight = 1080; videoEvents.loadedmetadata();
	video.videoWidth = 1080; video.videoHeight = 1920; videoEvents.resize();
	expect(messages).toEqual([
		{ type: "facility-video", state: "dimensions", videoWidth: 1920, videoHeight: 1080 },
		{ type: "facility-video", state: "dimensions", videoWidth: 1080, videoHeight: 1920 },
	]);
	const preventDefault = jest.fn(); documentEvents.contextmenu({ preventDefault });
	expect(preventDefault).toHaveBeenCalledTimes(1);
	expect(videoEvents.playing).toEqual(expect.any(Function));
	expect(html).toContain("controls playsinline");
	expect(html).toContain('controlslist="nodownload noremoteplayback"');
	expect(html).not.toContain("object-fit:cover");
});
