// Count unique content intervals, never an absolute seek position or wall time.
export function createPlaybackCoverage(onRange) {
	let previous = null;
	let running = false;
	return (state, sample = {}, now = Date.now()) => {
		if (state === "playing") running = true;
		const wasRunning = running;
		if (!["playing", "progress"].includes(state)) running = false;
		const position = sample.positionMs; const duration = sample.durationMs;
		if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) { previous = null; return; }
		const safe = Math.min(position, duration);
		if (["progress", "paused", "ended"].includes(state) && previous && wasRunning) {
			const elapsed = now - previous.at; const delta = safe - previous.position;
			// Missing/suspended JS callbacks and jumps are not evidence of playback.
			if (previous.duration === duration && elapsed > 0 && elapsed <= 2500 && delta > 0 && delta <= elapsed * 1.25 + 150) onRange(previous.position, safe, duration);
		}
		if (running && (state === "playing" || state === "progress")) previous = { position: safe, duration, at: now };
		else previous = null;
	};
}

export function visibleLearningRange(content, viewport) {
	if (!content || !viewport || content.height <= 0 || viewport.height <= 0 || content.width <= 0 || viewport.width <= 0) return null;
	const left = Math.max(content.x, viewport.x); const right = Math.min(content.x + content.width, viewport.x + viewport.width);
	if (right - left < content.width * 0.95) return null;
	const start = Math.max(content.y, viewport.y); const end = Math.min(content.y + content.height, viewport.y + viewport.height);
	return end > start ? [(start - content.y) / content.height, (end - content.y) / content.height] : null;
}

export function createReadingCoverage(onRange) {
	let previous = null;
	return (range, now = Date.now()) => {
		if (!range) { previous = null; return; }
		// At least one second of stable exposure. Quick scrolling does not qualify.
		if (previous && now - previous.at >= 900 && now - previous.at <= 1800 && Math.abs(range[0] - previous.range[0]) < 0.01 && Math.abs(range[1] - previous.range[1]) < 0.01) onRange(...range);
		previous = { range, at: now };
	};
}

export function learningTextSections(item) {
	return ["kinesiologyTip", "ptTip", "otTip", "tcmTip", "careTip", "details"]
		.filter((key) => (key !== "tcmTip" || item.tcmEnabled) && String(item[key] || "").trim() && String(item[key]).trim() !== "/")
		.map((key) => ({ key, text: String(item[key]).trim(), total: String(item[key]).trim().length }));
}
