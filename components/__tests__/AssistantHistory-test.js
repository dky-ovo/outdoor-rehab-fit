import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import AiChatbox from "../../app/(tabs)/chat";
import { getEquipmentCatalog, sendAssistantMessage } from "../../utils/api";
import { LocaleContext } from "../../contexts/LocaleContext";
import { equipmentTranslations } from "../../constants/Equipments";
import { withEquipmentTcmReply } from '../../utils/assistantTcm';
import { formatEquipmentInstructionSteps } from "../../utils/equipmentInstructions";
import { currentAssistantConversation, mockCurrentAssistantConversation, persistedCurrentAssistantMessages } from "../../scripts/test-helpers/assistantConversationFixtures";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../hooks/useAssistantVoiceInput", () => ({ useAssistantVoiceInput: () => ({ status: "idle", interimText: "", errorCode: null, isSupported: false, start: jest.fn(async () => false), stop: jest.fn(async () => {}), cancel: jest.fn(async () => {}) }) }));
const mockEquipmentCatalog = [
	{ id: 0, name: "太極揉推器", nameEn: "Tai Chi Wheel", details: "雙手握住手柄。", categories: ["upper", "mobility"] },
	{ id: 10, name: "小腿伸展", details: "慢慢伸展小腿。", categories: ["lower", "mobility"] },
	{ id: 28, name: "石春路", details: "扶着欄杆慢慢步行。", ptTip: "刺激腳底，放鬆足部肌肉。", categories: ["lower", "relaxation"] },
];
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({
	LocaleContext: require("react").createContext({ locale: "zh", i18n: { t: (key) => key === "equipmentList" ? mockEquipmentCatalog : key } }),
}));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { id: "one", token: "test", assistantSessionId: "test-session" }, isGuest: false, isUser: true, isLoading: false }) }));
jest.mock("../../utils/api", () => { const sendAssistantMessage = jest.fn(); return ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), sendAssistantMessage, ...require("../../scripts/test-helpers/assistantJobApi").assistantJobApi(sendAssistantMessage), resolveApiAssetUrl: (value) => value }); });
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ inset: 0, visible: false }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 48 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-constants", () => ({ nativeBuildVersion: "14" }));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

let tree;
beforeEach(() => {
	jest.clearAllMocks();
	mockCurrentAssistantConversation(AsyncStorage, []);
	AsyncStorage.setItem.mockResolvedValue();
	getEquipmentCatalog.mockResolvedValue({ items: [] });
	sendAssistantMessage.mockResolvedValue({ reply: "安全回覆", recommendations: [] });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const mount = async () => act(async () => { tree = renderer.create(<AiChatbox />); });
const send = async (query) => {
	await act(async () => tree.root.findByType(TextInput).props.onChangeText(query));
	const buttons = tree.root.findAllByType(TouchableOpacity);
	await act(async () => buttons[buttons.length - 1].props.onPress());
};
// The inverted visual list is newest-first; assertions below concern the
// chronological conversation used by persistence and the assistant API.
const displayed = () => [...tree.root.findByType(FlatList).props.data].reverse();
const visibleTexts = () => tree.root.findAllByType(Text).map((node) => node.props.children).filter((value) => typeof value === "string");
const replyNode = (id) => tree.root.findAllByType(Text).find((node) => node.props.testID === `assistant-reply-${id}`);
// The native list virtualizes older rows. Use its real render callback to
// inspect an off-screen row, without disabling virtualization in production.
const rowPreview = id => {
	const list = tree.root.findByType(FlatList);
	const item = list.props.data.find(message => message.id === id);
	const findText = node => {
		if (!React.isValidElement(node)) return undefined;
		if (node.props.testID === `assistant-reply-${id}`) return node.props.children;
		return React.Children.toArray(node.props.children).map(findText).find(value => value !== undefined);
	};
	return findText(list.props.renderItem({ item }));
};
const equipmentCard = (messageId, equipmentId) => tree.root.findAll((node) => node.props.testID === `assistant-equipment-${messageId}-${equipmentId}`)[0];
const cardText = (messageId, equipmentId) => equipmentCard(messageId, equipmentId).findAllByType(Text).map((node) => node.props.children).flat().join("\n");
const expandButton = (id) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === `assistant-expand-${id}`);
const toggleExplanation = async (id) => {
	const button = expandButton(id);
	expect(button).toBeTruthy();
	await act(async () => button.props.onPress());
};
const detailsText = () => tree.root.findAllByType(Text).find(node => node.props.testID === "assistant-reply-details-text")?.props.children;
const closeExplanation = async () => act(async () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "assistant-reply-details-close").props.onPress());
const expectDetailInvitation = (preview, locale) => {
	expect(preview).toContain(locale === "en" ? "View details" : "查看詳細說明");
	expect(preview).toContain(locale === "en" ? "equipment card" : "下方器材");
	expect(preview).not.toMatch(/For example:|例如：/);
};
const expectFirstEquipmentExplanation = (preview, answer, locale) => {
	expectDetailInvitation(preview, locale);
	expect(preview).toContain(answer.recommendations[0].name);
	expect(preview).toContain(answer.recommendations[0].evidence.quote);
	expect(preview).toContain(locale === "en" ? "From a traditional Chinese medicine perspective:" : "從中醫學角度：");
};
const expectFixedMedicalNotice = () => {
	expect(visibleTexts().filter(text => text === "aiMedicalNotice")).toHaveLength(1);
	expect(tree.root.findByType(FlatList).findAllByType(Text).some(node => node.props.children === "aiMedicalNotice")).toBe(false);
};
const sourceWrapping = /資料來源：APP|推薦依據：APP|Source: In-app|Based on: In-app|（APP原文(?:節錄)?）|\(APP excerpt\)|APP「[^」]+」原文|APP excerpt —|根據APP設施教學|根據APP內「設施教學|以下內容來自「設施教學|According to the APP Facility Guide|According to the Facility Guide for|The following information comes from the Facility Guide for|這是APP的中醫背景資料|This is TCM background from the APP/;
const expectNoSourceWrapping = (text) => expect(text).not.toMatch(sourceWrapping);
const mountCatalog = async (entries, locale = "zh") => {
	const value = { locale, i18n: { t: (key) => key === "equipmentList" ? entries : key } };
	await act(async () => { tree = renderer.create(<LocaleContext.Provider value={value}><AiChatbox /></LocaleContext.Provider>); });
};

