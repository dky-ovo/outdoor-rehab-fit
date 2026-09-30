import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { signToken } from '../src/security.js';
import { validateLearningEntry, mergeLearningEntries, learningProgressFlags, saveLearningProgress, validLearningDate } from '../src/learningProgress.js';
import { learningTextSections } from '../../utils/learningCoverage.js';

const secret = 'learning-progress-tests-only-long-jwt-secret';
const now = '2026-09-21T00:00:00.000Z';
const day = '2026-09-21';
const evidence = (start = 0, end = 50, groupKey = 'zh:text:revision', field = 'read') => ({ version: 2, evidence: { [field]: { [groupKey]: { parts: [{ key: 'details', total: 100 }], ranges: { details: [[start, end]] } } } } });
const record = (entry = evidence(), date = day, equipmentId = '0') => ({ equipmentId, date, entry });
function seed(database) {
  const insert = database.prepare('INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const [index, [id, role]] of [['p', 'participant'], ['other', 'participant'], ['staff', 'staff'], ['vol', 'volunteer'], ['unlinked', 'staff'], ['guest', 'guest']].entries()) {
    insert.run(id, `Private ${id}`, `+8526900000${index}`, role, 'unused-salt', 'secret-hash', now, now);
  }
  for (const id of ['vol', 'staff']) database.prepare('INSERT INTO volunteer_participants (volunteer_user_id,participant_user_id,created_at) VALUES (?,?,?)').run(id, 'p', now);
}
async function fixture(run) {
  const database = createDatabase(':memory:'); seed(database);
  const server = createApp({ database, jwtSecret: secret }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const api = async (route, { user = 'p', method = 'GET', body, rawBody } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = `Bearer ${signToken({ id: user }, secret)}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), payload: await response.json() };
  };
  const post = (records, user = 'p') => api('/api/learning/progress', { method: 'POST', user, body: { records } });
  try { await run({ database, api, post }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test('75% requires unique range evidence and weights all parts; boolean flags never create completion', () => {
  const entry = evidence(0, 74.99); entry.read = true; entry.watched = true;
  const normalized = validateLearningEntry(entry);
  assert.deepEqual(learningProgressFlags(normalized), { read: false, watched: false, listened: false });
  const completed = mergeLearningEntries(normalized, validateLearningEntry(evidence(74.99, 75)));
  assert.equal(learningProgressFlags(completed).read, true);
  assert.deepEqual(mergeLearningEntries(completed, completed), completed);
  const multiple = evidence(0, 100);
  multiple.evidence.read['zh:text:revision'].parts.push({ key: 'ptTip', total: 300 });
  multiple.evidence.read['zh:text:revision'].ranges.ptTip = [[0, 199]];
  assert.equal(learningProgressFlags(validateLearningEntry(multiple)).read, false);
  multiple.evidence.read['zh:text:revision'].ranges.ptTip = [[0, 200]];
  assert.equal(learningProgressFlags(validateLearningEntry(multiple)).read, true);
});

test('different languages and different content revisions do not combine progress', () => {
  let entry = validateLearningEntry(evidence(0, 50));
  entry = mergeLearningEntries(entry, validateLearningEntry(evidence(50, 100, 'en:text:revision')));
  entry = mergeLearningEntries(entry, validateLearningEntry(evidence(50, 100, 'zh:text:another-revision')));
  assert.equal(learningProgressFlags(entry).read, false);
  assert.equal(Object.keys(entry.evidence.read).length, 3);
});

test('real bilingual six-section app manifests round-trip with unsorted parts and fractional reading ranges', async () => fixture(async ({ database, api, post }) => {
  const guide = JSON.parse(fs.readFileSync(new URL('../src/equipmentGuideEvidence.json', import.meta.url), 'utf8'));
  const builtIn = database.prepare('SELECT id, name_zh FROM app_equipment_items WHERE id=?').get('0');
  assert.equal(builtIn.name_zh, '太極揉推器');
  const samples = ['zh', 'en'].map(locale => {
    // This is the same frontend helper and parts projection used by
    // useEquipmentLearning, applied to the app's bundled bilingual teaching.
    const sections = learningTextSections(guide['0'][locale]);
    const parts = sections.map(({ key, total }) => ({ key, total }));
    assert.equal(parts.length, 6);
    assert.notDeepEqual(parts.map(part => part.key), [...parts].sort((a, b) => a.key.localeCompare(b.key)).map(part => part.key));
    const ranges = Object.fromEntries(parts.map(part => [part.key, [[0, part.total * 0.75]]]));
    return { groupKey: `${locale}:text:app-v24-six-sections`, parts, ranges };
  });
  const entry = { version: 2, evidence: { read: Object.fromEntries(samples.map(({ groupKey, parts, ranges }) => [groupKey, { parts, ranges }])) } };
  assert.equal((await post([record(entry)])).status, 200);
  const item = (await api('/api/volunteer/participants/p/learning?equipmentId=0')).payload.items[0];
  assert.equal(item.equipmentId, '0');
  for (const sample of samples) {
    const returned = item.entry.evidence.read[sample.groupKey];
    assert.deepEqual(returned.parts, [...sample.parts].sort((a, b) => a.key.localeCompare(b.key)));
    assert.deepEqual(returned.ranges, sample.ranges);
  }
  assert.equal(item.entry.read, true);
  // Canonical server sorting must not turn replay of the original unsorted
  // frontend manifest into a conflict or an additional update.
  assert.equal((await post([record(entry)])).payload.saved, 0);
}));

test('self and explicitly linked viewers only; staff does not get blanket participant access', async () => fixture(async ({ api, post }) => {
  assert.equal((await post([record()])).status, 200);
  for (const user of ['p', 'vol', 'staff']) {
    const result = await api('/api/volunteer/participants/p/learning', { user });
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, 'private, no-store');
    assert.equal(result.payload.participant.id, 'p');
    assert.equal(result.payload.participant.password_hash, undefined);
    assert.equal(result.payload.participant.email, undefined);
  }
  for (const user of ['other', 'unlinked']) {
    const result = await api('/api/volunteer/participants/p/learning', { user });
    assert.equal(result.status, 404);
    assert.deepEqual(result.payload, { error: 'participantNotLinked' });
    assert.equal((await api('/api/volunteer/participants/p/usage', { user })).status, 404);
  }
  assert.equal((await api('/api/volunteer/participants/vol/learning', { user: 'vol' })).status, 404);
  assert.equal((await api('/api/volunteer/participants/staff/learning', { user: 'staff' })).status, 200);
  assert.equal((await api('/api/volunteer/participants/p/learning', { user: 'guest' })).status, 403);
  assert.equal((await api('/api/volunteer/participants/p/learning', { user: null })).status, 401);
  assert.equal((await post([record()], 'guest')).status, 403);
  assert.equal((await post([record()], null)).status, 401);
  assert.equal((await api('/api/learning/progress', { method: 'POST', body: { records: [record()], userId: 'other' } })).status, 400);
  assert.equal((await api('/api/volunteer/participants/other/learning', { user: 'other' })).payload.total, 0);
}));

test('incremental union is idempotent, preserves timestamps on retry, and persists all three modalities', async () => fixture(async ({ database, api, post }) => {
  const reading = record(evidence(0, 50));
  assert.equal((await post([reading])).payload.saved, 1);
  database.prepare("UPDATE facility_learning_progress SET updated_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await post([reading, reading])).payload.saved, 0);
  assert.equal(database.prepare('SELECT updated_at FROM facility_learning_progress').get().updated_at, '2000-01-01T00:00:00.000Z');
  assert.equal((await post([record(evidence(40, 75)), record(evidence(0, 80, 'zh:video:1', 'watched')), record(evidence(0, 90, 'zh:audio:1', 'listened'))])).status, 200);
  const item = (await api('/api/volunteer/participants/p/learning')).payload.items[0];
  assert.deepEqual(item.entry.evidence.read['zh:text:revision'].ranges.details, [[0, 75]]);
  assert.deepEqual([item.entry.read, item.entry.watched, item.entry.listened], [true, true, true]);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM facility_learning_progress').get().count, 1);
}));

test('daily dates remain separate while cumulative ranges union and null legacy data never invents usage dates', async () => fixture(async ({ api, post }) => {
  assert.equal((await post([record(evidence(0, 40), null)])).status, 200);
  assert.deepEqual((await api('/api/volunteer/participants/p/usage')).payload.days, []);
  assert.equal((await api('/api/volunteer/participants')).payload.participants[0].lastAppUsageDate, null);
  await post([record(evidence(40, 60), '2026-09-19'), record(evidence(60, 80), '2026-09-20')]);
  const cumulative = (await api('/api/volunteer/participants/p/learning')).payload;
  assert.equal(cumulative.date, null); assert.equal(cumulative.items[0].entry.read, true);
  for (const date of ['2026-09-19', '2026-09-20']) {
    const daily = (await api(`/api/volunteer/participants/p/learning?date=${date}`)).payload;
    assert.equal(daily.date, date); assert.equal(daily.items[0].entry.read, false);
  }
  const days = (await api('/api/volunteer/participants/p/usage')).payload.days;
  assert.deepEqual(days.map(item => item.date), ['2026-09-20', '2026-09-19']);
  assert.deepEqual(days.map(item => item.facilityLearningCount), [1, 1]);
  const self = (await api('/api/volunteer/participants')).payload.participants[0];
  assert.equal(self.lastAppUsageDate, '2026-09-20');
  const linked = (await api('/api/volunteer/participants', { user: 'vol' })).payload.participants[0];
  assert.equal(linked.lastAppUsageDate, '2026-09-20');
}));

test('parts conflicts rollback the entire transaction and never mix denominators across days', async () => fixture(async ({ database, post }) => {
  await post([record()]);
  const changed = evidence(50, 100); changed.evidence.read['zh:text:revision'].parts[0].total = 200;
  const result = await post([record(evidence(), day, '1'), record(changed, '2026-09-20')]);
  assert.equal(result.status, 409); assert.equal(result.payload.error, 'learningPartsConflict');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM facility_learning_progress').get().count, 1);
}));

test('paged results are stable, bounded, and include unavailable equipment history without leaking other users', async () => fixture(async ({ database, api, post }) => {
  const ids = database.prepare('SELECT id FROM app_equipment_items ORDER BY id LIMIT 23').all().map(row => row.id);
  await post(ids.slice(0, 20).map(id => record(evidence(), day, id)));
  await post(ids.slice(20).map(id => record(evidence(), day, id)));
  database.prepare('UPDATE app_equipment_items SET is_active=0,deleted_at=? WHERE id=?').run(now, ids[0]);
  assert.equal((await post([record(evidence(40, 75), day, ids[0])])).status, 200);
  const first = (await api('/api/volunteer/participants/p/learning?page=1&pageSize=20')).payload;
  const second = (await api('/api/volunteer/participants/p/learning?page=2&pageSize=20')).payload;
  assert.equal(first.total, 23); assert.equal(first.totalPages, 2); assert.equal(first.items.length, 20); assert.equal(second.items.length, 3);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.equipmentId)).size, 23);
  const targetId = second.items[0].equipmentId;
  const filtered = (await api(`/api/volunteer/participants/p/learning?equipmentId=${encodeURIComponent(targetId)}`)).payload;
  assert.equal(filtered.total, 1);
  assert.equal(filtered.totalPages, 1);
  assert.equal(filtered.items[0].equipmentId, targetId);
  const filteredDay = (await api(`/api/volunteer/participants/p/learning?date=${day}&equipmentId=${encodeURIComponent(targetId)}`)).payload;
  assert.equal(filteredDay.total, 1);
  assert.equal(filteredDay.items[0].equipmentId, targetId);
  assert.equal((await api(`/api/volunteer/participants/p/learning?date=2026-09-18&equipmentId=${encodeURIComponent(targetId)}`)).payload.total, 0);
  assert.deepEqual((await api('/api/volunteer/participants/p/learning?equipmentId=missing-equipment')).payload.items, []);
  assert.equal((await api(`/api/volunteer/participants/p/learning?equipmentId=${encodeURIComponent(targetId)}`, { user: 'unlinked' })).status, 404);
  assert.equal((await api('/api/volunteer/participants/p/learning?date=2026-09-18')).payload.total, 0);
  assert.equal((await api('/api/volunteer/participants/p/learning?page=999&pageSize=20')).payload.page, 2);
  for (const query of ['page=0', 'page=-1', 'page=1.2', 'pageSize=101', 'pageSize=Infinity', 'date=2026-02-30', 'date=null', 'date=2026-09-21&date=2026-09-20', 'equipmentId=', 'equipmentId=0&equipmentId=1', 'equipmentId=__proto__', 'equipmentId=%200']) {
    assert.equal((await api(`/api/volunteer/participants/p/learning?${query}`)).status, 400, query);
  }
}));

test('strict body validation rejects malformed ranges, manifests, prototype keys, spoofed dates and oversized batches', async () => fixture(async ({ database, api, post }) => {
  const bad = [];
  for (const date of ['', '2026-02-30', '9999-12-31', '2026-09-21T00:00:00Z', 1]) bad.push({ ...record(), date });
  for (const equipmentId of [0, '', 'missing-equipment', '__proto__']) bad.push({ ...record(), equipmentId });
  for (const entry of [{ read: true }, { version: 2, evidence: {}, read: true }, { version: 1, evidence: evidence().evidence }, { version: 2, evidence: { read: [] } }]) bad.push(record(entry));
  for (const range of [[-1, 70], [0, 101], [75, 10], [0, 0], ['0', 75], [null, 75], [0, 75, 80]]) {
    const entry = evidence(); entry.evidence.read['zh:text:revision'].ranges.details = [range]; bad.push(record(entry));
  }
  for (const total of [0, -1, '100', null, 1e15]) { const entry = evidence(); entry.evidence.read['zh:text:revision'].parts[0].total = total; bad.push(record(entry)); }
  const duplicate = evidence(); duplicate.evidence.read['zh:text:revision'].parts.push({ key: 'details', total: 100 }); bad.push(record(duplicate));
  const unknownPart = evidence(); unknownPart.evidence.read['zh:text:revision'].ranges.other = [[0, 10]]; bad.push(record(unknownPart));
  const prototype = JSON.parse('{"version":2,"evidence":{"read":{"__proto__":{"parts":[{"key":"details","total":100}],"ranges":{"details":[[0,75]]}}}}}'); bad.push(record(prototype));
  for (const item of bad) assert.equal((await post([item])).status, 400, JSON.stringify(item));
  assert.equal((await post(Array.from({ length: 21 }, () => record()))).status, 400);
  assert.equal((await post([])).status, 400);
  assert.equal((await api('/api/learning/progress', { method: 'POST', rawBody: '{bad json' })).status, 400);
  assert.equal((await api('/api/learning/progress', { method: 'POST', rawBody: JSON.stringify({ records: [], excess: 'a'.repeat(270000) }) })).status, 413);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM facility_learning_progress').get().count, 0);
  assert.equal(validLearningDate('2024-02-29'), true);
  assert.equal(validLearningDate('2025-02-29'), false);
}));

test('range records survive SQLite reopen and cascade on hard user deletion', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'outdoor-learning-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let database;
  try {
    database = createDatabase(filename); seed(database);
    saveLearningProgress(database, 'p', { records: [record(evidence(0, 75), null)] }); database.close();
    database = createDatabase(filename);
    const row = database.prepare('SELECT * FROM facility_learning_progress').get();
    assert.equal(row.learning_date, ''); assert.equal(learningProgressFlags(JSON.parse(row.entry_json)).read, true);
    database.prepare('DELETE FROM users WHERE id=?').run('p');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM facility_learning_progress').get().count, 0);
  } finally {
    if (database?.open) database.close();
    // Exact test-owned temporary directory only; never touch the live data path.
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('outdoor-learning-test-')) fs.rmSync(directory, { recursive: true, force: true });
  }
});
