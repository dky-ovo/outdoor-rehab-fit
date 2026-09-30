import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { AuthContext } from "./AuthContext";
import { LocaleContext } from "./LocaleContext";
import { createCountdownSpeaker } from "../utils/countdownSpeech";
import { createCountdownNotificationScheduler } from "../utils/countdownNotifications";
import { createSessionTimerNotificationManager } from "../utils/sessionTimerNotifications";
import { createAndroidTimerAudioManager } from "../utils/androidTimerAudio";
import { isTimerAudioServiceAvailable, checkReminderSettingsAsync } from "../modules/session-timer-notification";

const ACTIVE_SESSION_KEY = "@outdoor_fit_active_session_v1";
const ACTIVE_SESSION_STORAGE_VERSION = 2;
const FOREGROUND_CUE_GRACE_MS = 2000;

const normalizeRecordMode = (value) => value === "countdown" ? "countdown" : value === "manual" ? "manual" : "countup";

const EMPTY_SESSION = {
	mode: null,
	recordMode: "countup",
	targetDurationSec: 0,
	started: false,
	running: false,
	accumulatedSeconds: 0,
	startedAt: null,
	countdownHalfwayAnnounced: false,
	countdownId: null,
	timerId: null,
	completed: false,
	completedAt: null,
	countdownCompletedNaturally: false,
	countdownCompletionVoicePending: false,
};

const newCountdownId = () => `countdown-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const newTimerId = () => `timer-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const ActiveSessionContext = createContext(null);

export function activeSessionOwnerKey(user) {
	if (!user) return null;
	if (user.id) return `user:${String(user.id)}`;
	if (user.isGuest || user.role === "guest") {
		const guestIdentity = user.guestProfile?.serverId || user.loginAt;
		return guestIdentity ? `guest:${String(guestIdentity)}` : null;
	}
	return null;
}

function calculateElapsedSeconds(session, now = Date.now()) {
	const runningSeconds =
		session.running && session.startedAt
			? Math.max(0, Math.floor((now - session.startedAt) / 1000))
			: 0;
	return Math.max(0, Number(session.accumulatedSeconds || 0) + runningSeconds);
}

function createSummary(session, durationSec, editableTiming = false) {
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
		durationSec: Math.max(0, Number(durationSec) || 0),
		mode: session.mode === "home" ? "home" : "outdoor",
		recordMode: normalizeRecordMode(session.recordMode),
		editableTiming,
		completedAt: new Date().toISOString(),
		timerId: session.timerId || session.countdownId || null,
		...(session.recordMode === "countdown" ? { countdownId: session.countdownId } : {}),
	};
}

