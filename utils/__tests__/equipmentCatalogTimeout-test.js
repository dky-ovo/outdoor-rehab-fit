import { getCachedEquipmentCatalog, getEquipmentCatalog, subscribeEquipmentCatalog } from "../api";

const originalFetch = global.fetch;
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; });

test.each(["fetch", "body"])("catalog bounds a stalled %s even when abort is ignored", async kind => {
	global.fetch.mockImplementation(() => kind === "fetch" ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
	const result = getEquipmentCatalog({ forceRefresh: true }).catch(error => error);
	await jest.advanceTimersByTimeAsync(15000);
	expect(await result).toEqual(expect.objectContaining({ code: "networkError", status: 0 }));
	expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test("normal catalog payload survives with no remaining timeout", async () => {
	global.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "one" }] }) });
	await expect(getEquipmentCatalog({ forceRefresh: true })).resolves.toEqual({ items: [{ id: "one" }] });
	expect(jest.getTimerCount()).toBe(0);
});

test("concurrent screens share one request and retain the last catalog if refresh fails", async () => {
	const previous = getCachedEquipmentCatalog();
	let complete;
	global.fetch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
	const one = getEquipmentCatalog({ forceRefresh: true }), two = getEquipmentCatalog();
	expect(one).toBe(two); expect(global.fetch).toHaveBeenCalledTimes(1);
	complete({ ok: true, json: async () => ({ items: [{ id: "cached-custom", isCustom: true }] }) });
	await one;
	expect(getCachedEquipmentCatalog().items[0].id).toBe("cached-custom");
	global.fetch.mockRejectedValueOnce(new Error("offline"));
	await expect(getEquipmentCatalog({ forceRefresh: true })).rejects.toMatchObject({ code: "networkError" });
	expect(getCachedEquipmentCatalog().items[0].id).toBe("cached-custom");
	expect(getCachedEquipmentCatalog()).not.toBe(previous);
});

test("native taps reuse the fresh catalog while login can force a shared refresh", async () => {
	global.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "fresh" }] }) });
	await getEquipmentCatalog({ forceRefresh: true });
	global.fetch.mockClear();
	await getEquipmentCatalog(); await getEquipmentCatalog();
	expect(global.fetch).not.toHaveBeenCalled();
	await jest.advanceTimersByTimeAsync(60000);
	await getEquipmentCatalog();
	expect(global.fetch).toHaveBeenCalledTimes(1);
	await getEquipmentCatalog({ forceRefresh: true });
	expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("background refresh notifies mounted views and unsubscribe stops notifications", async () => {
	const broken = subscribeEquipmentCatalog(() => { throw new Error("unmounted observer"); });
	const listener = jest.fn(), off = subscribeEquipmentCatalog(listener);
	global.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "updated" }] }) });
	await getEquipmentCatalog({ forceRefresh: true });
	expect(listener).toHaveBeenCalledTimes(1);
	expect(listener.mock.calls[0][0].items[0].id).toBe("updated");
	off(); broken();
	await getEquipmentCatalog({ forceRefresh: true });
	expect(listener).toHaveBeenCalledTimes(1);
});
