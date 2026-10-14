import AsyncStorage from "@react-native-async-storage/async-storage";
import { ASSISTANT_CONVERSATIONS_PREFIX, MAX_ASSISTANT_CONVERSATIONS, createAssistantSessionId,
  loadAssistantConversations, storeAssistantConversation, startNewAssistantConversation, listAssistantConversations,
  deleteAssistantConversation, clearAssistantConversationHistory, listAccountAssistantConversations,
  clearAccountAssistantConversationHistory, synchronizeAssistantConversations } from "../assistantConversations";
import { assistantMessagesForDisplay, resolveEquipmentRecommendations } from "../assistantEquipmentSearch";
import { assistantReplyPresentation } from "../assistantReplyPresentation";
import { withEquipmentTcmReply } from "../assistantTcm";

jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map();
  return { __esModule: true, default: { __data: data, getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } };
});
const identity = { owner: "user-one", locale: "zh", authSessionId: "session-one" };
const keyFor = ({ owner, locale }) => `${ASSISTANT_CONVERSATIONS_PREFIX}${encodeURIComponent(owner)}:${locale}`;
const legacyKey = ({ owner, locale }) => `@outdoor_fit_ai_history_v1:${owner}:${locale}`;
const question = (id, text = `Question ${id}`) => ({ id, sender: "user", text });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const archive = (conversations, value = identity) => ({ version: 2, owner: value.owner, locale: value.locale, legacyChecked: true, conversations });
const conversation = (id, messages, authSessionId = identity.authSessionId) => ({ id, authSessionId, messages, legacy: false, archived: false, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" });

test('provider switching preserves independent local composers and never imports DeepSeek legacy into Bailian', async () => {
  AsyncStorage.__data.set(legacyKey(identity), JSON.stringify([question('legacy', 'old DeepSeek only')]));
  const ds = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: ds.conversationId, messages: [question('ds')] });
  const bailian = { ...identity, provider: 'bailian' };
  const b = await loadAssistantConversations(bailian);
  expect(b.messages).toEqual([]); expect(b.history).toEqual([]);
  await storeAssistantConversation({ ...bailian, conversationId: b.conversationId, messages: [question('b'), { id: 'ba', sender: 'ai', reply: 'trained answer', provider: 'bailian', model: 'qwen', responsePolicy: 'provider_raw' }] });
  const otherLocale = { ...bailian, locale: 'en' };
  const en = await loadAssistantConversations(otherLocale);
  await storeAssistantConversation({ ...otherLocale, conversationId: en.conversationId, messages: [question('en')] });
  expect((await loadAssistantConversations(identity)).messages).toEqual([question('ds')]);
  const history = (await listAccountAssistantConversations(bailian)).history;
  expect(history).toHaveLength(2);
  expect(history.every(item => item.provider === 'bailian' && item.id.startsWith('bailian:'))).toBe(true);
  expect(history.flatMap(item => item.messages).some(message => message.id === 'legacy' || message.id === 'ds')).toBe(false);
  expect(history.flatMap(item => item.messages).find(message => message.id === 'ba')).toMatchObject({ provider: 'bailian', model: 'qwen', responsePolicy: 'provider_raw' });
  await startNewAssistantConversation(bailian); await startNewAssistantConversation(otherLocale);
  await clearAccountAssistantConversationHistory(bailian);
  expect((await listAccountAssistantConversations(bailian)).history).toEqual([]);
  expect((await listAccountAssistantConversations(identity)).history).toHaveLength(2);
});

