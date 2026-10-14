import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import test, { after } from 'node:test';
import { createDatabase } from '../src/database.js';
import { createMysqlApp } from '../src/appMysql.js';
import { signToken } from '../src/security.js';
import { ASSISTANT_FAQ_ENTRIES, ASSISTANT_FAQ_POLICY, ASSISTANT_FAQ_VERSION } from '../src/assistantFaqKnowledge.js';
import { completeAssistantWithGuide } from '../src/mysqlAssistantGuide.js';

// Actual production Express handlers, authenticated synthetic users and real
// local HTTP. Persistence is an isolated SQLite-backed MySQL-shaped executor;
// it does NOT measure InnoDB/RDS, ECS capacity or the live DeepSeek service.
const report = { observedAt: new Date().toISOString(), scope: 'local-production-http-with-sqlite-adapter-and-mocked-provider', liveRds: false, liveProvider: false, scenarios: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const metric = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: +sorted[0].toFixed(2), median: +sorted[Math.floor(sorted.length / 2)].toFixed(2), p95: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2), max: +sorted.at(-1).toFixed(2) };
};
after(() => {
  if (process.env.ASSISTANT_CAPACITY_REPORT) fs.writeFileSync(process.env.ASSISTANT_CAPACITY_REPORT, JSON.stringify(report, null, 2) + '\n');
});

