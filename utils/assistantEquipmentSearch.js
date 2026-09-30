import { formatEquipmentInstructionSteps } from "./equipmentInstructions";
import { symptomConcern, symptomEvidence, symptomGuideAnswer } from "./assistantSymptomEvidence";
import { equipmentTcmExcerpt, withEquipmentTcm, withEquipmentTcmReply } from "./assistantTcm";

const CHARACTER_EQUIVALENTS = {
	极: "極", 轮: "輪", 推: "推", 腿: "腿", 器: "器", 说: "說", 绍: "紹",
	学: "學", 习: "習", 关: "關", 节: "節", 健: "健", 身: "身", 设: "設", 施: "施",
	单: "單", 双: "雙", 压: "壓", 锻: "鍛", 炼: "煉", 强: "強", 离: "離", 步: "步",
	机: "機", 臂: "臂", 体: "體", 骑: "騎", 脚: "腳", 腰: "腰", 背: "背", 按: "按",
	摩: "摩", 肢: "肢", 展: "展", 热: "熱", 动: "動", 运: "運", 经: "經", 合: "合",
};

const LEGACY_ALIASES = {
	"0": ["太極揉腿器", "太极揉腿器", "太極推手器", "太极推手器", "太極揉推", "太极揉推", "推手器"],
	"17": ["健體單車", "健体单车", "腳部跑步器", "脚部跑步器"],
	"18": ["離地漫步機", "离地漫步机", "漫步機", "漫步机"],
	"22": ["腰背按摩", "背部按摩器"],
	"28": ["石春路", "足健徑", "足健径", "Foot Massage Path"],
};

export function normalizeEquipmentLookup(value) {
	return [...String(value || "").toLocaleLowerCase()]
		.map((character) => CHARACTER_EQUIVALENTS[character] || character)
		.join("")
		.replace(/[^\p{L}\p{N}]/gu, "");
}

function usefulAlias(value) {
	const normalized = normalizeEquipmentLookup(value);
	return normalized.length >= 3 ? normalized : "";
}

function equipmentAliases(item) {
	const values = [item?.name, item?.nameZh, item?.nameEn, ...(Array.isArray(item?.aliases) ? item.aliases : []), ...(LEGACY_ALIASES[String(item?.id)] || [])]
		.filter((value) => typeof value === "string" && value.trim());
	const aliases = new Set();
	for (const value of values) {
		const candidates = [
			value,
			...value.split(/[\/／|]/),
			value.replace(/[（(][^）)]*[）)]/g, " "),
		];
		for (const candidate of candidates) {
			const normalized = usefulAlias(candidate);
			if (normalized) aliases.add(normalized);
		}
	}
	return [...aliases].sort((left, right) => right.length - left.length);
}

export function findLocalEquipment(question, catalog) {
	const normalizedQuestion = normalizeEquipmentLookup(question);
	if (!normalizedQuestion) return null;
	const matches = (Array.isArray(catalog) ? catalog : [])
		.filter((item) => item && item.id != null && item.isActive !== false && !item.deletedAt)
		.map((item) => ({ item, alias: equipmentAliases(item).find((candidate) => normalizedQuestion.includes(candidate)) || "" }))
		.filter((match) => match.alias)
		.sort((left, right) => right.alias.length - left.alias.length);
	return matches[0]?.item || null;
}

// A response (including restored history) may refer to deleted or invalid IDs.
// Only render cards that can actually open an active Facility Guide entry.
export function resolveEquipmentRecommendations(recommendations, catalog, locale = "zh") {
	const available = new Map((Array.isArray(catalog) ? catalog : [])
		.filter((item) => item && item.id != null && item.isActive !== false && !item.deletedAt)
		.map((item) => [String(item.id), item]));
	const seen = new Set();
	const resolved = (Array.isArray(recommendations) ? recommendations : []).flatMap((recommendation) => {
		const id = recommendation?.id == null ? "" : String(recommendation.id);
		const equipment = available.get(id);
		if (!equipment || seen.has(id)) return [];
		seen.add(id);
		return [{ ...recommendation, ...equipment }];
	});
	// Never trust a model's or stored conversation's TCM excerpt. Rebuild from
	// the currently displayed APP language and maintenance visibility flag.
	return withEquipmentTcm(resolved, catalog, locale);
}