test('Bailian sync pulls only its own collection and rejects a foreign answer without clearing pending edits', async () => {
  const b = { ...identity, provider: 'bailian' };
  const current = await loadAssistantConversations(b);
  await storeAssistantConversation({ ...b, conversationId: current.conversationId, messages: [question('local')] });
  const send = jest.fn(async (_token, outgoing) => ({ acknowledged: [], cursor: 1, more: false, records: [{ id: 'remote', version: 1, deleted: false, value: { provider: 'deepseek', createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', messages: [question('foreign')] } }] }));
  await expect(synchronizeAssistantConversations({ ...b, token: 'token', send })).rejects.toMatchObject({ code: 'assistantProviderMismatch' });
  expect(send.mock.calls[0][1].collection).toBe('assistant_bailian_zh');
  expect(send.mock.calls[0][1].changes).toHaveLength(1);
  const retry = jest.fn(async (_token, outgoing) => ({ acknowledged: [], records: [], cursor: 0, more: false }));
  await synchronizeAssistantConversations({ ...b, token: 'token', send: retry });
  expect(retry.mock.calls[0][1].changes).toEqual(send.mock.calls[0][1].changes);
  expect((await loadAssistantConversations(b)).messages.map(message => message.id)).toEqual(['local']);
});

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.__data.clear();
  AsyncStorage.getItem.mockImplementation(async key => AsyncStorage.__data.get(key) ?? null);
  AsyncStorage.setItem.mockImplementation(async (key, value) => { AsyncStorage.__data.set(key, value); });
});

test("a local lifecycle ID remains distinct even when timestamp and randomness coincide", () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1000);
  const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
  try { expect(createAssistantSessionId()).not.toBe(createAssistantSessionId()); }
  finally { now.mockRestore(); random.mockRestore(); }
});

test("the same authentication session restores its own active dialogue but a new login starts empty", async () => {
  const first = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: first.conversationId, messages: [question("q1")] });
  const resumed = await loadAssistantConversations(identity);
  expect(resumed.conversationId).toBe(first.conversationId);
  expect(resumed.messages).toEqual([question("q1")]);
  const next = await loadAssistantConversations({ ...identity, authSessionId: "session-two" });
  expect(next.conversationId).not.toBe(first.conversationId);
  expect(next.messages).toEqual([]);
  expect(next.history).toEqual([expect.objectContaining({ id: first.conversationId, readOnly: true, messages: [question("q1")] })]);
  await expect(storeAssistantConversation({ ...identity, conversationId: first.conversationId, messages: [question("late")] })).rejects.toMatchObject({ code: "assistantConversationChanged" });
});

test("a direct-guide presentation flag survives account history without allowing arbitrary metadata", async () => {
  const current = await loadAssistantConversations(identity);
  const reply = { id: "guide", sender: "ai", action: "equipment_local", reply: "按舒適幅度慢慢活動。", guideContentDirect: true, untrustedExtra: true };
  await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [reply] });
  const restored = await loadAssistantConversations(identity);
  expect(restored.messages[0]).toMatchObject({ guideContentDirect: true, reply: reply.reply });
  expect(restored.messages[0]).not.toHaveProperty("untrustedExtra");
  const freshLogin = await loadAssistantConversations({ ...identity, authSessionId: "another-session" });
  expect(freshLogin.history[0].messages[0].guideContentDirect).toBe(true);
});

test("starting a new dialogue archives the former one and refuses late writes to it", async () => {
  const first = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: first.conversationId, messages: [question("q1")] });
  const next = await startNewAssistantConversation(identity);
  expect(next.messages).toEqual([]);
  expect(next.history[0].messages).toEqual([question("q1")]);
  const before = AsyncStorage.__data.get(keyFor(identity));
  await expect(storeAssistantConversation({ ...identity, conversationId: first.conversationId, messages: [question("late")] })).rejects.toMatchObject({ code: "assistantConversationChanged" });
  expect(AsyncStorage.__data.get(keyFor(identity))).toBe(before);
  expect((await loadAssistantConversations(identity)).conversationId).toBe(next.conversationId);
});

test("owner and language boundaries never import or return another scope's text", async () => {
  for (const value of [identity, { ...identity, owner: "user-two" }, { ...identity, locale: "en" }]) {
    const current = await loadAssistantConversations(value);
    await storeAssistantConversation({ ...value, conversationId: current.conversationId, messages: [question(`${value.owner}-${value.locale}`)] });
  }
  expect((await loadAssistantConversations(identity)).messages).toEqual([question("user-one-zh")]);
  expect((await loadAssistantConversations({ ...identity, owner: "user-two" })).messages).toEqual([question("user-two-zh")]);
  expect((await loadAssistantConversations({ ...identity, locale: "en" })).messages).toEqual([question("user-one-en")]);
  expect((await listAssistantConversations(identity)).history).toHaveLength(1);
});

test('account history combines web and phone languages without activating or mixing their composers', async () => {
  for (const locale of ['zh','en']) {
    const value = {...identity,locale}, active = await loadAssistantConversations(value);
    await storeAssistantConversation({...value,conversationId:active.conversationId,messages:[question(`${locale}-question`)]});
    await startNewAssistantConversation(value);
  }
  const before = new Map(AsyncStorage.__data);
  const result = await listAccountAssistantConversations({owner:identity.owner});
  expect(result.history).toHaveLength(2);
  expect(new Set(result.history.map(item=>item.locale))).toEqual(new Set(['zh','en']));
  for (const item of result.history) {
    expect(item.id).toBe(`${item.locale}:${item.sourceId}`);
    expect(item).toMatchObject({readOnly:true,canDelete:true});
    expect(item.messages[0].id).toBe(`${item.locale}-question`);
  }
  expect(AsyncStorage.__data).toEqual(before);
  expect((await listAccountAssistantConversations({owner:'other-account'})).history).toEqual([]);
});

