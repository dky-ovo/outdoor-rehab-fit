// App Upgrade #4: App usage data tracking (per-user folder)
import { getCurrentOwnerKey, getUserJson, setUserJson } from "./userStorage";
import { toDateKey } from "./dates";
import { newSyncOperation, updateJournal, journalBatch, reconcileJournal } from './accountSyncJournal';
import { notifyAccountData } from './accountSyncEvents';

const LEAF = "usageStats";
const LEGACY_KEY = "usageStats";

const DEFAULT_STATS = {
	usageDays: [], // list of "YYYY-MM-DD" where the main page was loaded at least once
	loginEvents: 0, // number of log-in events
	introLoads: 0, // number of times an exercise introduction page is loaded
	audioPlays: 0, // number of times an audio recording is played
	goalsAchieved: 0, // number of times preset/WHO goals are achieved
	outdoorSessions: 0, // completed outdoor practical sessions
	homeSessions: 0, // completed home practical sessions
	ttsPlays: 0, // number of times text-to-speech is used
};

let statsMutationQueue = Promise.resolve();

async function readStats() {
	const raw = await getUserJson(LEAF, null, LEGACY_KEY);
  if (raw?.format === 2) return raw;
  const deviceId = newSyncOperation();
  const local = { ...DEFAULT_STATS, ...(raw || {}), usageDays: [...(raw?.usageDays || [])] };
  return { format: 2, deviceId, components: { [deviceId]: local } };
}
function totalStats(state) {
  const result = { ...DEFAULT_STATS, usageDays: [] }, days = new Set();
  for (const component of Object.values(state.components)) {
    for (const day of component.usageDays || []) days.add(day);
    for (const key of Object.keys(DEFAULT_STATS)) if (key !== 'usageDays') result[key] += Number(component[key]) || 0;
  }
  result.usageDays = [...days].sort(); return result;
}
export const getUsageStats = async () => {
  await statsMutationQueue;
  return totalStats(await readStats());
};

const saveStats = async (stats) => {
	try {
		stats.cloud = updateJournal(stats.cloud, stats.components);
		await setUserJson(LEAF, stats);
		notifyAccountData(getCurrentOwnerKey(), 'usage');
	} catch (e) {
		// non-fatal
	}
};

const mutateStats = (mutator) => {
	const owner = getCurrentOwnerKey();
	const operation = statsMutationQueue.then(async () => {
		if (getCurrentOwnerKey() !== owner) return;
		const state = await readStats();
		if (getCurrentOwnerKey() !== owner) return;
		const stats = state.components[state.deviceId] || { ...DEFAULT_STATS, usageDays: [] };
		state.components[state.deviceId] = stats;
		const changed = mutator(stats);
		if (changed !== false) await saveStats(state);
		return totalStats(state);
	});
	statsMutationQueue = operation.catch(() => {});
	return operation;
};

// Record that the app was used today (call when home page loads)
export const trackUsageDay = () => mutateStats((stats) => {
	const today = toDateKey();
	if (stats.usageDays.includes(today)) return false;
	stats.usageDays.push(today);
});

export const trackCounter = (counterName, amount = 1) => mutateStats((stats) => {
	if (!Object.hasOwn(DEFAULT_STATS, counterName) || counterName === 'usageDays' || !Number.isSafeInteger(amount) || amount < 0) return false;
	stats[counterName] = (stats[counterName] || 0) + amount;
});

// Backfill sessions created by older builds where the first login could race
// with the home-screen usage-day write and remain incorrectly at zero.
export const ensureFirstLoginEvent = () => mutateStats((stats) => {
	if ((stats.loginEvents || 0) >= 1) return false;
	stats.loginEvents = 1;
});

export const trackLoginEvent = () => trackCounter("loginEvents");
export const trackIntroLoad = () => trackCounter("introLoads");
export const trackAudioPlay = () => trackCounter("audioPlays");
export const trackGoalAchieved = (n = 1) => trackCounter("goalsAchieved", n);
export const trackSessionCompleted = (mode) => trackCounter(mode === "home" ? "homeSessions" : "outdoorSessions");
export const trackTtsPlay = () => trackCounter("ttsPlays");

function queuedStats(work) { const operation = statsMutationQueue.then(work); statsMutationQueue = operation.catch(() => {}); return operation; }
export async function synchronizeUsage({ owner, token, send, isCurrent }) {
  const valid = () => getCurrentOwnerKey() === owner && isCurrent();
  const outgoing = await queuedStats(async () => {
    if (!valid()) return null;
    const state = await readStats(); if (!valid()) return null;
    state.cloud = updateJournal(state.cloud, state.components);
    await setUserJson(LEAF, state);
    return { collection: 'usage', cursor: state.cloud.cursor, changes: journalBatch(state.cloud, state.components) };
  });
  if (!outgoing || !valid()) return;
  const result = await send(token, outgoing);
  let pending = false;
  await queuedStats(async () => {
    if (!valid()) return;
    const state = await readStats(); if (!valid()) return;
    const merged = reconcileJournal(state.cloud, result, outgoing.changes, state.components);
    await setUserJson(LEAF, { ...state, components: merged.documents, cloud: merged.journal });
    pending = Object.keys(merged.journal.pending).length > 0;
    if (JSON.stringify(state.components) !== JSON.stringify(merged.documents)) notifyAccountData(owner, 'usage', true);
  });
  return result.more || pending;
}
