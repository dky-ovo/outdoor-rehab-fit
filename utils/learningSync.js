import { acknowledgeLearningRecords, getPendingLearningRecords } from "./learning";
import { saveLearningProgress } from "./api";
import { getCurrentOwnerKey } from "./userStorage";

// One captured account/token per worker. Never replay another person's outbox
// under a freshly logged-in user's authorization.
export function createLearningSync({ owner, token, isCurrent = () => true, pending = getPendingLearningRecords, acknowledge = acknowledgeLearningRecords, send = saveLearningProgress }) {
	let disposed = false;
	let running = null;
	let cursor = 0;
	const current = () => !disposed && owner && owner !== "guest" && token && isCurrent() && getCurrentOwnerKey() === owner;
	async function submit(batch) {
		if (!current()) return false;
		try {
			const response = await send(token, batch.map((item) => item.record));
			if (!current() || response?.ok !== true) return false;
			await acknowledge(owner, batch);
			return true;
		} catch (error) {
			if (!current() || ![400, 409, 413].includes(error?.status)) return false;
			// A removed/invalid historical item must not block every other facility.
			// Keep its evidence on disk; valid items can still be acknowledged.
			if (batch.length > 1) {
				for (const item of batch) if (!await submit([item])) return false;
			}
			return true;
		}
	}
	async function flush() {
		if (!current()) return;
		const snapshots = await pending(owner);
		if (!snapshots.length) { cursor = 0; return; }
		// Retained invalid/oversized historical records cannot starve later items.
		const start = cursor % snapshots.length;
		const count = Math.min(100, snapshots.length);
		const selected = Array.from({ length: count }, (_, index) => snapshots[(start + index) % snapshots.length]);
		cursor = (start + count) % snapshots.length;
		let batch = [];
		let size = 32;
		// Bound work when a long-offline handset returns. The next pass continues.
		for (const item of selected) {
			if (!current()) return;
			const bytes = JSON.stringify(item.record).length * 3;
			if (bytes > 200000) continue; // retain oversized evidence for diagnosis
			if (batch.length && (batch.length >= 20 || size + bytes > 200000)) {
				if (!await submit(batch)) return;
				batch = []; size = 32;
			}
			batch.push(item); size += bytes;
		}
		if (batch.length) await submit(batch);
	}
	return {
		flush() {
			if (!running) running = flush().catch(() => {}).finally(() => { running = null; });
			return running;
		},
		dispose() { disposed = true; },
	};
}