test('same legacy ID in both languages remains independently deletable and clear spans both collections', async () => {
  for (const locale of ['zh','en']) AsyncStorage.__data.set(legacyKey({...identity,locale}),JSON.stringify([question(`${locale}-old`)]));
  const history = (await listAccountAssistantConversations(identity)).history;
  expect(new Set(history.map(item=>item.id))).toEqual(new Set(['zh:legacy-v1','en:legacy-v1']));
  const target = history.find(item=>item.locale==='en');
  await deleteAssistantConversation({...identity,locale:target.locale,conversationId:target.sourceId});
  expect((await listAccountAssistantConversations(identity)).history.map(item=>item.id)).toEqual(['zh:legacy-v1']);
  await clearAccountAssistantConversationHistory(identity);
  expect((await listAccountAssistantConversations(identity)).history).toEqual([]);
});

test('account history excludes only the exact current composer and protects another active language', async () => {
  const current = await loadAssistantConversations(identity);
  await storeAssistantConversation({...identity,conversationId:current.conversationId,messages:[question('current')]});
  const english = {...identity,locale:'en'}, other = await loadAssistantConversations(english);
  await storeAssistantConversation({...english,conversationId:other.conversationId,messages:[question('english-current')]});
  const result = await listAccountAssistantConversations({owner:identity.owner,exclude:{locale:'zh',conversationId:current.conversationId}});
  expect(result.history).toHaveLength(1);
  expect(result.history[0]).toMatchObject({locale:'en',sourceId:other.conversationId,canDelete:false});
  await clearAccountAssistantConversationHistory(identity);
  expect((await loadAssistantConversations(identity)).messages[0].id).toBe('current');
  expect((await loadAssistantConversations(english)).messages[0].id).toBe('english-current');
});

test("legacy text migrates once into read-only history, never active context; original bytes remain", async () => {
  const legacy = [question("old", "Old knee pain"), { id: "answer", sender: "ai", reply: "Old explanation", action: "equipment_evidence", recommendations: [{ id: "4" }], token: "NEVER_KEEP", imageData: "NEVER_KEEP" }];
  const original = JSON.stringify(legacy);
  AsyncStorage.__data.set(legacyKey(identity), original);
  const current = await loadAssistantConversations(identity);
  expect(current.messages).toEqual([]);
  expect(current.history).toHaveLength(1);
  expect(current.history[0]).toMatchObject({ id: "legacy-v1", legacy: true, readOnly: true });
  expect(current.history[0].messages[0]).toEqual(question("old", "Old knee pain"));
  expect(current.history[0].messages[1]).toMatchObject({ reply: "Old explanation", retiredImage: true });
  expect(JSON.stringify(current)).not.toContain("NEVER_KEEP");
  expect(AsyncStorage.__data.get(legacyKey(identity))).toBe(original);
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect((await loadAssistantConversations(identity)).history).toHaveLength(1);
});

test("listing history is read-only and does not activate an old conversation or persist migration", async () => {
  AsyncStorage.__data.set(legacyKey(identity), JSON.stringify([question("old")]));
  const listed = await listAssistantConversations({ owner: identity.owner, locale: identity.locale });
  expect(listed.history[0]).toMatchObject({ readOnly: true, legacy: true });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  const current = await loadAssistantConversations(identity);
  expect(current.messages).toEqual([]);
  const before = AsyncStorage.__data.get(keyFor(identity));
  await listAssistantConversations(identity);
  expect(AsyncStorage.__data.get(keyFor(identity))).toBe(before);
});

