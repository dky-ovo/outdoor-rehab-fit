// Pure journal helpers. A collection's data and this journal are committed in
// the SAME AsyncStorage value, so a process exit cannot lose a pending edit.
let sequence = 0;
export const newSyncOperation = () => `sync-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const copy = value => JSON.parse(JSON.stringify(value));
// Two independent 32-bit hashes plus length identify local changes without
// duplicating large conversations in AsyncStorage's per-row window.
function stamp(value) {
  const text = JSON.stringify(value); let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b, 33) ^ n; }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
const observed = documents => Object.fromEntries(Object.entries(documents).map(([id, value]) => [id, stamp(value)]));
export function updateJournal(previous, documents) {
  const initial = !previous;
  const journal = previous ? copy(previous) : { cursor: 0, observed: {}, versions: {}, pending: {} };
  const next = observed(documents);
  for (const id of new Set([...Object.keys(journal.observed), ...Object.keys(documents)])) {
    if (journal.observed[id] === next[id]) continue;
    journal.pending[id] = { id, deleted: documents[id] === undefined,
      version: journal.versions[id] ?? (initial ? null : 0), operationId: newSyncOperation() };
  }
  journal.observed = next;
  return journal;
}
export function journalBatch(journal, documents) {
  const batch = []; let size = 0;
  for (const pending of Object.values(journal.pending)) {
    const item = { ...pending, value: pending.deleted ? null : documents[pending.id] };
    const bytes = JSON.stringify(item).length * 3;
    if (batch.length && (batch.length >= 20 || size + bytes > 1500000)) break;
    batch.push(copy(item)); size += bytes;
  }
  return batch;
}
export function reconcileJournal(previous, result, batch, currentDocuments) {
  if (!result || !Array.isArray(result.records) || !Array.isArray(result.acknowledged) || !Number.isSafeInteger(result.cursor) || result.cursor < previous.cursor) throw new Error('ACCOUNT_SYNC_RESPONSE_INVALID');
  const journal = copy(previous), documents = copy(currentDocuments);
  const valid = row => row && typeof row.id === 'string' && !['__proto__','prototype','constructor'].includes(row.id) && Number.isSafeInteger(row.version) && row.version > 0 && typeof row.deleted === 'boolean' && (row.deleted || row.value && typeof row.value === 'object');
  for (const ack of result.acknowledged) {
    if (!valid(ack.record) || !batch.some(x => x.id === ack.record.id && x.operationId === ack.operationId)) throw new Error('ACCOUNT_SYNC_ACK_INVALID');
    if (journal.pending[ack.record.id]?.operationId === ack.operationId) delete journal.pending[ack.record.id];
    else if (journal.pending[ack.record.id]) journal.pending[ack.record.id].version = ack.record.version;
  }
  const rows = [...result.records, ...result.acknowledged.map(x => x.record)].sort((a,b) => a.version - b.version);
  for (const row of rows) {
    if (!valid(row)) throw new Error('ACCOUNT_SYNC_RECORD_INVALID');
    if (row.version < (journal.versions[row.id] || 0)) continue;
    journal.versions[row.id] = row.version;
    if (journal.pending[row.id]) continue;
    if (row.deleted) delete documents[row.id]; else documents[row.id] = copy(row.value);
  }
  journal.cursor = result.cursor;
  journal.observed = observed(documents);
  return { journal, documents };
}
