// App Upgrade #6: Goal setting and progress checking (per-user folder)
import { getCurrentOwnerKey, getUserJson, setUserJson } from "./userStorage";
import { getWeekKey, toDateKey } from "./dates";
import { getSessions } from "./sessions";
import { updateJournal, journalBatch, reconcileJournal, releaseRejectedJournalBatch, newSyncOperation } from './accountSyncJournal';
import { notifyAccountData } from './accountSyncEvents';

const LEAF = "goalSettings";
const LEGACY_KEY = "goalSettings";
let mutationQueue = Promise.resolve();
let goalSequence = 0;

// Goal buttons share a single read/modify/write record. Preserve every click
// when changes arrive before AsyncStorage has finished the previous write.
const updateGoalState = (update) => {
	const owner = getCurrentOwnerKey();
	const pending = mutationQueue.then(async () => {
		if (getCurrentOwnerKey() !== owner) throw new Error("Goal account changed");
		const state = await readGoalState();
		update(state);
		if (getCurrentOwnerKey() !== owner) throw new Error("Goal account changed");
		return saveGoalState(state);
	});
	mutationQueue = pending.catch(() => {});
	return pending;
};

// Aerobic targets are weekly minutes; balance and muscle targets are weekly days.
export const DEFAULT_GOALS = {
	aerobic: 150,
	balance: 3,
	muscle: 2,
};

const DEFAULT_STATE = {
	targets: { ...DEFAULT_GOALS },
	smartGoals: [], // [{ id, text, weekKey, done }]
};

const TARGET_UNITS_VERSION = 2;
const LEGACY_DEFAULT_AEROBIC_DAYS = 5;
const LEGACY_DEFAULT_AEROBIC_MINUTES = 30;

