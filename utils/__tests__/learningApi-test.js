import { getVolunteerParticipantLearning, saveLearningProgress } from "../api";
beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, items: [] }) }); });
afterEach(() => jest.restoreAllMocks());
test("participant evidence GET encodes identity and all filters, sends auth only in header", async () => {
	await getVolunteerParticipantLearning("secret", "user/one", { date: "2026-09-22", equipmentId: "0", page: 2 });
	const [url, options] = fetch.mock.calls[0];
	expect(url).toContain("/volunteer/participants/user%2Fone/learning?");
	expect(url).toContain("date=2026-09-22"); expect(url).toContain("equipmentId=0"); expect(url).toContain("page=2");
	expect(url).not.toContain("secret"); expect(options.headers.Authorization).toBe("Bearer secret");
});
test("learning uploads omit any target user id and preserve unknown historic dates", async () => {
	const records = [{ equipmentId: "0", date: null, entry: { version: 2, evidence: {} } }];
	await saveLearningProgress("secret", records); const [url, options] = fetch.mock.calls[0];
	expect(url).toContain("/learning/progress"); expect(options.method).toBe("POST");
	expect(JSON.parse(options.body)).toEqual({ records });
});
test("access and offline failures are surfaced, not replaced by own local progress", async () => {
	fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
	await expect(getVolunteerParticipantLearning("token", "other")).rejects.toMatchObject({ status: 403, code: "forbidden" });
	fetch.mockRejectedValue(new Error("offline"));
	await expect(saveLearningProgress("token", [])).rejects.toMatchObject({ code: "networkError" });
});

test("overload exposes a bounded retry delay without replaying a learning mutation", async () => {
	fetch.mockResolvedValue({ ok: false, status: 503, headers: { get: () => "2" }, json: async () => ({ error: "serverBusy" }) });
	await expect(saveLearningProgress("token", [])).rejects.toMatchObject({ status: 503, code: "serverBusy", retryAfterMs: 2000 });
	expect(fetch).toHaveBeenCalledTimes(1);
	fetch.mockResolvedValue({ ok: false, status: 503, headers: { get: () => "9999" }, json: async () => ({ error: "serverBusy" }) });
	await expect(saveLearningProgress("token", [])).rejects.toMatchObject({ retryAfterMs: 120000 });
});
