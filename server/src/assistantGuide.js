import { assistantLocalEquipmentMatch, normalizeEquipmentLookup } from "./assistant.js";
import { symptomConcern } from "./assistantSymptomEvidence.js";

const FIELDS = ["details", "kinesiologyTip", "ptTip", "otTip", "tcmTip", "careTip"];
const PAGE_CHARACTERS = 4000;
export const ASSISTANT_GUIDE_LIMITS = Object.freeze({ modelCalls: 3, toolCalls: 4, timeoutMs: 55_000 });

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

export const ASSISTANT_GUIDE_TOOLS = [
	{ type: "function", function: { name: "search_facility_guide", description: "Read-only search of currently published APP Facility Guide names, categories and prose in the requested language. Use a short keyword or an empty query to list guides. This cannot read users, messages, exercise records, credentials, admin permissions, files or the internet.", parameters: {
		type: "object", properties: { query: { type: "string", maxLength: 120 }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, required: ["query"], additionalProperties: false,
	} } },
	{ type: "function", function: { name: "get_facility_guide", description: "Read current APP instructions and professional tips for a published guide ID. Omit fields to read all fields. TCM is available only when enabled in the requested language. Each field is paginated at 4000 characters: use nextOffset with the same field to continue. Never infer missing text or treat a partial field as complete instructions.", parameters: {
		type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 200 }, fields: { type: "array", items: { type: "string", enum: FIELDS }, minItems: 1, maxItems: 6 }, offset: { type: "integer", minimum: 0, maximum: 1000000 } }, required: ["id"], additionalProperties: false,
	} } },
];

function published(item) { return item && item.id != null && item.isActive !== false && !item.deletedAt && !item.deleted_at; }
function categoryLabels(getCategories, locale) {
	return getCategories().filter(item => item.showInGuide !== false && !item.isLocked)
		.map(item => ({ id: String(item.id), name: String(item[locale === "en" ? "nameEn" : "nameZh"] || "").slice(0, 120) }));
}
function publicGuide(item, categories) {
	const allowedCategories = new Set(categories.map(category => category.id));
	const fields = Object.fromEntries(FIELDS.filter(field => field !== "tcmTip" || item.tcmEnabled === true)
		.map(field => [field, typeof item[field] === "string" ? item[field] : ""]).filter(([, text]) => text.trim()));
	return { id: String(item.id), name: String(item.name || "").slice(0, 120), categories: (item.categories || []).filter(id => allowedCategories.has(id)), fields };
}

// This closure has access only to allowlisted public catalog readers. It never
// receives the request, user, SQL executor, filesystem or network capabilities.
export function createAssistantGuideAccess({ getCatalog, getCategories, locale }) {
	const reads = new Map();
	const readFields = new Map();
	let used = false;
	const current = () => {
		const categories = categoryLabels(getCategories, locale);
		return { categories, guides: getCatalog().filter(published).map(item => publicGuide(item, categories)) };
	};
	return {
		categories: () => categoryLabels(getCategories, locale),
		wasUsed: () => used,
		run(call) {
			if (call?.type !== "function" || !ASSISTANT_GUIDE_TOOLS.some(tool => tool.function.name === call.function?.name)) return { error: "toolNotAllowed" };
			used = true;
			let args;
			try {
				if (typeof call.function.arguments !== "string" || call.function.arguments.length > 2000) throw new Error();
				args = JSON.parse(call.function.arguments);
			} catch { return { error: "invalidToolArguments" }; }
			if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "invalidToolArguments" };
			const search = call.function.name === "search_facility_guide";
			if (Object.keys(args).some(key => !(search ? ["query", "offset"] : ["id", "fields", "offset"]).includes(key))) return { error: "invalidToolArguments" };
			const offset = args.offset ?? 0;
			if (!Number.isInteger(offset) || offset < 0 || offset > (search ? 10000 : 1000000)) return { error: "invalidToolArguments" };
			if (search && (typeof args.query !== "string" || args.query.length > 120)) return { error: "invalidToolArguments" };
			if (!search && (typeof args.id !== "string" || !args.id.trim() || args.id.length > 200 || (args.fields !== undefined && (!Array.isArray(args.fields) || !args.fields.length || args.fields.length > 6 || args.fields.some(field => !FIELDS.includes(field)))))) return { error: "invalidToolArguments" };
			const { guides, categories } = current();
			if (search) {
				const query = normalizeEquipmentLookup(args.query);
				const matches = guides.filter(guide => !query || normalizeEquipmentLookup([guide.name,
					...categories.filter(category => guide.categories.includes(category.id)).map(category => category.name),
					...Object.values(guide.fields)].join(" ")).includes(query));
				return { source: "facility_guide", locale, categories, totalMatches: matches.length, nextOffset: offset + 8 < matches.length ? offset + 8 : null,
					items: matches.slice(offset, offset + 8).map(({ fields, ...guide }) => ({ ...guide, availableFields: Object.keys(fields) })) };
			}
			const guide = guides.find(item => item.id === args.id);
			if (!guide) return { error: "guideNotFound" };
			const snapshot = JSON.stringify(guide);
			if (reads.has(guide.id) && reads.get(guide.id) !== snapshot) return { error: "guideChangedRetry" };
			reads.set(guide.id, snapshot);
			const selectedFields = (args.fields || FIELDS).filter(field => Object.hasOwn(guide.fields, field));
			const previouslyRead = readFields.get(guide.id) || new Set();
			for (const field of selectedFields) if (offset < guide.fields[field].length) previouslyRead.add(field);
			readFields.set(guide.id, previouslyRead);
			return { source: "facility_guide", locale, id: guide.id, name: guide.name, categories: guide.categories,
				fields: selectedFields.map(field => {
					const text = guide.fields[field];
					return { field, text: text.slice(offset, offset + PAGE_CHARACTERS), totalCharacters: text.length, offset, nextOffset: offset + PAGE_CHARACTERS < text.length ? offset + PAGE_CHARACTERS : null };
				}) };
		},
		isCurrent() {
			const guides = new Map(current().guides.map(guide => [guide.id, JSON.stringify(guide)]));
			return [...reads].every(([id, snapshot]) => guides.get(id) === snapshot);
		},
		references(generated) {
			const guides = new Map(current().guides.map(guide => [guide.id, guide]));
			const seen = new Set();
			return (Array.isArray(generated?.guideReferences) ? generated.guideReferences : []).slice(0, 3).flatMap(reference => {
				const guide = typeof reference?.id === "string" ? guides.get(reference.id) : null;
				if (!guide || seen.has(guide.id) || reads.get(guide.id) !== JSON.stringify(guide)) return [];
				const field = FIELDS.includes(reference.field) ? reference.field : "details";
				if (!Object.hasOwn(guide.fields, field) || !readFields.get(guide.id)?.has(field)) return [];
				seen.add(guide.id);
				return [{ id: guide.id, name: guide.name, field, text: guide.fields[field] }];
			});
		},
	};
}

