// Usage comes only from saved exercise records, never picker taps or guide views.
export function countSessionEquipment(sessions = []) {
	const counts = {};
	for (const session of sessions) {
		const used = new Set();
		for (const exercise of session.exercises || []) {
			if (exercise.equipmentId !== null && exercise.equipmentId !== undefined && exercise.equipmentId !== "") used.add(`id:${exercise.equipmentId}`);
			else if (exercise.name) used.add(`name:${exercise.name}`);
		}
		for (const key of used) counts[key] = (counts[key] || 0) + 1;
	}
	return counts;
}

export function equipmentUseCount(item, counts = {}) {
	return (counts[`id:${item.id}`] || 0) + (counts[`name:${item.name}`] || 0);
}

export function sortSessionEquipment(items = [], bookmarks = {}, counts = {}) {
	return (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }))
		.sort((a, b) => Number(Boolean(bookmarks[b.item.id])) - Number(Boolean(bookmarks[a.item.id]))
			|| equipmentUseCount(b.item, counts) - equipmentUseCount(a.item, counts)
			|| a.index - b.index)
		.map(({ item }) => item);
}