export function ActiveSessionProvider({ children }) {
	const { user, isLoading: authLoading } = React.useContext(AuthContext) || {};
	const { locale = "zh" } = React.useContext(LocaleContext) || {};
	const ownerKey = useMemo(() => activeSessionOwnerKey(user), [user]);
	const [session, setSession] = useState(EMPTY_SESSION);
	const [pendingSummary, setPendingSummary] = useState(null);
	const [pendingSummaryDraft, setPendingSummaryDraft] = useState(null);
	const pendingSummaryRef = useRef(null);
	const [now, setNow] = useState(Date.now());
	const [hydratedOwnerKey, setHydratedOwnerKey] = useState(undefined);
	const hydrated = !authLoading && hydratedOwnerKey === ownerKey;
	const [appState, setAppState] = useState(AppState.currentState || "active");
	const appStateRef = useRef(AppState.currentState || "active");
	// Only speak milestones reached during this uninterrupted foreground visit.
	// Background delivery belongs to the OS, never a TTS queue replayed on unlock.
	const foregroundSinceRef = useRef(appStateRef.current === "active" ? Date.now() : Infinity);
	const speakerRef = useRef(null);
	if (!speakerRef.current) speakerRef.current = createCountdownSpeaker();
	const notificationSchedulerRef = useRef(null);
	if (!notificationSchedulerRef.current) notificationSchedulerRef.current = createCountdownNotificationScheduler();
	const timerNotificationRef = useRef(null);
	if (!timerNotificationRef.current) timerNotificationRef.current = createSessionTimerNotificationManager();
	const nativeAudioRef = useRef(null);
	const [nativeAudioOwned, setNativeAudioOwned] = useState(null);
	const nativeAudioClockRef = useRef(null);
	const nativeCompletedClaimRef = useRef(null);
	if (!nativeAudioRef.current && isTimerAudioServiceAvailable?.()) {
		nativeAudioRef.current = createAndroidTimerAudioManager({ retireLegacy: async () => {
			const reminders = await notificationSchedulerRef.current.cancel();
			const status = await timerNotificationRef.current.clear();
			if (reminders?.status === "failed" || status?.status === "failed") throw new Error("Unable to retire previous timer delivery");
		} });
	}
	const clearTimerDelivery = useCallback(() => {
		if (nativeAudioRef.current) return nativeAudioRef.current.clear();
		void notificationSchedulerRef.current.cancel();
		return timerNotificationRef.current.clear();
	}, []);
	const lastNotificationPlanRef = useRef(null);
	const serviceStartIntentRef = useRef(false);
	const notificationOwnerRef = useRef(undefined);
	const voiceGeneration = useRef(0);
	const voiceRequestRef = useRef(null);
	const latestState = useRef(null);
	latestState.current = { ownerKey, hydrated, session };
	const cancelCountdownSpeech = useCallback(() => {
		voiceGeneration.current += 1;
		voiceRequestRef.current = null;
		speakerRef.current.cancel();
	}, []);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active" && appStateRef.current !== "active") foregroundSinceRef.current = Date.now();
			if (state !== "active") foregroundSinceRef.current = Infinity;
			appStateRef.current = state;
			setAppState(state);
			if (state === "active") {
				// Retry a denied/failed plan after a settings visit, but preserve
				// successful OS alarms instead of rescheduling them on every unlock.
				if (lastNotificationPlanRef.current?.retryOnForeground) lastNotificationPlanRef.current = null;
				setNow(Date.now());
				// Cancel late inexact alarms before they can replay on unlock.
				if (!nativeAudioRef.current) void notificationSchedulerRef.current.pruneExpired?.();
			}
			else {
				cancelCountdownSpeech();
				setSession((current) => current.countdownCompletionVoicePending
					? { ...current, countdownCompletionVoicePending: false } : current);
			}
		});
		return () => {
			subscription.remove();
			cancelCountdownSpeech();
		};
	}, [cancelCountdownSpeech]);

	useEffect(() => {
		// If voice discovery is still pending, prepare the cue again in the newly
		// selected UI language. Already-consumed milestones remain consumed.
		cancelCountdownSpeech();
	}, [cancelCountdownSpeech, locale]);

	useEffect(() => {
		cancelCountdownSpeech();
		if (notificationOwnerRef.current !== undefined && notificationOwnerRef.current !== ownerKey) {
			serviceStartIntentRef.current = false;
			void clearTimerDelivery();
			lastNotificationPlanRef.current = null;
		}
		if (authLoading) return undefined;
		let mounted = true;
		setHydratedOwnerKey(undefined);
		setSession(EMPTY_SESSION);
		pendingSummaryRef.current = null;
		setPendingSummary(null);
		setPendingSummaryDraft(null);
		setNow(Date.now());

		const restore = async () => {
			if (!ownerKey) {
				await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
				return;
			}
			const stored = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
			if (!mounted || !stored) return;
			const parsed = JSON.parse(stored);
			if (parsed?.version !== ACTIVE_SESSION_STORAGE_VERSION || parsed?.ownerKey !== ownerKey) {
				await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
				return;
			}
			const storedSession = parsed.session;
			if (storedSession?.mode) {
					const restoredTimerId = storedSession.timerId || storedSession.countdownId || newTimerId();
					setSession({
						...EMPTY_SESSION,
						...storedSession,
						// Completion is a clock state, not an exercise-record draft. Never
						// replay a persisted voice request when the process restarts.
						completed: storedSession.recordMode === "countdown" && storedSession.completed === true,
						running: storedSession.completed === true ? false : storedSession.running === true,
						countdownCompletionVoicePending: false,
						recordMode: normalizeRecordMode(storedSession.recordMode),
						targetDurationSec: Math.max(0, Number(storedSession.targetDurationSec) || 0),
						countdownHalfwayAnnounced: storedSession.countdownHalfwayAnnounced === true
							|| calculateElapsedSeconds(storedSession) >= Number(storedSession.targetDurationSec) / 2,
						countdownId: storedSession.recordMode === "countdown" ? storedSession.countdownId || restoredTimerId : null,
						timerId: restoredTimerId,
					});
				}
			const restoredSummary = parsed.pendingSummary ? { ...parsed.pendingSummary,
				...(parsed.pendingSummary.countdownCompletionVoicePending !== undefined ? { countdownCompletionVoicePending: false } : {}) } : null;
			if (restoredSummary?.id && ["home", "outdoor"].includes(restoredSummary.mode)) {
				pendingSummaryRef.current = restoredSummary;
				setPendingSummary(restoredSummary);
				if (parsed.pendingSummaryDraft?.summaryId === restoredSummary.id) {
					setPendingSummaryDraft(parsed.pendingSummaryDraft);
				}
			}
		};

		restore()
			.catch((error) => console.warn("Unable to restore active session", error))
			.finally(() => mounted && setHydratedOwnerKey(ownerKey));

		return () => {
			mounted = false;
		};
	}, [authLoading, cancelCountdownSpeech, clearTimerDelivery, ownerKey]);

	useEffect(() => {
		if (!hydrated) return;
		if (!ownerKey || (!session.mode && !session.started && !pendingSummary)) {
			AsyncStorage.removeItem(ACTIVE_SESSION_KEY).catch(() => {});
			return;
		}
		const payload = {
			version: ACTIVE_SESSION_STORAGE_VERSION,
			ownerKey,
			session,
			pendingSummary,
			pendingSummaryDraft: pendingSummary ? pendingSummaryDraft : null,
		};
		AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload)).catch((error) =>
			console.warn("Unable to store active session", error),
		);
	}, [hydrated, ownerKey, pendingSummary, pendingSummaryDraft, session]);

	useEffect(() => {
		// Keep already-scheduled OS reminders across process suspension/restarts.
		// Hydration must resolve the account before any stale reminder is removed.
		if (!hydrated) return;
		const changedOwner = notificationOwnerRef.current !== undefined && notificationOwnerRef.current !== ownerKey;
		notificationOwnerRef.current = ownerKey;
		if (changedOwner) {
			void clearTimerDelivery();
			lastNotificationPlanRef.current = null;
		}
		const allowServiceStart = serviceStartIntentRef.current && session.running && appState === "active";
		// Timer start/resume never opens a permission dialog. Notification setup
		// remains in the account flow / system settings, independent of the clock.
		const requestPermission = false;
		const expiredCountdown = !session.completed && session.started && session.recordMode === "countdown"
			&& Number(session.targetDurationSec) > 0 && calculateElapsedSeconds(session) >= Number(session.targetDurationSec);
		const preserveDue = !changedOwner && (expiredCountdown || session.countdownCompletedNaturally === true);
		let current = true;
		if (nativeAudioRef.current) {
			// One Android owner publishes the clock and plays audio in all app states.
			// Do not schedule Expo/AlarmClock cues or JS speech alongside this service.
			void nativeAudioRef.current.sync({ session, ownerKey, locale,
				allowStart: allowServiceStart,
				preserveDue,
			}).then((result) => {
				if (!current) return;
				// Completion can already have played while JS was suspended. Clearing
				// its stopped service is not permission to replay that cue through TTS.
				if (session.started && session.running && typeof result.audioOwned === "boolean") {
					if (result.audioOwned) nativeAudioClockRef.current = { timerId: session.timerId, startedAt: session.startedAt };
					else {
						const previous = nativeAudioClockRef.current;
						if (previous?.timerId === session.timerId && previous.startedAt === session.startedAt && session.recordMode === "countdown") {
							// A cue that became due while native owned audio may already
							// have played. Never replay it via a fresh foreground fallback
							// after e.g. a notification-setting or locale refresh fails.
							const elapsed = calculateElapsedSeconds(session);
							if (elapsed >= Number(session.targetDurationSec) / 2) setSession((value) => value.timerId === session.timerId
								? { ...value, countdownHalfwayAnnounced: true } : value);
							if (elapsed >= Number(session.targetDurationSec)) nativeCompletedClaimRef.current = session.timerId;
						}
						nativeAudioClockRef.current = null;
					}
					setNativeAudioOwned(result.audioOwned);
				}
				if (result.status !== "cancelled" && appState === "active") serviceStartIntentRef.current = false;
			});
			return () => { current = false; };
		}
		const synchronize = async () => {
		const reminderSettings = session.recordMode === "countdown" && session.running
			? await checkReminderSettingsAsync().catch(() => ({ status: "unavailable" })) : {};
		if (!current) return;
		const notificationInput = {
			session: { recordMode: session.recordMode, started: session.started, running: session.running,
				startedAt: session.startedAt, accumulatedSeconds: session.accumulatedSeconds,
				targetDurationSec: session.targetDurationSec, countdownId: session.countdownId,
				completed: session.completed, countdownCompletedNaturally: session.countdownCompletedNaturally },
			ownerKey, locale, requestPermission,
			exactAlarmsAllowed: typeof reminderSettings.exactAlarmsAllowed === "boolean" ? reminderSettings.exactAlarmsAllowed : null,
			preserveDue,
		};
		// Count-up has no milestones. Its visible timer must not wait for stale
		// countdown cancellation/storage work or a previous permission callback.
		const countupStatusPromise = session.recordMode === "countup"
			? timerNotificationRef.current.sync({
				session: { ...notificationInput.session, timerId: session.timerId }, ownerKey, locale, requestPermission,
			}).catch(() => ({ status: "failed" })) : null;
		// Returning from the notification shade refreshes its status, but must not
		// cancel/reschedule the already-arranged half/end alarms or prompt twice.
		const planKey = JSON.stringify({ ...notificationInput, requestPermission: false });
		if (lastNotificationPlanRef.current?.key !== planKey) {
			lastNotificationPlanRef.current = { key: planKey,
				promise: notificationSchedulerRef.current.sync(notificationInput) };
		}
		await lastNotificationPlanRef.current.promise.then(async (result) => {
			if (!current) return;
			if (lastNotificationPlanRef.current?.key === planKey) lastNotificationPlanRef.current.retryOnForeground = ["denied", "failed", "cancelled"].includes(result.status);
			if (countupStatusPromise) await countupStatusPromise;
			else await timerNotificationRef.current.sync({
				session: { ...notificationInput.session, timerId: session.timerId }, ownerKey, locale,
				requestPermission: false,
			});
			if (current) serviceStartIntentRef.current = false;
		});
		};
		void synchronize().catch((error) => console.warn("Unable to update timer notification", error));
		return () => { current = false; };
	}, [hydrated, ownerKey, locale, appState, clearTimerDelivery, session.recordMode, session.started, session.running, session.startedAt,
		session.accumulatedSeconds, session.targetDurationSec, session.countdownId, session.timerId, session.completed, session.countdownCompletedNaturally]);

	useEffect(() => {
		if (!session.running) return undefined;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			clearInterval(timer);
		};
	}, [session.running]);

	const elapsedSeconds = useMemo(() => calculateElapsedSeconds(session, now), [now, session]);
	const seconds = useMemo(() => {
		if (session.recordMode !== "countdown") return elapsedSeconds;
		if (session.completed) return 0;
		return Math.max(0, Number(session.targetDurationSec || 0) - elapsedSeconds);
	}, [elapsedSeconds, session.completed, session.recordMode, session.targetDurationSec]);

	// Date.now() remains the source of truth, so a countdown stays accurate while
	// JavaScript timers are suspended in the background or the app is restarted.
	useEffect(() => {
		if (!hydrated || !session.started || session.completed || session.recordMode !== "countdown") return;
		const target = Math.max(0, Number(session.targetDurationSec) || 0);
		if (!target || elapsedSeconds < target) return;
		cancelCountdownSpeech();
		const deadlineAt = session.running && session.startedAt
			? Number(session.startedAt) + Math.max(0, target - Number(session.accumulatedSeconds || 0)) * 1000 : Date.now();
		const completedSession = { ...session,
			completed: true,
			running: false,
			accumulatedSeconds: target,
			startedAt: null,
			countdownHalfwayAnnounced: true,
			countdownCompletedNaturally: true,
			completedAt: new Date(Math.min(Date.now(), deadlineAt)).toISOString(),
			countdownCompletionVoicePending: (!nativeAudioRef.current || nativeAudioOwned === false) && appStateRef.current === "active" && session.running
				&& nativeCompletedClaimRef.current !== session.timerId
				&& foregroundSinceRef.current <= deadlineAt && Date.now() - deadlineAt <= FOREGROUND_CUE_GRACE_MS };
		serviceStartIntentRef.current = false;
		// Pure countdowns end at 00:00 and never create, replace or erase a
		// manually-entered/legacy exercise draft stored alongside the clock.
		setSession(completedSession);
		setNow(Date.now());
	}, [cancelCountdownSpeech, elapsedSeconds, hydrated, nativeAudioOwned, session]);

	useEffect(() => {
		if (!hydrated || !ownerKey) return;
		// The new Android service also owns foreground cues. Never queue a second
		// TTS announcement or replay a native milestone when the screen reopens.
		if (nativeAudioRef.current && nativeAudioOwned !== false) return;
		const cueIsFresh = (at) => appStateRef.current === "active" && Number.isFinite(at)
			&& foregroundSinceRef.current <= at && Date.now() >= at && Date.now() - at <= FOREGROUND_CUE_GRACE_MS;
		const target = Number(session.targetDurationSec) || 0;
		const halfwayAt = Number(session.startedAt) + (target / 2 - Number(session.accumulatedSeconds || 0)) * 1000;
		if (session.started && session.running && session.recordMode === "countdown"
			&& !session.countdownHalfwayAnnounced && target > 0 && elapsedSeconds >= target / 2 && !cueIsFresh(halfwayAt)) {
			setSession((current) => current.countdownId === session.countdownId
				? { ...current, countdownHalfwayAnnounced: true } : current);
		}
		if (session.countdownCompletionVoicePending && !cueIsFresh(Date.parse(session.completedAt))) {
			setSession((current) => current.timerId === session.timerId
				? { ...current, countdownCompletionVoicePending: false } : current);
			return;
		}
		if (appState !== "active") return;
		// Keep an immediate guard separate from persisted consumed flags. Audio
		// preparation can outlive a render, a pause or an AppState transition.
		if (voiceRequestRef.current) return;
		const requestGeneration = voiceGeneration.current;
		const isCurrentOwner = () => latestState.current.hydrated
			&& latestState.current.ownerKey === ownerKey
			&& appStateRef.current === "active"
			&& voiceGeneration.current === requestGeneration;
		if (session.completed && session.countdownCompletionVoicePending) {
			const timerId = session.timerId;
			const completedAt = Date.parse(session.completedAt);
			const request = { phase: "complete", timerId, generation: requestGeneration };
			voiceRequestRef.current = request;
			void speakerRef.current.speak("complete", locale, () => isCurrentOwner()
				&& latestState.current.session.timerId === timerId && latestState.current.session.completed
				&& latestState.current.session.countdownCompletionVoicePending && cueIsFresh(completedAt), completedAt).then((result) => {
				if (voiceRequestRef.current !== request) return;
				if (result === "cancelled") { voiceRequestRef.current = null; return; }
				setSession((current) => current.timerId === timerId && current.completed
					? { ...current, countdownCompletionVoicePending: false } : current);
			});
			return;
		}
		if (!session.started || !session.running || session.recordMode !== "countdown"
			|| session.countdownHalfwayAnnounced || target <= 0
			|| elapsedSeconds < target / 2 || elapsedSeconds >= target || !cueIsFresh(halfwayAt)) return;
		const request = { phase: "halfway", generation: requestGeneration };
		voiceRequestRef.current = request;
		void speakerRef.current.speak("halfway", locale, () => {
			const current = latestState.current.session;
			return isCurrentOwner() && cueIsFresh(halfwayAt) && current.running && current.recordMode === "countdown"
				&& calculateElapsedSeconds(current) < Number(current.targetDurationSec);
		}, halfwayAt).then((result) => {
			if (voiceRequestRef.current !== request) return;
			if (result === "cancelled") { voiceRequestRef.current = null; return; }
			setSession((current) => voiceGeneration.current === requestGeneration && current.recordMode === "countdown" && current.started
				? { ...current, countdownHalfwayAnnounced: true } : current);
		});
	}, [appState, elapsedSeconds, hydrated, locale, nativeAudioOwned, ownerKey, session]);

	const chooseMode = useCallback((mode, requestedRecordMode = "countup", requestedTargetDurationSec = 0) => {
		serviceStartIntentRef.current = false;
		cancelCountdownSpeech();
		void clearTimerDelivery();
		lastNotificationPlanRef.current = null;
		const recordMode = normalizeRecordMode(requestedRecordMode);
		pendingSummaryRef.current = null;
		setPendingSummary(null);
		setPendingSummaryDraft(null);
		setNow(Date.now());
		if (recordMode === "manual") {
			const summary = createSummary({ mode, recordMode }, 0, true);
			pendingSummaryRef.current = summary;
			setPendingSummary(summary);
			setPendingSummaryDraft(null);
			setSession(EMPTY_SESSION);
			return summary;
		}
		setSession({
			...EMPTY_SESSION,
			mode,
			recordMode,
			targetDurationSec: recordMode === "countdown"
				? Math.max(1, Math.min(86400, Number(requestedTargetDurationSec) || 1800))
				: 0,
		});
		return null;
	}, [cancelCountdownSpeech, clearTimerDelivery]);

	const setCountdownDuration = useCallback((durationSec) => {
		setSession((current) => {
			if (current.started || current.recordMode !== "countdown") return current;
			return {
				...current,
				targetDurationSec: Math.max(1, Math.min(86400, Number(durationSec) || 1)),
			};
		});
	}, []);

	const startCountdown = useCallback((durationSec) => {
		const requestedDurationSec = Number(durationSec);
		if (!Number.isFinite(requestedDurationSec) || requestedDurationSec <= 0) return false;
		cancelCountdownSpeech();
		setNativeAudioOwned(null);
		nativeAudioClockRef.current = null;
		nativeCompletedClaimRef.current = null;
		serviceStartIntentRef.current = true;
		const targetDurationSec = Math.max(1, Math.min(86400, Math.round(requestedDurationSec)));
		const timerId = newCountdownId();
		setNow(Date.now());
		setSession((current) => ({
			...current,
			completed: false,
			completedAt: null,
			countdownCompletedNaturally: false,
			countdownCompletionVoicePending: false,
			recordMode: "countdown",
			targetDurationSec,
			started: true,
			running: true,
			accumulatedSeconds: 0,
			startedAt: Date.now(),
			countdownHalfwayAnnounced: false,
			countdownId: timerId,
			timerId,
		}));
		return true;
	}, [cancelCountdownSpeech]);

	const toggleRunning = useCallback(() => {
		cancelCountdownSpeech();
		setNativeAudioOwned(null);
		nativeAudioClockRef.current = null;
		nativeCompletedClaimRef.current = null;
		serviceStartIntentRef.current = true;
		setSession((current) => {
			if (current.completed) { serviceStartIntentRef.current = false; return current; }
			const currentSeconds = calculateElapsedSeconds(current);
			const timerId = current.timerId || current.countdownId || newTimerId();
			if (!current.running && current.recordMode === "countdown" && Number(current.targetDurationSec || 0) <= 0) return current;
			setNow(Date.now());
			if (current.running) {
				return {
					...current,
					countdownHalfwayAnnounced: current.countdownHalfwayAnnounced || (current.recordMode === "countdown"
						&& currentSeconds >= Number(current.targetDurationSec) / 2),
					running: false,
					accumulatedSeconds: currentSeconds,
					startedAt: null,
				};
			}
			return {
				...current,
				countdownId: current.recordMode === "countdown" ? current.countdownId || timerId : null,
				timerId,
				started: true,
				running: true,
				accumulatedSeconds: currentSeconds,
				startedAt: Date.now(),
			};
		});
	}, [cancelCountdownSpeech]);

	const resetSession = useCallback(() => {
		cancelCountdownSpeech();
		void clearTimerDelivery();
		lastNotificationPlanRef.current = null;
		serviceStartIntentRef.current = false;
		pendingSummaryRef.current = null;
		setPendingSummary(null);
		setPendingSummaryDraft(null);
		setSession(EMPTY_SESSION);
		setNow(Date.now());
	}, [cancelCountdownSpeech, clearTimerDelivery]);

	const finishSession = useCallback(() => {
		serviceStartIntentRef.current = false;
		cancelCountdownSpeech();
		void clearTimerDelivery();
		lastNotificationPlanRef.current = null;
		const elapsed = calculateElapsedSeconds(session);
		const duration = session.recordMode === "countdown"
			? Math.min(elapsed, Math.max(1, Number(session.targetDurationSec) || elapsed))
			: elapsed;
		if (session.recordMode === "countdown") {
			if (!session.completed) setSession({ ...session, completed: true, running: false,
				completedAt: new Date().toISOString(), startedAt: null, accumulatedSeconds: duration,
				countdownHalfwayAnnounced: true, countdownCompletedNaturally: false, countdownCompletionVoicePending: false });
			setNow(Date.now());
			return null;
		}
		const summary = createSummary(session, Math.max(1, duration), false);
		// Navigation begins in the same event as this state update. Keep a
		// synchronous copy so the summary route can validate its token on its
		// very first render instead of briefly reading the previous timer state.
		pendingSummaryRef.current = summary;
		setPendingSummary(summary);
		setPendingSummaryDraft(null);
		setSession(EMPTY_SESSION);
		setNow(Date.now());
		return summary;
	}, [cancelCountdownSpeech, clearTimerDelivery, session]);

	const clearPendingSummary = useCallback(() => {
		cancelCountdownSpeech();
		void clearTimerDelivery();
		lastNotificationPlanRef.current = null;
		pendingSummaryRef.current = null;
		setPendingSummary(null);
		setPendingSummaryDraft(null);
	}, [cancelCountdownSpeech, clearTimerDelivery]);

	const updatePendingSummaryDraft = useCallback((summaryId, draft) => {
		if (!summaryId || pendingSummaryRef.current?.id !== summaryId || !draft || typeof draft !== "object") return;
		setPendingSummaryDraft({ ...draft, summaryId });
	}, []);

	const getPendingSummary = useCallback((summaryId) => {
		const current = pendingSummaryRef.current;
		if (!current) return null;
		if (summaryId && current.id !== summaryId) return null;
		return current;
	}, []);

	const value = useMemo(
		() => ({
			...session,
			seconds,
			elapsedSeconds,
			hydrated,
			pendingSummary,
			pendingSummaryDraft,
			chooseMode,
			setCountdownDuration,
			startCountdown,
			toggleRunning,
			resetSession,
			finishSession,
			clearPendingSummary,
			updatePendingSummaryDraft,
			getPendingSummary,
		}),
		[chooseMode, clearPendingSummary, elapsedSeconds, finishSession, getPendingSummary, hydrated, pendingSummary, pendingSummaryDraft, resetSession, seconds, session, setCountdownDuration, startCountdown, toggleRunning, updatePendingSummaryDraft],
	);

	return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession() {
	const context = React.useContext(ActiveSessionContext);
	if (!context) throw new Error("useActiveSession must be used inside ActiveSessionProvider");
	return context;
}
