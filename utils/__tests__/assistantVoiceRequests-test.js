import { ASSISTANT_VOICE_REQUEST_TTL_MS, assistantVoiceRequestScope, consumeAssistantVoiceRequest, createAssistantVoiceRequest } from "../assistantVoiceRequests";

const user = { id: "person", token: "token" };
const scope = assistantVoiceRequestScope(user, "zh");
afterEach(() => jest.restoreAllMocks());

test("an in-app tap creates a one-time recording intent; a URL cannot create one", () => {
  expect(consumeAssistantVoiceRequest("arbitrary-url", scope)).toBe(false);
  const id = createAssistantVoiceRequest(scope);
  expect(consumeAssistantVoiceRequest("another-url", scope)).toBe(false);
  expect(consumeAssistantVoiceRequest(id, scope)).toBe(true);
  expect(consumeAssistantVoiceRequest(id, scope)).toBe(false);
});

test("the latest deliberate tap invalidates a previous unconsumed one", () => {
  const first = createAssistantVoiceRequest(scope), second = createAssistantVoiceRequest(scope);
  expect(first).not.toBe(second);
  expect(consumeAssistantVoiceRequest(first, scope)).toBe(false);
  expect(consumeAssistantVoiceRequest(second, scope)).toBe(true);
});

test.each([
  [{ id: "different", token: "token" }, "zh"],
  [{ id: "person", token: "different" }, "zh"],
  [user, "en"],
])("an intent cannot cross account, login or language boundaries", (nextUser, locale) => {
  const id = createAssistantVoiceRequest(scope);
  expect(consumeAssistantVoiceRequest(id, assistantVoiceRequestScope(nextUser, locale))).toBe(false);
  expect(consumeAssistantVoiceRequest(id, scope)).toBe(false);
});

test("expired deep links cannot start recording after navigation or app restoration", () => {
  const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
  const id = createAssistantVoiceRequest(scope);
  clock.mockReturnValue(1000 + ASSISTANT_VOICE_REQUEST_TTL_MS);
  expect(consumeAssistantVoiceRequest(id, scope)).toBe(false);
});
