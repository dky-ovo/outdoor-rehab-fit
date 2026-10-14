import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import AccountDataSync from '../AccountDataSync';
import { synchronizeAssistantConversations } from '../../utils/assistantConversations';
import { synchronizeGoals } from '../../utils/goals';
import { synchronizeUsage } from '../../utils/usage';
import { getAccountSyncStatus, retryAccountSync } from '../../utils/accountSyncStatus';
import { notifyAccountData } from '../../utils/accountSyncEvents';
import { getOwnLearningProgress } from '../../utils/api';
import { getPendingLearningRecords, mergeRemoteLearning } from '../../utils/learning';
import { synchronizeBookmarks } from '../../utils/bookmarks';
let mockAuth, mockOwner, mockApply, mockLearningFlush;
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>mockAuth}));
jest.mock('../../contexts/LocaleContext',()=>({LocaleContext:require('react').createContext({applyAccountLanguage:value=>mockApply(value)})}));
jest.mock('../../utils/userStorage',()=>({getOwnerKey:user=>user.owner,getCurrentOwnerKey:()=>mockOwner}));
jest.mock('../../utils/api',()=>({syncAccountDocuments:jest.fn(),getOwnLearningProgress:jest.fn(async()=>({items:[],totalPages:1}))}));
jest.mock('../../utils/assistantConversations',()=>({synchronizeAssistantConversations:jest.fn(async()=>false)}));
jest.mock('../../utils/goals',()=>({synchronizeGoals:jest.fn(async()=>false)}));
jest.mock('../../utils/usage',()=>({synchronizeUsage:jest.fn(async()=>false)}));
jest.mock('../../utils/accountPreferences',()=>({synchronizePreferences:jest.fn(async()=>false),getAccountPreferences:jest.fn(async()=>({language:{locale:'en'}}))}));
jest.mock('../../utils/learning',()=>({mergeRemoteLearning:jest.fn(),getPendingLearningRecords:jest.fn(async()=>[])}));
jest.mock('../../utils/learningSync',()=>({createLearningSync:()=>({flush:()=>mockLearningFlush(),dispose:()=>{}})}));
jest.mock('../../utils/sessions',()=>({getSessions:jest.fn(async()=>[])}));
let mockBookmarkChanged;
jest.mock('../../utils/bookmarks',()=>({synchronizeBookmarks:jest.fn(async()=>false),subscribeBookmarkChanges:listener=>{mockBookmarkChanged=listener;return()=>{};}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let tree, stateChanged;
beforeEach(()=>{
  jest.useFakeTimers();jest.clearAllMocks();mockOwner='phone:1';mockApply=jest.fn();
  jest.spyOn(Math,'random').mockReturnValue(0);
  synchronizeGoals.mockResolvedValue(false);
  synchronizeAssistantConversations.mockResolvedValue(false);
  synchronizeUsage.mockResolvedValue(false);
  synchronizeBookmarks.mockResolvedValue(false);
  mockLearningFlush=jest.fn(async()=>{});
  getOwnLearningProgress.mockResolvedValue({items:[],totalPages:1});
  getPendingLearningRecords.mockResolvedValue([]);
  mockAuth={user:{id:'alice',owner:mockOwner,token:'token',assistantSessionId:'session'},isGuest:false,isLoading:false};
  AppState.currentState='active';jest.spyOn(AppState,'addEventListener').mockImplementation((_,callback)=>{stateChanged=callback;return{remove(){}};});
});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;jest.useRealTimers();jest.restoreAllMocks();});
const advance=async ms=>{await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});};
const mount=async()=>{await act(async()=>{tree=renderer.create(<AccountDataSync/>);});await advance(750);};
test('login pulls both histories off-screen and applies account language without blocking a view',async()=>{
  await mount();expect(tree.toJSON()).toBeNull();expect(synchronizeAssistantConversations.mock.calls.map(x=>[x[0].provider || 'deepseek', x[0].locale])).toEqual([['deepseek','zh'],['deepseek','en'],['bailian','zh'],['bailian','en']]);
  expect(mockApply).toHaveBeenCalledWith('en');expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});
test('one provider collection failing cannot block other provider histories or account collections', async () => {
  synchronizeAssistantConversations.mockImplementation(async options => {
    if (options.provider === 'bailian' && options.locale === 'zh') throw Error('temporarily unavailable');
    return false;
  });
  await mount();
  expect(synchronizeAssistantConversations.mock.calls.map(([options]) => `${options.provider || 'deepseek'}:${options.locale}`))
    .toEqual(['deepseek:zh', 'deepseek:en', 'bailian:zh', 'bailian:en']);
  expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  synchronizeAssistantConversations.mockResolvedValue(false);
  await advance(5000);
  expect(synchronizeAssistantConversations.mock.calls.at(-1)[0]).toMatchObject({ provider: 'bailian', locale: 'zh' });
  expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});
