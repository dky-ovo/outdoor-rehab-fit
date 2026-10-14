import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider, useAuth } from "../AuthContext";
import { AUTH_STORAGE_KEY } from "../../constants/auth";
import { loginAccount, registerAccount, registerGuestProfile, updateCurrentUser } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => {
	const data = new Map();
	return { __esModule: true, default: {
		getItem: jest.fn(async (key) => data.get(key) ?? null),
		setItem: jest.fn(async (key, value) => { data.set(key, value); }),
		removeItem: jest.fn(async (key) => { data.delete(key); }),
		multiRemove: jest.fn(async (keys) => keys.forEach((key) => data.delete(key))),
		__data: data,
	} };
});
jest.mock("../../utils/api", () => ({ loginAccount: jest.fn(), registerAccount: jest.fn(), registerGuestProfile: jest.fn(), updateCurrentUser: jest.fn() }));
jest.mock("../../utils/userStorage", () => ({ clearCurrentOwner: jest.fn(async () => {}), ensureUserFolder: jest.fn(async () => {}) }));
jest.mock("../../utils/usage", () => ({ ensureFirstLoginEvent: jest.fn(async () => {}), trackLoginEvent: jest.fn(async () => {}) }));

const account = { id: "one", name: "User One", phone: "61234567", profileRole: "participant", role: "user", token: "old-token", lastActivity: Date.now(), loginEventRecordedAt: "recorded" };
let auth;
let tree;
function Probe() { auth = useAuth(); return null; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(async () => {
	jest.clearAllMocks();
	AsyncStorage.__data.clear();
	AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ ...account, lastActivity: Date.now() }));
	AsyncStorage.setItem.mockImplementation(async (key, value) => { AsyncStorage.__data.set(key, value); });
	await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
});
afterEach(async () => { await act(async () => tree.unmount()); });

test("a stored authenticated session expires after ninety minutes without activity", async () => {
	await act(async () => tree.unmount());
	AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ ...account, lastActivity: Date.now() - 7 * 24 * 60 * 60 * 1000 }));
	await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
	expect(auth.user).toBeNull();
	expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("remaining idle past ninety minutes invokes logout", async () => {
	await act(async () => tree.unmount());
	jest.useFakeTimers();
	try {
		await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
		await act(async () => { jest.advanceTimersByTime(2 * 60 * 60 * 1000); });
		expect(auth.user).toBeNull();
		expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
	} finally { jest.useRealTimers(); }
});

test("registered sessions missing a server token cannot be restored", async () => {
	await act(async () => tree.unmount());
	AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ ...account, token: "", lastActivity: Date.now() }));
	await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
	expect(auth.user).toBeNull();
	expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("a profile response arriving after logout cannot restore the old account", async () => {
	const request = deferred();
	updateCurrentUser.mockReturnValue(request.promise);
	let pending;
	await act(async () => { pending = auth.updateProfile({ name: "Updated" }); });
	await act(async () => { await auth.logout(); });
	let result;
	await act(async () => {
		request.resolve({ user: { ...account, name: "Updated" } });
		result = await pending;
	});
	expect(result.success).toBe(false);
	expect(auth.user).toBeNull();
	expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("logout removes an already-running profile storage write after it finishes", async () => {
	const writing = deferred();
	const release = deferred();
	updateCurrentUser.mockResolvedValue({ user: { ...account, name: "Updated" } });
	AsyncStorage.setItem.mockImplementation(async (key, value) => {
		if (key === AUTH_STORAGE_KEY) { writing.resolve(); await release.promise; }
		AsyncStorage.__data.set(key, value);
	});
	let saving;
	await act(async () => { saving = auth.updateProfile({ name: "Updated" }); await writing.promise; });
	let logout;
	await act(async () => { logout = auth.logout(); });
	expect(auth.user).toBeNull();
	await act(async () => { release.resolve(); await Promise.all([saving, logout]); });
	expect(auth.user).toBeNull();
	expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

test("a slower earlier login does not replace the latest selected account", async () => {
	const first = deferred();
	loginAccount.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ user: { ...account, id: "two", name: "User Two" }, token: "new-token" });
	let oldLogin;
	await act(async () => { oldLogin = auth.login("first", "password"); });
	await act(async () => { await auth.login("second", "password"); });
	await act(async () => { first.resolve({ user: account, token: "old-token" }); await oldLogin; });
	expect(auth.user.id).toBe("two");
	expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).token).toBe("new-token");
});

