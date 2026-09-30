import { ApiError, API_BASE_URL, ASSISTANT_REQUEST_TIMEOUT_MS, sendAssistantMessage } from "../api";

const originalFetch = global.fetch;
const originalAbortController = global.AbortController;

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function response(payload) {
	return { ok: true, status: 200, json: jest.fn().mockResolvedValue(payload) };
}

beforeEach(() => {
	jest.useFakeTimers();
	global.fetch = jest.fn();
});

afterEach(() => {
	jest.useRealTimers();
	global.fetch = originalFetch;
	global.AbortController = originalAbortController;
});

test.each(["fetch", "body"])("bounds a stalled %s even when abort is ignored", async (stage) => {
	const stalled = deferred();
	const readBody = jest.fn(() => stalled.promise);
	if (stage === "fetch") global.fetch.mockReturnValue(stalled.promise);
	else global.fetch.mockResolvedValue({ ok: true, status: 200, json: readBody });
	const settled = jest.fn();
	const result = sendAssistantMessage({ message: "My question" }, "session-token").catch((error) => {
		settled(error);
		return error;
	});

	expect(ASSISTANT_REQUEST_TIMEOUT_MS).toBe(65000);
	await jest.advanceTimersByTimeAsync(ASSISTANT_REQUEST_TIMEOUT_MS - 1);
	expect(settled).not.toHaveBeenCalled();
	if (stage === "body") expect(readBody).toHaveBeenCalledTimes(1);
	await jest.advanceTimersByTimeAsync(1);

	expect(await result).toBeInstanceOf(ApiError);
	expect(await result).toMatchObject({ code: "assistantTimeout", status: 0 });
	expect(settled).toHaveBeenCalledTimes(1);
	expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test("the deadline also works without AbortController", async () => {
	global.AbortController = undefined;
	global.fetch.mockImplementation(() => new Promise(() => {}));
	const result = sendAssistantMessage({ message: "Question" }).catch((error) => error);
	await jest.advanceTimersByTimeAsync(ASSISTANT_REQUEST_TIMEOUT_MS);
	expect(await result).toMatchObject({ code: "assistantTimeout", status: 0 });
	expect(global.fetch.mock.calls[0][1]).not.toHaveProperty("signal");
	expect(jest.getTimerCount()).toBe(0);
});

test.each([
	["null", null],
	["missing payload", undefined],
	["empty object", {}],
	["array", [{ reply: "Answer" }]],
	["string", "Answer"],
	["number", 1],
	["boolean", true],
	["empty reply", { reply: "" }],
	["whitespace reply", { reply: " \n\t " }],
	["empty text", { text: "" }],
	["whitespace text", { text: " \n\t " }],
	["object reply", { reply: { content: "Answer" } }],
	["array reply", { reply: ["Answer"] }],
	["numeric reply", { reply: 23 }],
	["boolean reply", { reply: true }],
	["non-string fields", { reply: false, text: { content: "Answer" } }],
	["cards without an answer", { recommendations: [{ id: 1 }] }],
])("rejects a successful HTTP response with %s", async (_name, payload) => {
	global.fetch.mockResolvedValue(response(payload));
	await expect(sendAssistantMessage({ message: "Question" })).rejects.toMatchObject({ code: "deepSeekInvalidResponse", status: 502 });
	expect(jest.getTimerCount()).toBe(0);
});

test.each(["Unexpected end of JSON input", "Unexpected token <"])("rejects an unreadable success body: %s", async (message) => {
	global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockRejectedValue(new SyntaxError(message)) });
	await expect(sendAssistantMessage({ message: "Question" })).rejects.toMatchObject({ code: "deepSeekInvalidResponse", status: 502 });
	expect(jest.getTimerCount()).toBe(0);
});

test.each([
	{ reply: "  Please rest today.  ", recommendations: [], recommendationsFinal: true },
	{ text: "A legacy text answer", recommendations: [] },
	{ reply: " \n ", text: "An available text answer", recommendations: [] },
	{ reply: null, text: "An available text answer", recommendations: [] },
])("preserves valid answers with intentionally empty recommendations: %j", async (payload) => {
	global.fetch.mockResolvedValue(response(payload));
	await expect(sendAssistantMessage({ message: "Question" })).resolves.toBe(payload);
	expect(payload.recommendations).toEqual([]);
	expect(jest.getTimerCount()).toBe(0);
});

test.each([false, true])("preserves the request and authorization for photo=%s", async (withPhoto) => {
	const data = {
		message: "  我的問題  ",
		history: [{ role: "user", content: "Earlier question" }],
		locale: "zh-Hant",
		equipment: [{ id: 1, name: "Equipment" }],
		...(withPhoto ? { imageData: "data:image/jpeg;base64,example" } : {}),
	};
	const expectedData = JSON.parse(JSON.stringify(data));
	global.fetch.mockResolvedValue(response({ reply: "Answer", recommendations: [] }));
	await sendAssistantMessage(data, "session-token");
	expect(global.fetch).toHaveBeenCalledTimes(1);
	expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/assistant/chat`, expect.objectContaining({
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: "Bearer session-token" },
		body: JSON.stringify(expectedData),
	}));
	expect(data).toEqual(expectedData);
	expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
});

test("does not invent authorization for an unauthenticated request", async () => {
	global.fetch.mockResolvedValue(response({ reply: "Answer" }));
	await sendAssistantMessage({ message: "Question" });
	expect(global.fetch.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
});

test("preserves server rejection codes and status", async () => {
	global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "deepSeekUnavailable" }) });
	await expect(sendAssistantMessage({ message: "Question" })).rejects.toMatchObject({ code: "deepSeekUnavailable", status: 503 });
	expect(jest.getTimerCount()).toBe(0);
});

test.each([
	[401, "null"], [401, "invalid JSON"],
	[429, "null"], [429, "invalid JSON"],
])("preserves HTTP %s with a %s error body", async (status, bodyType) => {
	global.fetch.mockResolvedValue({
		ok: false, status,
		json: bodyType === "null"
			? jest.fn().mockResolvedValue(null)
			: jest.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
	});
	await expect(sendAssistantMessage({ message: "Question" })).rejects.toMatchObject({ code: "serverError", status });
	expect(jest.getTimerCount()).toBe(0);
});

test("maps a rejected transport to networkError and clears the deadline", async () => {
	global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
	await expect(sendAssistantMessage({ message: "Question" })).rejects.toMatchObject({ code: "networkError", status: 0 });
	expect(jest.getTimerCount()).toBe(0);
});

test.each([
	["fetch", "resolve"], ["fetch", "reject"],
	["body", "resolve"], ["body", "reject"],
])("ignores a late %s %s after the deadline", async (stage, settlement) => {
	const late = deferred();
	if (stage === "fetch") global.fetch.mockReturnValue(late.promise);
	else global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => late.promise });
	const onReply = jest.fn();
	const onError = jest.fn((error) => error);
	const result = sendAssistantMessage({ message: "Question" }).then(onReply, onError);
	await jest.advanceTimersByTimeAsync(ASSISTANT_REQUEST_TIMEOUT_MS);
	const timeout = await result;
	expect(timeout).toMatchObject({ code: "assistantTimeout", status: 0 });

	if (settlement === "reject") late.reject(new TypeError("Late network failure"));
	else late.resolve(stage === "fetch" ? response({ reply: "Late answer" }) : { reply: "Late answer" });
	await jest.advanceTimersByTimeAsync(0);

	expect(await result).toBe(timeout);
	expect(onError).toHaveBeenCalledTimes(1);
	expect(onReply).not.toHaveBeenCalled();
	expect(global.fetch).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});
