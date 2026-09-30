import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { useAssistantVoiceInput } from '../useAssistantVoiceInput';
import { ensurePlaybackAudioMode } from '../../utils/audioMode';
import { isAssistantMicrophoneActive, registerAssistantReader } from '../../utils/assistantAudioCoordination';

let mockNativeModule, mockAppStateCallback, mockApplication;
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: name => name === 'ExpoApplication' ? mockApplication : mockNativeModule }));
jest.mock('../../utils/audioMode', () => ({ ensurePlaybackAudioMode: jest.fn(async () => {}) }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: {
  addEventListener: jest.fn((event, callback) => { mockAppStateCallback = callback; return { remove: jest.fn() }; }),
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let current, tree, listeners, transcript;
const readerUnregister = [];
function Harness(props) { current = useAssistantVoiceInput(props); return null; }
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const mount = async (props = {}) => act(async () => {
  tree = create(<Harness locale="zh" enabled onTranscript={transcript} {...props} />);
});
const update = async (props = {}) => act(async () => {
  tree.update(<Harness locale="zh" enabled onTranscript={transcript} {...props} />); await tick();
});
beforeEach(() => {
  jest.clearAllMocks(); listeners = new Map(); transcript = jest.fn(); Platform.OS = 'android';
  mockApplication = { nativeApplicationVersion: '1.2.0', nativeBuildVersion: '14' };
  mockNativeModule = { getStatus: jest.fn(() => ({ available: true, modelAvailable: true })),
    requestPermissionAsync: jest.fn(async () => true), readyAsync: jest.fn(async () => {}),
    startAsync: jest.fn(async () => {}), stopAsync: jest.fn(async () => {}), abortAsync: jest.fn(async () => {}), addListener: (event, callback) => {
      listeners.set(event, callback); return { remove: () => { if (listeners.get(event) === callback) listeners.delete(event); } };
    },
  };
});
afterEach(async () => {
  readerUnregister.splice(0).forEach(unregister => unregister());
  await act(async () => { tree?.unmount(); await tick(); }); tree = null;
});

test('mount and disabled shortcut never request microphone, explicit enabled start does', async () => {
  await mount({ enabled: false });
  expect(current.isSupported).toBe(true);
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  expect(await current.start()).toBe(false);
  await update(); await act(async () => { expect(await current.start()).toBe(true); });
  expect(mockNativeModule.startAsync.mock.calls[0][0]).toEqual({ lang: 'yue' });
  expect(current.status).toBe('listening');
});

test('old native binary gracefully exposes keyboard fallback', async () => {
  mockNativeModule = null; await mount();
  expect(current.isSupported).toBe(false);
  await act(async () => { expect(await current.start()).toBe(false); });
  expect(current.errorCode).toBe('missingNativeModule');
  expect(current.unavailableReason).toBe('missingNativeModule');
  expect(current.diagnostics.nativeModule).toBe('missing');
});

test('an installed offline module with missing models reports a model error rather than requiring a system service', async () => {
  mockNativeModule.getStatus.mockReturnValue({ available: false, modelAvailable: false });
  await mount();
  expect(current.unavailableReason).toBe('offlineModelUnavailable');
  expect(current.diagnostics).toMatchObject({ installedVersion: '1.2.0', installedBuild: '14', nativeModule: 'available', speechService: 'unavailable', language: 'yue-Hant-HK', engine: 'offline' });
  await act(async () => { expect(await current.start()).toBe(false); });
  expect(current.errorCode).toBe('offlineModelUnavailable');
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
});

test('an unsupported language is reported separately after explicit recording permission', async () => {
  await mount(); await act(async () => { await current.start(); });
  await act(async () => { listeners.get('error')({ error: 'language-not-supported' }); await tick(); });
  expect(current.errorCode).toBe('languageUnavailable');
  expect(current.diagnostics.nativeModule).toBe('available');
  expect(current.diagnostics.language).toBe('yue-Hant-HK');
  expect(Object.keys(current.diagnostics)).toEqual(['platform', 'osVersion', 'installedVersion', 'installedBuild', 'nativeModule', 'speechService', 'recognitionService', 'language', 'engine']);
  expect(current.diagnostics.recognitionService).toBe('sherpa-onnx / SenseVoice (on-device)');
});

test('unavailable installed-version metadata is shown as unknown rather than an OTA build number', async () => {
  mockApplication = null; await mount();
  expect(current.diagnostics.installedVersion).toBe('—'); expect(current.diagnostics.installedBuild).toBe('—');
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
});

test('returning to the app refreshes offline-model availability without starting a recording', async () => {
  let available = false; mockNativeModule.getStatus.mockImplementation(() => ({ available, modelAvailable: available }));
  await mount(); expect(current.isSupported).toBe(false);
  available = true;
  await act(async () => mockAppStateCallback('active'));
  expect(current.isSupported).toBe(true); expect(current.unavailableReason).toBeNull();
  expect(current.diagnostics.speechService).toBe('available');
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
});

test('web fallback reports browser support rather than requiring an APK', async () => {
  Platform.OS = 'web'; const previous = globalThis.SpeechRecognition, legacy = globalThis.webkitSpeechRecognition;
  globalThis.SpeechRecognition = undefined; globalThis.webkitSpeechRecognition = undefined;
  try { await mount(); expect(current.unavailableReason).toBe('browserUnavailable'); expect(current.diagnostics.nativeModule).toBe('notApplicable'); }
  finally { globalThis.SpeechRecognition = previous; globalThis.webkitSpeechRecognition = legacy; }
});

test.each(['background', 'inactive'])('leaving active recording (%s) releases microphone and rejects late result', async state => {
  await mount(); await act(async () => { await current.start(); });
  const late = listeners.get('result');
  await act(async () => { mockAppStateCallback(state); await tick(); });
  expect(current.status).toBe('idle'); expect(mockNativeModule.abortAsync).toHaveBeenCalledTimes(1);
  late({ isFinal: true, results: [{ transcript: 'late speech' }] });
  expect(transcript).not.toHaveBeenCalled();
});

test('iOS permission dialog inactive state does not cancel, but background does cancel pending permission', async () => {
  Platform.OS = 'ios'; let grant;
  mockNativeModule.requestPermissionAsync.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  await mount(); let starting;
  await act(async () => { starting = current.start(); await tick(); mockAppStateCallback('inactive'); });
  expect(current.status).toBe('requesting');
  await act(async () => { mockAppStateCallback('background'); grant(true); await starting; });
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
});

test('language switch cancels previous audio and next attempt uses new language', async () => {
  Platform.OS = 'ios'; await mount(); await act(async () => { await current.start(); });
  expect(mockNativeModule.startAsync.mock.calls[0][0]).toEqual({ lang: 'yue' });
  await update({ locale: 'en' });
  expect(mockNativeModule.abortAsync).toHaveBeenCalledTimes(1);
  expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(1);
  await act(async () => { await current.start(); });
  expect(mockNativeModule.startAsync.mock.calls[1][0]).toEqual({ lang: 'en' });
});

test('screen disabled before transcript delivery never leaks text across identities', async () => {
  await mount(); await act(async () => { await current.start(); });
  const late = listeners.get('result');
  await update({ enabled: false });
  late({ isFinal: true, results: [{ transcript: 'previous user' }] });
  expect(transcript).not.toHaveBeenCalled();
  expect(mockNativeModule.abortAsync).toHaveBeenCalledTimes(1);
});

test('stop accepts a final result once, then restores iOS playback without retaining audio', async () => {
  Platform.OS = 'ios'; await mount(); await act(async () => { await current.start(); await current.stop(); });
  expect(current.status).toBe('processing');
  await act(async () => {
    listeners.get('result')({ isFinal: true, results: [{ transcript: '太極揉推器' }] });
    listeners.get('end')(); await tick();
  });
  expect(transcript).toHaveBeenCalledWith('太極揉推器');
  expect(current.status).toBe('idle');
  expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(1);
  // Native capture uses in-memory PCM; only the model language crosses this API.
  expect(mockNativeModule.startAsync.mock.calls[0][0]).toEqual({ lang: 'yue' });
});

function blockReaderStop() {
  let release;
  const stopping = new Promise(resolve => { release = resolve; });
  const stop = jest.fn(() => stopping);
  readerUnregister.push(registerAssistantReader(stop));
  return { release, stop };
}

test.each(['cancel', 'stop'])('%s during pending TTS shutdown never opens the microphone later', async action => {
  const blocked = blockReaderStop(); await mount(); let pending;
  await act(async () => { pending = current.start(); await tick(); });
  expect(blocked.stop).toHaveBeenCalledTimes(1);
  expect(isAssistantMicrophoneActive()).toBe(true);
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  await act(async () => { await current[action](); blocked.release(); expect(await pending).toBe(false); });
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
  expect(isAssistantMicrophoneActive()).toBe(false);
});

test.each(['background', 'inactive'])('app %s while waiting for TTS shutdown cancels the pending start', async state => {
  const blocked = blockReaderStop(); await mount(); let pending;
  await act(async () => { pending = current.start(); await tick(); });
  await act(async () => { mockAppStateCallback(state); await tick(); blocked.release(); expect(await pending).toBe(false); });
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
  expect(isAssistantMicrophoneActive()).toBe(false);
  await act(async () => { mockAppStateCallback('active'); await tick(); });
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
});

test('disabling the screen while TTS shutdown is pending releases ownership and blocks late capture', async () => {
  const blocked = blockReaderStop(); await mount(); let pending;
  await act(async () => { pending = current.start(); await tick(); });
  await update({ enabled: false });
  await act(async () => { blocked.release(); expect(await pending).toBe(false); });
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  expect(isAssistantMicrophoneActive()).toBe(false);
});

test('locale change during TTS shutdown discards the old start and next attempt uses the new language', async () => {
  const blocked = blockReaderStop(); await mount(); let pending;
  await act(async () => { pending = current.start(); await tick(); });
  await update({ locale: 'en' });
  await act(async () => { blocked.release(); expect(await pending).toBe(false); });
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
  expect(isAssistantMicrophoneActive()).toBe(false);
  await act(async () => { expect(await current.start()).toBe(true); });
  expect(mockNativeModule.startAsync).toHaveBeenCalledWith({ lang: 'en' });
});

test('unmount while TTS shutdown is pending releases ownership and cannot open a late permission dialog', async () => {
  const blocked = blockReaderStop(); await mount(); let pending;
  await act(async () => { pending = current.start(); await tick(); });
  await act(async () => { tree.unmount(); tree = null; await tick(); });
  blocked.release(); expect(await pending).toBe(false);
  expect(mockNativeModule.requestPermissionAsync).not.toHaveBeenCalled();
  expect(isAssistantMicrophoneActive()).toBe(false);
});

test('rapid starts during a TTS-stop handshake permit only the newest attempt to acquire the microphone', async () => {
  const blocked = blockReaderStop(); await mount(); let first, second;
  await act(async () => { first = current.start(); await tick(); second = current.start(); await tick(); });
  await act(async () => { blocked.release(); expect(await first).toBe(false); expect(await second).toBe(true); });
  expect(mockNativeModule.requestPermissionAsync).toHaveBeenCalledTimes(1);
  expect(mockNativeModule.startAsync).toHaveBeenCalledTimes(1);
  expect(isAssistantMicrophoneActive()).toBe(true);
  await act(async () => { await current.cancel(); });
  expect(isAssistantMicrophoneActive()).toBe(false);
});

test('microphone permission denial never prepares the model or starts recording', async () => {
  mockNativeModule.requestPermissionAsync.mockResolvedValue(false);
  await mount(); await act(async () => { expect(await current.start()).toBe(false); });
  expect(current.errorCode).toBe('permissionDenied');
  expect(mockNativeModule.readyAsync).not.toHaveBeenCalled();
  expect(mockNativeModule.startAsync).not.toHaveBeenCalled();
});

test('installed metadata never overrides offline binary detection or requires Google speech services', async () => {
  mockApplication = { nativeApplicationVersion: '1.1.9', nativeBuildVersion: '13' };
  await mount();
  expect(current.isSupported).toBe(true);
  expect(current.diagnostics).toMatchObject({ installedVersion: '1.1.9', installedBuild: '13', engine: 'offline' });
  await act(async () => { expect(await current.start()).toBe(true); });
  expect(mockNativeModule.startAsync).toHaveBeenCalledWith({ lang: 'yue' });
});
