import { checkedAssistantRuntime, assistantRuntimeRequest, assistantRequestHistory, assistantProviderLabel } from "../assistantRuntime";
import { assistantMessagesForDisplay } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";

const rawRuntime = { provider: "bailian", model: "qwen-plus", scope: "bailian", revision: "revision-2", promptMode: "none", faqEnabled: false, protocol: 2 };
const catalog = [{ id: "8", name: "扭腰機", categories: ["balance"], details: "舊教學", ptTip: "應用內指引", tcmEnabled: true, tcmTip: "不應加入的中醫內容" }];

test("checks the public runtime and sends only its non-secret provider contract", () => {
  expect(checkedAssistantRuntime({ ...rawRuntime, unexpected: "ignored" })).toEqual(rawRuntime);
  expect(assistantRuntimeRequest(rawRuntime)).toEqual({ provider: "bailian", runtimeRevision: "revision-2", historyScope: "bailian", protocol: 2 });
  expect(assistantProviderLabel(rawRuntime, "zh")).toBe("阿里百煉 · qwen-plus");
});

test.each([
  null, {}, { ...rawRuntime, provider: "unknown" }, { ...rawRuntime, scope: "deepseek" },
  { ...rawRuntime, faqEnabled: true }, { ...rawRuntime, promptMode: "app" },
  { ...rawRuntime, protocol: 1 }, { ...rawRuntime, revision: "" },
  { ...rawRuntime, model: "" }, { ...rawRuntime, revision: 12 },
])("does not default to a provider for an invalid or stale runtime: %j", value => {
  expect(() => checkedAssistantRuntime(value)).toThrow("assistantRuntimeUnavailable");
});

test.each([
  "我現在胸口痛，抖唔到氣", "拉繩機要拉幾多下？", "扭腰機點用？", "我想了解中醫說明", "短片在哪裡？",
])("raw provider reply to %s bypasses all app content reconstruction without mutating saved rows", question => {
  const text = "模型原文 **保留**\n![example](https://example.com/a.png)\nhttps://example.com\nAPP 原文和 FAQ 都只是本段文字。";
  const rows = [{ id: "u", sender: "user", text: question, provider: "bailian" }, {
    id: "a", sender: "ai", provider: "bailian", responsePolicy: "bailian-chat-raw-v1", model: "qwen-plus", reply: text,
    action: "facility", facility: { nameZh: "模型地点" }, confirmationRequired: true,
    recommendations: [{ id: "8", reason: "不能渲染此卡" }], tcmInReply: true,
    evidencePolicy: "app-faq-reviewed-v1", equipmentReplyBase: "不能加入", equipmentReplyVersion: "app-equipment-prose-v1",
  }];
  const before = JSON.stringify(rows);
  const answer = assistantMessagesForDisplay(rows, catalog, "zh")[1];
  expect(answer.reply).toBe(text);
  expect(answer.action).toBe("general");
  expect(answer.recommendations).toEqual([]);
  expect(answer.facility).toBeUndefined();
  expect(assistantReplyPresentation(answer, catalog, "zh")).toEqual({ fullText: text, previewText: text, canExpand: false });
  expect(JSON.stringify(rows)).toBe(before);
});

test("context drops welcome/error/foreign-provider rows and never treats legacy unmarked messages as Bailian", () => {
  const rows = [
    { id: "welcome", sender: "ai", provider: "bailian", text: "Welcome" },
    { id: "legacy", sender: "ai", text: "DeepSeek legacy" },
    { id: "ds", sender: "user", provider: "deepseek", text: "DeepSeek question" },
    { id: "u", sender: "user", provider: "bailian", text: "百煉問題" },
    { id: "a", sender: "ai", provider: "bailian", reply: "百煉回答" },
    { id: "err", sender: "ai", provider: "bailian", action: "error", reply: "Network issue" },
  ];
  expect(assistantRequestHistory(rows, "bailian")).toEqual([{ role: "user", content: "百煉問題" }, { role: "assistant", content: "百煉回答" }]);
  expect(assistantRequestHistory(rows, "deepseek").map(row => row.content)).toEqual(["DeepSeek legacy", "DeepSeek question"]);
});
