// Per-user bookmarks for outdoor equipment
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentOwnerKey, restoreCurrentOwnerKey, userDataKey } from "./userStorage";

const LEAF = "bookmarkedItems";
const LEGACY_KEY = "bookmarkedItems";
const LEGACY_OWNER_KEY = "bookmarkedItems:migrationOwner";
let currentRecord = null;
let legacyWrites = Promise.resolve();
const ownerWrites = new Map();
const listeners = new Set();
export const subscribeBookmarkChanges = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const notify = owner => { for (const listener of listeners) listener(owner); };
const operationId = () => `bookmark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function decode(raw) {
	const value = JSON.parse(raw || '{}');
	if (value?.format === 2) {
		if (!value.value || !value.pending || !value.versions) throw new Error('BOOKMARK_STORAGE_INVALID');
		return value;
	}
	return { format: 2, value: value || {}, versions: {}, pending: {}, initialized: false };
}

function recordFor(owner) {
	if (currentRecord?.owner !== owner) currentRecord = { owner, value: null, revision: 0, read: null, writes: Promise.resolve() };
	return currentRecord;
}
function current(record) { return currentRecord === record && getCurrentOwnerKey() === record.owner; }
function snapshot(value) {
	return Object.freeze(value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
}
function queueOwnerWrite(record, work) {
	// Keep ordering across A -> B -> A even though only the active owner's
	// snapshot is retained. Drop settled tails instead of retaining all accounts.
	const operation = (ownerWrites.get(record.owner) || Promise.resolve()).then(work);
	const tail = operation.catch(() => {});
	ownerWrites.set(record.owner, tail);
	record.writes = tail;
	void tail.then(() => { if (ownerWrites.get(record.owner) === tail) ownerWrites.delete(record.owner); });
	return operation;
}

// Login's offline sync already reads bookmarks. Reuse that committed snapshot
// on the first Favorites render, instead of queuing another SQLite/bridge read.
// Only the active owner is retained; null means it has not been hydrated yet.
export function getCachedBookmarks() {
	return currentRecord && current(currentRecord) ? currentRecord.value : null;
}

function migrateLegacy(record, key, revision) {
	const operation = legacyWrites.then(async () => {
		if (!current(record) || record.revision !== revision) return null;
		const raw = await AsyncStorage.getItem(LEGACY_KEY);
		if (raw == null) return null;
		const owner = await AsyncStorage.getItem(LEGACY_OWNER_KEY);
		if ((owner && owner !== record.owner) || !current(record) || record.revision !== revision) return null;
		// Persist the claim before copying. A failed removal or process restart
		// must never assign the same global legacy favorites to another account.
		if (!owner) await AsyncStorage.setItem(LEGACY_OWNER_KEY, record.owner);
		if (!current(record) || record.revision !== revision) return null;
		const copying = queueOwnerWrite(record, async () => {
			if (record.revision !== revision) return null;
			await AsyncStorage.setItem(key, raw);
			// Finish retiring the claimed legacy record even if its owner logged out.
			await AsyncStorage.removeItem(LEGACY_KEY);
			return raw;
		});
		return copying;
	});
	legacyWrites = operation.catch(() => {});
	return operation;
}

export const getBookmarks = async () => {
	const owner = getCurrentOwnerKey() || await restoreCurrentOwnerKey();
	if (!owner || getCurrentOwnerKey() !== owner) return {};
	const record = recordFor(owner);
	if (record.read) return record.read;
	const reading = (async () => {
		try {
			while (current(record)) {
				await (ownerWrites.get(owner) || record.writes);
				if (!current(record)) return {};
				if (record.value !== null) return record.value;
				const revision = record.revision, key = userDataKey(LEAF, owner);
				let raw = await AsyncStorage.getItem(key);
				if (raw == null) raw = await migrateLegacy(record, key, revision);
				if (!current(record)) return {};
				// A save may have failed while our initial read was pending. Reread
				// the persisted value instead of treating an unknown snapshot as empty.
				if (record.revision !== revision) continue;
				record.value = snapshot(decode(raw).value);
				return record.value;
			}
			return {};
		} catch { return current(record) ? record.value || {} : {}; }
	})();
	record.read = reading;
	try { return await reading; } finally { if (record.read === reading) record.read = null; }
};

export const saveBookmarks = async (bookmarks, { changedIds } = {}) => {
	// Resolve the namespace once, before a storage await can switch accounts.
	const owner = getCurrentOwnerKey() || await restoreCurrentOwnerKey();
	if (!owner || getCurrentOwnerKey() !== owner) return;
	const record = recordFor(owner), value = snapshot(bookmarks);
	const requestedIds = changedIds?.map(String);
	record.revision += 1;
	const write = queueOwnerWrite(record, async () => {
		const key = userDataKey(LEAF, owner), state = decode(await AsyncStorage.getItem(key));
		const merged = requestedIds ? { ...state.value } : { ...value };
		for (const id of requestedIds || []) { if (value[id]) merged[id] = true; else delete merged[id]; }
		for (const id of new Set(requestedIds || [...Object.keys(state.value), ...Object.keys(value)])) {
			if (Boolean(state.value[id]) !== Boolean(value[id])) state.pending[id] = { id, selected: Boolean(value[id]), operationId: operationId(), version: state.versions[id] ?? (state.initialized ? 0 : null) };
		}
		state.value = merged;
		await AsyncStorage.setItem(key, JSON.stringify(state));
		if (current(record)) record.value = snapshot(merged);
		notify(owner);
	});
	await write;
};

// Send only item-level changes. Pulls never gate rendering, and an in-flight
// response cannot overwrite a newer local toggle or a different signed-in user.
export async function synchronizeBookmarks({ owner, token, send, isCurrent = () => true }) {
	if (!owner || owner === 'guest' || getCurrentOwnerKey() !== owner || !isCurrent()) return;
	await getBookmarks();
	const record = recordFor(owner), key = userDataKey(LEAF, owner);
	const batch = await queueOwnerWrite(record, async () => {
		if (!current(record) || !isCurrent()) return null;
		const state = decode(await AsyncStorage.getItem(key));
		if (!state.initialized) {
			for (const id of Object.keys(state.value)) if (state.value[id] && !state.pending[id]) state.pending[id] = { id, selected: true, operationId: operationId(), version: null };
			state.initialized = true;
			await AsyncStorage.setItem(key, JSON.stringify(state));
		}
		return Object.values(state.pending).slice(0, 100);
	});
	if (!batch || !current(record) || !isCurrent()) return;
	const result = await send(token, batch);
	if (!Array.isArray(result?.records) || !Array.isArray(result?.acknowledged)) throw new Error('BOOKMARK_SYNC_INVALID');
	await queueOwnerWrite(record, async () => {
		if (!current(record) || !isCurrent()) return;
		const state = decode(await AsyncStorage.getItem(key));
		for (const ack of result.acknowledged) if (state.pending[ack.id]?.operationId === ack.operationId) delete state.pending[ack.id];
		const value = {}, versions = {};
		for (const item of result.records) {
			if (typeof item.id !== 'string' || !Number.isSafeInteger(item.version)) throw new Error('BOOKMARK_SYNC_INVALID');
			if (item.selected) value[item.id] = true;
			versions[item.id] = item.version;
		}
		for (const pending of Object.values(state.pending)) {
			// A toggle during upload is based on the newly acknowledged version.
			if (batch.some(sent => sent.id === pending.id)) pending.version = versions[pending.id] ?? 0;
			if (pending.selected) value[pending.id] = true; else delete value[pending.id];
		}
		await AsyncStorage.setItem(key, JSON.stringify({ ...state, value, versions }));
		record.revision += 1;
		if (current(record) && JSON.stringify(record.value) !== JSON.stringify(value)) { record.value = snapshot(value); notify(owner); }
	});
}