test('offline errors stay visible; retry succeeds; background does not poll',async()=>{
  synchronizeGoals.mockRejectedValueOnce(Error('offline'));await mount();expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  await act(async()=>retryAccountSync(mockOwner));await advance(0);expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
  const n=synchronizeGoals.mock.calls.length;
  await act(async()=>{AppState.currentState='background';stateChanged('background');jest.advanceTimersByTime(60000);});
  expect(synchronizeGoals).toHaveBeenCalledTimes(n);
  await act(async()=>{AppState.currentState='active';stateChanged('active');});await advance(1500);expect(synchronizeGoals).toHaveBeenCalledTimes(n+1);
});
test('edits schedule another pass but cloud view notifications do not echo; sign-out invalidates in-flight scope',async()=>{
  await mount();const options=synchronizeGoals.mock.calls[0][0];
  await act(async()=>{notifyAccountData(mockOwner,'goals',true);jest.advanceTimersByTime(1000);});expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  await act(async()=>notifyAccountData(mockOwner,'goals'));await advance(1500);expect(synchronizeGoals).toHaveBeenCalledTimes(2);
  expect(synchronizeAssistantConversations).toHaveBeenCalledTimes(4);
  mockAuth={user:null,isLoading:false,isGuest:false};mockOwner=null;await act(async()=>tree.update(<AccountDataSync/>));expect(options.isCurrent()).toBe(false);
});
test('retained learning uploads do not block downloading every page and keep the account pending',async()=>{
  getPendingLearningRecords.mockResolvedValue([{key:'removed-equipment'}]);
  const first=[{equipmentId:'1'}],second=[{equipmentId:'2'}];
  getOwnLearningProgress.mockResolvedValueOnce({items:first,totalPages:2}).mockResolvedValueOnce({items:second,totalPages:2});
  await mount();
  expect(getOwnLearningProgress.mock.calls).toEqual([['token',1],['token',2]]);
  expect(mergeRemoteLearning.mock.calls.map(([owner,items])=>({owner,items}))).toEqual([{owner:mockOwner,items:first},{owner:mockOwner,items:second}]);
  expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
});
test('a failed learning upload still permits downloading and merging available progress',async()=>{
  mockLearningFlush.mockRejectedValueOnce(Error('upload unavailable'));
  const items=[{equipmentId:'remote-progress'}];
  getOwnLearningProgress.mockResolvedValueOnce({items,totalPages:1});
  await mount();
  expect(mergeRemoteLearning).toHaveBeenCalledWith(mockOwner,items,expect.any(Function));
  expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  await act(async()=>retryAccountSync(mockOwner));await advance(0);
  expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});
test('a learning download completing after an account switch cannot merge into either account',async()=>{
  let finish;
  getOwnLearningProgress.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  await mount();
  const oldOwner=mockOwner;
  mockOwner='phone:2';
  mockAuth={user:{id:'bob',owner:mockOwner,token:'new-token',assistantSessionId:'new-session'},isGuest:false,isLoading:false};
  await act(async()=>tree.update(<AccountDataSync/>));
  await advance(750);
  const mergedBefore=mergeRemoteLearning.mock.calls.length;
  await act(async()=>finish({items:[{equipmentId:'old-account-only'}],totalPages:2}));
  expect(mergeRemoteLearning).toHaveBeenCalledTimes(mergedBefore);
  expect(mergeRemoteLearning.mock.calls.every(([owner])=>owner!==oldOwner)).toBe(true);
  expect(getOwnLearningProgress).not.toHaveBeenCalledWith('token',2);
  expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});

test('login sync jobs start sequentially, and one failed collection does not stop the others',async()=>{
  let finish;
  synchronizeAssistantConversations.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  synchronizeGoals.mockRejectedValueOnce(Error('server unavailable'));
  await mount();
  expect(synchronizeAssistantConversations).toHaveBeenCalledTimes(1);
  expect(synchronizeGoals).not.toHaveBeenCalled();
  expect(getOwnLearningProgress).not.toHaveBeenCalled();
  await act(async()=>finish(false));
  expect(synchronizeAssistantConversations).toHaveBeenCalledTimes(4);
  expect(synchronizeUsage).toHaveBeenCalledTimes(1);
  expect(getOwnLearningProgress).toHaveBeenCalledTimes(1);
  expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  await advance(5000);
  expect(synchronizeGoals).toHaveBeenCalledTimes(2);
  expect(synchronizeUsage).toHaveBeenCalledTimes(1);
  expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});

test('edits arriving during a sync are retained for one later pass without overlapping jobs',async()=>{
  await mount();
  let finish;
  synchronizeGoals.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>notifyAccountData(mockOwner,'goals'));await advance(1500);
  await act(async()=>{for(let i=0;i<50;i++) notifyAccountData(mockOwner,'goals');});
  await advance(3000);
  expect(synchronizeGoals).toHaveBeenCalledTimes(2);
  await act(async()=>finish(false));await advance(1500);
  expect(synchronizeGoals).toHaveBeenCalledTimes(3);
  expect(synchronizeAssistantConversations).toHaveBeenCalledTimes(4);
});

test('background pauses a queued edit and foreground resumes it',async()=>{
  await mount();
  await act(async()=>{notifyAccountData(mockOwner,'goals');AppState.currentState='background';stateChanged('background');});
  await advance(60000);expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  await act(async()=>{AppState.currentState='active';stateChanged('active');});await advance(1500);
  expect(synchronizeGoals).toHaveBeenCalledTimes(2);
});

test('a failed favorites upload cannot report all account records synced; manual retry includes favorites',async()=>{
  synchronizeBookmarks.mockRejectedValueOnce(Error('offline'));
  await mount();
  expect(synchronizeBookmarks).toHaveBeenCalledTimes(1);
  expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  await act(async()=>retryAccountSync(mockOwner));await advance(0);
  expect(synchronizeBookmarks).toHaveBeenCalledTimes(2);
  expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});

test('favorites edited during upload immediately get a later pass, while remote cache events do not echo',async()=>{
  await mount();let finish;
  synchronizeBookmarks.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>mockBookmarkChanged(mockOwner));await advance(1500);
  await act(async()=>mockBookmarkChanged(mockOwner));
  await act(async()=>finish(true));await advance(1500);
  expect(synchronizeBookmarks).toHaveBeenCalledTimes(3);
  await act(async()=>mockBookmarkChanged(mockOwner,{remote:true}));await advance(1500);
  expect(synchronizeBookmarks).toHaveBeenCalledTimes(3);
});