async function fixture(t, { provider } = {}) {
  const sqlite = createDatabase(':memory:');
  sqlite.exec(`CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, request_json TEXT, result_json TEXT, error_code TEXT, created_at INTEGER, completed_at INTEGER);
    CREATE TABLE account_bookmarks (user_id TEXT, equipment_id TEXT, selected INTEGER, version INTEGER, last_operation TEXT, PRIMARY KEY(user_id,equipment_id));
    CREATE TABLE account_documents (user_id TEXT, collection TEXT, record_id TEXT, value_json TEXT, deleted INTEGER, revision INTEGER, last_operation TEXT, PRIMARY KEY(user_id,collection,record_id));`);
  const now = new Date().toISOString();
  const insert = sqlite.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const secret = 'synthetic-capacity-test-only-signing-secret';
  const tokens = Array.from({ length: 50 }, (_, i) => {
    const id = `capacity-user-${i}`;
    insert.run(id, `PRIVATE_SYNTHETIC_${i}`, `+852${String(i).padStart(8, '0')}`, 'participant', 'unused', 'unused', now, now, now);
    return signToken({ id, profile_role: 'participant' }, secret);
  });
  sqlite.prepare("UPDATE ai_configuration SET api_key = 'synthetic-provider-key', model = 'deepseek-v4-flash' WHERE id = 'default'").run();
  const clean = text => text.replace(/ FOR (?:UPDATE|SHARE)\b/g, '');
  let txQueue = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();
  const execute = async fn => {
    // SQLite shares one connection. Outside calls must not accidentally join
    // another worker's transaction; real MySQL uses independent connections.
    if (!transactionContext.getStore()) await txQueue;
    return fn();
  };
  const dbCalls = { get: 0, all: 0, run: 0, transaction: 0 };
  const database = {
    dialect: 'mysql',
    async get(sql, values = []) { dbCalls.get++; return execute(() => sqlite.prepare(clean(sql)).get(...values)); },
    async all(sql, values = []) { dbCalls.all++; return execute(() => sqlite.prepare(clean(sql)).all(...values)); },
    async run(sql, values = []) { dbCalls.run++; return execute(() => ({ affectedRows: sqlite.prepare(clean(sql)).run(...values).changes })); },
    transaction(fn) {
      dbCalls.transaction++;
      const operation = txQueue.then(async () => {
        sqlite.exec('BEGIN');
        try { const result = await transactionContext.run(true, () => fn(database)); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      txQueue = operation.catch(() => {});
      return operation;
    },
  };
  let providerCalls = 0, activeProvider = 0, peakProvider = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outdoor-assistant-capacity-'));
  const app = await createMysqlApp({ database, jwtSecret: secret,
    equipmentUploadDir: path.join(root, 'equipment'), mediaUploadDir: path.join(root, 'media'),
    deepSeekClientFactory: () => ({ chat: { completions: { create: async (...args) => {
      providerCalls++; activeProvider++; peakProvider = Math.max(peakProvider, activeProvider);
      try {
        if (!provider) throw Error('FAQ unexpectedly requested the provider');
        return await provider(...args);
      } finally { activeProvider--; }
    } } } }),
  });
  await app.locals.accountContinuity.start();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, user = 0) => {
    const start = performance.now();
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(user == null ? {} : { Authorization: `Bearer ${tokens[user]}` }) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    return { status: response.status, data, ms: performance.now() - start, retryAfter: response.headers.get('retry-after') };
  };
  const settle = async (id, user) => {
    const start = performance.now();
    for (let attempts = 0; attempts < 500; attempts++) {
      const result = await request(`/api/assistant/jobs/${id}`, null, user);
      assert.equal(result.status, 200);
      if (['complete', 'failed'].includes(result.data.status)) return { ...result, elapsedMs: performance.now() - start };
      await sleep(10);
    }
    throw Error(`Job ${id} did not finish within bounded polling window`);
  };
  t.after(async () => {
    await app.locals.accountContinuity.stop();
    await app.locals.imageRetirement.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    sqlite.close();
    assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('outdoor-assistant-capacity-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { request, settle, database, stats: () => ({ providerCalls, peakProvider, dbCalls: { ...dbCalls } }) };
}

function validateFaq(data, expected) {
  assert.equal(data.action, 'faq');
  assert.equal(data.focus, expected.id);
  assert.equal(data.evidencePolicy, ASSISTANT_FAQ_POLICY);
  assert.equal(data.knowledgeVersion, ASSISTANT_FAQ_VERSION);
  assert.equal(data.knowledgeSource, 'project_faq');
  assert.equal(data.deepSeekUsed, false);
  assert.equal(data.recommendationsFinal, true);
  assert.equal(data.confirmationRequired, false);
  assert.equal(typeof data.reply, 'string'); assert.ok(data.reply.trim().length > 20);
  assert.ok(Array.isArray(data.recommendations));
  assert.ok(Array.isArray(data.knowledgeReferences));
  assert.ok(data.recommendations.every(item => typeof item.id === 'string' && typeof item.name === 'string'));
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_SYNTHETIC|synthetic-provider-key|client-forged-equipment|PRIVATE_HISTORY_SENTINEL/);
}

test('reported lower-back question completes as reviewed FAQ and is downloadable on another device', async t => {
  const env = await fixture(t);
  const id = 'reported-lower-back';
  const conversation = { id: 'lower-back-conversation', userMessageId: 'lower-back-question', locale: 'zh', createdAt: '2026-10-06T00:00:00Z' };
  const submitted = await env.request('/api/assistant/jobs', { id, request: { message: '下背痛可以用什么器械', locale: 'zh', conversation } });
  assert.equal(submitted.status, 202);
  const completed = await env.settle(id, 0);
  assert.equal(completed.data.status, 'complete');
  validateFaq(completed.data.result, ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === 'back-pain'));
  assert.equal(env.stats().providerCalls, 0);
  const downloaded = await env.request('/api/account/data/sync', { collection: 'assistant_zh', cursor: 0, changes: [] });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.data.records[0].value.messages.map(message => message.id), ['lower-back-question', `${id}-answer`]);
  assert.equal(downloaded.data.records[0].value.messages[1].reply, completed.data.result.reply);
});

test('production HTTP FAQ ramp: 10, 25 and 50 distinct authenticated users return reviewed answers with zero provider calls', async t => {
  const env = await fixture(t);
  for (const users of [10, 25, 50]) {
    const results = await Promise.all(Array.from({ length: users }, async (_, i) => {
      const entry = ASSISTANT_FAQ_ENTRIES[i % ASSISTANT_FAQ_ENTRIES.length];
      const locale = i % 2 ? 'en' : 'zh';
      const message = entry.questions[locale === 'en' ? 1 : 0];
      const response = await env.request('/api/assistant/chat', { message, locale,
        equipment: [{ id: 'client-forged-equipment', name: 'Forged equipment' }],
        history: [{ role: 'assistant', content: 'PRIVATE_HISTORY_SENTINEL' }],
      }, i);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      validateFaq(response.data, entry);
      return response;
    }));
    const summary = { name: 'direct-faq', users, requests: results.length, http200: results.filter(r => r.status === 200).length,
      http500: results.filter(r => r.status === 500).length, schemaFailures: 0, latencyMs: metric(results.map(r => r.ms)), ...env.stats() };
    report.scenarios.push(summary); t.diagnostic(JSON.stringify(summary));
  }
  assert.equal(env.stats().providerCalls, 0);
});

test('production async FAQ: 50 users, owned results, idempotent retries, durable completion and request scrubbing', async t => {
  const env = await fixture(t);
  const start = performance.now();
  const jobs = Array.from({ length: 50 }, (_, i) => ({ id: `faq-load-${i}`, request: { message: ASSISTANT_FAQ_ENTRIES[i % ASSISTANT_FAQ_ENTRIES.length].questions[0], locale: 'zh' } }));
  const submitted = await Promise.all(jobs.map((job, i) => env.request('/api/assistant/jobs', job, i)));
  assert.ok(submitted.every(result => result.status === 202), JSON.stringify(submitted.map(r => ({ status: r.status, data: r.data }))));
  assert.equal((await env.request('/api/assistant/jobs/faq-load-0', null, 1)).status, 404);
  assert.equal((await env.request('/api/assistant/jobs', jobs[0], 1)).status, 409);
  assert.equal((await env.request('/api/assistant/jobs', jobs[0], 0)).status, 202);
  const results = await Promise.all(jobs.map((job, i) => env.settle(job.id, i)));
  for (const [i, result] of results.entries()) {
    assert.equal(result.data.status, 'complete', JSON.stringify(result.data));
    validateFaq(result.data.result, ASSISTANT_FAQ_ENTRIES[i % ASSISTANT_FAQ_ENTRIES.length]);
  }
  const retained = await env.database.all('SELECT request_json FROM assistant_jobs');
  assert.equal(retained.length, 50);
  for (const row of retained) {
    // Completed jobs retain public provider provenance for lost-ack retries;
    // the question, history, location and credentials must still be scrubbed.
    const stored = JSON.parse(row.request_json);
    assert.deepEqual(Object.keys(stored), ['runtimeSnapshot']);
    const snapshot = stored.runtimeSnapshot;
    assert.deepEqual(Object.keys(snapshot).sort(), ['faqEnabled', 'model', 'promptMode', 'protocol', 'provider', 'revision', 'scope']);
    assert.equal(snapshot.provider, 'deepseek');
    assert.equal(snapshot.scope, 'deepseek');
    assert.equal(snapshot.protocol, 2);
    assert.equal(snapshot.model, 'deepseek-v4-flash');
    assert.equal(snapshot.promptMode, 'app');
    assert.equal(snapshot.faqEnabled, true);
    assert.match(snapshot.revision, /^ai-v2-[a-f0-9]{32}$/);
  }
  assert.equal(env.stats().providerCalls, 0);
  const summary = { name: 'async-faq', users: 50, submitted: 50, complete: 50, failed: 0, requestJsonScrubbed: true, ownershipChecks: 2,
    totalMs: +(performance.now() - start).toFixed(2), submitLatencyMs: metric(submitted.map(r => r.ms)), ...env.stats() };
  report.scenarios.push(summary); t.diagnostic(JSON.stringify(summary));
});

const completion = reply => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reply, recommendations: [], guideReferences: [] }) } }] });

