import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantProviderRuntime } from '../src/assistantProviders.js';
import { createBailianChatClient, readBailianChatConfig, BAILIAN_CHAT_MAX_REPLY_CHARS } from '../src/assistantBailianChat.js';

const env = { DASHSCOPE_API_KEY: 'PRIVATE_DASHSCOPE_KEY', BAILIAN_FAQ_ENABLED: 'false' };
const runtime = assistantProviderRuntime({ provider: 'bailian', updated_at: '2026-10-08' }, env);
const input = { message: '拉繩機要拉幾多下？', history: [], runtime };
const response = (content = 'A model answer.', overrides = {}) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content }, ...overrides }] }) });

test('direct chat is independent of selector flag and sends raw same-provider turns with no app prompt', async () => {
  let calls = 0;
  assert.equal(readBailianChatConfig(env).model, runtime.model);
  const client = createBailianChatClient(env, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, 'Bearer PRIVATE_DASHSCOPE_KEY');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages, [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '  model previous answer  ' }, { role: 'user', content: input.message }]);
    assert.deepEqual(Object.keys(body).sort(), ['enable_thinking','max_tokens','messages','model','stream']);
    assert.equal(body.model, runtime.model); assert.equal(body.enable_thinking, false); assert.equal(body.stream, false);
    assert.doesNotMatch(options.body, /PRIVATE|FAQ|candidate|system instruction/);
    return response('  原始模型答复\n第二行。  ');
  } });
  const result = await client({ ...input, history: [
    { role: 'system', content: 'system instruction PRIVATE_OLD_PROMPT' },
    { role: 'user', content: '之前的问题', account: 'PRIVATE_ACCOUNT' },
    { role: 'assistant', content: '  model previous answer  ', apiKey: 'PRIVATE_KEY' },
    { role: 'tool', content: 'PRIVATE_CATALOG' },
  ], candidates: ['PRIVATE_FAQ'], latitude: 22, runtime: { ...runtime, apiKey: 'PRIVATE_RUNTIME_KEY' } });
  assert.equal(calls, 1); assert.equal(result.reply, '  原始模型答复\n第二行。  ');
  assert.equal(result.provider, 'bailian'); assert.equal(result.responsePolicy, 'bailian-chat-raw-v1');
  assert.equal(result.deepSeekUsed, false); assert.equal(result.faqEnabled, false);
  assert.deepEqual(result.recommendations, []); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|apiKey/);
});

test('selector-looking JSON is preserved as literal model text rather than interpreted as FAQ', async () => {
  const content = '{"action":"faq","faqId":"app-records"}';
  const result = await createBailianChatClient(env, { fetchImpl: async () => response(content) })(input);
  assert.equal(result.reply, content); assert.equal(result.action, 'general');
  assert.equal(result.faqId, undefined); assert.equal(result.evidencePolicy, undefined);
});

test('lazy construction permits DeepSeek-only startup, while model snapshot is used for actual Bailian calls', async () => {
  assert.equal(typeof createBailianChatClient({}), 'function');
  let calls = 0;
  await assert.rejects(createBailianChatClient({}, { fetchImpl: () => { calls++; } })(input), { code: 'BAILIAN_API_KEY_REQUIRED' });
  assert.equal(calls, 0);
  await createBailianChatClient({ ...env, BAILIAN_MODEL_ID: 'new-model-after-queued' }, { fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, runtime.model); return response();
  } })(input);
});

test('malformed, tool-using, empty, truncated and oversized replies fail without fallback or leaked error detail', async () => {
  for (const fetchImpl of [
    async () => response('x', { finish_reason: 'length' }),
    async () => response('x', { message: { content: 'x', tool_calls: [{}] } }),
    async () => response('x', { message: { content: 'x', function_call: {} } }),
    async () => response('   '), async () => response({ text: 'not plain content' }),
    async () => response('x'.repeat(BAILIAN_CHAT_MAX_REPLY_CHARS + 1)),
    async () => ({ ok: true, json: async () => { throw Error('PRIVATE_PROVIDER_DETAIL'); } }),
  ]) {
    let calls = 0;
    const client = createBailianChatClient(env, { fetchImpl: (...args) => { calls++; return fetchImpl(...args); } });
    await assert.rejects(client(input), error => error.code === 'BAILIAN_CHAT_INVALID_RESPONSE' && error.message === error.code && !JSON.stringify(error).includes('PRIVATE'));
    assert.equal(calls, 1);
  }
  for (const fetchImpl of [async () => ({ ok: false, status: 401, json: () => assert.fail('error body must not be read') }), async () => { throw Error(env.DASHSCOPE_API_KEY); }]) {
    let calls = 0;
    await assert.rejects(createBailianChatClient(env, { fetchImpl: (...args) => { calls++; return fetchImpl(...args); } })(input), error => error.code === 'BAILIAN_CHAT_UNAVAILABLE' && !JSON.stringify(error).includes(env.DASHSCOPE_API_KEY));
    assert.equal(calls, 1);
  }
});

test('response stream and reply content are bounded independently of claimed provider token limits', async () => {
  const result = await createBailianChatClient(env, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Streaming-body text.' } }] })) })(input);
  assert.equal(result.reply, 'Streaming-body text.');
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(createBailianChatClient(env, { fetchImpl: async () => new Response(stream) })(input), { code: 'BAILIAN_CHAT_INVALID_RESPONSE' });
  assert.equal(cancelled, true);
});

test('cancellation and deadline reach the real transport and do not start any fallback', async () => {
  let calls = 0;
  await assert.rejects(createBailianChatClient(env, { fetchImpl: () => { calls++; } })({ ...input, signal: AbortSignal.abort() }), { code: 'BAILIAN_CHAT_UNAVAILABLE' });
  assert.equal(calls, 0);
  let signal;
  const client = createBailianChatClient(env, { timeoutMs: 10, fetchImpl: (_url, options) => {
    calls++; signal = options.signal; return new Promise(() => {});
  } });
  await assert.rejects(client(input), { code: 'BAILIAN_CHAT_UNAVAILABLE' });
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  let started;
  const ready = new Promise(resolve => { started = resolve; }), controller = new AbortController();
  const running = createBailianChatClient(env, { fetchImpl: (_url, options) => {
    signal = options.signal; started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('PRIVATE_ABORT')), { once: true }));
  } })({ ...input, signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(running, { code: 'BAILIAN_CHAT_UNAVAILABLE' }); assert.equal(signal.aborted, true);
});

test('malformed input or provider runtime never leaves the server', async () => {
  const client = createBailianChatClient(env, { fetchImpl: () => assert.fail('network') });
  for (const data of [
    { ...input, message: '' }, { ...input, message: 'x'.repeat(601) },
    { ...input, runtime: { ...runtime, provider: 'deepseek' } },
    { ...input, runtime: { ...runtime, promptMode: 'app' } },
    { ...input, history: [{ role: 'user', content: { private: true } }] },
    { ...input, history: [{ role: 'assistant', content: 'x'.repeat(6001) }] },
  ]) await assert.rejects(client(data), { code: 'BAILIAN_CHAT_INVALID_INPUT' });
});
