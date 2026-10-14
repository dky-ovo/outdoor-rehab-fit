import { assistantLocalEquipmentMatch, normalizeEquipmentLookup, assistantAsksForGuideContent, assistantAsksForJudgement, assistantAsksForLocation } from "./assistant.js";
import { symptomConcern } from "./assistantSymptomEvidence.js";
import { assistantAppText, conflictingRopeInstructions } from "./assistantContentPolicy.js";

const FIELDS = ["details", "kinesiologyTip", "ptTip", "otTip", "tcmTip", "careTip"];
const published = item => item && item.id != null && item.isActive !== false && !item.deletedAt && !item.deleted_at;

export function isAssistantGuideFollowup(message, history, catalog) {
	const continuation = value => /^(?:(?:please|couldyou|canyou|wouldyou|請|请|麻煩|麻烦|可以))*(?:tellmemore|more(?:please|details?|information)?|goon|keepgoing|continu(?:e|ation)|elaborate|explain(?:more|further)|movement(?:steps|technique)|whatnext|somethingelse|動作要領|动作要领|詳[細细]|详[細细]|再.{0,8}(?:講|讲|說|说|詳|详)|(?:講|讲|說|说).{0,8}(?:詳|详|多)|繼續|继续)/i.test(normalizeEquipmentLookup(value));
	if (!continuation(message)) return false;
	for (const previous of [...history].reverse().filter(item => item.role === "user")) {
		if (continuation(previous.content)) continue;
		return Boolean(symptomConcern(previous.content)) || Boolean(assistantLocalEquipmentMatch(previous.content, catalog))
			|| /(器材|設施|设施|教學|教学|使用|操作|\b(?:guides?|equipment|instructions?)\b|\bhow\s+(?:do|to)\b.*\buse\b)/i.test(previous.content);
	}
	// The APP sends a bounded history. After several user/assistant pairs, the
	// original topic can fall out of that window. An elided continuation with
	// missing context still needs verification/clarification, never free-form
	// instructions just because we can no longer recover its original topic.
	return true;
}

export function assistantGuideReply(references, locale, catalog = []) {
	const en = locale === "en";
	const labels = {
		details: en ? "Instructions" : "使用說明", kinesiologyTip: en ? "Exercise specialist tips" : "運動學專家介紹",
		ptTip: en ? "Physiotherapy tips" : "物理治療師貼士", otTip: en ? "Occupational therapy tips" : "職業治療師貼士",
		tcmTip: en ? "TCM background" : "中醫背景", careTip: en ? "Care tips" : "護理貼士",
	};
	let remaining = 6000;
	return references.map(reference => {
		const item = catalog.find(guide => String(guide.id) === String(reference.id));
		const checkedText = item ? FIELDS.filter(field => field !== "tcmTip").map(field => item[field] || "").join("\n") : reference.text;
		if (conflictingRopeInstructions(checkedText)) return `${reference.name}\n\n${en
			? "Please do not pull the ropes on your own yet. Ask venue staff or a physiotherapist to show you the correct movement first."
			: "先不要自行拉繩。請場地人員或物理治療師示範，確認正確動作後再使用。"}`;
		// Keep the whole section, including warnings; never cut an instruction in
		// half to fit the reply. Long sections remain available in the guide.
		const fits = reference.text.length <= remaining;
		if (fits) remaining -= reference.text.length;
		const text = fits ? reference.text : en ? "Open this Facility Guide for the complete section and precautions." : "請開啟此設施教學，查看完整段落和注意事項。";
		return `${reference.name} — ${labels[reference.field]}\n\n${text}`;
	}).join("\n\n");
}

// Named, non-symptom teaching questions need no provider interpretation. The
// caller supplies only its current, published, language-specific server catalog.
export function assistantNamedGuideAnswer(item, message, locale) {
	const en = locale === "en";
	const question = normalizeEquipmentLookup(message);
	const field = /陪同|陪伴|照顧|照顾|護理|护理|companion|carer|caregiver|nursing/.test(question) ? "careTip"
		: /物理治療|物理治疗|physiotherap|physicaltherap/.test(question) ? "ptTip"
			: /職業治療|职业治疗|occupationaltherap/.test(question) ? "otTip"
				: /運動學|运动学|kinesiology/.test(question) ? "kinesiologyTip" : "details";
	const conflict = conflictingRopeInstructions(FIELDS.filter(key => key !== "tcmTip").map(key => item[key] || "").join("\n"));
	const text = assistantAppText(item[field] || "");
	const reply = conflict
		? (en ? `For ${item.name}, please do not pull the ropes on your own yet. Ask venue staff or a physiotherapist to show you the correct movement first.` : `「${item.name}」先不要自行拉繩。請場地人員或物理治療師示範，確認正確動作後再使用。`)
		: text.trim() ? assistantGuideReply([{ id: item.id, name: item.name, field, text }], locale)
			: (en ? `I cannot explain this part of ${item.name} yet. You can tap its picture to see the available instructions.` : `「${item.name}」這部分暫時未能為您解答。可以點選器材圖片，看看現有教學。`);
	return { reply, action: "equipment_local", focus: "", categories: item.categories || [],
		recommendations: [{ id: item.id, name: item.name, reason: en ? "Open the current Facility Guide and its precautions." : "開啟現有設施教學及注意事項。" }],
		recommendationsFinal: true, confirmationRequired: false, source: "app_content", knowledgeSource: "facility_guide", deepSeekUsed: false, guideContentDirect: true,
		...(conflict ? { guideContentNeedsReview: true } : {}),
	};
}