test("messages retain validated display metadata but exclude auth, unknown fields, and retired images", async () => {
  const current = await loadAssistantConversations(identity);
  const message = { id: "a", sender: "ai", reply: "A guide", action: "equipment_evidence", deepSeekUsed: true,
    evidencePolicy: "app-symptom-deepseek-v2", token: "SECRET", apiKey: "SECRET", password: "SECRET", user: { token: "SECRET" },
    recommendations: [{ id: 4, name: "Stretch", evidence: { field: "ptTip", quote: "Maintained text", targets: ["knee"], token: "SECRET" }, apiKey: "SECRET" }],
    facility: { name: "Park", latitude: 22.3, longitude: 114.1, authorization: "SECRET" } };
  const saved = await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [message] });
  expect(saved.messages[0]).toMatchObject({ deepSeekUsed: true, evidencePolicy: "app-symptom-deepseek-v2", recommendations: [{ id: "4", evidence: { field: "ptTip", quote: "Maintained text", targets: ["knee"] } }] });
  expect(AsyncStorage.__data.get(keyFor(identity))).not.toContain("SECRET");
  const next = await startNewAssistantConversation(identity);
  expect(next.history[0].messages).toEqual(saved.messages);
  expect(next.history[0].readOnly).toBe(true);
  expect(JSON.stringify(next.history)).not.toContain("SECRET");
});

test("read-only v2 history preserves source metadata so edited evidence is not rendered as a current claim", async () => {
  const quote = "伸展可以幫助膝關節炎患者減輕膝關節痛楚。";
  const catalog = [{ id: "10", name: "小腿伸展", isActive: true, ptTip: quote }];
  const answer = withEquipmentTcmReply({ id: "ai", sender: "ai", action: "equipment_evidence", source: "app_content", knowledgeSource: "facility_guide",
    evidencePolicy: "app-symptom-deepseek-v2", deepSeekUsed: true, recommendationsFinal: true,
    reply: "我為您找到小腿伸展的說明。", recommendations: [{ id: "10", reason: quote, evidence: { field: "ptTip", quote, targets: ["knee"] } }],
  }, catalog);
  const current = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("q", "我的膝蓋痛，推薦器材"), answer] });
  const next = await startNewAssistantConversation(identity);
  const history = next.history[0].messages;
  const before = JSON.stringify(history);
  expect(next.messages).toEqual([]);
  expect(assistantMessagesForDisplay(history, catalog)[1].reply).toBe(answer.reply);
  const changed = assistantMessagesForDisplay(history, [{ ...catalog[0], ptTip: "旧內容已移除。" }])[1];
  expect(changed.recommendations).toEqual([]);
  expect(changed.reply).toContain("請重新提問");
  expect(changed.reply).not.toContain(quote);
  expect(JSON.stringify(history)).toBe(before);
});

test("read-only full explanations retain a caution that appeared only in a saved facility card", async () => {
  const catalog = [{ id: "10", name: "小腿伸展", isActive: true, details: "慢慢伸展。" }];
  const answer = { id: "ai", sender: "ai", action: "equipment", reply: "可查閱器材教學。",
    recommendations: [{ id: "10", reason: "如不舒服，請立即停止並諮詢專業人員。" }] };
  const current = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("q", "介紹小腿伸展器材"), answer] });
  const next = await startNewAssistantConversation(identity);
  const checked = assistantMessagesForDisplay(next.history[0].messages, catalog)[1];
  const fullText = assistantReplyPresentation(checked, resolveEquipmentRecommendations(checked.recommendations, catalog), "zh").fullText;
  expect(fullText).toContain(answer.recommendations[0].reason);
  expect(next.messages).toEqual([]);
});

test("same-scope writes are serialized and snapshot inputs before waiting", async () => {
  const current = await loadAssistantConversations(identity);
  const started = deferred(), finish = deferred();
  AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { started.resolve(); await finish.promise; AsyncStorage.__data.set(key, value); });
  const first = storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("one")] });
  await started.promise;
  const messages = [question("one"), question("two")];
  const second = storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages });
  messages[1].text = "MUTATED_AFTER_CALL";
  finish.resolve();
  await Promise.all([first, second]);
  expect((await loadAssistantConversations(identity)).messages).toEqual([question("one"), question("two")]);
});

test("an owner change while a write is delayed cannot put the old text in the new owner's storage", async () => {
  const first = await loadAssistantConversations(identity);
  const started = deferred(), finish = deferred();
  AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { started.resolve(); await finish.promise; AsyncStorage.__data.set(key, value); });
  const pending = storeAssistantConversation({ ...identity, conversationId: first.conversationId, messages: [question("private-one")] });
  await started.promise;
  const second = await loadAssistantConversations({ ...identity, owner: "second" });
  finish.resolve(); await pending;
  expect(second.messages).toEqual([]);
  expect(second.history).toEqual([]);
  expect(AsyncStorage.__data.get(keyFor({ ...identity, owner: "second" }))).not.toContain("private-one");
});

