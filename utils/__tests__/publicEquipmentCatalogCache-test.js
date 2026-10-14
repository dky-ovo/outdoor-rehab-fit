import { createPublicEquipmentCatalogCache, publicEquipmentCatalog } from "../publicEquipmentCatalogCache";
import { mergeEquipmentCatalog } from "../equipmentCatalog";
import { Platform } from "react-native";
jest.mock('../api', () => ({ resolveApiAssetUrl: value => value }));

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const base = "https://api.outdoorfit.hk/api";
const payload = (url = "/api/equipment-images/new.jpg") => ({ items: [{ id: "9", nameZh: "健騎機", imageUrl: url, isActive: true, categories: ["muscle"], tcmEnabled: null }], categories: [{ id: "muscle", nameZh: "肌肉強化", isBuiltIn: true, sortOrder: 0 }] });
function memoryStorage() {
	const data = new Map();
	return { data, getItem: jest.fn(async key => data.get(key) || null), setItem: jest.fn(async (key, value) => { data.set(key, value); }) };
}

test("a fresh process restores the latest public catalog without storing unknown or account fields", async () => {
	const storage = memoryStorage(), catalog = payload();
	catalog.token = "TOP_SECRET"; catalog.user = { email: "PRIVATE" }; catalog.items[0].password = "ITEM_SECRET";
	const cache = createPublicEquipmentCatalogCache(base, storage);
	expect(cache.store(catalog)).toBe(true);
	await flush();
	const raw = [...storage.data.values()][0];
	for (const secret of ["TOP_SECRET", "PRIVATE", "ITEM_SECRET", "password"]) expect(raw).not.toContain(secret);
	const restored = createPublicEquipmentCatalogCache(base, storage);
	expect(restored.get()).toBeNull(); expect(await restored.load()).toEqual(payload());
	expect(storage.data.size).toBe(1);
});

test("API deployments use separate namespaces and mismatched envelopes are rejected", async () => {
	const storage = memoryStorage();
	createPublicEquipmentCatalogCache(base, storage).store(payload()); await flush();
	expect(await createPublicEquipmentCatalogCache("https://other.example/api", storage).load()).toBeNull();
	storage.getItem.mockResolvedValue([...storage.data.values()][0]);
	expect(await createPublicEquipmentCatalogCache("https://other.example/api", storage).load()).toBeNull();
});

test("a slow disk read cannot overwrite a newer successful network snapshot", async () => {
	const gate = deferred(), storage = memoryStorage();
	storage.getItem.mockReturnValue(gate.promise);
	const cache = createPublicEquipmentCatalogCache(base, storage);
	const loading = cache.load(); await flush();
	cache.store(payload("/new.jpg"));
	gate.resolve(JSON.stringify({ version: 1, apiBase: base, catalog: payload("/old.jpg") }));
	expect((await loading).items[0].imageUrl).toBe("/new.jpg");
	expect(cache.get().items[0].imageUrl).toBe("/new.jpg");
});

test("serialized disk writes persist the newest replacement even when the first write is delayed", async () => {
	const gate = deferred(), storage = memoryStorage();
	const original = storage.setItem.getMockImplementation();
	storage.setItem.mockImplementationOnce(async (key, value) => { await gate.promise; return original(key, value); });
	const cache = createPublicEquipmentCatalogCache(base, storage);
	cache.store(payload("/old.jpg")); cache.store(payload("/new.jpg")); await flush();
	expect(storage.setItem).toHaveBeenCalledTimes(1);
	gate.resolve(); await flush();
	expect(storage.setItem).toHaveBeenCalledTimes(2);
	expect((await createPublicEquipmentCatalogCache(base, storage).load()).items[0].imageUrl).toBe("/new.jpg");
});

test.each(["{broken", JSON.stringify({ version: 2, apiBase: base, catalog: payload() }), JSON.stringify({ version: 1, apiBase: base, catalog: { items: [{ id: "9", imageUrl: {} }] } })])("corrupt or incompatible disk data remains an optional cache", async raw => {
	const storage = memoryStorage(); storage.getItem.mockResolvedValue(raw);
	const cache = createPublicEquipmentCatalogCache(base, storage);
	expect(await cache.load()).toBeNull();
	expect(cache.store(payload())).toBe(true); expect(cache.get()).toEqual(payload());
});

test("storage errors do not discard the in-memory directory or reject network success", async () => {
	const storage = memoryStorage(); storage.getItem.mockRejectedValue(new Error("read failed")); storage.setItem.mockRejectedValue(new Error("disk full"));
	const cache = createPublicEquipmentCatalogCache(base, storage);
	expect(await cache.load()).toBeNull(); expect(cache.store(payload())).toBe(true); await flush();
	expect(cache.get()).toEqual(payload());
});

test.each([
	{ items: Array.from({ length: 1025 }, (_, id) => ({ id })) },
	{ items: [{ id: "9" }, { id: 9 }] },
	{ items: Array.from({ length: 10 }, (_, id) => ({ id, detailsZh: "字".repeat(100000) })) },
])("an uncacheable fresh response invalidates retired URLs in memory and on disk", async value => {
	const storage = memoryStorage();
	const cache = createPublicEquipmentCatalogCache(base, storage); cache.store(payload()); await flush();
	const restored = createPublicEquipmentCatalogCache(base, storage); expect(await restored.load()).toEqual(payload());
	expect(restored.store(value)).toBe(false);
	expect(restored.get()).toBeNull(); expect(await restored.load()).toBeNull();
	await flush();
	expect(await createPublicEquipmentCatalogCache(base, storage).load()).toBeNull();
});

