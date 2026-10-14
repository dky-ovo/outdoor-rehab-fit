import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createMysqlApp } from '../src/appMysql.js';
import { createDatabase } from '../src/database.js';
import { signToken } from '../src/security.js';
import { assistantIntent } from '../src/assistant.js';
import { assistantNamedGuideAnswer } from '../src/assistantGuide.js';
import { symptomProviderSelection } from './helpers/symptomProvider.js';

const answer = value => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const invalid = { choices: [{ finish_reason: 'stop', message: { content: '{invalid provider JSON' } }] };
const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/assistantLanguageLiveCases.v19.json', import.meta.url), 'utf8')).cases;

async function fixture(t, backend, provider = () => invalid, { completedBodySignal = false } = {}) {
  const sqlite = createDatabase(':memory:');
  sqlite.exec(`CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,request_json TEXT,result_json TEXT,error_code TEXT,created_at INTEGER,completed_at INTEGER);
    CREATE TABLE account_bookmarks (user_id TEXT,equipment_id TEXT,selected INTEGER,version INTEGER,last_operation TEXT,PRIMARY KEY(user_id,equipment_id));
    CREATE TABLE account_documents (user_id TEXT,collection TEXT,record_id TEXT,value_json TEXT,deleted INTEGER,revision INTEGER,last_operation TEXT,PRIMARY KEY(user_id,collection,record_id));`);
  const now = new Date().toISOString(), secret = 'language-routing-test-only';
  const tokens = Array.from({ length: 4 }, (_, index) => {
    const id = `language-test-${index}`;
    sqlite.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, 'PRIVATE_FIXTURE_NAME', `+8526990000${index}`, 'participant', 'unused', 'unused', now, now);
    return signToken({ id, profile_role: 'participant' }, secret);
  });
  sqlite.prepare("UPDATE ai_configuration SET api_key='PRIVATE_PROVIDER_KEY',model='deepseek-v4-flash' WHERE id='default'").run();
  const clean = sql => sql.replace(/ FOR (?:UPDATE|SHARE)\b/g, '');
  let queue = Promise.resolve();
  const context = new AsyncLocalStorage();
  const execute = async fn => { if (!context.getStore()) await queue; return fn(); };
  const database = {
    dialect: 'mysql',
    get: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).get(...values)),
    all: (sql, values = []) => execute(() => sqlite.prepare(clean(sql)).all(...values)),
    run: (sql, values = []) => execute(() => ({ affectedRows: sqlite.prepare(clean(sql)).run(...values).changes })),
    transaction(fn) {
      const task = queue.then(async () => { sqlite.exec('BEGIN'); try { const value = await context.run(true, () => fn(database)); sqlite.exec('COMMIT'); return value; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; } });
      queue = task.catch(() => {}); return task;
    },
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-language-routing-'));
  const calls = [];
  const options = { database: backend === 'mysql' ? database : sqlite, jwtSecret: secret,
    equipmentUploadDir: path.join(folder, 'equipment'), mediaUploadDir: path.join(folder, 'media'),
    deepSeekClientFactory: () => ({ chat: { completions: { create: async (body, options) => {
      calls.push(body); return provider(body, calls.length, sqlite, options);
    } } } }),
  };
  const app = backend === 'mysql' ? await createMysqlApp(options) : createApp(options);
  if (backend === 'mysql') await app.locals.accountContinuity.start();
  const server = app.listen(0, '127.0.0.1');
  if (completedBodySignal) server.prependListener('request', request => {
    // Node 24.19 exposes an inherited IncomingMessage signal which aborts
    // when the JSON body finishes. Reproduce it on earlier Node versions too.
    Object.setPrototypeOf(request, Object.create(Object.getPrototypeOf(request), {
      signal: { get: () => AbortSignal.abort(), configurable: true },
    }));
  });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const request = async (route, body, user = 0, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(user == null ? {} : { authorization: `Bearer ${tokens[user]}` }) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: options.signal || AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    await app.locals.accountContinuity?.stop(); await app.locals.imageRetirement?.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); sqlite.close();
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert(path.basename(folder).startsWith('assistant-language-routing-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { request, calls, sqlite };
}

test('park is a setting; actual location questions route to facilities; emergencies outrank locations', () => {
  for (const question of ['我陪阿媽去公園練下手臂，應該點幫佢？', 'I help my mother exercise her arms at the park.', 'How do I use the equipment in this park?']) {
    assert.notEqual(assistantIntent(question).type, 'facility', question);
  }
  for (const question of ['最近的公園在哪？', '附近有咩設施？', 'Where is the nearest park?', '設施地址係邊度？']) assert.equal(assistantIntent(question).type, 'facility', question);
  const urgent = assistantIntent('我喺公園心口痛，抖唔到氣，附近有咩設施？');
  assert.equal(urgent.urgent, true); assert.notEqual(urgent.type, 'facility');
});

test('named guide uses complete published section, preserves its ending and refuses conflicting hand instructions', () => {
  const item = { id: 'test', name: '測試器材', categories: [], description: 'OUTDATED_TRUNCATED_DESCRIPTION', details: '已發佈說明。'.repeat(350) + '最後警告必須保留。', careTip: '' };
  const result = assistantNamedGuideAnswer(item, '器材點用？', 'zh');
  assert(result.reply.endsWith('最後警告必須保留。')); assert.doesNotMatch(result.reply, /OUTDATED/); assert.equal(result.deepSeekUsed, false);
  const conflict = assistantNamedGuideAnswer({ ...item, details: '不要兩手同時拉繩。', careTip: '不要單手拉繩。' }, '器材點用？', 'zh');
  assert.equal(conflict.guideContentNeedsReview, true);
  assert.match(conflict.reply, /先不要自行拉繩/); assert.match(conflict.reply, /場地人員或物理治療師示範/);
  assert.doesNotMatch(conflict.reply, /不要兩手|不要單手/);
});

for (const backend of ['sqlite', 'mysql']) {
  test(`${backend}: completed request-body signal does not cancel response work; actual disconnect does`, async t => {
    let started, cancelled;
    const providerStarted = new Promise(resolve => { started = resolve; });
    const providerCancelled = new Promise(resolve => { cancelled = resolve; });
    const env = await fixture(t, backend, (_body, number, _sqlite, options) => {
      assert.equal(options.signal.aborted, false, 'body completion is not a cancelled response');
      if (number === 1) return invalid;
      started();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        cancelled(); reject(options.signal.reason);
      }, { once: true }));
    }, { completedBodySignal: true });
    const completed = await env.request('/api/assistant/chat', { message: '你好' });
    assert.equal(completed.status, 200); assert.equal(completed.data.recoveryReason, 'providerInvalidResponse');
    const controller = new AbortController();
    const disconnected = env.request('/api/assistant/chat', { message: '你好' }, 0, { signal: controller.signal });
    const disconnectedError = disconnected.catch(error => error);
    const limit = promise => Promise.race([promise, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error('transport lifecycle check timed out')), 2000);
      promise.finally(() => clearTimeout(timer));
    })]);
    await limit(providerStarted); controller.abort();
    assert.equal((await disconnectedError).name, 'AbortError');
    await limit(providerCancelled); assert.equal(env.calls.length, 2);
  });

  test(`${backend}: inherited urgent symptoms precede a narrower FAQ until explicitly cleared`, async t => {
    const env = await fixture(t, backend, () => { throw Error('deterministic warning/FAQ should not call provider'); });
    const history = [{ role: 'user', content: '我心口痛，抖唔到氣' }];
    const result = await env.request('/api/assistant/chat', { message: '膝痛有什麼器材要小心？', locale: 'zh', history });
    assert.equal(result.status, 200); assert.match(result.data.reply, /999/);
    assert.deepEqual(result.data.recommendations, []); assert.equal(result.data.faqId, undefined);
    const cleared = await env.request('/api/assistant/chat', {
      message: 'I have no chest pain or difficulty breathing now; my knee hurts. What equipment should I avoid?', locale: 'en', history,
    });
    assert.equal(cleared.status, 200); assert.equal(cleared.data.faqId, 'knee-cautions');
    assert.doesNotMatch(cleared.data.reply, /999/); assert.equal(env.calls.length, 0);
  });

  test(`${backend}: invalid provider JSON recovers once, stays authenticated, and includes no invented guide`, async t => {
    const env = await fixture(t, backend);
    assert.equal((await env.request('/api/assistant/chat', { message: '你好' }, null)).status, 401);
    const response = await env.request('/api/assistant/chat', { message: '你好', locale: 'zh' });
    assert.equal(response.status, 200); assert.equal(response.data.recoveryReason, 'providerInvalidResponse');
    assert.match(response.data.reply, /未能清楚回答/); assert.match(response.data.reply, /哪一款器材/);
    assert.deepEqual(response.data.recommendations, []); assert.equal(env.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(response.data), /PRIVATE_PROVIDER_KEY|PRIVATE_FIXTURE_NAME|invalid provider JSON/);
  });

  test(`${backend}: invalid tool response after catalog changes remains failed, never recovery success`, async t => {
    const env = await fixture(t, backend, (_body, number, sqlite) => {
      if (number === 1) return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'get_facility_guide', arguments: '{"id":"0"}' } }] } }] };
      sqlite.prepare("UPDATE app_equipment_items SET is_active=0 WHERE id='0'").run(); return invalid;
    });
    const response = await env.request('/api/assistant/chat', { message: '請介紹有轉盤的器材如何操作' });
    assert.equal(response.status, 502); assert.equal(response.data.error, 'deepSeekInvalidResponse'); assert.equal(response.data.recoveryReason, undefined);
    assert.deepEqual(response.data.recommendations, []); assert.equal(env.calls.length, 2);
  });

  test(`${backend}: provider permission error is not masked as a successful clarification`, async t => {
    const env = await fixture(t, backend, () => { throw Object.assign(Error('provider unauthorized'), { code: 'invalid_api_key', status: 401 }); });
    const result = await env.request('/api/assistant/chat', { message: '你好' });
    assert.equal(result.status, 502); assert.equal(result.data.error, 'deepSeekUnavailable'); assert.equal(result.data.recoveryReason, undefined);
  });

  test(`${backend}: tool-retrieved guide checks contradictory instructions across its maintained fields`, async t => {
    const env = await fixture(t, backend, (_body, number) => number === 1
      ? { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'read-20', type: 'function', function: { name: 'get_facility_guide', arguments: '{"id":"20"}' } }] } }] }
      : answer({ guideReferences: [{ id: '20', field: 'details' }] }));
    env.sqlite.prepare("UPDATE app_equipment_items SET details_zh='不要兩手同時拉繩。',care_tip_zh='不要單手拉繩。',tcm_enabled=0 WHERE id='20'").run();
    const result = await env.request('/api/assistant/chat', { message: '請介紹有軟繩的指南內容' });
    assert.equal(result.status, 200); assert.match(result.data.reply, /先不要自行拉繩/);
    assert.match(result.data.reply, /場地人員或物理治療師示範/);
    assert.doesNotMatch(result.data.reply, /不要兩手|不要單手/); assert.equal(env.calls.length, 2);
  });

  test(`${backend}: 44 Chinese/Cantonese cases plus 8 new-expression cases finish through production handlers with a stub provider`, async t => {
    const env = await fixture(t, backend, body => answer(symptomProviderSelection(body) || { reply: '請告訴我想了解的器材或運動主題。', recommendations: [], guideReferences: [] }));
    const previous = new Map();
    for (const [index, entry] of replay.entries()) {
      const prior = entry.priorCaseId ? previous.get(entry.priorCaseId) : null;
      const history = prior ? [{ role: 'user', content: prior.question }, { role: 'assistant', content: prior.reply }] : [];
      const result = await env.request('/api/assistant/chat', { message: entry.question, locale: entry.locale, history }, Math.floor(index / 18));
      assert.equal(result.status, 200, `${entry.id}: ${JSON.stringify(result.data)}`);
      assert.equal(typeof result.data.reply, 'string'); assert(result.data.reply.trim(), entry.id);
      assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_PROVIDER_KEY|PRIVATE_FIXTURE_NAME/);
      if (entry.id === 'pair-13-cantonese') { assert.equal(result.data.deepSeekUsed, false); assert.match(result.data.reply, /999/); assert.deepEqual(result.data.recommendations, []); }
      if (entry.id === 'pair-19-standard') assert.equal(result.data.deepSeekUsed, false, 'known rope question must avoid provider failure');
      previous.set(entry.id, { question: entry.question, reply: result.data.reply });
    }
    assert.equal(replay.length, 52);
  });
}

test('mysql jobs persist a recovered invalid response and expose it only to its account', async t => {
  const env = await fixture(t, 'mysql');
  const job = { id: 'invalid-recovery-job', request: { message: '你好', locale: 'zh', conversation: { id: 'recovery-conversation', userMessageId: 'recovery-question', locale: 'zh', createdAt: new Date().toISOString() } } };
  assert.equal((await env.request('/api/assistant/jobs', job)).status, 202);
  let settled;
  for (let i = 0; i < 100; i++) {
    const result = await env.request('/api/assistant/jobs/' + job.id);
    if (['complete', 'failed'].includes(result.data.status)) { settled = result; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(settled?.data.status, 'complete'); assert.equal(settled.data.result.recoveryReason, 'providerInvalidResponse');
  assert.equal((await env.request('/api/assistant/jobs/' + job.id, null, 1)).status, 404);
  const saved = await env.request('/api/account/data/sync', { collection: 'assistant_zh', cursor: 0, changes: [] });
  assert(saved.data.records.some(record => record.value.messages.some(message => message.reply === settled.data.result.reply)));
  assert.equal(env.calls.length, 1);
});
