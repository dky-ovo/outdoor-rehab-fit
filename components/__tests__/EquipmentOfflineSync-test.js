import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import EquipmentOfflineSync from "../EquipmentOfflineSync";
import { AuthContext } from "../../contexts/AuthContext";
import { getBookmarks } from "../../utils/bookmarks";
import { getEquipmentCatalog, loadCachedEquipmentCatalog, subscribeEquipmentCatalog } from "../../utils/api";
import { hydrateEquipmentImages, syncEquipmentImages, cancelEquipmentImageSync } from "../../utils/equipmentOfflineImages";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext(null) }));
jest.mock("../../utils/bookmarks", () => ({ getBookmarks: jest.fn() }));
jest.mock("../../utils/api", () => ({ getEquipmentCatalog: jest.fn(), loadCachedEquipmentCatalog: jest.fn(), subscribeEquipmentCatalog: jest.fn() }));
jest.mock("../../utils/equipmentOfflineImages", () => ({ hydrateEquipmentImages: jest.fn(), syncEquipmentImages: jest.fn(), cancelEquipmentImageSync: jest.fn() }), { virtual: true });

const auth = { user: { id: "one", token: "token-one", assistantSessionId: "login-one", role: "user" }, isLoading: false, isGuest: false };
const cached = { items: [{ id: 9, imageUrl: "/cached.jpg" }, { id: 2, imageUrl: "/other.jpg" }] };
const fresh = { items: [{ id: 9, imageUrl: "/new.jpg" }, { id: 2, imageUrl: "/other.jpg" }] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let tree, onAppState, subscriptions, clock;
const view = value => <AuthContext.Provider value={value}><EquipmentOfflineSync /></AuthContext.Provider>;
const mount = async (value = auth) => { await act(async () => { tree = renderer.create(view(value)); }); };
const update = async value => { await act(async () => tree.update(view(value))); };
const changeAppState = async state => { await act(async () => onAppState(state)); };

beforeEach(() => {
	jest.clearAllMocks();
	subscriptions = [];
	clock = 100000;
	jest.spyOn(Date, "now").mockImplementation(() => clock);
	Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
	jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => { onAppState = callback; return { remove: jest.fn() }; });
	hydrateEquipmentImages.mockReset().mockResolvedValue(undefined);
	syncEquipmentImages.mockReset().mockResolvedValue({ ok: true });
	getBookmarks.mockReset().mockResolvedValue({ 9: true });
	loadCachedEquipmentCatalog.mockReset().mockResolvedValue(cached);
	getEquipmentCatalog.mockReset().mockResolvedValue(null);
	subscribeEquipmentCatalog.mockReset().mockImplementation(callback => {
		const subscription = { callback, unsubscribe: jest.fn() };
		subscriptions.push(subscription);
		return subscription.unsubscribe;
	});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test("hydrates before auth readiness and starts no session work until the local owner is ready", async () => {
	const hydration = deferred(); hydrateEquipmentImages.mockReturnValue(hydration.promise);
	await mount({ ...auth, isLoading: true });
	expect(tree.toJSON()).toBeNull();
	expect(hydrateEquipmentImages).toHaveBeenCalledTimes(1);
	expect(getBookmarks).not.toHaveBeenCalled();
	expect(getEquipmentCatalog).not.toHaveBeenCalled();
	await update(auth);
	expect(hydrateEquipmentImages).toHaveBeenCalledTimes(1);
	expect(getEquipmentCatalog).toHaveBeenCalledWith({ forceRefresh: true });
	expect(syncEquipmentImages).toHaveBeenCalledWith(cached, { bookmarks: { 9: true } });
	await act(async () => hydration.resolve());
});

test("cached full catalog starts as soon as bookmarks are ready without waiting for the cloud", async () => {
	const bookmarkRead = deferred(), cloud = deferred();
	getBookmarks.mockReturnValueOnce(bookmarkRead.promise);
	getEquipmentCatalog.mockReturnValueOnce(cloud.promise);
	await mount();
	expect(tree.toJSON()).toBeNull();
	expect(loadCachedEquipmentCatalog).toHaveBeenCalledTimes(1);
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
	expect(syncEquipmentImages).not.toHaveBeenCalled();
	await act(async () => bookmarkRead.resolve({ 9: true }));
	expect(syncEquipmentImages.mock.calls).toEqual([[cached, { bookmarks: { 9: true } }]]);
	await act(async () => cloud.resolve(fresh));
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(fresh, { bookmarks: { 9: true } });
});

test("subscribed fresh data waits for bookmark priority and a late cached read cannot overwrite it", async () => {
	const bookmarkRead = deferred(), disk = deferred(), cloud = deferred();
	getBookmarks.mockReturnValueOnce(bookmarkRead.promise);
	loadCachedEquipmentCatalog.mockReturnValueOnce(disk.promise);
	getEquipmentCatalog.mockReturnValueOnce(cloud.promise);
	await mount();
	await act(async () => subscriptions[0].callback(fresh));
	expect(syncEquipmentImages).not.toHaveBeenCalled();
	await act(async () => bookmarkRead.resolve({ 2: true }));
	expect(syncEquipmentImages).toHaveBeenCalledWith(fresh, { bookmarks: { 2: true } });
	await act(async () => { disk.resolve(cached); cloud.resolve(cached); });
	expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
});

test.each([
	{ user: { ...auth.user, id: "two" } },
	{ user: { ...auth.user, token: "token-two" } },
	{ user: { ...auth.user, assistantSessionId: "login-two" } },
	{ user: { ...auth.user, role: "guest" }, isGuest: true },
])("each new session %j forces a cloud check but ordinary profile rerenders do not", async change => {
	await mount();
	await update({ ...auth, user: { ...auth.user, name: "Changed display name" } });
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
	await update({ ...auth, ...change });
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(2);
	expect(getEquipmentCatalog.mock.calls).toEqual([[{ forceRefresh: true }], [{ forceRefresh: true }]]);
	expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
});

test("foreground resumes local images with fresh bookmark priority and throttles cloud checks to 60 seconds", async () => {
	await mount();
	await changeAppState("inactive");
	expect(cancelEquipmentImageSync).toHaveBeenCalledTimes(1);
	clock += 20000;
	getBookmarks.mockResolvedValueOnce({ 2: true });
	await changeAppState("active");
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(cached, { bookmarks: { 2: true } });
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
	await changeAppState("active");
	expect(getBookmarks).toHaveBeenCalledTimes(2);
	await changeAppState("background");
	clock += 40000;
	await changeAppState("active");
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(2);
	expect(loadCachedEquipmentCatalog).toHaveBeenCalledTimes(3);
});

test("cloud and subscriber results received in the background do not restart downloads", async () => {
	const cloud = deferred(); getEquipmentCatalog.mockReturnValueOnce(cloud.promise);
	await mount();
	await changeAppState("background");
	const before = syncEquipmentImages.mock.calls.length;
	await act(async () => { subscriptions[0].callback(fresh); cloud.resolve(fresh); });
	expect(syncEquipmentImages).toHaveBeenCalledTimes(before);
	await changeAppState("active");
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(fresh, { bookmarks: { 9: true } });
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
});

test("launching in the background defers downloads and the first cloud check until active", async () => {
	Object.defineProperty(AppState, "currentState", { configurable: true, value: "background" });
	await mount();
	expect(hydrateEquipmentImages).toHaveBeenCalledTimes(1);
	expect(syncEquipmentImages).not.toHaveBeenCalled();
	expect(getEquipmentCatalog).not.toHaveBeenCalled();
	await changeAppState("active");
	expect(syncEquipmentImages).toHaveBeenCalledWith(cached, { bookmarks: { 9: true } });
	expect(getEquipmentCatalog).toHaveBeenCalledWith({ forceRefresh: true });
});

test("logout cancels work and old results cannot use old bookmark priority in a new account", async () => {
	const bookmarkRead = deferred(), disk = deferred(), cloud = deferred();
	getBookmarks.mockReturnValueOnce(bookmarkRead.promise);
	loadCachedEquipmentCatalog.mockReturnValueOnce(disk.promise);
	getEquipmentCatalog.mockReturnValueOnce(cloud.promise);
	await mount();
	const oldSubscriber = subscriptions[0].callback;
	await update({ user: null, isLoading: false, isGuest: false });
	expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
	expect(cancelEquipmentImageSync).toHaveBeenCalledTimes(1);
	getBookmarks.mockResolvedValueOnce({ 2: true });
	await update({ ...auth, user: { ...auth.user, id: "two", token: "token-two", assistantSessionId: "login-two" } });
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(cached, { bookmarks: { 2: true } });
	const calls = syncEquipmentImages.mock.calls.length;
	await act(async () => { bookmarkRead.resolve({ 9: true }); disk.resolve(fresh); cloud.resolve(fresh); oldSubscriber(fresh); });
	expect(syncEquipmentImages).toHaveBeenCalledTimes(calls);
});

test("unmount unsubscribes, cancels, and prevents pending callbacks from scheduling work", async () => {
	const cloud = deferred(); getEquipmentCatalog.mockReturnValueOnce(cloud.promise);
	await mount();
	const callback = subscriptions[0].callback, listener = onAppState;
	await act(async () => tree.unmount()); tree = null;
	expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
	expect(cancelEquipmentImageSync).toHaveBeenCalledTimes(1);
	const calls = syncEquipmentImages.mock.calls.length;
	await act(async () => { callback(fresh); cloud.resolve(fresh); listener("active"); });
	expect(syncEquipmentImages).toHaveBeenCalledTimes(calls);
});

test("local or cloud errors remain silent and missing bookmarks fall back to catalog-wide downloads", async () => {
	hydrateEquipmentImages.mockRejectedValueOnce(new Error("unavailable"));
	getBookmarks.mockRejectedValueOnce(new Error("unavailable"));
	getEquipmentCatalog.mockRejectedValueOnce(new Error("offline"));
	syncEquipmentImages.mockRejectedValueOnce(new Error("unavailable"));
	await mount();
	expect(tree.toJSON()).toBeNull();
	expect(syncEquipmentImages).toHaveBeenCalledWith(cached, { bookmarks: {} });
});

const advance = async milliseconds => { await act(async () => { jest.advanceTimersByTime(milliseconds); }); };
const failedImages = { status: "complete", ready: 1, failed: 2, skipped: 0 };

test("failed complete plans retry after 5 and 20 seconds, then stop after two retries", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	syncEquipmentImages.mockResolvedValue(failedImages);
	await mount(); expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
	await advance(4999); expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
	await advance(1); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(19999); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(1); expect(syncEquipmentImages).toHaveBeenCalledTimes(3);
	await advance(120000); expect(syncEquipmentImages).toHaveBeenCalledTimes(3);
	expect(syncEquipmentImages.mock.calls.every(([catalog, options]) => catalog === cached && options.bookmarks[9])).toBe(true);
});

test.each([
	{ status: "complete", failed: 0 }, { status: "cancelled", failed: 2 },
	{ status: "unavailable", failed: 2 }, undefined, { ok: true },
])("success and non-complete result %j never start retry polling", async result => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	syncEquipmentImages.mockResolvedValue(result);
	await mount(); await advance(120000); expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
});

