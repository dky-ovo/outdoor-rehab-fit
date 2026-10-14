// Login / guest auth adapted from outdoor-rehab-fit-1 (phone/email registration)
// Local sessions expire after 90 minutes without user interaction. Background
// network work is not activity and remains independent of server-side jobs.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { router } from "expo-router";
import {
	AUTH_ROLES,
	AUTH_STORAGE_KEY,
	AUTH_INACTIVITY_LIMIT_MS,
	MIN_PASSWORD_LENGTH,
	isValidEmail,
} from "../constants/auth";
import { loginAccount, registerAccount, registerGuestProfile, updateCurrentUser, getCurrentUser } from "../utils/api";
import { isValidInternationalPhone } from "../constants/countries";
import { ensureFirstLoginEvent, trackLoginEvent } from "../utils/usage";
import { clearCurrentOwner, ensureUserFolder, purgeDeletedUserData } from "../utils/userStorage";
import { canGuestAccessEquipment } from "../constants/permissions";
import { createAssistantSessionId } from "../utils/assistantConversations";
import { activateAccountSession, clearAccountSession, subscribeAccountDeleted } from "../utils/accountSessionEvents";
import { LocaleContext } from "./LocaleContext";
import { showAccountDeletedNotice } from "../utils/accountDeletedNotice";

export const AUTH_SIGNED_OUT_KEY = "authSessionSignedOut";
// Serialize across provider remounts as well as requests, so an unmounted
// provider cannot write an old session after a newer provider signs out.
let sessionWriteQueue = Promise.resolve();

export const AuthContext = createContext(null);

function createUserSession(user) {
	return {
		id: user.id,
		name: user.name,
		username: user.name, // backward-compatible display field used elsewhere
		phone: user.phone,
		email: user.email || "",
		avatarUrl: user.avatarUrl || "",
		profileRole: user.profileRole || user.role,
		role: AUTH_ROLES.USER,
		isGuest: false,
		assistantSessionId: createAssistantSessionId(),
		loginAt: new Date().toISOString(),
		lastActivity: Date.now(),
	};
}

function normalizeStoredSession(session) {
	if (!session || typeof session !== "object" || Array.isArray(session)) throw new Error("invalidStoredSession");
	if (!session.role) {
		session.role =
			session.name === "guest" || session.username === "guest" || session.isGuest
				? AUTH_ROLES.GUEST
				: AUTH_ROLES.USER;
	}

	if (!session.name && session.username) {
		session.name = session.username;
	}

	if (!session.username && session.name) {
		session.username = session.name;
	}

	session.isGuest = session.role === AUTH_ROLES.GUEST;
	session.avatarUrl = session.avatarUrl || "";
	if (typeof session.assistantSessionId !== "string" || !session.assistantSessionId.trim() || session.assistantSessionId.length > 160) {
		session.assistantSessionId = createAssistantSessionId();
	}
	return session;
}

