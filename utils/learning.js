// Completion requires evidence of 75% coverage, not a tap or an old boolean.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentOwnerKey, userDataKey } from "./userStorage";
import { learningTextSections } from "./learningCoverage";
import { notifyAccountData } from './accountSyncEvents';

export const LEARNING_THRESHOLD = 0.75;
const LEAF = "learningProgress";
const SYNC_LEAF = "learningProgressSyncV1";
const queues = new Map();
const listeners = new Set();
const fields = ["read", "watched", "listened"];

export function mergeLearningRanges(ranges, total) {
	if (!Number.isFinite(total) || total <= 0) return [];
	const sorted = (Array.isArray(ranges) ? ranges : []).filter((r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite))
		.map(([a, b]) => [Math.max(0, Math.min(total, a)), Math.max(0, Math.min(total, b))]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
	return sorted.reduce((merged, range) => {
		const previous = merged[merged.length - 1];
		if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
		else merged.push([...range]);
		return merged;
	}, []);
}

export function learningGroupCoverage(group) {
	const parts = Array.isArray(group?.parts) ? group.parts : [];
	let total = 0; let covered = 0;
	for (const part of parts) {
		if (!Number.isFinite(part?.total) || part.total <= 0) return 0;
		total += part.total;
		covered += mergeLearningRanges(group.ranges?.[part.key], part.total).reduce((sum, [a, b]) => sum + b - a, 0);
	}
	return total > 0 ? covered / total : 0;
}

export function learningFlags(entry) {
	return Object.fromEntries(fields.map((field) => [field, entry?.version === 2 && Object.values(entry.evidence?.[field] || {}).some((group) => learningGroupCoverage(group) >= LEARNING_THRESHOLD)]));
}

// Favorites describe the currently displayed language/content, not a retired
// revision. Historical evidence remains stored for returning to that revision.
export function equipmentLearningCoverage(entry, item, locale) {
	const textKey = `${locale}:text:${learningContentKey(JSON.stringify(learningTextSections(item)))}`;
	const videoPrefix = `${locale}:${learningContentKey(item.videoUrl || item.youtubeKey)}:`;
	const audioPrefix = `${locale}:audio:${item.id}:`;
	return Object.fromEntries(fields.map((field) => [field, entry?.version === 2 ? Math.max(0, ...Object.entries(entry.evidence?.[field] || {}).map(([key, group]) => {
		const current = field === "read" ? key === textKey : field === "watched" ? Boolean(item.videoUrl || item.youtubeKey) && key.startsWith(videoPrefix) : key === textKey || key.startsWith(audioPrefix);
		return current ? learningGroupCoverage(group) : 0;
	})) : 0]));
}

export function equipmentLearningFlags(entry, item, locale) {
	return Object.fromEntries(Object.entries(equipmentLearningCoverage(entry, item, locale)).map(([field, ratio]) => [field, ratio >= LEARNING_THRESHOLD]));
}

// Content changes create a new group, so different versions cannot be combined.
export function learningContentKey(value) {
	const text = String(value || "");
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	return `${text.length}-${(hash >>> 0).toString(16)}`;
}

async function readOwner(owner, strict = false) {
	try {
		const value = JSON.parse(await AsyncStorage.getItem(userDataKey(LEAF, owner)) || "{}");
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (error) { if (strict) throw error; return {}; }
}

export async function getLearningProgress() {
	const owner = getCurrentOwnerKey();
	if (!owner) return {};
	await (queues.get(owner) || Promise.resolve());
	const progress = await readOwner(owner);
	if (getCurrentOwnerKey() !== owner) return {};
	return Object.fromEntries(Object.entries(progress).map(([id, entry]) => [id, { ...entry, ...learningFlags(entry) }]));
}

// Research dates use Hong Kong time, independent of the handset's time zone.
export function learningDateKey(time = Date.now()) {
	return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function enqueue(owner, work) {
	const operation = (queues.get(owner) || Promise.resolve()).then(work);
	const tail = operation.catch(() => {});
	queues.set(owner, tail);
	void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner); });
	return operation;
}

