import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { AuthProvider, useAuth, AUTH_SIGNED_OUT_KEY } from "../AuthContext";
import { AUTH_STORAGE_KEY } from "../../constants/auth";
import { getCurrentUser, loginAccount, updateCurrentUser } from "../../utils/api";
import { captureAccountSession, reportAccountDeleted } from "../../utils/accountSessionEvents";
import { purgeDeletedUserData } from "../../utils/userStorage";
import { showAccountDeletedNotice } from "../../utils/accountDeletedNotice";

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
const session = { id: "deleted-one", name: "Test user", phone: "61234567", role: "user", token: "token-one", assistantSessionId: "first-login", loginAt: "2026-09-23T00:00:00Z", loginEventRecordedAt: "recorded" };
const deleted = { code: "accountDeleted", status: 401 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let tree, auth, foreground;
function Probe() { auth = useAuth(); return null; }
const mount = async () => { await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); }); };
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); AsyncStorage.__data.clear();
  AsyncStorage.getItem.mockImplementation(async key => AsyncStorage.__data.get(key) ?? null);
  AsyncStorage.setItem.mockImplementation(async (key, value) => { AsyncStorage.__data.set(key, value); });
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify(session));
  getCurrentUser.mockReset().mockResolvedValue({ user: session });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => { foreground = callback; return { remove: jest.fn() }; });
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test("startup rejects a confirmed deleted stored account before exposing it and purges that exact user", async () => {
  getCurrentUser.mockRejectedValueOnce(deleted); await mount();
  expect(auth.user).toBeNull(); expect(auth.isLoading).toBe(false);
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(AsyncStorage.__data.get(AUTH_SIGNED_OUT_KEY)).toBe("1");
  expect(purgeDeletedUserData).toHaveBeenCalledWith(expect.objectContaining({ id: session.id, token: session.token }));
  expect(showAccountDeletedNotice).toHaveBeenCalledTimes(1); expect(router.replace).toHaveBeenCalledWith("/login");
});
test.each(["foreground", "interval"])("%s validation signs out only on confirmed deletion", async trigger => {
  await mount(); expect(auth.user.id).toBe(session.id);
  getCurrentUser.mockRejectedValueOnce(deleted);
  await act(async () => { if (trigger === "foreground") foreground("active"); else jest.advanceTimersByTime(30000); });
  expect(auth.user).toBeNull(); expect(showAccountDeletedNotice).toHaveBeenCalledTimes(1);
});
test.each([{ code: "networkError", status: 0 }, { code: "serverError", status: 500 }, { code: "unauthorized", status: 401 }, { code: "accountDeleted", status: 503 }])("transient/ambiguous %j never forces logout", async error => {
  getCurrentUser.mockRejectedValue(error); await mount();
  await act(async () => foreground("active"));
  expect(auth.user.id).toBe(session.id); expect(showAccountDeletedNotice).not.toHaveBeenCalled();
});
test("guests are never polled or signed out by unrelated account events", async () => {
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ role: "guest", name: "guest", isGuest: true }));
  await mount(); await act(async () => { foreground?.("active"); jest.advanceTimersByTime(60000); });
  expect(auth.isGuest).toBe(true); expect(getCurrentUser).not.toHaveBeenCalled(); expect(showAccountDeletedNotice).not.toHaveBeenCalled();
});
test("concurrent failures alert once and a captured old request cannot clear a new login, even with the same token", async () => {
  await mount(); const originalScope = captureAccountSession(session.token);
  await act(async () => { reportAccountDeleted(originalScope, 401, "accountDeleted"); reportAccountDeleted(originalScope, 401, "accountDeleted"); });
  expect(showAccountDeletedNotice).toHaveBeenCalledTimes(1);
  loginAccount.mockResolvedValueOnce({ user: { ...session, id: "new-person" }, token: session.token });
  await act(async () => { await auth.login("new", "password"); });
  await act(async () => reportAccountDeleted(originalScope, 401, "accountDeleted"));
  expect(auth.user.id).toBe("new-person"); expect(showAccountDeletedNotice).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.__data.has(AUTH_SIGNED_OUT_KEY)).toBe(false);
});
test("a delayed restore cannot resurrect an account after explicit logout and reload", async () => {
  const reading = deferred(); AsyncStorage.getItem.mockImplementationOnce(() => reading.promise);
  await mount(); let loggingOut;
  await act(async () => { loggingOut = auth.logout(); });
  expect(auth.user).toBeNull(); expect(AsyncStorage.__data.get(AUTH_SIGNED_OUT_KEY)).toBe("1");
  await act(async () => { reading.resolve(null); await loggingOut; });
  await act(async () => tree.unmount()); await mount();
  expect(auth.user).toBeNull(); expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});
test("sign-out tombstone blocks a stale disk session even if auth-key deletion failed on the previous run", async () => {
  AsyncStorage.__data.set(AUTH_SIGNED_OUT_KEY, "1"); await mount();
  expect(auth.user).toBeNull(); expect(getCurrentUser).not.toHaveBeenCalled();
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});
test("a profile write already underway cannot resurrect deletion and cleanup finishes before a later account persists", async () => {
  await mount(); const oldScope = captureAccountSession(session.token);
  const writing = deferred(), release = deferred();
  updateCurrentUser.mockResolvedValueOnce({ user: { ...session, name: "late rename" } });
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (key === AUTH_STORAGE_KEY && JSON.parse(value).name === "late rename") { writing.resolve(); await release.promise; }
    AsyncStorage.__data.set(key, value);
  });
  let saving; await act(async () => { saving = auth.updateProfile({ name: "late rename" }); await writing.promise; });
  await act(async () => reportAccountDeleted(oldScope, 401, "accountDeleted"));
  expect(auth.user).toBeNull();
  await act(async () => { release.resolve(); await saving; });
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false); expect(purgeDeletedUserData).toHaveBeenCalledTimes(1);
});
