import { Platform, Image as NativeImage } from "react-native";
import { API_BASE_URL, resolveApiAssetUrl } from "./api";
import { createEquipmentImageFiles } from "./equipmentImageFiles";
import { createEquipmentImageMemory, equipmentAssetKey } from "./equipmentImageMemory";
import { mergeEquipmentCatalog, EQUIPMENT_IMAGE_PLACEHOLDER } from "./equipmentCatalog";
import { equipmentTranslations } from "../constants/Equipments";

const listeners = new Set();
let files, hydration, hydrated = Platform.OS === "web", runningPlan = null;
let memory, mainImages = [], warmingEnabled = false, displaySequence = 0;
const displayed = new Map();
const knownBundledMains = new Set();
let retiredBundledMains = new Set();
const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* Isolate view subscribers. */ } } };
function decodedImages() {
	// This bounded ImageRef budget was verified against Build 17 on Android.
	// Other platforms retain the existing persistent-file rendering path.
	if (Platform.OS !== "android") return null;
	if (!memory) {
		memory = createEquipmentImageMemory({
			load: uri => require("expo-image").Image.loadAsync(uri.startsWith("asset:") ? Number(uri.slice(6)) : { uri }, { maxWidth: 1024, maxHeight: 1024 }),
			maxEntries: 12, budgetBytes: 32 * 1024 * 1024, timeoutMs: 10000,
		});
		memory.subscribe(notify);
	}
	return memory;
}
function warmDecodedImages() {
	if (!warmingEnabled || Platform.OS !== "android") return;
	// Verified private files and locally resolved Metro main images only. No
	// second HTTP fetch, video/GIF batch or loading-screen dependency. Mounted images take
	// priority, then favorites, within a bounded set of native image references.
	const ready = mainImages.map(item => ({ ...item, uri: item.key.startsWith("asset:") ? item.key : files?.get(item.key, "") }))
		.filter(item => item.uri)
		.sort((a, b) => (displayed.has(b.uri) ? 100 : 0) + b.priority - (displayed.has(a.uri) ? 100 : 0) - a.priority
			|| (displayed.get(b.uri)?.sequence || 0) - (displayed.get(a.uri)?.sequence || 0) || a.key.localeCompare(b.key))
		.slice(0, 12).map(item => ({ ...item, priority: item.priority + (displayed.has(item.uri) ? 100 : 0) }));
	try { void decodedImages()?.sync(ready)?.catch(() => {}); }
	catch { /* A decode optimization must never interrupt catalog or UI work. */ }
}
function imageFiles() {
	if (files !== undefined) return files;
	files = null;
	if (Platform.OS === "web") return files;
	try {
		const origins = new Set([
			new URL(API_BASE_URL).origin,
			"https://api.outdoorfit.hk", "https://admin.outdoorfit.hk",
			"https://outdoor-fit.35-241-75-217.sslip.io",
		]);
		files = createEquipmentImageFiles({ fileSystem: require("expo-file-system/legacy"), allowedOrigins: [...origins] });
		files.subscribe(() => { notify(); warmDecodedImages(); });
	} catch { /* Local storage is optional; remote/bundled image display survives. */ }
	return files;
}

