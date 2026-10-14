import { assistantProviderConfiguration, ASSISTANT_PROVIDER_PROTOCOL } from './assistantProviders.js';
import { createAssistantDeadline } from './assistantDeadline.js';

export const BAILIAN_CHAT_POLICY = 'bailian-chat-raw-v1';
export const BAILIAN_CHAT_TIMEOUT_MS = 60000;
export const BAILIAN_CHAT_MAX_REPLY_CHARS = 12000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const fail = code => Object.assign(new Error(code), { code });

// Unlike the existing optional FAQ selector, this transport remains available
// when BAILIAN_FAQ_ENABLED=false. Importing or constructing it makes no request.
export function readBailianChatConfig(env = process.env, { model } = {}) {
  return assistantProviderConfiguration({ provider: 'bailian', model }, {}, env);
}

function publicRuntime(value) {
  if (!value || value.provider !== 'bailian' || value.scope !== 'bailian'
    || value.protocol !== ASSISTANT_PROVIDER_PROTOCOL || value.promptMode !== 'none' || value.faqEnabled !== false
    || typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(value.model)
    || typeof value.revision !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.revision)) throw fail('BAILIAN_CHAT_INVALID_INPUT');
  return { provider: 'bailian', model: value.model, scope: 'bailian', revision: value.revision,
    promptMode: 'none', faqEnabled: false, protocol: ASSISTANT_PROVIDER_PROTOCOL };
}

function inputMessages(message, history) {
  if (typeof message !== 'string' || !message.trim() || message.length > 600 || !Array.isArray(history)) throw fail('BAILIAN_CHAT_INVALID_INPUT');
  const selected = history.filter(item => item && ['user', 'assistant'].includes(item.role)).slice(-8);
  if (selected.some(item => typeof item.content !== 'string' || !item.content.trim() || item.content.length > 6000)) throw fail('BAILIAN_CHAT_INVALID_INPUT');
  // Do not forward system/developer/tool roles or any unselected object fields.
  // Provider-history provenance is enforced by the caller before this boundary.
  return [...selected.map(({ role, content }) => ({ role, content })), { role: 'user', content: message }];
}

async function responsePayload(response, signal) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw fail('BAILIAN_CHAT_INVALID_RESPONSE');
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks, size);
      return JSON.parse(bytes.toString('utf8'));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  // Injectable test transports can expose json() without a streaming body.
  const payload = await response.json();
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESPONSE_BYTES) throw fail('BAILIAN_CHAT_INVALID_RESPONSE');
  return payload;
}

export function createBailianChatClient(env = process.env, { fetchImpl = globalThis.fetch, timeoutMs = BAILIAN_CHAT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BAILIAN_CHAT_TIMEOUT_MS) throw fail('BAILIAN_CHAT_CLIENT_INVALID');
  // Read credentials lazily: a server still using DeepSeek can start before the
  // optional DASHSCOPE key is provisioned. Only an actual Bailian call needs it.
  return async function bailianChat({ message, history = [], signal, runtime } = {}) {
    const snapshot = publicRuntime(runtime);
    const messages = inputMessages(message, history);
    const config = readBailianChatConfig(env, { model: snapshot.model });
    const budget = createAssistantDeadline({ timeoutMs, signal, code: 'BAILIAN_CHAT_UNAVAILABLE' });
    try {
      return await budget.run(async childSignal => {
        const response = await fetchImpl(config.url, {
          method: 'POST', redirect: 'error', signal: childSignal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages, enable_thinking: false, stream: false, max_tokens: 2048 }),
        });
        if (!response.ok) throw fail('BAILIAN_CHAT_UNAVAILABLE');
        let payload;
        try { payload = await responsePayload(response, childSignal); }
        catch { throw fail('BAILIAN_CHAT_INVALID_RESPONSE'); }
        const choice = payload?.choices?.[0], content = choice?.message?.content;
        if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || choice.message?.function_call
          || (choice.message?.role && choice.message.role !== 'assistant')
          || typeof content !== 'string' || !content.trim() || content.length > BAILIAN_CHAT_MAX_REPLY_CHARS) throw fail('BAILIAN_CHAT_INVALID_RESPONSE');
        childSignal.throwIfAborted();
        // Keep provider text exactly as received, even if it looks like selector
        // JSON. Never parse it as a FAQ ID or replace it with application prose.
        return { ...snapshot, reply: content, responsePolicy: BAILIAN_CHAT_POLICY, action: 'general',
          recommendations: [], recommendationsFinal: true, confirmationRequired: false, deepSeekUsed: false };
      });
    } catch (error) {
      throw fail(error?.code === 'BAILIAN_CHAT_INVALID_RESPONSE' ? 'BAILIAN_CHAT_INVALID_RESPONSE' : 'BAILIAN_CHAT_UNAVAILABLE');
    } finally { budget.close(); }
  };
}
