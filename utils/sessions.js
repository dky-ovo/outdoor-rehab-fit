// App Upgrade #5: Exercise session records (per-user folder)
import { getCurrentOwnerKey, getUserJson, setUserJson } from "./userStorage";
import { deleteServerSession, getServerSessions, saveServerSession } from "./api";
import { notifyAccountData } from './accountSyncEvents';

const LEAF = "exerciseSessions";
const LEGACY_KEY = "exerciseSessions";
const CLOUD_MIGRATION_LEAF = "exerciseSessionsCloudMigrated";
const PENDING_SYNC_LEAF = "exerciseSessionsPendingSync";
let sessionOperationQueue = Promise.resolve();
const sessionSyncQueues = new Map();
const refreshingSessions = new Map();

const assertSessionOwner = (owner) => {
	if (getCurrentOwnerKey() !== owner) {
		const error = new Error("Exercise session account changed");
		error.code = "SESSION_OWNER_CHANGED";
		throw error;
	}
};

// Only local read/modify/write work holds this lock. A request suspended during
// screen lock must not stop a completed exercise being saved on the device.
const withSessionStorage = (operation, owner = getCurrentOwnerKey()) => {
	const assertOwner = () => assertSessionOwner(owner);
	const pending = sessionOperationQueue.then(async () => {
		assertOwner();
		return operation(assertOwner);
	});
	sessionOperationQueue = pending.catch(() => {});
	return pending;
};

// Preserve remote request order separately from the local storage lock. New
// local edits remain available while a slow refresh/upload finishes.
const withSessionSync = (operation, owner) => {
	const pending = (sessionSyncQueues.get(owner) || Promise.resolve()).then(() => {
		assertSessionOwner(owner);
		return operation(() => assertSessionOwner(owner));
	});
	const tail = pending.catch(() => {});
	sessionSyncQueues.set(owner, tail);
	void tail.then(() => { if (sessionSyncQueues.get(owner) === tail) sessionSyncQueues.delete(owner); });
	return pending;
};

// Session shape:
// {
//   id, date (ISO string, completion time), durationSec,
//   mode: "outdoor" | "home",
//   emotion: 1-5, rpe: 0-10,
//   journal: string,
//   exercises: [{ name, equipmentId, intensity: 0-10 }],
//   Legacy records may contain `reps` instead of `intensity` and remain readable.
//   types: { aerobic: bool, balance: bool, muscle: bool },
// }

const getLocalSessions = async () => {
	const data = await getUserJson(LEAF, [], LEGACY_KEY);
	return Array.isArray(data) ? data : [];
};