function requestedSection(question) {
	const value = normalizeEquipmentLookup(question);
	if (/(中醫|中医|中醫學|中医学|traditionalchinesemedicine|tcm)/.test(value)) return "tcmTip";
	if (/(物理治療|物理治疗|physiotherap)/.test(value)) return "ptTip";
	if (/(職業治療|职业治疗|occupationaltherap)/.test(value)) return "otTip";
	if (/(志願者|志愿者|照顧者|照顾者|caregiver|volunteer)/.test(value)) return "careTip";
	if (/(運動學|运动学|kinesiology)/.test(value)) return "kinesiologyTip";
	return "details";
}

export function localEquipmentAnswerForItem(question, equipment, locale = "zh") {
	if (!equipment || equipment.id == null || equipment.isActive === false || equipment.deletedAt) return null;
	const normalizedQuestion = normalizeEquipmentLookup(question);
	const asksForGuidance = /(怎麼|怎么|如何|使用|操作|方法|說明|说明|介紹|介绍|教學|教学|內容|内容|資料|资料|功能|作用|是什麼|是什么|做什麼|做什么|中醫|中医|物理治療|物理治疗|職業治療|职业治疗|運動學|运动学|志願者|志愿者|照顧者|照顾者|howto|howdo|use|instruction|guide|about|whatis|whatdoes|information|physiotherap|occupationaltherap|kinesiology|caregiver|volunteer|traditionalchinesemedicine|tcm)/i.test(normalizedQuestion);
	const asksForJudgement = symptomConcern(question) || /(適合|适合|推薦|推荐|疼|痛|能不能|可不可以|shouldi|recommend|suitable|pain|diagnos|cure)/i.test(normalizedQuestion);
	const isOnlyEquipmentName = equipmentAliases(equipment).includes(normalizedQuestion);
	if (asksForJudgement || (!asksForGuidance && !isOnlyEquipmentName)) return null;
	const primaryField = requestedSection(question);
	const primaryContent = primaryField === "tcmTip"
		? equipmentTcmExcerpt(equipment, locale)?.quote || ""
		: String(equipment[primaryField] || "").trim();
	// Never substitute another section or model-generated prose for the section
	// the user requested. A missing APP field stays missing and the Facility
	// Guide card remains the sole source of further information.
	const rawContent = primaryContent;
	const instructionContent = primaryField === "details" ? formatEquipmentInstructionSteps(rawContent, locale) : "";
	const content = (instructionContent || rawContent).trim().slice(0, 4000);
	const name = equipment.name || equipment.nameZh || equipment.nameEn || "";
	const reply = primaryField === "tcmTip"
		? (content
			? (locale === "en" ? `TCM perspective (APP excerpt) — ${name}:\n\n“${content}”\n\nThis is TCM background from the APP, not advice to use this equipment for your symptoms. Please read the full precautions in the Facility Guide.` : `中醫學角度（APP原文節錄）－${name}：\n\n「${content}」\n\n這是APP的中醫背景資料，並非針對症狀的使用建議。請查看設施教學的完整注意事項。`)
			: (locale === "en" ? `There is currently no TCM excerpt available for ${name} in this language. You can still open its Facility Guide below.` : `「${name}」目前沒有可顯示的中醫學角度摘錄，您仍可透過下方入口查看設施教學。`))
		: content
		? (primaryField === "details"
			? content
			: locale === "en" ? `According to the Facility Guide for ${name}:\n\n${content}` : `根據APP內「設施教學－${name}」的資料：\n\n${content}`)
		: locale === "en"
			? `I found ${name} in the Facility Guide. Open it below for the available instructions and pictures.`
			: `已在APP的設施教學中找到「${name}」，請點擊下方入口查看現有說明和圖片。`;
	return withEquipmentTcmReply({
		reply,
		action: "equipment_local",
		focus: "",
		categories: Array.isArray(equipment.categories) ? equipment.categories : [],
		tcmInReply: primaryField === "tcmTip" && Boolean(content),
		recommendations: withEquipmentTcm([{
			id: String(equipment.id),
			name,
			reason: locale === "en" ? "Open the Facility Guide for complete instructions and pictures." : "點擊進入設施教學，查看完整說明、圖片和動作示範。",
		}], [equipment], locale),
		confirmationRequired: false,
		source: "app_content",
		knowledgeSource: "facility_guide",
		deepSeekUsed: false,
	}, [equipment], locale);
}

export function localEquipmentAnswer(question, catalog, locale = "zh") {
	const equipment = findLocalEquipment(question, catalog);
	return equipment ? localEquipmentAnswerForItem(question, equipment, locale) : null;
}

