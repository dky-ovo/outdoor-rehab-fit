/**
 * Per-user local data “folders” (AsyncStorage key namespaces).
 *
 * Layout (ready to map 1:1 to a future remote DB / cloud folder):
 *   userData/{ownerKey}/meta
 *   userData/{ownerKey}/goalSettings
 *   userData/{ownerKey}/exerciseSessions
 *   userData/{ownerKey}/usageStats
 *   userData/{ownerKey}/learningProgress
 *   userData/{ownerKey}/bookmarkedItems
 *   ...
 *   (group chat uses shared AsyncStorage key groupChatMessages — not per-user)
 * ownerKey examples:
 *   phone:91234567
 *   guest
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTH_ROLES } from "../constants/auth";

export const USER_DATA_ROOT = "userData";
const CURRENT_OWNER_KEY = "currentOwnerKey";

let memoryOwnerKey = null;
const retiredPhoneOwners = new Set();
const retiredOwnerKey = owner => `userDataRetiredOwner/${encodeURIComponent(owner)}`;

/** Stable folder id for a session user object. */
function baseOwnerKey(user) {
	if (!user) return null;
	if (user.role === AUTH_ROLES.GUEST || user.isGuest || user.name === "guest") {
		return "guest";
	}
	if (user.phone) {
		return `phone:${String(user.phone).replace(/\D/g, "")}`;
	}
	if (user.email) {
		return `email:${String(user.email).trim().toLowerCase()}`;
	}
	if (user.name || user.username) {
		return `name:${String(user.name || user.username).trim().toLowerCase()}`;
	}
	return "user:unknown";
}

export function getOwnerKey(user) {
	const base = baseOwnerKey(user);
	return user?.id && retiredPhoneOwners.has(base) ? `user:${String(user.id)}` : base;
}

// Keep deletion/re-registration isolated even if an old offline write finishes
// late. A retired phone namespace is never reused by a newly registered ID.
export async function purgeDeletedUserData(user) {
	const owner = getOwnerKey(user), base = baseOwnerKey(user);
	if (!user?.id || !owner || owner === "guest") return;
	let meta;
	try { meta = JSON.parse(await AsyncStorage.getItem(userDataKey("meta", base)) || "null"); } catch { /* Remove only this legacy namespace below. */ }
	retiredPhoneOwners.add(base);
	await AsyncStorage.setItem(retiredOwnerKey(base), "1");
	const owners = new Set([`user:${String(user.id)}`]);
	if (!meta?.remoteId || String(meta.remoteId) === String(user.id)) owners.add(base);
	if (owner !== base) owners.add(owner);
	const prefixes = [...owners].map(value => `${USER_DATA_ROOT}/${value}/`);
	const chatKeys = ["zh", "en"].flatMap(locale => [
		`@outdoor_fit_ai_conversations_v2:${encodeURIComponent(String(user.id))}:${locale}`,
		`@outdoor_fit_ai_history_v1:${String(user.id)}:${locale}`,
	]);
	chatKeys.push(`@outdoor_fit_ai_jobs_v1:${encodeURIComponent(String(user.id))}`);
	const keys = await AsyncStorage.getAllKeys();
	const removing = keys.filter(key => prefixes.some(prefix => key.startsWith(prefix)) || chatKeys.includes(key));
	if (removing.length) await AsyncStorage.multiRemove(removing);
}

export function getCurrentOwnerKey() {
	return memoryOwnerKey;
}

export async function setCurrentOwnerKey(ownerKey) {
	memoryOwnerKey = ownerKey || null;
	if (ownerKey) {
		await AsyncStorage.setItem(CURRENT_OWNER_KEY, ownerKey);
	} else {
		await AsyncStorage.removeItem(CURRENT_OWNER_KEY);
	}
}

export async function restoreCurrentOwnerKey() {
	if (memoryOwnerKey) return memoryOwnerKey;
	try {
		memoryOwnerKey = await AsyncStorage.getItem(CURRENT_OWNER_KEY);
	} catch (e) {
		memoryOwnerKey = null;
	}
	return memoryOwnerKey;
}

/** Build namespaced key: userData/{ownerKey}/{leaf} */
export function userDataKey(leaf, ownerKey = memoryOwnerKey) {
	const owner = ownerKey || "anonymous";
	return `${USER_DATA_ROOT}/${owner}/${leaf}`;
}

/**
 * Ensure a user folder exists (writes meta.json-like record).
 * Call on register / login so each account has its own directory.
 */