const sortNewest = (sessions) => [...sessions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

const readSessionState = async (assertOwner) => {
	const local = await getLocalSessions();
	assertOwner();
	const migrated = await getUserJson(CLOUD_MIGRATION_LEAF, false);
	assertOwner();
	const pendingIds = new Set(await getUserJson(PENDING_SYNC_LEAF, []));
	assertOwner();
	return { local, migrated, pendingIds };
};

const sameRecord = (first, second) => JSON.stringify(first) === JSON.stringify(second);

export const getSessions = (token, { strict = false } = {}) => {
	const owner = getCurrentOwnerKey();
	const readLocal = () => withSessionStorage(async (assertOwner) => {
		const local = await getLocalSessions();
		assertOwner();
		return local;
	}, owner);
	if (!token) return readLocal();
	const refreshKey = `${owner}|${token}`;
	let refresh = refreshingSessions.get(refreshKey);
	if (!refresh) {
	refresh = withSessionSync(async (assertOwner) => {
		const result = await getServerSessions(token);
		assertOwner();
		// An interrupted/invalid response is not an authoritative empty list.
		// Keep cached records until a valid server response can be reconciled.
		if (!Array.isArray(result?.sessions)) throw new Error("Invalid exercise session response");
		const remote = result.sessions;
		const { local, migrated, pendingIds } = await withSessionStorage(readSessionState, owner);
		const remoteIds = new Set(remote.map((session) => String(session.id)));
		// Pending edits may have the SAME id as an older server record. They must
		// be retried too, otherwise the next refresh silently undoes the edit.
		const pendingLocal = local.filter((session) => pendingIds.has(String(session.id)) || (!migrated && !remoteIds.has(String(session.id))));
		await Promise.all(pendingLocal.map((session) => saveServerSession(token, session)));
		assertOwner();
		return withSessionStorage(async (checkOwner) => {
			const current = await readSessionState(checkOwner);
			// The user may have saved or edited again while the network was busy.
			// Keep those latest pending values over both server and upload snapshots.
			const newerLocal = current.local.filter((session) => current.pendingIds.has(String(session.id)) || (!current.migrated && !remoteIds.has(String(session.id))));
			const mergedMap = new Map([...remote, ...pendingLocal, ...newerLocal].map((session) => [String(session.id), session]));
			const merged = sortNewest([...mergedMap.values()]);
			pendingLocal.forEach((uploaded) => {
				if (sameRecord(current.local.find((item) => String(item.id) === String(uploaded.id)), uploaded)) current.pendingIds.delete(String(uploaded.id));
			});
			await setUserJson(LEAF, merged);
			checkOwner();
			await setUserJson(PENDING_SYNC_LEAF, [...current.pendingIds]);
			checkOwner();
			await setUserJson(CLOUD_MIGRATION_LEAF, true);
			if (!sameRecord(current.local, merged)) notifyAccountData(owner, 'sessions', true);
			return merged;
		}, owner);
	}, owner);
	refreshingSessions.set(refreshKey, refresh);
	const clear = () => { if (refreshingSessions.get(refreshKey) === refresh) refreshingSessions.delete(refreshKey); };
	void refresh.then(clear, clear);
	}
	return refresh.catch(async (error) => {
		// Stale responses never expose or mutate another signed-in account.
		if (error?.code === "SESSION_OWNER_CHANGED" || getCurrentOwnerKey() !== owner) return [];
		if (strict) throw error;
		return readLocal();
	});
};

export const saveSession = async (session, token, { waitForSync = true } = {}) => {
	const owner = getCurrentOwnerKey();
	const next = await withSessionStorage(async (assertOwner) => {
		const { local, pendingIds } = await readSessionState(assertOwner);
		pendingIds.add(String(session.id));
		const saved = sortNewest([session, ...local.filter((item) => String(item.id) !== String(session.id))]);
		await setUserJson(PENDING_SYNC_LEAF, [...pendingIds]);
		assertOwner();
		await setUserJson(LEAF, saved);
		assertOwner();
		return saved;
	}, owner);
	if (token) {
		const syncing = withSessionSync(async (assertOwner) => {
			try {
				await saveServerSession(token, session);
				assertOwner();
				await withSessionStorage(async (checkOwner) => {
					const current = await readSessionState(checkOwner);
					if (sameRecord(current.local.find((item) => String(item.id) === String(session.id)), session)) {
						current.pendingIds.delete(String(session.id));
						await setUserJson(PENDING_SYNC_LEAF, [...current.pendingIds]);
					}
				}, owner);
			} catch { assertOwner(); /* Failed uploads remain pending, including server validation errors. */ }
		}, owner);
		if (waitForSync) await syncing;
		else void syncing.catch(() => {});
	}
	return next;
};

export const deleteSession = (id, token) => {
	const owner = getCurrentOwnerKey();
	const remove = (expectedRecord, preserveNewer = false) => withSessionStorage(async (assertOwner) => {
		const { local, pendingIds } = await readSessionState(assertOwner);
		// An edit made after the delete request was queued is a newer intent.
		// Its own queued upload must keep its local pending copy if offline.
		if (preserveNewer && !sameRecord(local.find((session) => String(session.id) === String(id)), expectedRecord)) return local;
		const next = local.filter((session) => String(session.id) !== String(id));
		await setUserJson(LEAF, next);
		assertOwner();
		pendingIds.delete(String(id));
		await setUserJson(PENDING_SYNC_LEAF, [...pendingIds]);
		return next;
	}, owner);
	if (!token) return remove();
	const snapshot = withSessionStorage(async (assertOwner) => {
		const local = await getLocalSessions();
		assertOwner();
		return local.find((session) => String(session.id) === String(id));
	}, owner);
	// The remote queue can be busy when account switching rejects this read.
	// It is still rethrown by the queued operation, without an early unhandled rejection.
	void snapshot.catch(() => {});
	return withSessionSync(async (assertOwner) => {
		const expectedRecord = await snapshot;
		await deleteServerSession(token, id);
		assertOwner();
		return remove(expectedRecord, true);
	}, owner);
};

export const getSessionById = async (id, token) => {
	const sessions = await getSessions(token);
	return sessions.find((session) => String(session.id) === String(id));
};
