import { resolveApiAssetUrl } from "./api";

export const EQUIPMENT_IMAGE_PLACEHOLDER = require("../assets/icons/outdoor.png");

// Offline defaults mirror the server catalog; identity and icon keys stay
// stable when maintenance staff rename a category in either language.
export const DEFAULT_EQUIPMENT_CATEGORIES = [
	["muscle", "肌肉強化", "Muscle Strengthening"],
	["mobility", "關節靈活性及伸展", "Mobility and Flexibility"],
	["balance", "平衡力", "Balance"], ["aerobic", "帶氧運動", "Aerobic Activity"],
	["wheelchair", "坐輪椅人士使用", "For Wheelchair Users"],
	["multifunctional", "多功能型", "Multi-functional & Integrative"],
	["relaxation", "肌肉放鬆", "Muscle Relaxation"],
	["upper", "上肢運動", "Upper Limbs Exercise"], ["lower", "下肢運動", "Lower Limbs Exercise"],
	["back", "腰背", "Back Exercise", false], ["alternative", "民間智慧", "Local Tips"],
	["special_population", "特殊人群", "Special Population", true, true],
	["warmup", "中風人士", "Chronic Stroke Survivor", true, true],
].map(([id, nameZh, nameEn, showInGuide = true, isLocked = false], sortOrder) => ({ id, nameZh, nameEn, isBuiltIn: true, showInGuide, isLocked, sortOrder }));

export function mergeEquipmentCategories(overrides = []) {
	const items = new Map(DEFAULT_EQUIPMENT_CATEGORIES.map(item => [item.id, { ...item }]));
	for (const item of Array.isArray(overrides) ? overrides : []) {
		if (!item || typeof item.id !== "string" || !item.id) continue;
		const previous = items.get(item.id) || { isBuiltIn: false, showInGuide: true, isLocked: false, sortOrder: 100 };
		items.set(item.id, { ...previous, ...item });
	}
	return [...items.values()].sort((a,b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));
}

export function equipmentCategoryLabel(category, locale = "zh") {
	return (locale === "en" ? category?.nameEn : category?.nameZh) || category?.nameZh || category?.nameEn || category?.id || "";
}

function normalizedEquipmentName(value, locale) {
	const name = String(value || "").trim();
	if (locale === "zh" && ["太極揉腿器", "太極揉腿器/太極推手器"].includes(name)) return "太極揉推器";
	return name;
}

export function equipmentVideoForLocale(item, locale = "zh", baseYoutubeKey = "") {
	const localized = Boolean(item.videoLocalesEnabled || item.videoUrlZh || item.videoUrlEn);
	return localized
		? { videoUrl: (locale === "en" ? item.videoUrlEn : item.videoUrlZh) || "", youtubeKey: "" }
		: { videoUrl: item.videoUrl || "", youtubeKey: item.youtubeKey || baseYoutubeKey };
}