const toNumber = (value, fallback = 0) => {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeTarget = (type, value) => {
	if (type === "aerobic") {
		return clamp(Math.round(toNumber(value) / 5) * 5, 0, 1260);
	}
	return clamp(Math.round(toNumber(value)), 0, 7);
};

const normalizeCurrentState = (state = {}) => {
	// Drop the legacy `minutes` object so each exercise type has one target only.
	const { minutes: _legacyMinutes, ...rest } = state || {};
	return {
		...DEFAULT_STATE,
		...rest,
		targetUnitsVersion: TARGET_UNITS_VERSION,
		targets: {
			aerobic: normalizeTarget("aerobic", state?.targets?.aerobic ?? DEFAULT_GOALS.aerobic),
			balance: normalizeTarget("balance", state?.targets?.balance ?? DEFAULT_GOALS.balance),
			muscle: normalizeTarget("muscle", state?.targets?.muscle ?? DEFAULT_GOALS.muscle),
		},
		smartGoals: Array.isArray(state?.smartGoals) ? state.smartGoals : [],
	};
};

const migrateLegacyState = (raw) => {
	const oldAerobicDays = clamp(
		Math.round(toNumber(raw?.targets?.aerobic, LEGACY_DEFAULT_AEROBIC_DAYS)),
		0,
		7
	);
	const oldAerobicMinutes = clamp(
		toNumber(raw?.minutes?.aerobic, LEGACY_DEFAULT_AEROBIC_MINUTES),
		0,
		180
	);
	return normalizeCurrentState({
		...raw,
		targets: {
			...raw?.targets,
			aerobic: oldAerobicDays * oldAerobicMinutes,
		},
	});
};

const readGoalState = async () => {
	const raw = await getUserJson(LEAF, null, LEGACY_KEY);
	if (!raw) return normalizeCurrentState(DEFAULT_STATE);

	const alreadyMigrated = raw.targetUnitsVersion === TARGET_UNITS_VERSION;
	// Be tolerant of an early weekly-minutes build that may have saved a value
	// above seven before the version marker was introduced.
	const looksLikeWeeklyMinutes = !raw.minutes && toNumber(raw?.targets?.aerobic) > 7;
	const state = alreadyMigrated || looksLikeWeeklyMinutes
		? normalizeCurrentState(raw)
		: migrateLegacyState(raw);

	if (!alreadyMigrated || raw.minutes) {
		await setUserJson(LEAF, state);
	}
	return state;
};

export const getGoalState = async () => {
	await mutationQueue;
	return readGoalState();
};

export const saveGoalState = async (state) => {
	const normalized = normalizeCurrentState(state);
	normalized.cloud = updateJournal(normalized.cloud, goalDocuments(normalized));
	await setUserJson(LEAF, normalized);
	notifyAccountData(getCurrentOwnerKey(), 'goals');
	return normalized;
};

export const setTarget = (type, target) => updateGoalState((state) => {
	if (!Object.prototype.hasOwnProperty.call(DEFAULT_GOALS, type)) return;
	state.targets[type] = normalizeTarget(type, target);
	if (state.cloudTargetKeys) state.cloudTargetKeys = [...new Set([...state.cloudTargetKeys, type])];
});

export const addSmartGoal = (goalInput) => updateGoalState((state) => {
	const isStructured = goalInput && typeof goalInput === "object" && !Array.isArray(goalInput);
	const structuredFields = isStructured
		? {
			what: String(goalInput.what ?? "").trim(),
			frequency: String(goalInput.frequency ?? "").trim(),
			duration: String(goalInput.duration ?? "").trim(),
		}
		: null;
	const text = structuredFields
		? [structuredFields.what, structuredFields.frequency, structuredFields.duration].filter(Boolean).join(" · ")
		: String(goalInput ?? "").trim();
	state.smartGoals.push({
		id: `${Date.now()}-${++goalSequence}-${newSyncOperation()}`,
		text,
		...(structuredFields || {}),
		weekKey: getWeekKey(),
		done: false,
	});
});

export const toggleSmartGoal = (id) => updateGoalState((state) => {
	const goal = state.smartGoals.find((g) => g.id === id);
	if (goal) goal.done = !goal.done;
});

export const updateSmartGoal = (id, goalInput) => updateGoalState((state) => {
	const goal = state.smartGoals.find((item) => item.id === id);
	if (!goal) throw new Error("Goal not found");
	if (goalInput && typeof goalInput === "object" && !Array.isArray(goalInput)) {
		const fields = {
			what: String(goalInput.what ?? "").trim(),
			frequency: String(goalInput.frequency ?? "").trim(),
			duration: String(goalInput.duration ?? "").trim(),
		};
		if (Object.values(fields).some((value) => !value)) throw new Error("Complete all goal fields");
		Object.assign(goal, fields, { text: Object.values(fields).join(" · ") });
	} else {
		const text = String(goalInput ?? "").trim();
		if (!text) throw new Error("Goal text is required");
		goal.text = text;
		delete goal.what;
		delete goal.frequency;
		delete goal.duration;
	}
	// The content is editable; identity, completion and week stay unchanged.
});

export const removeSmartGoal = (id) => updateGoalState((state) => {
	state.smartGoals = state.smartGoals.filter((g) => g.id !== id);
});

// Keep the same goals for the following week: re-tag last week's goals to this week
export const carryOverSmartGoals = () => updateGoalState((state) => {
	const thisWeek = getWeekKey();
	state.smartGoals = state.smartGoals.map((g) => (g.weekKey !== thisWeek ? { ...g, weekKey: thisWeek, done: false } : g));
});

export const getCurrentWeekSmartGoals = (state) => {
	const thisWeek = getWeekKey();
	return state.smartGoals.filter((g) => g.weekKey === thisWeek);
};

export const getPastWeekSmartGoals = (state) => {
	const thisWeek = getWeekKey();
	return state.smartGoals.filter((g) => g.weekKey !== thisWeek);
};

// Aerobic progress is total minutes this week. Balance and muscle progress are
// distinct exercise dates in the current week.
export const getWeeklyProgress = async (token) => {
	const [state, sessions] = await Promise.all([getGoalState(), getSessions(token)]);
	const thisWeek = getWeekKey();
	let aerobicSeconds = 0;
	const daysByType = { balance: new Set(), muscle: new Set() };
	sessions.forEach((s) => {
		const date = new Date(s.date);
		if (Number.isNaN(date.getTime()) || getWeekKey(date) !== thisWeek) return;
		if (s.types?.aerobic) {
			const durationSec = toNumber(s.durationSec);
			if (durationSec > 0) aerobicSeconds += durationSec;
		}
		const day = toDateKey(date);
		["balance", "muscle"].forEach((type) => {
			if (s.types && s.types[type]) daysByType[type].add(day);
		});
	});
	return {
		targets: state.targets,
		progress: {
			// Only completed whole minutes count toward a weekly target. Rounding
			// would mark 149m30s as a completed 150-minute goal prematurely.
			aerobic: Math.max(0, Math.floor(aerobicSeconds / 60)),
			balance: daysByType.balance.size,
			muscle: daysByType.muscle.size,
		},
	};
};

function goalDocuments(state) {
	return Object.fromEntries([
		...(state.cloudTargetKeys || Object.keys(state.targets)).map(type => [`target-${type}`, { target: state.targets[type] }]),
		...state.smartGoals.map(goal => [`smart-${goal.id}`, goal]),
	]);
}
function queuedGoals(work) {
	const operation = mutationQueue.then(work); mutationQueue = operation.catch(() => {}); return operation;
}
export async function synchronizeGoals({ owner, token, send, isCurrent }) {
	const valid = () => getCurrentOwnerKey() === owner && isCurrent();
	const outgoing = await queuedGoals(async () => {
		if (!valid()) return null;
		const raw = await getUserJson(LEAF, null, LEGACY_KEY), state = await readGoalState();
		if (!valid()) return null;
		if (!raw) state.cloudTargetKeys = [];
		const documents = goalDocuments(state);
		state.cloud = updateJournal(state.cloud, documents);
		const changes = journalBatch(state.cloud, documents, { retainUnacknowledged: true });
		await setUserJson(LEAF, state);
		return { collection: 'goals', cursor: state.cloud.cursor, changes };
	});
	if (!outgoing || !valid()) return;
	let result;
	try { result = await send(token, outgoing); }
	catch (error) {
		if (error?.status === 400 && error?.code === 'invalidAccountData') {
			await queuedGoals(async () => {
				if (!valid()) return;
				const state = await readGoalState(); if (!valid()) return;
				await setUserJson(LEAF, { ...state, cloud: releaseRejectedJournalBatch(state.cloud, outgoing.changes) });
			});
		}
		throw error;
	}
	let pending = false;
	await queuedGoals(async () => {
		if (!valid()) return;
		const state = await readGoalState(); if (!valid()) return;
		const merged = reconcileJournal(state.cloud, result, outgoing.changes, goalDocuments(state));
		const targets = { ...DEFAULT_GOALS }, smartGoals = [], keys = [];
		for (const [id, value] of Object.entries(merged.documents)) {
			if (id.startsWith('target-')) { const type = id.slice(7); targets[type] = value.target; keys.push(type); }
			else if (id.startsWith('smart-')) smartGoals.push({ ...value, id: id.slice(6) });
		}
		await setUserJson(LEAF, { ...state, targets, smartGoals, cloudTargetKeys: keys, cloud: merged.journal });
		pending = Object.keys(merged.journal.pending).length > 0;
		if (JSON.stringify(state.targets) !== JSON.stringify(targets) || JSON.stringify(state.smartGoals) !== JSON.stringify(smartGoals)) notifyAccountData(owner, 'goals', true);
	});
	return result.more || pending;
}
