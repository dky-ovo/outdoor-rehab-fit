jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from "react";
import { act, create } from "react-test-renderer";
import { useFavorites } from "../useFavorites";
import { getCachedEquipmentCatalog, getEquipmentCatalog, loadCachedEquipmentCatalog } from "../../utils/api";
import { EQUIPMENT_IMAGE_PLACEHOLDER } from "../../utils/equipmentCatalog";
import { getBookmarks, getCachedBookmarks, saveBookmarks } from "../../utils/bookmarks";
import { getLearningProgress, equipmentLearningFlags } from "../../utils/learning";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
jest.mock("expo-router", () => ({ useFocusEffect: callback => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));
jest.mock("../../utils/api", () => ({ getCachedEquipmentCatalog: jest.fn(), loadCachedEquipmentCatalog: jest.fn(), getEquipmentCatalog: jest.fn(), resolveApiAssetUrl: value => value }));
jest.mock("../../utils/bookmarks", () => ({ getBookmarks: jest.fn(), getCachedBookmarks: jest.fn(), saveBookmarks: jest.fn() }));
jest.mock("../../utils/learning", () => ({
	getLearningProgress: jest.fn(),
	equipmentLearningFlags: jest.fn((entry, item, locale) => ({ read: entry?.name === item.name && entry?.locale === locale })),
}));

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const base = [{ id: 0, name: "Zero", icon: 42, categories: [] }, { id: 1, name: "One", icon: 43, categories: [] }, { id: 2, name: "Two", icon: 44, categories: [] }];
const i18n = { t: () => base };
const user = { id: "one", token: "token1", assistantSessionId: "session1" };
const access = () => true;
let tree, current, props;
function Harness(input) { current = useFavorites(input); return null; }
async function mount(extra = {}) {
	props = { user, i18n, locale: "en", isGuest: false, canAccessEquipment: access, ...extra };
	await act(async () => { tree = create(<Harness {...props} />); });
}
async function update(extra = {}) {
	props = { ...props, ...extra };
	await act(async () => tree.update(<Harness {...props} />));
}
const ids = () => current.bookmarkedItems.map(item => item.id);
beforeEach(() => {
	mockFocused = true; jest.clearAllMocks();
	getBookmarks.mockResolvedValue({ 0: true, 1: true });
	getCachedBookmarks.mockReturnValue(null);
	saveBookmarks.mockResolvedValue();
	getLearningProgress.mockResolvedValue({});
	getEquipmentCatalog.mockResolvedValue({ items: [] });
	getCachedEquipmentCatalog.mockReturnValue(null);
	loadCachedEquipmentCatalog.mockResolvedValue(null);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("local favorite cards do not wait for either catalog or learning hydration", async () => {
	const remote = deferred(), learning = deferred();
	getEquipmentCatalog.mockReturnValue(remote.promise); getLearningProgress.mockReturnValue(learning.promise);
	await mount();
	expect(ids()).toEqual([0, 1]); expect(current.loading).toBe(false);
	expect(equipmentLearningFlags).toHaveBeenCalledTimes(2); // only displayed favorites
	await act(async () => learning.resolve({ 0: { name: "Zero", locale: "en" } }));
	expect(current.learning[0].read).toBe(true);
	await act(async () => remote.resolve({ items: [{ id: "custom", isCustom: true, isActive: true, nameEn: "Custom" }] }));
	expect(ids()).toEqual([0, 1]);
});

test("first mount renders the committed login snapshot even if storage and network are still pending", async () => {
	getCachedBookmarks.mockReturnValue({ 1: true });
	getBookmarks.mockReturnValue(new Promise(() => {}));
	getEquipmentCatalog.mockReturnValue(new Promise(() => {}));
	getLearningProgress.mockReturnValue(new Promise(() => {}));
	await mount();
	expect(ids()).toEqual([1]); expect(current.loading).toBe(false);
});

test("a late remote catalog cannot resurrect an optimistically removed favorite", async () => {
	const remote = deferred(), save = deferred();
	getEquipmentCatalog.mockReturnValue(remote.promise); saveBookmarks.mockReturnValue(save.promise);
	getBookmarks.mockResolvedValue({ 0: true, custom: true });
	await mount();
	let operation;
	await act(async () => { operation = current.toggleBookmark(0); });
	expect(ids()).toEqual([]);
	await act(async () => remote.resolve({ items: [{ id: "custom", isCustom: true, isActive: true, nameEn: "Custom" }] }));
	expect(ids()).toEqual(["custom"]);
	await act(async () => { save.resolve(); await operation; });
	expect(saveBookmarks).toHaveBeenCalledWith({ custom: true }, { changedIds: [0] });
});

test("rapid removals preserve both changes and serialize persistence", async () => {
	const first = deferred(); saveBookmarks.mockReturnValueOnce(first.promise).mockResolvedValueOnce();
	await mount();
	let one, two;
	await act(async () => { one = current.toggleBookmark(0); two = current.toggleBookmark(1); });
	expect(ids()).toEqual([]); expect(saveBookmarks).toHaveBeenCalledTimes(1);
	await act(async () => { first.resolve(); await Promise.all([one, two]); });
	expect(saveBookmarks.mock.calls.map(call => call[0])).toEqual([{ 1: true }, {}]);
});

test("a failed latest removal restores the last successfully persisted bookmarks", async () => {
	await mount(); saveBookmarks.mockRejectedValueOnce(new Error("storage"));
	await act(async () => { expect(await current.toggleBookmark(0)).toBe(false); });
	expect(ids()).toEqual([0, 1]);
});

test("new account hides old cards immediately and discards old local reads and learning", async () => {
	const oldBookmarks = deferred(), oldLearning = deferred();
	getBookmarks.mockReturnValueOnce(oldBookmarks.promise).mockResolvedValueOnce({ 2: true });
	getLearningProgress.mockReturnValueOnce(oldLearning.promise).mockResolvedValueOnce({});
	await mount();
	await update({ user: { id: "two", token: "token2" } });
	expect(ids()).toEqual([2]);
	await act(async () => { oldBookmarks.resolve({ 0: true }); oldLearning.resolve({ 0: { name: "Zero", locale: "en" } }); });
	expect(ids()).toEqual([2]); expect(current.learning[0]).toBeUndefined();
});

test("an account switch skips queued old-session saves", async () => {
	const first = deferred(); saveBookmarks.mockReturnValueOnce(first.promise);
	await mount();
	let one, two;
	await act(async () => { one = current.toggleBookmark(0); two = current.toggleBookmark(1); });
	getBookmarks.mockResolvedValue({ 2: true });
	await update({ user: { id: "two", token: "token2" } });
	expect(ids()).toEqual([]);
	await act(async () => { first.resolve(); await Promise.all([one, two]); });
	expect(saveBookmarks).toHaveBeenCalledTimes(1); expect(ids()).toEqual([2]);
});

test("refocus refreshes local bookmarks without blanking cards or overlapping public requests", async () => {
	const remote = deferred(), local = deferred(); getEquipmentCatalog.mockReturnValue(remote.promise);
	await mount();
	mockFocused = false; await update();
	getBookmarks.mockReturnValueOnce(local.promise); mockFocused = true; await update();
	expect(ids()).toEqual([0, 1]); expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
	await act(async () => local.resolve({ 2: true }));
	expect(ids()).toEqual([2]);
	await act(async () => remote.resolve({ items: [] }));
});

test("refresh reading before a user removal cannot later restore that item", async () => {
	await mount(); mockFocused = false; await update();
	const local = deferred(); getBookmarks.mockReturnValueOnce(local.promise);
	mockFocused = true; await update();
	await act(async () => current.toggleBookmark(0));
	await act(async () => local.resolve({ 0: true, 1: true }));
	expect(ids()).toEqual([1]);
});

test("offline refresh keeps a previously loaded custom catalog", async () => {
	getBookmarks.mockResolvedValue({ custom: true });
	getEquipmentCatalog.mockResolvedValueOnce({ items: [{ id: "custom", isCustom: true, isActive: true, nameEn: "Custom" }] });
	await mount(); expect(ids()).toEqual(["custom"]);
	mockFocused = false; await update();
	getEquipmentCatalog.mockRejectedValueOnce(new Error("offline")); mockFocused = true; await update();
	expect(ids()).toEqual(["custom"]); expect(current.loading).toBe(false);
});

test("a newly mounted favorite screen uses the catalog already loaded by another screen", async () => {
	getCachedEquipmentCatalog.mockReturnValue({ items: [{ id: "custom", isCustom: true, isActive: true, nameEn: "Custom" }] });
	getBookmarks.mockResolvedValue({ custom: true });
	getEquipmentCatalog.mockReturnValue(new Promise(() => {}));
	await mount(); expect(ids()).toEqual(["custom"]); expect(current.loading).toBe(false);
});

test("guest filtering and badge content/language follow the currently shown catalog", async () => {
	getLearningProgress.mockResolvedValue({ 0: { name: "Zero", locale: "en" } });
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: 0, isActive: true, nameEn: "Changed", nameZh: "新內容" }] });
	await mount({ isGuest: true, user: { role: "guest" }, canAccessEquipment: id => String(id) === "0" });
	expect(ids()).toEqual([0]); expect(current.learning[0].read).toBe(false);
	await update({ locale: "zh" });
	expect(current.bookmarkedItems[0].name).toBe("新內容");
	await act(async () => current.toggleBookmark(1));
	expect(saveBookmarks).not.toHaveBeenCalled();
});

