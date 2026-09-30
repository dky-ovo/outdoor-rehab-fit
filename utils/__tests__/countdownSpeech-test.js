import * as Speech from "expo-speech";
import { createAudioPlayer } from "expo-audio";
import { ensurePlaybackAudioMode } from "../audioMode";
import { createCountdownSpeaker, isCountdownCueFresh } from "../countdownSpeech";
import { COUNTDOWN_SPEECH_ASSETS } from "../countdownAudioAssets";

jest.mock("expo-speech", () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn() }));
jest.mock("expo-audio", () => ({ createAudioPlayer: jest.fn() }));
jest.mock("../audioMode", () => ({ ensurePlaybackAudioMode: jest.fn() }));
jest.mock("../countdownAudioAssets", () => ({ COUNTDOWN_SPEECH_ASSETS: {
	zh: { halfway: 101, complete: 102 }, en: { halfway: 201, complete: 202 },
} }));

function makePlayer({ loaded = true, buffering = false } = {}) {
	let listener;
	const player = {
		isLoaded: loaded, isBuffering: buffering,
		currentStatus: { isLoaded: loaded, isBuffering: buffering, playing: false, didJustFinish: false },
		play: jest.fn(() => { player.currentStatus = { ...player.currentStatus, playing: true }; }),
		pause: jest.fn(), remove: jest.fn(),
		subscription: { remove: jest.fn() },
		addListener: jest.fn((_event, callback) => { listener = callback; return player.subscription; }),
		emit(status) {
			if (status.isLoaded != null) player.isLoaded = status.isLoaded;
			if (status.isBuffering != null) player.isBuffering = status.isBuffering;
			player.currentStatus = { ...player.currentStatus, ...status };
			listener?.(player.currentStatus);
		},
	};
	return player;
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date("2026-09-08T08:00:00Z"));
	jest.clearAllMocks();
	Speech.getAvailableVoicesAsync.mockReset().mockResolvedValue([]);
	Speech.stop.mockReset().mockResolvedValue(undefined);
	ensurePlaybackAudioMode.mockReset().mockResolvedValue(undefined);
	createAudioPlayer.mockReset().mockImplementation(() => makePlayer());
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test("voice freshness rejects future, invalid and overdue milestones", () => {
	const now = Date.now();
	expect(isCountdownCueFresh(now + 1)).toBe(false);
	expect(isCountdownCueFresh(NaN)).toBe(false);
	expect(isCountdownCueFresh(now - 2000)).toBe(true);
	expect(isCountdownCueFresh(now - 2001)).toBe(false);
});

test("an already-expired milestone never creates a player or enters the speech service", async () => {
	const result = await createCountdownSpeaker().speak("halfway", "zh", () => true, Date.now() - 30_000);
	expect(result).toBe("cancelled");
	expect(Speech.speak).not.toHaveBeenCalled();
	expect(createAudioPlayer).not.toHaveBeenCalled();
	expect(ensurePlaybackAudioMode).not.toHaveBeenCalled();
});

test.each(["audio", "load", "stop"])("%s startup resuming after a suspension cannot play an expired cue", async (stage) => {
	const pending = deferred();
	const player = makePlayer({ loaded: stage !== "load" });
	createAudioPlayer.mockReturnValueOnce(player);
	if (stage === "audio") ensurePlaybackAudioMode.mockReturnValueOnce(pending.promise);
	if (stage === "stop") Speech.stop.mockReturnValueOnce(pending.promise);
	const result = createCountdownSpeaker().speak("halfway", "zh", () => true);
	await flush();
	jest.setSystemTime(Date.now() + 5000);
	pending.resolve();
	if (stage === "load") player.emit({ isLoaded: true });
	expect(await result).toBe("cancelled");
	expect(player.play).not.toHaveBeenCalled();
	if (stage !== "audio") expect(player.remove).toHaveBeenCalledTimes(1);
});