test("invalidating a fresh response also prevents a pending disk read from reviving an old URL", async () => {
	const gate = deferred(), storage = memoryStorage(); storage.getItem.mockReturnValue(gate.promise);
	const cache = createPublicEquipmentCatalogCache(base, storage); const loading = cache.load(); await flush();
	expect(cache.store({ items: [{ id: "9", imageUrl: {} }] })).toBe(false);
	gate.resolve(JSON.stringify({ version: 1, apiBase: base, catalog: payload("/old.jpg") }));
	expect(await loading).toBeNull(); expect(cache.get()).toBeNull();
});

test("a post-invalidation read never races the pending tombstone write by reading stale disk", async () => {
	const storage = memoryStorage();
	storage.getItem.mockResolvedValue(JSON.stringify({ version: 1, apiBase: base, catalog: payload("/retired.jpg") }));
	storage.setItem.mockReturnValue(new Promise(() => {}));
	const cache = createPublicEquipmentCatalogCache(base, storage);
	cache.store({ items: [{ id: "9", imageUrl: {} }] });
	expect(await cache.load()).toBeNull();
	expect(storage.getItem).not.toHaveBeenCalled();
});

test("tombstones, custom equipment and cleared replacement URLs survive public projection", () => {
	const result = publicEquipmentCatalog({ items: [{ id: "9", imageUrl: "", deletedAt: "2026-09-24T00:00:00Z", isActive: false }, { id: "custom", isCustom: true, nameEn: "Custom", videoLocalesEnabled: true }] });
	expect(result.items).toEqual([{ id: "9", imageUrl: "", isActive: false, deletedAt: "2026-09-24T00:00:00Z" }, { id: "custom", nameEn: "Custom", isCustom: true, videoLocalesEnabled: true }]);
});

test("route changes and a new process keep public optimized playback and exact original learning identity", async () => {
	const originalOS = Platform.OS;
	try {
		Platform.OS = "web";
		const storage = memoryStorage(), catalog = payload(), clip = catalog.items[0];
		Object.assign(clip, { videoLocalesEnabled: true, videoUrlZh: "/api/media/source/original.mp4", videoPlaybackUrlZh: "/api/media/source/hash.mp4", videoIdentityUrlZh: "/api/media/source/original.mp4", videoIdentityDurationSecondsZh: 24.557875,
			additionalVideos: [{ id: "extra", titleZh: "附加", videoUrlZh: "/api/media/extra/original.mp4", videoPlaybackUrlZh: "/api/media/extra/hash.mp4", videoIdentityUrlZh: "/api/media/extra/original.mp4", privateToken: "PRIVATE_CHILD" }],
			teachingSections: [{ id: "home", titleZh: "家居", bodyZh: "步驟", adminNotes: "PRIVATE_NOTES" }] });
		const cache = createPublicEquipmentCatalogCache(base, storage); expect(cache.store(catalog)).toBe(true); await flush();
		for (const result of [cache.get(), await createPublicEquipmentCatalogCache(base, storage).load()]) {
			const item = mergeEquipmentCatalog([{ id: 9, name: "Machine" }], result.items, "zh")[0];
			expect(item.videoUrl).toBe(clip.videoPlaybackUrlZh); expect(item.videoIdentityUrl).toBe(clip.videoUrlZh); expect(item.videoIdentityDurationSeconds).toBe(24.557875);
			expect(item.additionalVideos[0].videoUrl).toBe(clip.additionalVideos[0].videoPlaybackUrlZh);
			expect(item.teachingSections[0].body).toBe("步驟");
		}
		for (const secret of ["PRIVATE_CHILD", "PRIVATE_NOTES", "privateToken", "adminNotes"]) expect([...storage.data.values()][0]).not.toContain(secret);
		Platform.OS = "android";
		const native = mergeEquipmentCatalog([{ id: 9, name: "Machine" }], cache.get().items, "zh")[0];
		expect(native.videoUrl).toBe(clip.videoUrlZh); expect(native.videoIdentityDurationSeconds).toBeUndefined(); expect(native.additionalVideos[0].videoUrl).toBe(clip.additionalVideos[0].videoUrlZh);
	} finally { Platform.OS = originalOS; }
});

test.each([
	{ videoIdentityDurationSecondsZh: NaN }, { videoIdentityDurationSecondsZh: -1 },
	{ additionalVideos: Array.from({ length: 41 }, (_, id) => ({ id: String(id) })) },
	{ additionalVideos: [{ id: "duplicate" }, { id: "duplicate" }] },
	{ teachingSections: Array.from({ length: 33 }, (_, id) => ({ id: String(id) })) },
])("invalid or oversized public video metadata cannot reach the cache", fields => {
	expect(publicEquipmentCatalog({ items: [{ id: "0", ...fields }] })).toBeNull();
});
