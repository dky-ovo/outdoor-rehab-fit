import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import AccountDataSync from '../AccountDataSync';
import { synchronizeAssistantConversations } from '../../utils/assistantConversations';
import { synchronizeGoals } from '../../utils/goals';
import { getAccountSyncStatus, retryAccountSync } from '../../utils/accountSyncStatus';
import { notifyAccountData } from '../../utils/accountSyncEvents';
let mockAuth, mockOwner, mockApply;
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>mockAuth}));
jest.mock('../../contexts/LocaleContext',()=>({LocaleContext:require('react').createContext({applyAccountLanguage:value=>mockApply(value)})}));
jest.mock('../../utils/userStorage',()=>({getOwnerKey:user=>user.owner,getCurrentOwnerKey:()=>mockOwner}));
jest.mock('../../utils/api',()=>({syncAccountDocuments:jest.fn(),getOwnLearningProgress:jest.fn(async()=>({items:[],totalPages:1}))}));
jest.mock('../../utils/assistantConversations',()=>({synchronizeAssistantConversations:jest.fn(async()=>false)}));
jest.mock('../../utils/goals',()=>({synchronizeGoals:jest.fn(async()=>false)}));
jest.mock('../../utils/usage',()=>({synchronizeUsage:jest.fn(async()=>false)}));
jest.mock('../../utils/accountPreferences',()=>({synchronizePreferences:jest.fn(async()=>false),getAccountPreferences:jest.fn(async()=>({language:{locale:'en'}}))}));
jest.mock('../../utils/learning',()=>({mergeRemoteLearning:jest.fn(),getPendingLearningRecords:jest.fn(async()=>[])}));
jest.mock('../../utils/learningSync',()=>({createLearningSync:()=>({flush:async()=>{},dispose:()=>{}})}));
jest.mock('../../utils/sessions',()=>({getSessions:jest.fn(async()=>[])}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let tree, stateChanged;
beforeEach(()=>{
  jest.useFakeTimers();jest.clearAllMocks();mockOwner='phone:1';mockApply=jest.fn();
  mockAuth={user:{id:'alice',owner:mockOwner,token:'token',assistantSessionId:'session'},isGuest:false,isLoading:false};
  AppState.currentState='active';jest.spyOn(AppState,'addEventListener').mockImplementation((_,callback)=>{stateChanged=callback;return{remove(){}};});
});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;jest.useRealTimers();jest.restoreAllMocks();});
const mount=async()=>{await act(async()=>{tree=renderer.create(<AccountDataSync/>);});};
test('login pulls both histories off-screen and applies account language without blocking a view',async()=>{
  await mount();expect(tree.toJSON()).toBeNull();expect(synchronizeAssistantConversations.mock.calls.map(x=>x[0].locale)).toEqual(['zh','en']);
  expect(mockApply).toHaveBeenCalledWith('en');expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
});
test('offline errors stay visible; retry succeeds; background does not poll',async()=>{
  synchronizeGoals.mockRejectedValueOnce(Error('offline'));await mount();expect(getAccountSyncStatus(mockOwner).state).toBe('pending');
  await act(async()=>retryAccountSync(mockOwner));expect(getAccountSyncStatus(mockOwner).state).toBe('synced');
  const n=synchronizeGoals.mock.calls.length;
  await act(async()=>{AppState.currentState='background';stateChanged('background');jest.advanceTimersByTime(60000);});
  expect(synchronizeGoals).toHaveBeenCalledTimes(n);
  await act(async()=>{AppState.currentState='active';stateChanged('active');});expect(synchronizeGoals).toHaveBeenCalledTimes(n+1);
});
test('edits schedule another pass but cloud view notifications do not echo; sign-out invalidates in-flight scope',async()=>{
  await mount();const options=synchronizeGoals.mock.calls[0][0];
  await act(async()=>{notifyAccountData(mockOwner,'goals',true);jest.advanceTimersByTime(1000);});expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  await act(async()=>{notifyAccountData(mockOwner,'goals');jest.advanceTimersByTime(1000);});expect(synchronizeGoals).toHaveBeenCalledTimes(2);
  mockAuth={user:null,isLoading:false,isGuest:false};mockOwner=null;await act(async()=>tree.update(<AccountDataSync/>));expect(options.isCurrent()).toBe(false);
});
