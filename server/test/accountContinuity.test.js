import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { installAccountContinuity } from '../src/accountContinuity.js';
import { createAccountDocuments } from '../src/accountDocuments.js';

async function setup(t, answer = async (_req, res) => res.json({ reply: 'done' }), options = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, deleted_at TEXT);
    INSERT INTO users VALUES ('alice', NULL), ('bob', NULL);
    CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, request_json TEXT, result_json TEXT, error_code TEXT, created_at INTEGER, completed_at INTEGER);
    CREATE TABLE account_bookmarks (user_id TEXT, equipment_id TEXT, selected INTEGER, version INTEGER, last_operation TEXT, PRIMARY KEY(user_id, equipment_id));
    CREATE TABLE account_documents (user_id TEXT, collection TEXT, record_id TEXT, value_json TEXT, deleted INTEGER, revision INTEGER, last_operation TEXT, PRIMARY KEY(user_id,collection,record_id));`);
  const statement = text => sql.prepare(text.replaceAll(' FOR UPDATE', ''));
  const db = { get: async (text, values = []) => statement(text).get(...values), all: async (text, values = []) => statement(text).all(...values),
    run: async (text, values = []) => ({ affectedRows: statement(text).run(...values).changes }) };
  let queue = Promise.resolve();
  db.transaction = fn => { const operation = queue.then(async () => { sql.exec('BEGIN'); try { const result = await fn(db); sql.exec('COMMIT'); return result; } catch(e) { sql.exec('ROLLBACK'); throw e; } }); queue = operation.catch(() => {}); return operation; };
  const app = express(); app.use(express.json());
  const documents = createAccountDocuments(db);
  const worker = installAccountContinuity({ app, database: db, documents, findUser: id => db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]),
    authenticate: req => db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.headers.authorization || '']), answer, ...options });
  await worker.start();
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const request = async (path, body, user = 'alice') => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json() };
  };
  t.after(async () => { await worker.stop(); await new Promise(resolve => server.close(resolve)); sql.close(); });
  return { request, db, worker, documents };
}
const settle = async (request, id, user = 'alice') => { for (let n=0; n<100; n++) { const result = await request(`assistant/jobs/${id}`, null, user); if (['complete','failed'].includes(result.data.status)) return result.data; await new Promise(r => setTimeout(r, 5)); } throw Error('job did not settle'); };
test('v2 queued jobs pin runtime through switches and lost-ack retries without invoking the legacy provider', async t => {
  let active = 'bailian', prepared = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const env = await setup(t, async (req, res) => {
    calls.push(req.assistantRuntime);
    if (calls.length === 1) await gate;
    res.json({ reply: `answer-${req.assistantRuntime.provider}`, provider: req.assistantRuntime.provider, model: req.assistantRuntime.model, responsePolicy: req.assistantRuntime.responsePolicy });
  }, { maxConcurrentJobs: 1, prepareRequest: async input => {
    prepared++;
    if (input.provider !== active) throw Object.assign(new Error('changed'), { status: 409, code: 'assistantProviderChanged' });
    return { provider: active, model: active + '-model', revision: 'rev-1', responsePolicy: 'plain', apiKey: 'never-persist' };
  } });
  const body = id => ({ id, request: { message: id, provider: 'bailian', runtimeSnapshot: { provider: 'deepseek', apiKey: 'injected' }, conversation: { id, userMessageId: id + '-q', locale: 'zh', provider: 'bailian', createdAt: '2026-10-08T00:00:00Z' } } });
  try {
    await env.request('assistant/v2/jobs', body('first'));
    await env.request('assistant/v2/jobs', body('second'));
    active = 'deepseek';
    assert.equal((await env.request('assistant/v2/jobs', body('second'))).data.provider, 'bailian');
    assert.equal((await env.request('assistant/v2/jobs/second')).data.provider, 'bailian');
    assert.equal(prepared, 2);
    assert.equal((await env.request('assistant/jobs', body('third'))).data.error, 'assistantProviderChanged');
    release();
    const result = await settle(env.request, 'second');
    assert.equal(result.result.reply, 'answer-bailian');
    assert.equal(result.provider, 'bailian');
    assert.equal(calls[1].provider, 'bailian');
    assert.equal(calls[1].apiKey, undefined);
    const row = await env.db.get('SELECT request_json FROM assistant_jobs WHERE id = ?', ['second']);
    assert.deepEqual(Object.keys(JSON.parse(row.request_json)), ['runtimeSnapshot']);
    assert.ok(!row.request_json.includes('never-persist') && !row.request_json.includes('injected'));
    assert.equal((await env.documents.sync('alice', { collection: 'assistant_bailian_zh', cursor: 0, changes: [] })).records.length, 2);
    assert.equal((await env.documents.sync('alice', { collection: 'assistant_zh', cursor: 0, changes: [] })).records.length, 0);
    assert.equal((await env.request('assistant/jobs', { ...body('second'), request: { message: 'other', provider: 'deepseek' } })).status, 409);
  } finally { release(); }
});
test('a cross-provider worker answer is rejected and does not contaminate history', async t => {
  const { request, documents } = await setup(t, async (_req, res) => res.json({ reply: 'wrong provider text', provider: 'deepseek' }), {
    prepareRequest: async () => ({ provider: 'bailian', model: 'qwen', revision: 'one' }),
  });
  await request('assistant/jobs', { id: 'mismatch', request: { message: 'question', provider: 'bailian', conversation: { id: 'c', userMessageId: 'q', locale: 'en', provider: 'bailian', createdAt: '2026-10-08T00:00:00Z' } } });
  const result = await settle(request, 'mismatch');
  assert.equal(result.error, 'assistantProviderMismatch'); assert.equal(result.provider, 'bailian');
  const records = await documents.sync('alice', { collection: 'assistant_bailian_en', cursor: 0, changes: [] });
  assert.ok(!JSON.stringify(records).includes('wrong provider text'));
});
test('startup interruption retains Bailian provider provenance without retaining the request or calling another provider', async t => {
  const env = await setup(t);
  await env.worker.stop();
  const snapshot = { provider: 'bailian', model: 'qwen', revision: 'before-restart', promptMode: 'none', faqEnabled: false };
  const input = { message: 'private question', runtimeSnapshot: snapshot, conversation: { id: 'restart-c', userMessageId: 'restart-q', locale: 'en', provider: 'bailian', createdAt: '2026-10-08T00:00:00Z' } };
  await env.db.run('INSERT INTO assistant_jobs (id,user_id,status,request_json,created_at) VALUES (?, ?, ?, ?, ?)', ['restart-b', 'alice', 'running', JSON.stringify(input), Date.now()]);
  let calls = 0;
  const recovery = installAccountContinuity({ app: express(), database: env.db, documents: env.documents, authenticate: async () => null, findUser: async () => null, answer: async () => { calls++; } });
  await recovery.start(); await recovery.stop();
  const row = await env.db.get('SELECT * FROM assistant_jobs WHERE id = ?', ['restart-b']);
  assert.equal(row.status, 'failed'); assert.equal(row.error_code, 'assistantInterrupted');
  assert.deepEqual(JSON.parse(row.request_json), { runtimeSnapshot: snapshot });
  assert.equal(calls, 0);
  assert.equal((await env.request('assistant/jobs/restart-b')).data.provider, 'bailian');
  const records = await env.documents.sync('alice', { collection: 'assistant_bailian_en', cursor: 0, changes: [] });
  assert.equal(records.records[0].value.messages[1].provider, 'bailian');
  assert.equal((await env.documents.sync('alice', { collection: 'assistant_en', cursor: 0, changes: [] })).records.length, 0);
});
test('a whole-job deadline aborts execution and persists a terminal failure', async t => {
  let aborted = false;
  const { request, db } = await setup(t, async (req, res) => {
    await new Promise(resolve => req.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    res.json({ reply: 'late reply must not overwrite the timeout' });
  }, { jobTimeoutMs: 25, maxConcurrentJobs: 1 });
  await request('assistant/jobs', { id: 'job-deadline', request: { message: '下背痛可以用什么器械' } });
  const result = await settle(request, 'job-deadline');
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'assistantTimeout');
  assert.equal(aborted, true);
  const row = await db.get('SELECT * FROM assistant_jobs WHERE id = ?', ['job-deadline']);
  assert.equal(row.request_json, null); assert.equal(row.result_json, null);
});
test('a transport that ignores abort retains its slot; late replies cannot overwrite timeout', async t => {
  let release, calls = 0;
  const env = await setup(t, async (_req, res) => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    res.json({ reply: 'provider answer' });
  }, { jobTimeoutMs: 25, maxConcurrentJobs: 1 });
  try {
    await env.request('assistant/jobs', { id: 'ignores-abort', request: { message: 'first' } });
    assert.equal((await settle(env.request, 'ignores-abort')).error, 'assistantTimeout');
    await env.request('assistant/jobs', { id: 'next-job', request: { message: 'second' } });
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(calls, 1);
    assert.equal((await env.request('assistant/jobs/next-job')).data.status, 'queued');
    release();
    assert.equal((await settle(env.request, 'next-job')).status, 'complete');
    assert.equal((await env.request('assistant/jobs/ignores-abort')).data.error, 'assistantTimeout');
    assert.equal(calls, 2);
  } finally { release?.(); }
});
test('provider continues after submission closes; retries generate only once and other accounts cannot read', async t => {
  let finish, calls=0;
  const env = await setup(t, async (_req, res) => { calls++; await new Promise(r => { finish=r; }); res.json({ reply:'persisted answer' }); });
  const body={ id:'request-one', request:{ message:'question' } };
  assert.equal((await env.request('assistant/jobs',body)).status,202);
  assert.equal((await env.request('assistant/jobs',body)).status,202);
  assert.equal((await env.request('assistant/jobs/request-one',null,'bob')).status,404);
  assert.equal((await env.request('assistant/jobs',body,'bob')).status,409);
  finish();
  assert.equal((await settle(env.request,'request-one')).result.reply,'persisted answer');
  assert.equal(calls,1);
  assert.equal((await env.db.get('SELECT request_json FROM assistant_jobs')).request_json,null);
});
test('bookmarks sync across devices, removal tombstones beat stale legacy imports and stale retries', async t => {
  const {request}=await setup(t);
  const sync=changes=>request('account/bookmarks/sync',{changes});
  const change={id:'9',selected:true,version:null,operationId:'legacy-one'};
  assert.equal((await sync([change])).data.records[0].selected,true);
  assert.equal((await sync([])).data.records[0].version,1);
  await sync([{...change,selected:false,version:1,operationId:'remove-two'}]);
  assert.equal((await sync([change])).data.records[0].selected,false);
  assert.equal((await sync([{...change,version:1,operationId:'stale-three'}])).data.records[0].selected,false);
  assert.equal((await request('account/bookmarks/sync',{changes:[]},'bob')).data.records.length,0);
  assert.equal((await request('account/bookmarks/sync',{changes:[]},'unknown')).status,401);
});
test('provider failure is durable and restarting explicitly fails interrupted work', async t => {
  const {request,db,worker}=await setup(t,async()=>{throw Error('provider');});
  await request('assistant/jobs',{id:'fail-one',request:{message:'question'}});
  assert.equal((await settle(request,'fail-one')).status,'failed');
  await worker.stop();
  await db.run("INSERT INTO assistant_jobs (id,user_id,status,created_at) VALUES ('interrupted','alice','running',?)",[Date.now()]);
  // Recovery SQL is also exercised by a fresh worker at normal startup (not a second live worker).
  const app=express(); const recovery=installAccountContinuity({app,database:db,authenticate:async()=>null,findUser:async()=>null,answer:async()=>{}});
  await recovery.start(); await recovery.stop();
  assert.equal((await db.get("SELECT error_code FROM assistant_jobs WHERE id='interrupted'")).error_code,'assistantInterrupted');
});

test('new AI job completes into account history without any phone poll or local history upload', async t => {
  const {request,documents}=await setup(t);
  await request('assistant/jobs',{id:'job-cloud',request:{message:'kept question',locale:'en',conversation:{id:'conversation-one',locale:'en',userMessageId:'question-one',createdAt:'2026-09-28T00:00:00Z'}}});
  let cloud;
  for(let attempt=0;attempt<100;attempt++) {
    cloud=await documents.sync('alice',{collection:'assistant_en',cursor:0,changes:[]});
    if(cloud.records[0]?.value.messages.length===2)break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.deepEqual(cloud.records[0].value.messages.map(x=>x.id),['question-one','job-cloud-answer']);
  assert.equal(cloud.records[0].value.messages[1].reply,'done');
});

const conversation = { id:'conversation-full', locale:'en', userMessageId:'new-question', createdAt:'2026-09-28T00:00:00Z' };
const seedHistory = (documents, messages) => documents.sync('alice', { collection:'assistant_en', cursor:0, changes:[{
  id:conversation.id, operationId:'seed-history', deleted:false, version:null,
  value:{ createdAt:conversation.createdAt, updatedAt:conversation.createdAt, messages },
}] });

test('history capacity preserves the completed result and lets another account finish', async t => {
  for (const limit of ['messages', 'bytes']) await t.test(limit, async t => {
    const reply = limit === 'bytes' ? 'answer'.repeat(400) : 'saved answer';
    let calls = 0;
    const { request, documents, db } = await setup(t, async (_req, res) => { calls++; res.json({ reply }); });
    await seedHistory(documents, limit === 'messages'
      ? Array.from({length:499}, (_, index) => ({ id:`old-${index}`, sender:'user', text:'saved' }))
      : [{ id:'old-0', sender:'user', text:'x'.repeat(399000) }]);
    const body = { id:'full-history', request:{ message:'one more question', locale:'en', conversation } };
    assert.equal((await request('assistant/jobs', body)).status, 202);
    assert.equal((await request('assistant/jobs', { id:'other-account', request:{ message:'another question' } }, 'bob')).status, 202);
    const result = await settle(request, body.id);
    assert.equal(result.status, 'complete');
    assert.equal(result.result.reply, reply);
    assert.equal(result.historyError, 'accountHistoryFull');
    assert.equal((await settle(request, 'other-account', 'bob')).status, 'complete');
    const stored = await db.get('SELECT * FROM assistant_jobs WHERE id = ?', [body.id]);
    assert.equal(stored.error_code, 'accountHistoryFull');
    assert.equal(stored.request_json, null);
    assert.ok(stored.completed_at);
    assert.deepEqual((await request('assistant/jobs', body)).data, result);
    assert.equal(calls, 2);
  });
});

test('startup fails interrupted jobs even when their history cannot accept an error message', async t => {
  const { db, documents, worker } = await setup(t);
  await worker.stop();
  await seedHistory(documents, Array.from({length:500}, (_, index) => ({ id:`old-${index}`, sender:'user', text:'saved' })));
  const input = { message:'question', locale:'en', conversation:{ ...conversation, userMessageId:'old-0' } };
  await db.run("INSERT INTO assistant_jobs (id,user_id,status,request_json,created_at) VALUES ('interrupted-full','alice','running',?,?)", [JSON.stringify(input), Date.now()]);
  let calls = 0;
  const recovery = installAccountContinuity({ app:express(), database:db, documents, authenticate:async()=>null,
    findUser:id=>db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]), answer:async()=>{ calls++; } });
  try { await recovery.start(); } finally { await recovery.stop(); }
  const stored = await db.get("SELECT * FROM assistant_jobs WHERE id = 'interrupted-full'");
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error_code, 'assistantInterrupted');
  assert.equal(stored.request_json, null);
  assert.equal(calls, 0);
});

test('a transient result write failure retries saving without a second provider call', async t => {
  let calls = 0, failed = false;
  const { request, documents, db } = await setup(t, async (_req, res) => { calls++; res.json({ reply:'durable answer' }); });
  const run = db.run;
  db.run = async (text, values) => {
    if (!failed && text.startsWith('UPDATE assistant_jobs SET status = ?')) {
      failed = true;
      throw Object.assign(new Error('temporary save failure'), { code:'ECONNRESET' });
    }
    return run(text, values);
  };
  await request('assistant/jobs', { id:'retry-save', request:{ message:'question', locale:'en', conversation } });
  const result = await settle(request, 'retry-save');
  assert.equal(result.status, 'complete');
  assert.equal(result.result.reply, 'durable answer');
  assert.equal(result.historyError, undefined);
  assert.equal(failed, true);
  assert.equal(calls, 1);
  const history = await documents.sync('alice', { collection:'assistant_en', cursor:0, changes:[] });
  assert.deepEqual(history.records[0].value.messages.map(message=>message.id), ['new-question', 'retry-save-answer']);
});

test('an uncertain claim is reconciled before the provider is called exactly once', async t => {
  for (const applied of [false, true]) await t.test(applied ? 'UPDATE committed but response lost' : 'UPDATE not applied', async t => {
    let calls = 0, failed = false;
    const { request, db } = await setup(t, async (_req, res) => { calls++; res.json({ reply:'reconciled answer' }); });
    const run = db.run;
    db.run = async (text, values) => {
      if (!failed && text.startsWith("UPDATE assistant_jobs SET status = 'running'")) {
        failed = true;
        if (applied) await run(text, values);
        throw Object.assign(new Error('claim response lost'), { code:'ECONNRESET' });
      }
      return run(text, values);
    };
    const body = { id:'uncertain-claim', request:{ message:'question' } };
    assert.equal((await request('assistant/jobs', body)).status, 202);
    const result = await settle(request, body.id);
    assert.equal(result.status, 'complete');
    assert.equal(result.result.reply, 'reconciled answer');
    assert.deepEqual((await request('assistant/jobs', body)).data, result);
    assert.equal(failed, true);
    assert.equal(calls, 1);
    await request('assistant/jobs', { id:'next-account', request:{ message:'next question' } }, 'bob');
    assert.equal((await settle(request, 'next-account', 'bob')).status, 'complete');
    assert.equal(calls, 2);
  });
});
