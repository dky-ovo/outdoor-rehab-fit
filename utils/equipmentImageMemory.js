// A bounded cache of decoded, verified-local equipment photos. The caller owns
// file/Metro asset verification; this module never loads a remote URI.
const MiB = 1024 * 1024;
const noop = () => {};

export function equipmentAssetKey(source) {
	return Number.isSafeInteger(source) && source > 0 ? `asset:${source}` : "";
}

function normalizePlan(values) {
	if (!Array.isArray(values) || values.length > 512) return null;
	const byKey = new Map();
	for (const value of values) {
		if (!value || typeof value.key !== "string" || value.key.length > 2048 || typeof value.uri !== "string" || value.uri.length > 4096) return null;
		if (value.key.startsWith("asset:")) {
			// Metro IDs are meaningful only for this running JS bundle. They are
			// never persisted or confused with an uploaded photo's URL/file key.
			if (value.key !== equipmentAssetKey(Number(value.key.slice(6))) || value.uri !== value.key) return null;
		} else {
			try {
				const remote = new URL(value.key), local = new URL(value.uri);
				if (remote.protocol !== "https:" || remote.username || remote.password || !value.uri.startsWith("file:///")
					|| local.protocol !== "file:" || local.hostname || local.search || local.hash) return null;
			} catch { return null; }
		}
		const priority = value.priority ?? 0;
		if (!Number.isFinite(priority)) return null;
		const previous = byKey.get(value.key);
		if (previous && previous.uri !== value.uri) return null;
		if (!previous || priority > previous.priority) byKey.set(value.key, { key: value.key, uri: value.uri, priority });
	}
	return [...byKey.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function createEquipmentImageMemory({ load, maxEntries = 12, budgetBytes = 32 * MiB, timeoutMs = 10000 } = {}) {
	const available = typeof load === "function" && [maxEntries, budgetBytes, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0);
	const records = new Map(), jobs = new Map(), listeners = new Set(), published = new WeakSet();
	let desired = new Map(), priorities = new Map(), bytes = 0, clock = 0, workers = 0;
	let planKey = null, planPromise = null, batch = null;
	const emit = () => { for (const listener of listeners) { try { listener(); } catch { /* A view cannot break the cache. */ } } };
	const releaseUnpublished = ref => { try { if (!published.has(ref)) ref?.release?.(); } catch { /* Optional native cleanup. */ } };
	const remove = uri => {
		const record = records.get(uri);
		if (!record) return;
		bytes -= record.bytes;
		records.delete(uri);
		// A rendered component may still hold this ImageRef. Never explicitly
		// release a published reference: its remaining JS owners govern lifetime.
	};
	const counts = () => {
		let ready = 0;
		for (const item of desired.values()) if (records.has(item.uri)) ready += 1;
		return { ready, failed: desired.size - ready };
	};
	function finish(status) {
		if (!batch || batch.finished) return;
		batch.finished = true;
		clearTimeout(batch.timer);
		batch.resolve({ status, ...counts() });
	}
	function finishIfDone() {
		if ([...priorities.keys()].some(uri => jobs.has(uri) && !jobs.get(uri).settled)) return;
		finish("complete");
	}
	function stop(job) {
		job.cancelled = true;
		job.settled = true;
		if (!job.started && jobs.get(job.uri) === job) jobs.delete(job.uri);
	}
	function accept(job, ref) {
		if (job.cancelled || jobs.get(job.uri) !== job || !priorities.has(job.uri)) { releaseUnpublished(ref); return; }
		let size;
		try {
			const { width, height, isAnimated } = ref || {};
			size = width * height * 4;
			// The Android adapter supplies pixel dimensions; screen density must
			// not be applied again. Animated images need a separate memory budget.
			if (isAnimated === true || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
				|| !Number.isSafeInteger(size) || size > budgetBytes) { releaseUnpublished(ref); return; }
		} catch { releaseUnpublished(ref); return; }
		const priority = priorities.get(job.uri);
		const candidates = [...records.entries()].filter(([, record]) => record.priority <= priority)
			.sort((a, b) => a[1].priority - b[1].priority || a[1].touched - b[1].touched);
		const evict = [];
		let nextBytes = bytes + size, nextCount = records.size + 1;
		for (const [uri, record] of candidates) {
			if (nextCount <= maxEntries && nextBytes <= budgetBytes) break;
			evict.push(uri); nextBytes -= record.bytes; nextCount -= 1;
		}
		if (nextCount > maxEntries || nextBytes > budgetBytes) { releaseUnpublished(ref); return; }
		for (const uri of evict) remove(uri);
		published.add(ref);
		records.set(job.uri, { ref, bytes: size, priority, touched: ++clock });
		bytes += size;
		emit();
	}
	function pump() {
		const waiting = [...jobs.values()].filter(job => !job.started && !job.settled && !job.cancelled && priorities.has(job.uri))
			.sort((a, b) => priorities.get(b.uri) - priorities.get(a.uri));
		for (const job of waiting) {
			if (workers >= 2) break;
			job.started = true; workers += 1;
			let pending;
			try { pending = load(job.uri); } catch (error) { pending = Promise.reject(error); }
			void Promise.resolve(pending).then(ref => accept(job, ref), noop).finally(() => {
				job.settled = true;
				workers -= 1;
				if (jobs.get(job.uri) === job) jobs.delete(job.uri);
				pump(); finishIfDone();
			}).catch(noop);
		}
		finishIfDone();
	}
	function sync(fullReadyDescriptors) {
		const plan = available ? normalizePlan(fullReadyDescriptors) : null;
		if (!plan) return Promise.resolve({ status: "unavailable", ready: 0, failed: 0 });
		const key = JSON.stringify(plan);
		if (key === planKey) return planPromise;
		finish("cancelled");
		planKey = key;
		desired = new Map(plan.map(item => [item.key, item]));
		priorities = new Map();
		for (const item of plan) priorities.set(item.uri, Math.max(priorities.get(item.uri) ?? -Infinity, item.priority));
		for (const [uri, record] of records) {
			if (!priorities.has(uri)) remove(uri);
			else record.priority = priorities.get(uri);
		}
		for (const job of jobs.values()) if (!priorities.has(job.uri)) stop(job);
		for (const uri of priorities.keys()) {
			if (records.has(uri)) continue;
			const existing = jobs.get(uri);
			if (!existing || existing.cancelled || existing.settled) jobs.set(uri, { uri, started: false, settled: false, cancelled: false });
		}
		planPromise = new Promise(resolve => {
			const starting = { resolve, finished: false, timer: null };
			batch = starting;
			// This deadline also bounds queued work when a native load never
			// settles. Its physical slot stays occupied until the native promise ends.
			starting.timer = setTimeout(() => {
				if (batch !== starting || starting.finished) return;
				for (const job of jobs.values()) if (!job.settled) stop(job);
				finish("complete");
			}, timeoutMs);
		});
		emit();
		pump();
		return planPromise;
	}
	function get(key, uri) {
		if (desired.get(key)?.uri !== uri) return null;
		const record = records.get(uri);
		if (!record) return null;
		record.touched = ++clock;
		return record.ref;
	}
	function cancel() {
		finish("cancelled");
		planKey = null; planPromise = null;
		for (const job of jobs.values()) if (!job.settled) stop(job);
	}
	return { sync, get, cancel, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
