import { directVideoHtml, directVideoUri, videoMessageState, videoMessageEvent, videoProgressMetadata, videoElementProgress, youtubeVideoId } from "../contentVideo";
import { mergeEquipmentCatalog } from "../equipmentCatalog";
import vm from "node:vm";

jest.mock("../api", () => ({ resolveApiAssetUrl: (value) => value.startsWith("/") ? `https://app.example${value}` : value }));

test.each(["-vFxR4gdfPY", "https://youtu.be/-vFxR4gdfPY", "https://www.youtube.com/watch?v=-vFxR4gdfPY", "https://www.youtube-nocookie.com/embed/-vFxR4gdfPY"])("existing YouTube record remains recognizable: %s", (value) => {
	expect(youtubeVideoId(value)).toBe("-vFxR4gdfPY");
	expect(directVideoUri(value)).toBe("");
});

test.each(["javascript:alert(1)", "data:text/html,<script>bad()</script>", "file:///etc/passwd", "//host/video.mp4", "https://user:pass@host/video.mp4", "https://host/page.html", "/api/avatars/user.png", "/api/media/../secret", "https://host/video.mp4\n"])("rejects unsafe or nonvideo input: %s", (value) => {
	// Trailing whitespace is deliberately normalized, but embedded controls are not.
	if (value.endsWith("\n")) expect(directVideoUri(value.replace(".mp4\n", "\n.mp4"))).toBe("");
	else expect(directVideoUri(value)).toBe("");
});

test("uploaded library paths resolve on native, public HTTPS MP4 URLs remain intact", () => {
	expect(directVideoUri("/api/media/asset-id/abc.mp4")).toBe("https://app.example/api/media/asset-id/abc.mp4");
	expect(directVideoUri("https://host/video.mp4?revision=abc&v=1")).toBe("https://host/video.mp4?revision=abc&v=1");
	expect(directVideoUri("https://host/video.mp4?token=private")).toBe("");
	expect(directVideoUri("/api/media/id/..")).toBe("");
	expect(directVideoUri("/api/media/id/file.png")).toBe("");
	expect(directVideoUri("https://127.0.0.1/video.mp4")).toBe("");
	expect(youtubeVideoId("https://untrusted.example/watch?v=-vFxR4gdfPY")).toBe("");
});

test("native player escapes title and source markup and does not autoplay", () => {
	const html = directVideoHtml("https://host/video.mp4?x=%22&v=2", '\"/><img src=x onerror="evil()">');
	expect(html).toContain("&amp;v=2");
	expect(html).toContain("&lt;img");
	expect(html).not.toContain("<img");
	expect(html).toContain("controls playsinline");
	expect(html).not.toContain("autoplay");
	expect(html).toContain("document.hidden");
	expect(directVideoHtml("javascript:evil()")).toBe("");
});

test("native video events require the expected type and known state", () => {
	expect(videoMessageState('{"type":"facility-video","state":"playing"}')).toBe("playing");
	expect(videoMessageState('{"type":"other","state":"playing"}')).toBe("");
	expect(videoMessageState('{"type":"facility-video","state":"delete"}')).toBe("");
	expect(videoMessageState("invalid")).toBe("");
});

test("native player reports buffering and seeking boundaries and records progress without autoplay", () => {
	const html = directVideoHtml("https://host/video.mp4");
	for (const event of ["waiting", "seeking", "seeked", "emptied", "timeupdate"]) expect(html).toContain(`addEventListener('${event}'`);
	expect(html).toContain("positionMs:video.currentTime*1000"); expect(html).toContain("durationMs:video.duration*1000");
	expect(videoMessageEvent('{"type":"facility-video","state":"buffering","positionMs":2500,"durationMs":10000}')).toEqual({ state: "buffering", metadata: { positionMs: 2500, durationMs: 10000, progressPercent: 25 } });
});

test("progress metadata is bounded and rejects invalid, string and unknown duration values", () => {
	expect(videoProgressMetadata({ positionMs: 12000, durationMs: 10000 })).toEqual({ positionMs: 10000, durationMs: 10000, progressPercent: 100 });
	expect(videoProgressMetadata({ positionMs: -1, durationMs: Infinity })).toEqual({});
	expect(videoProgressMetadata({ positionMs: "500", durationMs: "1000" })).toEqual({});
	expect(videoProgressMetadata(null)).toEqual({});
	expect(videoElementProgress({ currentTime: 1.5, duration: 3 })).toEqual({ positionMs: 1500, durationMs: 3000, progressPercent: 50 });
});

test("generated native HTML forwards real video event sequences and does not resume a paused seek", () => {
	const videoEvents = {}; const documentEvents = {}; const messages = [];
	const video = { currentTime: 0, duration: 12, paused: false, ended: false, readyState: 4, pause: jest.fn(), addEventListener: (name, callback) => { videoEvents[name] = callback; } };
	const document = { hidden: false, getElementById: () => video, addEventListener: (name, callback) => { documentEvents[name] = callback; } };
	const html = directVideoHtml("https://host/chinese.mp4");
	vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document, window: { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) } } });
	videoEvents.playing(); video.currentTime = 2; videoEvents.waiting();
	video.currentTime = 8; videoEvents.seeking(); video.paused = true; videoEvents.seeked();
	expect(messages.map((message) => message.state)).toEqual(["playing", "buffering", "seeking"]);
	video.paused = false; videoEvents.seeked(); video.currentTime = 12; video.ended = true;
	videoEvents.pause(); videoEvents.ended();
	expect(messages.map((message) => message.state)).toEqual(["playing", "buffering", "seeking", "playing", "ended"]);
	expect(messages.at(-1)).toEqual({ type: "facility-video", state: "ended", positionMs: 12000, durationMs: 12000 });
	document.hidden = true; documentEvents.visibilitychange(); expect(video.pause).toHaveBeenCalledTimes(1);
});

test("both built-in overrides and newly added equipment retain uploaded video data", () => {
	const items = mergeEquipmentCatalog([{ id: 0, name: "Tai Chi", youtubeKey: "-vFxR4gdfPY" }], [
		{ id: "0", videoUrl: "/api/media/a/a.mp4", isActive: true },
		{ id: "custom", isCustom: true, nameEn: "New", videoUrl: "/api/media/b/b.mp4", isActive: true },
	], "en");
	expect(items[0]).toMatchObject({ videoUrl: "/api/media/a/a.mp4", youtubeKey: "-vFxR4gdfPY" });
	expect(items[1].videoUrl).toBe("/api/media/b/b.mp4");
});
