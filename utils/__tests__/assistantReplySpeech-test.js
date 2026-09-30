import { createAssistantReplyReader, replySpeechChunks } from '../assistantReplySpeech';
import { setAssistantMicrophoneActive, stopAssistantReaders } from '../assistantAudioCoordination';

const readers = [];
const microphone = {};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function setup(overrides = {}) {
  let listener;
  const remove = jest.fn(() => { listener = null; });
  const native = {
    stopReplyAsync: jest.fn(async () => {}),
    speakReplyAsync: jest.fn(async () => {}),
    addListener: jest.fn((event, fn) => { expect(event).toBe('onReplySpeech'); listener = fn; return { remove }; }),
    ...overrides,
  };
  const onState = jest.fn();
  const reader = createAssistantReplyReader({ native, language: 'zh-HK', onState });
  readers.push(reader);
  return { native, reader, onState, remove, emit: event => listener?.(event),
    currentId: () => native.speakReplyAsync.mock.calls.at(-1)?.[0],
    latest: () => onState.mock.calls.at(-1)?.[0] };
}
beforeEach(() => { jest.useFakeTimers(); setAssistantMicrophoneActive(microphone, false); });
afterEach(async () => {
  for (const reader of readers.splice(0)) void reader.dispose();
  setAssistantMicrophoneActive(microphone, false);
  await flush(); jest.clearAllTimers(); jest.useRealTimers();
});

test('normalization reads text labels but not code, images, URLs or Markdown punctuation', () => {
  expect(replySpeechChunks('## **教學** [使用步驟](https://example.com) ![圖片](https://example.com/a.png) `安全` ```js\nsecret()\n``` https://example.com/raw'))
    .toEqual(['教學 使用步驟 安全']);
  expect(replySpeechChunks(null)).toEqual([]);
  expect(replySpeechChunks('```js\ncode\n```')).toEqual([]);
});

test('long answers split at sentences where possible, never exceed native limit, and keep Unicode pairs', () => {
  const text = `${'中'.repeat(450)}。${'😀'.repeat(1100)}!${'字'.repeat(2000)}`;
  const chunks = replySpeechChunks(text);
  expect(chunks[0]).toBe(`${'中'.repeat(450)}。`);
  expect(chunks.every(chunk => chunk.length <= 1800)).toBe(true);
  expect(chunks.join('')).toBe(text);
  expect(chunks.some(chunk => /[\uD800-\uDBFF]$/.test(chunk))).toBe(false);
  expect(chunks.some(chunk => /^[\uDC00-\uDFFF]/.test(chunk))).toBe(false);
});

test('answer cap must not introduce an unpaired surrogate at its truncation boundary', () => {
  const chunks = replySpeechChunks(`${'中'.repeat(15999)}😀末尾`);
  expect(chunks.join('').length).toBeLessThanOrEqual(16000);
  expect(/[\uD800-\uDBFF]$/.test(chunks.at(-1))).toBe(false);
});

test('chunks play strictly in order and only the matching completed utterance advances', async () => {
  const t = setup(); const text = `${'中'.repeat(450)}。${'字'.repeat(450)}。末尾`;
  expect(await t.reader.read('message-1', text)).toBe(true);
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(1);
  const first = t.currentId();
  t.emit({ id: 'foreign', status: 'idle' });
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(1);
  t.emit({ id: first, status: 'speaking' });
  expect(t.latest()).toMatchObject({ status: 'speaking', activeMessageId: 'message-1' });
  t.emit({ id: first, status: 'idle' }); await flush();
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(2);
  t.emit({ id: first, status: 'idle' }); await flush();
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(2);
  t.emit({ id: t.currentId(), status: 'idle' }); await flush();
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(3);
  t.emit({ id: t.currentId(), status: 'idle' }); await flush();
  expect(t.latest()).toEqual({ status: 'idle', activeMessageId: null, errorCode: null });
});

test('new reply invalidates events and promise rejections from the previous reply', async () => {
  let rejectOld;
  const t = setup({ speakReplyAsync: jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue(undefined) });
  await t.reader.read('old', '之前的回答'); const oldId = t.currentId();
  await t.reader.read('new', '新的回答'); const newId = t.currentId();
  expect(newId).not.toBe(oldId);
  t.emit({ id: oldId, status: 'idle', errorCode: 'voiceUnavailable' });
  rejectOld(new Error('late failure')); await flush();
  expect(t.latest()).toMatchObject({ status: 'loading', activeMessageId: 'new', errorCode: null });
  t.emit({ id: newId, status: 'speaking' });
  expect(t.latest().status).toBe('speaking');
});

