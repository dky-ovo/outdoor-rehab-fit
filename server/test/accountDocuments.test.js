import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountDocuments } from '../src/accountDocuments.js';

function setup(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, deleted_at TEXT);
    INSERT INTO users VALUES ('alice',NULL),('bob',NULL);
    CREATE TABLE account_documents (user_id TEXT, collection TEXT, record_id TEXT, value_json TEXT, deleted INTEGER, revision INTEGER, last_operation TEXT, PRIMARY KEY(user_id,collection,record_id));`);
  const statement = text => sql.prepare(text.replaceAll(' FOR UPDATE',''));
  const db = { get: async (s,v=[]) => statement(s).get(...v), all: async (s,v=[]) => statement(s).all(...v), run: async (s,v=[]) => statement(s).run(...v) };
  let queue=Promise.resolve();
  db.transaction = work => { const task=queue.then(async()=>{sql.exec('BEGIN');try {const result=await work(db);sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}});queue=task.catch(()=>{});return task; };
  t.after(()=>sql.close());
  const store=createAccountDocuments(db);
  return { db, store, sync:(collection,changes=[],cursor=0,user='alice')=>store.sync(user,{collection,changes,cursor}) };
}
const change=(id,value,version=null,operationId=`op-${id}`)=>({id,value,version,operationId,deleted:false});
const dialog=(...ids)=>({createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z',legacy:false,messages:ids.map(id=>({id,sender:'user',text:id}))});

test('AI histories merge by message ID, isolated by account and locale; retry does not duplicate',async t=>{
  const {sync}=setup(t);
  await sync('assistant_zh',[change('dialog',dialog('one'))]);
  const second=change('dialog',dialog('two'),null,'op-two');
  const result=await sync('assistant_zh',[second]);
  assert.deepEqual(result.records[0].value.messages.map(x=>x.id),['one','two']);
  assert.equal((await sync('assistant_zh',[second])).records[0].version,2);
  assert.equal((await sync('assistant_zh',[],0,'bob')).records.length,0);
  assert.equal((await sync('assistant_en')).records.length,0);
});
test('deletion tombstones prevent offline history resurrection and cursor sees only changes',async t=>{
  const {sync}=setup(t);
  await sync('assistant_zh',[change('dialog',dialog('one'))]);
  await sync('assistant_zh',[{...change('dialog',null,1,'delete-dialog'),deleted:true}]);
  const stale=await sync('assistant_zh',[change('dialog',dialog('one','late'),1,'offline')],1);
  assert.equal(stale.records[0].deleted,true);
  assert.equal((await sync('assistant_zh',[],stale.cursor)).records.length,0);
});
test('independent goal edits merge while stale target snapshot cannot overwrite latest target',async t=>{
  const {sync}=setup(t);
  await sync('goals',[change('target-aerobic',{target:150}),change('target-muscle',{target:2})]);
  await sync('goals',[change('target-aerobic',{target:200},1,'edit-a')]);
  await sync('goals',[change('target-aerobic',{target:100},1,'stale-a'),change('target-muscle',{target:4},2,'edit-b')]);
  const result=await sync('goals');
  assert.equal(result.records.find(x=>x.id==='target-aerobic').value.target,200);
  assert.equal(result.records.find(x=>x.id==='target-muscle').value.target,4);
});
test('usage counters converge without retry double counting and independent device data remains',async t=>{
  const {sync}=setup(t);
  await sync('usage',[change('device-one',{usageDays:['2026-09-28'],loginEvents:2})]);
  await sync('usage',[change('device-one',{usageDays:['2026-09-27'],loginEvents:1},0,'stale'),change('device-two',{usageDays:['2026-09-28'],loginEvents:3})]);
  const rows=(await sync('usage')).records;
  assert.equal(rows.reduce((n,x)=>n+x.value.loginEvents,0),5);
  assert.deepEqual(rows[0].value.usageDays,['2026-09-27','2026-09-28']);
});
test('incremental pagination covers all documents and invalid bulk change rolls back',async t=>{
  const {sync}=setup(t);
  for(let i=0;i<3;i++) await sync('usage',Array.from({length:20},(_,n)=>change(`d-${i*20+n}`,{usageDays:[],loginEvents:1})));
  let cursor=0, ids=[]; do {const result=await sync('usage',[],cursor);ids.push(...result.records.map(x=>x.id));cursor=result.cursor;if(!result.more)break;}while(true);
  assert.equal(new Set(ids).size,60);
  await assert.rejects(sync('goals',[change('target-muscle',{target:4}),change('target-invalid',{target:5})]),{code:'invalidAccountData'});
  assert.equal((await sync('goals')).records.length,0);
  await assert.rejects(sync('usage',[change('__proto__',{usageDays:[]})]),{code:'invalidAccountData'});
});
test('server-completed result persists for another device even after job is gone',async t=>{
  const {db,store,sync}=setup(t), request={message:'question',conversation:{id:'dialog',userMessageId:'q1',locale:'zh',createdAt:'2026-09-28T00:00:00Z'}};
  await db.transaction(tx=>store.recordJob(tx,'alice','job-one',request));
  await db.transaction(tx=>store.recordJob(tx,'alice','job-one',request,{reply:'answer',recommendations:[]}));
  const row=(await sync('assistant_zh')).records[0];
  assert.deepEqual(row.value.messages.map(x=>x.id),['q1','job-one-answer']);
  assert.equal(row.value.messages[1].reply,'answer');
  await db.run("UPDATE users SET deleted_at='deleted' WHERE id='alice'");
  assert.equal(await sync('assistant_zh'),null);
});
