import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBookmarks, saveBookmarks, synchronizeBookmarks } from '../bookmarks';
import { beginAssistantJob, resumeAssistantJobs, pendingAssistantJobs } from '../assistantJobs';
import { loadAssistantConversations, startNewAssistantConversation, listAssistantConversations, storeAssistantConversation } from '../assistantConversations';
import { createAssistantJob, getAssistantJob } from '../api';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockOwner='phone:one';
jest.mock('../userStorage', () => ({ getCurrentOwnerKey: () => mockOwner, restoreCurrentOwnerKey: async () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
jest.mock('../api', () => ({ createAssistantJob:jest.fn(),getAssistantJob:jest.fn() }));
let account=0;
beforeEach(async()=>{await AsyncStorage.clear(); jest.clearAllMocks(); mockOwner=`phone:${++account}`;});
const sync = send => synchronizeBookmarks({owner:mockOwner,token:'token',send});
test('local favorites migrate to cloud, cloud removals stay removed and a new device pulls data',async()=>{
  await saveBookmarks({9:true});
  const send=jest.fn(async(_token,changes)=>({acknowledged:changes,records:[{id:'9',selected:false,version:2},{id:'18',selected:true,version:1}]}));
  await sync(send);
  expect(send.mock.calls[0][1][0]).toMatchObject({id:'9',selected:true,version:null});
  expect(await getBookmarks()).toEqual({18:true});
  await sync(send); expect(send.mock.calls[1][1]).toEqual([]);
  mockOwner='phone:new-device'; await sync(send); expect(await getBookmarks()).toEqual({18:true});
});
test('an offline local toggle during upload survives the older acknowledgment',async()=>{
  await saveBookmarks({9:true}); let finish;
  const upload=sync((_token,changes)=>new Promise(resolve=>{finish=()=>resolve({acknowledged:changes,records:[{id:'9',selected:true,version:1}]});}));
  while(!finish) await Promise.resolve();
  await saveBookmarks({}); finish(); await upload;
  expect(await getBookmarks()).toEqual({});
  const next=jest.fn(async(_token,changes)=>({acknowledged:changes,records:[{id:'9',selected:false,version:2}]}));
  await sync(next); expect(next.mock.calls[0][1][0]).toMatchObject({id:'9',selected:false,version:1});
});
test('a response for the signed-out owner cannot populate the next account',async()=>{
  await saveBookmarks({9:true}); let finish;
  const upload=sync((_token,changes)=>new Promise(resolve=>{finish=()=>resolve({acknowledged:changes,records:[{id:'9',selected:true,version:1}]});}));
  while(!finish) await Promise.resolve(); mockOwner='phone:other'; finish(); await upload;
  expect(await getBookmarks()).toEqual({});
});
test('toggling one heart from a stale screen cannot remove another device favorite',async()=>{
  await saveBookmarks({9:true});
  await sync(async(_token,changes)=>({acknowledged:changes,records:[{id:'9',selected:true,version:1},{id:'18',selected:true,version:1}]}));
  await saveBookmarks({}, {changedIds:['9']});
  expect(await getBookmarks()).toEqual({18:true});
});

test('a committed favorites request with a lost reply is retried before a later toggle',async()=>{
  await saveBookmarks({9:true});
  let lost;
  await expect(sync(async(_token,changes)=>{lost=changes;throw Error('reply lost after commit');})).rejects.toThrow('reply lost');
  await saveBookmarks({}, {changedIds:['9']});
  expect(await sync(async(_token,changes)=>{
    expect(changes).toEqual(lost);
    return {acknowledged:changes,records:[{id:'9',selected:true,version:1}]};
  })).toBe(true);
  expect(await getBookmarks()).toEqual({});
  expect(await sync(async(_token,changes)=>{
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({id:'9',selected:false,version:1});
    return {acknowledged:changes,records:[{id:'9',selected:false,version:2}]};
  })).toBe(false);
  expect(await getBookmarks()).toEqual({});
});
test('AI result is recovered after page exit into its original archived conversation exactly once',async()=>{
  const scope={owner:'alice',locale:'zh',authSessionId:'session-one'};
  const conversation=await loadAssistantConversations(scope);
  createAssistantJob.mockResolvedValue({status:'queued'});
  const id=await beginAssistantJob({scope,conversationId:conversation.conversationId,request:{message:'question'},token:'token'});
  const newer=await startNewAssistantConversation(scope);
  getAssistantJob.mockResolvedValue({status:'complete',result:{reply:'answer',action:'chat'}});
  await resumeAssistantJobs({owner:'alice',token:'token'}); await resumeAssistantJobs({owner:'alice',token:'token'});
  expect(await pendingAssistantJobs('alice')).toEqual([]);
  const archive=await listAssistantConversations(scope);
  const old=archive.history.find(x=>x.id===conversation.conversationId);
  expect(old.messages.map(x=>x.id)).toEqual([`${id}-user`,`${id}-answer`]);
  expect((await loadAssistantConversations(scope)).conversationId).toBe(newer.conversationId);
});
test('lost POST reply retries same id; stale page save cannot erase a completed reply',async()=>{
  const scope={owner:'bob',locale:'en',authSessionId:'session-one'}, conversation=await loadAssistantConversations(scope);
  createAssistantJob.mockRejectedValueOnce({code:'networkError',status:0});
  const id=await beginAssistantJob({scope,conversationId:conversation.conversationId,request:{message:'question'},token:'token'});
  createAssistantJob.mockResolvedValue({status:'complete',result:{reply:'answer'}});
  await resumeAssistantJobs({owner:'bob',token:'token'});
  expect(createAssistantJob.mock.calls.slice(-2).map(x=>x[1])).toEqual([id,id]);
  await storeAssistantConversation({...scope,conversationId:conversation.conversationId,messages:[]});
  expect((await loadAssistantConversations(scope)).messages.map(x=>x.text||x.reply)).toEqual(['question','answer']);
});
