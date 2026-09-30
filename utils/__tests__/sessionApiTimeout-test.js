import { ApiError, getServerSessions, saveServerSession, deleteServerSession, SESSION_REQUEST_TIMEOUT_MS } from "../api";

const originalFetch = global.fetch;
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; });

test.each([
	["read", () => getServerSessions("token")],
	["save", () => saveServerSession("token", { id: "test" })],
	["delete", () => deleteServerSession("token", "test")],
])("%s request times out even when the native transport ignores abort", async (_name, request) => {
	global.fetch.mockImplementation(() => new Promise(() => {}));
	const result = request().catch((error) => error);
	await jest.advanceTimersByTimeAsync(SESSION_REQUEST_TIMEOUT_MS);
	expect(await result).toEqual(expect.objectContaining({ code: "networkError", status: 0 }));
	expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test("a response whose body stalls is also bounded", async () => {
	global.fetch.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
	const result = getServerSessions("token").catch((error) => error);
	await jest.advanceTimersByTimeAsync(SESSION_REQUEST_TIMEOUT_MS);
	expect(await result).toBeInstanceOf(ApiError);
});

test("normal and rejected responses retain payload and status without a leftover timer", async () => {
	global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sessions: [] }) });
	await expect(getServerSessions("token")).resolves.toEqual({ sessions: [] });
	expect(jest.getTimerCount()).toBe(0);
	global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
	await expect(getServerSessions("token")).rejects.toEqual(expect.objectContaining({ code: "unauthorized", status: 401 }));
	expect(jest.getTimerCount()).toBe(0);
});
