import { COUNTDOWN_CUE_MAX_LATENESS_MS } from "./countdownCueTiming";

// Countdown speech is handled by the timer while the APP is in the foreground.
// Background delivery must remain visible/audible even when JavaScript is suspended.
export function notificationPresentation(notification, appState) {
	if (notification?.request?.content?.data?.type === "session-timer") {
		return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
	}
	const data = notification?.request?.content?.data;
	const countdown = data?.type === "countdown";
	// A delayed handler may run after the JS thread resumes. Keep a completion
	// notice available, but never play an expired cue or display an old halfway cue.
	const expired = countdown && Number.isFinite(data.notificationAt)
		&& Date.now() - data.notificationAt > COUNTDOWN_CUE_MAX_LATENESS_MS;
	const present = (!countdown || appState !== "active") && (!expired || data.phase === "complete");
	return { shouldShowBanner: present && !expired, shouldShowList: present, shouldPlaySound: present && !expired, shouldSetBadge: !countdown };
}

/** A user tap can open the same timer (including its completed 00:00 page).
 * Legacy saved drafts remain explicitly recoverable; a notice never creates one.
 */
export function sessionTimerNotificationRoute(data, active) {
	if (data?.type === "countdown") return countdownNotificationMatches(data, active) ? "/session/countdown" : null;
	if (data?.type !== "session-timer" || !active?.hydrated || typeof data.timerId !== "string" || !data.timerId
		|| !["countdown", "countup"].includes(data.recordMode)) return null;
	const currentMatches = active.started && active.recordMode === data.recordMode
		&& (active.timerId || active.countdownId) === data.timerId;
	const summaryMatches = !active.started && active.pendingSummary?.recordMode === data.recordMode
		&& (active.pendingSummary.timerId || active.pendingSummary.countdownId) === data.timerId;
	return currentMatches || summaryMatches ? `/session/${data.recordMode}` : null;
}

export function countdownNotificationMatches(data, active) {
	if (data?.type !== "countdown" || typeof data.timerId !== "string" || !data.timerId || !active?.hydrated) return false;
	return (active.recordMode === "countdown" && active.started && (active.timerId || active.countdownId) === data.timerId)
		|| (!active.started && active.pendingSummary?.recordMode === "countdown"
			&& (active.pendingSummary.timerId || active.pendingSummary.countdownId) === data.timerId);
}
