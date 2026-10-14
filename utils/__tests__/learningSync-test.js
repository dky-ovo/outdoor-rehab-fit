import AsyncStorage from "@react-native-async-storage/async-storage";
import { recordLearningCoverage, getLearningProgress, getPendingLearningRecords, acknowledgeLearningRecords, learningDateKey } from "../learning";
import { createLearningSync } from "../learningSync";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../api", () => ({ saveLearningProgress: jest.fn() }));
let mockOwner = "phone:1";
jest.mock("../userStorage", () => ({ getCurrentOwnerKey: () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
const range = (start = 0, end = 75, extra = {}) => recordLearningCoverage({ equipmentId: "0", field: "read", groupKey: "zh:text:100-abc", parts: [{ key: "details", total: 100 }], partKey: "details", start, end, ...extra });
const worker = (send, extra = {}) => createLearningSync({ owner: "phone:1", token: "token1", send, ...extra });
beforeEach(async () => { mockOwner = "phone:1"; await AsyncStorage.clear(); jest.clearAllMocks(); });
afterEach(() => jest.restoreAllMocks());

test("research date crosses midnight at Hong Kong time, not UTC", () => {
	expect(learningDateKey(Date.parse("2026-09-21T15:59:59Z"))).toBe("2026-09-21");
	expect(learningDateKey(Date.parse("2026-09-21T16:00:00Z"))).toBe("2026-09-22");
});
test("historical version 2 evidence migrates once without inventing a day; legacy booleans do not", async () => {
	await AsyncStorage.setItem("phone:1/learningProgress", JSON.stringify({ 0: { version: 2, evidence: { read: { old: { parts: [{ key: "a", total: 100 }], ranges: { a: [[0, 75]] } } } } }, 1: { read: true } }));
	const pending = await getPendingLearningRecords(mockOwner);
	expect(pending).toHaveLength(1); expect(pending[0].record.date).toBeNull();
	await acknowledgeLearningRecords(mockOwner, pending);
	expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
	expect((await getLearningProgress())[0].read).toBe(true);
});
test("same area read on two days is evidence for each day but cumulative range is not double-counted", async () => {
	const time = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-21T08:00:00Z"));
	await range(); await range();
	time.mockReturnValue(Date.parse("2026-09-22T08:00:00Z")); await range();
	const pending = await getPendingLearningRecords(mockOwner);
	expect(pending.map((item) => item.record.date)).toEqual(["2026-09-21", "2026-09-22"]);
	expect((await getLearningProgress())[0].evidence.read["zh:text:100-abc"].ranges.details).toEqual([[0, 75]]);
});
test("late acknowledgement cannot erase progress added during upload", async () => {
	await range(0, 30); const old = await getPendingLearningRecords(mockOwner);
	await range(30, 75); await acknowledgeLearningRecords(mockOwner, old);
	const current = await getPendingLearningRecords(mockOwner);
	expect(current).toHaveLength(1); expect(current[0].revision).not.toBe(old[0].revision);
	await acknowledgeLearningRecords(mockOwner, current); expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
});
test("guests remain local and cannot upload or migrate their records into the next account", async () => {
	mockOwner = "guest"; await range(); expect((await getLearningProgress())[0].read).toBe(true);
	expect(await getPendingLearningRecords("guest")).toEqual([]);
	mockOwner = "phone:2"; expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
});
test("offline uploads retain evidence and retry successfully without changing local completion", async () => {
	await range(); const send = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, saved: 0 });
	const sync = worker(send); await sync.flush(); expect(await getPendingLearningRecords(mockOwner)).toHaveLength(1);
	await sync.flush(); expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
	expect((await getLearningProgress())[0].read).toBe(true);
});
test("account switch while HTTP is in flight does not clear or transfer the prior user's outbox", async () => {
	await range(); let complete; let began;
	const started = new Promise((resolve) => { began = resolve; });
	const send = jest.fn(() => new Promise((resolve) => { complete = resolve; began(); }));
	const sync = worker(send); const flush = sync.flush(); await started;
	mockOwner = "phone:2"; complete({ ok: true }); await flush;
	expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
	mockOwner = "phone:1"; expect(await getPendingLearningRecords(mockOwner)).toHaveLength(1);
	expect(send.mock.calls[0][0]).toBe("token1");
});
test("dispose before delayed storage returns prevents an upload", async () => {
	const send = jest.fn(); let complete;
	const pending = () => new Promise((resolve) => { complete = resolve; });
	const sync = worker(send, { pending }); const flush = sync.flush(); sync.dispose(); complete([{ record: { equipmentId: "0" } }]);
	await flush; expect(send).not.toHaveBeenCalled();
});
test("concurrent flushes are single flight and batches are at most twenty records", async () => {
	const records = Array.from({ length: 45 }, (_, i) => ({ key: String(i), revision: 1, record: { equipmentId: String(i) } }));
	const send = jest.fn().mockResolvedValue({ ok: true }); const acknowledge = jest.fn();
	const pending = jest.fn().mockResolvedValue(records); const sync = worker(send, { pending, acknowledge });
	await Promise.all([sync.flush(), sync.flush()]);
	expect(pending).toHaveBeenCalledTimes(1); expect(send.mock.calls.map((call) => call[1].length)).toEqual([20, 20, 5]);
	expect(acknowledge).toHaveBeenCalledTimes(3);
});

test("separate root and learning workers share one account outbox upload", async () => {
	await range(); let release; let entered;
	const started = new Promise(resolve => { entered = resolve; });
	const send = jest.fn(() => new Promise(resolve => { release = resolve; entered(); }));
	const first = worker(send), second = worker(send);
	const pending = first.flush(); await started;
	const shared = second.flush();
	expect(shared).toBe(pending);
	expect(send).toHaveBeenCalledTimes(1);
	release({ ok: true }); await Promise.all([pending, shared]);
	expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
	await range(75, 90);
	const later = jest.fn().mockResolvedValue({ ok: true });
	await worker(later).flush();
	expect(later).toHaveBeenCalledTimes(1);
});

test("failed shared uploads release the flight and retain evidence for a later worker", async () => {
	await range();
	const failed = jest.fn().mockRejectedValue({ status: 503 });
	await worker(failed).flush();
	expect(await getPendingLearningRecords(mockOwner)).toHaveLength(1);
	const recovered = jest.fn().mockResolvedValue({ ok: true });
	await worker(recovered).flush();
	expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
	expect(recovered).toHaveBeenCalledTimes(1);
});
test("an invalid historical item is retained without blocking other valid items", async () => {
	await range(0, 75, { equipmentId: "bad" }); await range();
	const send = jest.fn(async (_, records) => { if (records.some((record) => record.equipmentId === "bad")) throw { status: 400 }; return { ok: true }; });
	await worker(send).flush(); const left = await getPendingLearningRecords(mockOwner);
	expect(left).toHaveLength(1); expect(left[0].record.equipmentId).toBe("bad");
});
test("an old backend or invalid acknowledgement does not discard local evidence", async () => {
	await range(); const send = jest.fn().mockRejectedValueOnce({ status: 404 }).mockResolvedValue({ saved: 1 });
	const sync = worker(send); await sync.flush(); await sync.flush(); expect(await getPendingLearningRecords(mockOwner)).toHaveLength(1);
});
test("unreadable outbox is never overwritten with an empty queue", async () => {
	await AsyncStorage.setItem("phone:1/learningProgressSyncV1", "broken");
	await expect(range()).rejects.toThrow();
	expect(await AsyncStorage.getItem("phone:1/learningProgressSyncV1")).toBe("broken");
	expect((await getLearningProgress())[0].read).toBe(true);
});
test.each([400, 413, "oversized"])("one hundred retained %s records cannot starve later valid evidence", async failure => {
	const records = Array.from({ length: 101 }, (_, i) => ({ key: String(i), revision: 1, record: { equipmentId: String(i), ...(i < 100 && failure === "oversized" ? { extra: "a".repeat(70000) } : {}) } }));
	const send = jest.fn(async (_, batch) => { if (batch.some(item => item.equipmentId !== "100")) throw { status: failure }; return { ok: true }; });
	const acknowledge = jest.fn(); const sync = worker(send, { pending: async () => records, acknowledge });
	await sync.flush(); expect(acknowledge).not.toHaveBeenCalled(); await sync.flush();
	expect(acknowledge).toHaveBeenCalledWith("phone:1", [records[100]]);
});
