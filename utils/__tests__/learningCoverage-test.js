import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLearningProgress, learningGroupCoverage, mergeLearningRanges, recordLearningCoverage, learningFlags, markRead, equipmentLearningFlags, learningContentKey, learningVideoKey, learningVideoMetadata } from "../learning";
import { createPlaybackCoverage, createReadingCoverage, visibleLearningRange, learningTextSections } from "../learningCoverage";
import { speechChunks } from "../ttsLearning";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
let mockOwner = "phone:1";
jest.mock("../userStorage", () => ({ getCurrentOwnerKey: () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
beforeEach(async () => { mockOwner = "phone:1"; await AsyncStorage.clear(); jest.clearAllMocks(); });
const evidence = (field, start, end, extras = {}) => recordLearningCoverage({ equipmentId: 0, field, groupKey: "en:revision", parts: [{ key: "a", total: 100 }], partKey: "a", start, end, ...extras });

test("old tap booleans are never 75% evidence and compatibility taps do nothing", async () => {
	await AsyncStorage.setItem("phone:1/learningProgress", JSON.stringify({ 0: { read: true, watched: true, listened: true } }));
	await markRead(0);
	expect(await getLearningProgress()).toEqual({ 0: { read: false, watched: false, listened: false } });
});
test.each(["read", "watched", "listened"])("%s highlights exactly at 75%, independently", async (field) => {
	await evidence(field, 0, 74.99); expect((await getLearningProgress())[0][field]).toBe(false);
	await evidence(field, 74.99, 75); const state = (await getLearningProgress())[0]; expect(state[field]).toBe(true);
	for (const other of ["read", "watched", "listened"].filter((name) => name !== field)) expect(state[other]).toBe(false);
});
test("repeated and overlapping sections count only once and all text sections form the denominator", async () => {
	const parts = [{ key: "a", total: 100 }, { key: "b", total: 300 }];
	await evidence("read", 0, 100, { parts }); await evidence("read", 0, 100, { parts });
	expect((await getLearningProgress())[0].read).toBe(false);
	await evidence("read", 0, 199, { parts, partKey: "b" }); expect((await getLearningProgress())[0].read).toBe(false);
	await evidence("read", 199, 200, { parts, partKey: "b" }); expect((await getLearningProgress())[0].read).toBe(true);
});
test("parallel reading/video/audio callbacks retain all evidence", async () => {
	await Promise.all([evidence("read", 0, 75), evidence("watched", 0, 75), evidence("listened", 0, 75)]);
	expect(learningFlags((await getLearningProgress())[0])).toEqual({ read: true, watched: true, listened: true });
});
test("content versions cannot be added together", async () => {
	await evidence("read", 0, 50); await evidence("read", 50, 100, { groupKey: "new" });
	expect((await getLearningProgress())[0].read).toBe(false);
});
test("favorites use only current content/language and a revised source does not inherit an old green badge", async () => {
	const item = { id: 0, details: "a".repeat(100), videoUrl: "https://test/one.mp4" };
	const groupKey = `en:text:${learningContentKey(JSON.stringify(learningTextSections(item)))}`;
	await evidence("read", 0, 75, { groupKey });
	const entry = (await getLearningProgress())[0];
	expect(equipmentLearningFlags(entry, item, "en").read).toBe(true);
	expect(equipmentLearningFlags(entry, { ...item, details: "b".repeat(100) }, "en").read).toBe(false);
	expect(equipmentLearningFlags(entry, item, "zh").read).toBe(false);
});

test("quality/CDN changes preserve original watched coverage while a different lesson or language stays separate", async () => {
 const original = '/api/media/original/original.mov';
 const item = { id: 0, videoUrl: original };
 await evidence('watched', 0, 75, { groupKey: `en:${learningVideoKey(item)}:100` });
 const entry = (await getLearningProgress())[0];
 const delivery = { ...item, videoUrl: 'https://cdn.example/api/media/original/quality-hash.mp4', videoIdentityUrl: original };
 expect(learningVideoKey(delivery)).toBe(learningContentKey(original));
 expect(equipmentLearningFlags(entry, delivery, 'en').watched).toBe(true);
 expect(equipmentLearningFlags(entry, delivery, 'zh').watched).toBe(false);
 expect(equipmentLearningFlags(entry, { ...delivery, videoIdentityUrl: '/api/media/new/new.mp4' }, 'en').watched).toBe(false);
});

test("a quality rendition uses the original duration group without scaling or inventing watched positions", () => {
 const item = { videoIdentityUrl: '/api/media/original/original.mp4', videoIdentityDurationSeconds: 24.557875 };
 expect(learningVideoMetadata(item, { positionMs: 1000, durationMs: 24602 })).toEqual({ positionMs: 1000, durationMs: 24558 });
 expect(learningVideoMetadata(item, { positionMs: 24602, durationMs: 24602 })).toEqual({ positionMs: 24558, durationMs: 24558 });
 expect(learningVideoMetadata(item, { positionMs: 24500, durationMs: 24500 }).positionMs).toBe(24500);
 const sample = { positionMs: 1000, durationMs: 24602 };
 expect(learningVideoMetadata({ videoIdentityUrl: item.videoIdentityUrl }, sample)).toBe(sample);
 const ranges = jest.fn(), coverage = createPlaybackCoverage(ranges);
 coverage('playing', learningVideoMetadata(item, { positionMs: 0, durationMs: 24602 }), 0);
 coverage('progress', learningVideoMetadata(item, { positionMs: 1000, durationMs: 24602 }), 1000);
 expect(ranges).toHaveBeenCalledWith(0, 1000, 24558);
});
test("no initialized owner means no anonymous progress is recorded or reused as guest", async () => {
	mockOwner = null; await evidence("read", 0, 100); expect(await getLearningProgress()).toEqual({}); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
	mockOwner = "guest"; expect(await getLearningProgress()).toEqual({});
});
test("late previous-account callbacks and queued operations cannot write to next account", async () => {
	const old = evidence("read", 0, 100); mockOwner = "phone:2"; await old;
	await evidence("listened", 0, 100, { owner: "phone:1" });
	expect(await getLearningProgress()).toEqual({});
	expect(await AsyncStorage.getItem("phone:1/learningProgress")).toBeNull();
});
test("range validation clamps boundaries, merges overlaps, rejects invalid values", () => {
	expect(mergeLearningRanges([[50, 80], [-5, 60], [90, 110], [NaN, 70], [80, 75]], 100)).toEqual([[0, 80], [90, 100]]);
	expect(learningGroupCoverage({ parts: [] })).toBe(0);
	expect(learningFlags({ read: true })).toEqual({ read: false, watched: false, listened: false });
});
test("playback coverage ignores seek jumps, repeats, pauses, unknown duration and background gaps", () => {
	const range = jest.fn(); const sample = createPlaybackCoverage(range);
	const at = (state, position, time, duration = 100000) => sample(state, { positionMs: position, durationMs: duration }, time);
	at("progress", 0, 0); at("progress", 1000, 1000); expect(range).not.toHaveBeenCalled();
	at("playing", 0, 1000); at("progress", 1000, 2000); expect(range).toHaveBeenLastCalledWith(0, 1000, 100000);
	at("seeking", 90000, 2100); at("playing", 90000, 2200); at("progress", 91000, 3200);
	expect(range.mock.calls).toEqual([[0, 1000, 100000], [90000, 91000, 100000]]);
	at("paused", 91000, 3300); at("progress", 92000, 4300); expect(range).toHaveBeenCalledTimes(2);
	at("playing", 0, 5000); at("progress", 95000, 6000); expect(range).toHaveBeenCalledTimes(2);
	at("playing", 0, 7000); at("progress", 50000, 57000); expect(range).toHaveBeenCalledTimes(2);
	at("playing", 0, 60000, NaN); at("ended", 100000, 61000, NaN); expect(range).toHaveBeenCalledTimes(2);
});
test("first progress after metadata arrives may establish baseline, but never credits initial seek", () => {
	const range = jest.fn(); const sample = createPlaybackCoverage(range);
	sample("playing"); sample("progress", { positionMs: 70000, durationMs: 100000 }, 0); sample("progress", { positionMs: 71000, durationMs: 100000 }, 1000);
	expect(range.mock.calls).toEqual([[70000, 71000, 100000]]);
});
test("reading requires visible expanded text with stable exposure, not quick scrolling", () => {
	const range = jest.fn(); const reading = createReadingCoverage(range);
	reading([0, .4], 0); expect(range).not.toHaveBeenCalled();
	reading([.4, .8], 1000); expect(range).not.toHaveBeenCalled();
	reading([.4, .8], 2000); expect(range).toHaveBeenCalledWith(.4, .8);
	reading(null, 3000); reading([.4, .8], 4000); expect(range).toHaveBeenCalledTimes(1);
	reading([.4, .8], 10000); expect(range).toHaveBeenCalledTimes(1);
});
test("reading measures actual viewport intersections and rejects horizontal clipping", () => {
	const viewport = { x: 0, y: 100, width: 300, height: 300 };
	expect(visibleLearningRange({ x: 10, y: 0, width: 280, height: 400 }, viewport)).toEqual([.25, 1]);
	expect(visibleLearningRange({ x: 10, y: 450, width: 280, height: 400 }, viewport)).toBeNull();
	expect(visibleLearningRange({ x: 10, y: 100, width: 400, height: 300 }, viewport)).toBeNull();
});
test("empty, slash and disabled TCM sections are not part of the reading/listening denominator", () => {
	expect(learningTextSections({ details: " abc ", ptTip: "/", tcmEnabled: false, tcmTip: "hidden" })).toEqual([{ key: "details", text: "abc", total: 3 }]);
});
test("speech chunks preserve exact text/offsets and do not split surrogate pairs", () => {
	const text = "中文內容。".repeat(70) + "🦋 English instructions. ".repeat(20);
	const chunks = speechChunks(text); expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
	for (const chunk of chunks) { expect(chunk.text).toBe(text.slice(chunk.start, chunk.end)); expect(chunk.text.length).toBeLessThanOrEqual(120); expect(chunk.text.charCodeAt(chunk.text.length - 1)).not.toBe(0xd83e); }
});