function evidenceEntry(entry) {
	return entry?.version === 2 && entry.evidence && typeof entry.evidence === "object" && !Array.isArray(entry.evidence)
		? JSON.parse(JSON.stringify({ version: 2, evidence: entry.evidence })) : { version: 2, evidence: {} };
}

async function readOutbox(owner, data) {
	// Do not swallow a storage failure or overwrite an unreadable pending upload.
	const raw = await AsyncStorage.getItem(userDataKey(SYNC_LEAF, owner));
	if (raw) {
		const state = JSON.parse(raw);
		if (!state || state.version !== 1 || !state.records || typeof state.records !== "object" || Array.isArray(state.records) || !Number.isSafeInteger(state.sequence)) throw new Error("invalidLearningOutbox");
		return state;
	}
	const state = { version: 1, sequence: 0, records: {} };
	// Older evidence has no reliable date: preserve it as cumulative-only history.
	for (const [equipmentId, old] of Object.entries(data)) {
		const entry = evidenceEntry(old);
		if (!fields.some((field) => Object.values(entry.evidence[field] || {}).some((group) => learningGroupCoverage(group) > 0))) continue;
		state.records[`undated|${equipmentId}`] = { revision: ++state.sequence, record: { equipmentId, date: null, entry } };
	}
	return state;
}

const partsSignature = parts => JSON.stringify([...parts].sort((a,b) => a.key.localeCompare(b.key)));
function addRange(entry, { field, groupKey, parts, partKey, start, end }) {
	if (!entry.evidence[field] || typeof entry.evidence[field] !== "object" || Array.isArray(entry.evidence[field])) entry.evidence[field] = {};
	const existing = entry.evidence[field][groupKey];
	const group = existing && existing.ranges && typeof existing.ranges === "object" && !Array.isArray(existing.ranges) && partsSignature(existing.parts) === partsSignature(parts) ? existing : { parts, ranges: {} };
	const ranges = mergeLearningRanges([...(group.ranges[partKey] || []), [start, end]], parts.find((part) => part.key === partKey).total);
	if (JSON.stringify(ranges) === JSON.stringify(group.ranges[partKey] || [])) return false;
	group.ranges[partKey] = ranges;
	entry.evidence[field][groupKey] = group;
	const keys = Object.keys(entry.evidence[field]);
	for (const key of keys.slice(0, Math.max(0, keys.length - 12))) delete entry.evidence[field][key];
	return true;
}

