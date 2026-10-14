import { symptomConcern, symptomEvidence } from "./assistantSymptomEvidence.js";
import { assistantExerciseQuantityQuestion } from "./assistantLanguage.js";

const GENERAL = { type: "general", categories: [], focus: "" };

const EQUIPMENT_CHARACTER_EQUIVALENTS = {
	极: "極", 轮: "輪", 说: "說", 绍: "紹", 学: "學", 习: "習", 关: "關", 节: "節",
	设: "設", 施: "施", 单: "單", 双: "雙", 压: "壓", 锻: "鍛", 炼: "煉", 强: "強",
	离: "離", 机: "機", 体: "體", 骑: "騎", 脚: "腳", 动: "動", 运: "運", 经: "經",
};

const BUILT_IN_EQUIPMENT_ALIASES = {
	"0": ["太極揉腿器", "太极揉腿器", "太極推手器", "太极推手器", "太極揉推", "太极揉推", "推手器"],
	"17": ["健體單車", "健体单车", "腳部跑步器", "脚部跑步器"],
	"18": ["離地漫步機", "离地漫步机", "漫步機", "漫步机"],
	"22": ["腰背按摩", "背部按摩器"],
	"28": ["石春路", "足健徑", "足健径", "Foot Massage Path"],
};

export function normalizeEquipmentLookup(value) {
	return [...String(value || "").toLocaleLowerCase()]
		.map((character) => EQUIPMENT_CHARACTER_EQUIVALENTS[character] || character)
		.join("")
		.replace(/[^\p{L}\p{N}]/gu, "");
}

export function assistantAsksForJudgement(message) {
	const normalizedMessage = normalizeEquipmentLookup(message);
	return /(適合|适合|推薦|推荐|疼|痛|能不能|可不可以|可唔可以|shouldi|recommend|suitable|pain|diagnos|cure)/i.test(normalizedMessage);
}

export function assistantAsksForGuideContent(message) {
	if (assistantExerciseQuantityQuestion(message)) return true;
	return /(怎麼|怎么|如何|點用|点用|點玩|点玩|點樣|点样|玩法|用法|使用|操作|方法|說明|说明|介紹|介绍|教學|教学|內容|内容|資料|资料|功能|作用|注意事項|注意事项|物理治療|物理治疗|職業治療|职业治疗|是什麼|是什么|做什麼|做什么|howto|howdo|use|instruction|guide|about|whatis|whatdoes|information|explain|precautions|occupationaltherapy|physiotherapy)/i.test(normalizeEquipmentLookup(message));
}

export function assistantAsksForLocation(message) {
	const text = String(message || "");
	// A park is often the setting for a teaching question. Ask where, nearby,
	// or how to get there before switching the APP to the location flow.
	return /(?:哪[裡里裏兒儿]|邊度|边度|何處|何处|在哪|位置|地點|地点|地址|點去|点去|怎麼去|怎么去|如何去|\b(?:nearby|nearest|where|location|address|directions?)\b)/i.test(text)
		|| /(?:附近|周邊|周边|最近).{0,25}(?:公園|公园|設施|设施|器材|器械|運動場|运动场)/i.test(text)
		|| /(?:公園|公园|設施|设施|器材|器械).{0,20}(?:附近|周邊|周边|最近)/i.test(text);
}

function equipmentLookupAliases(item) {
	const values = [item?.name, item?.nameZh, item?.nameEn, ...(Array.isArray(item?.aliases) ? item.aliases : []), ...(BUILT_IN_EQUIPMENT_ALIASES[String(item?.id)] || [])]
		.filter((value) => typeof value === "string" && value.trim());
	const aliases = new Set();
	for (const value of values) {
		for (const candidate of [value, ...value.split(/[\/／|]/), value.replace(/[（(][^）)]*[）)]/g, " ")]) {
			const normalized = normalizeEquipmentLookup(candidate);
			if (normalized.length >= 3) aliases.add(normalized);
		}
	}
	return [...aliases].sort((left, right) => right.length - left.length);
}

export function assistantLocalEquipmentMatch(message, catalog) {
	const normalizedMessage = normalizeEquipmentLookup(message);
	if (!normalizedMessage) return null;
	const matches = activeCatalogItems(catalog)
		.map((item) => ({ item, alias: equipmentLookupAliases(item).find((candidate) => normalizedMessage.includes(candidate)) || "" }))
		.filter((match) => match.alias)
		.sort((left, right) => right.alias.length - left.alias.length);
	return matches[0]?.item || null;
}

