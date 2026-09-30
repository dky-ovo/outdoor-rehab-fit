import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { installAccountContinuity } from '../src/accountContinuity.js';
import { createAccountDocuments } from '../src/accountDocuments.js';

async function setup(t, answer = async (_req, res) => res.json({ reply: 'done' })) {
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
    authenticate: req => db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.headers.authorization || '']), answer });
  await worker.start();
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const request = async (path, body, user = 'alice') => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json() };
  };
  t.after(async () => { await worker.stop(); await new Promise(resolve => server.close(resolve)); sql.close(); });
  return { request, db, worker, documents };
}
const settle = async (request, id) => { for (let n=0; n<100; n++) { const result = await request(`assistant/jobs/${id}`); if (['complete','failed'].includes(result.data.status)) return result.data; await new Promise(r => setTimeout(r, 5)); } throw Error('job did not settle'); };
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