// Resolve explicit, non-symptom reading requests without a model round trip.
// A pronoun can inherit only the nearest uninterrupted user topic. Catalog
// order is a reading example, never a ranking of medical suitability.
export function assistantQuickGuideAnswer({ message, history = [], catalog, locale }) {
	if (symptomConcern(message, history) || assistantAsksForJudgement(message) || assistantAsksForLocation(message)) return null;
	// A name in an exclusion is not a request for that guide. Let the normal
	// selection flow resolve alternatives instead of echoing the rejected item.
	const rejectsEquipment = /不想|唔想|唔要|不要.{0,8}(?:器|機|机)|除了|除咗|別的|别的|另一|其他|\b(?:do not want|don't want|not interested|instead of|other than|another|different)\b/i;
	if (rejectsEquipment.test(message)) return null;
	const asks = assistantAsksForGuideContent(message);
	const continuation = isAssistantGuideFollowup(message, history, catalog);
	const elided = value => /^(?:(?:please|couldyou|canyou|wouldyou|請|请|可以))*(?:tellmemore(?:about(?:howtouse)?(?:it|this|that))?|how(?:do|can)iuse(?:it|this|that)|howtouse(?:it|this|that)|more(?:details|information)?|continue|goon|(?:繼續|继续)(?:講|讲|說|说)?|(?:再)?(?:講|讲|說|说)?(?:詳細|详细)(?:一點|一点|啲|些|點|点)?|(?:佢|呢個|這個|这个|嗰個)(?:點用|点用|點玩|点玩)|(?:這個|这个|呢個|嗰個)(?:呢|呀)?)(?:usingonlythepublishedguideinthisapp|please|謝謝|谢谢)?$/i.test(normalizeEquipmentLookup(value));
	let item = assistantLocalEquipmentMatch(message, catalog);
	if (!item && continuation && elided(message)) {
		for (const previous of [...history].reverse().filter(row => row.role === "user")) {
			if (rejectsEquipment.test(previous.content)) break;
			item = assistantLocalEquipmentMatch(previous.content, catalog);
			if (item || !elided(previous.content)) break;
		}
	}
	if (!item && asks) {
		const categories = [
			["upper", /上肢|手臂|\bupper[ -]body\b|\bupper[ -]limb/i],
			["lower", /下肢|\blower[ -]body\b|\blower[ -]limb/i],
		].filter(([, pattern]) => pattern.test(message));
		const choose = /找|看看|睇|介紹|介绍|選|选|\b(?:find|show|choose|pick)\b/i.test(message);
		if (categories.length === 1 && choose) item = catalog.find(row => published(row)
			&& row.categories?.includes(categories[0][0])
			&& (!row.categories.includes("wheelchair") || /輪椅|轮椅|wheelchair/i.test(message))
			&& row.details?.trim() && !conflictingRopeInstructions(FIELDS.map(key => row[key] || "").join("\n")));
	}
	if (!item || (!asks && !continuation && normalizeEquipmentLookup(message) !== normalizeEquipmentLookup(item.name))) return null;
	const answer = assistantNamedGuideAnswer(item, message, locale);
	// If specifically requested, show the maintained companion precautions as
	// a complete section alongside the instructions, never truncate them.
	if (!answer.guideContentNeedsReview && /注意事項|注意事项|precautions|cautions/i.test(message)
		&& !/陪同|companion|carer|caregiver/i.test(message) && item.careTip?.trim()) {
		answer.reply += "\n\n" + assistantGuideReply([{ id: item.id, name: item.name, field: "careTip", text: assistantAppText(item.careTip) }], locale, catalog);
	}
	return answer;
}