export function localEquipmentRecommendations(question, catalog, locale = "zh", history = []) {
	// A broad category (for example lower + relaxation) is not evidence that a
	// facility addresses knee pain. Never turn a symptom refusal/network failure
	// into a category-based prescription.
	if (symptomConcern(question, history)) return [];
	const text = String(question || "").toLocaleLowerCase();
	const normalized = normalizeEquipmentLookup(text);
	if (!normalized || /(胸痛|胸口痛|呼吸困難|呼吸困难|無法站立|无法站立|突然劇痛|突然剧痛|嚴重腫脹|严重肿胀|chestpain|difficultybreathing|cannotstand|suddenseverepain)/i.test(normalized)) return [];
	const explicitlyRequested = /(推薦|推荐|建議|建议|適合|适合|用什麼|用什么|哪個器材|哪个器材|器材|器械|設施|设施|鍛煉|锻炼|訓練|训练|伸展|拉伸|放鬆|放松|按摩|舒緩|舒缓|強化|强化|recommend|suggest|suitable|equipment|machine|whatshouldiuse|exercise|train|stretch|relax|massage|strengthen)/i.test(normalized);
	if (!explicitlyRequested) return [];

	const focus = /(腿|腳|脚|膝|髖|髋|足|踝|小腿|下肢|leg|legs|knee|knees|hip|hips|calf|calves|feet|foot|ankle|ankles|lowerbody)/i.test(normalized)
		? "lower"
		: /(肩|手|臂|肘|腕|上肢|shoulder|shoulders|arm|arms|hand|hands|elbow|elbows|wrist|wrists|upperbody)/i.test(normalized)
			? "upper"
			: /(腰|背|脊|腰椎|頸|颈|back|waist|spine|neck)/i.test(normalized)
				? "back"
				: /(平衡|跌|站不穩|站不稳|balance|fall)/i.test(normalized)
					? "balance"
					: /(心肺|帶氧|带氧|aerobic|cardio)/i.test(normalized)
						? "aerobic"
						: /(放鬆|放松|按摩|舒緩|舒缓|relax|relaxation|massage|release)/i.test(normalized)
							? "relaxation"
							: "";
	if (!focus) return [];

	const discomfort = /(疼|痛|酸|不適|不适|僵硬|pain|sore|ache|stiff|discomfort)/i.test(normalized);
	const focusLabels = {
		zh: { lower: "下肢", upper: "上肢", back: "腰背", balance: "平衡", aerobic: "帶氧", relaxation: "放鬆" },
		en: { lower: "lower-body", upper: "upper-body", back: "back", balance: "balance", aerobic: "aerobic", relaxation: "relaxation" },
	};
	return (Array.isArray(catalog) ? catalog : [])
		.filter((item) => item && item.id != null && item.isActive !== false && !item.deletedAt)
		.map((item, index) => {
			const categories = Array.isArray(item.categories) ? item.categories : [];
			const matchesFocus = focus === "back"
				? categories.includes("back")
				: categories.includes(focus);
			if (!matchesFocus) return null;
			const score = 10
				+ (categories.includes("mobility") ? 2 : 0)
				+ (discomfort && categories.includes("relaxation") ? 4 : 0)
				- (discomfort && categories.includes("aerobic") ? 2 : 0);
			return { item, index, score };
		})
		.filter(Boolean)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, 3)
		.map(({ item }) => ({
			id: String(item.id),
			name: item.name || item.nameZh || item.nameEn || "",
			reason: locale === "en"
				? `This Facility Guide item is categorized for ${focusLabels.en[focus]} activity. Open the guide and start gently.${discomfort ? " Stop if the pain worsens and seek professional advice." : ""}`
				: `此設施在APP內歸類為${focusLabels.zh[focus]}相關器材，可先查看設施教學並按自身情況慢慢進行。${discomfort ? "如疼痛加劇，請立即停止並諮詢專業人員。" : ""}`,
		}));
}