export async function ensureUserFolder(user) {
	const base = baseOwnerKey(user);
	if (user?.id && base && base !== "guest") {
		if (await AsyncStorage.getItem(retiredOwnerKey(base)) === "1") retiredPhoneOwners.add(base);
		if (!retiredPhoneOwners.has(base)) {
			let previous;
			try { previous = JSON.parse(await AsyncStorage.getItem(userDataKey("meta", base)) || "null"); } catch { /* Legacy unreadable metadata is handled below. */ }
			if (previous?.remoteId && String(previous.remoteId) !== String(user.id)) {
				retiredPhoneOwners.add(base);
				await AsyncStorage.setItem(retiredOwnerKey(base), "1");
			}
		}
	}
	const ownerKey = getOwnerKey(user);
	if (!ownerKey) return null;

	await setCurrentOwnerKey(ownerKey);

	const metaKey = userDataKey("meta", ownerKey);
	const existing = await AsyncStorage.getItem(metaKey);
	const now = new Date().toISOString();

	if (!existing) {
		const meta = {
			ownerKey,
			createdAt: now,
			updatedAt: now,
			name: user?.name || "",
			phone: user?.phone || "",
			email: user?.email || "",
			role: user?.role || "",
			profileRole: user?.profileRole || "",
			// Placeholder for future cloud sync
			remoteId: user?.id || null,
			syncStatus: user?.token ? "cloud-connected" : "local-only",
		};
		await AsyncStorage.setItem(metaKey, JSON.stringify(meta));
	} else {
		try {
			const meta = JSON.parse(existing);
			meta.updatedAt = now;
			meta.name = user?.name || meta.name;
			meta.phone = user?.phone || meta.phone;
			meta.email = user?.email || meta.email;
			meta.remoteId = user?.id || meta.remoteId || null;
			meta.syncStatus = user?.token ? "cloud-connected" : meta.syncStatus;
			await AsyncStorage.setItem(metaKey, JSON.stringify(meta));
		} catch (e) {
			// ignore corrupt meta
		}
	}

	return ownerKey;
}

export async function clearCurrentOwner() {
	await setCurrentOwnerKey(null);
}

/**
 * Read JSON for the current user. Optionally migrate once from a legacy global key.
 */
export async function getUserJson(leaf, fallback, legacyKey) {
	await restoreCurrentOwnerKey();
	const key = userDataKey(leaf);
	try {
		let raw = await AsyncStorage.getItem(key);
		if (raw == null && legacyKey) {
			const legacy = await AsyncStorage.getItem(legacyKey);
			if (legacy != null && memoryOwnerKey) {
				// One-time migrate: copy into this user's folder, then drop global key
				await AsyncStorage.setItem(key, legacy);
				await AsyncStorage.removeItem(legacyKey);
				raw = legacy;
			}
		}
		if (raw == null) return typeof fallback === "function" ? fallback() : fallback;
		return JSON.parse(raw);
	} catch (e) {
		return typeof fallback === "function" ? fallback() : fallback;
	}
}

export async function setUserJson(leaf, value) {
	const owner = memoryOwnerKey || await restoreCurrentOwnerKey();
	const key = userDataKey(leaf, owner);
	await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function getUserString(leaf, fallback = null, legacyKey) {
	await restoreCurrentOwnerKey();
	const key = userDataKey(leaf);
	try {
		let raw = await AsyncStorage.getItem(key);
		if (raw == null && legacyKey) {
			const legacy = await AsyncStorage.getItem(legacyKey);
			if (legacy != null && memoryOwnerKey) {
				await AsyncStorage.setItem(key, legacy);
				await AsyncStorage.removeItem(legacyKey);
				raw = legacy;
			}
		}
		return raw != null ? raw : fallback;
	} catch (e) {
		return fallback;
	}
}

export async function setUserString(leaf, value) {
	await restoreCurrentOwnerKey();
	await AsyncStorage.setItem(userDataKey(leaf), value);
}

/** List known local user folders (ownerKeys that have meta). */
export async function listUserFolders() {
	const keys = await AsyncStorage.getAllKeys();
	const prefix = `${USER_DATA_ROOT}/`;
	const owners = new Set();
	keys.forEach((k) => {
		if (!k.startsWith(prefix)) return;
		const rest = k.slice(prefix.length);
		const owner = rest.split("/")[0];
		if (owner) owners.add(owner);
	});
	return [...owners];
}