test("guest login sends only demographic fields and stores the successful anonymous submission", async () => {
	const profile = { age: "68", gender: "female", purpose: "personal", name: "Do not upload", phone: "Do not upload" };
	const remote = { id: "anonymous-submission", age: 68, gender: "female", purpose: "personal", createdAt: "2026-09-08T02:00:00.000Z" };
	registerGuestProfile.mockResolvedValueOnce({ guestProfile: remote });
	let result;
	await act(async () => { result = await auth.loginAsGuest(profile); });

	expect(registerGuestProfile).toHaveBeenCalledTimes(1);
	expect(registerGuestProfile).toHaveBeenCalledWith({ age: 68, gender: "female", purpose: "personal" });
	expect(result).toEqual({ success: true, synced: true });
	expect(auth.isGuest).toBe(true);
	expect(auth.user.token).toBeUndefined();
	expect(auth.user.phone).toBe("");
	expect(auth.user.email).toBe("");
	expect(auth.user.guestProfile).toEqual({
		age: 68,
		gender: "female",
		purpose: "personal",
		serverId: remote.id,
		recordedAt: remote.createdAt,
		synced: true,
		syncError: "",
	});
	expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).guestProfile).toEqual(auth.user.guestProfile);
});

test("a failed guest upload still permits guest access without claiming the record reached the server", async () => {
	registerGuestProfile.mockRejectedValueOnce(Object.assign(new Error("Offline"), { code: "networkError" }));
	let result;
	await act(async () => { result = await auth.loginAsGuest({ age: 72, gender: "other", purpose: "family" }); });

	expect(result).toEqual({ success: true, synced: false });
	expect(auth.isGuest).toBe(true);
	expect(auth.user.token).toBeUndefined();
	expect(auth.user.guestProfile).toEqual({
		age: 72,
		gender: "other",
		purpose: "family",
		serverId: "",
		recordedAt: "",
		synced: false,
		syncError: "networkError",
	});
	expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).guestProfile).toEqual(auth.user.guestProfile);
	expect(registerGuestProfile).toHaveBeenCalledTimes(1);
});

test.each([
	[{ age: 0 }, "invalidGuestAge"],
	[{ age: 17 }, "invalidGuestAge"],
	[{ age: 121 }, "invalidGuestAge"],
	[{ age: 68.5 }, "invalidGuestAge"],
	[{ age: "invalid" }, "invalidGuestAge"],
	[{ gender: "" }, "invalidGuestGender"],
	[{ gender: "unknown" }, "invalidGuestGender"],
	[{ purpose: "" }, "invalidGuestPurpose"],
	[{ purpose: "advertising" }, "invalidGuestPurpose"],
])("invalid guest data %j is rejected before a request or session change", async (invalid, error) => {
	const stored = AsyncStorage.__data.get(AUTH_STORAGE_KEY);
	let result;
	await act(async () => { result = await auth.loginAsGuest({ age: 68, gender: "female", purpose: "personal", ...invalid }); });
	expect(result).toEqual({ success: false, error });
	expect(registerGuestProfile).not.toHaveBeenCalled();
	expect(auth.user.id).toBe(account.id);
	expect(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).toBe(stored);
});

test("a late guest submission response cannot restore a session after logout", async () => {
	const submission = deferred();
	registerGuestProfile.mockReturnValueOnce(submission.promise);
	let pending;
	await act(async () => { pending = auth.loginAsGuest({ age: 68, gender: "male", purpose: "industry" }); });
	await act(async () => { await auth.logout(); });
	let result;
	await act(async () => {
		submission.resolve({ guestProfile: { id: "late-submission", createdAt: "2026-09-08T02:00:00.000Z" } });
		result = await pending;
	});
	expect(result).toEqual({ success: false, error: "sessionChanged" });
	expect(auth.user).toBeNull();
	expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
});

