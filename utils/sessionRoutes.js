export function sessionPathForMode(value) {
	if (value === "countdown") return "/(tabs)/session/countdown";
	if (value === "manual") return "/(tabs)/session/manual";
	return "/(tabs)/session/countup";
}

// Count-up is retired from new workflows. Keep its route only to resume an
// already-started legacy timer or finish saving that timer's pending summary.
export function isRetiredCountupBlocked({ requestedRecordMode, recordMode, started, pendingSummary }) {
	const legacyTimer = recordMode === "countup" && started;
	// Finishing any mode resets the active context to its empty count-up default;
	// read the summary's own mode so a manual/countdown draft is not misidentified.
	const legacySummary = !started && pendingSummary && (!pendingSummary.recordMode || pendingSummary.recordMode === "countup");
	return requestedRecordMode === "countup" && !(legacyTimer || legacySummary);
}

export function sessionReturnPath(pathname, params = {}) {
	const path = String(pathname || "/(tabs)");
	const normalized = path.replace(/^\/\(tabs\)/, "");
	if (!path.startsWith("/") || path.startsWith("//") || /^\/session(?:\/|[?#]|$)/.test(normalized)) return "/(tabs)";
	const query = Object.entries(params).flatMap(([key, value]) => {
		if (key.startsWith("__")) return [];
		return (Array.isArray(value) ? value : [value])
			.filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
			.map((entry) => `${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
	});
	return query.length ? `${path}?${query.join("&")}` : path;
}

export function sessionInitializationAction({
	hydrated,
	isFocused,
	isLeaving,
	pendingSummary,
	started,
	completed,
	mode,
	recordMode,
	requestedRecordMode,
}) {
	if (!hydrated || !isFocused || isLeaving || pendingSummary || (started && !completed)) return null;
	if (requestedRecordMode === "countup") return null;
	if (requestedRecordMode === "manual") return mode ? "reset" : null;
	return !mode || recordMode !== requestedRecordMode ? "choose" : null;
}
