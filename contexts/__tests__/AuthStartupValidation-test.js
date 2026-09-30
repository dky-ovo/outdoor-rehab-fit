import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { AuthProvider, useAuth, AUTH_SIGNED_OUT_KEY } from "../AuthContext";
import { AUTH_STORAGE_KEY } from "../../constants/auth";
import { getCurrentUser, loginAccount } from "../../utils/api";
import { ensureUserFolder, purgeDeletedUserData } from "../../utils/userStorage";
import { showAccountDeletedNotice } from "../../utils/accountDeletedNotice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("../../utils/api", () => ({ getCurrentUser: jest.fn(), loginAccount: jest.fn(), updateCurrentUser: jest.fn(), registerAccount: jest.fn(), registerGuestProfile: jest.fn() }));
jest.mock("../../utils/accountDeletedNotice", () => ({ showAccountDeletedNotice: jest.fn() }));
jest.mock("../../utils/userStorage", () => ({ clearCurrentOwner: jest.fn(async () => {}), ensureUserFolder: jest.fn(async () => {}), purgeDeletedUserData: jest.fn(async () => {}) }));
jest.mock("../../utils/usage", () => ({ ensureFirstLoginEvent: jest.fn(async () => {}), trackLoginEvent: jest.fn(async () => {}) }));
jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { getItem: jest.fn(async key => data.get(key) ?? null), setItem: jest.fn(async (key, value) => { data.set(key, value); }), removeItem: jest.fn(async key => { data.delete(key); }), multiRemove: jest.fn(async keys => keys.forEach(key => data.delete(key))), __data: data };
});

const session = { id: "restored-user", name: "Test user", phone: "61234567", role: "user", token: "restored-token", assistantSessionId: "stored-login", loginEventRecordedAt: "recorded" };
const deleted = { status: 401, code: "accountDeleted" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let auth, tree, foreground;
function Probe() { auth = useAuth(); return null; }
const mount = async () => { await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); }); };

beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); AsyncStorage.__data.clear();
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify(session));
  getCurrentUser.mockReset().mockResolvedValue({ user: session });
  ensureUserFolder.mockReset().mockResolvedValue(undefined);
  loginAccount.mockReset(); foreground = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_name, callback) => { foreground = callback; return { remove: jest.fn() }; });
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test("local session and owner are ready while the single background validation is still pending", async () => {
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  expect(auth.user.id).toBe(session.id); expect(auth.ready).toBe(true);
  expect(ensureUserFolder).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }));
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  await act(async () => { foreground("active"); jest.advanceTimersByTime(30000); });
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  await act(async () => checking.resolve({ user: session }));
  expect(auth.user.id).toBe(session.id); expect(auth.ready).toBe(true);
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  await act(async () => foreground("active"));
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTime(30000));
  expect(getCurrentUser).toHaveBeenCalledTimes(3);
});

test("an older token-backed session recovers its missing account ID in the background", async () => {
  const legacy = { ...session }; delete legacy.id;
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify(legacy));
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  expect(auth.ready).toBe(true); expect(auth.user.id).toBeUndefined();
  expect(auth.user.token).toBe(session.token);
  await act(async () => checking.resolve({ user: session }));
  expect(auth.user.id).toBe(session.id);
  expect(auth.user.assistantSessionId).toBe(session.assistantSessionId);
  expect(ensureUserFolder).toHaveBeenLastCalledWith(expect.objectContaining({ id: session.id, phone: session.phone }));
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).id).toBe(session.id);
});

test("background validation never replaces an already known account ID", async () => {
  getCurrentUser.mockResolvedValue({ user: { ...session, id: 'different-user', name: 'Wrong name' } });
  await mount();
  expect(auth.user.id).toBe(session.id); expect(auth.user.name).toBe(session.name);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).id).toBe(session.id);
});

test("a legacy account ID arriving after a new login cannot attach to that login", async () => {
  const legacy = { ...session }; delete legacy.id;
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify(legacy));
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  const next = { ...session, id: 'new-user', phone: '69876543' };
  loginAccount.mockResolvedValueOnce({ user: next, token: 'new-token' });
  getCurrentUser.mockResolvedValue({ user: next });
  await act(async () => auth.login('next', 'password'));
  const foldersBefore = ensureUserFolder.mock.calls.length;
  await act(async () => checking.resolve({ user: session }));
  expect(auth.user.id).toBe('new-user'); expect(auth.user.token).toBe('new-token');
  expect(ensureUserFolder).toHaveBeenCalledTimes(foldersBefore);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).id).toBe('new-user');
});

