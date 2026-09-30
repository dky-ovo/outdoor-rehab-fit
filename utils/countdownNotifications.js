import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import { COUNTDOWN_CUE_MAX_LATENESS_MS, isCountdownCueFresh } from "./countdownCueTiming";
import { isNativeCountdownReminderAvailable, scheduleCountdownRemindersAsync, clearCountdownRemindersAsync } from "../modules/session-timer-notification";
import { TIMER_AUDIO_SOUNDS } from "./countdownAudioAssets";

export const COUNTDOWN_NOTIFICATION_TYPE = "countdown";
export const COUNTDOWN_NOTIFICATION_CHANNEL = "countdown-reminders-v1";
export const COUNTDOWN_NOTIFICATION_STORAGE_KEY = "@outdoor_fit_countdown_notifications_v1";
const IDENTIFIER_PREFIX = "outdoor-fit-countdown-";

export const COUNTDOWN_NOTIFICATION_SOUNDS = TIMER_AUDIO_SOUNDS;

export function countdownNotificationSoundsForRuntime(runtimeVersion) {
	// This is the installed native runtime, not an OTA manifest's app version.
	// Build 16 (1.1.2), Expo Go and unknown runtimes do not contain these resources.
	if (typeof runtimeVersion !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(runtimeVersion)) return {};
	const [major, minor, patch] = runtimeVersion.split(".").map(Number);
	if (![major, minor, patch].every(Number.isSafeInteger)) return {};
	if (major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 6)))) return COUNTDOWN_NOTIFICATION_SOUNDS;
	// Build 7/8/9 have English recordings but no Cantonese raw resources.
	return major === 1 && minor === 1 && patch >= 3 ? { en: COUNTDOWN_NOTIFICATION_SOUNDS.en } : {};
}

const messages = {
	zh: { title: "倒數計時提醒", halfway: "倒數計時已過一半。", complete: "倒數計時已結束。" },
	en: { title: "Countdown reminder", halfway: "The countdown is halfway complete.", complete: "The countdown has finished." },
};

/** Absolute times are based on the timer's clock, never the time permission dialogs close. */
export function countdownNotificationPlan({ session, ownerKey, locale = "zh", exactAlarmsAllowed = null } = {}, now = Date.now()) {
	const target = Number(session?.targetDurationSec);
	const startedAt = Number(session?.startedAt);
	const accumulated = Number(session?.accumulatedSeconds || 0);
	if (!ownerKey || session?.recordMode !== "countdown" || !session.started || !session.running || session.completed ||
		!Number.isFinite(target) || target <= 0 || !Number.isFinite(startedAt) || startedAt <= 0 ||
		!Number.isFinite(accumulated) || accumulated < 0) return null;
	const language = locale === "en" ? "en" : "zh";
	const timerId = typeof session.countdownId === "string" ? session.countdownId : null;
	const deadlineAt = startedAt + (target - accumulated) * 1000;
	const halfwayAt = startedAt + (target / 2 - accumulated) * 1000;
	// A newly granted exact-alarm permission must replace requests previously
	// registered as inexact alarms, even though their deadlines did not change.
	const key = JSON.stringify([ownerKey, timerId, startedAt, accumulated, target, language, exactAlarmsAllowed]);
	const milestones = [];
	if (!session.countdownHalfwayAnnounced && halfwayAt > now) milestones.push({ phase: "halfway", at: halfwayAt });
	if (deadlineAt > now) milestones.push({ phase: "complete", at: deadlineAt });
	return { key, ownerKey, timerId, language, startedAt, deadlineAt, milestones };
}

function managedRequest(request) {
	return typeof request?.identifier === "string" && request.identifier.startsWith(IDENTIFIER_PREFIX) &&
		request.content?.data?.type === COUNTDOWN_NOTIFICATION_TYPE;
}