test.each(["read", "write", "corrupt", "wrongOwner"])("%s failures leave the existing archive untouched and permit a later retry", async mode => {
  const current = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("original")] });
  const valid = AsyncStorage.__data.get(keyFor(identity));
  if (mode === "read") AsyncStorage.getItem.mockRejectedValueOnce(new Error("read failed"));
  if (mode === "write") AsyncStorage.setItem.mockRejectedValueOnce(new Error("write failed"));
  if (mode === "corrupt") AsyncStorage.__data.set(keyFor(identity), "{broken");
  if (mode === "wrongOwner") AsyncStorage.__data.set(keyFor(identity), JSON.stringify({ ...JSON.parse(valid), owner: "different-owner" }));
  const before = AsyncStorage.__data.get(keyFor(identity));
  await expect(storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("replacement")] })).rejects.toThrow();
  expect(AsyncStorage.__data.get(keyFor(identity))).toBe(before);
  AsyncStorage.__data.set(keyFor(identity), valid);
  expect((await loadAssistantConversations(identity)).messages).toEqual([question("original")]);
});

test("failed or corrupt legacy migration does not initialize an empty replacement archive", async () => {
  AsyncStorage.__data.set(legacyKey(identity), "broken");
  await expect(loadAssistantConversations(identity)).rejects.toMatchObject({ code: "assistantConversationStorageCorrupt" });
  expect(AsyncStorage.__data.has(keyFor(identity))).toBe(false);
  expect(AsyncStorage.__data.get(legacyKey(identity))).toBe("broken");
  AsyncStorage.getItem.mockImplementationOnce(async () => null).mockRejectedValueOnce(new Error("legacy read failed"));
  await expect(loadAssistantConversations(identity)).rejects.toThrow("legacy read failed");
  expect(AsyncStorage.__data.has(keyFor(identity))).toBe(false);
});

test("message retention stays at eighty, excludes welcome, and deduplicates message IDs", async () => {
  const current = await loadAssistantConversations(identity);
  const messages = Array.from({ length: 100 }, (_, index) => question(String(index)));
  const saved = await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [...messages, question("welcome")] });
  expect(saved.messages).toHaveLength(80);
  expect(saved.messages[0].id).toBe("20");
  const deduped = await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("one"), question("one")] });
  expect(deduped.messages).toHaveLength(1);
});

test("a full archive permits one empty active placeholder but rejects its first save without evicting history", async () => {
  const conversations = Array.from({ length: MAX_ASSISTANT_CONVERSATIONS }, (_, index) => ({ ...conversation(`c${index}`, [question(`q${index}`)]), archived: index !== 99 }));
  const original = JSON.stringify(archive(conversations));
  AsyncStorage.__data.set(keyFor(identity), original);
  const current = await startNewAssistantConversation(identity);
  expect(current.messages).toEqual([]);
  expect(current.history).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
  const withPlaceholder = AsyncStorage.__data.get(keyFor(identity));
  expect(JSON.parse(withPlaceholder).conversations).toHaveLength(MAX_ASSISTANT_CONVERSATIONS + 1);
  await expect(storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("new")] })).rejects.toMatchObject({ code: "assistantHistoryFull" });
  expect(AsyncStorage.__data.get(keyFor(identity))).toBe(withPlaceholder);
  expect((await startNewAssistantConversation(identity)).history).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
  expect(JSON.parse(AsyncStorage.__data.get(keyFor(identity))).conversations).toHaveLength(MAX_ASSISTANT_CONVERSATIONS + 1);
  expect((await listAssistantConversations(identity)).history).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
});

test("oversized writes report a limit instead of replacing or trimming old history", async () => {
  const current = await loadAssistantConversations(identity);
  await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("original")] });
  const original = AsyncStorage.__data.get(keyFor(identity));
  await expect(storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("large", "x".repeat(400001))] })).rejects.toMatchObject({ code: "assistantHistoryFull" });
  expect(AsyncStorage.__data.get(keyFor(identity))).toBe(original);
});

