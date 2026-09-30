import { createEquipmentImageMemory } from "../equipmentImageMemory";

const MiB = 1024 * 1024;
const item = (id, priority = 20, uri = `file:///private/${id}.jpg`) => ({ key: `https://api.outdoorfit.hk/api/equipment-images/${id}.jpg`, uri, priority });
const photo = (changes = {}) => ({ width: 1024, height: 1024, isAnimated: false, release: jest.fn(), ...changes });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let count = 0; count < 30; count++) await Promise.resolve(); };
afterEach(() => jest.useRealTimers());

test("shares exact local ImageRefs, ignores plan ordering, and does not decode an unchanged plan twice", async () => {
	const refs = [photo(), photo()], load = jest.fn().mockResolvedValueOnce(refs[0]).mockResolvedValueOnce(refs[1]);
	const memory = createEquipmentImageMemory({ load }), a = item("a"), b = item("b");
	const first = memory.sync([a, b]);
	expect(memory.sync([b, a])).toBe(first);
	expect(await first).toEqual({ status: "complete", ready: 2, failed: 0 });
	expect(memory.get(a.key, a.uri)).toBe(refs[0]);
	expect(memory.get(a.key, b.uri)).toBeNull();
	expect(memory.sync([a, b])).toBe(first);
	expect(load).toHaveBeenCalledTimes(2);
});

test("two keys for the same file reuse one decode without allowing an unrelated key", async () => {
	const ref = photo(), load = jest.fn().mockResolvedValue(ref);
	const memory = createEquipmentImageMemory({ load }), a = item("a"), alias = item("alias", 30, a.uri);
	expect(await memory.sync([a, alias])).toMatchObject({ ready: 2 });
	expect(load).toHaveBeenCalledTimes(1);
	expect(memory.get(a.key, a.uri)).toBe(ref);
	expect(memory.get(alias.key, a.uri)).toBe(ref);
	expect(memory.get(item("other").key, a.uri)).toBeNull();
});

test("loading failure is memoized for the same complete plan and can retry after cancel", async () => {
	const ref = photo(), load = jest.fn().mockRejectedValueOnce(new Error("decode failed")).mockResolvedValueOnce(ref);
	const memory = createEquipmentImageMemory({ load }), a = item("a");
	const failed = memory.sync([a]);
	expect(await failed).toMatchObject({ ready: 0, failed: 1 });
	expect(memory.sync([a])).toBe(failed); expect(load).toHaveBeenCalledTimes(1);
	memory.cancel();
	expect(await memory.sync([a])).toMatchObject({ ready: 1, failed: 0 });
	expect(memory.get(a.key, a.uri)).toBe(ref);
});

test.each([
	{ isAnimated: true },
	{ width: 8192, height: 8192 },
	{ width: 0 },
	{ height: Infinity },
])("rejects unsuitable decoded images %j and releases only their unpublished refs", async dimensions => {
	const ref = photo(dimensions), load = jest.fn().mockResolvedValue(ref);
	const memory = createEquipmentImageMemory({ load }), a = item("a");
	expect(await memory.sync([a])).toMatchObject({ ready: 0, failed: 1 });
	expect(memory.get(a.key, a.uri)).toBeNull();
	expect(ref.release).toHaveBeenCalledTimes(1);
	await memory.sync([a]); expect(load).toHaveBeenCalledTimes(1);
});

test("uses pixel dimensions without multiplying display density and honors both memory and entry budgets", async () => {
	const refs = [photo({ scale: 3 }), photo({ scale: 3 }), photo({ scale: 3 })];
	const load = jest.fn().mockResolvedValueOnce(refs[0]).mockResolvedValueOnce(refs[1]).mockResolvedValueOnce(refs[2]);
	const memory = createEquipmentImageMemory({ load, budgetBytes: 8 * MiB, maxEntries: 2 });
	const a = item("a", 30), b = item("b", 30), c = item("c", 20);
	expect(await memory.sync([a, b, c])).toMatchObject({ ready: 2, failed: 1 });
	expect(memory.get(a.key, a.uri)).toBe(refs[0]);
	expect(memory.get(b.key, b.uri)).toBe(refs[1]);
	expect(memory.get(c.key, c.uri)).toBeNull();
	expect(refs[0].release).not.toHaveBeenCalled(); expect(refs[1].release).not.toHaveBeenCalled();
	expect(refs[2].release).toHaveBeenCalledTimes(1);
});

