import { createAssistantVoiceSession, createBrowserVoiceAdapter, voiceRecognitionLanguage,
  VOICE_SESSION_LIMIT_MS, VOICE_FINAL_RESULT_LIMIT_MS } from '../assistantVoiceSession';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(overrides = {}) {
  const listeners = new Map();
  const staleCallbacks = [];
  const adapter = { available: () => true, requestPermission: jest.fn(async () => true), ready: jest.fn(async () => {}),
    start: jest.fn(), stop: jest.fn(), abort: jest.fn(),
    addListener(event, fn) {
      listeners.set(event, fn); staleCallbacks.push({ event, fn });
      return { remove: () => { if (listeners.get(event) === fn) listeners.delete(event); } };
    }, ...overrides };
  const onState = jest.fn(); const onTranscript = jest.fn(); const onRelease = jest.fn();
  const session = createAssistantVoiceSession({ adapter, language: 'yue-Hant-HK', onState, onTranscript, onRelease });
  return { adapter, session, onState, onTranscript, onRelease, staleCallbacks,
    emit: (event, data) => listeners.get(event)?.(data),
    latest: () => onState.mock.calls.at(-1)?.[0] };
}
const result = (text, isFinal = true) => ({ isFinal, results: [{ transcript: text }] });
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each([['zh', 'android', 'yue-Hant-HK'], ['zh-Hant', 'ios', 'zh-HK'], ['zh', 'web', 'zh-HK'], ['en', 'ios', 'en-US']])(
  'locale %s on %s maps to %s', (locale, platform, expected) => expect(voiceRecognitionLanguage(locale, platform)).toBe(expected));

test('only final text is delivered once; audio is never persisted and text is not automatically sent', async () => {
  const t = setup();
  expect(await t.session.start()).toBe(true);
  expect(t.adapter.start).toHaveBeenCalledWith({ lang: 'yue-Hant-HK', continuous: false, interimResults: true,
    maxAlternatives: 1, recordingOptions: { persist: false } });
  t.emit('result', result('太極', false));
  expect(t.latest().interimText).toBe('太極'); expect(t.onTranscript).not.toHaveBeenCalled();
  t.emit('result', result(' 太極揉推器怎麼使用 '));
  t.emit('result', result('late duplicate'));
  expect(t.onTranscript).toHaveBeenCalledTimes(1);
  expect(t.onTranscript).toHaveBeenCalledWith('太極揉推器怎麼使用');
  t.emit('end'); await flush();
  expect(t.latest()).toEqual({ status: 'idle', errorCode: null, interimText: '' });
  expect(t.onRelease).toHaveBeenCalledTimes(1);
});

test('cancel while permission is pending never starts microphone or delivers stale data', async () => {
  let grant;
  const t = setup({ requestPermission: () => new Promise((resolve) => { grant = resolve; }) });
  const starting = t.session.start(); await flush();
  await t.session.cancel(); grant(true);
  expect(await starting).toBe(false);
  expect(t.adapter.start).not.toHaveBeenCalled();
  expect(t.onTranscript).not.toHaveBeenCalled();
});

test('denied permission and absent native module gracefully remain idle', async () => {
  const denied = setup({ requestPermission: async () => false });
  expect(await denied.session.start()).toBe(false);
  expect(denied.latest().errorCode).toBe('permissionDenied');
  expect(denied.adapter.start).not.toHaveBeenCalled();
  const absent = setup({ available: () => false });
  expect(await absent.session.start()).toBe(false);
  expect(absent.latest().errorCode).toBe('speechServiceUnavailable');
  expect(absent.adapter.requestPermission).not.toHaveBeenCalled();
});

test('rapid double start is ignored and cancelled events cannot enter a new session', async () => {
  const t = setup();
  const first = t.session.start();
  expect(await t.session.start()).toBe(false); await first;
  const late = t.staleCallbacks.find((item) => item.event === 'result').fn;
  await t.session.cancel(); await t.session.start();
  late(result('old speech')); expect(t.onTranscript).not.toHaveBeenCalled();
  t.emit('result', result('new speech')); expect(t.onTranscript).toHaveBeenCalledWith('new speech');
  await t.session.dispose();
  expect(await t.session.start()).toBe(false);
});