test.each([{ owner: "" }, { owner: null }, { locale: "invalid" }, { authSessionId: "" }])("invalid scope %j is rejected before storage access", invalid => {
  expect(() => loadAssistantConversations({ ...identity, ...invalid })).toThrow("assistantConversationScopeRequired");
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

describe("history deletion", () => {
  const savedArchive = () => JSON.parse(AsyncStorage.__data.get(keyFor(identity)));
  function seedHistory(value = identity) {
    const items = [
      { ...conversation("old-one", [question("old-one")], "previous-session"), archived: true },
      { ...conversation("old-two", [question("old-two")], value.authSessionId), archived: true },
      conversation("active", [question("current")], value.authSessionId),
    ];
    AsyncStorage.__data.set(keyFor(value), JSON.stringify(archive(items, value)));
    return items;
  }

  test("deleting one archived dialogue returns remaining history without changing the active dialogue", async () => {
    const items = seedHistory();
    const result = await deleteAssistantConversation({ ...identity, conversationId: "old-one" });
    expect(result.history.map(item => item.id)).toEqual(["old-two"]);
    expect(savedArchive().conversations).toEqual(items.slice(1));
    expect((await loadAssistantConversations(identity)).messages).toEqual([question("current")]);
  });

  test("clearing history preserves the active ID, timestamps, messages and read-only metadata", async () => {
    const items = seedHistory();
    const result = await clearAssistantConversationHistory(identity);
    expect(result).toEqual({ history: [] });
    expect(savedArchive().conversations).toEqual([items[2]]);
    const current = await loadAssistantConversations(identity);
    expect(current.conversationId).toBe("active");
    expect(current.messages).toEqual([question("current")]);
  });

  test("the current active dialogue cannot be deleted and rejection writes nothing", async () => {
    seedHistory();
    const original = AsyncStorage.__data.get(keyFor(identity));
    await expect(deleteAssistantConversation({ ...identity, conversationId: "active" })).rejects.toMatchObject({ code: "assistantConversationActive" });
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(original);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test("a late deletion from a previous login cannot remove the newer login's active dialogue", async () => {
    const currentIdentity = { ...identity, authSessionId: "new-login" };
    const items = seedHistory(currentIdentity);
    await expect(deleteAssistantConversation({ ...identity, conversationId: "active" })).rejects.toMatchObject({ code: "assistantConversationActive" });
    await clearAssistantConversationHistory(identity);
    expect(savedArchive().conversations).toEqual([items[2]]);
    expect((await loadAssistantConversations(currentIdentity)).messages).toEqual([question("current")]);
  });

  test.each(["one", "all"])("%s deletion is confined to owner and locale even when IDs match", async mode => {
    seedHistory();
    const others = [{ ...identity, owner: "other-owner" }, { ...identity, locale: "en" }];
    others.forEach(seedHistory);
    const untouched = others.map(value => AsyncStorage.__data.get(keyFor(value)));
    if (mode === "one") await deleteAssistantConversation({ ...identity, conversationId: "old-one" });
    else await clearAssistantConversationHistory(identity);
    others.forEach((value, index) => expect(AsyncStorage.__data.get(keyFor(value))).toBe(untouched[index]));
    const result = await deleteAssistantConversation({ ...identity, conversationId: "belongs-to-someone-else" });
    expect(result.history.every(item => !["active", "belongs-to-someone-else"].includes(item.id))).toBe(true);
  });

  test("unknown IDs and repeated deletion are idempotent without rewriting unchanged bytes", async () => {
    seedHistory();
    const first = await deleteAssistantConversation({ ...identity, conversationId: "old-one" });
    const afterFirst = AsyncStorage.__data.get(keyFor(identity));
    const writes = AsyncStorage.setItem.mock.calls.length;
    expect(await deleteAssistantConversation({ ...identity, conversationId: "old-one" })).toEqual(first);
    expect(await deleteAssistantConversation({ ...identity, conversationId: "unknown" })).toEqual(first);
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(afterFirst);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
    await clearAssistantConversationHistory(identity);
    const afterClear = AsyncStorage.__data.get(keyFor(identity));
    const clearWrites = AsyncStorage.setItem.mock.calls.length;
    expect(await clearAssistantConversationHistory(identity)).toEqual({ history: [] });
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(afterClear);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(clearWrites);
  });

  test("archived empty placeholders are pruned without creating an active conversation", async () => {
    AsyncStorage.__data.set(keyFor(identity), JSON.stringify(archive([
      { ...conversation("empty-old", [], "old"), archived: true },
      { ...conversation("old", [question("old")], "old"), archived: true },
    ])));
    await deleteAssistantConversation({ ...identity, conversationId: "old" });
    expect(savedArchive().conversations).toEqual([]);
    expect(await listAssistantConversations(identity)).toEqual({ history: [] });
  });

  test("clearing history preserves an empty active placeholder rather than replacing it", async () => {
    const current = await loadAssistantConversations(identity);
    const active = savedArchive().conversations[0];
    await clearAssistantConversationHistory(identity);
    expect(savedArchive().conversations).toEqual([active]);
    expect((await loadAssistantConversations(identity)).conversationId).toBe(current.conversationId);
  });

  test.each(["one", "all"])("%s deletion never revives a legacy history or modifies its source key", async mode => {
    const legacy = JSON.stringify([question("legacy-old")]);
    AsyncStorage.__data.set(legacyKey(identity), legacy);
    // A read-only list can expose legacy history before any active conversation
    // or v2 archive exists. Deletion must work in this state as well.
    expect((await listAssistantConversations(identity)).history[0].id).toBe("legacy-v1");
    if (mode === "one") await deleteAssistantConversation({ ...identity, conversationId: "legacy-v1" });
    else await clearAssistantConversationHistory(identity);
    expect(savedArchive()).toMatchObject({ legacyChecked: true, conversations: [] });
    expect(AsyncStorage.__data.get(legacyKey(identity))).toBe(legacy);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect((await loadAssistantConversations(identity)).history).toEqual([]);
    expect((await listAssistantConversations(identity)).history).toEqual([]);
  });

  test.each(["read", "write", "corrupt", "wrongOwner"])("%s failure leaves original bytes untouched and does not poison later operations", async mode => {
    seedHistory();
    const valid = AsyncStorage.__data.get(keyFor(identity));
    if (mode === "read") AsyncStorage.getItem.mockRejectedValueOnce(new Error("read failed"));
    if (mode === "write") AsyncStorage.setItem.mockRejectedValueOnce(new Error("write failed"));
    if (mode === "corrupt") AsyncStorage.__data.set(keyFor(identity), "{broken");
    if (mode === "wrongOwner") AsyncStorage.__data.set(keyFor(identity), JSON.stringify({ ...JSON.parse(valid), owner: "other" }));
    const before = AsyncStorage.__data.get(keyFor(identity));
    await expect(deleteAssistantConversation({ ...identity, conversationId: "old-one" })).rejects.toThrow();
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(before);
    AsyncStorage.__data.set(keyFor(identity), valid);
    expect((await deleteAssistantConversation({ ...identity, conversationId: "old-one" })).history.map(item => item.id)).toEqual(["old-two"]);
  });

  test("a failed clear or legacy read does not erase history or complete a migration", async () => {
    seedHistory();
    const original = AsyncStorage.__data.get(keyFor(identity));
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("clear failed"));
    await expect(clearAssistantConversationHistory(identity)).rejects.toThrow("clear failed");
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(original);
    AsyncStorage.__data.delete(keyFor(identity));
    AsyncStorage.__data.set(legacyKey(identity), "invalid json");
    await expect(clearAssistantConversationHistory(identity)).rejects.toMatchObject({ code: "assistantConversationStorageCorrupt" });
    expect(AsyncStorage.__data.has(keyFor(identity))).toBe(false);
    expect(AsyncStorage.__data.get(legacyKey(identity))).toBe("invalid json");
  });

  test("deleting from a full archive frees capacity without evicting another dialogue", async () => {
    const items = Array.from({ length: MAX_ASSISTANT_CONVERSATIONS }, (_, index) => ({ ...conversation(`c${index}`, [question(`q${index}`)]), archived: index !== 99 }));
    AsyncStorage.__data.set(keyFor(identity), JSON.stringify(archive(items)));
    const current = await startNewAssistantConversation(identity);
    await expect(storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("new")] })).rejects.toMatchObject({ code: "assistantHistoryFull" });
    await deleteAssistantConversation({ ...identity, conversationId: "c0" });
    const next = await storeAssistantConversation({ ...identity, conversationId: current.conversationId, messages: [question("new")] });
    expect(next.history).toHaveLength(99);
    expect(next.history.some(item => item.id === "c0")).toBe(false);
    expect(next.history.some(item => item.id === "c99")).toBe(true);
    expect(savedArchive().conversations).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
  });

  test("a new login at 100 saved dialogues loads a real active ID and can save after deleting history", async () => {
    const items = Array.from({ length: MAX_ASSISTANT_CONVERSATIONS }, (_, index) => ({ ...conversation(`c${index}`, [question(`q${index}`)]), archived: index !== 99 }));
    AsyncStorage.__data.set(keyFor(identity), JSON.stringify(archive(items)));
    const nextIdentity = { ...identity, authSessionId: "new-login-at-capacity" };
    const current = await loadAssistantConversations(nextIdentity);
    expect(current.conversationId).toMatch(/^conversation-ai-session-/);
    expect(current.messages).toEqual([]);
    expect(current.history).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
    const beforeSave = AsyncStorage.__data.get(keyFor(identity));
    await expect(storeAssistantConversation({ ...nextIdentity, conversationId: current.conversationId, messages: [question("new-login-message")] })).rejects.toMatchObject({ code: "assistantHistoryFull" });
    expect(AsyncStorage.__data.get(keyFor(identity))).toBe(beforeSave);
    const deleted = await deleteAssistantConversation({ ...nextIdentity, conversationId: "c0" });
    expect(deleted.history).toHaveLength(99);
    const saved = await storeAssistantConversation({ ...nextIdentity, conversationId: current.conversationId, messages: [question("new-login-message")] });
    expect(saved.conversationId).toBe(current.conversationId);
    expect(saved.messages).toEqual([question("new-login-message")]);
    expect(savedArchive().conversations).toHaveLength(MAX_ASSISTANT_CONVERSATIONS);
  });

  test("deletion can reduce an already-oversized archive and later writes resume after enough space is freed", async () => {
    AsyncStorage.__data.set(keyFor(identity), JSON.stringify(archive([
      { ...conversation("huge-one", [question("huge-one", "x".repeat(410000))]), archived: true },
      { ...conversation("huge-two", [question("huge-two", "y".repeat(410000))]), archived: true },
      conversation("active", [question("current")]),
    ])));
    await deleteAssistantConversation({ ...identity, conversationId: "huge-one" });
    expect(savedArchive().conversations.map(item => item.id)).toEqual(["huge-two", "active"]);
    await expect(storeAssistantConversation({ ...identity, conversationId: "active", messages: [question("new")] })).rejects.toMatchObject({ code: "assistantHistoryFull" });
    await deleteAssistantConversation({ ...identity, conversationId: "huge-two" });
    await expect(storeAssistantConversation({ ...identity, conversationId: "active", messages: [question("new")] })).resolves.toMatchObject({ messages: [question("new")] });
  });

  test("an in-flight active save followed by deletion cannot resurrect the deleted history", async () => {
    seedHistory();
    const started = deferred(), finish = deferred();
    AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { started.resolve(); await finish.promise; AsyncStorage.__data.set(key, value); });
    const saving = storeAssistantConversation({ ...identity, conversationId: "active", messages: [question("latest")] });
    await started.promise;
    const deleting = deleteAssistantConversation({ ...identity, conversationId: "old-one" });
    const stale = storeAssistantConversation({ ...identity, conversationId: "old-one", messages: [question("resurrect")] });
    const staleRejected = expect(stale).rejects.toMatchObject({ code: "assistantConversationChanged" });
    finish.resolve();
    await Promise.all([saving, deleting, staleRejected]);
    expect(savedArchive().conversations.map(item => item.id)).toEqual(["old-two", "active"]);
    expect(savedArchive().conversations[1].messages).toEqual([question("latest")]);
  });

  test("an in-flight clear followed by an active save preserves only the latest current messages", async () => {
    seedHistory();
    const started = deferred(), finish = deferred();
    AsyncStorage.setItem.mockImplementationOnce(async (key, value) => { started.resolve(); await finish.promise; AsyncStorage.__data.set(key, value); });
    const clearing = clearAssistantConversationHistory(identity);
    await started.promise;
    const saving = storeAssistantConversation({ ...identity, conversationId: "active", messages: [question("latest")] });
    finish.resolve();
    await Promise.all([clearing, saving]);
    expect(savedArchive().conversations).toEqual([expect.objectContaining({ id: "active", messages: [question("latest")] })]);
  });

  test.each([undefined, null, "", " ", 123, "x".repeat(257)])("invalid target %j is rejected before accessing storage", conversationId => {
    expect(() => deleteAssistantConversation({ ...identity, conversationId })).toThrow("assistantConversationInvalidId");
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  test.each([{ owner: "" }, { owner: null }, { locale: "invalid" }, { authSessionId: "" }])("both deletion APIs reject invalid scope %j before storage", invalid => {
    expect(() => deleteAssistantConversation({ ...identity, ...invalid, conversationId: "old" })).toThrow("assistantConversationScopeRequired");
    expect(() => clearAssistantConversationHistory({ ...identity, ...invalid })).toThrow("assistantConversationScopeRequired");
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
