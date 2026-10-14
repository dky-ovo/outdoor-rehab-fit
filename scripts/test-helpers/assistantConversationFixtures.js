const PREFIX = "@outdoor_fit_ai_conversations_v2:";
const seededConversations = new WeakMap();

export function currentAssistantConversation(messages, { owner = "one", locale = "zh", authSessionId = "test-session" } = {}) {
  return JSON.stringify({
    version: 2, owner, locale, legacyChecked: true,
    conversations: [{
      id: "fixture-conversation", authSessionId,
      createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z",
      archived: false, legacy: false, messages,
    }],
  });
}

// Existing rendering regressions concern an explicitly active conversation,
// not migration of the old v1 history array. Match the requested owner/locale
// so their fixtures keep that scope explicit under the v2 storage contract.
export function mockCurrentAssistantConversation(storage, messages) {
  const from = storage.setItem.mock.calls.length;
  seededConversations.set(storage, { from, messages });
  storage.getItem.mockImplementation(async key => {
    const written = storage.setItem.mock.calls.slice(from).reverse().find(([saved]) => saved === key);
    if (written) return written[1];
    if (!key.startsWith(PREFIX)) return null;
    const suffix = key.slice(PREFIX.length);
    const separator = suffix.lastIndexOf(":");
    return currentAssistantConversation(messages, {
      owner: decodeURIComponent(suffix.slice(0, separator)), locale: suffix.slice(separator + 1),
    });
  });
}

export function persistedCurrentAssistantMessages(storage) {
  const seeded = seededConversations.get(storage);
  const raw = storage.setItem.mock.calls.slice(seeded?.from || 0).reverse().find(([key]) => key.startsWith(PREFIX))?.[1];
  // A no-op restore need not rewrite storage. In that case the seeded value
  // remains persisted, just as getItem above continues to return that value.
  if (!raw) return seeded?.messages || [];
  return JSON.parse(raw).conversations.find(item => !item.archived && !item.legacy && item.authSessionId === "test-session")?.messages || [];
}
