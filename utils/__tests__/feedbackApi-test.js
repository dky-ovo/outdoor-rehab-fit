import { createFeedbackSubmissionId, submitContactFeedback, getAdminFeedback, getAdminFeedbackDetail, updateAdminFeedback, FEEDBACK_REQUEST_TIMEOUT_MS } from "../feedbackApi";

jest.mock("../api", () => ({
	API_BASE_URL: "/api",
	ApiError: class ApiError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } },
}));

const feedback = { id: "receipt-1", status: "new", createdAt: "2026-09-18T10:00:00.000Z", updatedAt: "2026-09-18T10:00:00.000Z", name: "Tester", email: "test@example.com", subject: "Test", message: "Feedback", notes: "" };
const draft = { submissionId: "draft-1", name: "Tester", email: "test@example.com", subject: "Test", message: "Feedback", locale: "zh" };
const reply = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload, headers: { get: () => null } });
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(reply({ feedback })); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test("submission IDs are distinct UUIDv4 values without a native dependency", () => {
	const ids = Array.from({ length: 500 }, createFeedbackSubmissionId);
	expect(new Set(ids).size).toBe(500);
	for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
});

test("guest submit whitelists fields and validates the receipt", async () => {
	expect(await submitContactFeedback({ ...draft, userId: "forged", notes: "private" })).toEqual({ feedback });
	const [url, options] = fetch.mock.calls[0];
	expect(url).toBe("/api/feedback");
	expect(options.headers.Authorization).toBeUndefined();
	expect(JSON.parse(options.body)).toEqual(draft);
});

test("authenticated submit includes token without silently falling back on 401", async () => {
	fetch.mockResolvedValue(reply({ error: "unauthorized" }, 401));
	await expect(submitContactFeedback(draft, "token")).rejects.toMatchObject({ status: 401, code: "unauthorized" });
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
});

test.each([null, {}, { feedback: {} }, { feedback: { ...feedback, id: "" } }, { feedback: { ...feedback, status: "bad" } }, { feedback: { ...feedback, createdAt: "bad" } }])("invalid successful submission never clears a draft: %j", async (value) => {
	fetch.mockResolvedValue(reply(value));
	await expect(submitContactFeedback(draft)).rejects.toMatchObject({ code: "invalidFeedbackResponse" });
});

test("invalid JSON cannot become success", async () => {
	fetch.mockResolvedValue({ ...reply({}), json: async () => { throw new Error("JSON"); } });
	await expect(submitContactFeedback(draft)).rejects.toMatchObject({ code: "invalidFeedbackResponse" });
});

test("rate-limit retry header survives and conflict stays distinct", async () => {
	fetch.mockResolvedValue({ ...reply({ error: "feedbackRateLimited" }, 429), headers: { get: () => "120" } });
	await expect(submitContactFeedback(draft)).rejects.toMatchObject({ status: 429, retryAfter: 120 });
	fetch.mockResolvedValue(reply({ error: "feedbackSubmissionConflict" }, 409));
	await expect(submitContactFeedback(draft)).rejects.toMatchObject({ code: "feedbackSubmissionConflict", status: 409 });
});

test.each(["fetch", "body"])("bounds stalled %s even if abort is ignored", async (stage) => {
	jest.useFakeTimers();
	const pending = new Promise(() => {});
	fetch.mockImplementation(() => stage === "fetch" ? pending : Promise.resolve({ ...reply({}), json: () => pending }));
	const operation = submitContactFeedback(draft);
	const assertion = expect(operation).rejects.toMatchObject({ code: "feedbackTimeout", status: 0 });
	await jest.advanceTimersByTimeAsync(FEEDBACK_REQUEST_TIMEOUT_MS);
	await assertion;
	expect(jest.getTimerCount()).toBe(0);
});

test("network failure is actionable", async () => {
	fetch.mockRejectedValue(new Error("offline"));
	await expect(submitContactFeedback(draft)).rejects.toMatchObject({ code: "networkError", status: 0 });
});

test("admin search is encoded and paginated response checked", async () => {
	const payload = { items: [feedback], pagination: { page: 2, pageSize: 20, total: 21, totalPages: 2 } };
	fetch.mockResolvedValue(reply(payload));
	expect(await getAdminFeedback("admin", { page: 2, search: "A&B+測試", status: "new" })).toEqual(payload);
	expect(fetch.mock.calls[0][0]).toContain("search=A%26B%2B%E6%B8%AC%E8%A9%A6");
	fetch.mockResolvedValue(reply({ ...payload, pagination: { ...payload.pagination, page: 3 } }));
	await expect(getAdminFeedback("admin")).rejects.toMatchObject({ code: "invalidFeedbackResponse" });
});

test("admin detail and updates encode IDs and whitelist update fields", async () => {
	await getAdminFeedbackDetail("admin", "a/b");
	expect(fetch.mock.calls[0][0]).toBe("/api/admin/feedback/a%2Fb");
	await updateAdminFeedback("admin", "a/b", { status: "resolved", notes: "Handled", expectedUpdatedAt: feedback.updatedAt, email: "forged@example.com" });
	expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ status: "resolved", notes: "Handled", expectedUpdatedAt: feedback.updatedAt });
	expect(fetch.mock.calls[1][1].method).toBe("PATCH");
});

test("admin update preserves concurrency conflict", async () => {
	fetch.mockResolvedValue(reply({ error: "feedbackConflict" }, 409));
	await expect(updateAdminFeedback("admin", "id", { status: "new", notes: "", expectedUpdatedAt: "old" })).rejects.toMatchObject({ code: "feedbackConflict", status: 409 });
});