export function mergeEquipmentCatalog(baseItems, overrides, locale = "zh", { imageCatalogReady = true } = {}) {
	const byId = new Map((overrides || []).map((item) => [String(item.id), item]));
	const merged = (baseItems || []).map((base, index) => {
		const override = byId.get(String(base.id));
		const localImages = imageCatalogReady ? {} : { icon: EQUIPMENT_IMAGE_PLACEHOLDER, pic: EQUIPMENT_IMAGE_PLACEHOLDER, horizontalPic: EQUIPMENT_IMAGE_PLACEHOLDER, fallbackIcon: EQUIPMENT_IMAGE_PLACEHOLDER, fallbackHorizontalPic: EQUIPMENT_IMAGE_PLACEHOLDER };
		if (!override) return { ...base, ...localImages, sortOrder: index, isActive: true, isCustom: false };
		byId.delete(String(base.id));
		if (override.deletedAt) return { ...base, isActive: false, isCustom: false, deletedAt: override.deletedAt };
		const image = override.imageUrl || null;
		return {
			...base,
			fallbackIcon: image ? EQUIPMENT_IMAGE_PLACEHOLDER : base.icon,
			fallbackHorizontalPic: image ? EQUIPMENT_IMAGE_PLACEHOLDER : base.horizontalPic || base.pic || base.icon,
			nameZh: override.nameZh || (locale === "zh" ? base.name : ""),
			nameEn: override.nameEn || (locale === "en" ? base.name : ""),
			aliases: [override.nameZh, override.nameEn].filter(Boolean),
			name: normalizedEquipmentName((locale === "en" ? override.nameEn : override.nameZh) || base.name, locale),
			categories: override.categories?.length ? override.categories : base.categories,
			icon: image || base.icon, pic: image || base.pic, horizontalPic: image || base.horizontalPic,
			gifLeftUrl: override.gifLeftUrl || "", gifRightUrl: override.gifRightUrl || "",
			...equipmentVideoForLocale(override, locale, base.youtubeKey),
			details: (locale === "en" ? override.detailsEn : override.detailsZh) || base.details,
			kinesiologyTip: (locale === "en" ? override.kinesiologyEn : override.kinesiologyZh) || base.kinesiologyTip,
			ptTip: (locale === "en" ? override.ptTipEn : override.ptTipZh) || base.ptTip,
			otTip: (locale === "en" ? override.otTipEn : override.otTipZh) || base.otTip,
			tcmTip: (locale === "en" ? override.tcmEn : override.tcmZh) || base.tcmTip || "",
			tcmEnabled: override.tcmEnabled == null ? Boolean(base.tcmEnabled) : Boolean(override.tcmEnabled),
			careTip: (locale === "en" ? override.careTipEn : override.careTipZh) || base.careTip,
			sortOrder: override.sortOrder, isActive: override.isActive, isCustom: false,
		};
	});
	for (const item of byId.values()) {
		if (!item.isCustom || item.deletedAt) continue;
		merged.push({
			id: item.id,
			nameZh: item.nameZh || "", nameEn: item.nameEn || "", aliases: [item.nameZh, item.nameEn].filter(Boolean),
			name: normalizedEquipmentName((locale === "en" ? item.nameEn : item.nameZh) || item.nameZh || item.nameEn, locale),
			categories: item.categories?.length ? item.categories : ["multifunctional"],
			icon: item.imageUrl, pic: item.imageUrl, horizontalPic: item.imageUrl,
			gifLeftUrl: item.gifLeftUrl || "", gifRightUrl: item.gifRightUrl || "",
			...equipmentVideoForLocale(item, locale),
			fallbackIcon: null, fallbackHorizontalPic: null,
			details: locale === "en" ? item.detailsEn : item.detailsZh,
			kinesiologyTip: locale === "en" ? item.kinesiologyEn : item.kinesiologyZh,
			ptTip: locale === "en" ? item.ptTipEn : item.ptTipZh, otTip: locale === "en" ? item.otTipEn : item.otTipZh,
			tcmTip: locale === "en" ? item.tcmEn : item.tcmZh, tcmEnabled: Boolean(item.tcmEnabled),
			careTip: locale === "en" ? item.careTipEn : item.careTipZh,
			sortOrder: item.sortOrder, isActive: item.isActive, isCustom: true,
		});
	}
	return merged.filter((item) => item.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function equipmentImageSource(value) {
	if (value && typeof value === "object") {
		if (value.uri) return { ...value, uri: /^file:\/\//i.test(value.uri) ? value.uri : resolveApiAssetUrl(value.uri) };
		return value;
	}
	if (typeof value !== "string") return value;
	if (!value) return null;
	if (["undefined", "null", "[object Object]"].includes(value)) return null;
	if (/^[\[{]/.test(value)) {
		try { return equipmentImageSource(JSON.parse(value)); } catch { /* fall through */ }
	}
	// Expo Router serializes local require(...) asset module IDs when an item is
	// passed through route params. Convert that numeric string back to the module
	// ID instead of treating it as a remote URL.
	if (/^\d+$/.test(value)) return Number(value);
	return { uri: /^file:\/\//i.test(value) ? value : resolveApiAssetUrl(value) };
}
