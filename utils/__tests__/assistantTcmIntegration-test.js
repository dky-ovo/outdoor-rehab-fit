import { equipmentTranslations } from "../../constants/Equipments";
import { assistantMessagesForDisplay, localEquipmentAnswer, resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { symptomGuideAnswer } from "../assistantSymptomEvidence";

const catalog = locale => equipmentTranslations[locale].equipmentList;

test.each([
  ["zh", "我有五十肩，有什麼器材可以查閱？"],
  ["zh", "肩周炎可以用什麼器材？"],
  ["zh", "冷冻肩，推荐器材"],
  ["en", "I have frozen shoulder, which machine could help me?"],
])("%s shoulder synonyms retain original guide evidence and optional TCM: %s", (locale, question) => {
  const result = symptomGuideAnswer(question, catalog(locale), locale);
  expect(result.deepSeekUsed).toBe(false);
  expect(result.recommendations.map(item => item.id)).toEqual(["0", "5", "19"]);
  expect(result.recommendations.find(item => item.id === "19").tcmExcerpt.quote).toMatch(locale === "en" ? /meridians/ : /經絡/);
  expect(result.recommendations.find(item => item.id === "5").tcmExcerpt).toBeUndefined();
  for (const item of result.recommendations) {
    const source = catalog(locale).find(equipment => String(equipment.id) === item.id);
    expect(source[item.evidence.field]).toContain(item.evidence.quote);
    expect(result.reply).toContain(item.name);
    expect(result.reply).toContain(item.evidence.quote);
    if (item.tcmExcerpt) {
      expect(source.tcmTip).toContain(item.tcmExcerpt.quote);
      expect(result.reply).toContain(item.tcmExcerpt.quote);
      expect(result.reply.indexOf(item.evidence.quote)).toBeLessThan(result.reply.indexOf(item.tcmExcerpt.quote));
      expect(result.reply.split(item.tcmExcerpt.quote)).toHaveLength(2);
    }
  }
  expect(JSON.stringify(result)).not.toMatch(/首選|首选|first[- ]choice/i);
});

test.each(["zh", "en"])("%s knee article includes the correct TCM without adding the foot path", locale => {
  const result = symptomGuideAnswer(locale === "en" ? "What equipment can help with knee pain?" : "膝頭哥痛可以用什麼戶外儀器", catalog(locale), locale);
  expect(result.recommendations.map(item => item.id)).toEqual(["4", "10", "11"]);
  expect(result.recommendations.filter(item => item.tcmExcerpt).map(item => item.id)).toEqual(["4", "10"]);
  expect(result.recommendations.every(item => item.evidence.field === "ptTip")).toBe(true);
  for (const item of result.recommendations) {
    expect(result.reply).toContain(item.evidence.quote);
    if (item.tcmExcerpt) expect(result.reply).toContain(item.tcmExcerpt.quote);
  }
});

test.each(["zh", "en"])("%s named instructions retain the whole section without appending unrelated TCM", locale => {
  const query = locale === "en" ? "How do I use Tai Chi Wheel?" : "太極揉推器如何使用？";
  const result = localEquipmentAnswer(query, catalog(locale), locale);
  expect(result.action).toBe("equipment_local");
  expect(result.reply).toContain(catalog(locale)[0].details);
  expect(result.recommendations[0].tcmExcerpt).toBeUndefined();
  expect(result.reply).not.toContain(catalog(locale)[0].tcmTip);
  expect(result.guideContentDirect).toBe(true);
  expect(result.tcmInReply).not.toBe(true);
});

test.each(["updated", "disabled", "removed", "renamed"])("stored general recommendation article rebuilds %s TCM from current data", scenario => {
  const first = {
    id: "a", sender: "ai", reply: "APP 設施參考", action: "equipment",
    recommendations: [{ id: "19", tcmExcerpt: { quote: "不可信的舊資料" } }],
  };
  const original = assistantMessagesForDisplay([first], catalog("zh"), "zh")[0];
  const oldQuote = original.recommendations[0].tcmExcerpt.quote;
  expect(original.reply).toContain(oldQuote);
  const newQuote = "更新的中醫原文：活動肩膊時配合自然均勻的呼吸。";
  const maintained = scenario === "removed" ? [] : catalog("zh").map(item => String(item.id) !== "19" ? item : {
    ...item, ...(scenario === "disabled" ? { tcmEnabled: false } : {}),
    ...(scenario === "updated" ? { tcmTip: newQuote } : {}),
    ...(scenario === "renamed" ? { name: "更新名稱的肩部設施" } : {}),
  });
  const before = JSON.stringify(original);
  const refreshed = assistantMessagesForDisplay([original], maintained, "zh")[0];
  expect(refreshed.reply).toContain("APP 設施參考");
  if (scenario === "renamed") {
    expect(refreshed.reply).toContain("更新名稱的肩部設施");
    expect(refreshed.reply.split(oldQuote)).toHaveLength(2);
  } else {
    expect(refreshed.reply).not.toContain(oldQuote);
    if (scenario === "updated") expect(refreshed.reply).toContain(newQuote);
  }
  expect(JSON.stringify(original)).toBe(before);
  expect(assistantMessagesForDisplay([refreshed], maintained, "zh")[0].reply).toBe(refreshed.reply);
});

test("greetings, safety refusals and map messages do not acquire TCM paragraphs", () => {
  for (const action of ["facility", "error", "auth_error", "image_confirmation"]) {
    const message = { id: action, sender: "ai", action, reply: "原有回覆", recommendations: [{ id: "19" }] };
    expect(assistantMessagesForDisplay([message], catalog("zh"), "zh")[0].reply).toBe("原有回覆");
  }
  const greeting = { id: "g", sender: "ai", reply: "您好", recommendations: [] };
  expect(assistantMessagesForDisplay([greeting], catalog("zh"), "zh")[0].reply).toBe("您好");
});

test("rechecking a stored symptom article cannot restore its old base after the facilities disappear", () => {
  const question = "肩周炎可以用什麼器材？";
  const original = { id: "a", sender: "ai", ...symptomGuideAnswer(question, catalog("zh"), "zh") };
  expect(original.reply).toContain(original.recommendations[0].tcmExcerpt.quote);
  const refreshed = assistantMessagesForDisplay([{ id: "u", sender: "user", text: question }, original], [], "zh")[1];
  expect(refreshed.reply).toContain("未能判斷");
  expect(refreshed.reply).not.toContain("以下器材的說明");
  expect(refreshed.reply).not.toContain(original.recommendations[0].tcmExcerpt.quote);
  expect(refreshed.recommendations).toEqual([]);
});

test("a trimmed TCM-evidence history cannot reappear as unlabelled card prose after disable", () => {
  const quote = "這項肩部伸展有助緩解肩部疼痛。";
  const entries = [{ id: "custom", name: "測試肩部設施", tcmEnabled: true, tcmTip: quote }];
  const original = { id: "a", sender: "ai", ...symptomGuideAnswer("肩痛可以用什麼器材？", entries, "zh") };
  expect(original.reply).toContain(quote);
  const before = JSON.stringify(original);
  const refreshed = assistantMessagesForDisplay([original], [{ ...entries[0], tcmEnabled: false }], "zh")[0];
  expect(refreshed.reply).not.toContain(quote);
  expect(refreshed.recommendations[0].evidence).toBeUndefined();
  expect(refreshed.recommendations[0].reason).toBeUndefined();
  expect(JSON.stringify(original)).toBe(before);
});

test.each([
  ["zh", "肩關節伸展的中醫解釋", /經絡/],
  ["en", "What is the traditional Chinese medicine perspective on Shoulder stretch?", /meridians/],
])("%s direct TCM lookup returns only a brief existing excerpt", (locale, question, content) => {
  const answer = localEquipmentAnswer(question, catalog(locale), locale);
  expect(answer.reply).toMatch(content);
  expect(answer.reply).not.toMatch(/首選|首选|first[- ]choice/i);
  expect(answer.tcmInReply).toBe(true);
  expect(answer.deepSeekUsed).toBe(false);
  expect(answer.recommendations.map(item => item.id)).toEqual(["19"]);
});

test("English foot-path TCM stays absent, while ordinary instructions retain their card", () => {
  const answer = localEquipmentAnswer("What is the TCM perspective on Foot Massage Path?", catalog("en"), "en");
  expect(answer.reply).toMatch(/no TCM information/i);
  expect(answer.reply).not.toMatch(/[\u4e00-\u9fff]/);
  expect(answer.tcmInReply).toBe(false);
  expect(answer.recommendations[0].id).toBe("28");
  expect(answer.recommendations[0].tcmExcerpt).toBeUndefined();
});

test("explicit TCM history reflects a disabled field without rewriting the saved content", () => {
  const original = [
    { id: "u", sender: "user", text: "肩關節伸展的中醫解釋" },
    { id: "a", sender: "ai", reply: "舊中醫內容，首選設施", action: "equipment_local", tcmInReply: true, recommendations: [{ id: "19" }] },
  ];
  const before = JSON.stringify(original);
  const disabled = catalog("zh").map(item => ({ ...item, tcmEnabled: false }));
  const displayed = assistantMessagesForDisplay(original, disabled, "zh");
  expect(displayed[1].reply).toContain("沒有可顯示");
  expect(displayed[1].reply).not.toContain("首選");
  expect(displayed[1].tcmInReply).toBe(false);
  expect(displayed[1].recommendations[0].tcmExcerpt).toBeUndefined();
  expect(JSON.stringify(original)).toBe(before);
});

test("resolver rejects stale or invented TCM and follows the currently selected APP language", () => {
  const recommendations = [{ id: "19", tcmExcerpt: { field: "tcmTip", quote: "假療效" } }, { id: "5", tcmExcerpt: { quote: "假療效" } }];
  const resolved = resolveEquipmentRecommendations(recommendations, catalog("en"), "en");
  expect(resolved[0].tcmExcerpt.quote).toContain("meridians");
  expect(resolved[1].tcmExcerpt).toBeUndefined();
  expect(JSON.stringify(resolved.map(item => item.tcmExcerpt))).not.toContain("假療效");
});

test.each(["generic", "renamed", "removed", "trimmed"])("stale direct TCM history cannot leak a disabled excerpt when %s", scenario => {
  const oldReply = { id: "a", sender: "ai", reply: "舊中醫療效，首選", tcmInReply: true,
    recommendations: [{ id: "19" }], action: "equipment_local" };
  const messages = scenario === "trimmed" ? [oldReply] : [
    { id: "u", sender: "user", text: scenario === "generic" ? "這部器材的中醫學角度是什麼？" : "肩關節伸展的中醫解釋" }, oldReply,
  ];
  const before = JSON.stringify(messages);
  const items = scenario === "removed" ? [] : catalog("zh").map(item => ({ ...item,
    name: scenario === "renamed" ? "已改名的器材" : item.name, tcmEnabled: false,
  }));
  const result = assistantMessagesForDisplay(messages, items, "zh").at(-1);
  expect(result.reply).not.toMatch(/舊中醫療效|首選/);
  expect(result.tcmInReply).toBe(false);
  expect(result.recommendations.every(item => !item.tcmExcerpt)).toBe(true);
  expect(JSON.stringify(messages)).toBe(before);
});