/** Recheck old symptom replies without deleting or rewriting stored history. */
export function assistantMessagesForDisplay(messages, catalog, locale = "zh") {
	const history = [];
	let question = "";
	let questionHistory = [];
	return (Array.isArray(messages) ? messages : []).map((message) => {
		if (!message || message.id === "welcome") return message;
		if (message.sender === "user") {
			question = message.text || message.reply || "";
			questionHistory = history.slice(-8);
			history.push({ role: "user", content: question });
			return message;
		}
		let displayed = message;
		const verifiedDeepSeekPolicy = message.evidencePolicy === "app-symptom-deepseek-v2"
			&& message.deepSeekUsed === true && message.recommendationsFinal === true
			&& message.source === "app_content" && message.knowledgeSource === "facility_guide";
		// Photo identification/confirmation and map actions are separate flows,
		// not symptom recommendations. Preserve their existing interaction state.
		const independentAction = message.confirmationRequired || ["image_confirmation", "facility", "auth_error", "error"].includes(message.action);
		if (message.sender === "ai" && message.evidencePolicy === "app-symptom-deepseek-v2" && !independentAction) {
			const concern = symptomConcern(question, questionHistory);
			const supplied = Array.isArray(message.recommendations) ? message.recommendations : [];
			const recommendations = resolveEquipmentRecommendations(supplied, catalog, locale).filter(item => {
				const expected = concern && !item.deleted_at ? symptomEvidence(item, concern) : null;
				const proposed = item.evidence;
				// Keep the backend's model-written explanation, but only retain cards
				// whose current APP passage independently supports this same concern.
				// A policy flag or a body-area category is not evidence on its own.
				return expected && proposed?.field === expected.field && proposed?.quote === expected.quote
					&& Array.isArray(proposed.targets) && JSON.stringify([...proposed.targets].sort()) === JSON.stringify([...expected.targets].sort());
			});
			// An edited/removed passage can remain inside the saved base paragraph.
			// Do not merely hide its card while continuing to display or read out
			// that obsolete claim. Ask for a fresh server answer without inventing
			// local replacement recommendations or mutating the stored message.
			const valid = verifiedDeepSeekPolicy && Array.isArray(message.recommendations)
				&& recommendations.length === supplied.length;
			displayed = valid ? { ...message, recommendations } : {
				...message, recommendations: [], text: undefined,
				equipmentReplyVersion: undefined, equipmentReplyBase: undefined, tcmInReply: false,
				reply: locale === "en"
					? "The information supporting this reply has changed or could not be verified. Please send your question again for an updated answer."
					: "這則回答所依據的設施說明已更新或未能核實，請重新發送問題，以取得最新回答。",
			};
		} else if (message.sender === "ai" && question && !independentAction && symptomConcern(question, questionHistory)) {
			const answer = symptomGuideAnswer(question, catalog, locale, questionHistory) || localEquipmentAnswer(question, catalog, locale);
			if (answer) displayed = { ...message, equipmentReplyVersion: undefined, equipmentReplyBase: undefined, ...answer, tcmInReply: false, text: undefined };
		} else if (message.sender === "ai" && !independentAction && (message.tcmInReply || (question && requestedSection(question) === "tcmTip"))) {
			// Explicit TCM replies must also reflect a later maintenance edit or
			// disabled flag. Prefer stable IDs: names can change and history may
			// begin with an AI reply after its question has been trimmed away.
			const ids = [...new Set((Array.isArray(message.recommendations) ? message.recommendations : [])
				.filter(item => item?.id != null).map(item => String(item.id)))];
			const current = ids.length === 1
				? (Array.isArray(catalog) ? catalog : []).find(item => String(item.id) === ids[0] && item.isActive !== false && !item.deletedAt)
				: ids.length === 0 ? findLocalEquipment(question, catalog) : null;
			const answer = localEquipmentAnswerForItem(locale === "en" ? "TCM perspective" : "中醫學角度", current, locale) || {
				reply: locale === "en" ? "The previously quoted TCM information is no longer available. Please check the current Facility Guide." : "先前引用的中醫資料目前不可顯示，請查看現有設施教學。",
				action: "equipment_local", recommendations: [], tcmInReply: false,
				source: "app_content", knowledgeSource: "facility_guide", deepSeekUsed: false,
			};
			displayed = { ...message, equipmentReplyVersion: undefined, equipmentReplyBase: undefined, ...answer, text: undefined };
		}
		const hasArticle = displayed.equipmentReplyVersion === "app-equipment-prose-v1";
		const hasCards = Array.isArray(displayed.recommendations) && displayed.recommendations.length > 0;
		const blocksArticle = ["image_confirmation", "facility", "auth_error", "error"].includes(displayed.action)
			|| displayed.confirmationAnswered === "no" || (displayed.confirmationRequired && displayed.confirmationAnswered !== "yes");
		if (message.sender === "ai" && (hasArticle || (hasCards && !blocksArticle))) {
			// Build the article from the current APP catalog for fresh replies and
			// restored history alike. Generated sections carry their separate base,
			// so later edits/visibility changes replace them instead of duplicating.
			displayed = withEquipmentTcmReply({ ...displayed, reply: displayed.text || displayed.reply || "", text: undefined }, catalog, locale);
		}
		history.push({ role: "assistant", content: displayed.text || displayed.reply || "" });
		return displayed;
	});
}