test('stop finalizes without auto delivery of interim words and has a bounded timeout', async () => {
  const t = setup(); await t.session.start();
  t.emit('result', result('unfinished', false)); await t.session.stop();
  expect(t.latest().status).toBe('processing');
  jest.advanceTimersByTime(VOICE_FINAL_RESULT_LIMIT_MS); await flush();
  expect(t.latest().errorCode).toBe('timeout');
  expect(t.onTranscript).not.toHaveBeenCalled();
  expect(t.adapter.abort).toHaveBeenCalledTimes(1);
});

test('one minute recording limit releases microphone even if engine never emits end', async () => {
  const t = setup(); await t.session.start();
  jest.advanceTimersByTime(VOICE_SESSION_LIMIT_MS); await flush();
  expect(t.adapter.stop).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(VOICE_FINAL_RESULT_LIMIT_MS); await flush();
  expect(t.latest().status).toBe('idle');
  expect(t.adapter.abort).toHaveBeenCalledTimes(1);
});

test('permission prompt timeout invalidates a delayed grant', async () => {
  let grant;
  const t = setup({ requestPermission: () => new Promise((resolve) => { grant = resolve; }) });
  const starting = t.session.start(); await flush();
  jest.advanceTimersByTime(30000); grant(true); await starting;
  expect(t.latest().errorCode).toBe('timeout');
  expect(t.adapter.start).not.toHaveBeenCalled();
});

test.each([['network', 'networkError'], ['not-allowed', 'permissionDenied'], ['no-speech', 'noSpeech'],
  ['microphone-memory', 'voiceMemoryUnavailable'], ['model-memory', 'voiceMemoryUnavailable'],
  ['language-not-supported', 'languageUnavailable'], ['language-unavailable', 'languageUnavailable'], ['unavailable', 'speechServiceUnavailable'], ['unknown', 'startFailed']])('error %s becomes %s', async (error, expected) => {
  const t = setup(); await t.session.start(); t.emit('error', { error }); await flush();
  expect(t.latest()).toMatchObject({ status: 'idle', errorCode: expected });
});

test.each(['microphone-memory', 'model-memory'])('native start rejection %s remains recoverable and releases audio', async (code) => {
  const t = setup({ start: () => Promise.reject({ code }) });
  expect(await t.session.start()).toBe(false); await flush();
  expect(t.latest()).toMatchObject({ status: 'idle', errorCode: 'voiceMemoryUnavailable' });
  expect(t.adapter.abort).toHaveBeenCalledTimes(1);
  expect(t.onTranscript).not.toHaveBeenCalled();
});

test('invalid results are ignored and adapter start failure releases microphone', async () => {
  const t = setup(); await t.session.start();
  for (const invalid of [null, {}, result('   '), result(42)]) t.emit('result', invalid);
  expect(t.onTranscript).not.toHaveBeenCalled(); await t.session.cancel();
  const failing = setup({ start: () => { throw new Error('unavailable service'); } });
  expect(await failing.session.start()).toBe(false); await flush();
  expect(failing.adapter.abort).toHaveBeenCalledTimes(1);
  expect(failing.latest().errorCode).toBe('startFailed');
});

test('browser uses fresh recognition instances and ignores old events after abort', async () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() {} stop() {} abort() {}
  }
  const adapter = createBrowserVoiceAdapter(FakeRecognition);
  const receive = jest.fn(); adapter.addListener('result', receive);
  adapter.start({ lang: 'zh-HK' }); const first = instances[0];
  adapter.abort(); adapter.start({ lang: 'en-US' });
  const event = { resultIndex: 0, results: [Object.assign([{ transcript: 'hello' }], { isFinal: true })] };
  first.onresult(event); expect(receive).not.toHaveBeenCalled();
  instances[1].onresult(event); expect(receive).toHaveBeenCalledWith(result('hello'));
  expect(instances[1].lang).toBe('en-US');
  expect(createBrowserVoiceAdapter(undefined).available()).toBe(false);
});
