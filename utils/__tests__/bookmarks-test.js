import AsyncStorage from "@react-native-async-storage/async-storage";
let getBookmarks, getCachedBookmarks, saveBookmarks;

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
let mockOwner = "phone:one";
jest.mock("../userStorage", () => ({ getCurrentOwnerKey: () => mockOwner, restoreCurrentOwnerKey: async () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
const originalStorageSet = AsyncStorage.setItem.getMockImplementation();
beforeEach(async () => {
	AsyncStorage.setItem.mockImplementation(originalStorageSet);
	mockOwner = "phone:one"; await AsyncStorage.clear(); jest.clearAllMocks();
	jest.isolateModules(() => { ({ getBookmarks, getCachedBookmarks, saveBookmarks } = require("../bookmarks")); });
});
afterEach(() => jest.restoreAllMocks());

test("bookmarks keep existing namespaced data and one-time legacy migration", async () => {
	await AsyncStorage.setItem("bookmarkedItems", JSON.stringify({ 0: true }));
	expect(await getBookmarks()).toEqual({ 0: true });
	expect(await AsyncStorage.getItem("phone:one/bookmarkedItems")).toBe('{"0":true}');
	expect(await AsyncStorage.getItem("bookmarkedItems")).toBeNull();
	await saveBookmarks({ 1: true }); expect(await getBookmarks()).toEqual({ 1: true });
});

test("a delayed save stays in the owner namespace captured before the await", async () => {
	let complete, started;
	const writing = new Promise(resolve => { started = resolve; });
	const original = AsyncStorage.setItem.getMockImplementation();
	AsyncStorage.setItem.mockImplementationOnce((key, value) => new Promise(resolve => { complete = async () => { await original(key, value); resolve(); }; started(); }));
	const saving = saveBookmarks({ 0: true });
	await writing;
	mockOwner = "phone:two"; await complete(); await saving;
	expect(JSON.parse(await AsyncStorage.getItem("phone:one/bookmarkedItems")).value).toEqual({0:true});
	expect(await getBookmarks()).toEqual({});
});

test("returning A to B to A keeps queued writes ordered across cache record replacement", async () => {
	const original = AsyncStorage.setItem.getMockImplementation();
	let finishFirst, started;
	const firstStarted = new Promise(resolve => { started = resolve; });
	AsyncStorage.setItem.mockImplementation((key, value) => {
		const persisted = original(key, value);
		if (key === "phone:one/bookmarkedItems" && JSON.parse(value).value?.old1 === true) {
			// Native storage already committed, but its completion callback is still
			// pending. The second old save is queued behind this first promise.
			return persisted.then(() => new Promise(resolve => { finishFirst = resolve; started(); }));
		}
		return persisted;
	});
	const oldFirst = saveBookmarks({ old1: true });
	const oldSecond = saveBookmarks({ old2: true });
	await firstStarted;
	mockOwner = "phone:two";
	expect(await getBookmarks()).toEqual({});
	mockOwner = "phone:one";
	const newest = saveBookmarks({ new3: true });
	await Promise.resolve(); await Promise.resolve();
	const newWriteStartedEarly = AsyncStorage.setItem.mock.calls.some(([key, value]) => key === "phone:one/bookmarkedItems" && JSON.parse(value).value?.new3 === true);
	finishFirst();
	await Promise.all([oldFirst, oldSecond, newest]);
	expect(newWriteStartedEarly).toBe(false);
	expect(AsyncStorage.setItem.mock.calls.filter(([key]) => key === "phone:one/bookmarkedItems").map(([, value]) => JSON.parse(value).value))
		.toEqual([{ old1: true }, { old2: true }, { new3: true }]);
	expect(JSON.parse(await AsyncStorage.getItem("phone:one/bookmarkedItems")).value).toEqual({new3:true});
	expect(getCachedBookmarks()).toEqual({ new3: true });
	expect(await getBookmarks()).toEqual({ new3: true });
});

test("switching owner during a read discards the old account result", async () => {
	let complete, started;
	const writing = new Promise(resolve => { started = resolve; });
	AsyncStorage.getItem.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
	const reading = getBookmarks(); await Promise.resolve(); mockOwner = "phone:two";
	complete('{"0":true}'); expect(await reading).toEqual({});
});

test("login hydration is shared and the first Favorites render can read it without another disk request", async () => {
	await AsyncStorage.setItem("phone:one/bookmarkedItems", '{"0":true}');
	expect(getCachedBookmarks()).toBeNull();
	const [first, second] = await Promise.all([getBookmarks(), getBookmarks()]);
	expect(first).toEqual({ 0: true }); expect(second).toBe(first);
	expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
	expect(getCachedBookmarks()).toBe(first);
	expect(await getBookmarks()).toBe(first);
	expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
});

test("cache never exposes the previous owner's favorites and a successful save refreshes it", async () => {
	await saveBookmarks({ 0: true }); expect(getCachedBookmarks()).toEqual({ 0: true });
	mockOwner = "phone:two"; expect(getCachedBookmarks()).toBeNull();
	await saveBookmarks({ 1: true }); expect(getCachedBookmarks()).toEqual({ 1: true });
	mockOwner = "phone:one"; expect(getCachedBookmarks()).toBeNull();
	expect(await getBookmarks()).toEqual({ 0: true });
});

test("failed writes keep the last committed snapshot", async () => {
	await saveBookmarks({ 0: true });
	AsyncStorage.setItem.mockRejectedValueOnce(new Error("storage"));
	await expect(saveBookmarks({ 1: true })).rejects.toThrow("storage");
	expect(getCachedBookmarks()).toEqual({ 0: true });
});

test("a stale initial read cannot overwrite a newer saved favorite", async () => {
	let finish;
	AsyncStorage.getItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
	const read = getBookmarks(); await Promise.resolve();
	await saveBookmarks({ 1: true }); finish('{"0":true}');
	expect(await read).toEqual({ 1: true }); expect(getCachedBookmarks()).toEqual({ 1: true });
});

test("an initial read racing a failed save rereads committed favorites instead of returning empty", async () => {
	await AsyncStorage.setItem("phone:one/bookmarkedItems", '{"0":true}');
	let finish;
	AsyncStorage.getItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
	const read = getBookmarks(); await Promise.resolve();
	AsyncStorage.setItem.mockRejectedValueOnce(new Error("storage"));
	await expect(saveBookmarks({ 1: true })).rejects.toThrow("storage");
	finish('{"0":true}');
	expect(await read).toEqual({ 0: true }); expect(getCachedBookmarks()).toEqual({ 0: true });
});

test("account changes while copying legacy favorites cannot give the same legacy record to both owners", async () => {
	await AsyncStorage.setItem("bookmarkedItems", '{"0":true}');
	const original = AsyncStorage.setItem.getMockImplementation();
	let finish, started;
	const copying = new Promise(resolve => { started = resolve; });
	AsyncStorage.setItem.mockImplementation((key, value) => key === "phone:one/bookmarkedItems"
		? new Promise(resolve => { finish = async () => { await original(key, value); resolve(); }; started(); })
		: original(key, value));
	const first = getBookmarks(); await copying;
	mockOwner = "phone:two";
	const second = getBookmarks();
	await finish();
	expect(await first).toEqual({}); expect(await second).toEqual({});
	expect(await AsyncStorage.getItem("phone:one/bookmarkedItems")).toBe('{"0":true}');
	expect(await AsyncStorage.getItem("phone:two/bookmarkedItems")).toBeNull();
	expect(await AsyncStorage.getItem("bookmarkedItems")).toBeNull();
});

test("a persisted legacy claim prevents another account copying leftovers after a removal failure", async () => {
	await AsyncStorage.setItem("bookmarkedItems", '{"0":true}');
	AsyncStorage.removeItem.mockRejectedValueOnce(new Error("storage"));
	await getBookmarks();
	jest.isolateModules(() => { ({ getBookmarks, getCachedBookmarks, saveBookmarks } = require("../bookmarks")); });
	mockOwner = "phone:two";
	expect(await getBookmarks()).toEqual({});
	expect(await AsyncStorage.getItem("phone:two/bookmarkedItems")).toBeNull();
});