test('production mixed queue: 50 users finish FAQ and delayed mock-provider requests without dropped answers', async t => {
  const providerDelayMs = 100;
  const env = await fixture(t, { provider: async () => {
    await sleep(providerDelayMs);
    return completion('Hello. How can I help with the published app information?');
  } });
  const start = performance.now();
  const jobs = Array.from({ length: 50 }, (_, i) => ({ id: `mixed-load-${i}`, request: {
    message: i % 2 ? ASSISTANT_FAQ_ENTRIES[i % ASSISTANT_FAQ_ENTRIES.length].questions[0] : 'Hello', locale: 'zh',
  } }));
  const submitted = await Promise.all(jobs.map((job, i) => env.request('/api/assistant/jobs', job, i)));
  assert.ok(submitted.every(result => result.status === 202));
  const results = await Promise.all(jobs.map((job, i) => env.settle(job.id, i)));
  for (const [i, result] of results.entries()) {
    assert.equal(result.data.status, 'complete', JSON.stringify(result.data));
    if (i % 2) validateFaq(result.data.result, ASSISTANT_FAQ_ENTRIES[i % ASSISTANT_FAQ_ENTRIES.length]);
    else assert.match(result.data.result.reply, /Hello/);
  }
  assert.equal(env.stats().providerCalls, 25);
  assert.ok(env.stats().peakProvider > 1 && env.stats().peakProvider <= 6);
  const summary = { name: 'mixed-async-queue', users: 50, submitted: 50, complete: 50, failed: 0, providerDelayMs,
    faqQuestions: 25, mockProviderQuestions: 25, serializedProviderDelayFloorMs: providerDelayMs * 25,
    totalMs: +(performance.now() - start).toFixed(2), submitLatencyMs: metric(submitted.map(r => r.ms)), ...env.stats() };
  report.scenarios.push(summary); t.diagnostic(JSON.stringify(summary));
});