test("history restoration blocks sending until the current conversation is ready, then preserves both questions", async () => {
	let restoreHistory;
	const restoring = new Promise((resolve) => { restoreHistory = resolve; });
	AsyncStorage.getItem.mockReturnValue(restoring);
	AsyncStorage.setItem.mockResolvedValue();
	getEquipmentCatalog.mockResolvedValue({ items: [] });
	await act(async () => { tree = renderer.create(<AiChatbox />); });
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("太極揉推器如何使用"));
	const buttons = tree.root.findAllByType(TouchableOpacity);
	expect(buttons[buttons.length - 1].props.disabled).toBe(true);
	await act(async () => buttons[buttons.length - 1].props.onPress());
	expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
	expect(sendAssistantMessage).not.toHaveBeenCalled();
	await act(async () => restoreHistory(currentAssistantConversation([{ id: "old", sender: "user", text: "之前的問題" }, null, "invalid"])));
	await send("太極揉推器如何使用");
	const messages = displayed();
	expect(messages.map((item) => item.text).filter(Boolean)).toEqual(["aiChatWelcome", "之前的問題", "太極揉推器如何使用"]);
	expect(messages.some((item) => item.reply?.includes("雙手握住手柄"))).toBe(true);
	expect(sendAssistantMessage).not.toHaveBeenCalled();
	expect(persistedCurrentAssistantMessages(AsyncStorage)).toHaveLength(3);
});

test("legacy v1 messages migrate to read-only history and never become the current request context", async () => {
	const legacyKey = "@outdoor_fit_ai_history_v1:one:zh";
	const archiveKey = "@outdoor_fit_ai_conversations_v2:one:zh";
	const legacy = [
		{ id: "legacy-u", sender: "user", text: "上次登入問過的問題" },
		{ id: "legacy-a", sender: "ai", reply: "上次登入的回答", recommendations: [{ id: 0 }] },
	];
	const bytes = JSON.stringify(legacy);
	const storage = new Map([[legacyKey, bytes]]);
	AsyncStorage.getItem.mockImplementation(async key => storage.get(key) ?? null);
	AsyncStorage.setItem.mockImplementation(async (key, value) => { storage.set(key, value); });
	await mount();
	expect(displayed().map(item => item.id)).toEqual(["welcome"]);
	const archive = JSON.parse(storage.get(archiveKey));
	expect(archive.conversations.find(item => item.legacy)).toMatchObject({ archived: true, legacy: true });
	expect(archive.conversations.find(item => item.legacy).messages.map(item => item.text || item.reply)).toEqual(legacy.map(item => item.text || item.reply));
	await send("你好");
	expect(sendAssistantMessage.mock.calls[0][0].history).toEqual([]);
	expect(displayed().some(item => item.id === "legacy-u" || item.id === "legacy-a")).toBe(false);
	expect(storage.get(legacyKey)).toBe(bytes);
});

test.each([
	"我的膝蓋疼，推薦什麼器材？", "What can I use for knee pain?", "膝關節不適，適合石春路嗎？",
	"How do I use Tai Chi Wheel when my knee hurts?",
	"How do I use Tai Chi Wheel with a sore wrist?",
	"How do I use Tai Chi Wheel when my neck is stiff?",
])("symptom query %s cannot receive old server prose or foot-massage cards", async (query) => {
	sendAssistantMessage.mockResolvedValue({ reply: "石春路可以醫治膝蓋疼。", source: "app_content", recommendations: [{ id: 28, reason: "下肢放鬆" }] });
	await mount();
	await send(query);
	const answer = displayed().at(-1);
	expect(answer.reply).not.toContain("可以醫治");
	expect(answer.recommendations).toEqual([]);
	expect(answer.evidencePolicy).toBe("app-symptom-v1");
	expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
	expect(sendAssistantMessage.mock.calls[0][0].message).toBe(query);
});