export function hydrateEquipmentImages() {
	if (!hydration) hydration = Promise.resolve().then(() => imageFiles()?.hydration())
		.catch(() => null).finally(() => { hydrated = true; notify(); warmDecodedImages(); });
	return hydration;
}
export function subscribeEquipmentImages(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
// null means the disk index is still loading; an empty string means no exact
// local file exists. React snapshots remain primitive and stable between events.
export function equipmentImageSnapshot(url) {
	return imageFiles()?.get(url, "") || (hydrated ? "" : null);
}
export function equipmentDecodedImageSnapshot(url, uri) { return memory?.get(url, uri) || null; }
export function equipmentBundledImageRetired(key) { return Platform.OS === "android" && retiredBundledMains.has(key); }
export function pinEquipmentImage(uri) {
	const release = uri.startsWith("asset:") ? (() => {}) : imageFiles()?.pin(uri) || (() => {});
	const previous = displayed.get(uri);
	displayed.set(uri, { count: (previous?.count || 0) + 1, sequence: ++displaySequence });
	warmDecodedImages();
	let active = true;
	return () => {
		if (!active) return;
		active = false; release();
		const current = displayed.get(uri);
		if (current?.count > 1) displayed.set(uri, { ...current, count: current.count - 1 });
		else displayed.delete(uri);
		warmDecodedImages();
	};
}
export function invalidateEquipmentImage(url, uri) {
	void Promise.resolve().then(() => imageFiles()?.invalidate(url, "", uri)).catch(() => {});
}

export function equipmentImageDownloadPlan(catalog, bookmarks = {}) {
	const byUrl = new Map();
	for (const item of Array.isArray(catalog?.items) ? catalog.items : []) {
		if (!item || item.isActive === false || item.deletedAt) continue;
		const saved = Boolean(bookmarks[String(item.id)]);
		for (const [field, priority] of [["imageUrl", saved ? 30 : 20], ["gifLeftUrl", saved ? 10 : 0], ["gifRightUrl", saved ? 10 : 0]]) {
			if (typeof item[field] !== "string" || !item[field]) continue;
			const url = resolveApiAssetUrl(item[field]);
			const previous = byUrl.get(url);
			if (!previous || priority > previous.priority) byUrl.set(url, { url, version: "", priority });
		}
	}
	return [...byUrl.values()].sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));
}
function localBundledImageKey(source) {
	const key = equipmentAssetKey(source);
	if (!key || source === EQUIPMENT_IMAGE_PLACEHOLDER || Platform.OS !== "android") return "";
	try {
		const asset = require("expo-asset").Asset.fromModule(source);
		const uri = NativeImage.resolveAssetSource(source)?.uri;
		// Resolution is synchronous metadata lookup. Do not download a missing
		// OTA asset, prewarm a development-server URL, or decode animated media.
		return /^(?:jpe?g|png|webp)$/i.test(asset.type || "") && typeof uri === "string"
			&& (/^(?:file:\/\/\/|android\.resource:\/\/|res:\/)/i.test(uri) || /^[a-z0-9_]+$/i.test(uri)) ? key : "";
	} catch { return ""; }
}
export function syncEquipmentImages(catalog, { bookmarks = {}, baseItems = equipmentTranslations.zh.equipmentList } = {}) {
	if (!Array.isArray(catalog?.items)) return Promise.resolve({ status: "unavailable" });
	warmingEnabled = true;
	const mains = new Map();
	for (const item of catalog.items) {
		if (!item || item.isActive === false || item.deletedAt || typeof item.imageUrl !== "string"
			|| !/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(item.imageUrl)) continue;
		// Preserve v6's cloud-replacement warm slots when many local modules have
		// the same bookmark class. Favorites still outrank all normal photos.
		const key = resolveApiAssetUrl(item.imageUrl), priority = bookmarks[String(item.id)] ? 32 : 22;
		if (!mains.has(key) || mains.get(key).priority < priority) mains.set(key, { key, priority });
	}
	// Both languages use these same image modules. Merge only after receiving a
	// complete authoritative catalog, so a cloud replacement excludes its old
	// bundled icon AND horizontal photo from this plan immediately.
	for (const item of baseItems) {
		for (const source of [item.icon, item.horizontalPic || item.pic || item.icon]) {
			const key = equipmentAssetKey(source);
			if (key && source !== EQUIPMENT_IMAGE_PLACEHOLDER) knownBundledMains.add(key);
		}
	}
	const allowedBundledMains = new Set();
	for (const item of mergeEquipmentCatalog(baseItems, catalog.items, "zh")) {
		if (item.deletedAt) continue;
		const priority = bookmarks[String(item.id)] ? 30 : 20;
		for (const source of [item.icon, item.horizontalPic || item.pic || item.icon]) {
			const identity = equipmentAssetKey(source);
			if (identity) allowedBundledMains.add(identity);
			const key = localBundledImageKey(source);
			if (key && (!mains.has(key) || mains.get(key).priority < priority)) mains.set(key, { key, priority });
		}
	}
	const retired = new Set([...knownBundledMains].filter(key => !allowedBundledMains.has(key)));
	const retirementChanged = retired.size !== retiredBundledMains.size || [...retired].some(key => !retiredBundledMains.has(key));
	retiredBundledMains = retired;
	mainImages = [...mains.values()];
	// Catalog subscribers and React state can commit in either order. A mounted
	// view with the previous module prop must not briefly fall back to that photo.
	if (retirementChanged) notify();
	warmDecodedImages();
	const plan = equipmentImageDownloadPlan(catalog, bookmarks);
	const key = JSON.stringify(plan);
	if (runningPlan?.key === key) return runningPlan.promise;
	const current = { key, promise: null };
	runningPlan = current;
	current.promise = hydrateEquipmentImages().then(() => {
		if (runningPlan !== current) return { status: "cancelled" };
		return imageFiles()?.sync(plan) || { status: "unavailable" };
	}).catch(() => ({ status: "unavailable" })).finally(() => {
		if (runningPlan === current) runningPlan = null;
	});
	return current.promise;
}
export function cancelEquipmentImageSync() {
	runningPlan = null;
	warmingEnabled = false;
	memory?.cancel();
	imageFiles()?.cancel();
}
