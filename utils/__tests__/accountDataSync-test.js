import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateJournal, journalBatch, reconcileJournal } from '../accountSyncJournal';
import { loadAssistantConversations, storeAssistantConversation, synchronizeAssistantConversations, listAssistantConversations } from '../assistantConversations';
import { synchronizeGoals, getGoalState, setTarget } from '../goals';
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

