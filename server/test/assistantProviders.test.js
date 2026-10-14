import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assistantProviderRuntime, assistantProviderConfiguration, normalizeDeepSeekModel, DEFAULT_BAILIAN_MODEL, DEFAULT_BAILIAN_BASE_URL } from '../src/assistantProviders.js';
import { publicAiConfiguration, prepareAiConfiguration, prepareAssistantRequest, testAiProvider } from '../src/assistantProviderRoutes.js';

const row = { provider: 'deepseek', model: 'deepseek-v4-pro', api_key: 'PRIVATE_DEEPSEEK_KEY', updated_at: '2026-10-08T00:00:00.000Z' };
const env = { DASHSCOPE_API_KEY: 'PRIVATE_DASHSCOPE_KEY', BAILIAN_FAQ_ENABLED: 'false' };

test('runtime defaults to DeepSeek and exposes no secret, with stable non-secret revision', () => {
  const current = assistantProviderRuntime(row, env);
  assert.deepEqual({ ...current, revision: undefined }, { provider: 'deepseek', model: 'deepseek-v4-pro', scope: 'deepseek', revision: undefined, promptMode: 'app', faqEnabled: true, protocol: 2 });
  assert.equal(assistantProviderRuntime({}, {}).provider, 'deepseek');
  assert.equal(assistantProviderRuntime({ provider: 'openai_compatible', model: 'deepseek-chat' }, {}).model, 'deepseek-v4-flash');
  assert.equal(normalizeDeepSeekModel('deepseek-reasoner'), 'deepseek-v4-pro');
  assert.equal(normalizeDeepSeekModel('qwen3-14b'), '');
  assert.doesNotMatch(JSON.stringify(current), /PRIVATE|api.?key/i);
  assert.equal(assistantProviderRuntime({ ...row, api_key: 'ROTATED' }, { ...env, DASHSCOPE_API_KEY: 'ROTATED_OTHER' }).revision, current.revision);
  for (const [changedRow, changedEnv] of [
    [{ ...row, updated_at: '2026-10-08T01:00:00.000Z' }, env],
    [{ ...row, provider: 'bailian' }, env],
    [row, { ...env, BAILIAN_MODEL_ID: 'different-deployment' }],
    [row, { ...env, BAILIAN_FAQ_ENABLED: 'true' }],
    [row, { ...env, BAILIAN_BASE_URL: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }],
  ]) assert.notEqual(assistantProviderRuntime(changedRow, changedEnv).revision, current.revision);
});

test('Bailian runtime does not require a key and never replaces saved DeepSeek configuration', () => {
  const saved = { ...row, provider: 'bailian' }, before = JSON.stringify(saved);
  const current = assistantProviderRuntime(saved, { BAILIAN_FAQ_ENABLED: 'false', DASHSCOPE_API_KEY_FILE: 'not-read-by-public-runtime' });
  assert.equal(current.provider, 'bailian'); assert.equal(current.model, DEFAULT_BAILIAN_MODEL);
  assert.equal(current.promptMode, 'none'); assert.equal(current.faqEnabled, false);
  assert.equal(JSON.stringify(saved), before);
  const privateBailian = assistantProviderConfiguration(current, saved, env);
  assert.equal(privateBailian.apiKey, env.DASHSCOPE_API_KEY);
  assert.equal(privateBailian.baseURL, DEFAULT_BAILIAN_BASE_URL);
  assert.equal(privateBailian.url, DEFAULT_BAILIAN_BASE_URL + '/chat/completions');
  const privateDeepSeek = assistantProviderConfiguration({ provider: 'deepseek', model: 'deepseek-v4-flash' }, saved, env);
  assert.equal(privateDeepSeek.apiKey, row.api_key); assert.equal(privateDeepSeek.model, 'deepseek-v4-flash');
  assert.equal(privateDeepSeek.baseURL, 'https://api.deepseek.com');
  assert.equal(assistantProviderConfiguration(current, saved, { ...env, BAILIAN_MODEL_ID: 'changed-after-enqueue' }).model, DEFAULT_BAILIAN_MODEL);
});

test('Bailian private key file is server-only, authoritative, bounded, and reports fixed errors', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bailian-config-test-'));
  const file = path.join(folder, 'key');
  try {
    fs.writeFileSync(file, 'FILE_PRIVATE_KEY\n');
    const config = assistantProviderConfiguration({ provider: 'bailian' }, row, { ...env, DASHSCOPE_API_KEY_FILE: file });
    assert.equal(config.apiKey, 'FILE_PRIVATE_KEY');
    assert.doesNotMatch(JSON.stringify(assistantProviderRuntime({ provider: 'bailian' }, { ...env, DASHSCOPE_API_KEY_FILE: file })), /PRIVATE|bailian-config-test/);
    fs.writeFileSync(file, 'bad\ninternal\nlines');
    assert.throws(() => assistantProviderConfiguration({ provider: 'bailian' }, row, { DASHSCOPE_API_KEY_FILE: file }), { code: 'BAILIAN_API_KEY_REQUIRED' });
    fs.writeFileSync(file, 'x'.repeat(4097));
    assert.throws(() => assistantProviderConfiguration({ provider: 'bailian' }, row, { DASHSCOPE_API_KEY_FILE: file }), { code: 'BAILIAN_API_KEY_FILE_INVALID' });
    assert.throws(() => assistantProviderConfiguration({ provider: 'bailian' }, row, { DASHSCOPE_API_KEY_FILE: file + '-missing' }), error => error.message === 'BAILIAN_API_KEY_FILE_INVALID' && !error.message.includes(folder));
  } finally { fs.unlinkSync(file); fs.rmdirSync(folder); }
});