test("a usage follow-up to knee pain keeps symptom evidence priority", async () => {
	await mount();
	await send("我的膝蓋疼，推薦器材");
	await send("如何使用太極揉推器");
	const answer = displayed().at(-1);
	expect(answer.evidencePolicy).toBe("app-symptom-v1");
	expect(answer.recommendations).toEqual([]);
	expect(answer.reply).not.toContain("雙手握住手柄");
	expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
});

test("symptom API failure remains an error without fabricating a local recommendation", async () => {
	sendAssistantMessage.mockRejectedValue({ code: "networkError", status: 0 });
	await mount();
	await send("我的膝蓋疼，推薦器材");
	expect(displayed().at(-1).recommendations).toEqual([]);
	expect(displayed().at(-1).action).toBe("error");
	expect(displayed().at(-1).deepSeekUsed).not.toBe(true);
	expect(tree.root.findByType(TextInput).props.value).toBe("我的膝蓋疼，推薦器材");
	expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
});

test("empty successful server recommendations remain empty instead of adding local categories", async () => {
	sendAssistantMessage.mockResolvedValue({ reply: "目前不建議使用器材。", recommendations: [], recommendationsFinal: true });
	await mount();
	await send("推薦下肢運動器材");
	expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
	expect(displayed().at(-1)).toMatchObject({ reply: "目前不建議使用器材。", recommendations: [], recommendationsFinal: true });
});

test("invalid old API IDs are removed, never replaced with category cards", async () => {
	sendAssistantMessage.mockResolvedValue({ reply: "沒有可確認的器材。", recommendations: [{ id: 404 }] });
	await mount();
	await send("推薦下肢運動器材");
	expect(displayed().at(-1).recommendations).toEqual([]);
});

test("failed background task keeps its question without inventing a completed answer", async () => {
	sendAssistantMessage.mockRejectedValue({ code: "networkError", status: 0 });
	await mount();
	await send("推薦下肢運動器材");
	expect(displayed().at(-1).action).toBe("error");
	expect(displayed().at(-1).recommendations).toEqual([]);
});

test.each([{ code: "unauthorized", status: 401 }, { code: "assistantRateLimited", status: 429 }])("API control errors are not hidden by recommendation fallback: %j", async (error) => {
	sendAssistantMessage.mockRejectedValue(error);
	await mount();
	await send("推薦下肢運動器材");
	expect(displayed().at(-1).recommendations).toEqual([]);
	expect(displayed().at(-1).action).toBe(error.status === 401 ? "auth_error" : "error");
});

test("restored incorrect symptom history is shown safely and not fed back to DeepSeek", async () => {
	const original = [
		{ id: "old-user", sender: "user", text: "我的膝蓋疼，推薦器材" },
		{ id: "old-ai", sender: "ai", text: "石春路可以醫治膝蓋疼。", source: "app_content", recommendations: [{ id: "28" }] },
	];
	mockCurrentAssistantConversation(AsyncStorage, original);
	await mount();
	const oldAnswer = displayed().find((item) => item.id === "old-ai");
	expect(oldAnswer.recommendations).toEqual([]);
	expect(oldAnswer.text).toBeUndefined();
	expect(displayed().find((item) => item.id === "old-user").text).toBe(original[0].text);
	expect(persistedCurrentAssistantMessages(AsyncStorage)).toEqual(original);
	await send("你好");
	expect(sendAssistantMessage.mock.calls.at(-1)[0].history.some((item) => item.content.includes("可以醫治"))).toBe(false);
});

test.each([
	["zh", "膝蓋痛，有什麼器材可以參考？"],
	["en", "What equipment can I look up for knee pain?"],
])("%s legacy server symptom responses use actual APP professional excerpts and keep the detail entry", async (locale, query) => {
	const entries = equipmentTranslations[locale].equipmentList;
	const value = { locale, i18n: { t: (key) => key === "equipmentList" ? entries : key } };
	await act(async () => { tree = renderer.create(<LocaleContext.Provider value={value}><AiChatbox /></LocaleContext.Provider>); });
	await send(query);
	const answer = displayed().at(-1);
	expect(answer.recommendations.map((item) => item.id)).toEqual(expect.arrayContaining(["4", "10"]));
	expect(answer.recommendations.some((item) => item.id === "28")).toBe(false);
	const preview = replyNode(answer.id).props.children;
	expectFirstEquipmentExplanation(preview, answer, locale);
	expectFixedMedicalNotice();
	for (const recommendation of answer.recommendations) {
		if (recommendation.evidence.quote !== answer.recommendations[0].evidence.quote) expect(preview).not.toContain(recommendation.evidence.quote);
		if (recommendation.id !== answer.recommendations[0].id && recommendation.tcmExcerpt) expect(preview).not.toContain(recommendation.tcmExcerpt.quote);
		expect(cardText(answer.id, recommendation.id)).not.toContain(recommendation.evidence.quote);
	}
	await toggleExplanation(answer.id);
	expect(detailsText()).toContain(locale === "en" ? "not a diagnosis or confirmation of suitability" : "也不是診斷或治療建議");
	for (const card of answer.recommendations) {
		const equipment = entries.find((item) => String(item.id) === card.id);
		expect(card.evidence.field).toBe("ptTip");
		expect(equipment.ptTip).toContain(card.evidence.quote);
		expect(card.reason).toContain(card.evidence.quote);
		expect(detailsText()).toContain(card.evidence.quote);
		if (card.tcmExcerpt) expect(detailsText()).toContain(card.tcmExcerpt.quote);
	}
	await closeExplanation();
	expect(replyNode(answer.id).props.children).toBe(preview);
	expectFixedMedicalNotice();
	const card = answer.recommendations[0];
	const button = tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === card.name));
	expect(button).toBeTruthy();
	await act(async () => button.props.onPress());
	expect(router.push).toHaveBeenCalledWith({ pathname: "/outdoor/detail", params: { id: card.id, name: card.name, from: "ai" } });
	expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
});