test("unmount prevents a late catalog/local response from publishing", async () => {
	const remote = deferred(), local = deferred(); getEquipmentCatalog.mockReturnValue(remote.promise); getBookmarks.mockReturnValue(local.promise);
	await mount(); const snapshot = current;
	await act(async () => tree.unmount()); tree = null;
	await act(async () => { remote.resolve({ items: [] }); local.resolve({ 0: true }); });
	expect(current).toBe(snapshot);
});

test("cold-start cards use neutral images until the persisted public catalog restores replacement URLs", async () => {
	const disk = deferred(), remote = deferred();
	loadCachedEquipmentCatalog.mockReturnValue(disk.promise); getEquipmentCatalog.mockReturnValue(remote.promise);
	await mount();
	expect(ids()).toEqual([0, 1]); expect(current.loading).toBe(false);
	expect(current.bookmarkedItems.map(item => item.icon)).toEqual([EQUIPMENT_IMAGE_PLACEHOLDER, EQUIPMENT_IMAGE_PLACEHOLDER]);
	await act(async () => disk.resolve({ items: [{ id: 0, imageUrl: "/api/equipment-images/replaced.jpg" }] }));
	expect(current.bookmarkedItems[0].icon).toBe("/api/equipment-images/replaced.jpg");
	expect(current.bookmarkedItems[0].fallbackIcon).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
	await act(async () => remote.reject(new Error("offline")));
	expect(current.bookmarkedItems[0].icon).toBe("/api/equipment-images/replaced.jpg");
	expect(current.loading).toBe(false);
});

test("a late disk catalog cannot replace a fresher URL or restore another account's bookmarks", async () => {
	const disk = deferred(); loadCachedEquipmentCatalog.mockReturnValue(disk.promise);
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: 0, imageUrl: "/api/equipment-images/new.jpg" }] });
	await mount();
	expect(current.bookmarkedItems[0].icon).toBe("/api/equipment-images/new.jpg");
	getBookmarks.mockResolvedValue({ 0: true });
	await update({ user: { id: "two", token: "token2" } });
	await act(async () => disk.resolve({ items: [{ id: 0, imageUrl: "/api/equipment-images/stale.jpg" }] }));
	expect(ids()).toEqual([0]);
	expect(current.bookmarkedItems[0].icon).toBe("/api/equipment-images/new.jpg");
});

test("first-run offline favorites keep their text and bookmarks without exposing unverified built-in photos", async () => {
	getEquipmentCatalog.mockRejectedValue(new Error("offline"));
	await mount();
	expect(ids()).toEqual([0, 1]); expect(current.loading).toBe(false);
	expect(current.bookmarkedItems[0]).toMatchObject({ name: "Zero", icon: EQUIPMENT_IMAGE_PLACEHOLDER });
	expect(saveBookmarks).not.toHaveBeenCalled();
});