export function subscribeLearningChanges(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getPendingLearningRecords(owner) {
	if (!owner || owner === "guest") return Promise.resolve([]);
	return enqueue(owner, async () => {
		if (getCurrentOwnerKey() !== owner) return [];
		const state = await readOutbox(owner, await readOwner(owner, true));
		if (getCurrentOwnerKey() !== owner) return [];
		await AsyncStorage.setItem(userDataKey(SYNC_LEAF, owner), JSON.stringify(state));
		if (getCurrentOwnerKey() !== owner) return [];
		return Object.entries(state.records).map(([key, value]) => ({ key, ...value }));
	});
}

export function acknowledgeLearningRecords(owner, snapshots) {
	return enqueue(owner, async () => {
		if (!owner || owner === "guest" || getCurrentOwnerKey() !== owner) return;
		const state = await readOutbox(owner, await readOwner(owner, true));
		if (getCurrentOwnerKey() !== owner) return;
		for (const { key, revision } of snapshots) if (state.records[key]?.revision === revision) delete state.records[key];
		await AsyncStorage.setItem(userDataKey(SYNC_LEAF, owner), JSON.stringify(state));
	});
}

export function recordLearningCoverage({ equipmentId, field, groupKey, parts, partKey, start, end, owner = getCurrentOwnerKey() }) {
	if (!owner || !fields.includes(field) || !groupKey || !Array.isArray(parts) || !parts.length || !parts.some((part) => part.key === partKey) ||
		parts.some((part) => !part?.key || !Number.isFinite(part.total) || part.total <= 0) || ![start, end].every(Number.isFinite) || end <= start) return Promise.resolve();
	// Capture the namespace before any await. A delayed callback cannot write to a
	// newly logged-in account, and concurrent read/audio/video writes are serialized.
	const date = learningDateKey();
	return enqueue(owner, async () => {
		if (getCurrentOwnerKey() !== owner) return;
		const data = await readOwner(owner, true);
		if (getCurrentOwnerKey() !== owner) return;
		const id = String(equipmentId);
		const range = { field, groupKey, parts, partKey, start, end };
		const entry = evidenceEntry(data[id]);
		const changed = addRange(entry, range);
		let syncError;
		if (owner !== "guest") {
			try {
			const state = await readOutbox(owner, data);
			if (getCurrentOwnerKey() !== owner) return;
			const key = `${date}|${id}`;
			const pending = evidenceEntry(state.records[key]?.record.entry);
			if (addRange(pending, range)) state.records[key] = { revision: ++state.sequence, record: { equipmentId: id, date, entry: pending } };
			await AsyncStorage.setItem(userDataKey(SYNC_LEAF, owner), JSON.stringify(state));
			} catch (error) { syncError = error; }
		}
		// An unreadable upload queue must not break the existing local Favorites
		// progress. Preserve that queue for recovery; never silently replace it.
		if (changed) {
			data[id] = { ...entry, ...learningFlags(entry) };
			await AsyncStorage.setItem(userDataKey(LEAF, owner), JSON.stringify(data));
		}
		if (getCurrentOwnerKey() === owner) for (const listener of listeners) { try { listener(owner); } catch { /* A subscriber cannot break local recording. */ } }
		if (syncError) throw syncError;
	});
}

// Legacy callers cannot invent proof of reading/watching/listening.
export const markLearning = () => Promise.resolve();
export const markRead = markLearning;
export const markWatched = markLearning;
export const markListened = markLearning;

// Downloaded cumulative evidence is display state, never a new research event.
export function mergeRemoteLearning(owner, items, isCurrent = () => true) {
  return enqueue(owner, async () => {
    const current = () => isCurrent() && getCurrentOwnerKey() === owner;
    if (!current() || !Array.isArray(items)) return;
    const data = await readOwner(owner, true);
    // Initialize legacy uploads before adding remote evidence. A fresh device
    // must not upload downloaded progress again with a fabricated date.
    const outbox = await readOutbox(owner, data);
    if (!current()) return;
    await AsyncStorage.setItem(userDataKey(SYNC_LEAF, owner), JSON.stringify(outbox));
    const before = JSON.stringify(data);
    for (const item of items) {
      const id = String(item.equipmentId || '');
      if (!id || ['__proto__','constructor','prototype'].includes(id) || item.entry?.version !== 2) continue;
      const entry = evidenceEntry(data[id]);
      for (const field of fields) {
        entry.evidence[field] ||= {};
        for (const [key, remote] of Object.entries(item.entry.evidence?.[field] || {})) {
          if (['__proto__','constructor','prototype'].includes(key) || !Array.isArray(remote.parts) || remote.parts.some(p => !p?.key || !Number.isFinite(p.total) || p.total <= 0)) continue;
          const existing = entry.evidence[field][key];
          if (existing && partsSignature(existing.parts) !== partsSignature(remote.parts)) continue;
          const group = existing || { parts: remote.parts, ranges: {} };
          for (const part of remote.parts) group.ranges[part.key] = mergeLearningRanges([...(group.ranges[part.key] || []), ...(remote.ranges?.[part.key] || [])], part.total);
          entry.evidence[field][key] = group;
        }
      }
      data[id] = { ...entry, ...learningFlags(entry) };
    }
    if (!current() || before === JSON.stringify(data)) return;
    await AsyncStorage.setItem(userDataKey(LEAF, owner), JSON.stringify(data));
    if (current()) notifyAccountData(owner, 'learning', true);
  });
}