test("equal priority evicts least recently used entries, never explicitly releasing published refs", async () => {
	const refs = [photo(), photo(), photo()];
	const load = jest.fn().mockResolvedValueOnce(refs[0]).mockResolvedValueOnce(refs[1]).mockResolvedValueOnce(refs[2]);
	const memory = createEquipmentImageMemory({ load, maxEntries: 2 }), a = item("a"), b = item("b"), c = item("c");
	await memory.sync([a, b]); memory.get(a.key, a.uri);
	await memory.sync([a, b, c]);
	expect(memory.get(a.key, a.uri)).toBe(refs[0]);
	expect(memory.get(b.key, b.uri)).toBeNull();
	expect(memory.get(c.key, c.uri)).toBe(refs[2]);
	expect(refs[1].release).not.toHaveBeenCalled();
	await memory.sync([]);
	expect(memory.get(a.key, a.uri)).toBeNull();
	for (const ref of refs) expect(ref.release).not.toHaveBeenCalled();
});

test("a favorite outranks a more recently used normal image when the cache is full", async () => {
	const refs = [photo(), photo(), photo()];
	const load = jest.fn().mockResolvedValueOnce(refs[0]).mockResolvedValueOnce(refs[1]).mockResolvedValueOnce(refs[2]);
	const memory = createEquipmentImageMemory({ load, maxEntries: 2 }), a = item("a", 30), b = item("b", 20), c = item("c", 30);
	await memory.sync([a, b]); memory.get(b.key, b.uri);
	await memory.sync([a, b, c]);
	expect(memory.get(a.key, a.uri)).toBe(refs[0]);
	expect(memory.get(b.key, b.uri)).toBeNull();
	expect(memory.get(c.key, c.uri)).toBe(refs[2]);
});

test("starts at most two native decodes and prioritizes favorite photos", async () => {
	const tasks = [], load = jest.fn(uri => { const task = deferred(); tasks.push({ ...task, uri }); return task.promise; });
	const memory = createEquipmentImageMemory({ load }), low = item("a", 20), high = item("b", 30), mid = item("c", 25);
	const result = memory.sync([low, high, mid]);
	expect(tasks.map(task => task.uri)).toEqual([high.uri, mid.uri]);
	tasks[0].resolve(photo()); await flush();
	expect(tasks.map(task => task.uri)).toEqual([high.uri, mid.uri, low.uri]);
	tasks[1].resolve(photo()); tasks[2].resolve(photo());
	expect(await result).toMatchObject({ ready: 3, failed: 0 });
});

test("cancellation and late completion cannot publish an old URL for a newer plan", async () => {
	const oldTask = deferred(), newRef = photo(), oldRef = photo();
	const load = jest.fn().mockReturnValueOnce(oldTask.promise).mockResolvedValueOnce(newRef);
	const memory = createEquipmentImageMemory({ load }), old = item("old"), replacement = item("new");
	const previous = memory.sync([old]);
	const next = memory.sync([replacement]);
	expect(await previous).toMatchObject({ status: "cancelled" });
	expect(await next).toMatchObject({ ready: 1 });
	oldTask.resolve(oldRef); await flush();
	expect(memory.get(old.key, old.uri)).toBeNull();
	expect(memory.get(replacement.key, replacement.uri)).toBe(newRef);
	expect(oldRef.release).toHaveBeenCalledTimes(1); expect(newRef.release).not.toHaveBeenCalled();
});

test("changing a local file for the same remote key immediately rejects the previous exact URI", async () => {
	const oldRef = photo(), newRef = photo(), pending = deferred();
	const load = jest.fn().mockResolvedValueOnce(oldRef).mockReturnValueOnce(pending.promise);
	const memory = createEquipmentImageMemory({ load }), old = item("a"), replacement = item("a", 20, "file:///private/retry-a.jpg");
	await memory.sync([old]);
	const result = memory.sync([replacement]);
	expect(memory.get(old.key, old.uri)).toBeNull(); expect(memory.get(replacement.key, replacement.uri)).toBeNull();
	pending.resolve(newRef); await result;
	expect(memory.get(replacement.key, replacement.uri)).toBe(newRef);
	expect(oldRef.release).not.toHaveBeenCalled();
});

test("timeout bounds queued callers but does not free a still-running native slot", async () => {
	jest.useFakeTimers();
	const tasks = [], load = jest.fn(() => { const task = deferred(); tasks.push(task); return task.promise; });
	const memory = createEquipmentImageMemory({ load, timeoutMs: 50 });
	const first = memory.sync([item("a"), item("b"), item("c")]);
	expect(load).toHaveBeenCalledTimes(2);
	jest.advanceTimersByTime(51);
	expect(await first).toMatchObject({ ready: 0, failed: 3 });
	const second = memory.sync([item("new")]);
	expect(load).toHaveBeenCalledTimes(2);
	const stale = photo(); tasks[0].resolve(stale); await flush();
	expect(stale.release).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(3);
	tasks[2].resolve(photo()); expect(await second).toMatchObject({ ready: 1 });
	tasks[1].resolve(photo()); await flush();
});