test("success on the first retry stops the remaining retry", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	syncEquipmentImages.mockResolvedValueOnce(failedImages).mockResolvedValue({ status: "complete", failed: 0 });
	await mount(); await advance(5000); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(120000); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
});

test("background clears pending retries; foreground gets a fresh retry budget and bookmark priority", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	syncEquipmentImages.mockResolvedValue(failedImages);
	await mount(); await changeAppState("background"); await advance(30000);
	expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
	getBookmarks.mockResolvedValueOnce({ 2: true });
	await changeAppState("active"); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(5000); expect(syncEquipmentImages).toHaveBeenCalledTimes(3);
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(cached, { bookmarks: { 2: true } });
});

test("a newer catalog clears an old retry timer and starts its own bounded retry generation", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	syncEquipmentImages.mockResolvedValue(failedImages);
	await mount(); await advance(4000);
	await act(async () => subscriptions[0].callback(fresh));
	expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(1000); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await advance(4000); expect(syncEquipmentImages).toHaveBeenCalledTimes(3);
	expect(syncEquipmentImages).toHaveBeenLastCalledWith(fresh, { bookmarks: { 9: true } });
});

test("late failure from an old catalog cannot schedule another retry against the current plan", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	const pending = deferred(); syncEquipmentImages.mockReturnValueOnce(pending.promise).mockResolvedValue({ status: "complete", failed: 0 });
	await mount(); await act(async () => subscriptions[0].callback(fresh));
	await act(async () => pending.resolve(failedImages)); await advance(120000);
	expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
});

