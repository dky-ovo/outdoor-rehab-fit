import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { singaporeCompletionUrl } from './assistantBailian.js';

export const ASSISTANT_PROVIDER_PROTOCOL = 2;
export const DEFAULT_BAILIAN_MODEL = 'qwen3-14b-1f1a8952705b';
export const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
export const DEEPSEEK_PROVIDER_BASE_URL = 'https://api.deepseek.com';
const fail = code => Object.assign(new Error(code), { code });
const providers = new Set(['deepseek', 'bailian']);
const deepSeekModels = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

export function assistantProviderMode(env = process.env) {
  return env.ASSISTANT_PROVIDER_MODE === 'deepseek_only' ? 'deepseek_only' : 'multi_provider';
}

// Untagged legacy configuration and conversations belong to DeepSeek.
export function normalizeAssistantProvider(value) {
  return value === 'bailian' ? 'bailian' : 'deepseek';
}

export function normalizeDeepSeekModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  if (model === 'deepseek-chat') return 'deepseek-v4-flash';
  if (model === 'deepseek-reasoner') return 'deepseek-v4-pro';
  return deepSeekModels.has(model) ? model : '';
}

function bailianSettings(env, override) {
  const model = override ?? env.BAILIAN_MODEL_ID ?? DEFAULT_BAILIAN_MODEL;
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(model)) throw fail('BAILIAN_MODEL_ID_REQUIRED');
  const url = singaporeCompletionUrl(env.BAILIAN_BASE_URL || DEFAULT_BAILIAN_BASE_URL);
  return { model, url: url.href, baseURL: url.href.slice(0, -'/chat/completions'.length) };
}

// Public runtime computation never opens secret files or includes secret values.
// A queued job keeps this non-secret snapshot rather than re-selecting a provider
// after an administrator switches the active setting.
export function assistantProviderRuntime(row = {}, env = process.env) {
  const providerMode = assistantProviderMode(env);
  const provider = providerMode === 'deepseek_only' ? 'deepseek' : normalizeAssistantProvider(row?.provider);
  const model = provider === 'bailian' ? bailianSettings(env).model
    : normalizeDeepSeekModel(row?.model) || 'deepseek-v4-flash';
  const revisionInput = {
    protocol: ASSISTANT_PROVIDER_PROTOCOL, provider, model,
    // Keep the v22 revision unchanged when the override is absent. Enabling it
    // invalidates old submissions even if DeepSeek was already selected.
    ...(providerMode === 'deepseek_only' ? { providerMode } : {}),
    updatedAt: row?.updated_at == null ? '' : String(row.updated_at),
    bailianModel: env.BAILIAN_MODEL_ID ?? DEFAULT_BAILIAN_MODEL,
    bailianBaseURL: env.BAILIAN_BASE_URL || DEFAULT_BAILIAN_BASE_URL,
    bailianFaqEnabled: env.BAILIAN_FAQ_ENABLED === 'true',
  };
  return {
    provider, model, scope: provider,
    revision: 'ai-v2-' + createHash('sha256').update(JSON.stringify(revisionInput)).digest('hex').slice(0, 32),
    promptMode: provider === 'bailian' ? 'none' : 'app',
    faqEnabled: provider !== 'bailian', protocol: ASSISTANT_PROVIDER_PROTOCOL,
  };
}

function bailianApiKey(env) {
  let key;
  if (env.DASHSCOPE_API_KEY_FILE !== undefined) {
    try {
      const file = env.DASHSCOPE_API_KEY_FILE;
      if (typeof file !== 'string' || !file || !fs.lstatSync(file).isFile()) throw fail('BAILIAN_API_KEY_FILE_INVALID');
      const info = fs.statSync(file);
      if (info.size > 4096) throw fail('BAILIAN_API_KEY_FILE_INVALID');
      key = fs.readFileSync(file, 'utf8').trim();
    } catch { throw fail('BAILIAN_API_KEY_FILE_INVALID'); }
  } else key = typeof env.DASHSCOPE_API_KEY === 'string' ? env.DASHSCOPE_API_KEY.trim() : '';
  if (!key || key.length > 4096 || /\s|\0/.test(key)) throw fail('BAILIAN_API_KEY_REQUIRED');
  return key;
}

// Private only: callers must never serialize this result into an API response,
// job request or account history. default.model/api_key always remain DeepSeek's.
export function assistantProviderConfiguration(snapshot, row = {}, env = process.env) {
  if (!snapshot || !providers.has(snapshot.provider)) throw fail('ASSISTANT_PROVIDER_INVALID');
  if (snapshot.provider === 'bailian') {
    const settings = bailianSettings(env, snapshot.model);
    return { provider: 'bailian', ...settings, apiKey: bailianApiKey(env) };
  }
  const model = normalizeDeepSeekModel(snapshot.model ?? row?.model);
  const apiKey = typeof row?.api_key === 'string' ? row.api_key.trim() : '';
  if (!model || !apiKey) throw fail('DEEPSEEK_CONFIGURATION_REQUIRED');
  return { provider: 'deepseek', model, apiKey, baseURL: DEEPSEEK_PROVIDER_BASE_URL,
    url: DEEPSEEK_PROVIDER_BASE_URL + '/chat/completions' };
}
