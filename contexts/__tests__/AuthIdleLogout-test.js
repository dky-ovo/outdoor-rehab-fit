import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { AuthProvider, useAuth, AUTH_SIGNED_OUT_KEY } from "../AuthContext";
import { AUTH_INACTIVITY_LIMIT_MS, AUTH_STORAGE_KEY } from "../../constants/auth";
import { getCurrentUser, loginAccount, updateCurrentUser } from "../../utils/api";
import { purgeDeletedUserData } from "../../utils/userStorage";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "zh" }) }));
jest.mock("../../utils/api", () => ({ getCurrentUser: jest.fn(), loginAccount: jest.fn(), updateCurrentUser: jest.fn(), registerAccount: jest.fn(), registerGuestProfile: jest.fn() }));
jest.mock("../../utils/userStorage", () => ({ clearCurrentOwner: jest.fn(async () => {}), ensureUserFolder: jest.fn(async () => {}), purgeDeletedUserData: jest.fn(async () => {}) }));
jest.mock("../../utils/usage", () => ({ ensureFirstLoginEvent: jest.fn(async () => {}), trackLoginEvent: jest.fn(async () => {}) }));
jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { getItem: jest.fn(async key => data.get(key) ?? null), setItem: jest.fn(async (key, value) => { data.set(key, value); }), removeItem: jest.fn(async key => { data.delete(key); }), multiRemove: jest.fn(async keys => keys.forEach(key => data.delete(key))), __data: data };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const start = new Date("2026-10-06T12:00:00Z").getTime();
const session = { id: "idle-user", name: "Test user", role: "user", token: "token-one", assistantSessionId: "first-login", loginEventRecordedAt: "recorded", lastActivity: start };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let tree, auth, listeners;
function Probe() { auth = useAuth(); return null; }
async function mount() { await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); }); }
async function changeState(state) {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: state });
  await act(async () => { for (const listener of [...listeners]) listener(state); });
}
async function advance(ms) { await act(async () => { jest.advanceTimersByTime(ms); }); }
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(start); listeners = new Set();
  AsyncStorage.__data.clear(); AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify(session));
  AsyncStorage.getItem.mockImplementation(async key => AsyncStorage.__data.get(key) ?? null);
  AsyncStorage.setItem.mockImplementation(async (key, value) => { AsyncStorage.__data.set(key, value); });
  getCurrentUser.mockReset().mockResolvedValue({ user: session });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_name, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test("foreground idle expires at exactly ninety minutes despite periodic profile checks", async () => {
  await mount();
  await advance(AUTH_INACTIVITY_LIMIT_MS - 1);
  expect(auth.user.id).toBe(session.id);
  expect(getCurrentUser.mock.calls.length).toBeGreaterThan(1);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).lastActivity).toBe(start);
  await advance(1);
  expect(auth.user).toBeNull(); expect(router.replace).toHaveBeenCalledWith("/login");
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(AsyncStorage.__data.get(AUTH_SIGNED_OUT_KEY)).toBe("1");
});

test("a real interaction renews the idle window without changing the login identity", async () => {
  await mount(); await advance(89 * 60 * 1000);
  await act(async () => auth.recordActivity());
  await advance(89 * 60 * 1000);
  expect(auth.user.assistantSessionId).toBe(session.assistantSessionId);
  await advance(60 * 1000);
  expect(auth.user).toBeNull();
});

