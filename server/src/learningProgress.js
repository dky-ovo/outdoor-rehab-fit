// Coverage evidence is owner-scoped research data, never a client-supplied
// completion flag. Separate language/content groups always keep their own total.
export const LEARNING_PROGRESS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS facility_learning_progress (
    user_id TEXT NOT NULL,
    equipment_id TEXT NOT NULL,
    learning_date TEXT NOT NULL DEFAULT '',
    entry_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, equipment_id, learning_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (learning_date = '' OR (length(learning_date) = 10 AND learning_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
  );
  CREATE INDEX IF NOT EXISTS facility_learning_user_date ON facility_learning_progress(user_id, learning_date);
`;
const FIELDS = ['read', 'watched', 'listened'];
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_TOTAL = 1_000_000_000;
const MAX_ENTRY_BYTES = 131072;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fail(code = 'invalidLearningProgress', status = 400) { throw Object.assign(new Error(code), { code, status }); }
function keysOnly(value, keys) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(); }
function key(value, maximum = 200) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value) || DANGEROUS.has(value)) fail();
  return value;
}
export function validLearningDate(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01') return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function unionLearningRanges(ranges) {
  const result = [];
  for (const [start, end] of ranges.map(range => [...range]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
export function validateLearningEntry(entry) {
  keysOnly(entry, ['version', 'evidence', ...FIELDS]);
  if (entry.version !== 2) fail();
  keysOnly(entry.evidence, FIELDS);
  const evidence = {}; let rangeCount = 0;
  for (const field of FIELDS) {
    if (!own(entry.evidence, field)) continue;
    const groups = entry.evidence[field];
    if (!object(groups) || Object.keys(groups).length > 12) fail();
    evidence[field] = {};
    for (const groupKey of Object.keys(groups).sort()) {
      key(groupKey);
      const group = groups[groupKey]; keysOnly(group, ['parts', 'ranges']);
      if (!Array.isArray(group.parts) || !group.parts.length || group.parts.length > 32 || !object(group.ranges)) fail();
      const totals = new Map();
      const parts = group.parts.map(part => {
        keysOnly(part, ['key', 'total']); key(part.key, 100);
        if (totals.has(part.key) || typeof part.total !== 'number' || !Number.isFinite(part.total) || part.total <= 0 || part.total > MAX_TOTAL) fail();
        totals.set(part.key, part.total);
        return { key: part.key, total: part.total };
      }).sort((a, b) => a.key.localeCompare(b.key));
      const ranges = {};
      for (const partKey of Object.keys(group.ranges).sort()) {
        key(partKey, 100);
        const values = group.ranges[partKey];
        if (!totals.has(partKey) || !Array.isArray(values) || values.length > 256) fail();
        rangeCount += values.length;
        if (rangeCount > 2048) fail();
        for (const range of values) {
          if (!Array.isArray(range) || range.length !== 2 || range.some(value => typeof value !== 'number' || !Number.isFinite(value)) || range[0] < 0 || range[1] > totals.get(partKey) || range[1] <= range[0]) fail();
        }
        if (values.length) ranges[partKey] = unionLearningRanges(values);
      }
      if (Object.keys(ranges).length) evidence[field][groupKey] = { parts, ranges };
    }
    if (!Object.keys(evidence[field]).length) delete evidence[field];
  }
  if (!rangeCount) fail();
  const result = { version: 2, evidence };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_ENTRY_BYTES) fail('learningProgressLimit', 413);
  return result;
}
export function mergeLearningEntries(first, second) {
  const result = structuredClone(first || { version: 2, evidence: {} });
  for (const field of FIELDS) {
    for (const [groupKey, incoming] of Object.entries(second?.evidence?.[field] || {})) {
      result.evidence[field] ||= {};
      const existing = result.evidence[field][groupKey];
      if (existing && JSON.stringify(existing.parts) !== JSON.stringify(incoming.parts)) fail('learningPartsConflict', 409);
      const merged = existing || { parts: structuredClone(incoming.parts), ranges: {} };
      for (const [partKey, ranges] of Object.entries(incoming.ranges)) {
        merged.ranges[partKey] = unionLearningRanges([...(merged.ranges[partKey] || []), ...ranges]);
        if (merged.ranges[partKey].length > 2048) fail('learningProgressLimit', 413);
      }
      result.evidence[field][groupKey] = merged;
    }
    if (Object.keys(result.evidence[field] || {}).length > 128) fail('learningProgressLimit', 413);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_ENTRY_BYTES) fail('learningProgressLimit', 413);
  return result;
}
export function learningProgressFlags(entry) {
  return Object.fromEntries(FIELDS.map(field => [field, Object.values(entry.evidence?.[field] || {}).some(group => {
    const total = group.parts.reduce((sum, part) => sum + part.total, 0);
    const covered = group.parts.reduce((sum, part) => sum + unionLearningRanges(group.ranges[part.key] || []).reduce((count, [a, b]) => count + b - a, 0), 0);
    return total > 0 && covered / total >= 0.75;
  })]));
}
export function saveLearningProgress(database, userId, body) {
  keysOnly(body, ['records']);
  if (!Array.isArray(body.records) || !body.records.length || body.records.length > 20 || Buffer.byteLength(JSON.stringify(body)) > 262144) fail();
  const records = body.records.map(record => {
    keysOnly(record, ['equipmentId', 'date', 'entry']);
    const equipmentId = key(record.equipmentId, 100);
    if (!own(record, 'date') || (record.date !== null && !validLearningDate(record.date))) fail('invalidLearningDate');
    if (database.dialect !== 'mysql' && !database.prepare('SELECT id FROM app_equipment_items WHERE id = ?').get(equipmentId)) fail('invalidLearningEquipment');
    return { equipmentId, date: record.date || '', entry: validateLearningEntry(record.entry) };
  });
  if (database.dialect === 'mysql') return saveMysqlLearningProgress(database, userId, records);
  const select = database.prepare('SELECT entry_json FROM facility_learning_progress WHERE user_id = ? AND equipment_id = ? AND learning_date = ?');
  const all = database.prepare('SELECT entry_json FROM facility_learning_progress WHERE user_id = ? AND equipment_id = ?');
  const upsert = database.prepare(`INSERT INTO facility_learning_progress (user_id,equipment_id,learning_date,entry_json,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id,equipment_id,learning_date) DO UPDATE SET entry_json=excluded.entry_json,updated_at=excluded.updated_at`);
  let saved = 0;
  database.transaction(() => {
    for (const record of records) {
      // Validate compatibility across dates before writing, so cumulative GET is
      // deterministic and never combines mismatched manifests/denominators.
      let cumulative;
      for (const row of all.all(userId, record.equipmentId)) cumulative = mergeLearningEntries(cumulative, JSON.parse(row.entry_json));
      mergeLearningEntries(cumulative, record.entry);
      const previous = select.get(userId, record.equipmentId, record.date);
      const next = JSON.stringify(mergeLearningEntries(previous ? JSON.parse(previous.entry_json) : null, record.entry));
      if (previous?.entry_json === next) continue;
      upsert.run(userId, record.equipmentId, record.date, next, new Date().toISOString());
      saved++;
    }
  })();
  return { ok: true, saved };
}

async function saveMysqlLearningProgress(database, userId, records) {
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const ordered = [...records].sort((a, b) => compare(a.equipmentId, b.equipmentId) || compare(a.date, b.date));
  return database.transaction(async tx => {
    // The parent always exists before a progress row does. All saves for this
    // owner use this anchor, including the first insert for a new equipment/day.
    const user = await tx.get('SELECT id, deleted_at FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!user) fail('unauthorized', 401);
    if (user.deleted_at !== null) fail('accountDeleted', 401);
    let saved = 0;
    const equipmentChecked = new Set();
    for (const record of ordered) {
      if (!equipmentChecked.has(record.equipmentId)) {
        if (!await tx.get('SELECT id FROM app_equipment_items WHERE id = ?', [record.equipmentId])) fail('invalidLearningEquipment');
        equipmentChecked.add(record.equipmentId);
      }
      // A locking/current read sees the preceding owner's committed save even
      // when this transaction waited for the parent lock under REPEATABLE READ.
      const rows = await tx.all(`SELECT learning_date, entry_json FROM facility_learning_progress
        WHERE user_id = ? AND equipment_id = ? ORDER BY learning_date FOR UPDATE`, [userId, record.equipmentId]);
      let cumulative;
      for (const row of rows) cumulative = mergeLearningEntries(cumulative, JSON.parse(row.entry_json));
      mergeLearningEntries(cumulative, record.entry);
      const previous = rows.find(row => row.learning_date === record.date);
      const next = JSON.stringify(mergeLearningEntries(previous ? JSON.parse(previous.entry_json) : null, record.entry));
      if (previous?.entry_json === next) continue;
      const now = new Date().toISOString();
      const result = previous
        ? await tx.run(`UPDATE facility_learning_progress SET entry_json = ?, updated_at = ?
          WHERE user_id = ? AND equipment_id = ? AND learning_date = ?`, [next, now, userId, record.equipmentId, record.date])
        : await tx.run(`INSERT INTO facility_learning_progress (user_id,equipment_id,learning_date,entry_json,updated_at)
          VALUES (?,?,?,?,?)`, [userId, record.equipmentId, record.date, next, now]);
      if (result.warningStatus !== 0 || result.affectedRows !== 1) fail('learningProgressFailed', 500);
      saved++;
    }
    return { ok: true, saved };
  });
}

function progressPage(total, pageValue, pageSize, date) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Number(pageValue), totalPages), pageSize, total, totalPages, date };
}

function progressItem(row, records) {
  const entry = records.reduce((result, item) => mergeLearningEntries(result, JSON.parse(item.entry_json)), null);
  return { equipmentId: row.equipment_id, entry: { ...entry, ...learningProgressFlags(entry) }, updatedAt: row.updatedAt };
}

async function mysqlParticipantLearningProgress(database, userId, condition, values, pageValue, pageSize, date) {
  return database.transaction(async tx => {
    // Saves take an exclusive lock on the same parent. A shared lock keeps the
    // count, page IDs and their evidence consistent across this read request.
    const user = await tx.get('SELECT id, deleted_at FROM users WHERE id = ? FOR SHARE', [userId]);
    if (!user || user.deleted_at !== null) fail('participantNotLinked', 404);
    const row = await tx.get(`SELECT COUNT(DISTINCT equipment_id) AS count FROM facility_learning_progress WHERE ${condition}`, values);
    const count = row?.count;
    if (!['number', 'string', 'bigint'].includes(typeof count) || (typeof count === 'string' && !/^\d+$/.test(count))) fail('learningProgressFailed', 500);
    const total = Number(count);
    if (!Number.isSafeInteger(total) || total < 0) fail('learningProgressFailed', 500);
    const pagination = progressPage(total, pageValue, pageSize, date);
    // These bounded integers come exclusively from the validated pagination.
    // Filter values remain bound parameters; no client text enters the SQL.
    const ids = await tx.all(`SELECT equipment_id, MAX(updated_at) AS updatedAt FROM facility_learning_progress WHERE ${condition}
      GROUP BY equipment_id ORDER BY updatedAt DESC,equipment_id LIMIT ${pageSize} OFFSET ${(pagination.page - 1) * pageSize}`, values);
    const items = [];
    for (const id of ids) {
      const records = await tx.all(`SELECT entry_json FROM facility_learning_progress WHERE ${condition} AND equipment_id = ? ORDER BY learning_date`, [...values, id.equipment_id]);
      items.push(progressItem(id, records));
    }
    return { items, ...pagination };
  });
}

export function participantLearningProgress(database, userId, query) {
  if (query.date !== undefined && !validLearningDate(query.date)) fail('invalidLearningDate');
  const date = query.date ?? null;
  const equipmentId = query.equipmentId === undefined ? null : key(query.equipmentId, 100);
  const pageValue = query.page ?? '1'; const sizeValue = query.pageSize ?? '20';
  const integer = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
  if (!integer(pageValue) || !integer(sizeValue) || Number(sizeValue) > 100 || Number(pageValue) > 1000000) fail('invalidPagination');
  const pageSize = Number(sizeValue);
  const conditions = ['user_id = ?']; const values = [userId];
  if (date !== null) { conditions.push('learning_date = ?'); values.push(date); }
  if (equipmentId !== null) { conditions.push('equipment_id = ?'); values.push(equipmentId); }
  const condition = conditions.join(' AND ');
  if (database.dialect === 'mysql') return mysqlParticipantLearningProgress(database, userId, condition, values, pageValue, pageSize, date);
  const total = database.prepare(`SELECT COUNT(DISTINCT equipment_id) AS count FROM facility_learning_progress WHERE ${condition}`).get(...values).count;
  const pagination = progressPage(total, pageValue, pageSize, date);
  const ids = database.prepare(`SELECT equipment_id, MAX(updated_at) AS updatedAt FROM facility_learning_progress WHERE ${condition}
    GROUP BY equipment_id ORDER BY updatedAt DESC,equipment_id LIMIT ? OFFSET ?`).all(...values, pageSize, (pagination.page - 1) * pageSize);
  const items = ids.map(row => {
    const records = database.prepare(`SELECT entry_json FROM facility_learning_progress WHERE ${condition} AND equipment_id = ? ORDER BY learning_date`).all(...values, row.equipment_id);
    return progressItem(row, records);
  });
  return { items, ...pagination };
}