test("logout clears retry timers and late old-scope failures cannot start work for the next account", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	const pending = deferred(); syncEquipmentImages.mockResolvedValueOnce(failedImages).mockReturnValueOnce(pending.promise).mockResolvedValue({ status: "complete", failed: 0 });
	await mount(); await advance(5000); expect(syncEquipmentImages).toHaveBeenCalledTimes(2);
	await update({ user: null, isLoading: false });
	await update({ ...auth, user: { ...auth.user, id: "two", assistantSessionId: "login-two" } });
	await act(async () => pending.resolve(failedImages)); await advance(120000);
	expect(syncEquipmentImages).toHaveBeenCalledTimes(3);
});

test("unmount clears a scheduled retry without relying on the timer eventually firing", async () => {
	jest.useFakeTimers({ doNotFake: ["Date"] });
	const schedule = jest.spyOn(global, "setTimeout"), clear = jest.spyOn(global, "clearTimeout");
	syncEquipmentImages.mockResolvedValue(failedImages);
	await mount();
	const retryIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 5000);
	expect(retryIndex).toBeGreaterThanOrEqual(0);
	const retryTimer = schedule.mock.results[retryIndex].value;
	await act(async () => tree.unmount()); tree = null;
	expect(clear).toHaveBeenCalledWith(retryTimer); await advance(120000);
	expect(syncEquipmentImages).toHaveBeenCalledTimes(1);
});
