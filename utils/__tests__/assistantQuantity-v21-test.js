import { equipmentTranslations } from "../../constants/Equipments";
import { assistantMessagesForDisplay } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { ASSISTANT_FAQ_POLICY } from "../../server/src/assistantFaqKnowledge";

const originalDose = "拉繩機冇固定「幾多下先夠」，要按你嘅體力同部機嘅阻力嚟定。一般長者可以由每組 8 至 12 下、做 1 至 2 組開始，動作放慢、呼吸保持順暢，覺得攰就停。";
const ropeQuestion = "拉繩機要拉幾多下先夠？我係長者。";

function freezeTree(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function showWithoutMutation(rows, locale = "zh") {
  const snapshot = JSON.stringify(rows);
  freezeTree(rows);
  const display = assistantMessagesForDisplay(rows, equipmentTranslations[locale].equipmentList, locale);
  expect(JSON.stringify(rows)).toBe(snapshot);
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].sender === "user") expect(display[index]).toBe(rows[index]);
  }
  return display;
}

test.each(["zh", "en"])("%s restored unverified model replies for the observed rope nickname lose the old dose without rewriting storage", locale => {
  for (const property of ["reply", "text"]) {
    const rows = [
      { id: "u", sender: "user", text: ropeQuestion },
      { id: "a", sender: "ai", action: "general", [property]: originalDose, recommendations: [] },
    ];
    const shown = showWithoutMutation(rows, locale).at(-1);
    expect(shown.faqId).toBe("rope-use");
    expect(shown.evidencePolicy).toBe(ASSISTANT_FAQ_POLICY);
    expect(shown.reply).not.toMatch(/8\s*至\s*12|1\s*至\s*2/);
    expect(shown.reply).toMatch(locale === "en" ? /demonstrate|technique/i : /示範|確認/);
    expect(shown.recommendations.map(item => String(item.id))).toEqual(["20"]);
    const view = assistantReplyPresentation(shown, shown.recommendations, locale);
    expect(view.fullText).not.toMatch(/8\s*至\s*12|1\s*至\s*2/);
    expect(rows[1][property]).toBe(originalDose);
  }
});

test("a stale FAQ-marked rope reply also rebuilds with current v21 content and active cards", () => {
  const rows = [
    { id: "u", sender: "user", text: ropeQuestion },
    { id: "a", sender: "ai", action: "faq", evidencePolicy: ASSISTANT_FAQ_POLICY,
      focus: "rope-use", knowledgeVersion: "2026-10-07-v20", reply: originalDose,
      recommendations: [{ id: "20", name: "stale name" }] },
  ];
  const shown = showWithoutMutation(rows).at(-1);
  expect(shown.knowledgeVersion).toBe("2026-10-07-v21");
  expect(shown.reply).toContain("示範");
  expect(shown.reply).not.toContain("8 至 12");
  expect(shown.recommendations[0].name).not.toBe("stale name");
  const removed = assistantMessagesForDisplay(rows, [{ id: "20", name: "removed", isActive: false }]).at(-1);
  expect(removed.recommendations).toEqual([]);
  expect(removed.reply).not.toContain("8 至 12");
});

const unresolvedEmergency = [
  { id: "u1", sender: "user", text: "我用拉繩機時心口痛，抖唔到氣。" },
  { id: "a1", sender: "ai", action: "safety", reply: "請停止運動並尋求緊急醫護協助。", recommendations: [] },
];

test.each([
  "咁每日十下得唔得？",
  "拉繩機要拉幾多下？",
  "How many minutes should I use it?",
  "How many seconds should I hold each stretch?",
  "Can I use it for 5 minutes?",
  "How often should I use the rope machine?",
  "太極推手器中醫教學，每日做幾多分鐘？",
])("an unresolved emergency remains first when a later turn asks for quantity: %s", question => {
  const rows = [...unresolvedEmergency,
    { id: "u2", sender: "user", text: question },
    { id: "a2", sender: "ai", action: "general", reply: originalDose, recommendations: [{ id: "20" }] },
  ];
  const shown = showWithoutMutation(rows).at(-1);
  expect(shown.reply).toContain("999");
  expect(shown.reply).toContain("停止");
  expect(shown.reply).not.toContain("8 至 12");
  expect(shown.recommendations).toEqual([]);
});

test("an explicit correction clears the alleged emergency but not the rope quantity safeguards", () => {
  const question = "更正：之前講錯，我冇心口痛，冇呼吸困難。我只想知拉繩機做十下夠唔夠？";
  const rows = [...unresolvedEmergency,
    { id: "u2", sender: "user", text: question },
    { id: "a2", sender: "ai", action: "general", reply: originalDose, recommendations: [] },
  ];
  const shown = showWithoutMutation(rows).at(-1);
  expect(shown.reply).not.toContain("999");
  expect(shown.faqId).toBe("rope-use");
  expect(shown.reply).toContain("示範");
  expect(shown.reply).not.toContain("8 至 12");
});

test.each([
  "How should I use the Tai Chi Wheel?",
  "What is the weather like today?",
  "Where is the nearest park?",
])("an intervening different topic prevents a quantity-only turn from inheriting an old rope topic: %s", differentTopic => {
  const rows = [
    { id: "u1", sender: "user", text: "How should I use the rope machine?" },
    { id: "a1", sender: "ai", action: "general", reply: "Ask someone to demonstrate the equipment first.", recommendations: [] },
    { id: "u2", sender: "user", text: differentTopic },
    { id: "a2", sender: "ai", action: "general", reply: "Please refer to the appropriate current information.", recommendations: [] },
    { id: "u3", sender: "user", text: "How many reps?" },
    { id: "a3", sender: "ai", action: "general", reply: "Please tell me which activity you mean. Repetitions depend on your ability.", recommendations: [] },
  ];
  const shown = showWithoutMutation(rows, "en").at(-1);
  expect(shown.faqId).not.toBe("rope-use");
  expect(shown.recommendations.map(item => String(item.id))).not.toContain("20");
  expect(shown.reply).not.toMatch(/Upper Body Stretch|Pull Down/i);
});

test.each(["auth_error", "error", "image_confirmation", "facility"])("new quantity retrieval does not consume the separate %s interaction", action => {
  const last = { id: "a", sender: "ai", action, reply: "KEEP THIS INTERACTION", recommendations: [],
    ...(action === "image_confirmation" ? { confirmationRequired: true } : {}) };
  const rows = [{ id: "u", sender: "user", text: ropeQuestion }, last];
  const shown = showWithoutMutation(rows).at(-1);
  expect(shown.action).toBe(action);
  expect(shown.reply).toBe("KEEP THIS INTERACTION");
  expect(shown.faqId).toBeUndefined();
});
