import { previewAdminAssistant, sendAdminAssistant } from "../adminAssistantApi";
jest.mock("../api", () => ({ API_BASE_URL: "/api", ApiError: class ApiError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } } }));
const originalFetch = global.fetch;
const input = { message: "整理教學", locale: "zh", history: [{ role: "user", content: "教學問題", token: "PRIVATE_HISTORY_TOKEN" }], documentText: "已審核文件", account: { phone: "PRIVATE_PHONE" }, password: "PRIVATE_PASSWORD" };
const result = { previewToken: "a".repeat(64), expiresAt: 1000, summary: { writesAllowed: false, sensitiveDataAllowed: false, recipient: "DeepSeek" } };
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => result })); });
afterEach(() => { global.fetch = originalFetch; });

test("preview transport forwards only explicit text fields, not arbitrary props or auth in body", async () => {
  await previewAdminAssistant("SECRET_AUTH", input);
  const [url, options] = fetch.mock.calls[0]; expect(url).toBe("/api/admin/assistant/preview");
  expect(options.headers.Authorization).toBe("Bearer SECRET_AUTH");
  expect(JSON.parse(options.body)).toEqual({ message: input.message, locale: "zh", history: [{ role: "user", content: "教學問題" }], documentText: input.documentText });
  expect(options.body).not.toMatch(/PRIVATE|SECRET_AUTH/);
});

test("chat includes exact preview approval and refuses non-draft success responses", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ reply: "說明", draft: "草稿", references: [], draftOnly: true, published: false }) });
  await sendAdminAssistant("SECRET_AUTH", input, result.previewToken);
  expect(JSON.parse(fetch.mock.calls[0][1].body).previewToken).toBe(result.previewToken);
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ reply: "saved", draft: "x", references: [], draftOnly: false, published: true }) });
  await expect(sendAdminAssistant("SECRET_AUTH", input, result.previewToken)).rejects.toMatchObject({ code: "adminAssistantUnavailable" });
});

test("server privacy error is propagated as a stable code without echoing document content", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "adminAssistantSensitiveContent", detail: "PRIVATE_DOCUMENT" }) });
  await expect(previewAdminAssistant("SECRET_AUTH", input)).rejects.toMatchObject({ code: "adminAssistantSensitiveContent", status: 400 });
});
