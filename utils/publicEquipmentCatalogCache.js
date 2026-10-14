const VERSION = 1;
const MAX_ITEMS = 1024;
const MAX_CHARACTERS = 512 * 1024;
const VIDEO_STRINGS = ["videoUrl", "videoUrlZh", "videoUrlEn", "videoPlaybackUrl", "videoPlaybackUrlZh", "videoPlaybackUrlEn", "videoIdentityUrl", "videoIdentityUrlZh", "videoIdentityUrlEn"];
const VIDEO_DURATIONS = ["videoIdentityDurationSeconds", "videoIdentityDurationSecondsZh", "videoIdentityDurationSecondsEn"];
const ITEM_STRINGS = ["nameZh", "nameEn", "imageUrl", "gifLeftUrl", "gifRightUrl", "youtubeKey", ...VIDEO_STRINGS, "detailsZh", "detailsEn", "kinesiologyZh", "kinesiologyEn", "ptTipZh", "ptTipEn", "otTipZh", "otTipEn", "tcmZh", "tcmEn", "careTipZh", "careTipEn", "createdAt", "updatedAt"];
const ITEM_BOOLEANS = ["isCustom", "isActive", "videoLocalesEnabled", "tcmEnabled"];
// Storage is optional for networking; defer native access until a cache read or
// write, then contain storage failures without taking down the API module.
const deviceStorage = {
	getItem: key => require("@react-native-async-storage/async-storage").default.getItem(key),
	setItem: (key, value) => require("@react-native-async-storage/async-storage").default.setItem(key, value),
};

function record(value, strings, booleans, durations = []) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (!(typeof value.id === "string" && value.id.length > 0 && value.id.length <= 256)
		&& !(typeof value.id === "number" && Number.isSafeInteger(value.id))) return null;
	const result = { id: value.id };
	for (const key of strings) {
		if (value[key] === undefined) continue;
		if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 100000)) return null;
		result[key] = value[key];
	}
	for (const key of booleans) {
		if (value[key] === undefined) continue;
		if (value[key] !== null && typeof value[key] !== "boolean") return null;
		result[key] = value[key];
	}
	for (const key of durations) {
		if (value[key] === undefined) continue;
		if (!Number.isFinite(value[key]) || value[key] <= 0 || value[key] > 604800) return null;
		result[key] = value[key];
	}
	if (value.sortOrder !== undefined) {
		if (!Number.isFinite(value.sortOrder)) return null;
		result.sortOrder = value.sortOrder;
	}
	return result;
}

// Only fields returned by the public catalog endpoint can reach storage.
// Account state, headers and unknown fields are deliberately not copied.
export function publicEquipmentCatalog(value) {
	if (!value || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) return null;
	const ids = new Set();
	const items = [];
	for (const item of value.items) {
		const result = record(item, ITEM_STRINGS, ITEM_BOOLEANS, VIDEO_DURATIONS);
		if (!result || ids.has(String(result.id))) return null;
		ids.add(String(result.id));
		if (item.categories !== undefined) {
			if (!Array.isArray(item.categories) || item.categories.length > 128
				|| item.categories.some(id => typeof id !== "string" || id.length > 256)) return null;
			result.categories = [...item.categories];
		}
		if (item.deletedAt !== undefined) {
			if (item.deletedAt !== null && typeof item.deletedAt !== "string" && !Number.isSafeInteger(item.deletedAt)) return null;
			result.deletedAt = item.deletedAt;
		}
		for (const [key, maximum, strings, durations] of [
			["additionalVideos", 40, ["titleZh", "titleEn", ...VIDEO_STRINGS], VIDEO_DURATIONS],
			["teachingSections", 32, ["titleZh", "titleEn", "bodyZh", "bodyEn"], []],
		]) {
			if (item[key] === undefined) continue;
			if (!Array.isArray(item[key]) || item[key].length > maximum) return null;
			const childIds = new Set();
			result[key] = [];
			for (const child of item[key]) {
				const projected = record(child, strings, [], durations);
				if (!projected || typeof child.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(child.id) || childIds.has(child.id)) return null;
				childIds.add(child.id); result[key].push(projected);
			}
		}
		items.push(result);
	}
	const result = { items };
	if (value.categories !== undefined) {
		if (!Array.isArray(value.categories) || value.categories.length > 128) return null;
		result.categories = value.categories.map(category => record(category,
			["nameZh", "nameEn"], ["isBuiltIn", "showInGuide", "isLocked"]));
		if (result.categories.some(category => !category)) return null;
	}
	return JSON.stringify(result).length <= MAX_CHARACTERS ? result : null;
}

export function createPublicEquipmentCatalogCache(apiBase, storage = deviceStorage) {
	const key = `public-equipment-catalog-v${VERSION}:${encodeURIComponent(apiBase)}`;
	let cached = null;
	let revision = 0;
	let hydration = null;
	let writes = Promise.resolve();
	return {
		get: () => cached,
		load() {
			if (cached || revision > 0) return Promise.resolve(cached);
			if (!hydration) {
				const startedRevision = revision;
				hydration = Promise.resolve().then(() => storage.getItem(key)).then(raw => {
					if (revision !== startedRevision || typeof raw !== "string" || raw.length > MAX_CHARACTERS + 2048) return cached;
					const envelope = JSON.parse(raw);
					if (envelope?.version === VERSION && envelope.apiBase === apiBase) cached = publicEquipmentCatalog(envelope.catalog);
					return cached;
				}).catch(() => cached);
			}
			return hydration.then(() => cached);
		},
		store(value) {
			const catalog = publicEquipmentCatalog(value);
			// A successful response that cannot safely be cached must invalidate the
			// old directory, otherwise its retired URLs reappear on the next mount.
			cached = catalog;
			revision += 1;
			const raw = JSON.stringify({ version: VERSION, apiBase, catalog });
			// A slow older disk write must never replace a newer URL snapshot.
			writes = writes.catch(() => {}).then(() => storage.setItem(key, raw)).catch(() => {});
			return catalog !== null;
		},
	};
}
