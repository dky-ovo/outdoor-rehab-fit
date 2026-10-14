import AsyncStorage from "@react-native-async-storage/async-storage";
import { assistantMessagesForDisplay } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { loadAssistantConversations, storeAssistantConversation } from "../assistantConversations";
import { ASSISTANT_FAQ_ENTRIES, ASSISTANT_FAQ_POLICY, renderAssistantFaq, retrieveAssistantFaq } from "../../server/src/assistantFaqKnowledge";
import { BAILIAN_FAQ_IDS, BAILIAN_FAQ_POLICY } from "../../server/src/assistantBailianPolicy";

jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { __esModule: true, default: {
    __data: data, getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
  } };
});

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.__data.clear();
  AsyncStorage.getItem.mockImplementation(async key => AsyncStorage.__data.get(key) ?? null);
  AsyncStorage.setItem.mockImplementation(async (key, value) => AsyncStorage.__data.set(key, value));
});

const catalog = [{ id: "8", name: "扭腰機", nameEn: "Twister", categories: ["balance"],
  details: "扶穩扶手，按舒適幅度活動。", tcmEnabled: true, tcmTip: "UNREVIEWED TCM" }];
const user = question => ({ id: "u", sender: "user", text: question });
const response = (focus = "app-videos") => ({
  id: "a", sender: "ai", action: "faq", evidencePolicy: BAILIAN_FAQ_POLICY, focus, faqId: focus,
  reply: "UNTRUSTED MODEL PROSE", text: "UNTRUSTED SAVED TEXT", faqReplyBase: "UNTRUSTED BASE",
  source: "app_content", knowledgeSource: "project_faq", deepSeekUsed: false,
  recommendations: [{ id: "8", reason: "UNTRUSTED CARD" }],
  equipmentReplyVersion: "app-equipment-prose-v1", equipmentReplyBase: "UNTRUSTED ARTICLE",
  model: "private-model-code",
});

test.each([
  ["en", "Which screen has the instructional clips?", "app-videos"],
  ["en", "Which app screen should I use to replay a clip?", "app-videos"],
  ["zh", "示範短片應從哪一頁開啟？", "app-videos"],
  ["en", "I need a look at my past sessions.", "app-records"],
  ["en", "Could you give me a tour of OutdoorFit?", "app-features"],
  ["en", "Let's revise my targets using the last seven days.", "personal-goals"],
])("%s selector-only %s reconstructs the reviewed answer and remains repeatable", (locale, question, focus) => {
  expect(retrieveAssistantFaq(question)).toBeNull();
  expect(BAILIAN_FAQ_IDS).toContain(focus);
  const messages = [user(question), response(focus)];
  const expected = renderAssistantFaq(ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === focus), catalog, locale, { message: question });
  const displayed = assistantMessagesForDisplay(messages, catalog, locale);
  const answer = displayed[1];
  expect(answer).toMatchObject({ reply: expected.reply, focus, evidencePolicy: BAILIAN_FAQ_POLICY, recommendations: [] });
  expect(answer.text).toBeUndefined();
  expect(answer.equipmentReplyVersion).toBeUndefined();
  expect(answer.equipmentReplyBase).toBeUndefined();
  expect(answer.reply).not.toMatch(/UNTRUSTED|UNREVIEWED/);
  expect(assistantMessagesForDisplay(displayed, catalog, locale)[1]).toEqual(answer);
  expect(assistantReplyPresentation(answer, [], locale).previewText).toBe(expected.reply);
  expect(messages[1].text).toBe("UNTRUSTED SAVED TEXT");
});

test.each(["elbow-pain", "scope-health", "invented-id"])("a forged Bailian %s focus cannot select a medical or unknown FAQ", focus => {
  const answer = assistantMessagesForDisplay([user("Which screen has the instructional clips?"), response(focus)], catalog, "en")[1];
  expect(answer.reply).toContain("Please ask your question again");
  expect(answer.reply).not.toMatch(/UNTRUSTED|gripping|blood pressure/);
  expect(answer.faqReplyBase).toBeUndefined();
  expect(answer.faqId).toBeUndefined();
  expect(answer.recommendations).toEqual([]);
});

