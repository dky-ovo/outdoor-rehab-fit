import { assistantProviderRuntime, assistantProviderConfiguration, assistantProviderMode, normalizeDeepSeekModel, DEEPSEEK_PROVIDER_BASE_URL } from './assistantProviders.js';

const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });

export function publicAiConfiguration(row, env = process.env) {
  const runtime = assistantProviderRuntime(row, env);
  const providerMode = assistantProviderMode(env);
  const deepseek = { model: normalizeDeepSeekModel(row?.model) || 'deepseek-v4-flash',
    apiKeyConfigured: Boolean(row?.api_key), promptMode: 'app', faqEnabled: true };
  let bailian;
  if (providerMode !== 'deepseek_only') try {
    const selected = assistantProviderRuntime({ ...row, provider: 'bailian' }, env);
    let configured = false;
    try { assistantProviderConfiguration(selected, row, env); configured = true; } catch {}
    bailian = { model: selected.model, baseUrl: env.BAILIAN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKeyConfigured: configured, promptMode: 'none', faqEnabled: false };
  } catch { bailian = { model: '', apiKeyConfigured: false, promptMode: 'none', faqEnabled: false }; }
  return { provider: runtime.provider, activeProvider: runtime.provider, providerMode,
    supportedProviders: providerMode === 'deepseek_only' ? ['deepseek'] : ['deepseek', 'bailian'], model: deepseek.model,
    apiKeyConfigured: deepseek.apiKeyConfigured, revision: runtime.revision, updatedAt: row?.updated_at || null,
    profiles: { deepseek, ...(bailian ? { bailian } : {}) } };
}

// Selecting Bailian changes only the active selector. The existing model/key
// columns remain DeepSeek's, including for the separate administrator assistant.
export function prepareAiConfiguration(input = {}, current, env = process.env, { test = false } = {}) {
  const active = assistantProviderRuntime(current, env).provider;
  const provider = input.provider ?? active;
  if (!['deepseek', 'bailian'].includes(provider)) throw fail('invalidAiProvider');
  if (assistantProviderMode(env) === 'deepseek_only' && provider === 'bailian') throw fail('assistantProviderDisabled');
  if (!test && input.revision && input.revision !== assistantProviderRuntime(current, env).revision) throw fail('assistantProviderChanged', 409);
  if (!test && !input.revision && (provider === 'bailian' || active === 'bailian')) throw fail('assistantClientUpdateRequired', 409);
  let model = current?.model || 'deepseek-v4-flash', apiKey = current?.api_key || '';
  if (provider === 'deepseek') {
    model = normalizeDeepSeekModel(input.model ?? model);
    const supplied = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (supplied && (supplied.length > 1000 || /\s|\0/.test(supplied))) throw fail('invalidDeepSeekConfiguration');
    apiKey = supplied || apiKey;
    if (!model || !apiKey) throw fail('invalidDeepSeekConfiguration');
  }
  const row = { ...current, provider, model, api_key: apiKey, base_url: DEEPSEEK_PROVIDER_BASE_URL };
  const runtime = assistantProviderRuntime(row, env);
  try { assistantProviderConfiguration(runtime, row, env); }
  catch { throw fail(provider === 'bailian' ? 'bailianNotConfigured' : 'invalidDeepSeekConfiguration'); }
  return { row, runtime, apiKeyChanged: provider === 'deepseek' && Boolean(input.apiKey?.trim()) };
}

export function prepareAssistantRequest(input = {}, row, env = process.env) {
  const runtime = assistantProviderRuntime(row, env);
  if (input.provider && !['deepseek', 'bailian'].includes(input.provider)) throw fail('invalidAiProvider');
  if (runtime.provider === 'bailian' && (!input.provider || !input.runtimeRevision || input.historyScope !== 'bailian')) throw fail('assistantClientUpdateRequired', 409);
  if ((input.provider && input.provider !== runtime.provider) || (input.runtimeRevision && input.runtimeRevision !== runtime.revision)
    || (input.historyScope && input.historyScope !== runtime.provider)
    || (input.conversation?.provider && input.conversation.provider !== runtime.provider)) throw fail('assistantProviderChanged', 409);
  // The client snapshot is deliberately ignored. Only this server return value
  // may be persisted by the queue and passed back as req.assistantRuntime.
  return runtime;
}

export function legacyAssistantRuntime(row, env = process.env) {
  return assistantProviderRuntime({ ...row, provider: 'deepseek' }, env);
}

export async function testAiProvider({ input, row, env, deepSeekClientFactory, bailianChat, signal }) {
  const prepared = prepareAiConfiguration(input, row, env, { test: true });
  const { runtime } = prepared;
  let preview;
  if (runtime.provider === 'bailian') {
    const result = await bailianChat({ message: '你好，请用一句话介绍自己。', history: [], runtime, signal });
    preview = result.reply;
  } else {
    const client = deepSeekClientFactory({ apiKey: prepared.row.api_key });
    const payload = await client.chat.completions.create({ model: runtime.model, max_tokens: 200,
      messages: [{ role: 'system', content: 'Reply with a short confirmation that the connection works.' }, { role: 'user', content: 'Connection test' }],
      thinking: { type: 'enabled' }, reasoning_effort: 'high', stream: false }, { signal });
    preview = String(payload?.choices?.[0]?.message?.content || '').trim();
  }
  if (!preview) throw fail('aiInvalidResponse', 502);
  return { ok: true, provider: runtime.provider, model: runtime.model, preview: preview.slice(0, 160) };
}
