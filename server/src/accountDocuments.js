// Account-owned documents. Every writer locks the same user row; cursors and
// tombstones survive retries, simultaneous devices and interrupted responses.
const collections = new Set(['assistant_zh', 'assistant_en', 'assistant_bailian_zh', 'assistant_bailian_en', 'goals', 'usage', 'preferences']);
const assistantProvider = collection => collection.startsWith('assistant_bailian_') ? 'bailian' : 'deepseek';
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,256}$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
const operationOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const publicRow = row => ({ id: row.record_id, value: row.deleted ? null : parse(row.value_json), deleted: Boolean(row.deleted), version: Number(row.revision) });
function invalid() { return Object.assign(new Error('invalidAccountData'), { status: 400, code: 'invalidAccountData' }); }

function validateValue(collection, id, value) {
  if (!object(value) || JSON.stringify(value).length > 400000) throw invalid();
  if (collection.startsWith('assistant_')) {
    const provider = assistantProvider(collection);
    if (value.provider != null && value.provider !== provider) throw invalid();
    if (!Array.isArray(value.messages) || value.messages.length > 500 || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) throw invalid();
    const seen = new Set();
    for (const message of value.messages) {
      if (!object(message) || !idOK(message.id) || seen.has(message.id) || !['user','ai'].includes(message.sender)
        || ![message.text, message.reply].some(x => typeof x === 'string' && x.trim()) || message.imageData || message.imageUri
        || message.provider != null && message.provider !== provider) throw invalid();
      seen.add(message.id);
    }
  } else if (collection === 'goals') {
    if (id.startsWith('target-')) {
      if (!['target-aerobic','target-balance','target-muscle'].includes(id) || !Number.isInteger(value.target) || value.target < 0 || value.target > (id === 'target-aerobic' ? 1260 : 7)) throw invalid();
    } else if (!id.startsWith('smart-') || typeof value.text !== 'string' || value.text.length > 5000 || typeof value.done !== 'boolean' || typeof value.weekKey !== 'string') throw invalid();
  } else if (collection === 'usage') {
    if (!Array.isArray(value.usageDays) || value.usageDays.some(day => typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw invalid();
    for (const [name, count] of Object.entries(value)) if (name !== 'usageDays' && (!['loginEvents','introLoads','audioPlays','goalsAchieved','outdoorSessions','homeSessions','ttsPlays'].includes(name) || !Number.isSafeInteger(count) || count < 0)) throw invalid();
  } else if (id !== 'language' || !['zh','en'].includes(value.locale)) throw invalid();
}

function mergeValue(collection, previous, incoming, sameVersion) {
  if (collection.startsWith('assistant_')) {
    const messages = new Map(previous.messages.map(item => [item.id, item]));
    for (const item of incoming.messages) if (!messages.has(item.id) || sameVersion) messages.set(item.id, item);
    // Existing order is stable; append new IDs without letting a stale screen
    // erase a server-completed answer. Do not silently truncate saved history.
    const merged = { ...previous, ...(sameVersion ? incoming : {}),
      updatedAt: previous.updatedAt > incoming.updatedAt ? previous.updatedAt : incoming.updatedAt,
      messages: [...messages.values()] };
    if (merged.messages.length > 500 || JSON.stringify(merged).length > 400000) throw Object.assign(new Error('accountHistoryFull'), { status: 409, code: 'accountHistoryFull' });
    return merged;
  }
  if (collection === 'usage') {
    const result = { usageDays: [...new Set([...previous.usageDays, ...incoming.usageDays])].sort() };
    for (const key of new Set([...Object.keys(previous), ...Object.keys(incoming)])) if (key !== 'usageDays') result[key] = Math.max(previous[key] || 0, incoming[key] || 0);
    return result;
  }
  return incoming;
}

export function createAccountDocuments(database) {
  async function write(tx, userId, collection, change) {
    const old = await tx.get('SELECT * FROM account_documents WHERE user_id = ? AND collection = ? AND record_id = ?', [userId, collection, change.id]);
    if (old?.last_operation === change.operationId) return publicRow(old);
    let value = change.deleted ? null : change.value;
    if (old) {
      // A deleted conversation/goal must never be resurrected by an old device.
      if (old.deleted || change.version === null && !collection.startsWith('assistant_') && collection !== 'usage') return publicRow(old);
      const sameVersion = Number(old.revision) === change.version;
      if (change.deleted && !sameVersion || !change.deleted && !sameVersion && !collection.startsWith('assistant_') && collection !== 'usage') return publicRow(old);
      if (!change.deleted) value = mergeValue(collection, parse(old.value_json), value, sameVersion);
      if (Boolean(old.deleted) === change.deleted && JSON.stringify(parse(old.value_json)) === JSON.stringify(value)) return publicRow(old);
    }
    const max = await tx.get('SELECT COALESCE(MAX(revision), 0) AS n FROM account_documents WHERE user_id = ? AND collection = ?', [userId, collection]);
    const revision = Number(max.n) + 1;
    if (!old) {
      const count = await tx.get('SELECT COUNT(*) AS n FROM account_documents WHERE user_id = ?', [userId]);
      if (Number(count.n) >= 10000) throw Object.assign(new Error('accountHistoryFull'), { status: 409, code: 'accountHistoryFull' });
      await tx.run('INSERT INTO account_documents (user_id, collection, record_id, value_json, deleted, revision, last_operation) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, collection, change.id, value === null ? null : JSON.stringify(value), Number(change.deleted), revision, change.operationId]);
    } else await tx.run('UPDATE account_documents SET value_json = ?, deleted = ?, revision = ?, last_operation = ? WHERE user_id = ? AND collection = ? AND record_id = ?',
      [value === null ? null : JSON.stringify(value), Number(change.deleted), revision, change.operationId, userId, collection, change.id]);
    return { id: change.id, value, deleted: change.deleted, version: revision };
  }
  return {
    async sync(userId, body) {
      const { collection, cursor, changes } = body || {};
      if (!collections.has(collection) || !Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(changes) || changes.length > 20) throw invalid();
      const seen = new Set();
      for (const item of changes) {
        if (!object(item) || !idOK(item.id) || seen.has(item.id) || !operationOK(item.operationId) || typeof item.deleted !== 'boolean' || !(item.version === null || Number.isSafeInteger(item.version) && item.version >= 0)) throw invalid();
        seen.add(item.id);
        if (!item.deleted) validateValue(collection, item.id, item.value);
      }
      return database.transaction(async tx => {
        if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [userId])) return null;
        const acknowledged = [];
        for (const change of changes) {
          const record = await write(tx, userId, collection, change);
          acknowledged.push({ operationId: change.operationId, record });
          if (record.deleted && collection.startsWith('assistant_')) {
            // Cancelling one provider's history must not touch another provider,
            // even when imported conversation IDs happen to coincide.
            const pending = await tx.all("SELECT * FROM assistant_jobs WHERE user_id = ? AND status IN ('queued', 'running')", [userId]);
            for (const job of pending) {
              const request = parse(job.request_json);
              const provider = request?.runtimeSnapshot?.provider || 'deepseek';
              if (provider === assistantProvider(collection) && request?.conversation?.id === change.id
                && request.conversation.locale === collection.slice(-2)) {
                await tx.run("DELETE FROM assistant_jobs WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')", [job.id, userId]);
              }
            }
          }
        }
        const rows = await tx.all('SELECT * FROM account_documents WHERE user_id = ? AND collection = ? AND revision > ? ORDER BY revision LIMIT 21', [userId, collection, cursor]);
        const page = rows.slice(0, 20).map(publicRow);
        return { acknowledged, records: page, cursor: page.at(-1)?.version ?? cursor, more: rows.length > 20 };
      });
    },
    // Called in the job transaction, after its owner row is locked. Metadata
    // comes only from that account's authenticated submission, never a JWT.
    async recordJob(tx, userId, jobId, request, message) {
      const meta = request.conversation;
      if (!meta || !idOK(meta.id) || !['zh','en'].includes(meta.locale) || !idOK(meta.userMessageId)) return;
      const provider = request.runtimeSnapshot?.provider || 'deepseek';
      if (!['deepseek', 'bailian'].includes(provider) || meta.provider != null && meta.provider !== provider
        || message?.provider != null && message.provider !== provider) throw invalid();
      const now = new Date().toISOString();
      const messages = [{ id: meta.userMessageId, sender: 'user', text: request.message, provider }];
      if (message) messages.push({ ...message, provider, id: `${jobId}-answer`, sender: 'ai' });
      const collection = provider === 'bailian' ? `assistant_bailian_${meta.locale}` : `assistant_${meta.locale}`;
      await write(tx, userId, collection, { id: meta.id, deleted: false, version: null,
        operationId: `${jobId}-${message ? 'answer' : 'question'}`, value: { provider, createdAt: meta.createdAt || now, updatedAt: now, legacy: false, messages } });
    },
  };
}
