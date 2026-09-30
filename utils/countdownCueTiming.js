// Allow one timer tick and a short audio-service startup, never a resumed backlog.
export const COUNTDOWN_CUE_MAX_LATENESS_MS = 2000;

export function isCountdownCueFresh(cueAt, now = Date.now()) {
	return Number.isFinite(cueAt) && now >= cueAt && now - cueAt <= COUNTDOWN_CUE_MAX_LATENESS_MS;
}
