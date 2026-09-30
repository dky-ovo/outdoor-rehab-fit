import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateJournal, journalBatch, reconcileJournal, releaseRejectedJournalBatch } from '../accountSyncJournal';
import { loadAssistantConversations, storeAssistantConversation, synchronizeAssistantConversations, listAssistantConversations } from '../assistantConversations';
import { synchronizeGoals, getGoalState, setTarget, addSmartGoal, updateSmartGoal } from '../goals';
import { synchronizeUsage, trackLoginEvent, getUsageStats } from '../usage';
import { synchronizePreferences, saveAccountLanguage, getAccountPreferences } from '../accountPreferences';
import { mergeRemoteLearning, getLearningProgress, getPendingLearningRecords, recordLearningCoverage } from '../learning';
jest.mock('@react-native-async-storage/async-storage',()=>require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../api',()=>({getServerSessions:jest.fn()}));
let mockOwner='phone:one';
jest.mock('../userStorage',()=>({getCurrentOwnerKey:()=>mockOwner,userDataKey:(leaf,owner)=>`${owner}/${leaf}`,
  getUserJson:async(leaf,fallback)=>JSON.parse(await require('@react-native-async-storage/async-storage').getItem(`${mockOwner}/${leaf}`)||JSON.stringify(fallback)),
  setUserJson:async(leaf,value)=>require('@react-native-async-storage/async-storage').setItem(`${mockOwner}/${leaf}`,JSON.stringify(value))}));
const ack=(body,records)=>({records,acknowledged:body.changes.map(x=>({operationId:x.operationId,record:records.find(r=>r.id===x.id)})),cursor:Math.max(body.cursor,...records.map(x=>x.version)),more:false});
const identity={owner:'alice',locale:'zh',authSessionId:'phone-session'};
beforeEach(async()=>{await AsyncStorage.clear();mockOwner='phone:one';});

test('newer local edit survives an in-flight acknowledgement with updated base revision',()=>{
  const first={a:{target:150}}, initial=updateJournal(null,first), batch=journalBatch(initial,first);
  const next={a:{target:200}}, journal=updateJournal(initial,next);
  const merged=reconcileJournal(journal,{records:[{id:'a',value:first.a,deleted:false,version:7}],acknowledged:[{operationId:batch[0].operationId,record:{id:'a',value:first.a,deleted:false,version:7}}],cursor:7},batch,next);
  expect(merged.documents.a.target).toBe(200);
  expect(journalBatch(merged.journal,merged.documents)[0]).toMatchObject({version:7,value:{target:200}});
});
test('an uncertain request survives restart and later deletion without changing its payload',()=>{
  const first={a:{target:150}}, initial=updateJournal(null,first);
  const batch=journalBatch(initial,first,{retainUnacknowledged:true});
  // Reopening the persisted journal must retry the original value even though
  // the local document was deleted after its response was lost.
  const journal=updateJournal(JSON.parse(JSON.stringify(initial)),{});
  expect(journalBatch(journal,{}, {retainUnacknowledged:true})).toEqual(batch);
  const record={id:'a',value:first.a,deleted:false,version:7};
  const merged=reconcileJournal(journal,{records:[record],acknowledged:[{operationId:batch[0].operationId,record}],cursor:7},batch,{});
  expect(merged.documents).toEqual({});
  expect(merged.journal.inFlight).toBeUndefined();
  expect(journalBatch(merged.journal,merged.documents,{retainUnacknowledged:true})[0]).toMatchObject({id:'a',deleted:true,version:7,value:null});
});
test('a genuine remote conflict still wins when no later local edit is waiting',()=>{
  const documents={a:{target:150}}, journal=updateJournal(null,documents);
  const batch=journalBatch(journal,documents,{retainUnacknowledged:true});
  const record={id:'a',value:{target:200},deleted:false,version:9};
  const merged=reconcileJournal(journal,{records:[record],acknowledged:[{operationId:batch[0].operationId,record}],cursor:9},batch,documents);
  expect(merged.documents).toEqual({a:{target:200}});
  expect(merged.journal.pending).toEqual({});
  expect(merged.journal.inFlight).toBeUndefined();
});
test('mergeable collections do not persist a duplicate document payload',()=>{
  const documents={conversation:{messages:[{text:'a'.repeat(100000)}]}}, journal=updateJournal(null,documents);
  journalBatch(journal,documents);
  expect(journal.inFlight).toBeUndefined();
  expect(JSON.stringify(journal).length).toBeLessThan(1000);
});
test('a rejected old batch cannot release a newer in-flight batch',()=>{
  const first={a:{target:150}}, journal=updateJournal(null,first);
  const oldBatch=journalBatch(journal,first,{retainUnacknowledged:true});
  const released=releaseRejectedJournalBatch(journal,oldBatch);
  const documents={a:{target:200}}, edited=updateJournal(released,documents);
  const newBatch=journalBatch(edited,documents,{retainUnacknowledged:true});
  expect(journalBatch(releaseRejectedJournalBatch(edited,oldBatch),documents)).toEqual(newBatch);
  expect(edited.pending.a.operationId).toBe(newBatch[0].operationId);
});
test('legacy AI uploads once; another device receives history without replacing active composer; no echo writes',async()=>{
  const first=await loadAssistantConversations(identity);
  await storeAssistantConversation({...identity,conversationId:first.conversationId,messages:[{id:'q1',sender:'user',text:'hi'}]});
  let rows;
  await synchronizeAssistantConversations({...identity,token:'t',send:async(_,body)=>{rows=body.changes.map(x=>({id:x.id,value:x.value,deleted:false,version:1}));return ack(body,rows);}});
  const raw=await AsyncStorage.getItem('@outdoor_fit_ai_conversations_v2:alice:zh');
  await storeAssistantConversation({...identity,conversationId:first.conversationId,messages:[{id:'q1',sender:'user',text:'hi'}]});
  expect(await AsyncStorage.getItem('@outdoor_fit_ai_conversations_v2:alice:zh')).toBe(raw);
  await AsyncStorage.clear();
  const other={...identity,authSessionId:'web-session'}, live=await loadAssistantConversations(other);
  await synchronizeAssistantConversations({...other,token:'t',send:async(_,body)=>{expect(body.changes).toEqual([]);return ack(body,rows);}});
  const view=await loadAssistantConversations(other);
  expect(view.conversationId).toBe(live.conversationId);expect(view.messages).toEqual([]);
  expect(view.history[0].messages[0].text).toBe('hi');
  await synchronizeAssistantConversations({...other,token:'t',send:async(_,body)=>{expect(body.changes).toEqual([]);return {...ack(body,[]),cursor:1};}});
});
test('late AI response from a signed-out session is ignored and pending local history retained',async()=>{
  const first=await loadAssistantConversations(identity);await storeAssistantConversation({...identity,conversationId:first.conversationId,messages:[{id:'q',sender:'user',text:'kept'}]});
  let current=true;
  await synchronizeAssistantConversations({...identity,token:'t',isCurrent:()=>current,send:async(_,body)=>{current=false;return ack(body,body.changes.map(x=>({id:x.id,value:null,deleted:true,version:2})));}});
  expect((await listAssistantConversations(identity)).history[0].messages[0].text).toBe('kept');
});
test('fresh goals pull cloud targets without publishing defaults; offline edit is retained',async()=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await synchronizeGoals({...options,send:async(_,body)=>{expect(body.changes).toEqual([]);return ack(body,[{id:'target-aerobic',value:{target:200},version:4,deleted:false}]);}});
  expect((await getGoalState()).targets.aerobic).toBe(200);
  await setTarget('muscle',5);
  await expect(synchronizeGoals({...options,send:async()=>{throw Error('offline');}})).rejects.toThrow('offline');
  expect((await getGoalState()).targets.muscle).toBe(5);
  await synchronizeGoals({...options,send:async(_,body)=>{expect(body.changes).toHaveLength(1);expect(body.changes[0]).toMatchObject({id:'target-muscle',value:{target:5}});return ack(body,body.changes.map(x=>({id:x.id,value:x.value,version:5,deleted:false})));}});
});
test('goals retry a committed write whose response was lost before uploading a later edit',async()=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await synchronizeGoals({...options,send:async(_,body)=>ack(body,[{id:'target-aerobic',value:{target:150},version:1,deleted:false}])});
  await setTarget('aerobic',200);
  let uncertain;
  await expect(synchronizeGoals({...options,send:async(_,body)=>{uncertain=body.changes;throw Error('response lost');}})).rejects.toThrow('response lost');
  await setTarget('aerobic',250);
  expect(await synchronizeGoals({...options,send:async(_,body)=>{
    expect(body.changes).toEqual(uncertain);
    return ack(body,[{id:'target-aerobic',value:{target:200},version:2,deleted:false}]);
  }})).toBe(true);
  expect((await getGoalState()).targets.aerobic).toBe(250);
  expect(await synchronizeGoals({...options,send:async(_,body)=>{
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({version:2,value:{target:250}});
    expect(body.changes[0].operationId).not.toBe(uncertain[0].operationId);
    return ack(body,[{id:'target-aerobic',value:{target:250},version:3,deleted:false}]);
  }})).toBe(false);
  expect((await getGoalState()).targets.aerobic).toBe(250);
});
test.each(['during request','after rejection'])('an overlong goal rejected with 400 can be corrected %s',async(timing)=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await synchronizeGoals({...options,send:async(_,body)=>ack(body,[])});
  await addSmartGoal('x'.repeat(5001));
  const goalId=(await getGoalState()).smartGoals[0].id;
  const rejected=Object.assign(new Error('invalidAccountData'),{status:400,code:'invalidAccountData'});
  let invalidBatch;
  await expect(synchronizeGoals({...options,send:async(_,body)=>{
    invalidBatch=body.changes;
    expect(invalidBatch[0].value.text).toHaveLength(5001);
    if(timing==='during request') await updateSmartGoal(goalId,'Corrected goal');
    throw rejected;
  }})).rejects.toBe(rejected);
  if(timing==='after rejection') await updateSmartGoal(goalId,'Corrected goal');
  expect((await getGoalState()).cloud.inFlight).toBeUndefined();
  await synchronizeGoals({...options,send:async(_,body)=>{
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].value.text).toBe('Corrected goal');
    expect(body.changes[0].operationId).not.toBe(invalidBatch[0].operationId);
    return ack(body,[{id:body.changes[0].id,value:body.changes[0].value,version:1,deleted:false}]);
  }});
  expect((await getGoalState()).cloud.pending).toEqual({});
});
test.each([
  {status:0,code:'networkError'},
  {status:500,code:'invalidAccountData'},
  {status:400,code:'unknownError'},
])('goals retain an uncertain batch after %j',async(error)=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await synchronizeGoals({...options,send:async(_,body)=>ack(body,[{id:'target-aerobic',value:{target:150},version:1,deleted:false}])});
  await setTarget('aerobic',200);
  let uncertain;
  await expect(synchronizeGoals({...options,send:async(_,body)=>{uncertain=body.changes;await setTarget('aerobic',250);throw error;}})).rejects.toBe(error);
  expect((await getGoalState()).cloud.inFlight).toEqual(uncertain);
  expect(await synchronizeGoals({...options,send:async(_,body)=>{
    expect(body.changes).toEqual(uncertain);
    return ack(body,[{id:'target-aerobic',value:{target:200},version:2,deleted:false}]);
  }})).toBe(true);
  expect((await getGoalState()).targets.aerobic).toBe(250);
});
test('a rejected goal response after an account switch cannot mutate either account journal',async()=>{
  const original=mockOwner; let current=true, outgoing;
  const options={owner:original,token:'t',isCurrent:()=>current};
  await setTarget('aerobic',200);
  const error={status:400,code:'invalidAccountData'};
  await expect(synchronizeGoals({...options,send:async(_,body)=>{
    outgoing=body.changes;mockOwner='phone:two';current=false;throw error;
  }})).rejects.toBe(error);
  expect(JSON.parse(await AsyncStorage.getItem(`${original}/goalSettings`)).cloud.inFlight).toEqual(outgoing);
  expect(await AsyncStorage.getItem('phone:two/goalSettings')).toBeNull();
});
test('account usage sums other device counters once while local increments stay independent',async()=>{
  await trackLoginEvent();
  await synchronizeUsage({owner:mockOwner,token:'t',isCurrent:()=>true,send:async(_,body)=>ack(body,[...body.changes.map(x=>({id:x.id,value:x.value,version:1,deleted:false})),{id:'other-device',value:{usageDays:[],loginEvents:3},version:2,deleted:false}])});
  expect((await getUsageStats()).loginEvents).toBe(4);
  await trackLoginEvent();expect((await getUsageStats()).loginEvents).toBe(5);
});
test('language preference round trip preserves per-account ownership',async()=>{
  await saveAccountLanguage('en');
  await synchronizePreferences({owner:mockOwner,token:'t',isCurrent:()=>true,send:async(_,body)=>ack(body,body.changes.map(x=>({id:x.id,value:x.value,deleted:false,version:1})))});
  expect((await getAccountPreferences(mockOwner)).language.locale).toBe('en');
  expect(await getAccountPreferences('phone:two')).toEqual({});
});
test('language changes made after a lost response are rebased after the original request is confirmed',async()=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await saveAccountLanguage('zh');
  await synchronizePreferences({...options,send:async(_,body)=>ack(body,[{id:'language',value:{locale:'zh'},version:1,deleted:false}])});
  await saveAccountLanguage('en');
  let uncertain;
  await expect(synchronizePreferences({...options,send:async(_,body)=>{uncertain=body.changes;throw Error('response lost');}})).rejects.toThrow('response lost');
  await saveAccountLanguage('zh');
  expect(await synchronizePreferences({...options,send:async(_,body)=>{
    expect(body.changes).toEqual(uncertain);
    return ack(body,[{id:'language',value:{locale:'en'},version:2,deleted:false}]);
  }})).toBe(true);
  expect((await getAccountPreferences(mockOwner)).language.locale).toBe('zh');
  expect(await synchronizePreferences({...options,send:async(_,body)=>{
    expect(body.changes[0]).toMatchObject({version:2,value:{locale:'zh'}});
    return ack(body,[{id:'language',value:{locale:'zh'},version:3,deleted:false}]);
  }})).toBe(false);
  expect((await getAccountPreferences(mockOwner)).language.locale).toBe('zh');
});
test('explicit preference validation rejection releases only the old payload and preserves a later edit',async()=>{
  const options={owner:mockOwner,token:'t',isCurrent:()=>true};
  await saveAccountLanguage('en');
  const error={status:400,code:'invalidAccountData'};
  await expect(synchronizePreferences({...options,send:async()=>{await saveAccountLanguage('zh');throw error;}})).rejects.toBe(error);
  expect((await getAccountPreferences(mockOwner)).language.locale).toBe('zh');
  expect(JSON.parse(await AsyncStorage.getItem(`${mockOwner}/accountPreferencesV1`)).cloud.inFlight).toBeUndefined();
  await synchronizePreferences({...options,send:async(_,body)=>{
    expect(body.changes[0].value).toEqual({locale:'zh'});
    return ack(body,[{id:'language',value:{locale:'zh'},version:1,deleted:false}]);
  }});
});
test('remote learning merges without fabricating an upload and preserves genuine local ranges',async()=>{
  const group={parts:[{key:'part',total:100}],ranges:{part:[[0,50]]}};
  await mergeRemoteLearning(mockOwner,[{equipmentId:'1',entry:{version:2,evidence:{read:{g:group}}}}]);
  expect(await getPendingLearningRecords(mockOwner)).toEqual([]);
  await recordLearningCoverage({equipmentId:'1',field:'read',groupKey:'g',parts:group.parts,partKey:'part',start:50,end:80});
  expect((await getLearningProgress())[1].read).toBe(true);
  const pending=await getPendingLearningRecords(mockOwner);
  expect(pending).toHaveLength(1);expect(pending[0].record.entry.evidence.read.g.ranges.part).toEqual([[50,80]]);
  mockOwner='phone:two';expect(await getLearningProgress()).toEqual({});
});

