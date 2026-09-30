export const FEATURES = {
	OUTDOOR_EQUIPMENT: "outdoor_equipment",
	OUTDOOR_AUDIO_VIDEO: "outdoor_audio_video",
	RISK: "risk",
	LOCATION: "location",
	RESEARCH: "research",
	FAVORITE: "favorite",
	SESSION_RECORD: "session_record",
	SESSION_LOG: "session_log",
	GOAL_SETTING: "goal_setting",
	AI_CHAT: "ai_chat",
	GROUP_CHAT: "group_chat",
	EQUIPMENT_MAP: "equipment_map",
	USAGE_STATS: "usage_stats",
};

// Guest access remains broad, but AI assistance is reserved for registered
// participants because prompts may contain health information. Facility Guide
// access is controlled per equipment item below.
const GUEST_BLOCKED_FEATURES = new Set([FEATURES.GROUP_CHAT, FEATURES.AI_CHAT]);

export const GUEST_FACILITY_ACCESS_PERCENT = 40;

// Equipment IDs are sequential in the bundled and managed catalog. Two IDs in
// every block of five remain available, keeping the guest sample stable at 40%
// instead of changing whenever the list is filtered or the app is reopened.
export function canGuestAccessEquipment(equipmentId) {
	const numericId = Number(equipmentId);
	if (Number.isInteger(numericId) && numericId >= 0) {
		return numericId % 5 < 2;
	}

	// Managed content should normally use numeric IDs. Keep non-numeric IDs
	// deterministic as well so they do not randomly lock and unlock.
	const value = String(equipmentId ?? "");
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash % 5 < 2;
}

export function canAccess(feature, isGuest) {
	if (!isGuest) {
		return true;
	}
	return !GUEST_BLOCKED_FEATURES.has(feature);
}
