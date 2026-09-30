let mockFiles;
const mockPlatform = { OS: "android" };
const mockResolveAsset = jest.fn();
const mockAsset = jest.fn();
jest.mock("react-native", () => ({ Platform: mockPlatform, Image: { resolveAssetSource: (...args) => mockResolveAsset(...args) } }));
const mockLoad = jest.fn();
jest.mock("expo-image", () => ({ Image: { loadAsync: (...args) => mockLoad(...args) } }));
jest.mock("expo-asset", () => ({ Asset: { fromModule: (...args) => mockAsset(...args) } }));
jest.mock("../../constants/Equipments", () => ({ equipmentTranslations: { zh: { equipmentList: [] } } }));
jest.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///documents/" }));
jest.mock("../equipmentImageFiles", () => ({ createEquipmentImageFiles: () => mockFiles }));
jest.mock("../api", () => ({ API_BASE_URL: "https://api.outdoorfit.hk/api", resolveApiAssetUrl: v => v.startsWith("/") ? `https://api.outdoorfit.hk${v}` : v }));
let images;
beforeEach(() => {
  jest.resetModules();
  mockPlatform.OS = "android";
  mockResolveAsset.mockReset().mockImplementation(id => ({ uri: `file:///ota/${id}.jpg` }));
  mockAsset.mockReset().mockImplementation(() => ({ type: "jpg" }));
  mockLoad.mockReset().mockImplementation(async () => ({ width: 800, height: 600, isAnimated: false }));
  mockFiles = { hydration: jest.fn(async () => ({})), subscribe: jest.fn(), get: jest.fn(() => null),
    pin: jest.fn(() => () => {}), invalidate: jest.fn(), cancel: jest.fn(), sync: jest.fn(async () => ({ status: "complete" })) };
  images = require("../equipmentOfflineImages");
});
const catalog = { items: [
  { id: "normal", imageUrl: "/api/equipment-images/a.jpg", gifLeftUrl: "/api/equipment-images/a.gif" },
  { id: "saved", imageUrl: "/api/equipment-images/b.jpg", gifRightUrl: "/api/equipment-images/b.gif" },
  { id: "shared", imageUrl: "/api/equipment-images/a.jpg" },
  { id: "deleted", deletedAt: 123, imageUrl: "/api/equipment-images/deleted.jpg" },
  { id: "disabled", isActive: false, imageUrl: "/api/equipment-images/disabled.jpg" },
] };

test("full public plan deduplicates, prioritizes favorites, excludes removed entries and never includes private fields/videos", () => {
  const plan = images.equipmentImageDownloadPlan(catalog, { saved: true });
  expect(plan.map(x => x.priority)).toEqual([30, 20, 10, 0]);
  expect(plan.map(x => x.url.split("/").pop())).toEqual(["b.jpg", "a.jpg", "b.gif", "a.gif"]);
  expect(plan.every(x => x.version === "" && Object.keys(x).length === 3)).toBe(true);
  expect(images.equipmentImageDownloadPlan({ items: [{ id: "1", videoUrl: "https://api.outdoorfit.hk/api/media/a/a.mp4", token: "private" }] })).toEqual([]);
});

test("hydration distinguishes pending and absent files, runs once, and returns exact current local URI", async () => {
  expect(images.equipmentImageSnapshot("url")).toBe(null);
  await Promise.all([images.hydrateEquipmentImages(), images.hydrateEquipmentImages()]);
  expect(mockFiles.hydration).toHaveBeenCalledTimes(1);
  expect(images.equipmentImageSnapshot("url")).toBe("");
  mockFiles.get.mockReturnValue("file:///ready.jpg");
  expect(images.equipmentImageSnapshot("url")).toBe("file:///ready.jpg");
});

test("identical requests share work; a superseded plan waiting on hydration never starts", async () => {
  let finish;
  mockFiles.hydration.mockImplementation(() => new Promise(r => { finish = r; }));
  const first = images.syncEquipmentImages(catalog);
  expect(images.syncEquipmentImages(catalog)).toBe(first);
  await Promise.resolve();
  const newer = images.syncEquipmentImages({ items: [] });
  finish();
  await expect(first).resolves.toMatchObject({ status: "cancelled" });
  await newer;
  expect(mockFiles.sync).toHaveBeenCalledTimes(1);
  expect(mockFiles.sync).toHaveBeenCalledWith([]);
});

test("cancel prevents a pending hydration from starting downloads and a later foreground can retry", async () => {
  const promise = images.syncEquipmentImages(catalog);
  images.cancelEquipmentImageSync();
  await expect(promise).resolves.toMatchObject({ status: "cancelled" });
  expect(mockFiles.sync).not.toHaveBeenCalled();
  await images.syncEquipmentImages(catalog);
  expect(mockFiles.sync).toHaveBeenCalledTimes(1);
});

