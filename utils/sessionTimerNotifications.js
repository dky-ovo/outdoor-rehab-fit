import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { isSessionTimerNotificationAvailable, updateAsync, clearAsync, getStatusAsync, prepareNotificationChannelAsync } from "../modules/session-timer-notification";

export const SESSION_TIMER_NOTIFICATION_TYPE = "session-timer";
export const SESSION_TIMER_NOTIFICATION_ID = "outdoor-fit-session-timer";
export const SESSION_TIMER_NOTIFICATION_CHANNEL = "session-timer-status-v1";
const MAX_TIMER_SECONDS = 31536000;

function lockscreenFeedback(result) {
	return result?.lockscreenRestricted ? { lockscreenRestricted: true, lockscreenReason: result.lockscreenReason, channelId: result.channelId } : {};
}

function durationText(seconds) {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	const remainder = total % 60;
	return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function dateText(timestamp, language) {
	return new Date(timestamp).toLocaleString(language === "en" ? "en-HK" : "zh-HK", {
		month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
	});
}

/** The fallback is a clock reference, not a frozen number presented as a live timer. */
export function sessionTimerNotificationPlan({ session, ownerKey, locale = "zh" } = {}, now = Date.now()) {
	if (!ownerKey || !session?.started || !["countup", "countdown"].includes(session.recordMode)) return { status: "cleared" };
	// A completed pure timer retains its identity for notification taps, but is
	// neither a paused clock nor permission to resurrect a running native card.
	if (session.completed === true) return { status: session.countdownCompletedNaturally === true ? "expired" : "cleared" };
	const timerId = session.timerId || session.countdownId;
	const running = session.running === true;
	const accumulatedSeconds = Number(session.accumulatedSeconds || 0);
	const startedAt = running ? Number(session.startedAt) : null;
	const targetDurationSec = session.recordMode === "countdown" ? Number(session.targetDurationSec) : 0;
	if (typeof timerId !== "string" || !timerId.trim() || timerId.length > 200 ||
		!Number.isFinite(accumulatedSeconds) || accumulatedSeconds < 0 || accumulatedSeconds > MAX_TIMER_SECONDS ||
		(running && (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > Number.MAX_SAFE_INTEGER)) ||
		(session.recordMode === "countdown" && (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0 || targetDurationSec > MAX_TIMER_SECONDS))) return { status: "invalid" };
	const elapsed = accumulatedSeconds + (running ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0);
	if (session.recordMode === "countdown" && elapsed >= targetDurationSec) return { status: "expired" };
	const language = locale === "en" ? "en" : "zh";
	const countdown = session.recordMode === "countdown";
	const title = language === "en"
		? `${countdown ? "Countdown timer" : "Count-up timer"} · ${running ? "Running" : "Paused"}`
		: `${countdown ? "倒數計時器" : "正數計時器"} · ${running ? "計時中" : "已暫停"}`;
	let body;
	if (!running) {
		const time = durationText(countdown ? targetDurationSec - accumulatedSeconds : accumulatedSeconds);
		body = language === "en" ? `${countdown ? "Remaining" : "Elapsed"}: ${time}\nTap to return to the timer.`
			: `${countdown ? "剩餘" : "已計時"}：${time}\n點按返回計時器。`;
	} else if (countdown) {
		const end = dateText(startedAt + (targetDurationSec - accumulatedSeconds) * 1000, language);
		body = language === "en" ? `Ends at: ${end}\nTap to return to the timer.` : `預計結束：${end}\n點按返回計時器。`;
	} else {
		const start = dateText(startedAt, language);
		const previous = durationText(accumulatedSeconds);
		body = language === "en" ? `Current run started: ${start}\nPreviously elapsed: ${previous}. Tap to return.`
			: `本段開始：${start}\n開始前已累計：${previous}。點按返回計時器。`;
	}
	const payload = { timerId, recordMode: session.recordMode, running, startedAt: startedAt || 0, accumulatedSeconds, targetDurationSec, title, body,
		locale: language,
		modeLabel: language === "en" ? (countdown ? "Countdown timer" : "Count-up timer") : (countdown ? "倒數計時器" : "正數計時器"),
		statusLabel: language === "en" ? (running ? "Running" : "Paused") : (running ? "計時中" : "已暫停"),
		timeLabel: language === "en" ? (countdown ? "Remaining" : "Elapsed") : (countdown ? "剩餘時間" : "已計時間"),
		openLabel: language === "en" ? "Tap to open timer" : "點按返回計時器",
		finishedLabel: language === "en" ? "Finished" : "計時結束",
		url: `myapp://timer-notification?timerId=${encodeURIComponent(timerId)}&recordMode=${session.recordMode}` };
	return { status: "ready", language, payload, key: JSON.stringify([ownerKey, language, timerId, session.recordMode, running, startedAt, accumulatedSeconds, targetDurationSec]) };
}

function permissionsAllowed(permission) {
	if (Platform.OS === "ios" && permission?.ios?.status != null) {
		return [Notifications.IosAuthorizationStatus.AUTHORIZED, Notifications.IosAuthorizationStatus.PROVISIONAL,
			Notifications.IosAuthorizationStatus.EPHEMERAL].includes(permission.ios.status);
	}
	return permission?.granted === true || permission?.status === "granted";
}

/** One native system-clock card or one silent compatibility notification, never per-second JS pushes. */
export function createSessionTimerNotificationManager() {
	let generation = 0;
	let queue = Promise.resolve();
	let pendingKey = null;
	let pendingPromise = null;
	let displayedKey = null;
	let displayedMode = null;

	async function clearFallback() {
		// A scheduled ID and an already-delivered ID are separate stores on iOS.
		const results = await Promise.allSettled([
			Notifications.cancelScheduledNotificationAsync(SESSION_TIMER_NOTIFICATION_ID),
			Notifications.dismissNotificationAsync(SESSION_TIMER_NOTIFICATION_ID),
		]);
		return results.every((item) => item.status === "fulfilled");
	}

	async function clearNative() {
		if (!["android", "ios"].includes(Platform.OS) || !isSessionTimerNotificationAvailable()) return true;
		try {
			const result = await clearAsync();
			return ["cleared", "unavailable"].includes(result?.status);
		} catch { return false; }
	}

	async function clearAllOwned() {
		displayedKey = null; displayedMode = null;
		const results = await Promise.all([clearFallback(), clearNative()]);
		return { status: results.every(Boolean) ? "cleared" : "failed" };
	}

	async function hasFallback() {
		try {
			return (await Notifications.getPresentedNotificationsAsync()).some((item) =>
				item?.request?.identifier === SESSION_TIMER_NOTIFICATION_ID && item.request.content?.data?.type === SESSION_TIMER_NOTIFICATION_TYPE);
		} catch {
			// Do not repeatedly republish just because the OS cannot enumerate its tray.
			return displayedMode === "fallback";
		}
	}

	async function reconcile(input, request) {
		if (Platform.OS === "web") return { status: "unsupported" };
		const current = () => request === generation;
		if (!current()) return { status: "cancelled" };
		let plan = sessionTimerNotificationPlan(input);
		if (plan.status !== "ready") {
			const cleared = await clearAllOwned();
			return { status: cleared.status === "failed" ? "failed" : plan.status };
		}
		const native = ["android", "ios"].includes(Platform.OS) && isSessionTimerNotificationAvailable();
		async function showNative() {
			if (!current()) return { status: "cancelled" };
			const result = await updateAsync({ ...plan.payload,
				restoreDismissed: input.requestPermission === true,
				channelName: plan.language === "en" ? "Current exercise timer" : "目前運動計時器",
				body: plan.payload.running && plan.payload.recordMode === "countdown" ? plan.payload.body
					: plan.language === "en" ? "Tap to return to the timer." : "點按返回計時器。",
			});
			if (!current()) {
				await clearAllOwned();
				return { status: "cancelled" };
			}
			if (result?.status === "updated") {
				// Only retire the static fallback after a live card was actually
				// created. Disabled/unsupported activities must not churn that row.
				if (!await clearFallback()) {
					await clearNative();
					displayedKey = null; displayedMode = null;
					return { status: "failed" };
				}
				if (!current()) { await clearAllOwned(); return { status: "cancelled" }; }
				displayedKey = plan.key; displayedMode = "native";
				return { status: "updated", mode: "native", ...lockscreenFeedback(result), ...(result.unchanged ? { unchanged: true } : {}) };
			}
			if (result?.status === "unavailable" || Platform.OS === "ios" && result?.status === "denied") return null;
			if (Platform.OS === "android" && result?.status === "suppressed") return { status: "suppressed" };
			displayedKey = null; displayedMode = null;
			// Respect a dismissed Live Activity; a background request waits until
			// foreground. Neither case should create an extra static notification.
			if (Platform.OS === "ios" && ["suppressed", "deferred"].includes(result?.status)) {
				if (!await clearFallback()) return { status: "failed" };
				return current() ? { status: result.status } : { status: "cancelled" };
			}
			return { status: ["cleared", "expired", "denied", "invalid"].includes(result?.status) ? result.status : "failed" };
		}
		// ActivityKit permission is independent of normal notification permission.
		// Always revalidate iOS activities on structural/AppState syncs: a cached
		// JS key cannot tell whether the user dismissed or disabled the activity.
		if (native && Platform.OS === "ios") {
			const result = await showNative();
			if (result) return result;
		}
		let nativeChannelPrepared = false;
		if (Platform.OS === "android" && native && typeof prepareNotificationChannelAsync === "function") {
			// Native code owns versioned channel migration and preserves user choices.
			const prepared = await prepareNotificationChannelAsync(plan.language === "en" ? "Current exercise timer" : "目前運動計時器");
			nativeChannelPrepared = prepared?.status !== "unavailable";
		}
		if (Platform.OS === "android" && !nativeChannelPrepared) {
			await Notifications.setNotificationChannelAsync(SESSION_TIMER_NOTIFICATION_CHANNEL, {
				name: plan.language === "en" ? "Current exercise timer" : "目前運動計時器",
				importance: Notifications.AndroidImportance.LOW, sound: null, enableVibrate: false,
				showBadge: false, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
			});
		}
		if (!current()) return { status: "cancelled" };
		let permission = await Notifications.getPermissionsAsync();
		if (!permissionsAllowed(permission) && input.requestPermission && permission?.canAskAgain !== false && current()) {
			// Permission belongs to the app, not this silent status row. Keep sound
			// available for the separate countdown-completion reminders.
			permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
		}
		if (!current()) return { status: "cancelled" };
		if (!permissionsAllowed(permission)) {
			await clearAllOwned();
			return { status: "denied" };
		}
		// Permissions may have stayed open until a short countdown finished.
		plan = sessionTimerNotificationPlan(input);
		if (plan.status !== "ready") {
			const cleared = await clearAllOwned();
			return { status: cleared.status === "failed" ? "failed" : plan.status };
		}
		if (displayedKey === plan.key && native && Platform.OS === "android" && displayedMode === "native") {
			const presence = await getStatusAsync();
			if (!current()) return { status: "cancelled" };
			if (presence?.status === "suppressed" || presence?.status === "missing" && presence.recoverableMissing !== true) return { status: "suppressed" };
			if (presence?.status === "missing") {
				// Runtime 1.1.4 distinguishes an explicit swipe from a missing row.
				// Repair only on structural/AppState sync, never in a per-tick loop.
				const repaired = await showNative();
				return repaired || { status: "failed" };
			}
			if (presence?.status === "denied") { await clearAllOwned(); return { status: "denied" }; }
			if (!["visible", "unavailable"].includes(presence?.status)) return { status: "failed" };
			return { status: "updated", mode: "native", ...lockscreenFeedback(presence), unchanged: true };
		}
		if (displayedKey === plan.key && displayedMode === "fallback" && await hasFallback()) {
			return current() ? { status: "updated", mode: displayedMode, unchanged: true } : { status: "cancelled" };
		}
		if (!current()) return { status: "cancelled" };
		if (native && Platform.OS === "android") {
			const result = await showNative();
			if (result) return result;
		}
		// Old binaries / unsupported or disabled Live Activities: one static row.
		if (!await clearNative() || !await clearFallback()) return { status: "failed" };
		if (!current()) return { status: "cancelled" };
		plan = sessionTimerNotificationPlan(input);
		if (plan.status !== "ready") return { status: plan.status };
		await Notifications.scheduleNotificationAsync({
			identifier: SESSION_TIMER_NOTIFICATION_ID,
			content: { title: plan.payload.title, body: plan.payload.body, sound: false,
				priority: Notifications.AndroidNotificationPriority.LOW, autoDismiss: false, sticky: true,
				data: { type: SESSION_TIMER_NOTIFICATION_TYPE, timerId: plan.payload.timerId, recordMode: plan.payload.recordMode },
			},
			trigger: Platform.OS === "android" ? { channelId: SESSION_TIMER_NOTIFICATION_CHANNEL } : null,
		});
		if (!current()) {
			await clearAllOwned();
			return { status: "cancelled" };
		}
		displayedKey = plan.key; displayedMode = "fallback";
		return { status: "updated", mode: "fallback" };
	}

	function enqueue(operation) {
		const result = queue.then(operation).catch(() => ({ status: "failed" }));
		queue = result;
		return result;
	}

	return {
		sync(input = {}) {
			const snapshot = { ...input, session: input.session ? { ...input.session } : null };
			const key = JSON.stringify([sessionTimerNotificationPlan(snapshot).key || null, input.requestPermission === true]);
			if (pendingPromise && pendingKey === key) return pendingPromise;
			const request = ++generation;
			const promise = enqueue(() => reconcile(snapshot, request));
			pendingKey = key; pendingPromise = promise;
			promise.finally(() => { if (pendingPromise === promise) { pendingKey = null; pendingPromise = null; } });
			return promise;
		},
		clear() {
			generation += 1; pendingKey = null; pendingPromise = null;
			if (Platform.OS === "web") return Promise.resolve({ status: "unsupported" });
			return enqueue(clearAllOwned);
		},
	};
}