test("current FAQ rules override a conflicting saved selector choice", () => {
  const question = "Where can I find the demonstration videos?";
  const answer = assistantMessagesForDisplay([user(question), response("personal-goals")], [], "en")[1];
  expect(answer.focus).toBe("app-videos");
  expect(answer.evidencePolicy).toBe(ASSISTANT_FAQ_POLICY);
  expect(answer.reply).toContain("Facility Guide");
  expect(answer.reply).not.toContain("Goal Setting");
});

test.each([
  ["zh", "我現在胸口痛，想睇短片。"],
  ["en", "I have chest pain right now. Which screen has the instructional clips?"],
])("%s an urgent complaint overrides even a valid navigation focus", (locale, question) => {
  const answer = assistantMessagesForDisplay([user(question), response()], catalog, locale)[1];
  expect(answer.reply).toContain("999");
  expect(answer.reply).not.toContain("UNTRUSTED");
  expect(answer.evidencePolicy).not.toBe(BAILIAN_FAQ_POLICY);
  expect(answer.recommendations).toEqual([]);
});

test("symptoms and exercise quantity cannot fall back to a saved navigation focus", () => {
  const symptomQuestion = "My ankle and elbow are hurting. Which screen has the instructional clips?";
  expect(retrieveAssistantFaq(symptomQuestion)).toBeNull();
  const symptom = assistantMessagesForDisplay([user(symptomQuestion), response()], [], "en")[1];
  expect(symptom.reply).not.toMatch(/Open Facility Guide|UNTRUSTED/);
  expect(symptom.evidencePolicy).not.toBe(BAILIAN_FAQ_POLICY);
  const quantityQuestion = "How many repetitions should I do?";
  expect(retrieveAssistantFaq(quantityQuestion)).toBeNull();
  const quantity = assistantMessagesForDisplay([user(quantityQuestion), response()], [], "en")[1];
  expect(quantity.reply).toContain("Please ask your question again");
});

test("direct equipment instructions and location questions retain their existing boundaries", () => {
  const directQuestion = "扭腰機點用？";
  expect(retrieveAssistantFaq(directQuestion)).toBeNull();
  const direct = assistantMessagesForDisplay([user(directQuestion), response()], catalog)[1];
  expect(direct.action).toBe("equipment_local");
  expect(direct.evidencePolicy).not.toBe(BAILIAN_FAQ_POLICY);
  expect(direct.reply).toContain("舒適幅度");
  expect(direct.reply).not.toContain("UNTRUSTED");
  const location = assistantMessagesForDisplay([user("Where is the nearest park?"), response()], [], "en")[1];
  expect(location.reply).toContain("Please ask your question again");
});

test("a trimmed-away question is insufficient for a selector-only focus fallback", () => {
  const answer = assistantMessagesForDisplay([response()], [], "en")[0];
  expect(answer.reply).toContain("Please ask your question again");
  expect(answer.recommendations).toEqual([]);
});

test.each(["zh", "en"])("%s bounded conversation storage keeps selector focus and policy without needing faqId", async locale => {
  const identity = { owner: `selector-user-${locale}`, locale, authSessionId: "selector-session" };
  const initial = await loadAssistantConversations(identity);
  const question = locale === "en" ? "Which screen has the instructional clips?" : "示範短片應從哪一頁開啟？";
  await storeAssistantConversation({ ...identity, conversationId: initial.conversationId,
    messages: [user(question), { ...response(), transportSecret: "SECRET" }] });
  const restored = await loadAssistantConversations(identity);
  expect(restored.messages[1]).toMatchObject({ focus: "app-videos", evidencePolicy: BAILIAN_FAQ_POLICY, model: "private-model-code" });
  expect(restored.messages[1]).not.toHaveProperty("faqId");
  expect(restored.messages[1]).not.toHaveProperty("transportSecret");
  const displayed = assistantMessagesForDisplay(restored.messages, [], locale);
  expect(displayed[1].evidencePolicy).toBe(BAILIAN_FAQ_POLICY);
  expect(displayed[1].reply).not.toContain("UNTRUSTED");
  const nextLogin = await loadAssistantConversations({ ...identity, authSessionId: "another-session" });
  expect(assistantMessagesForDisplay(nextLogin.history[0].messages, [], locale)[1].reply).toBe(displayed[1].reply);
});
