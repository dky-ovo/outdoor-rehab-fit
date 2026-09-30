import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { useAssistantReplySpeech } from '../useAssistantReplySpeech';
import { setAssistantMicrophoneActive, stopAssistantReaders } from '../../utils/assistantAudioCoordination';

let mockNative, mockAppStateListener;
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockNative }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: {
  currentState: 'active',
  addEventListener: jest.fn((event, callback) => { mockAppStateListener = callback; return { remove: jest.fn() }; }),
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const microphone = {};
let current, tree, listeners;
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function Harness(props) { current = useAssistantReplySpeech(props); return null; }
const mount = async (props = {}) => act(async () => { tree = create(<Harness locale="zh" enabled {...props} />); await flush(); });
const update = async (props = {}) => act(async () => { tree.update(<Harness locale="zh" enabled {...props} />); await flush(); });
const emit = async event => act(async () => { for (const fn of [...listeners]) fn(event); await flush(); });
const state = async next => act(async () => { AppState.currentState = next; mockAppStateListener(next); await flush(); });
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); listeners = new Set(); Platform.OS = 'android'; AppState.currentState = 'active';
  setAssistantMicrophoneActive(microphone, false);
  mockNative = { speakReplyAsync: jest.fn(async () => {}), stopReplyAsync: jest.fn(async () => {}),
    addListener: jest.fn((event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; }),
  };
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); await flush(); }); tree = null;
  setAssistantMicrophoneActive(microphone, false); jest.clearAllTimers(); jest.useRealTimers();
});

test('mount never speaks automatically; explicit reads select Cantonese and English per locale', async () => {
  await mount(); expect(current.autoRead).toBe(true); expect(mockNative.speakReplyAsync).not.toHaveBeenCalled();
  await act(async () => { expect(await current.read('zh', '你好')).toBe(true); });
  expect(mockNative.speakReplyAsync.mock.calls.at(-1).slice(1)).toEqual(['你好', 'zh-HK']);
  await update({ locale: 'en' });
  await act(async () => { expect(await current.read('en', 'Hello')).toBe(true); });
  expect(mockNative.speakReplyAsync.mock.calls.at(-1).slice(1)).toEqual(['Hello', 'en-US']);
});

test.each(['background', 'inactive'])('leaving the foreground (%s) stops and rejects late answers without replay', async next => {
  await mount(); await act(async () => { await current.read('active', '回答'); });
  const id = mockNative.speakReplyAsync.mock.calls.at(-1)[0];
  await state(next);
  expect(current.status).toBe('idle');
  expect(await current.read('late', '不應播放')).toBe(false);
  await emit({ id, status: 'speaking' });
  expect(current.status).toBe('idle');
  await state('active');
  expect(mockNative.speakReplyAsync).toHaveBeenCalledTimes(1);
});

test('initially background screen never reads a newly arriving answer', async () => {
  AppState.currentState = 'background'; await mount();
  expect(await current.read('id', 'Hello')).toBe(false);
  expect(mockNative.speakReplyAsync).not.toHaveBeenCalled();
});

test('disabled screen cancels pending cancellation handshake and ignores late speech events', async () => {
  let release;
  mockNative.stopReplyAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await mount(); let pending;
  await act(async () => { pending = current.read('pending', 'Hello'); await flush(); });
  await update({ enabled: false });
  await act(async () => { release(); expect(await pending).toBe(false); });
  expect(mockNative.speakReplyAsync).not.toHaveBeenCalled();
  expect(await current.read('disabled', 'Hello')).toBe(false);
});

test('background during a pending native cancellation handshake cannot begin reading later', async () => {
  let release; mockNative.stopReplyAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await mount(); let pending;
  await act(async () => { pending = current.read('id', 'Hello'); await flush(); });
  await state('background');
  await act(async () => { release(); expect(await pending).toBe(false); });
  expect(mockNative.speakReplyAsync).not.toHaveBeenCalled();
});

test('turning auto-read off stops current speech but still permits an explicit replay button', async () => {
  await mount(); await act(async () => { await current.read('id', 'Hello'); });
  await act(async () => { current.setAutoRead(false); await flush(); });
  expect(current.autoRead).toBe(false); expect(current.status).toBe('idle');
  await act(async () => { expect(await current.read('manual', 'Replay')).toBe(true); });
  expect(mockNative.speakReplyAsync).toHaveBeenCalledTimes(2);
});

test('locale change disposes the previous listener and stale callbacks cannot alter the new reader', async () => {
  await mount(); await act(async () => { await current.read('old', '你好'); });
  const oldId = mockNative.speakReplyAsync.mock.calls.at(-1)[0]; const oldListener = [...listeners][0];
  await update({ locale: 'en' }); await act(async () => { await current.read('new', 'Hello'); });
  await act(async () => { oldListener({ id: oldId, status: 'idle', errorCode: 'voiceUnavailable' }); await flush(); });
  expect(current).toMatchObject({ status: 'loading', activeMessageId: 'new', errorCode: null });
  expect(listeners.size).toBe(1);
});

test('microphone and playback remain mutually exclusive across the hook boundary', async () => {
  await mount(); setAssistantMicrophoneActive(microphone, true);
  expect(await current.read('blocked', 'Hello')).toBe(false);
  setAssistantMicrophoneActive(microphone, false);
  await act(async () => { await current.read('active', 'Hello'); });
  await act(async () => { setAssistantMicrophoneActive(microphone, true); await stopAssistantReaders(); });
  expect(current.status).toBe('idle');
  expect(await current.read('blocked-again', 'Hello')).toBe(false);
});

test.each(['web', 'android'])('%s missing native support reports text-only fallback without throwing', async platform => {
  Platform.OS = platform; mockNative = null; await mount();
  await act(async () => { expect(await current.read('id', 'Hello')).toBe(false); });
  expect(current.errorCode).toBe('missingNativeModule');
});

test('missing installed voice surfaces a recoverable error while preserving idle state', async () => {
  await mount(); await act(async () => { await current.read('id', '你好'); });
  const id = mockNative.speakReplyAsync.mock.calls.at(-1)[0];
  await emit({ id, status: 'idle', errorCode: 'voiceUnavailable' });
  expect(current).toMatchObject({ status: 'idle', activeMessageId: null, errorCode: 'voiceUnavailable' });
});

test('unmount removes app-state and speech listeners and late work cannot restart audio', async () => {
  let release; mockNative.stopReplyAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(undefined);
  await mount(); let pending;
  await act(async () => { pending = current.read('id', 'Hello'); await flush(); });
  const subscription = AppState.addEventListener.mock.results.at(-1).value;
  await act(async () => { tree.unmount(); tree = null; await flush(); });
  release(); expect(await pending).toBe(false);
  expect(mockNative.speakReplyAsync).not.toHaveBeenCalled();
  expect(subscription.remove).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
});