test("explicit cancel resolves promptly, retains visible refs, and releases a late unpublished ref", async () => {
	const visible = photo(), late = photo(), pending = deferred();
	const load = jest.fn().mockResolvedValueOnce(visible).mockReturnValueOnce(pending.promise);
	const memory = createEquipmentImageMemory({ load }), a = item("a"), b = item("b");
	await memory.sync([a]);
	const syncing = memory.sync([a, b]); memory.cancel();
	expect(await syncing).toMatchObject({ status: "cancelled" });
	expect(memory.get(a.key, a.uri)).toBe(visible); expect(visible.release).not.toHaveBeenCalled();
	pending.resolve(late); await flush();
	expect(memory.get(b.key, b.uri)).toBeNull(); expect(late.release).toHaveBeenCalledTimes(1);
});

test("a decoder returning an already-published object cannot release a reference still held by a view", async () => {
	const ref = photo(), pending = deferred();
	const load = jest.fn().mockResolvedValueOnce(ref).mockReturnValueOnce(pending.promise);
	const memory = createEquipmentImageMemory({ load }), a = item("a"), b = item("b");
	await memory.sync([a]);
	const viewReference = memory.get(a.key, a.uri);
	const syncing = memory.sync([b]); memory.cancel(); await syncing;
	pending.resolve(ref); await flush();
	expect(viewReference).toBe(ref); expect(ref.release).not.toHaveBeenCalled();
});

test("non-local sources and malformed plans never invoke the decoder; listener errors are isolated", async () => {
	const load = jest.fn().mockResolvedValue(photo()), memory = createEquipmentImageMemory({ load });
	for (const values of [[item("a", 20, "https://api.outdoorfit.hk/a.jpg")], [item("a", 20, "file://remote/a.jpg")], [{ ...item("a"), key: "http://insecure/a.jpg" }]]) {
		expect((await memory.sync(values)).status).toBe("unavailable");
	}
	expect(load).not.toHaveBeenCalled();
	const notify = jest.fn(); memory.subscribe(() => { throw new Error("view failure"); });
	const unsubscribe = memory.subscribe(notify);
	await memory.sync([item("a")]); expect(notify).toHaveBeenCalled();
	unsubscribe(); notify.mockClear(); await memory.sync([]); expect(notify).not.toHaveBeenCalled();
});

test("bundled asset identities share the bounded queue with files and retain separate module references", async () => {
	const tasks = [], load = jest.fn(uri => { const task = deferred(); tasks.push({ ...task, uri }); return task.promise; });
	const memory = createEquipmentImageMemory({ load });
	const icon = { key: "asset:101", uri: "asset:101", priority: 30 };
	const header = { key: "asset:102", uri: "asset:102", priority: 30 };
	const remote = item("new", 20);
	const result = memory.sync([remote, icon, header]);
	expect(tasks.map(task => task.uri)).toEqual(["asset:101", "asset:102"]);
	const iconRef = photo(), headerRef = photo();
	tasks[0].resolve(iconRef); await flush();
	expect(tasks.map(task => task.uri)).toEqual(["asset:101", "asset:102", remote.uri]);
	tasks[1].resolve(headerRef); tasks[2].resolve(photo()); await result;
	expect(memory.get(icon.key, icon.uri)).toBe(iconRef);
	expect(memory.get(header.key, header.uri)).toBe(headerRef);
	expect(memory.get(icon.key, header.uri)).toBeNull();
	await memory.sync([remote]);
	expect(memory.get(icon.key, icon.uri)).toBeNull();
	expect(iconRef.release).not.toHaveBeenCalled();
});

test("asset identities reject noncanonical IDs and cannot alias a downloaded file or remote key", async () => {
	const load = jest.fn(), memory = createEquipmentImageMemory({ load });
	for (const id of ["0", "-1", "01", "1.2", "NaN", "9007199254740992"]) {
		expect((await memory.sync([{ key: `asset:${id}`, uri: `asset:${id}` }])).status).toBe("unavailable");
	}
	for (const descriptor of [{ key: "asset:1", uri: "asset:2" }, { key: "asset:1", uri: "file:///one.jpg" }, { key: item("one").key, uri: "asset:1" }]) {
		expect((await memory.sync([descriptor])).status).toBe("unavailable");
	}
	expect(load).not.toHaveBeenCalled();
});
