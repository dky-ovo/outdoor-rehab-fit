import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureUserFolder, purgeDeletedUserData, getCurrentOwnerKey, getUserJson, clearCurrentOwner, userDataKey } from "../userStorage";
jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { getItem: jest.fn(async key => data.get(key) ?? null), setItem: jest.fn(async (key, value) => { data.set(key, value); }), removeItem: jest.fn(async key => { data.delete(key); }), multiRemove: jest.fn(async keys => keys.forEach(key => data.delete(key))), getAllKeys: jest.fn(async () => [...data.keys()]), __data: data };
});
beforeEach(async () => { jest.clearAllMocks(); AsyncStorage.__data.clear(); await clearCurrentOwner(); });
const account = (id, phone) => ({ id, phone, name: "Test", role: "user", token: "test-token" });
test("confirmed deletion clears only that account's caches, outboxes and both-language AI histories", async () => {
  const user = account("one", "60110001"); await ensureUserFolder(user); const owner = getCurrentOwnerKey();
  for (const key of [userDataKey("exerciseSessions", owner), userDataKey("exerciseSessionsPendingSync", owner), userDataKey("learningProgressSync", owner), "@outdoor_fit_ai_conversations_v2:one:zh", "@outdoor_fit_ai_conversations_v2:one:en", "@outdoor_fit_ai_history_v1:one:zh"]) AsyncStorage.__data.set(key, "sensitive");
  const other = ["userData/phone:601100010/exerciseSessions", "userData/phone:60110002/exerciseSessions", "@outdoor_fit_ai_conversations_v2:two:zh", "outdoor-fit-app-texts-v1"];
  other.forEach(key => AsyncStorage.__data.set(key, "keep"));
  await clearCurrentOwner(); await purgeDeletedUserData(user);
  expect([...AsyncStorage.__data.keys()].some(key => key.startsWith(`userData/${owner}/`))).toBe(false);
  expect(AsyncStorage.__data.has("@outdoor_fit_ai_conversations_v2:one:en")).toBe(false);
  other.forEach(key => expect(AsyncStorage.__data.get(key)).toBe("keep"));
  // A late old offline write is confined to its retired namespace.
  AsyncStorage.__data.set(`userData/${owner}/exerciseSessions`, JSON.stringify([{ journal: "old" }]));
  await ensureUserFolder(account("new-id", user.phone));
  expect(getCurrentOwnerKey()).toBe("user:new-id"); expect(await getUserJson("exerciseSessions", [])).toEqual([]);
});
test("an already deleted/re-created phone gets an independent ID namespace without deleting another owner's cache", async () => {
  const phone = "60110003";
  AsyncStorage.__data.set(`userData/phone:${phone}/meta`, JSON.stringify({ remoteId: "previous-id" }));
  AsyncStorage.__data.set(`userData/phone:${phone}/exerciseSessions`, JSON.stringify([{ journal: "previous owner's data" }]));
  await ensureUserFolder(account("new-owner", phone));
  expect(getCurrentOwnerKey()).toBe("user:new-owner"); expect(await getUserJson("exerciseSessions", [])).toEqual([]);
  expect(AsyncStorage.__data.has(`userData/phone:${phone}/exerciseSessions`)).toBe(true);
  await purgeDeletedUserData(account("new-owner", phone));
  expect(AsyncStorage.__data.has(`userData/phone:${phone}/exerciseSessions`)).toBe(true);
});
test("legacy metadata without a server ID retains the existing user migration", async () => {
  const phone = "60110004";
  AsyncStorage.__data.set(`userData/phone:${phone}/meta`, JSON.stringify({ name: "legacy" }));
  AsyncStorage.__data.set(`userData/phone:${phone}/exerciseSessions`, JSON.stringify([{ id: "kept" }]));
  await ensureUserFolder(account("legacy-now-known", phone));
  expect(getCurrentOwnerKey()).toBe(`phone:${phone}`); expect(await getUserJson("exerciseSessions", [])).toEqual([{ id: "kept" }]);
});
test("persisted retired namespace remains isolated after an APP restart", async () => {
  const phone = "60110005";
  AsyncStorage.__data.set(`userDataRetiredOwner/${encodeURIComponent(`phone:${phone}`)}`, "1");
  AsyncStorage.__data.set(`userData/phone:${phone}/exerciseSessions`, JSON.stringify([{ id: "old" }]));
  await ensureUserFolder(account("restart-new-id", phone));
  expect(getCurrentOwnerKey()).toBe("user:restart-new-id"); expect(await getUserJson("exerciseSessions", [])).toEqual([]);
});

test("cold-start deletion before folder hydration still purges the ID namespace without touching a different phone owner", async () => {
  const phone = "60110006", user = account("deleted-recreated-id", phone);
  AsyncStorage.__data.set(`userDataRetiredOwner/${encodeURIComponent(`phone:${phone}`)}`, "1");
  AsyncStorage.__data.set(`userData/phone:${phone}/meta`, JSON.stringify({ remoteId: "different-old-id" }));
  AsyncStorage.__data.set(`userData/phone:${phone}/exerciseSessions`, "keep-other-id");
  AsyncStorage.__data.set(`userData/user:${user.id}/exerciseSessions`, "remove-deleted-id");
  await purgeDeletedUserData(user);
  expect(AsyncStorage.__data.has(`userData/user:${user.id}/exerciseSessions`)).toBe(false);
  expect(AsyncStorage.__data.get(`userData/phone:${phone}/exerciseSessions`)).toBe("keep-other-id");
});
