import { createOfflineVoiceAdapter } from '../offlineAssistantVoice';

const makeNative = () => ({
  getStatus: jest.fn(() => ({ available: true, modelAvailable: true })),
  requestPermissionAsync: jest.fn(async () => true), readyAsync: jest.fn(async () => {}),
  startAsync: jest.fn(async () => {}), stopAsync: jest.fn(async () => {}), abortAsync: jest.fn(async () => {}),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
});

test('diagnostic calls return only permitted stage/voice metadata and tolerate legacy binaries', () => {
  const native = makeNative();
  expect(createOfflineVoiceAdapter(native).readDiagnostics()).toEqual({});
  native.getDiagnostics = () => ({ nativeRevision: 'r2', lastStage: 'recording', userText: 'private', token: 'secret' });
  native.getReplyStatus = () => ({ selectedVoice: 'yue-hk', voiceConfirmed: true, text: 'private-answer', audioUri: 'private-file' });
  expect(createOfflineVoiceAdapter(native).readDiagnostics()).toEqual({ nativeRevision: 'r2', lastStage: 'recording', selectedVoice: 'yue-hk', voiceConfirmed: true });
  native.getDiagnostics = () => { throw new Error('unavailable'); };
  expect(() => createOfflineVoiceAdapter(native).readDiagnostics()).not.toThrow();
});

test('a legacy binary without the offline module offers keyboard fallback instead of a system recognizer', () => {
  const adapter = createOfflineVoiceAdapter(null);
  expect(adapter.available()).toBe(false);
  expect(adapter.unavailableReason()).toBe('missingNativeModule');
  expect(adapter.nativeModulePresent).toBe(false);
  expect(adapter.engine).toBe('offline');
});

test.each([[true, true, true], [true, false, false], [false, true, false], [false, false, false]])('availability requires both the engine (%s) and model (%s)', (available, modelAvailable, expected) => {
  const native = makeNative(); native.getStatus.mockReturnValue({ available, modelAvailable });
  expect(createOfflineVoiceAdapter(native).available()).toBe(expected);
});

test('missing models and native failures use separate errors without requesting the microphone', () => {
  const native = makeNative(), adapter = createOfflineVoiceAdapter(native);
  native.getStatus.mockReturnValue({ available: false, modelAvailable: false });
  expect(adapter.unavailableReason()).toBe('offlineModelUnavailable');
  native.getStatus.mockImplementation(() => { throw new Error('native failure'); });
  expect(adapter.available()).toBe(false);
  expect(adapter.unavailableReason()).toBe('startFailed');
  expect(native.requestPermissionAsync).not.toHaveBeenCalled();
});

test.each([['en-US', 'en'], ['en-GB', 'en'], ['zh-HK', 'yue'], ['yue-Hant-HK', 'yue']])('language %s uses bundled %s recognition without sending audio or unrelated options', async (lang, expected) => {
  const native = makeNative(), adapter = createOfflineVoiceAdapter(native);
  await adapter.start({ lang, interimResults: true, recordingOptions: { persist: true }, token: 'never-pass-this' });
  expect(native.startAsync).toHaveBeenCalledWith({ lang: expected });
});

test('permission, initialization, final decode and cancellation delegate to the owned native recorder', async () => {
  const native = makeNative(), adapter = createOfflineVoiceAdapter(native), callback = jest.fn();
  expect(await adapter.requestPermission()).toBe(true);
  await adapter.ready(); await adapter.stop(); await adapter.abort();
  const subscription = adapter.addListener('result', callback);
  expect(native.requestPermissionAsync).toHaveBeenCalledTimes(1);
  expect(native.readyAsync).toHaveBeenCalledTimes(1);
  expect(native.stopAsync).toHaveBeenCalledTimes(1);
  expect(native.abortAsync).toHaveBeenCalledTimes(1);
  expect(native.addListener).toHaveBeenCalledWith('result', callback);
  expect(typeof subscription.remove).toBe('function');
  expect(adapter.preparationTimeoutMs).toBe(120000);
  expect(adapter.finalResultTimeoutMs).toBe(90000);
  expect(adapter.servicePackage()).toBe('sherpa-onnx / SenseVoice (on-device)');
});