test.each([["zh", "halfway"], ["zh", "complete"], ["en", "halfway"], ["en", "complete"]])("%s %s uses the same bundled speech as native background playback", async (locale, phase) => {
	const speaker = createCountdownSpeaker();
	expect(await speaker.speak(phase, locale, () => true, Date.now() - 1000)).toBe("spoken");
	expect(createAudioPlayer).toHaveBeenCalledWith(COUNTDOWN_SPEECH_ASSETS[locale][phase], { updateInterval: 100, downloadFirst: false });
	const player = createAudioPlayer.mock.results[0].value;
	expect(player.play).toHaveBeenCalledTimes(1);
	expect(Speech.stop).toHaveBeenCalledTimes(1);
	expect(Speech.speak).not.toHaveBeenCalled();
	expect(Speech.getAvailableVoicesAsync).not.toHaveBeenCalled();
	expect(player.playbackRate).toBeUndefined(); // Recording already contains its intended speaking rate.
	speaker.cancel();
});

test("an unknown phase creates no player", async () => {
	expect(await createCountdownSpeaker().speak("other", "zh", () => true)).toBe("cancelled");
	expect(createAudioPlayer).not.toHaveBeenCalled();
});

test("loading is awaited without arming native autoplay, including Web's optimistic status", async () => {
	const player = makePlayer({ loaded: false });
	player.currentStatus.isLoaded = true;
	createAudioPlayer.mockReturnValueOnce(player);
	const result = createCountdownSpeaker().speak("halfway", "zh", () => true);
	await flush();
	expect(player.play).not.toHaveBeenCalled();
	expect(Speech.stop).not.toHaveBeenCalled();
	player.emit({ isLoaded: true, isBuffering: true }); await flush();
	expect(player.play).not.toHaveBeenCalled();
	player.emit({ isBuffering: false });
	expect(await result).toBe("spoken");
});