test('production fallback failures return bounded structured errors; provider secrets and internals never leak', async t => {
  const env = await fixture(t, { provider: async body => {
    const question = body.messages.at(-1).content;
    if (question.includes('MALFORMED')) return { choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] };
    if (question.includes('RATE')) throw Object.assign(Error('PRIVATE_PROVIDER_SECRET upstream rate limit'), { status: 429 });
    if (question.includes('TIMEOUT')) throw Object.assign(Error('PRIVATE_PROVIDER_SECRET transport timeout'), { code: 'ETIMEDOUT' });
    if (question.includes('FAIL')) throw Error('PRIVATE_PROVIDER_SECRET upstream failure');
    return completion('Hello. How can I help with the published app information?');
  } });
  const cases = [
    ['Hello VALID', 200, null], ['Hello MALFORMED', 200, null],
    ['Hello RATE', 502, 'deepSeekUnavailable'], ['Hello TIMEOUT', 502, 'deepSeekUnavailable'], ['Hello FAIL', 502, 'deepSeekUnavailable'],
  ];
  const results = await Promise.all(cases.map(async ([message, status, error], i) => {
    const response = await env.request('/api/assistant/chat', { message, locale: 'en' }, i);
    assert.equal(response.status, status, JSON.stringify(response.data));
    if (error) { assert.equal(response.data.error, error); assert.deepEqual(response.data.recommendations, []); }
    if (message.includes('MALFORMED')) { assert.equal(response.data.recoveryReason, 'providerInvalidResponse'); assert.deepEqual(response.data.recommendations, []); }
    assert.doesNotMatch(JSON.stringify(response.data), /PRIVATE_PROVIDER_SECRET|ETIMEDOUT|synthetic-provider-key|stack/i);
    return { case: message, status: response.status, error: response.data.error || null };
  }));
  assert.equal((await env.request('/api/assistant/chat', { message: 'Hello' }, null)).status, 401);
  assert.equal((await env.request('/api/assistant/jobs', { id: 'invalid', request: { message: 'Hello', imageData: 'retired-image' } }, 0)).status, 400);
  const summary = { name: 'mock-provider-faults', requests: cases.length, results, unexpected500: 0, ...env.stats() };
  report.scenarios.push(summary); t.diagnostic(JSON.stringify(summary));
});