test("only verified local main images are predecoded, favorites first, never remote URLs or GIFs", async () => {
  mockFiles.get.mockImplementation(url => url.endsWith(".jpg") ? `file:///documents/${url.split("/").pop()}` : null);
  await images.syncEquipmentImages(catalog, { bookmarks: { saved: true } });
  await new Promise(resolve => setImmediate(resolve));
  expect(mockLoad.mock.calls.map(([source]) => source.uri)).toEqual(["file:///documents/b.jpg", "file:///documents/a.jpg"]);
  expect(mockLoad.mock.calls.every(([, options]) => options.maxWidth === 1024 && options.maxHeight === 1024)).toBe(true);
  const ref = images.equipmentDecodedImageSnapshot("https://api.outdoorfit.hk/api/equipment-images/b.jpg", "file:///documents/b.jpg");
  expect(ref).toEqual(expect.objectContaining({ width: 800, height: 600 }));
  expect(images.equipmentDecodedImageSnapshot("https://api.outdoorfit.hk/api/equipment-images/new.jpg", "file:///documents/b.jpg")).toBeNull();
  await images.syncEquipmentImages(catalog, { bookmarks: { saved: true } });
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

test("finishing a persistent download warms the shared native image before the user opens a card", async () => {
  await images.syncEquipmentImages(catalog);
  expect(mockLoad).not.toHaveBeenCalled();
  mockFiles.get.mockImplementation(url => url.endsWith("b.jpg") ? "file:///documents/b.jpg" : null);
  mockFiles.subscribe.mock.calls[0][0]();
  await new Promise(resolve => setImmediate(resolve));
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(images.equipmentDecodedImageSnapshot("https://api.outdoorfit.hk/api/equipment-images/b.jpg", "file:///documents/b.jpg")).not.toBeNull();
  images.cancelEquipmentImageSync();
  mockFiles.get.mockImplementation(url => url.endsWith("a.jpg") ? "file:///documents/a.jpg" : null);
  mockFiles.subscribe.mock.calls[0][0]();
  await new Promise(resolve => setImmediate(resolve));
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

const flushDecodes = () => new Promise(resolve => setImmediate(resolve));
const base = [
  { id: "normal", icon: 101, horizontalPic: 102 },
  { id: "saved", icon: 201, horizontalPic: 202 },
  { id: "same", icon: 101, horizontalPic: 101 },
];

test("actual bundled card and horizontal photos are distinct shared refs, favorites first and never downloaded", async () => {
  await images.syncEquipmentImages({ items: [] }, { baseItems: base, bookmarks: { saved: true } });
  await flushDecodes();
  expect(mockLoad.mock.calls.map(([source]) => source)).toEqual([201, 202, 101, 102]);
  expect(mockFiles.sync).toHaveBeenCalledWith([]);
  const icon = images.equipmentDecodedImageSnapshot("asset:201", "asset:201");
  const horizontal = images.equipmentDecodedImageSnapshot("asset:202", "asset:202");
  expect(icon).not.toBeNull(); expect(horizontal).not.toBeNull(); expect(horizontal).not.toBe(icon);
  expect(images.equipmentDecodedImageSnapshot("asset:201", "asset:202")).toBeNull();
  const release = images.pinEquipmentImage("asset:201");
  await images.syncEquipmentImages({ items: [] }, { baseItems: base, bookmarks: { saved: true } });
  mockFiles.subscribe.mock.calls[0][0](); release(); await flushDecodes();
  expect(mockLoad).toHaveBeenCalledTimes(4);
  expect(mockFiles.pin).not.toHaveBeenCalled();
});

test("a replacement discards both old bundled mappings and a late decode cannot publish them again", async () => {
  const pending = [];
  mockLoad.mockImplementation(source => new Promise(resolve => pending.push({ source, resolve })));
  await images.syncEquipmentImages({ items: [] }, { baseItems: [base[0]] });
  expect(pending.map(task => task.source)).toEqual([101, 102]);
  mockFiles.get.mockImplementation(url => url.endsWith("new.jpg") ? "file:///private/new.jpg" : null);
  await images.syncEquipmentImages({ items: [{ id: "normal", imageUrl: "/api/equipment-images/new.jpg" }] }, { baseItems: [base[0]] });
  const stale = { width: 800, height: 600, release: jest.fn() };
  pending[0].resolve(stale); pending[1].resolve({ ...stale, release: jest.fn() }); await flushDecodes();
  expect(stale.release).toHaveBeenCalledTimes(1);
  expect(pending[2].source).toEqual({ uri: "file:///private/new.jpg" });
  pending[2].resolve({ width: 800, height: 600 }); await flushDecodes();
  expect(images.equipmentDecodedImageSnapshot("asset:101", "asset:101")).toBeNull();
  expect(images.equipmentDecodedImageSnapshot("asset:102", "asset:102")).toBeNull();
  expect(images.equipmentBundledImageRetired("asset:101")).toBe(true);
  expect(images.equipmentBundledImageRetired("asset:102")).toBe(true);
  expect(images.equipmentDecodedImageSnapshot("https://api.outdoorfit.hk/api/equipment-images/new.jpg", "file:///private/new.jpg")).not.toBeNull();
});

test("neither hydration nor an unknown catalog preheats old bundled defaults", async () => {
  await images.hydrateEquipmentImages();
  await images.syncEquipmentImages(null, { baseItems: base });
  expect(mockAsset).not.toHaveBeenCalled(); expect(mockLoad).not.toHaveBeenCalled();
});

test("removed entries, GIF modules, videos and remotely resolved development assets are not predecoded", async () => {
  mockAsset.mockImplementation(id => ({ type: id === 103 ? "gif" : id === 104 ? "mp4" : "jpg" }));
  mockResolveAsset.mockImplementation(id => ({ uri: id === 105 ? "http://localhost:8081/asset.jpg" : `file:///ota/${id}.jpg` }));
  const baseItems = Array.from({ length: 7 }, (_, i) => ({ id: String(i), icon: 101 + i, horizontalPic: 101 + i }));
  await images.syncEquipmentImages({ items: [{ id: "0", deletedAt: 123 }, { id: "1", isActive: false }] }, { baseItems });
  await flushDecodes();
  expect(mockLoad.mock.calls.map(([source]) => source)).toEqual([106, 107]);
});

test("embedded Android resources are eligible but web never resolves or predecodes modules", async () => {
  mockResolveAsset.mockReturnValue({ uri: "assets_images_horizontal_1" });
  await images.syncEquipmentImages({ items: [] }, { baseItems: [base[0]] }); await flushDecodes();
  expect(mockLoad.mock.calls.map(([source]) => source)).toEqual([101, 102]);
  images.cancelEquipmentImageSync();
  mockPlatform.OS = "web"; mockLoad.mockClear(); mockAsset.mockClear(); mockResolveAsset.mockClear();
  await images.syncEquipmentImages({ items: [] }, { baseItems: base }); await flushDecodes();
  expect(mockLoad).not.toHaveBeenCalled(); expect(mockAsset).not.toHaveBeenCalled(); expect(mockResolveAsset).not.toHaveBeenCalled();
});

test("the expanded catalog still limits prewarming to twelve entries and promotes a mounted exact asset", async () => {
  const baseItems = Array.from({ length: 8 }, (_, i) => ({ id: String(i), icon: 101 + i * 2, horizontalPic: 102 + i * 2 }));
  await images.syncEquipmentImages({ items: [] }, { baseItems, bookmarks: { 7: true } }); await flushDecodes();
  expect(mockLoad).toHaveBeenCalledTimes(12);
  expect(mockLoad.mock.calls.slice(0, 2).map(([source]) => source)).toEqual([115, 116]);
  expect(images.equipmentDecodedImageSnapshot("asset:114", "asset:114")).toBeNull();
  expect(images.equipmentBundledImageRetired("asset:114")).toBe(false);
  const release = images.pinEquipmentImage("asset:114"); await flushDecodes();
  expect(images.equipmentDecodedImageSnapshot("asset:114", "asset:114")).not.toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(13);
  release(); await flushDecodes();
});

test("an asset still used by another active item is not retired with a replaced item", async () => {
  await images.syncEquipmentImages({ items: [{ id: "normal", imageUrl: "/api/equipment-images/new.jpg" }] }, { baseItems: base });
  await flushDecodes();
  expect(images.equipmentBundledImageRetired("asset:101")).toBe(false);
  expect(images.equipmentBundledImageRetired("asset:102")).toBe(true);
  expect(images.equipmentDecodedImageSnapshot("asset:101", "asset:101")).not.toBeNull();
});

test.each([false, true])("remote replacements keep a warm slot ahead of equally bookmarked modules (saved=%s)", async saved => {
  const baseItems = Array.from({ length: 8 }, (_, i) => ({ id: String(i), icon: 101 + i * 2, horizontalPic: 102 + i * 2 }));
  const bookmarks = saved ? Object.fromEntries([...baseItems.map(item => [item.id, true]), ["remote", true]]) : {};
  const remote = "https://api.outdoorfit.hk/api/equipment-images/replacement.jpg";
  mockFiles.get.mockImplementation(url => url === remote ? "file:///private/replacement.jpg" : null);
  await images.hydrateEquipmentImages();
  await images.syncEquipmentImages({ items: [{ id: "remote", isCustom: true, imageUrl: remote }] }, { baseItems, bookmarks });
  await flushDecodes();
  expect(mockLoad).toHaveBeenCalledTimes(12);
  expect(mockLoad.mock.calls[0][0]).toEqual({ uri: "file:///private/replacement.jpg" });
  expect(images.equipmentDecodedImageSnapshot(remote, "file:///private/replacement.jpg")).not.toBeNull();
});
