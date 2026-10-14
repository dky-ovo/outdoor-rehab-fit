import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../AuthContext';
import AccountDataSync from '../../components/AccountDataSync';
import { AUTH_INACTIVITY_LIMIT_MS, AUTH_STORAGE_KEY } from '../../constants/auth';
import { getCurrentUser, getOwnLearningProgress, loginAccount, syncAccountBookmarks } from '../../utils/api';
import { clearCurrentOwner, getOwnerKey, userDataKey } from '../../utils/userStorage';
import { getBookmarks, saveBookmarks } from '../../utils/bookmarks';
import { synchronizeAssistantConversations } from '../../utils/assistantConversations';
import { synchronizeGoals } from '../../utils/goals';
import { synchronizeUsage } from '../../utils/usage';
import { getSessions } from '../../utils/sessions';
import { getAccountSyncStatus } from '../../utils/accountSyncStatus';

// Use the real auth, owner namespace, bookmark journal and root sync worker.
// Network and unrelated collection implementations are the test boundaries.
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../LocaleContext', () => ({ LocaleContext: require('react').createContext({ locale: 'zh', applyAccountLanguage: jest.fn() }) }));
jest.mock('../../utils/api', () => ({
  getCurrentUser: jest.fn(), loginAccount: jest.fn(), registerAccount: jest.fn(), registerGuestProfile: jest.fn(), updateCurrentUser: jest.fn(),
  syncAccountBookmarks: jest.fn(), syncAccountDocuments: jest.fn(), getOwnLearningProgress: jest.fn(),
}));
jest.mock('../../utils/assistantConversations', () => ({ ...jest.requireActual('../../utils/assistantConversations'), synchronizeAssistantConversations: jest.fn() }));
jest.mock('../../utils/goals', () => ({ synchronizeGoals: jest.fn() }));
jest.mock('../../utils/usage', () => ({ ensureFirstLoginEvent: jest.fn(), trackLoginEvent: jest.fn(), synchronizeUsage: jest.fn() }));
jest.mock('../../utils/accountPreferences', () => ({ synchronizePreferences: jest.fn(async () => false), getAccountPreferences: jest.fn(async () => ({})) }));
jest.mock('../../utils/learning', () => ({ getPendingLearningRecords: jest.fn(async () => []), mergeRemoteLearning: jest.fn() }));
jest.mock('../../utils/learningSync', () => ({ createLearningSync: () => ({ flush: async () => {}, dispose: () => {} }) }));
jest.mock('../../utils/sessions', () => ({ getSessions: jest.fn(async () => []) }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map();
  return {
    getItem: jest.fn(async key => data.get(key) ?? null),
    setItem: jest.fn(async (key, value) => data.set(key, value)),
    removeItem: jest.fn(async key => data.delete(key)),
    multiRemove: jest.fn(async keys => keys.forEach(key => data.delete(key))),
    getAllKeys: jest.fn(async () => [...data.keys()]), __data: data,
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const start = new Date('2026-10-07T00:00:00Z').getTime();
let auth, tree, session, number = 0, listeners;
function Probe() { auth = useAuth(); return null; }
async function mount() { await act(async () => { tree = renderer.create(<AuthProvider><AccountDataSync /><Probe /></AuthProvider>); }); }
async function advance(ms) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function login() { await act(async () => { expect(await auth.login('test-account', 'test-password')).toEqual({ success: true }); }); }
beforeEach(async () => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(start);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  await clearCurrentOwner(); AsyncStorage.__data.clear(); listeners = new Set();
  session = { id: `auto-sync-${++number}`, phone: `6123456${number}`, name: 'Sync fixture', role: 'user', token: 'same-jwt', assistantSessionId: 'restored-session', lastActivity: start, loginEventRecordedAt: 'recorded' };
  loginAccount.mockReset().mockResolvedValue({ user: session, token: session.token });
  getCurrentUser.mockReset().mockResolvedValue({ user: session });
  syncAccountBookmarks.mockReset().mockResolvedValue({ records: [], acknowledged: [] });
  synchronizeAssistantConversations.mockReset().mockResolvedValue(false);
  synchronizeGoals.mockReset().mockResolvedValue(false);
  synchronizeUsage.mockReset().mockResolvedValue(false);
  getOwnLearningProgress.mockReset().mockResolvedValue({ items: [], totalPages: 1 });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; await clearCurrentOwner(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('every successful login pulls all account collections, including a same-account same-token relogin', async () => {
  await mount(); await advance(5000);
  expect(syncAccountBookmarks).not.toHaveBeenCalled();
  await login();
  expect(auth.ready).toBe(true);
  const firstSession = auth.user.assistantSessionId;
  await advance(750);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(1);
  expect(synchronizeAssistantConversations.mock.calls.map(([options]) => `${options.provider || 'deepseek'}:${options.locale}`))
    .toEqual(['deepseek:zh', 'deepseek:en', 'bailian:zh', 'bailian:en']);
  expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  expect(getSessions).toHaveBeenCalledTimes(1);
  expect(getOwnLearningProgress).toHaveBeenCalledTimes(1);
  const firstScope = synchronizeGoals.mock.calls[0][0];
  await act(async () => auth.logout());
  expect(firstScope.isCurrent()).toBe(false);
  await login();
  expect(auth.user.token).toBe(session.token);
  expect(auth.user.assistantSessionId).not.toBe(firstSession);
  await advance(750);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(2);
  expect(synchronizeAssistantConversations.mock.calls.map(([options]) => `${options.provider || 'deepseek'}:${options.locale}`))
    .toEqual(['deepseek:zh', 'deepseek:en', 'bailian:zh', 'bailian:en', 'deepseek:zh', 'deepseek:en', 'bailian:zh', 'bailian:en']);
  expect(synchronizeGoals).toHaveBeenCalledTimes(2);
  expect(getSessions).toHaveBeenCalledTimes(2);
  expect(getOwnLearningProgress).toHaveBeenCalledTimes(2);
});

test('login keeps an offline bookmark visible; retry resumes after relogin and merges another device without a manual trigger', async () => {
  await mount(); await login();
  const owner = getOwnerKey(auth.user);
  await act(async () => saveBookmarks({ '1': true }, { changedIds: ['1'] }));
  expect(await getBookmarks()).toEqual({ '1': true });
  syncAccountBookmarks.mockRejectedValueOnce(Error('offline'));
  await advance(750);
  const firstBatch = syncAccountBookmarks.mock.calls[0][1];
  expect(firstBatch).toHaveLength(1);
  expect(firstBatch[0]).toMatchObject({ id: '1', selected: true });
  expect(synchronizeAssistantConversations).toHaveBeenCalledTimes(4);
  expect(synchronizeGoals).toHaveBeenCalledTimes(1);
  expect(getOwnLearningProgress).toHaveBeenCalledTimes(1);
  expect(getAccountSyncStatus(owner).state).toBe('pending');
  await act(async () => auth.logout());
  expect(JSON.parse(AsyncStorage.__data.get(userDataKey('bookmarkedItems', owner))).pending['1']).toBeDefined();
  syncAccountBookmarks.mockRejectedValueOnce(Error('still offline')).mockImplementation(async (_token, changes) => ({
    records: [{ id: '1', selected: true, version: 1 }, { id: '2', selected: true, version: 2 }],
    acknowledged: changes.map(({ id, operationId }) => ({ id, operationId })),
  }));
  await login(); await advance(750);
  expect(await getBookmarks()).toEqual({ '1': true });
  expect(syncAccountBookmarks.mock.calls[1][1]).toEqual(firstBatch);
  await advance(4999);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(3);
  expect(syncAccountBookmarks.mock.calls[2][1]).toEqual(firstBatch);
  expect(await getBookmarks()).toEqual({ '1': true, '2': true });
  expect(JSON.parse(AsyncStorage.__data.get(userDataKey('bookmarkedItems', owner))).pending).toEqual({});
  expect(getAccountSyncStatus(owner).state).toBe('synced');
});

test('restored login sync and periodic refresh do not extend the ninety-minute inactivity deadline', async () => {
  const lastActivity = start - AUTH_INACTIVITY_LIMIT_MS + 60000;
  AsyncStorage.__data.set(AUTH_STORAGE_KEY, JSON.stringify({ ...session, lastActivity }));
  await mount();
  expect(auth.ready).toBe(true);
  await advance(750);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(1);
  await advance(30000);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(2);
  expect(JSON.parse(AsyncStorage.__data.get(AUTH_STORAGE_KEY)).lastActivity).toBe(lastActivity);
  await advance(29249);
  expect(auth.user.id).toBe(session.id);
  await advance(1);
  expect(auth.user).toBeNull();
  expect(AsyncStorage.__data.has(AUTH_STORAGE_KEY)).toBe(false);
  const calls = syncAccountBookmarks.mock.calls.length;
  await advance(60000);
  expect(syncAccountBookmarks).toHaveBeenCalledTimes(calls);
});