function permissionsAllowed(permission) {
	if (Platform.OS === "ios" && permission?.ios?.status != null) {
		return [Notifications.IosAuthorizationStatus.AUTHORIZED, Notifications.IosAuthorizationStatus.PROVISIONAL,
			Notifications.IosAuthorizationStatus.EPHEMERAL].includes(permission.ios.status);
	}
	return permission?.granted === true || permission?.status === "granted";
}

/**
 * One provider owns this scheduler. It only touches its own local notification IDs.
 * OS scheduling survives suspended JavaScript; default notification sound is NOT TTS.
 * Custom speech files, if supplied, must already exist in the installed native build.
 */
export function createCountdownNotificationScheduler({ sounds = countdownNotificationSoundsForRuntime(Updates.runtimeVersion) } = {}) {
	let generation = 0;
	let sequence = 0;
	let queue = Promise.resolve();
	let pendingSignature = null;
	let pendingPromise = null;
	let record = null;
	let loaded = false;

	async function load() {
		if (loaded) return;
		try {
			const value = JSON.parse(await AsyncStorage.getItem(COUNTDOWN_NOTIFICATION_STORAGE_KEY));
			if (value?.version === 1 && Array.isArray(value.scheduled)) {
				record = { ...value, scheduled: value.scheduled.filter((item) => typeof item?.id === "string" && item.id.startsWith(IDENTIFIER_PREFIX) && Number.isFinite(item.at)) };
			}
		} catch { /* Native request enumeration can still find an interrupted/legacy schedule. */ }
		loaded = true;
	}

	async function persist() {
		if (record?.scheduled?.length) await AsyncStorage.setItem(COUNTDOWN_NOTIFICATION_STORAGE_KEY, JSON.stringify(record));
		else await AsyncStorage.removeItem(COUNTDOWN_NOTIFICATION_STORAGE_KEY);
	}

	async function enumerate() {
		try { return (await Notifications.getAllScheduledNotificationsAsync()).filter(managedRequest); }
		catch { return []; }
	}

	async function remove(ids) {
		const failed = [];
		for (const id of new Set(ids)) {
			try { await Notifications.cancelScheduledNotificationAsync(id); } catch { failed.push(id); }
		}
		return failed;
	}

	async function clear(preserveDue = false, expiredOnly = false, legacyOnly = false) {
		const nativeResult = !legacyOnly && isNativeCountdownReminderAvailable()
			? await clearCountdownRemindersAsync({ preserveDue, expiredOnly }) : null;
		await load();
		const native = await enumerate();
		const known = new Map((record?.scheduled || []).map((item) => [item.id, item]));
		for (const request of native) {
			if (!known.has(request.identifier)) known.set(request.identifier, {
				id: request.identifier, phase: request.content.data.phase,
				at: Number(request.content.data.notificationAt || request.content.data.deadlineAt),
			});
		}
		const now = Date.now();
		const removable = [...known.values()].filter((item) => expiredOnly
			? Number.isFinite(item.at) && now - item.at > COUNTDOWN_CUE_MAX_LATENESS_MS
			: !preserveDue || !isCountdownCueFresh(item.at, now));
		const failed = await remove(removable.map((item) => item.id));
		const retained = [...known.values()].filter((item) => !removable.includes(item) || failed.includes(item.id));
		record = { version: 1, key: record?.key || null, scheduled: retained };
		await persist();
		return { status: failed.length || nativeResult?.status === "failed" ? "failed" : "inactive", ids: retained.map((item) => item.id), scheduled: retained };
	}

	async function ensureChannel(language, sound, phase) {
		if (Platform.OS !== "android") return undefined;
		// Android 8+ channels retain their original sound; give each bundled voice its own channel.
		const channelId = sound === "default" ? COUNTDOWN_NOTIFICATION_CHANNEL : `${COUNTDOWN_NOTIFICATION_CHANNEL}-${language}-${phase}-${sound.replace(/[^a-z0-9]/gi, "-")}`;
		// Read before writing so user settings are never replaced by app defaults.
		// Older environments without channel lookup can still schedule notifications.
		const existing = await Notifications.getNotificationChannelAsync?.(channelId);
		if (existing) return { channelId, channel: existing };
		const channel = await Notifications.setNotificationChannelAsync(channelId, {
			name: language === "en" ? "Countdown reminders" : "倒數計時提醒",
			importance: Notifications.AndroidImportance.HIGH,
			sound,
			enableVibrate: true,
			vibrationPattern: [0, 300, 150, 300],
			showBadge: false,
			lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
		});
		return { channelId, channel };
	}

	function preserveLegacyPreferences(channel) {
		return channel && ((Number.isFinite(channel.importance) && channel.importance < Notifications.AndroidImportance.HIGH)
			|| (channel.sound !== undefined && channel.sound !== "default")
			|| channel.enableVibrate === false
			// Android's NO_OVERRIDE (-1000) is the system default, not a privacy choice.
			|| [Notifications.AndroidNotificationVisibility.PRIVATE ?? 0,
				Notifications.AndroidNotificationVisibility.SECRET ?? -1].includes(channel.lockscreenVisibility));
	}

	function channelIsAudible(channel) {
		return !channel || (channel.sound !== null && (!Number.isFinite(channel.importance)
			|| channel.importance >= (Notifications.AndroidImportance.DEFAULT ?? 3)));
	}

	async function reconcile(input, request) {
		if (Platform.OS === "web") return { status: "unsupported", ids: [], scheduled: [] };
		const current = () => generation === request;
		await load();
		if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
		let plan = countdownNotificationPlan(input);
		if (!plan) return clear(input.preserveDue === true);
		// A valid clock can expire while permission/native calls await. Completion is
		// natural, not abandonment: do not race the OS by cancelling its due alert.
		if (!plan.milestones.length) return clear(true);

		// Android 13 needs a channel before the first notification permission prompt.
		const legacyChannel = await ensureChannel(plan.language, "default", "complete");
		if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
		let permission = await Notifications.getPermissionsAsync();
		const provisional = Platform.OS === "ios" && permission?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
		if ((!permissionsAllowed(permission) || provisional) && input.requestPermission && permission?.canAskAgain !== false && current()) {
			permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
		}
		if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
		if (!permissionsAllowed(permission)) {
			await clear();
			return { status: "denied", ids: [], scheduled: [] };
		}
		plan = countdownNotificationPlan(input);
		if (!plan?.milestones.length) return clear(true);
		const delivery = {};
		for (const phase of ["halfway", "complete"]) {
			const preserveLegacy = Platform.OS === "android" && preserveLegacyPreferences(legacyChannel?.channel);
			const sound = preserveLegacy ? "default" : sounds[plan.language]?.[phase] || "default";
			const selected = sound === "default" ? legacyChannel : await ensureChannel(plan.language, sound, phase);
			if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
			const soundEnabled = channelIsAudible(selected?.channel);
			delivery[phase] = { channelId: selected?.channelId, sound: soundEnabled ? sound : false, soundEnabled };
		}
		// Changing the installed voice resources must replace an older default-sound schedule.
		// The selected channel also changes when a user silences the legacy channel.
		plan.key = JSON.stringify([plan.key, delivery]);
		if (isNativeCountdownReminderAvailable()) {
			// Retire old Expo alarms before changing owner. The Android receiver uses
			// persistent identity + absolute deadlines and never asks suspended JS
			// to present an alert. AlarmClock alarms avoid Doze's nine-minute quota.
			const legacy = await clear(false, false, true);
			if (legacy.status === "failed") return legacy;
			if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
			const result = await scheduleCountdownRemindersAsync({
				timerId: plan.timerId, key: plan.key, deadlineAt: plan.deadlineAt,
				halfwayAt: plan.milestones.find((item) => item.phase === "halfway")?.at || 0,
				locale: plan.language, title: messages[plan.language].title,
				halfwayBody: messages[plan.language].halfway, completeBody: messages[plan.language].complete,
				halfwayChannel: delivery.halfway.channelId, completeChannel: delivery.complete.channelId,
				halfwaySound: delivery.halfway.sound || "", completeSound: delivery.complete.sound || "",
			});
			if (!current()) {
				await clearCountdownRemindersAsync();
				return { status: "cancelled", ids: [], scheduled: [] };
			}
			return { ...result, mode: "native-alarm", soundEnabled: Object.values(delivery).every((item) => item.soundEnabled),
				ids: [], scheduled: result.status === "scheduled" ? plan.milestones : [] };
		}
		const native = await enumerate();
		if (!current()) return { status: "cancelled", ids: [], scheduled: [] };
		const retained = record?.key === plan.key ? record.scheduled.filter((item) =>
			plan.milestones.some((milestone) => milestone.phase === item.phase && milestone.at === item.at) &&
			native.some((itemNative) => itemNative.identifier === item.id)) : [];
		const obsolete = [...(record?.scheduled || []).map((item) => item.id), ...native.map((item) => item.identifier)]
			.filter((id) => !retained.some((item) => item.id === id));
		const failed = await remove(obsolete);
		if (failed.length) throw new Error("Unable to cancel the previous countdown reminders");
		record = { version: 1, key: plan.key, ownerKey: plan.ownerKey, scheduled: retained };
		await persist();
		if (!current()) return { status: "cancelled", ids: retained.map((item) => item.id), scheduled: retained };

		for (const milestone of plan.milestones) {
			if (record.scheduled.some((item) => item.phase === milestone.phase) || milestone.at <= Date.now()) continue;
			const { sound, channelId } = delivery[milestone.phase];
			const id = `${IDENTIFIER_PREFIX}${Date.now()}-${++sequence}-${milestone.phase}`;
			const item = { id, ...milestone };
			// Save the explicit ID BEFORE scheduling so termination cannot orphan an alarm.
			record.scheduled.push(item);
			await persist();
			if (!current()) break;
			await Notifications.scheduleNotificationAsync({
				identifier: id,
				content: {
					title: messages[plan.language].title,
					body: messages[plan.language][milestone.phase],
					sound,
					data: { type: COUNTDOWN_NOTIFICATION_TYPE, phase: milestone.phase, timerId: plan.timerId,
						sessionStartedAt: plan.startedAt, deadlineAt: plan.deadlineAt, notificationAt: milestone.at },
				},
				trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(milestone.at), ...(channelId ? { channelId } : {}) },
			});
		}
		if (!current()) {
			await clear();
			return { status: "cancelled", ids: [], scheduled: [] };
		}
		const soundEnabled = Platform.OS === "android" ? Object.values(delivery).every((item) => item.soundEnabled)
			: Platform.OS !== "ios" || (permission?.ios?.allowsSound !== false
				&& permission?.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL);
		return { status: "scheduled", soundEnabled, ids: record.scheduled.map((item) => item.id), scheduled: [...record.scheduled] };
	}

	function enqueue(operation) {
		const result = queue.then(operation).catch(() => ({ status: "failed", ids: record?.scheduled?.map((item) => item.id) || [], scheduled: record?.scheduled || [] }));
		queue = result;
		return result;
	}

	return {
		// Run when returning to the foreground, even if the active timer plan did not change.
		pruneExpired() {
			if (Platform.OS === "web") return Promise.resolve({ status: "unsupported", ids: [], scheduled: [] });
			return enqueue(() => clear(false, true));
		},
		sync(input = {}) {
			const signature = JSON.stringify(input);
			if (pendingPromise && signature === pendingSignature) return pendingPromise;
			const request = ++generation;
			pendingSignature = signature;
			const promise = enqueue(() => reconcile(input, request));
			pendingPromise = promise;
			promise.finally(() => { if (pendingPromise === promise) { pendingPromise = null; pendingSignature = null; } });
			return promise;
		},
		cancel({ preserveDue = false } = {}) {
			generation += 1;
			pendingSignature = null;
			pendingPromise = null;
			if (Platform.OS === "web") return Promise.resolve({ status: "unsupported", ids: [], scheduled: [] });
			return enqueue(() => clear(preserveDue));
		},
	};
}