test("current and restored symptom replies follow asynchronous APP maintenance content", async () => {
	let resolveCatalog;
	getEquipmentCatalog.mockImplementation(() => new Promise((resolve) => { resolveCatalog = resolve; }));
	await mount();
	await send("我的膝蓋疼，推薦器材");
	expect(displayed().at(-1).recommendations).toEqual([]);
	const updatedQuote = "這項伸展可舒緩膝關節疼痛。";
	await act(async () => resolveCatalog({ items: [{ id: 10, nameZh: "更新後的小腿伸展", ptTipZh: updatedQuote, isActive: true }] }));
	const answer = displayed().at(-1);
	expect(answer.recommendations).toHaveLength(1);
	expect(answer.recommendations[0]).toMatchObject({ id: "10", name: "更新後的小腿伸展", evidence: { field: "ptTip", quote: updatedQuote } });
});

const tcmQuotes = {
	zh: "太極揉推器的中醫資料原文，供使用者查閱。",
	en: "Original TCM background information for the Tai Chi Wheel, provided for reference.",
};
const tcmCatalog = (locale = "zh", changes = {}) => [{ ...mockEquipmentCatalog[0], name: locale === "en" ? "Tai Chi Wheel" : "太極揉推器", tcmEnabled: true, tcmTip: tcmQuotes[locale], ...changes }];
const restoredCard = (changes = {}) => [
	{ id: "tcm-user", sender: "user", text: "推薦上肢運動器材" },
	{ id: "tcm-ai", sender: "ai", reply: "APP 設施參考", source: "app_recommendation", recommendations: [{ id: "0", reason: "原有設施分類說明" }], ...changes },
];

test.each([
	["zh", "推薦上肢運動器材"],
	["en", "Recommend equipment for upper-body activity."],
])("%s published category answer keeps ordinary reasons and TCM in details below the invitation", async (locale, query) => {
	const tcm = locale === "en" ? "Gentle movement supports the flow of qi." : tcmQuotes.zh;
	const reason = locale === "en"
		? "This equipment is categorized for upper-body activity. Open the guide and start gently."
		: "此設施屬於上肢相關器材，可先查看設施教學並按自身情況慢慢進行。";
	sendAssistantMessage.mockResolvedValue(withEquipmentTcmReply({ action: 'equipment', reply: locale === 'en' ? 'I selected these reference items from the in-app Facility Guide categories. Please read the guide and start gently.' : '我先根據APP內的設施分類，為您篩選以下參考器材。請先閱讀設施教學，並按自身情況慢慢進行。', source: "app_recommendation", recommendations: [{ id: "0", reason }] }, tcmCatalog(locale, { tcmTip: tcm }), locale));
	await mountCatalog(tcmCatalog(locale, { tcmTip: tcm }), locale);
	await send(query);
	const answer = displayed().at(-1);
	expect(answer.source).toBe("app_recommendation");
	expect(answer.recommendations.map(item => item.id)).toEqual(["0"]);
	const preview = replyNode(answer.id).props.children;
	expectDetailInvitation(preview, locale);
	expectFixedMedicalNotice();
	await toggleExplanation(answer.id);
	expect(detailsText()).toContain(reason);
	expect(detailsText()).toContain(tcm);
	await closeExplanation();
	expect(replyNode(answer.id).props.children).toBe(preview);
	expect(cardText(answer.id, 0)).toContain("openFacilityGuide");
	expectFixedMedicalNotice();
});