test('provider credentials cannot be redirected and disabled FAQ does not disable chat configuration', () => {
  assert.equal(assistantProviderConfiguration({ provider: 'bailian' }, row, env).model, DEFAULT_BAILIAN_MODEL);
  for (const url of ['http://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://attacker.test/compatible-mode/v1', DEFAULT_BAILIAN_BASE_URL + '?key=bad', DEFAULT_BAILIAN_BASE_URL + '/chat/completions']) {
    assert.throws(() => assistantProviderConfiguration({ provider: 'bailian' }, row, { ...env, BAILIAN_BASE_URL: url }), { code: 'BAILIAN_BASE_URL_INVALID' });
    assert.equal(assistantProviderRuntime(row, { ...env, BAILIAN_BASE_URL: url }).provider, 'deepseek');
  }
  assert.throws(() => assistantProviderConfiguration({ provider: 'bailian' }, row, {}), { code: 'BAILIAN_API_KEY_REQUIRED' });
  assert.throws(() => assistantProviderConfiguration({ provider: 'bailian', model: 'bad\nmodel' }, row, env), { code: 'BAILIAN_MODEL_ID_REQUIRED' });
  assert.throws(() => assistantProviderConfiguration({ provider: 'other' }, row, env), { code: 'ASSISTANT_PROVIDER_INVALID' });
});

test('DeepSeek-only mode ignores the saved selector without changing keys, model or existing Bailian snapshots', () => {
  const saved = { ...row, provider: 'bailian' }, before = JSON.stringify(saved);
  const accepted = assistantProviderRuntime(saved, env);
  const limitedEnv = { ...env, ASSISTANT_PROVIDER_MODE: 'deepseek_only' };
  const current = assistantProviderRuntime(saved, limitedEnv);
  assert.equal(current.provider, 'deepseek'); assert.equal(current.scope, 'deepseek');
  assert.equal(current.model, row.model); assert.equal(current.protocol, 2);
  assert.equal(current.promptMode, 'app'); assert.equal(current.faqEnabled, true);
  assert.notEqual(current.revision, accepted.revision);
  assert.notEqual(current.revision, assistantProviderRuntime(row, env).revision);
  assert.equal(JSON.stringify(saved), before);
  const oldPrivate = assistantProviderConfiguration(accepted, saved, limitedEnv);
  assert.equal(oldPrivate.provider, 'bailian'); assert.equal(oldPrivate.apiKey, env.DASHSCOPE_API_KEY);
  assert.equal(oldPrivate.model, accepted.model);
  assert.equal(assistantProviderConfiguration(current, saved, limitedEnv).apiKey, row.api_key);
});

test('DeepSeek-only public configuration omits Bailian and does not open its key file', () => {
  const limitedEnv = { ASSISTANT_PROVIDER_MODE: 'deepseek_only' };
  Object.defineProperty(limitedEnv, 'DASHSCOPE_API_KEY_FILE', { get() { throw Error('must not inspect Bailian secrets'); } });
  const value = publicAiConfiguration({ ...row, provider: 'bailian' }, limitedEnv);
  assert.equal(value.providerMode, 'deepseek_only'); assert.equal(value.activeProvider, 'deepseek');
  assert.deepEqual(value.supportedProviders, ['deepseek']); assert.deepEqual(Object.keys(value.profiles), ['deepseek']);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|qwen|dashscope/i);
  const normal = publicAiConfiguration(row, env);
  assert.equal(normal.providerMode, 'multi_provider');
  assert.deepEqual(normal.supportedProviders, ['deepseek', 'bailian']);
});

test('DeepSeek-only submission rejects stale Bailian and stale DeepSeek revisions while preserving legacy DeepSeek', () => {
  const saved = { ...row, provider: 'bailian' }, limitedEnv = { ...env, ASSISTANT_PROVIDER_MODE: 'deepseek_only' };
  const current = assistantProviderRuntime(saved, limitedEnv);
  for (const input of [
    { provider: 'bailian', historyScope: 'bailian' },
    { provider: 'deepseek', historyScope: 'bailian' },
    { conversation: { provider: 'bailian' } },
    { provider: 'deepseek', runtimeRevision: assistantProviderRuntime(row, env).revision },
  ]) assert.throws(() => prepareAssistantRequest(input, saved, limitedEnv), { code: 'assistantProviderChanged', status: 409 });
  assert.equal(prepareAssistantRequest({}, saved, limitedEnv).provider, 'deepseek');
  assert.deepEqual(prepareAssistantRequest({ provider: 'deepseek', historyScope: 'deepseek', runtimeRevision: current.revision }, saved, limitedEnv), current);
  assert.equal(prepareAiConfiguration({}, saved, limitedEnv).row.provider, 'deepseek');
  assert.equal(saved.provider, 'bailian');
});

test('DeepSeek-only admin cannot select or test Bailian, even with a previously valid revision', async () => {
  const limitedEnv = { ...env, ASSISTANT_PROVIDER_MODE: 'deepseek_only' };
  const input = { provider: 'bailian', revision: assistantProviderRuntime(row, env).revision };
  assert.throws(() => prepareAiConfiguration(input, row, limitedEnv), { code: 'assistantProviderDisabled', status: 400 });
  let calls = 0;
  await assert.rejects(testAiProvider({ input, row, env: limitedEnv, bailianChat: () => { calls++; },
    deepSeekClientFactory: () => { calls++; } }), { code: 'assistantProviderDisabled', status: 400 });
  assert.equal(calls, 0);
});