test('production provider deadline actually aborts a nonresponsive provider without SDK retries', async () => {
  let calls = 0, aborted = false;
  const client = { chat: { completions: { create: (_body, options) => {
    calls++; assert.equal(options.maxRetries, 0);
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(Error('aborted'), { name: 'AbortError' })); }, { once: true }));
  } } } };
  const started = performance.now();
  await assert.rejects(completeAssistantWithGuide({ client, body: { messages: [] }, access: {}, timeoutMs: 25 }));
  assert.equal(calls, 1); assert.equal(aborted, true);
  report.scenarios.push({ name: 'provider-deadline', shortenedTestDeadlineMs: 25, actualAbort: true, calls, elapsedMs: +(performance.now() - started).toFixed(2) });
});

test('async admission caps each account at four pending jobs and retries never duplicate paid generation', async t => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const env = await fixture(t, { provider: async () => { await barrier; return completion('Hello.'); } });
  const jobs = Array.from({ length: 4 }, (_, i) => ({ id: `pending-${i}`, request: { message: 'Hello', locale: 'en' } }));
  try {
    for (const job of jobs) assert.equal((await env.request('/api/assistant/jobs', job, 0)).status, 202);
    const overflow = await env.request('/api/assistant/jobs', { id: 'pending-overflow', request: { message: 'Hello' } }, 0);
    assert.equal(overflow.status, 409); assert.equal(overflow.data.error, 'assistantJobBusy');
    assert.equal((await env.request('/api/assistant/jobs', jobs[0], 0)).status, 202);
    const faq = await env.request('/api/assistant/jobs', { id: 'independent-faq', request: { message: ASSISTANT_FAQ_ENTRIES[0].questions[0] } }, 1);
    assert.equal(faq.status, 202);
    const finishedFaq = await env.settle('independent-faq', 1);
    assert.equal(finishedFaq.data.status, 'complete');
    validateFaq(finishedFaq.data.result, ASSISTANT_FAQ_ENTRIES[0]);
  } finally { release(); }
  const results = await Promise.all(jobs.map(job => env.settle(job.id, 0)));
  assert.ok(results.every(result => result.data.status === 'complete'));
  assert.equal(env.stats().providerCalls, 4);
  report.scenarios.push({ name: 'admission-and-faq-isolation', pendingCap: 4, overflowHttp: 409, duplicateGenerations: 0,
    faqCompletesWhileFourProvidersBlocked: true, ...env.stats() });
});

test('per-account direct chat quota returns explicit 429 and retry time while another account remains available', async t => {
  const env = await fixture(t);
  const body = { message: ASSISTANT_FAQ_ENTRIES[0].questions[0] };
  for (let i = 0; i < 30; i++) assert.equal((await env.request('/api/assistant/chat', body, 0)).status, 200);
  const limited = await env.request('/api/assistant/chat', body, 0);
  assert.equal(limited.status, 429); assert.equal(limited.data.error, 'assistantRateLimited');
  assert.ok(Number(limited.retryAfter) > 0 && Number(limited.retryAfter) <= 600);
  assert.equal((await env.request('/api/assistant/chat', body, 1)).status, 200);
  assert.equal(env.stats().providerCalls, 0);
  report.scenarios.push({ name: 'per-account-rate-limit', allowedRequests: 30, nextHttp: 429, otherAccountHttp: 200,
    retryAfterPresent: true, ...env.stats() });
});