test.each(["zh", "en"])("%s shows verified TCM in the reply before the compact facility card", async (locale) => {
	mockCurrentAssistantConversation(AsyncStorage, restoredCard());
	await mountCatalog(tcmCatalog(locale), locale);
	const title = locale === "en" ? "From a TCM perspective" : "從中醫學角度";
	const reply = replyNode("tcm-ai");
	expect(reply.props.children).toContain(title);
	expectNoSourceWrapping(reply.props.children);
	expect(reply.props.children).toContain(tcmQuotes[locale]);
	expect(reply.props.children.split(tcmQuotes[locale])).toHaveLength(2);
	expect(visibleTexts().filter((text) => text.includes(tcmQuotes[locale]))).toHaveLength(1);
	const card = equipmentCard("tcm-ai", 0);
	expect(reply.props.children).toContain("原有設施分類說明");
	expect(cardText("tcm-ai", 0)).not.toContain("原有設施分類說明");
	expect(cardText("tcm-ai", 0)).toContain("openFacilityGuide");
	expect(cardText("tcm-ai", 0)).not.toContain(title);
	expect(cardText("tcm-ai", 0)).not.toContain(tcmQuotes[locale]);
	const siblings = reply.parent.children;
	expect(siblings.indexOf(reply)).toBeLessThan(siblings.indexOf(card));
	await act(async () => card.props.onPress());
	expect(router.push).toHaveBeenCalledWith({ pathname: "/outdoor/detail", params: { id: "0", name: tcmCatalog(locale)[0].name, from: "ai" } });
	expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test.each([
	["disabled", { tcmEnabled: false, tcmTip: tcmQuotes.zh }, "zh"],
	["missing", { tcmEnabled: true, tcmTip: undefined }, "zh"],
	["blank", { tcmEnabled: true, tcmTip: "   " }, "zh"],
	["no English translation", { tcmEnabled: true, tcmTip: "", tcmZh: tcmQuotes.zh }, "en"],
])("%s TCM content creates no blank section or inferred prose", async (_name, changes, locale) => {
	mockCurrentAssistantConversation(AsyncStorage, restoredCard({ recommendations: [{ id: 0, tcmExcerpt: { field: "tcmTip", quote: "伪造中医功效" } }] }));
	await mountCatalog(tcmCatalog(locale, changes), locale);
	expect(visibleTexts().join("\n")).not.toContain("中醫學角度（APP原文節錄）");
	expect(visibleTexts().join("\n")).not.toContain("TCM perspective (APP excerpt)");
	expect(visibleTexts().join("\n")).not.toContain("從中醫學角度（APP原文）");
	expect(visibleTexts().join("\n")).not.toContain("From a TCM perspective (APP excerpt)");
	expect(visibleTexts().join("\n")).not.toContain("從中醫學角度");
	expect(visibleTexts().join("\n")).not.toContain("From a TCM perspective");
	expect(visibleTexts().join("\n")).not.toContain("伪造中医功效");
	expect(visibleTexts()).toContain(tcmCatalog(locale)[0].name);
});

test("restored fabricated TCM is recomputed from the current APP catalog without changing stored history", async () => {
	const original = restoredCard({ recommendations: [{ id: "0", tcmExcerpt: { field: "tcmTip", quote: "虚构的治愈承诺" } }] });
	mockCurrentAssistantConversation(AsyncStorage, original);
	await mountCatalog(tcmCatalog());
	expect(replyNode("tcm-ai").props.children).toContain(tcmQuotes.zh);
	expect(cardText("tcm-ai", 0)).not.toContain(tcmQuotes.zh);
	expect(visibleTexts().join("\n")).not.toContain("虚构的治愈承诺");
	expect(persistedCurrentAssistantMessages(AsyncStorage)).toEqual(original);
});

test("retired image-identification messages cannot expose cards or confirmation controls", async () => {
	mockCurrentAssistantConversation(AsyncStorage, restoredCard({ action: "equipment_image", confirmationRequired: true }));
	await mountCatalog(tcmCatalog());
	expect(displayed().find(item => item.id === "tcm-ai")).toMatchObject({ retiredImage: true, action: "retired_image", recommendations: [] });
	expect(visibleTexts()).not.toContain("imageMatchYes");
	expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test.each([
	["zh", "太極揉推器如何使用？"],
	["en", "How do I use Tai Chi Wheel?"],
])("%s facility instructions stay complete without an expansion control", async (locale, query) => {
	const entries = equipmentTranslations[locale].equipmentList;
	await mountCatalog(entries, locale);
	await send(query);
	const answer = displayed().at(-1);
	const expectedSteps = formatEquipmentInstructionSteps(entries.find(item => item.id === 0).details, locale);
	expect(answer.action).toBe("equipment_local");
	expect(replyNode(answer.id).props.children).toContain(expectedSteps);
	expect(expandButton(answer.id)).toBeUndefined();
	expect(cardText(answer.id, 0)).toContain("openFacilityGuide");
	expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test.each(["zh", "en"])("%s separate details preserve safety in original prose and former card reasons", async locale => {
	const base = locale === "en"
		? "Please get a professional assessment before use. Stop exercising if pain worsens. This is not a diagnosis."
		: "使用前請先由醫護人員評估。疼痛加劇時請停止運動。這並不是診斷。";
	const warning = locale === "en" ? "Only use a comfortable range; stop if dizziness occurs." : "只適用於舒適的活動範圍；如果出現頭暈請停止。";
	const quote = locale === "en"
		? "Gentle movements can increase the flexibility of the upper limbs and support coordinated activity during everyday tasks such as reaching overhead, dressing, washing and carrying light household objects."
		: "柔和的關節活動有助提升上肢的柔軟度和協調能力，讓日常梳洗、穿衣、取物和輕巧的家居活動可以更流暢地完成，亦提供不同方向的活動練習。";
	mockCurrentAssistantConversation(AsyncStorage, restoredCard({
		action: "equipment_evidence", reply: base,
		recommendations: [{ id: 0, reason: warning, evidence: { field: "ptTip", quote } }],
	}));
	await mountCatalog(tcmCatalog(locale, { ptTip: quote }), locale);
	const preview = replyNode("tcm-ai").props.children;
	expect(preview).toContain(base);
	expect(preview).toContain(warning);
	expect(cardText("tcm-ai", 0)).not.toContain(warning);
	const hasDetails = !!expandButton("tcm-ai");
	if (hasDetails) await toggleExplanation("tcm-ai");
	const complete = hasDetails ? detailsText() : preview;
	expect(complete).toContain(quote);
	expect(complete).toContain(base);
	expect(complete).toContain(warning);
	expect(complete).toContain(tcmQuotes[locale]);
	if (hasDetails) await closeExplanation();
	expect(replyNode("tcm-ai").props.children).toBe(preview);
});

test.each([
	["zh", "肩周炎有什麼器材可以參考？"],
	["en", "What equipment can I look up for frozen shoulder?"],
	["zh", "膝蓋痛，有什麼器材可以參考？"],
	["en", "What equipment can I look up for knee pain?"],
])("%s restored symptom history shows one example and keeps details, storage and API context: %s", async (locale, question) => {
	const entries = equipmentTranslations[locale].equipmentList;
	const original = [
		{ id: "history-user", sender: "user", text: question },
		{ id: "history-ai", sender: "ai", reply: "舊有回答", recommendations: [] },
	];
	mockCurrentAssistantConversation(AsyncStorage, original);
	await mountCatalog(entries, locale);
	const answer = displayed().find(item => item.id === "history-ai");
	const originalStorage = JSON.stringify(AsyncStorage.setItem.mock.calls);
	const preview = replyNode(answer.id).props.children;
	expectFirstEquipmentExplanation(preview, answer, locale);
	expectFixedMedicalNotice();
	await toggleExplanation(answer.id);
	expect(detailsText().length).toBeGreaterThan(preview.length);
	for (const recommendation of answer.recommendations) {
		expect(detailsText()).toContain(recommendation.evidence.quote);
		if (recommendation.tcmExcerpt) expect(detailsText()).toContain(recommendation.tcmExcerpt.quote);
	}
	expect(replyNode(answer.id).props.children).toBe(preview);
	await closeExplanation();
	expect(replyNode(answer.id).props.children).toBe(preview);
	expectFixedMedicalNotice();
	expect(JSON.stringify(AsyncStorage.setItem.mock.calls)).toBe(originalStorage);
	expect(persistedCurrentAssistantMessages(AsyncStorage)).toEqual(original);
	expect(displayed().find(item => item.id === answer.id)).toEqual(answer);
	expect(sendAssistantMessage).not.toHaveBeenCalled();
	await send(locale === "en" ? "Hello" : "你好");
	const prior = sendAssistantMessage.mock.calls.at(-1)[0].history.find(item => item.role === "assistant" && item.content.includes(answer.recommendations[0].evidence.quote));
	expect(prior.content).toBe(answer.reply);
	expect(persistedCurrentAssistantMessages(AsyncStorage).slice(0, 2)).toEqual(original);
});

test.each(["facility", "auth_error", "error"])("%s independent messages never receive an expansion control", async action => {
	const content = "這是需要完整保留的獨立操作說明。".repeat(45);
	mockCurrentAssistantConversation(AsyncStorage, restoredCard({ action, reply: content, recommendations: [] }));
	await mountCatalog(tcmCatalog());
	expect(replyNode("tcm-ai").props.children).toBe(content);
	expect(expandButton("tcm-ai")).toBeUndefined();
});

test("retired image confirmation history is not shown as a usable AI action", async () => {
	mockCurrentAssistantConversation(AsyncStorage, restoredCard({ action: "image_confirmation" }));
	await mountCatalog(tcmCatalog());
	expect(displayed().find(item => item.id === "tcm-ai")).toMatchObject({ retiredImage: true, action: "retired_image", recommendations: [] });
	expect(visibleTexts().join("\\n")).not.toContain(tcmQuotes.zh);
});

test.each([
	["zh", "太極揉推器的中醫學角度是什麼？"],
	["en", "Tell me about Traditional Chinese Medicine for Tai Chi Wheel."],
])("%s direct TCM answers do not repeat the same excerpt in the facility card", async (locale, query) => {
	await mountCatalog(tcmCatalog(locale), locale);
	await send(query);
	expect(displayed().at(-1).tcmInReply).toBe(true);
	expect(expandButton(displayed().at(-1).id)).toBeUndefined();
	expect(visibleTexts().filter((text) => text.includes(tcmQuotes[locale]))).toHaveLength(1);
	expect(replyNode(displayed().at(-1).id).props.children).toContain(tcmQuotes[locale]);
	expect(replyNode(displayed().at(-1).id).props.children.split(tcmQuotes[locale])).toHaveLength(2);
	expectNoSourceWrapping(replyNode(displayed().at(-1).id).props.children);
	expect(cardText(displayed().at(-1).id, 0)).not.toContain(tcmQuotes[locale]);
	expectNoSourceWrapping(cardText(displayed().at(-1).id, 0));
	expectNoSourceWrapping(visibleTexts().join("\n"));
	expect(sendAssistantMessage).not.toHaveBeenCalled();
});

test.each([true, false])("background requests use server-authoritative catalog with local tcmEnabled=%s", async (tcmEnabled) => {
	await mountCatalog(tcmCatalog("zh", { tcmEnabled }));
	await send("你好");
	expect(sendAssistantMessage.mock.calls.at(-1)[0]).not.toHaveProperty("equipment");
	expect(sendAssistantMessage.mock.calls.at(-1)[0].message).toBe("你好");
});

test.each([
	["zh", "肩周炎有什麼器材可以參考？"],
	["en", "What equipment can I look up for frozen shoulder?"],
])("%s legacy frozen-shoulder reply shows one example, expands all evidence, and keeps compact cards", async (locale, query) => {
	const entries = equipmentTranslations[locale].equipmentList;
	await mountCatalog(entries, locale);
	await send(query);
	const answer = displayed().at(-1);
	const reply = replyNode(answer.id);
	const preview = reply.props.children;
	expect(answer.recommendations.map((item) => item.id)).toEqual(["0", "5", "19"]);
	expectFirstEquipmentExplanation(preview, answer, locale);
	expectFixedMedicalNotice();
	expectNoSourceWrapping(reply.props.children);
	expectNoSourceWrapping(visibleTexts().join("\n"));
	// Presentation changes must not rewrite the authoritative response data.
	expect(answer.reply).toContain(locale === "en" ? "According to the APP Facility Guide" : "根據APP設施教學");
	expect(answer.recommendations.some((recommendation) => !preview.includes(recommendation.evidence.quote))).toBe(true);
	for (const recommendation of answer.recommendations) {
		const facility = entries.find((item) => String(item.id) === recommendation.id);
		expect(recommendation.evidence.field).toBe("ptTip");
		expect(facility.ptTip).toContain(recommendation.evidence.quote);
		const card = equipmentCard(answer.id, recommendation.id);
		expectNoSourceWrapping(cardText(answer.id, recommendation.id));
		expect(cardText(answer.id, recommendation.id)).not.toContain(recommendation.evidence.quote);
		expect(cardText(answer.id, recommendation.id)).toBe(`${facility.name}\nopenFacilityGuide\n ›`);
		expect(reply.parent.children.indexOf(reply)).toBeLessThan(reply.parent.children.indexOf(card));
		if (["0", "19"].includes(recommendation.id)) {
			expect(recommendation.tcmExcerpt?.quote).toBeTruthy();
			expect(facility.tcmTip).toContain(recommendation.tcmExcerpt.quote);
			expect(cardText(answer.id, recommendation.id)).not.toContain(recommendation.tcmExcerpt.quote);
		} else expect(recommendation.tcmExcerpt).toBeUndefined();
	}
	expect(expandButton(answer.id).findAllByType(Text).map(node => node.props.children)).toContain(locale === "en" ? "View details" : "查看詳細說明");
	await toggleExplanation(answer.id);
	expect(detailsText()).toContain(locale === "en" ? "not a diagnosis or confirmation of suitability" : "也不是診斷或治療建議");
	expect(detailsText()).toContain(locale === "en" ? "Please read the full precautions" : "請查看設施教學的完整注意事項");
	if (locale === "zh") {
		expect(detailsText()).toContain("以上說明僅供參考，並非針對症狀的使用建議。請查看設施教學的完整注意事項。");
		expect(detailsText()).not.toContain("以上中醫說明");
	}
	for (const recommendation of answer.recommendations) {
		expect(detailsText()).toContain(recommendation.evidence.quote);
		if (recommendation.tcmExcerpt) expect(detailsText()).toContain(recommendation.tcmExcerpt.quote);
	}
	expectNoSourceWrapping(detailsText());
	expect(replyNode(answer.id).props.children).toBe(preview);
	await closeExplanation();
	expect(replyNode(answer.id).props.children).toBe(preview);
	expectFixedMedicalNotice();
	const firstCard = answer.recommendations[0];
	await act(async () => equipmentCard(answer.id, firstCard.id).props.onPress());
	expect(router.push).toHaveBeenCalledWith({ pathname: "/outdoor/detail", params: { id: firstCard.id, name: firstCard.name, from: "ai" } });
	expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
});

test.each(["zh", "en"])("%s consecutive legacy recommendations vary naturally and stay stable while reading details and restoring history", async locale => {
	const entries = equipmentTranslations[locale].equipmentList;
	let now = 1900000000000;
	const clock = jest.spyOn(Date, "now").mockImplementation(() => ++now);
	try {
		await mountCatalog(entries, locale);
		const previews = new Map();
		const question = locale === "en" ? "What equipment can I look up for knee pain?" : "膝蓋痛，有什麼器材可以參考？";
		for (let index = 0; index < 6; index += 1) {
			await send(question);
			const answer = displayed().at(-1);
			const preview = replyNode(answer.id).props.children;
			expectFirstEquipmentExplanation(preview, answer, locale);
			expect(answer.recommendations.map(item => item.id)).toEqual(["4", "10", "11"]);
			previews.set(answer.id, preview);
			for (const [id, previous] of previews) expect(rowPreview(id)).toBe(previous);
		}
		expect(new Set([...previews.values()].map(text => text.split("\n")[0])).size).toBe(6);
		const last = displayed().at(-1);
		await toggleExplanation(last.id);
		for (const item of last.recommendations) expect(detailsText()).toContain(item.evidence.quote);
		await closeExplanation();
		for (const [id, preview] of previews) expect(rowPreview(id)).toBe(preview);
		const saved = AsyncStorage.setItem.mock.calls.at(-1)[1];
		expect(saved).not.toContain("introVariant");
		await act(async () => tree.unmount()); tree = null;
		AsyncStorage.getItem.mockResolvedValue(saved);
		await mountCatalog(entries, locale);
		for (const [id, preview] of previews) expect(rowPreview(id)).toBe(preview);
		expect(sendAssistantMessage).toHaveBeenCalledTimes(6);
	} finally { clock.mockRestore(); }
});

test("a TCM-only recommendation retains its evidence in details rather than inventing a professional benefit", async () => {
	const quote = "此設施的中醫說明提及舒緩肩部疼痛。";
	await mountCatalog(tcmCatalog("zh", { tcmTip: quote }));
	await send("肩部疼痛，有什麼器材可以參考？");
	const answer = displayed().at(-1);
	expect(answer.recommendations[0].evidence.field).toBe("tcmTip");
	const preview = replyNode(answer.id).props.children;
	expectDetailInvitation(preview, "zh");
	expect(preview).not.toContain(quote);
	expect(cardText(answer.id, 0)).not.toContain(quote);
	expect(cardText(answer.id, 0)).toContain("openFacilityGuide");
	expectFixedMedicalNotice();
	await toggleExplanation(answer.id);
	expect(detailsText()).toContain(quote);
	expect(detailsText().split(quote)).toHaveLength(2);
	await closeExplanation();
	expect(replyNode(answer.id).props.children).toBe(preview);
});

test.each(["zh", "en"])("%s old source-labelled history is cleaned only on screen, not in storage or API context", async locale => {
	const quote = locale === "en" ? "Hold the handles and keep the shoulders relaxed." : "雙手握穩手柄，保持肩膊放鬆。";
	const entries = tcmCatalog(locale, { tcmEnabled: false, ptTip: quote });
	const prefix = locale === "en" ? `The following information comes from the Facility Guide for ${entries[0].name}:` : `以下內容來自「設施教學－${entries[0].name}」：`;
	const original = [
		{ id: "source-user", sender: "user", text: locale === "en" ? "An earlier facility question" : "之前問過的器材資料" },
		{ id: "source-ai", sender: "ai", text: `${prefix}\n\n${quote}`, action: "equipment_local", source: "app_content", recommendations: [{ id: "0", reason: locale === "en" ? `APP excerpt — Tips from Physiotherapists: “${quote}”` : `APP「物理治療師的小貼士」原文：「${quote}」` }] },
	];
	mockCurrentAssistantConversation(AsyncStorage, original);
	await mountCatalog(entries, locale);
	expectNoSourceWrapping(replyNode("source-ai").props.children);
	expectNoSourceWrapping(cardText("source-ai", 0));
	expectNoSourceWrapping(visibleTexts().join("\n"));
	expect(replyNode("source-ai").props.children).toContain(quote);
	expect(cardText("source-ai", 0)).not.toContain(quote);
	expect(persistedCurrentAssistantMessages(AsyncStorage)).toEqual(original);
	expect(displayed().find(item => item.id === "source-ai").reply).toContain(prefix);
	await send(locale === "en" ? "Hello" : "你好");
	const oldContext = sendAssistantMessage.mock.calls.at(-1)[0].history.find(item => item.role === "assistant" && item.content.includes(quote));
	expect(oldContext.content).toContain(prefix);
	expect(oldContext.content).toContain(quote);
	expect(persistedCurrentAssistantMessages(AsyncStorage).slice(0, 2)).toEqual(original);
});

test.each([
	["zh", "請解釋「APP原文」這幾個字。"],
	["en", "What do the words '(APP excerpt)' mean?"],
])("%s a user's own source wording remains exactly as entered and sent", async (locale, query) => {
	await mountCatalog(tcmCatalog(locale), locale);
	await send(query);
	const userMessage = displayed().filter(item => item.sender === "user").at(-1);
	expect(replyNode(userMessage.id).props.children).toBe(query);
	expect(sendAssistantMessage.mock.calls.at(-1)[0].message).toBe(query);
	expect(persistedCurrentAssistantMessages(AsyncStorage).find(item => item.id === userMessage.id).text).toBe(query);
});

test.each([
	["zh", "太極揉推器的物理治療介紹", "物理治療師的小貼士（APP原文）：請扶穩手柄。"],
	["en", "Tell me about physiotherapy for Tai Chi Wheel.", "Tips from Physiotherapists (APP excerpt): Hold the handle securely."],
])("%s maintained facility prose containing source-like words is protected verbatim", async (locale, query, quote) => {
	await mountCatalog(tcmCatalog(locale, { tcmEnabled: false, ptTip: quote }), locale);
	await send(query);
	const answer = displayed().at(-1);
	expect(replyNode(answer.id).props.children).toContain(quote);
	expect(replyNode(answer.id).props.children.split(quote)).toHaveLength(2);
	expect(answer.reply).toContain(quote);
	expect(replyNode(answer.id).props.children).not.toContain(locale === "en" ? "According to the Facility Guide for" : "根據APP內「設施教學");
	expect(sendAssistantMessage).not.toHaveBeenCalled();
});
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