test("an unloaded recording expires and cannot start after a later load event", async () => {
	const player = makePlayer({ loaded: false });
	createAudioPlayer.mockReturnValueOnce(player);
	const result = createCountdownSpeaker().speak("halfway", "zh", () => true);
	await flush(); jest.advanceTimersByTime(2100);
	expect(await result).toBe("cancelled");
	player.emit({ isLoaded: true }); await flush();
	expect(player.play).not.toHaveBeenCalled();
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test.each(["load", "stop"])("cancel during %s releases the pending recording without late playback", async (stage) => {
	const speaker = createCountdownSpeaker();
	const player = makePlayer({ loaded: stage !== "load" });
	const pending = deferred();
	createAudioPlayer.mockReturnValueOnce(player);
	if (stage === "stop") Speech.stop.mockReturnValueOnce(pending.promise);
	const result = speaker.speak("halfway", "zh", () => true);
	await flush(); speaker.cancel();
	player.emit({ isLoaded: true }); pending.resolve();
	expect(await result).toBe("cancelled");
	expect(player.play).not.toHaveBeenCalled();
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test("cancel only releases the owned player, not unrelated new section speech", async () => {
	const speaker = createCountdownSpeaker();
	speaker.cancel(); expect(Speech.stop).not.toHaveBeenCalled();
	await speaker.speak("halfway", "zh", () => true);
	const player = createAudioPlayer.mock.results[0].value;
	speaker.cancel(); speaker.cancel();
	expect(player.pause).toHaveBeenCalledTimes(1);
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(Speech.stop).toHaveBeenCalledTimes(1);
});

test("starting a new cue releases the previous one and ignores its late completion callback", async () => {
	const speaker = createCountdownSpeaker();
	await speaker.speak("halfway", "zh", () => true);
	const first = createAudioPlayer.mock.results[0].value;
	await speaker.speak("complete", "en", () => true);
	const second = createAudioPlayer.mock.results[1].value;
	expect(first.remove).toHaveBeenCalledTimes(1);
	first.emit({ didJustFinish: true });
	expect(second.remove).not.toHaveBeenCalled();
	second.emit({ didJustFinish: true });
	expect(second.remove).toHaveBeenCalledTimes(1);
	expect(second.subscription.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test("a superseded load callback cannot interrupt or resurrect another cue", async () => {
	const first = makePlayer({ loaded: false });
	createAudioPlayer.mockReturnValueOnce(first);
	const speaker = createCountdownSpeaker();
	const oldResult = speaker.speak("halfway", "zh", () => true);
	await flush();
	expect(await speaker.speak("complete", "en", () => true)).toBe("spoken");
	const second = createAudioPlayer.mock.results[1].value;
	first.emit({ isLoaded: true });
	expect(await oldResult).toBe("cancelled");
	expect(first.play).not.toHaveBeenCalled();
	expect(second.remove).not.toHaveBeenCalled();
	expect(Speech.stop).toHaveBeenCalledTimes(1);
});

test("completion releases the recording even when Web does not emit an ended event", async () => {
	await createCountdownSpeaker().speak("halfway", "zh", () => true);
	const player = createAudioPlayer.mock.results[0].value;
	player.currentStatus = { ...player.currentStatus, didJustFinish: true };
	jest.advanceTimersByTime(100);
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test("a playing sentence is allowed to finish beyond the start freshness window", async () => {
	const cueAt = Date.now();
	await createCountdownSpeaker().speak("complete", "zh", () => isCountdownCueFresh(cueAt), cueAt);
	const player = createAudioPlayer.mock.results[0].value;
	jest.advanceTimersByTime(3000);
	expect(player.remove).not.toHaveBeenCalled();
	player.emit({ didJustFinish: true });
	expect(player.remove).toHaveBeenCalledTimes(1);
});

test("a queued play which never actually starts is stopped when its cue expires", async () => {
	const player = makePlayer(); player.play.mockImplementation(() => {});
	createAudioPlayer.mockReturnValueOnce(player);
	await createCountdownSpeaker().speak("complete", "zh", () => true);
	jest.advanceTimersByTime(2100);
	expect(player.pause).toHaveBeenCalledTimes(1);
	expect(player.remove).toHaveBeenCalledTimes(1);
});

test("the provider's ownership cancellation stops an active sentence", async () => {
	const speaker = createCountdownSpeaker();
	await speaker.speak("complete", "zh", () => true);
	const player = createAudioPlayer.mock.results[0].value;
	speaker.cancel();
	expect(player.remove).toHaveBeenCalledTimes(1);
});

test("a synchronous failed-load event leaves no listener or timer behind", async () => {
	const player = makePlayer({ loaded: false });
	player.addListener.mockImplementation((_name, callback) => {
		callback({ playbackState: "error" });
		return player.subscription;
	});
	createAudioPlayer.mockReturnValueOnce(player);
	expect(await createCountdownSpeaker().speak("halfway", "zh", () => true)).toBe("cancelled");
	expect(player.subscription.remove).toHaveBeenCalledTimes(1);
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test("a lost native finish callback cannot retain the player indefinitely", async () => {
	await createCountdownSpeaker().speak("complete", "zh", () => true);
	const player = createAudioPlayer.mock.results[0].value;
	jest.advanceTimersByTime(15_000);
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test.each(["create", "listen", "play", "stop"])("%s errors release resources and never fall back to system TTS", async (stage) => {
	const player = makePlayer();
	createAudioPlayer.mockReturnValueOnce(player);
	if (stage === "create") createAudioPlayer.mockReset().mockImplementation(() => { throw new Error("failed"); });
	if (stage === "listen") player.addListener.mockImplementation(() => { throw new Error("failed"); });
	if (stage === "play") player.play.mockImplementation(() => { throw new Error("failed"); });
	if (stage === "stop") Speech.stop.mockRejectedValueOnce(new Error("failed"));
	expect(await createCountdownSpeaker().speak("halfway", "zh", () => true)).toBe("failed");
	if (stage !== "create") expect(player.remove).toHaveBeenCalledTimes(1);
	expect(Speech.speak).not.toHaveBeenCalled();
	expect(jest.getTimerCount()).toBe(0);
});

test("pause and subscription cleanup errors do not skip player removal", async () => {
	await createCountdownSpeaker().speak("complete", "zh", () => true);
	const player = createAudioPlayer.mock.results[0].value;
	player.pause.mockImplementation(() => { throw new Error("failed"); });
	player.subscription.remove.mockImplementation(() => { throw new Error("failed"); });
	player.emit({ didJustFinish: true });
	expect(player.remove).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});
