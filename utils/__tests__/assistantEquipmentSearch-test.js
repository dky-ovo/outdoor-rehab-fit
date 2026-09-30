import { assistantMessagesForDisplay, findLocalEquipment, localEquipmentAnswer, localEquipmentAnswerForItem, localEquipmentRecommendations, normalizeEquipmentLookup, resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { equipmentTranslations } from "../../constants/Equipments";
import { withEquipmentTcmReply } from "../assistantTcm";

const catalog = [
	{
		id: 0,
		name: "太極揉推器",
		nameEn: "Tai Chi Wheel / Taiji Pushing / Push Hands",
		categories: ["upper", "mobility"],
		details: "雙手握住手柄，以均勻速度推動轉盤。",
		ptTip: "保持在不會加劇疼痛的活動幅度。",
		isActive: true,
	},
	{ id: 10, name: "小腿伸展", categories: ["lower", "mobility"], details: "慢慢伸展小腿。", isActive: true },
	{ id: 18, name: "離地漫步機", categories: ["lower", "aerobic"], details: "雙腳慢慢踏動。", isActive: true },
	{ id: 22, name: "腰背按摩器", categories: ["back", "relaxation"], details: "慢慢上下移動按摩腰背。", isActive: true },
];

test("matches simplified, traditional, English and the legacy Tai Chi equipment name", () => {
	expect(normalizeEquipmentLookup("太极揉推器 怎么使用？")).toContain("太極揉推器");
	expect(findLocalEquipment("太极揉推器怎么使用？", catalog)?.id).toBe(0);
	expect(findLocalEquipment("太極揉腿器如何使用？", catalog)?.id).toBe(0);
	expect(findLocalEquipment("How do I use Push Hands?", catalog)?.id).toBe(0);
});

test("renders APP usage content as the same numbered steps shown in Facility Guide", () => {
	const detailedCatalog = [{
		...catalog[0],
		details: "首先，雙腳分開站立。注意膝關節不能超過腳趾。\n\n兩隻手緊握手柄。\n\n記得力度要適中。",
	}];
	const answer = localEquipmentAnswer("太極揉推器如何使用", detailedCatalog, "zh");
	expect(answer.reply).toBe("使用步驟\n\n1\n首先，雙腳分開站立。\n\n2\n兩隻手緊握手柄。\n\n3\n記得力度要適中。");
	expect(answer.reply).not.toContain("注意膝關節");
	expect(answer.recommendations).toEqual([expect.objectContaining({ id: "0", name: "太極揉推器" })]);
	expect(answer.deepSeekUsed).toBe(false);

	const associated = localEquipmentAnswerForItem("太極揉推器如何使用", detailedCatalog[0], "zh");
	expect(associated.reply).toBe(answer.reply);
});

test("returns all 11 APP steps for Tai Chi Wheel without the separate warning text", () => {
	const taiChiWheel = equipmentTranslations.zh.equipmentList.find((item) => item.id === 0);
	const answer = localEquipmentAnswer("太極揉推器如何使用", [taiChiWheel], "zh");
	const numberedSteps = answer.reply.match(/(?:^|\n\n)\d+\n/g) || [];
	expect(answer.reply.startsWith("使用步驟")).toBe(true);
	expect(numberedSteps).toHaveLength(11);
	expect(answer.reply).toContain("首先，雙腳分開站立，站立嘅時候雙腳距離同膊頭一樣咁闊");
	expect(answer.reply).toContain("最後，我地反方向再試下。");
	expect(answer.reply).not.toContain("注意膝關節不能超過腳趾");
	expect(answer.recommendations[0]).toMatchObject({ id: "0", name: "太極揉推器" });
});

test("returns an immediate Facility Guide answer and a stable detail entry", () => {
	const result = localEquipmentAnswer("太极揉推器怎么使用？", catalog, "zh");
	expect(result.source).toBe("app_content");
	expect(result.deepSeekUsed).toBe(false);
	expect(result.reply).toContain("使用步驟");
	expect(result.reply).toContain("雙手握住手柄");
	expect(result.recommendations[0]).toMatchObject({ id: "0", name: "太極揉推器" });
	expect(result.action).toBe("equipment_local");
});

test("does not intercept a general health or greeting question", () => {
	expect(localEquipmentAnswer("你好", catalog, "zh")).toBeNull();
	expect(localEquipmentAnswer("我的腿疼，应该怎么办？", catalog, "zh")).toBeNull();
	expect(localEquipmentAnswer("太極揉推器適合我的腿痛嗎？", catalog, "zh")).toBeNull();
});

test.each([
	"How do I use Tai Chi Wheel when my knee hurts?",
	"How do I use Tai Chi Wheel with a sore wrist?",
	"How do I use Tai Chi Wheel when my neck is stiff?",
])("named usage mixed with symptoms cannot override evidence handling: %s", (question) => {
	expect(localEquipmentAnswer(question, catalog, "en")).toBeNull();
	expect(localEquipmentAnswerForItem(question, catalog[0], "en")).toBeNull();
});

test("restored and model recommendations only open valid active catalog entries", () => {
	const entries = [...catalog, { id: 99, name: "Archived", isActive: false }, { id: 100, deletedAt: "2026-09-01" }];
	const result = resolveEquipmentRecommendations([null, { id: 404, name: "Invented" }, { id: 0, name: "Old name" }, { id: "0" }, { id: 99 }, { id: 100 }], entries);
	expect(result).toHaveLength(1);
	expect(result[0]).toMatchObject({ id: 0, name: "太極揉推器" });
	expect(resolveEquipmentRecommendations({}, entries)).toEqual([]);
});

test("category references are available for non-symptom activity requests only", () => {
	const recommendations = localEquipmentRecommendations("推荐下肢运动器材", catalog, "zh");
	expect(recommendations.map((item) => item.id)).toEqual(["10", "18"]);
	expect(recommendations.every((item) => item.reason.includes("下肢"))).toBe(true);
	expect(localEquipmentRecommendations("你好", catalog, "zh")).toEqual([]);
	expect(localEquipmentRecommendations("胸痛，推荐器材", catalog, "zh")).toEqual([]);
});

test.each([
	"我的腿疼，推荐什么器材？", "我的膝蓋疼，推薦器材", "What can I use for knee pain?", "膝關節不適，適合什麼設施？",
])("never uses category-only fallback for symptoms: %s", (question) => {
	expect(localEquipmentRecommendations(question, [...catalog, { id: 28, name: "石春路", categories: ["lower", "relaxation"] }], "zh")).toEqual([]);
});

test("old symptom replies are rebuilt for display without altering stored conversation", () => {
	const original = [
		{ id: "u1", sender: "user", text: "我的膝蓋疼，推薦器材" },
		{ id: "a1", sender: "ai", text: "錯誤舊資料：石春路可以醫治膝蓋疼。", action: "equipment", source: "app_content", recommendations: [{ id: 28, reason: "下肢放鬆" }] },
	];
	const before = JSON.stringify(original);
	const displayed = assistantMessagesForDisplay(original, [...catalog, { id: 28, name: "石春路", categories: ["lower", "relaxation"], ptTip: "刺激腳底，放鬆足部肌肉。" }]);
	expect(displayed[0]).toBe(original[0]);
	expect(displayed[1].id).toBe("a1");
	expect(displayed[1].reply).not.toContain("可以醫治");
	expect(displayed[1].text).toBeUndefined();
	expect(displayed[1].recommendations).toEqual([]);
	expect(JSON.stringify(original)).toBe(before);
});

test("history reconstruction preserves independent image confirmation and map actions", () => {
	const original = [
		{ id: "u1", sender: "user", text: "我的膝蓋疼，推薦器材" },
		{ id: "a1", sender: "ai", reply: "附近位置", action: "facility", facility: { latitude: 22.3, longitude: 114.2 } },
		{ id: "a2", sender: "ai", reply: "辨識照片", confirmationRequired: true, recommendations: [{ id: 28 }] },
		{ id: "a3", sender: "ai", reply: "已確認", action: "image_confirmation" },
	];
	const displayed = assistantMessagesForDisplay(original, catalog);
	for (let index = 0; index < original.length; index += 1) expect(displayed[index]).toBe(original[index]);
});

test("repeated symptom follow-ups never restore category-only foot-path cards", () => {
	const entries = [
		{ id: 10, name: "小腿伸展", categories: ["lower", "mobility"], ptTip: "伸展可以幫助膝關節炎患者減輕膝關節痛楚。" },
		{ id: 28, name: "石春路", categories: ["lower", "relaxation"], ptTip: "刺激腳底，放鬆足部肌肉。" },
	];
	const questions = ["我膝頭哥痛", "那有哪些器材？", "還有其他選擇？", "那有放鬆器材嗎？"];
	const stored = questions.flatMap((text, index) => [
		{ id: `u${index}`, sender: "user", text },
		{ id: `a${index}`, sender: "ai", action: "equipment", reply: "舊分類推薦", recommendations: [{ id: 28 }] },
	]);
	const before = JSON.stringify(stored);
	const displayed = assistantMessagesForDisplay(stored, entries);
	expect(displayed[1].recommendations).toEqual([]);
	for (const index of [3, 5, 7]) {
		expect(displayed[index].recommendations.map(item => item.id)).toEqual(["10"]);
		expect(displayed[index].recommendations[0].reason).toContain(entries[0].ptTip);
	}
	expect(JSON.stringify(stored)).toBe(before);
	expect(localEquipmentRecommendations(questions[3], entries, "zh", questions.slice(0, 3).map(content => ({ role: "user", content })))).toEqual([]);
});

const kneeQuote = "伸展可以幫助膝關節炎患者減輕膝關節痛楚。";
const verifiedCatalog = [
	{ ...catalog[1], ptTip: kneeQuote },
	{ id: 31, name: "膝部伸展", isActive: true, ptTip: "膝部伸展可以舒緩膝部疼痛。" },
	{ id: 28, name: "石春路", isActive: true, categories: ["lower", "relaxation"], ptTip: "刺激腳底，放鬆足部肌肉。" },
];
const v2Answer = (overrides = {}) => withEquipmentTcmReply({
	id: "v2", sender: "ai", action: "equipment_evidence", source: "app_content", knowledgeSource: "facility_guide",
	evidencePolicy: "app-symptom-deepseek-v2", deepSeekUsed: true, recommendationsFinal: true,
	reply: "我了解您走路時膝蓋不舒服，先一起了解小腿伸展的說明。",
	recommendations: [{ id: "10", reason: `物理治療說明：${kneeQuote}`, evidence: { field: "ptTip", quote: kneeQuote, targets: ["knee"] } }],
	...overrides,
}, verifiedCatalog);
const displayV2 = (answer, entries = verifiedCatalog, question = "我的膝蓋痛，推薦器材") => assistantMessagesForDisplay([
	{ id: "u1", sender: "user", text: question }, answer,
], entries)[1];

test("verified v2 preserves DeepSeek's answer, selected order and evidence instead of local symptom replies", () => {
	const answer = v2Answer({ recommendations: [
		{ id: "31", reason: "膝部伸展可以舒緩膝部疼痛。", evidence: { field: "ptTip", quote: verifiedCatalog[1].ptTip, targets: ["knee"] } },
		{ id: "10", reason: kneeQuote, evidence: { field: "ptTip", quote: kneeQuote, targets: ["knee"] } },
	] });
	const before = JSON.stringify(answer);
	const displayed = displayV2(answer);
	expect(displayed.reply).toBe(answer.reply);
	expect(displayed.equipmentReplyBase).toBe(answer.equipmentReplyBase);
	expect(displayed.recommendations.map(item => String(item.id))).toEqual(["31", "10"]);
	expect(displayed.deepSeekUsed).toBe(true);
	expect(displayed.reply).not.toContain("具體是哪個部位");
	expect(JSON.stringify(answer)).toBe(before);
});

test("v2 no-card clarification remains the backend response without local category replacements", () => {
	const answer = v2Answer({ reply: "請告訴我不舒服的部位。", recommendations: [] });
	expect(displayV2(answer, verifiedCatalog, "走路時會痛")).toMatchObject({ reply: answer.reply, recommendations: [], deepSeekUsed: true });
});

test.each([
	["edited passage", [{ ...verifiedCatalog[0], ptTip: "舊內容已刪除。" }]],
	["inactive item", [{ ...verifiedCatalog[0], isActive: false }]],
	["removed item", []],
	["deleted item", [{ ...verifiedCatalog[0], deletedAt: "2026-09-22" }]],
])("v2 %s removes obsolete body and base, not only its card", (_name, entries) => {
	const answer = v2Answer({ reply: `先前說明：${kneeQuote}` });
	const displayed = displayV2(answer, entries);
	expect(displayed.reply).toContain("請重新發送問題");
	expect(displayed.reply).not.toContain(kneeQuote);
	expect(displayed.equipmentReplyBase).toBeUndefined();
	expect(displayed.equipmentReplyVersion).toBeUndefined();
	expect(displayed.recommendations).toEqual([]);
	expect(answer.reply).toContain(kneeQuote);
});

test.each([
	["unknown ID", { id: "404" }],
	["foot path without knee evidence", { id: "28" }],
	["invented quote", { evidence: { field: "ptTip", quote: "膝關節痛可以治癒。", targets: ["knee"] } }],
	["wrong source field", { evidence: { field: "details", quote: kneeQuote, targets: ["knee"] } }],
	["wrong body target", { evidence: { field: "ptTip", quote: kneeQuote, targets: ["foot"] } }],
	["missing evidence", { evidence: undefined }],
])("v2 %s cannot retain invalid claims or gain local replacement cards", (_name, invalid) => {
	const answer = v2Answer();
	answer.recommendations = [{ ...answer.recommendations[0], ...invalid }];
	const displayed = displayV2(answer);
	expect(displayed.recommendations).toEqual([]);
	expect(displayed.reply).toContain("請重新發送問題");
	expect(displayed.equipmentReplyBase).toBeUndefined();
});

test.each([{ deepSeekUsed: false }, { recommendationsFinal: false }, { source: "external_search" }, { knowledgeSource: "model_guess" }])("incomplete v2 flags %j never fabricate a local AI recommendation", flags => {
	const displayed = displayV2(v2Answer(flags));
	expect(displayed.recommendations).toEqual([]);
	expect(displayed.reply).toContain("未能核實");
});

test("v2 follows the user history's knee concern without borrowing an assistant's foot statement", () => {
	const displayed = assistantMessagesForDisplay([
		{ id: "u0", sender: "user", text: "我的膝蓋痛，推薦器材" },
		{ id: "a0", sender: "ai", action: "error", reply: "腳底痛" },
		{ id: "u1", sender: "user", text: "走路時會痛" },
		v2Answer(),
	], verifiedCatalog).at(-1);
	expect(displayed.recommendations.map(item => String(item.id))).toEqual(["10"]);
	expect(displayed.reply).toContain("先一起了解小腿伸展");
});

test.each(["继续", "繼續", "详细", "詳細", "more details", "继续说", "详细介绍一下", "再讲详细点", "可以講詳細啲？"])("v2 continuation %s after the knee/walking/request chain keeps verified cards and prose", followup => {
	const questions = ["我有膝蓋痛", "走路時會痛", "推薦器材", followup];
	const messages = questions.flatMap((text, index) => [
		{ id: `continuation-u${index}`, sender: "user", text },
		{ ...v2Answer(), id: `continuation-a${index}` },
	]);
	const displayed = assistantMessagesForDisplay(messages, verifiedCatalog);
	for (const index of [1, 3, 5, 7]) {
		expect(displayed[index].reply).toBe(messages[index].reply);
		expect(displayed[index].deepSeekUsed).toBe(true);
		expect(displayed[index].recommendations.map(item => String(item.id))).toEqual(["10"]);
	}
});

test.each(["幫我整理今天的行程", "附近公園在哪裡", "你好", "继续聊旅游"])("continuation does not inherit the knee topic after unrelated turn %s", topic => {
	const questions = ["我有膝蓋痛，推薦器材", topic, "继续"];
	const messages = questions.flatMap((text, index) => [
		{ id: `changed-u${index}`, sender: "user", text },
		index === 1 ? { id: "changed-a1", sender: "ai", reply: "另一個話題的回答", recommendations: [] }
			: { ...v2Answer(), id: `changed-a${index}` },
	]);
	const last = assistantMessagesForDisplay(messages, verifiedCatalog).at(-1);
	expect(last.recommendations).toEqual([]);
	expect(last.reply).toContain("請重新發送問題");
	expect(last.reply).not.toContain(kneeQuote);
});

test.each([
	["disabled", { tcmEnabled: false, tcmTip: "舊版中醫背景資料。" }],
	["edited", { tcmEnabled: true, tcmTip: "新版中醫背景資料。" }],
	["removed", { tcmEnabled: true, tcmTip: "" }],
])("v2 appended TCM %s refreshes without retaining the old TCM inside the base", (_name, change) => {
	const initial = { ...verifiedCatalog[0], tcmEnabled: true, tcmTip: "舊版中醫背景資料。" };
	const answer = withEquipmentTcmReply(v2Answer(), [initial]);
	expect(answer.reply).toContain(initial.tcmTip);
	expect(answer.equipmentReplyBase).not.toContain(initial.tcmTip);
	const displayed = displayV2(answer, [{ ...initial, ...change }]);
	expect(displayed.reply).not.toContain(initial.tcmTip);
	expect(displayed.equipmentReplyBase).toBe(answer.equipmentReplyBase);
	expect(displayed.recommendations.map(item => String(item.id))).toEqual(["10"]);
	if (change.tcmEnabled && change.tcmTip) expect(displayed.reply).toContain(change.tcmTip);
	expect(answer.reply).toContain(initial.tcmTip);
});

test("disabling TCM that is itself the v2 symptom evidence clears its old quoted base", () => {
	const initial = { ...verifiedCatalog[0], ptTip: "", tcmEnabled: true, tcmTip: "伸展有助舒緩膝關節疼痛。" };
	const answer = withEquipmentTcmReply({ ...v2Answer(), equipmentReplyBase: initial.tcmTip, recommendations: [
		{ id: "10", reason: initial.tcmTip, evidence: { field: "tcmTip", quote: initial.tcmTip, targets: ["knee"] } },
	] }, [initial]);
	const displayed = displayV2(answer, [{ ...initial, tcmEnabled: false }]);
	expect(displayed.reply).not.toContain(initial.tcmTip);
	expect(displayed.equipmentReplyBase).toBeUndefined();
	expect(displayed.recommendations).toEqual([]);
	expect(displayed.reply).toContain("請重新發送問題");
});
