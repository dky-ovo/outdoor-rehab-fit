import AsyncStorage from "@react-native-async-storage/async-storage";
import { updateJournal, journalBatch, reconcileJournal } from './accountSyncJournal';
import { notifyAccountData } from './accountSyncEvents';

export const ASSISTANT_CONVERSATIONS_PREFIX = "@outdoor_fit_ai_conversations_v2:";
export const MAX_ASSISTANT_CONVERSATIONS = 100;
export const MAX_ASSISTANT_MESSAGES = 80;
const MAX_ARCHIVE_CHARACTERS = 400000;
const queues = new Map();
let sequence = 0;

// This is a local lifecycle identifier, not a credential or authorization token.
export function createAssistantSessionId() {
  return `ai-session-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function fail(code) { return Object.assign(new Error(code), { code }); }
function scope(options) {
  const { owner, locale, authSessionId } = options || {};
  if (typeof owner !== "string" || !owner.trim() || owner.length > 256 || !["zh", "en"].includes(locale) ||
    typeof authSessionId !== "string" || !authSessionId.trim() || authSessionId.length > 160) throw fail("assistantConversationScopeRequired");
  return { owner, locale, authSessionId, key: `${ASSISTANT_CONVERSATIONS_PREFIX}${encodeURIComponent(owner)}:${locale}` };
}

function serialized(key, operation) {
  const pending = (queues.get(key) || Promise.resolve()).then(operation);
  const settled = pending.then(() => {}, () => {});
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return pending;
}

const MESSAGE_FIELDS = ["text", "reply", "action", "focus", "source", "knowledgeSource", "evidencePolicy", "equipmentReplyVersion", "equipmentReplyBase", "model", "confirmationAnswered"];
const BOOLEAN_FIELDS = ["confirmationRequired", "recommendationsFinal", "deepSeekUsed", "tcmInReply", "retiredImage"];
function excerpt(value) {
  if (!value || typeof value.field !== "string" || typeof value.quote !== "string") return undefined;
  return { field: value.field, quote: value.quote,
    ...(Array.isArray(value.targets) ? { targets: value.targets.filter(item => typeof item === "string") } : {}) };
}
function cleanMessages(messages, textOnly = false) {
  if (!Array.isArray(messages)) throw fail("assistantConversationInvalidMessages");
  const seen = new Set();
  return messages.filter(item => item && typeof item === "object" && typeof item.id === "string" && item.id !== "welcome" &&
    ["user", "ai"].includes(item.sender) && [item.text, item.reply].some(value => typeof value === "string" && value.trim())).slice(-MAX_ASSISTANT_MESSAGES).flatMap(item => {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    const clean = { id: item.id, sender: item.sender };
    const retiredImage = Boolean(item.retiredImage || item.imageUri || item.imageData || /^u-img-|^a-img-|^a-confirm-/.test(item.id) || ["equipment_image", "image_confirmation"].includes(item.action));
    for (const field of textOnly || retiredImage ? ["text", "reply"] : MESSAGE_FIELDS) if (typeof item[field] === "string") clean[field] = item[field];
    if (retiredImage) return [{ ...clean, retiredImage: true, action: "retired_image", recommendations: [] }];
    if (textOnly) return [clean];
    for (const field of BOOLEAN_FIELDS) if (typeof item[field] === "boolean") clean[field] = item[field];
    if (Array.isArray(item.categories)) clean.categories = item.categories.filter(value => typeof value === "string");
    if (Array.isArray(item.recommendations)) clean.recommendations = item.recommendations.slice(0, 12).flatMap(value => {
      if (!value || !["string", "number"].includes(typeof value.id)) return [];
      const card = { id: String(value.id) };
      for (const field of ["name", "reason"]) if (typeof value[field] === "string") card[field] = value[field];
      for (const field of ["evidence", "tcmExcerpt"]) { const quoted = excerpt(value[field]); if (quoted) card[field] = quoted; }
      return [card];
    });
    if (item.facility && typeof item.facility === "object") {
      clean.facility = {};
      for (const field of ["id", "name", "nameZh", "nameEn", "address", "district", "latitude", "longitude", "distanceKm"])
        if (["string", "number"].includes(typeof item.facility[field])) clean.facility[field] = item.facility[field];
    }
    return [clean];
  });
}

async function readArchive(identity) {
  const raw = await AsyncStorage.getItem(identity.key);
  let archive;
  if (raw != null) {
    try { archive = JSON.parse(raw); } catch { throw fail("assistantConversationStorageCorrupt"); }
    if (archive?.version !== 2 || archive.owner !== identity.owner || archive.locale !== identity.locale ||
      !Array.isArray(archive.conversations) || typeof archive.legacyChecked !== "boolean") throw fail("assistantConversationStorageCorrupt");
    const ids = new Set();
    for (const item of archive.conversations) {
      if (!item || typeof item.id !== "string" || ids.has(item.id) || typeof item.authSessionId !== "string" ||
        typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.archived !== "boolean" ||
        typeof item.legacy !== "boolean" || !Array.isArray(item.messages)) throw fail("assistantConversationStorageCorrupt");
      ids.add(item.id);
      item.messages = cleanMessages(item.messages, item.legacy);
    }
  } else archive = { version: 2, owner: identity.owner, locale: identity.locale, legacyChecked: false, conversations: [] };
  let changed = false;
  if (!archive.legacyChecked) {
    // A failed legacy read/parse must not mark migration complete or overwrite
    // an existing archive. The original key is never deleted or modified.
    const legacyRaw = await AsyncStorage.getItem(`@outdoor_fit_ai_history_v1:${identity.owner}:${identity.locale}`);
    if (legacyRaw != null) {
      let legacy;
      try { legacy = JSON.parse(legacyRaw); } catch { throw fail("assistantConversationStorageCorrupt"); }
      if (!Array.isArray(legacy)) throw fail("assistantConversationStorageCorrupt");
      const messages = cleanMessages(legacy, true);
      if (messages.length) {
        const now = new Date().toISOString();
        archive.conversations.push({ id: "legacy-v1", authSessionId: "", createdAt: now, updatedAt: now, archived: true, legacy: true, messages });
      }
    }
    archive.legacyChecked = true;
    changed = true;
  }
  return { archive, changed };
}

function newConversation(authSessionId) {
  const now = new Date().toISOString();
  return { id: `conversation-${createAssistantSessionId()}`, authSessionId, createdAt: now, updatedAt: now, archived: false, legacy: false, messages: [] };
}
function activeConversation(archive, authSessionId) {
  return archive.conversations.find(item => item.authSessionId === authSessionId && !item.archived && !item.legacy);
}
function snapshot(archive, active) {
  return { conversationId: active.id, messages: active.messages,
    history: historySnapshots(archive, active.id) };
}
function historySnapshots(archive, excludedId) {
  return archive.conversations.filter(item => item.id !== excludedId && item.messages.length).slice().reverse().map(item => ({
      id: item.id, title: String(item.messages.find(message => message.sender === "user")?.text || item.messages[0]?.text || item.messages[0]?.reply || "").slice(0, 80),
      // Read-only is a UI/context boundary, not a reason to erase evidence.
      // Current-format answers need their vetted metadata to recheck edited
      // guide passages and include card-only cautions in the full reader.
      // Legacy migration intentionally remains text-only.
      createdAt: item.createdAt, updatedAt: item.updatedAt, messages: cleanMessages(item.messages, item.legacy), readOnly: true, legacy: item.legacy,
    }));
}
async function writeArchive(identity, archive, active) {
  // Discard only empty placeholders. Never evict an earlier conversation to
  // make space: report the storage limit and leave the existing bytes intact.
  archive.conversations = archive.conversations.filter(item => item.id === active.id || item.messages.length || isLiveConversation(item));
  const serializedArchive = JSON.stringify({ ...archive, cloud: undefined });
  // A new login still needs a real, empty active ID when 100 saved dialogues
  // exist. Only dialogues containing messages consume history slots; the
  // filter above permits at most one additional empty active placeholder.
  const savedConversationCount = archive.conversations.filter(item => item.messages.length).length;
  if (savedConversationCount > MAX_ASSISTANT_CONVERSATIONS || serializedArchive.length > MAX_ARCHIVE_CHARACTERS) throw fail("assistantHistoryFull");
  archive.cloud = updateJournal(archive.cloud, cloudConversations(archive));
  await AsyncStorage.setItem(identity.key, JSON.stringify(archive));
  notifyAccountData(identity.owner, 'assistant');
}

function isLiveConversation(item) { return !item.archived && !item.legacy; }
function deletionConversationId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw fail("assistantConversationInvalidId");
  return value;
}
async function persistHistoryDeletion(identity, archive, changed) {
  // A delayed deletion from an old login must also preserve the newer login's
  // active dialogue. Prune archived empty placeholders, never a live one.
  const conversations = archive.conversations.filter(item => isLiveConversation(item) || item.messages.length);
  if (conversations.length !== archive.conversations.length) changed = true;
  archive.conversations = conversations;
  // Deletion creates no conversations or new message content. Allow it to
  // reduce an already-full archive even if more deletions are still needed.
  // Persist legacyChecked, including when deleting a just-migrated legacy
  // history; retaining the original v1 key must not resurrect deleted text.
  if (changed) {
    archive.cloud = updateJournal(archive.cloud, cloudConversations(archive));
    await AsyncStorage.setItem(identity.key, JSON.stringify(archive));
    notifyAccountData(identity.owner, 'assistant');
  }
  const active = activeConversation(archive, identity.authSessionId);
  return { history: historySnapshots(archive, active?.id) };
}

export function deleteAssistantConversation(options) {
  const identity = scope(options);
  const conversationId = deletionConversationId(options.conversationId);
  return serialized(identity.key, async () => {
    const { archive, changed } = await readArchive(identity);
    const target = archive.conversations.find(item => item.id === conversationId);
    if (target && isLiveConversation(target)) throw fail("assistantConversationActive");
    if (target) archive.conversations = archive.conversations.filter(item => item.id !== conversationId);
    return persistHistoryDeletion(identity, archive, changed || Boolean(target));
  });
}

export function clearAssistantConversationHistory(options) {
  const identity = scope(options);
  return serialized(identity.key, async () => {
    const { archive, changed } = await readArchive(identity);
    const kept = archive.conversations.filter(isLiveConversation);
    const removed = kept.length !== archive.conversations.length;
    archive.conversations = kept;
    return persistHistoryDeletion(identity, archive, changed || removed);
  });
}

export function listAssistantConversations(options) {
  const identity = scope({ ...options, authSessionId: "history-read-only" });
  return serialized(identity.key, async () => {
    const { archive } = await readArchive(identity);
    // Listing neither activates a conversation nor changes the migration flag.
    return { history: historySnapshots(archive) };
  });
}

export function loadAssistantConversations(options) {
  const identity = scope(options);
  return serialized(identity.key, async () => {
    const { archive, changed } = await readArchive(identity);
    let active = activeConversation(archive, identity.authSessionId);
    const created = !active;
    if (!active) {
      for (const item of archive.conversations) item.archived = true;
      active = newConversation(identity.authSessionId);
      archive.conversations.push(active);
    }
    if (changed || created) await writeArchive(identity, archive, active);
    return snapshot(archive, active);
  });
}

export function storeAssistantConversation(options) {
  const identity = scope(options);
  // Capture the caller's snapshot now, not after an earlier storage write ends.
  const conversationId = options.conversationId;
  const messages = cleanMessages(options.messages);
  return serialized(identity.key, async () => {
    const { archive } = await readArchive(identity);
    const active = activeConversation(archive, identity.authSessionId);
    if (!active || active.id !== conversationId) throw fail("assistantConversationChanged");
    // A page snapshot may predate a background result committed by the task
    // reconciler. Preserve those messages instead of erasing them on re-render.
    const next = cleanMessages([...messages, ...active.messages.filter(item => item.id.startsWith('job-') && !messages.some(x => x.id === item.id))]);
    if (JSON.stringify(next) === JSON.stringify(active.messages)) return snapshot(archive, active);
    active.messages = next;
    active.updatedAt = new Date().toISOString();
    await writeArchive(identity, archive, active);
    return snapshot(archive, active);
  });
}

// Append into the original conversation even after navigating away, signing in
// again, or starting a different chat. Deleted conversations are never recreated.
export function appendAssistantJobMessages(options) {
  const identity = scope(options);
  return serialized(identity.key, async () => {
    const { archive } = await readArchive(identity);
    const target = archive.conversations.find(item => item.id === options.conversationId);
    if (!target) return false;
    const next = cleanMessages([...target.messages, ...options.messages]);
    if (JSON.stringify(next) === JSON.stringify(target.messages)) return true;
    target.messages = next;
    target.updatedAt = new Date().toISOString();
    await writeArchive(identity, archive, target);
    return true;
  });
}

export function startNewAssistantConversation(options) {
  const identity = scope(options);
  return serialized(identity.key, async () => {
    const { archive } = await readArchive(identity);
    for (const item of archive.conversations) item.archived = true;
    const active = newConversation(identity.authSessionId);
    archive.conversations.push(active);
    await writeArchive(identity, archive, active);
    return snapshot(archive, active);
  });
}

function cloudConversations(archive) {
  return Object.fromEntries(archive.conversations.filter(item => item.messages.length).map(item => [item.id, {
    createdAt: item.createdAt, updatedAt: item.updatedAt, legacy: item.legacy, messages: cleanMessages(item.messages, item.legacy),
  }]));
}

export async function synchronizeAssistantConversations({ owner, locale, token, send, isCurrent = () => true }) {
  const identity = scope({ owner, locale, authSessionId: 'cloud-sync' });
  if (!isCurrent()) return;
  const outgoing = await serialized(identity.key, async () => {
    if (!isCurrent()) return null;
    const { archive } = await readArchive(identity), documents = cloudConversations(archive);
    archive.cloud = updateJournal(archive.cloud, documents);
    await AsyncStorage.setItem(identity.key, JSON.stringify(archive));
    return { collection: `assistant_${locale}`, cursor: archive.cloud.cursor, changes: journalBatch(archive.cloud, documents) };
  });
  if (!outgoing || !isCurrent()) return;
  const result = await send(token, outgoing);
  if (!isCurrent()) return;
  let pending = false;
  await serialized(identity.key, async () => {
    if (!isCurrent()) return;
    const { archive } = await readArchive(identity);
    const merged = reconcileJournal(archive.cloud, result, outgoing.changes, cloudConversations(archive));
    const old = new Map(archive.conversations.map(item => [item.id, item]));
    const conversations = Object.entries(merged.documents).map(([id, value]) => ({
      id, authSessionId: old.get(id)?.authSessionId || 'cloud-history', archived: old.get(id)?.archived ?? true,
      createdAt: value.createdAt, updatedAt: value.updatedAt, legacy: Boolean(value.legacy), messages: cleanMessages(value.messages, value.legacy),
    }));
    // Keep this device's empty current conversation. Remote history never
    // takes over its composer, pending question or speech playback.
    for (const item of archive.conversations) if (!item.messages.length && isLiveConversation(item) && !conversations.some(x => x.id === item.id)) conversations.push(item);
    conversations.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    const changed = JSON.stringify(archive.conversations) !== JSON.stringify(conversations);
    archive.conversations = conversations; archive.cloud = merged.journal;
    // Sanitizing historical message metadata must not become a new local edit.
    archive.cloud.observed = updateJournal(undefined, cloudConversations(archive)).observed;
    pending = Object.keys(archive.cloud.pending).length > 0;
    await AsyncStorage.setItem(identity.key, JSON.stringify(archive));
    if (changed) notifyAccountData(owner, 'assistant', true);
  });
  return result.more || pending;
}