const registration = { name: " New Nickname ", phone: "61234567", countryCode: "+852", registrationCode: " ABCDE-FGHJK-LMNPQ-RSTUV ", password: "safe-password", confirmPassword: "safe-password" };
test.each([
	[{ name: " " }, "nameRequired"],
	[{ phone: "" }, "registerRequired"],
	[{ phone: "12" }, "invalidPhone"],
	[{ registrationCode: " " }, "registrationCodeRequired"],
	[{ confirmPassword: "" }, "registerRequired"],
	[{ confirmPassword: "different-password" }, "passwordMismatch"],
	[{ password: "short", confirmPassword: "short" }, "passwordTooShort"],
	[{ password: "x".repeat(257), confirmPassword: "x".repeat(257) }, "passwordTooLong"],
])("registration validates %j before sending or changing the session", async (changes, error) => {
	let result;
	await act(async () => { result = await auth.register({ ...registration, ...changes }); });
	expect(result).toEqual({ success: false, error });
	expect(registerAccount).not.toHaveBeenCalled();
	expect(auth.user.id).toBe(account.id);
});

test("registration submits nickname, phone, referral code and both passwords without accepting a client role", async () => {
	registerAccount.mockResolvedValue({ user: { ...account, id: "registered", profileRole: "staff" }, token: "registered-token" });
	let result;
	await act(async () => { result = await auth.register({ ...registration, profileRole: "super_admin" }); });
	expect(registerAccount).toHaveBeenCalledWith({ name: "New Nickname", phone: "61234567", countryCode: "+852", email: undefined, registrationCode: "ABCDE-FGHJK-LMNPQ-RSTUV", password: "safe-password", confirmPassword: "safe-password" });
	expect(result).toEqual({ success: true });
	expect(auth.user.id).toBe("registered");
	expect(auth.user.profileRole).toBe("staff");
});

test("a rejected code leaves the current session intact", async () => {
	registerAccount.mockRejectedValue({ code: "invalidRegistrationCode" });
	let result;
	await act(async () => { result = await auth.register(registration); });
	expect(result).toEqual({ success: false, error: "invalidRegistrationCode" });
	expect(auth.user.id).toBe(account.id);
});

test("restoring an older session adds a stable assistant session ID and persists it across restarts", async () => {
	const id = auth.user.assistantSessionId;
	expect(id).toMatch(/^ai-session-/);
	expect(id).not.toBe(account.token);
	expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).assistantSessionId).toBe(id);
	await act(async () => tree.unmount());
	await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
	expect(auth.user.assistantSessionId).toBe(id);
});

test("each successful login creates a fresh assistant session even if the server token and time are identical", async () => {
	loginAccount.mockResolvedValue({ user: account, token: account.token });
	const now = jest.spyOn(Date, "now").mockReturnValue(1000);
	try {
		await act(async () => { await auth.login("one", "password"); });
		const first = auth.user.assistantSessionId;
		await act(async () => { await auth.logout(); });
		await act(async () => { await auth.login("one", "password"); });
		expect(auth.user.token).toBe(account.token);
		expect(auth.user.assistantSessionId).not.toBe(first);
		expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).assistantSessionId).toBe(auth.user.assistantSessionId);
	} finally { now.mockRestore(); }
});

test("registration creates a fresh assistant session and profile updates preserve that session", async () => {
	const prior = auth.user.assistantSessionId;
	registerAccount.mockResolvedValue({ user: account, token: account.token });
	await act(async () => { await auth.register(registration); });
	const registered = auth.user.assistantSessionId;
	expect(registered).not.toBe(prior);
	updateCurrentUser.mockResolvedValue({ user: { ...account, name: "Renamed" }, token: "refreshed-token" });
	await act(async () => { await auth.updateProfile({ name: "Renamed" }); });
	expect(auth.user.assistantSessionId).toBe(registered);
	expect(auth.user.token).toBe("refreshed-token");
});

test("a failed login leaves the current assistant session unchanged", async () => {
	const prior = auth.user.assistantSessionId;
	loginAccount.mockRejectedValueOnce({ code: "invalidCredentials" });
	await act(async () => { await auth.login("one", "wrong"); });
	expect(auth.user.assistantSessionId).toBe(prior);
	expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).assistantSessionId).toBe(prior);
});