export class AssistantGuideError extends Error {
	constructor(code) { super(code); this.code = code; }
}

// DeepSeek thinking + tools requires reasoning_content to be returned with
// the assistant tool-call message (official /guides/thinking_mode/). Never send
// that private provider trace to the APP, persist it, or accept it from clients.
export async function completeAssistantWithGuide({ client, body, access, timeoutMs = ASSISTANT_GUIDE_LIMITS.timeoutMs }) {
	const controller = new AbortController();
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => { controller.abort(); reject(new AssistantGuideError("deepSeekUnavailable")); }, timeoutMs);
	});
	const messages = [...body.messages];
	let toolCalls = 0;
	const seenIds = new Set();
	try {
		for (let round = 0; round < ASSISTANT_GUIDE_LIMITS.modelCalls; round += 1) {
			const finalRound = round === ASSISTANT_GUIDE_LIMITS.modelCalls - 1 || toolCalls >= ASSISTANT_GUIDE_LIMITS.toolCalls;
			const payload = await Promise.race([client.chat.completions.create({ ...body, messages: [...messages], tools: ASSISTANT_GUIDE_TOOLS, tool_choice: finalRound ? "none" : "auto" }, { signal: controller.signal, maxRetries: 0 }), deadline]);
			const choice = payload?.choices?.[0], message = choice?.message;
			if (!message || (choice.finish_reason && !["stop", "tool_calls"].includes(choice.finish_reason))) throw new AssistantGuideError("deepSeekInvalidResponse");
			const calls = message.tool_calls;
			if (!calls?.length) return payload;
			if (!Array.isArray(calls) || finalRound || calls.length > ASSISTANT_GUIDE_LIMITS.toolCalls - toolCalls || calls.some(call => typeof call?.id !== "string" || !call.id || call.id.length > 200 || seenIds.has(call.id))) throw new AssistantGuideError("deepSeekInvalidResponse");
			for (const call of calls) { if (seenIds.has(call.id)) throw new AssistantGuideError("deepSeekInvalidResponse"); seenIds.add(call.id); }
			messages.push({ role: "assistant", content: typeof message.content === "string" ? message.content : null,
				...(typeof message.reasoning_content === "string" ? { reasoning_content: message.reasoning_content } : {}), tool_calls: calls });
			for (const call of calls) {
				toolCalls += 1;
				messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(access.run(call)) });
			}
		}
		throw new AssistantGuideError("deepSeekInvalidResponse");
	} finally { clearTimeout(timer); }
}

export function assistantGuideReply(references, locale) {
	const en = locale === "en";
	const labels = {
		details: en ? "Instructions" : "使用說明", kinesiologyTip: en ? "Exercise specialist tips" : "運動學專家介紹",
		ptTip: en ? "Physiotherapy tips" : "物理治療師貼士", otTip: en ? "Occupational therapy tips" : "職業治療師貼士",
		tcmTip: en ? "TCM background" : "中醫背景", careTip: en ? "Care tips" : "護理貼士",
	};
	let remaining = 6000;
	return references.map(reference => {
		// Keep the whole section, including warnings; never cut an instruction in
		// half to fit the reply. Long sections remain available in the guide.
		const fits = reference.text.length <= remaining;
		if (fits) remaining -= reference.text.length;
		const text = fits ? reference.text : en ? "Open this Facility Guide for the complete section and precautions." : "請開啟此設施教學，查看完整段落和注意事項。";
		return `${reference.name} — ${labels[reference.field]}\n\n${text}`;
	}).join("\n\n");
}