test("foreground resume detects background expiry even when JavaScript timers were suspended", async () => {
  await mount(); await changeState("background");
  const checks = getCurrentUser.mock.calls.length;
  jest.setSystemTime(start + AUTH_INACTIVITY_LIMIT_MS + 1);
  await changeState("active");
  expect(auth.user).toBeNull(); expect(getCurrentUser).toHaveBeenCalledTimes(checks);
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("the first touch after suspended expiry cannot renew an expired session before its resume callback", async () => {
  await mount();
  jest.setSystemTime(start + AUTH_INACTIVITY_LIMIT_MS);
  let renewed;
  await act(async () => { renewed = auth.recordActivity(); });
  expect(renewed).toBe(false); expect(auth.user).toBeNull();
  expect(AsyncStorage.__data.get(AUTH_SIGNED_OUT_KEY)).toBe("1");
});

test("returning before the deadline checks but does not reset the idle clock", async () => {
  await mount(); await changeState("background");
  jest.setSystemTime(start + 89 * 60 * 1000);
  await changeState("active");
  expect(auth.user.id).toBe(session.id);
  await advance(60 * 1000);
  expect(auth.user).toBeNull();
});

test("backgrounding flushes a throttled recent interaction using its actual time, not the background time", async () => {
  await mount(); await advance(5000); await act(async () => auth.recordActivity());
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).lastActivity).toBe(start);
  await advance(1000); await changeState("background");
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).lastActivity).toBe(start + 5000);
  await act(async () => tree.unmount()); await mount();
  await changeState("active");
  await advance(AUTH_INACTIVITY_LIMIT_MS - 1000);
  expect(auth.user).toBeNull();
});

test("background callbacks and changed server profile metadata cannot count as interaction", async () => {
  await mount(); getCurrentUser.mockResolvedValue({ user: { ...session, name: "Updated elsewhere" } });
  await advance(30000);
  expect(auth.user.name).toBe("Updated elsewhere");
  await changeState("background"); await advance(30000);
  await act(async () => auth.recordActivity());
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).lastActivity).toBe(start);
  await advance(AUTH_INACTIVITY_LIMIT_MS - 60000);
  expect(auth.user).toBeNull();
});

test("idle logout preserves queued account data and never performs deleted-account purging", async () => {
  AsyncStorage.__data.set("user:idle-user:pending-bookmarks", "pending-local-change");
  AsyncStorage.__data.set("user:idle-user:assistant-conversations", "saved-local-history");
  await mount(); await advance(AUTH_INACTIVITY_LIMIT_MS);
  expect(purgeDeletedUserData).not.toHaveBeenCalled();
  expect(AsyncStorage.__data.get("user:idle-user:pending-bookmarks")).toBe("pending-local-change");
  expect(AsyncStorage.__data.get("user:idle-user:assistant-conversations")).toBe("saved-local-history");
});

test("a slow profile response cannot refresh inactivity or restore a login after expiry", async () => {
  const response = deferred(); updateCurrentUser.mockReturnValue(response.promise);
  await mount(); let saving;
  await act(async () => { saving = auth.updateProfile({ name: "Changed" }); });
  jest.setSystemTime(start + AUTH_INACTIVITY_LIMIT_MS + 1);
  let result;
  await act(async () => { response.resolve({ user: { ...session, name: "Changed" } }); result = await saving; });
  expect(result.success).toBe(false); expect(auth.user).toBeNull();
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("a fresh explicit login gets a new full window after idle logout", async () => {
  await mount(); await advance(AUTH_INACTIVITY_LIMIT_MS);
  loginAccount.mockResolvedValue({ user: { ...session, id: "second" }, token: "token-two" });
  await act(async () => auth.login("second", "password"));
  await advance(AUTH_INACTIVITY_LIMIT_MS - 1);
  expect(auth.user.id).toBe("second");
  await advance(1); expect(auth.user).toBeNull();
});

test("guests have the same idle window without API polling", async () => {
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ name: "guest", role: "guest", lastActivity: start, assistantSessionId: "guest-login" }));
  await mount(); await advance(AUTH_INACTIVITY_LIMIT_MS - 1);
  expect(auth.isGuest).toBe(true); expect(getCurrentUser).not.toHaveBeenCalled();
  await advance(1); expect(auth.user).toBeNull();
});

test("an offline profile API does not prolong or prematurely shorten the idle policy", async () => {
  getCurrentUser.mockRejectedValue({ code: "networkError", status: 0 });
  await mount(); await advance(AUTH_INACTIVITY_LIMIT_MS - 1); expect(auth.user.id).toBe(session.id);
  await advance(1); expect(auth.user).toBeNull();
});