function activeCatalogItems(catalog) {
	const seen = new Set();
	return (Array.isArray(catalog) ? catalog : [])
		.filter((item) => item && item.id != null && item.isActive !== false && !item.deletedAt)
		.map((item, index) => ({
			...item,
			id: String(item.id),
			name: String(item.name || "").trim().slice(0, 120),
			index,
			categories: Array.isArray(item.categories) ? item.categories.filter((value) => typeof value === "string").slice(0, 32) : [],
			description: String(item.description || "").trim().slice(0, 1800),
		}))
		.filter((item) => {
			if (!item.name || seen.has(item.id)) return false;
			seen.add(item.id);
			return true;
		});
}

export function assistantHistory(value) {
	return (Array.isArray(value) ? value : []).slice(-8)
		.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
		.map((item) => ({ role: item.role, content: item.content.trim().slice(0, 2000) })).filter((item) => item.content);
}

export function assistantIntent(message, history = [], categoryDefinitions = []) {
	const text = String(message || "").toLowerCase();
	const concern = symptomConcern(message, history);
	// The shared symptom parser owns current/negated/historical emergencies.
	// Location words must never override a current urgent complaint.
	if (concern?.urgent) return { ...GENERAL, urgent: true, concern };
	if (/^(你好|您好|嗨|早安|午安|晚安|謝謝|谢谢|多謝|再見|再见|hello|hi|hey|thanks?|thank you|bye)[!！。,.，?？\s]*$/i.test(text)) return { ...GENERAL };
	if (!concern && assistantAsksForLocation(message)) return { type: "facility", categories: [], focus: "" };
	const categories = [];
	const lower = /(腿|腳|脚|膝|髖|髋|足|踝|下肢|\b(?:legs?|knees?|hips?|calf|calves|feet|foot|ankles?|lower body)\b)/i.test(text);
	const back = /(腰|背|脊|腰椎|頸|颈|\b(?:back|waist|spine|neck)\b)/i.test(text);
	const upper = /(肩|手|臂|肘|腕|上肢|\b(?:shoulders?|arms?|hands?|elbows?|wrists?|upper body)\b)/i.test(text);
	const discomfort = Boolean(concern) || /(疼|痛|酸|不適|不适|僵硬|\b(?:pain|sore|ache|stiff|discomfort)\b)/i.test(text);
	const recommendationRequested = /(推薦|推荐|建議|建议|適合|适合|用什麼|用什么|哪個器材|哪个器材|器材|器械|設施|设施|\b(?:recommend|suggest|suitable|equipment|machine|what should i use)\b)/i.test(text);
	const exerciseGoal = /(鍛煉|锻炼|訓練|训练|伸展|拉伸|活動|活动|放鬆|放松|按摩|舒緩|舒缓|強化|强化|改善|\b(?:exercise|train|training|stretch|mobility|relax|massage|strengthen|improve)\b)/i.test(text);
	if (lower) categories.push("lower", "mobility");
	if (back) categories.push("mobility", "muscle");
	if (upper) categories.push("upper", "mobility");
	if (/(平衡|跌|站不穩|站不稳|\b(?:balance|fall)\b)/i.test(text)) categories.push("balance");
	if (/(心肺|帶氧|带氧|\b(?:aerobic|cardio)\b)/i.test(text)) categories.push("aerobic");
	if (/(放鬆|放松|按摩|舒緩|舒缓|\b(?:relax|relaxation|massage|release)\b)/i.test(text)) categories.push("relaxation");
	if (discomfort && (lower || back || upper)) categories.push("relaxation");
	const focus = lower && upper ? "mixed" : lower ? "lower" : upper ? "upper" : back ? "back" : categories.includes("balance") ? "balance" : categories.includes("aerobic") ? "aerobic" : categories.includes("relaxation") ? "relaxation" : "";
	// Labels are curated in the same APP catalog; custom labels can narrow a
	// search but never override greeting, location or urgent-symptom handling.
	const normalizedText = normalizeEquipmentLookup(text);
	const categoryMatches = categoryDefinitions.filter(item => !item.isLocked && [item.nameZh,item.nameEn].some(name => {
		const label = normalizeEquipmentLookup(name);
		if (label.length < 2) return false;
		if (/^[a-z0-9]+$/.test(label)) {
			const words = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
			return ` ${words(text)} `.includes(` ${words(name)} `);
		}
		return normalizedText.includes(label);
	})).map(item => item.id);
	if (categoryMatches.length) return {
		type: "equipment", categories: [...new Set([...categories,...categoryMatches])],
		focus: focus || categoryMatches[0], categoryMatches, discomfort, concern,
		allowRecommendations: !discomfort || recommendationRequested || exerciseGoal,
		needsClarification: Boolean(discomfort && !recommendationRequested && !exerciseGoal),
	};
	if (categories.length) return {
		type: "equipment", categories: [...new Set(categories)], focus, discomfort, concern,
		allowRecommendations: !discomfort || recommendationRequested || exerciseGoal,
		needsClarification: Boolean(discomfort && !recommendationRequested && !exerciseGoal),
	};
	// Resolve only explicit follow-ups; a new topic must not inherit old recommendations.
	if (/(那|這個|这个|還有|还有|怎麼用|怎么用|如何使用|其他選擇|其他选择|\b(?:that|those|it|another|how to use|how often)\b)/i.test(text)) {
		for (const previous of [...history].reverse().filter((item) => item.role === "user")) {
			const previousIntent = assistantIntent(previous.content, [], categoryDefinitions);
			if (previousIntent.type !== "general" || previousIntent.urgent) return previousIntent;
			if (!/(那|這個|这个|還有|还有|怎麼用|怎么用|如何使用|其他選擇|其他选择|\b(?:that|those|it|another|how to use|how often)\b)/i.test(previous.content)) break;
		}
	}
	if (recommendationRequested) return { type: "equipment", categories: [], focus: "unspecified", allowRecommendations: false, needsClarification: true };
	return { ...GENERAL };
}