export function AuthProvider({ children }) {
	const { locale = "zh" } = useContext(LocaleContext) || {};
	const localeRef = useRef(locale); localeRef.current = locale;
	const [user, setUser] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const lastActivityRef = useRef(Date.now());
	const lastPersistedActivityRef = useRef(0);
	const userRef = useRef(null);
	const sessionVersionRef = useRef(0);
	const accountScopeRef = useRef(null);
	const mountedRef = useRef(true);
	const queueSessionWrite = useCallback((write) => {
		const pending = sessionWriteQueue.then(write);
		sessionWriteQueue = pending.catch(() => {});
		return pending;
	}, []);
	const bindAccount = useCallback((session) => {
		if (accountScopeRef.current?.token === session?.token && accountScopeRef.current?.assistantSessionId === session?.assistantSessionId) return;
		clearAccountSession(accountScopeRef.current);
		accountScopeRef.current = session?.role === AUTH_ROLES.USER && session.token ? activateAccountSession(session.token) : null;
		if (accountScopeRef.current) accountScopeRef.current.assistantSessionId = session.assistantSessionId;
	}, []);
	const clearSession = useCallback(({ deleted = false, expectedScope, deletedUser } = {}) => {
		if (expectedScope && expectedScope !== accountScopeRef.current) return Promise.resolve(false);
		const version = ++sessionVersionRef.current;
		const previousUser = deletedUser || userRef.current;
		clearAccountSession(accountScopeRef.current); accountScopeRef.current = null;
		userRef.current = null;
		const detachOwner = clearCurrentOwner().catch(() => {});
		if (mountedRef.current) { setUser(null); setIsLoading(false); }
		// This independent tombstone closes the reload gap while an older storage
		// write is still finishing. Only an explicit successful login removes it.
		const marker = AsyncStorage.setItem(AUTH_SIGNED_OUT_KEY, "1").catch(() => {});
		const cleanup = queueSessionWrite(async () => {
			await Promise.all([marker, detachOwner]);
			await AsyncStorage.setItem(AUTH_SIGNED_OUT_KEY, "1");
			await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
			await clearCurrentOwner();
			if (deleted && previousUser) await purgeDeletedUserData(previousUser);
		});
		if (mountedRef.current) {
			router.replace("/login");
			if (deleted) showAccountDeletedNotice(localeRef.current);
		}
		return cleanup.then(() => version === sessionVersionRef.current);
	}, [queueSessionWrite]);
	const expireIdleSession = useCallback(() => {
		if (!userRef.current || Date.now() - lastActivityRef.current < AUTH_INACTIVITY_LIMIT_MS) return false;
		// clearSession detaches auth synchronously before its queued disk cleanup.
		// A first touch after suspension therefore cannot revive an expired login.
		void clearSession().catch(error => console.error("Error clearing idle auth session", error));
		return true;
	}, [clearSession]);
	const persistActivity = useCallback(() => {
		const version = sessionVersionRef.current;
		return queueSessionWrite(async () => {
			const latest = userRef.current;
			if (!latest || version !== sessionVersionRef.current) return;
			const lastActivity = lastActivityRef.current;
			await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...latest, lastActivity }));
			if (version === sessionVersionRef.current) lastPersistedActivityRef.current = lastActivity;
		});
	}, [queueSessionWrite]);
	useEffect(() => {
		mountedRef.current = true;
		const unsubscribe = subscribeAccountDeleted(scope => {
			if (scope !== accountScopeRef.current || !userRef.current?.token) return;
			void clearSession({ deleted: true, expectedScope: scope }).catch(() => {});
		});
		return () => {
			mountedRef.current = false; sessionVersionRef.current += 1;
			clearAccountSession(accountScopeRef.current); accountScopeRef.current = null;
			unsubscribe();
		};
	}, [clearSession]);

	useEffect(() => {
		let active = true;
		const version = sessionVersionRef.current;
		const restoreSession = async () => {
			try {
				if (await AsyncStorage.getItem(AUTH_SIGNED_OUT_KEY) === "1") {
					if (active && version === sessionVersionRef.current) { await AsyncStorage.removeItem(AUTH_STORAGE_KEY); await clearCurrentOwner(); }
					return;
				}
				const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
				if (!active || version !== sessionVersionRef.current) return;
				if (stored) {
					const parsed = JSON.parse(stored);
					const previousAssistantSessionId = parsed?.assistantSessionId;
					const session = normalizeStoredSession(parsed);
					let needsPersistence = session.assistantSessionId !== previousAssistantSessionId;
					// Registered users must have a server token. Older builds silently
					// created local-only sessions when the API was unavailable, causing
					// the same phone number to show different data on web and mobile.
					if (session.role !== AUTH_ROLES.GUEST && !session.token) {
						await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
						await clearCurrentOwner();
						return;
					}
					// Restore this device's session and owner before rendering local data.
					// Server validation runs independently below, so a slow or offline API
					// cannot hold the loading screen or the local session write queue.
					if (!active || version !== sessionVersionRef.current) return;
					const now = Date.now(), storedActivity = Number(session.lastActivity);
					const lastActivity = Number.isFinite(storedActivity) && storedActivity > 0 ? Math.min(now, storedActivity) : now;
					if (now - lastActivity >= AUTH_INACTIVITY_LIMIT_MS) {
						// This restore already owns the write queue: enqueue cleanup without
						// awaiting it, or the queue would wait for itself forever.
						void clearSession().catch(() => {});
						return;
					}
					if (session.lastActivity !== lastActivity) { session.lastActivity = lastActivity; needsPersistence = true; }
					await ensureUserFolder(session);
					if (session.role !== AUTH_ROLES.GUEST && !session.loginEventRecordedAt) {
						await ensureFirstLoginEvent();
						session.loginEventRecordedAt = session.loginAt || new Date().toISOString();
						needsPersistence = true;
					}
					if (needsPersistence) await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
					if (!active || version !== sessionVersionRef.current) return;
					if (Date.now() - lastActivity >= AUTH_INACTIVITY_LIMIT_MS) { void clearSession().catch(() => {}); return; }
					userRef.current = session;
					bindAccount(session);
					setUser(session);
					lastActivityRef.current = lastActivity;
					lastPersistedActivityRef.current = lastActivity;
				}
			} catch (error) {
				console.error("Error restoring auth session", error);
			} finally {
				if (active) setIsLoading(false);
			}
		};

		void queueSessionWrite(restoreSession);
		return () => { active = false; };
	}, [queueSessionWrite, clearSession, bindAccount]);

	useEffect(() => {
		if (!user) return undefined;
		let timer, active = true;
		const check = () => {
			clearTimeout(timer);
			if (!active || !userRef.current || expireIdleSession()) return;
			const remaining = AUTH_INACTIVITY_LIMIT_MS - (Date.now() - lastActivityRef.current);
			timer = setTimeout(check, Math.max(1, remaining));
		};
		check();
		const listener = AppState.addEventListener("change", state => {
			if (state === "active") check();
			else if (!expireIdleSession()) void persistActivity().catch(() => {});
		});
		return () => { active = false; clearTimeout(timer); listener?.remove(); };
	}, [Boolean(user), user?.assistantSessionId, expireIdleSession, persistActivity]);

	useEffect(() => {
		if (!user?.token || user.role !== AUTH_ROLES.USER) return undefined;
		const scope = accountScopeRef.current;
		let active = true, checking = false;
		const check = async (foreground = false) => {
			if (!active || checking || !userRef.current || expireIdleSession() || (!foreground && AppState.currentState && AppState.currentState !== "active")) return;
			checking = true;
			const captured = userRef.current;
			try {
				const remote = await getCurrentUser(user.token);
				await queueSessionWrite(async () => {
					if (!active || scope !== accountScopeRef.current || userRef.current !== captured) return;
					const remoteId = remote?.user?.id;
					if (typeof remoteId !== 'string' || !remoteId.trim()) return;
					if (captured?.id && String(remoteId) !== String(captured.id)) return;
					// Older sessions saved the verified token but omitted the user ID.
					// Recover it from that token's /users/me response without making the
					// local startup wait for the network or accepting a different login.
					const next = { ...captured, id: remoteId };
					for (const key of ['name', 'avatarUrl', 'profileRole']) if (remote.user[key] !== undefined) next[key] = remote.user[key];
					if (JSON.stringify(next) === JSON.stringify(captured)) return;
					if (!captured.id) await ensureUserFolder(next);
					if (!active || scope !== accountScopeRef.current || userRef.current !== captured) return;
					await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
					if (active && scope === accountScopeRef.current && userRef.current === captured) { userRef.current = next; setUser(next); }
				});
			}
			catch (error) {
				if (active && scope === accountScopeRef.current && error?.status === 401 && error?.code === "accountDeleted") {
					void clearSession({ deleted: true, expectedScope: scope }).catch(() => {});
				}
			} finally { checking = false; }
		};
		// Both restored sessions and fresh logins receive one background check.
		// A confirmed deletion still clears only the scope that made the request;
		// offline errors and ordinary 401 responses keep the existing local policy.
		void check();
		const timer = setInterval(check, 30000);
		const listener = AppState.addEventListener("change", state => { if (state === "active") void check(true); });
		return () => { active = false; clearInterval(timer); listener?.remove(); };
	}, [user?.token, user?.assistantSessionId, user?.role, clearSession, expireIdleSession]);

	const persistSession = (session, { recordLogin = false, explicitLogin = false, version = sessionVersionRef.current } = {}) => queueSessionWrite(async () => {
		if (version !== sessionVersionRef.current) return false;
		if (!explicitLogin && expireIdleSession()) return false;
		if (!session) {
			await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
			await clearCurrentOwner();
			userRef.current = null;
			setUser(null);
			return true;
		}
		const sessionActivity = Number(session.lastActivity);
		const lastActivity = explicitLogin ? Date.now() : Math.max(
			Number.isFinite(sessionActivity) ? sessionActivity : 0,
			Number(lastActivityRef.current) || 0,
		) || Date.now();
		const withActivity = { ...session, lastActivity };
		await ensureUserFolder(withActivity);
		if (recordLogin) {
			await trackLoginEvent();
			withActivity.loginEventRecordedAt = new Date().toISOString();
		}
		await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(withActivity));
		// Logout/account switching may happen while storage is still writing.
		// Their queued cleanup runs next; an older response must not restore UI auth.
		if (version !== sessionVersionRef.current) return false;
		if (!explicitLogin && expireIdleSession()) return false;
		if (explicitLogin) await AsyncStorage.removeItem(AUTH_SIGNED_OUT_KEY);
		if (version !== sessionVersionRef.current) return false;
		lastActivityRef.current = lastActivity;
		lastPersistedActivityRef.current = lastActivity;
		userRef.current = withActivity;
		bindAccount(withActivity);
		setUser(withActivity);
		return true;
	});

	const login = useCallback(async (identifier, password, countryCode = "+852") => {
		const version = ++sessionVersionRef.current;
		try {
			const remote = await loginAccount(identifier, password, countryCode);
			if (!await persistSession({ ...createUserSession(remote.user), token: remote.token }, { recordLogin: true, explicitLogin: true, version })) return { success: false, error: "sessionChanged" };
			lastActivityRef.current = Date.now();
			return { success: true };
		} catch (error) {
			return { success: false, error: error.code || "serverError" };
		}
	}, []);

	const register = useCallback(async ({ name, phone, countryCode, email, registrationCode, password, confirmPassword }) => {
		const resolvedName = name?.trim();
		if (!resolvedName) {
			return { success: false, error: "nameRequired" };
		}
		if (!phone?.trim() || !password || !confirmPassword) {
			return { success: false, error: "registerRequired" };
		}

		if (!isValidInternationalPhone(phone, countryCode)) {
			return { success: false, error: "invalidPhone" };
		}

		if (email?.trim() && !isValidEmail(email)) {
			return { success: false, error: "invalidEmail" };
		}

		if (!registrationCode?.trim()) {
			return { success: false, error: "registrationCodeRequired" };
		}

		if (password.length < MIN_PASSWORD_LENGTH) {
			return { success: false, error: "passwordTooShort" };
		}

		if (password.length > 256) {
			return { success: false, error: "passwordTooLong" };
		}

		if (password !== confirmPassword) {
			return { success: false, error: "passwordMismatch" };
		}

		const version = ++sessionVersionRef.current;
		try {
			const result = await registerAccount({ name: resolvedName, phone, countryCode, email, registrationCode: registrationCode.trim(), password, confirmPassword });
			if (!await persistSession({ ...createUserSession(result.user), token: result.token }, { recordLogin: true, explicitLogin: true, version })) return { success: false, error: "sessionChanged" };
			lastActivityRef.current = Date.now();
			return { success: true };
		} catch (error) {
			return { success: false, error: error.code || "serverError" };
		}
	}, []);

	const loginAsGuest = useCallback(async (profile = {}) => {
		const age = Number(profile.age);
		if (!Number.isInteger(age) || age < 18 || age > 120) {
			return { success: false, error: "invalidGuestAge" };
		}
		if (!["female", "male", "other"].includes(profile.gender)) {
			return { success: false, error: "invalidGuestGender" };
		}
		if (!["personal", "family", "industry"].includes(profile.purpose)) {
			return { success: false, error: "invalidGuestPurpose" };
		}

		const version = ++sessionVersionRef.current;
		let remoteProfile = null;
		let syncError = "";
		try {
			const result = await registerGuestProfile({ age, gender: profile.gender, purpose: profile.purpose });
			remoteProfile = result.guestProfile;
		} catch (error) {
			// Guest access must remain available during a temporary API outage. The
			// unsynchronised marker prevents local data being mistaken for research data.
			syncError = error?.code || "networkError";
		}
		const guestProfile = {
			age,
			gender: profile.gender,
			purpose: profile.purpose,
			serverId: remoteProfile?.id || "",
			recordedAt: remoteProfile?.createdAt || "",
			synced: Boolean(remoteProfile?.id),
			syncError,
		};
		const session = {
			name: "guest",
			username: "guest",
			phone: "",
			email: "",
			profileRole: "guest",
			guestProfile,
			role: AUTH_ROLES.GUEST,
			isGuest: true,
			assistantSessionId: createAssistantSessionId(),
			loginAt: new Date().toISOString(),
			lastActivity: Date.now(),
		};

		try {
			if (!await persistSession(session, { explicitLogin: true, version })) return { success: false, error: "sessionChanged" };
		} catch (error) {
			return { success: false, error: error?.code || "serverError" };
		}
		lastActivityRef.current = Date.now();
		return { success: true, synced: guestProfile.synced };
	}, []);

	const logout = useCallback(async () => {
		await clearSession();
	}, [clearSession]);

	const updateProfile = useCallback(async (updates) => {
		if (expireIdleSession()) return { success: false, error: "unauthorized" };
		const currentUser = userRef.current;
		const version = sessionVersionRef.current;
		if (!currentUser?.token || currentUser.role !== AUTH_ROLES.USER) {
			return { success: false, error: "unauthorized" };
		}
		try {
			const remote = await updateCurrentUser(currentUser.token, updates);
			const updatedSession = {
				...currentUser,
				...createUserSession(remote.user),
				token: remote.token || currentUser.token,
				loginAt: currentUser.loginAt,
				loginEventRecordedAt: currentUser.loginEventRecordedAt,
				assistantSessionId: currentUser.assistantSessionId,
				lastActivity: currentUser.lastActivity,
			};
			if (!await persistSession(updatedSession, { version })) return { success: false, error: "sessionChanged" };
			return { success: true, user: updatedSession };
		} catch (error) {
			return { success: false, error: error.code || "serverError" };
		}
	}, []);

	/** Dev / test helper: clear onboarding + session and return to Start cover. */
	const resetOnboarding = useCallback(async () => {
		const version = ++sessionVersionRef.current;
		clearAccountSession(accountScopeRef.current); accountScopeRef.current = null;
		await AsyncStorage.setItem(AUTH_SIGNED_OUT_KEY, "1");
		userRef.current = null;
		setUser(null);
		await queueSessionWrite(async () => {
			await AsyncStorage.multiRemove(["userAgreed", "safetyResponse", AUTH_STORAGE_KEY]);
			await clearCurrentOwner();
		});
		if (version === sessionVersionRef.current) router.replace("/");
	}, [queueSessionWrite]);

	const recordActivity = useCallback(() => {
		const now = Date.now();
		const current = userRef.current;
		if (!current || expireIdleSession() || (AppState.currentState && AppState.currentState !== "active")) return false;
		lastActivityRef.current = now;
		const withActivity = { ...current, lastActivity: now };
		userRef.current = withActivity;
		if (now - lastPersistedActivityRef.current < 10_000) return true;
		lastPersistedActivityRef.current = now;
		persistActivity().catch((error) => {
			console.error("Error persisting auth activity", error);
		});
		return true;
	}, [expireIdleSession, persistActivity]);

	const isGuest = user?.role === AUTH_ROLES.GUEST;
	const isUser = user?.role === AUTH_ROLES.USER;
	const isLoggedIn = isUser;
	const canAccessEquipment = useCallback(
		(equipmentId) => {
			if (isLoggedIn) return true;
			return canGuestAccessEquipment(equipmentId);
		},
		[isLoggedIn]
	);

	const value = useMemo(
		() => ({
			user,
			isLoading,
			ready: !isLoading, // backward compatible
			isAuthenticated: !!user,
			isGuest,
			isUser,
			isLoggedIn,
			login,
			register,
			loginAsGuest,
			logout,
			updateProfile,
			resetOnboarding,
			recordActivity,
			canAccessEquipment,
		}),
		[user, isLoading, isGuest, isUser, isLoggedIn, login, register, loginAsGuest, logout, updateProfile, resetOnboarding, recordActivity, canAccessEquipment]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within AuthProvider");
	}
	return context;
}