test('stop while awaiting native cancellation prevents a deferred read from starting', async () => {
  let release;
  const t = setup({ stopReplyAsync: jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(undefined) });
  const reading = t.reader.read('late', '不應讀出');
  await t.reader.stop(); release(); await flush();
  expect(await reading).toBe(false);
  expect(t.native.speakReplyAsync).not.toHaveBeenCalled();
});

test('canceled older reader cannot stop a newer reader when its old cleanup promise resolves', async () => {
  let release;
  const old = setup({ stopReplyAsync: jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(undefined) });
  const next = setup();
  const pending = old.reader.read('old-screen', 'old');
  expect(await next.reader.read('new-screen', 'new')).toBe(true);
  const nextStops = next.native.stopReplyAsync.mock.calls.length;
  release(); await flush();
  expect(await pending).toBe(false);
  expect(next.native.stopReplyAsync).toHaveBeenCalledTimes(nextStops);
  expect(next.latest()).toMatchObject({ status: 'loading', activeMessageId: 'new-screen' });
});

test('microphone ownership blocks reads, cancels current playback, and never auto resumes', async () => {
  const t = setup(); setAssistantMicrophoneActive(microphone, true);
  expect(await t.reader.read('blocked', 'blocked')).toBe(false);
  expect(t.native.speakReplyAsync).not.toHaveBeenCalled();
  setAssistantMicrophoneActive(microphone, false);
  await t.reader.read('active', '這是回答'); const oldId = t.currentId();
  setAssistantMicrophoneActive(microphone, true); await stopAssistantReaders();
  expect(t.latest().status).toBe('idle');
  t.emit({ id: oldId, status: 'idle' });
  setAssistantMicrophoneActive(microphone, false); await flush();
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(1);
});

test('microphone becoming active during pending native cleanup prevents playback', async () => {
  let release;
  const t = setup({ stopReplyAsync: jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(undefined) });
  const pending = t.reader.read('id', 'text');
  setAssistantMicrophoneActive(microphone, true); release();
  expect(await pending).toBe(false);
  expect(t.native.speakReplyAsync).not.toHaveBeenCalled();
});

test.each([null, { speakReplyAsync: jest.fn() }])('missing native module or event support fails gracefully', async native => {
  const onState = jest.fn(); const reader = createAssistantReplyReader({ native, language: 'en-US', onState }); readers.push(reader);
  expect(await reader.read('id', 'Hello')).toBe(false);
  expect(onState).toHaveBeenLastCalledWith({ status: 'idle', activeMessageId: null, errorCode: 'missingNativeModule' });
});

test('missing installed voice stops once with actionable error, without reading further chunks', async () => {
  const t = setup(); await t.reader.read('id', `${'字'.repeat(450)}。下一段`);
  t.emit({ id: t.currentId(), status: 'idle', errorCode: 'voiceUnavailable' }); await flush();
  expect(t.latest()).toEqual({ status: 'idle', activeMessageId: null, errorCode: 'voiceUnavailable' });
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(1);
});

test('native interruptions silently terminate the read instead of advancing a chunk', async () => {
  const t = setup(); await t.reader.read('id', `${'字'.repeat(450)}。下一段`);
  t.emit({ id: t.currentId(), status: 'idle', errorCode: 'interrupted' }); await flush();
  expect(t.latest()).toEqual({ status: 'idle', activeMessageId: null, errorCode: null });
  expect(t.native.speakReplyAsync).toHaveBeenCalledTimes(1);
});

test('missing completion callbacks time out; disposal removes listener and ignores late work', async () => {
  const t = setup(); await t.reader.read('id', 'Hello');
  jest.advanceTimersByTime(180000); await flush();
  expect(t.latest().errorCode).toBe('playbackFailed');
  await t.reader.dispose(); const states = t.onState.mock.calls.length;
  expect(t.remove).toHaveBeenCalledTimes(1);
  expect(await t.reader.read('later', 'No')).toBe(false);
  expect(t.onState).toHaveBeenCalledTimes(states);
});