export function assistantEquipmentCandidates(catalog, intent) {
	if (intent.type !== "equipment" || intent.urgent || intent.allowRecommendations === false) return [];
	return activeCatalogItems(catalog)
		.filter((item) => {
			if (intent.discomfort && !symptomEvidence(item, intent.concern)) return false;
			if (intent.categoryMatches?.length && !item.categories.some(category => intent.categoryMatches.includes(category))) return false;
			if (intent.focus === "lower") return item.categories.includes("lower");
			if (intent.focus === "upper") return item.categories.includes("upper");
			if (intent.focus === "back") return item.categories.includes("back") || (!item.categories.includes("upper") && !item.categories.includes("lower") && item.categories.some((category) => ["mobility", "muscle"].includes(category)));
			if (intent.focus === "mixed") return item.categories.some((category) => ["upper", "lower"].includes(category));
			if (intent.focus === "unspecified") return true;
			return item.categories.includes(intent.focus);
		})
		.map((item) => ({
			...item,
			score: item.categories.filter((category) => intent.categories.includes(category)).length
				+ (item.categories.includes(intent.focus) ? 4 : 0)
				+ (intent.discomfort && item.categories.includes("relaxation") ? 4 : 0)
				- (intent.discomfort && item.categories.includes("aerobic") ? 2 : 0),
		}))
		.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 12)
		.map(({ id, name, categories, description }) => ({ id, name, categories, description }));
}

export function assistantRecommendations(generated, candidates, intent) {
	// Health-related cards come only from symptomGuideAnswer's verbatim evidence.
	if (intent.type !== "equipment" || intent.discomfort || intent.concern || intent.urgent || intent.allowRecommendations === false) return [];
	const proposed = Array.isArray(generated.recommendations) ? generated.recommendations : (Array.isArray(generated.recommendedIds) ? generated.recommendedIds.map((id) => ({ id })) : []);
	const approved = new Map(candidates.map((item) => [item.id, item]));
	const result = []; const seen = new Set();
	for (const suggestion of proposed) {
		const id = String(suggestion?.id ?? ""); const item = approved.get(id);
		if (!item || seen.has(id)) continue;
		seen.add(id); result.push({ id, name: item.name, reason: typeof suggestion.reason === "string" ? suggestion.reason.trim().slice(0, 300) : "" });
		if (result.length === 3) break;
	}
	return result;
}

export function assistantFallbackRecommendations(candidates, intent, locale = "zh") {
	if (intent.type !== "equipment" || intent.discomfort || intent.urgent || intent.needsClarification || intent.allowRecommendations === false) return [];
	const focusLabels = {
		zh: { lower: "下肢", upper: "上肢", back: "腰背", mixed: "全身", balance: "平衡", aerobic: "帶氧", relaxation: "放鬆", unspecified: "運動" },
		en: { lower: "lower-body", upper: "upper-body", back: "back", mixed: "whole-body", balance: "balance", aerobic: "aerobic", relaxation: "relaxation", unspecified: "exercise" },
	};
	return (Array.isArray(candidates) ? candidates : []).slice(0, 3).map((item) => ({
		id: String(item.id),
		name: item.name,
		reason: locale === "en"
			? `This Facility Guide item is categorized for ${focusLabels.en[intent.focus] || "exercise"} activity. Open the guide and start gently.${intent.discomfort ? " Stop if the pain worsens and seek professional advice." : ""}`
			: `此設施在APP內歸類為${focusLabels.zh[intent.focus] || "運動"}相關器材，可先查看設施教學並按自身情況慢慢進行。${intent.discomfort ? "如疼痛加劇，請立即停止並諮詢專業人員。" : ""}`,
	}));
}