test.each([
  { status: 0, code: "networkError" },
  { status: 500, code: "serverError" },
  { status: 401, code: "unauthorized" },
])("background %j keeps local access and still retries on foreground", async error => {
  getCurrentUser.mockRejectedValue(error);
  await mount();
  expect(auth.user.id).toBe(session.id); expect(auth.ready).toBe(true);
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).token).toBe(session.token);
  expect(purgeDeletedUserData).not.toHaveBeenCalled();
  await act(async () => foreground("active"));
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  expect(auth.user.id).toBe(session.id);
});

test("a delayed confirmed deletion clears the locally restored session and only that user's data", async () => {
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  expect(auth.user.id).toBe(session.id); expect(auth.ready).toBe(true);
  await act(async () => checking.reject(deleted));
  expect(auth.user).toBeNull(); expect(auth.ready).toBe(true);
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  expect(purgeDeletedUserData).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }));
  expect(purgeDeletedUserData).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(AsyncStorage.__data.get(AUTH_SIGNED_OUT_KEY)).toBe("1");
  expect(router.replace).toHaveBeenCalledWith("/login");
  expect(showAccountDeletedNotice).toHaveBeenCalledTimes(1);
});

test("local owner initialization still gates readiness and the background request", async () => {
  const folder = deferred(); ensureUserFolder.mockReturnValueOnce(folder.promise);
  await mount();
  expect(auth.user).toBeNull(); expect(auth.ready).toBe(false);
  expect(getCurrentUser).not.toHaveBeenCalled();
  await act(async () => folder.resolve());
  expect(auth.user.id).toBe(session.id); expect(auth.ready).toBe(true);
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
});

test("fresh login with the same token still receives its own immediate validation", async () => {
  await mount();
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  await act(async () => auth.logout());
  loginAccount.mockResolvedValueOnce({ user: session, token: session.token });
  await act(async () => auth.login("test", "password"));
  expect(auth.user.assistantSessionId).not.toBe(session.assistantSessionId);
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  expect(getCurrentUser).toHaveBeenLastCalledWith(session.token);
});

test("a newer login completes without waiting for the old background request or accepting its profile", async () => {
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  loginAccount.mockResolvedValueOnce({ user: { ...session, id: "new-user" }, token: "new-token" });
  await act(async () => { expect(await auth.login("new", "password")).toEqual({ success: true }); });
  expect(auth.user.id).toBe("new-user");
  await act(async () => checking.resolve({ user: { ...session, name: "Old remote name" } }));
  expect(auth.user.id).toBe("new-user");
  expect(auth.user.name).toBe(session.name);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).token).toBe("new-token");
  expect(getCurrentUser.mock.calls).toEqual([[session.token], ["new-token"]]);
});

test.each([session.token, "new-token"])("a late deletion cannot clear a newer login using %s", async token => {
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  loginAccount.mockResolvedValueOnce({ user: { ...session, id: "new-user" }, token });
  await act(async () => { await auth.login("new", "password"); });
  expect(auth.user.id).toBe("new-user");
  expect(auth.user.assistantSessionId).not.toBe(session.assistantSessionId);
  await act(async () => checking.reject(deleted));
  expect(auth.user.id).toBe("new-user");
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).id).toBe("new-user");
  expect(purgeDeletedUserData).not.toHaveBeenCalled();
  expect(showAccountDeletedNotice).not.toHaveBeenCalled();
});

test.each(["success", "deleted"])("logout finishes independently and ignores late background %s", async outcome => {
  const checking = deferred(); getCurrentUser.mockReturnValueOnce(checking.promise);
  await mount();
  await act(async () => auth.logout());
  expect(auth.user).toBeNull();
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  await act(async () => { if (outcome === "deleted") checking.reject(deleted); else checking.resolve({ user: session }); });
  expect(auth.user).toBeNull(); expect(auth.ready).toBe(true);
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(getCurrentUser).toHaveBeenCalledTimes(1);
  expect(purgeDeletedUserData).not.toHaveBeenCalled();
  expect(showAccountDeletedNotice).not.toHaveBeenCalled();
});

test("logout during local owner initialization cannot restore that user or start validation", async () => {
  const folder = deferred(); ensureUserFolder.mockReturnValueOnce(folder.promise);
  await mount();
  let loggingOut;
  await act(async () => { loggingOut = auth.logout(); });
  await act(async () => { folder.resolve(); await loggingOut; });
  expect(auth.user).toBeNull(); expect(auth.ready).toBe(true);
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(getCurrentUser).not.toHaveBeenCalled();
});
