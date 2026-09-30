import React, { useContext } from 'react';
import { Text, AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocaleProvider, LocaleContext } from '../LocaleContext';
import { getAppTexts } from '../../utils/api';
import { appText, setAppTextOverrides } from '../../utils/appText';

jest.mock('../../utils/api', () => ({ getAppTexts: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn().mockResolvedValue() }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let tree, stateListener, context;
function Probe() { context = useContext(LocaleContext); return <Text>{context.i18n.t('home')}</Text>; }
beforeEach(() => {
  jest.clearAllMocks(); setAppTextOverrides({}); AsyncStorage.getItem.mockResolvedValue(null);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => { stateListener = callback; return { remove: jest.fn() }; });
});
afterEach(async () => { if (tree) { if (context.locale === 'en') await act(async () => context.changeLanguage()); await act(async () => tree.unmount()); } tree = null; jest.restoreAllMocks(); });
const render = async () => { await act(async () => { tree = TestRenderer.create(<LocaleProvider><Probe /></LocaleProvider>); }); };
test('remote public text updates UI and language switching while preserving equipment data', async () => {
  getAppTexts.mockResolvedValue({ version: 1, overrides: { 'copy.home': { zh: '测试首页', en: 'Test home' }, 'copy.equipmentList.0.name': { zh: '不允许覆盖器材' } } });
  await render(); expect(context.i18n.t('home')).toBe('测试首页');
  expect(context.i18n.t('equipmentList')[0].name).not.toBe('不允许覆盖器材');
  await act(async () => context.changeLanguage()); expect(context.i18n.t('home')).toBe('Test home');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('outdoor-fit-app-texts-v1', expect.any(String));
});
test('offline startup restores last valid cache and keeps bundled default for absent entries', async () => {
  AsyncStorage.getItem.mockResolvedValue(JSON.stringify({ version: 1, overrides: { 'copy.home': { zh: '离线首页' } } }));
  getAppTexts.mockRejectedValue(new Error('offline')); await render();
  expect(context.i18n.t('home')).toBe('离线首页'); expect(context.i18n.t('setting')).toBe('設定');
});
test('late cached data cannot overwrite a newer server response', async () => {
  const pendingCache = deferred(); AsyncStorage.getItem.mockReturnValue(pendingCache.promise);
  getAppTexts.mockResolvedValue({ version: 1, overrides: { 'copy.home': { zh: '新值' } } }); await render();
  await act(async () => pendingCache.resolve(JSON.stringify({ version: 1, overrides: { 'copy.home': { zh: '旧缓存' } } })));
  expect(context.i18n.t('home')).toBe('新值');
});
test('foreground refresh applies a reset to bundled defaults', async () => {
  let now = 100000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: { 'copy.home': { zh: '改过的首页' } } }).mockResolvedValueOnce({ version: 1, overrides: {} });
  await render(); expect(context.i18n.t('home')).toBe('改过的首页'); now += 31000;
  await act(async () => stateListener('active')); expect(context.i18n.t('home')).toBe('主頁');
});
test('malformed response cannot replace valid cache or block startup', async () => {
  AsyncStorage.getItem.mockResolvedValue(JSON.stringify({ version: 1, overrides: { 'copy.home': { zh: '缓存' } } }));
  getAppTexts.mockResolvedValue({ error: 'oldServer' }); await render(); expect(context.i18n.t('home')).toBe('缓存');
});
test('unmounted provider ignores a late response', async () => {
  const pending = deferred(); getAppTexts.mockReturnValue(pending.promise); await render();
  await act(async () => tree.unmount()); tree = null;
  await act(async () => pending.resolve({ version: 1, overrides: { 'copy.home': { zh: '迟到值' } } }));
  expect(appText('zh', 'copy.home', { zh: '默认', en: 'Default' })).toBe('默认');
});

test('remote text refreshes keep i18n identity stable and identical overrides do not trigger a new revision', async () => {
  let now = 100000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  const first = { version: 1, overrides: { 'copy.home': { zh: '新首页', en: 'New home' }, 'copy.setting': { zh: '新设置' } } };
  getAppTexts.mockResolvedValue(first);
  await render(); const instance = context.i18n, revision = context.textRevision;
  now += 31000;
  // Property insertion order is not a content change.
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: { 'copy.setting': { zh: '新设置' }, 'copy.home': { en: 'New home', zh: '新首页' } } });
  await act(async () => stateListener('active'));
  expect(context.i18n).toBe(instance); expect(context.textRevision).toBe(revision);
  now += 31000;
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: { 'copy.home': { zh: '再修改首页', en: 'Changed again' } } });
  await act(async () => stateListener('active'));
  expect(context.i18n).toBe(instance); expect(context.textRevision).not.toBe(revision);
  expect(context.i18n.t('home')).toBe('再修改首页'); expect(context.i18n.t('setting')).toBe('設定');
  await act(async () => context.changeLanguage());
  expect(context.i18n).toBe(instance); expect(context.locale).toBe('en'); expect(context.i18n.t('home')).toBe('Changed again');
});

test('reset to defaults replaces the device cache and an offline remount does not revive removed overrides', async () => {
  let now = 100000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  getAppTexts.mockResolvedValueOnce({ version: 1, overrides: { 'copy.home': { zh: '已定制首页' } } }).mockResolvedValueOnce({ version: 1, overrides: {} });
  await render(); now += 31000;
  await act(async () => stateListener('active'));
  const cached = AsyncStorage.setItem.mock.calls.at(-1)[1];
  expect(JSON.parse(cached)).toEqual({ version: 1, overrides: {} });
  await act(async () => tree.unmount()); tree = null;
  AsyncStorage.getItem.mockResolvedValue(cached); getAppTexts.mockRejectedValue(new Error('offline'));
  await render(); expect(context.i18n.t('home')).toBe('主頁');
});
