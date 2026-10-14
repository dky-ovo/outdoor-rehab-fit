import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAssistantJob, getAssistantJob } from './api';
import { appendAssistantJobMessages, createAssistantSessionId } from './assistantConversations';

const queues = new Map();
const running = new Map();
const listeners = new Set();
export const subscribeAssistantJobs = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const changed = owner => { for (const listener of listeners) { try { listener(owner); } catch { /* A screen cannot interrupt durable delivery. */ } } };
export const ASSISTANT_WAIT_NOTICE_MS = 90000;
export function assistantJobStage(task, now = Date.now()) {
  if (['reconnecting', 'authentication_required', 'save_failed', 'saving'].includes(task.stage)) return task.stage;
  return now - task.createdAt >= ASSISTANT_WAIT_NOTICE_MS ? 'waiting' : task.stage || (task.accepted ? 'queued' : 'submitting');
}
const key = owner => `@outdoor_fit_ai_jobs_v1:${encodeURIComponent(owner)}`;
const read = async owner => {
  const value = JSON.parse(await AsyncStorage.getItem(key(owner)) || '[]');
  if (!Array.isArray(value)) throw new Error('ASSISTANT_OUTBOX_INVALID');
  return value.map(task => {
    const provider = task.scope?.provider || 'deepseek';
    if (!['deepseek', 'bailian'].includes(provider) || task.scope?.owner !== owner
      || task.request?.provider != null && task.request.provider !== provider) throw new Error('ASSISTANT_OUTBOX_INVALID');
    return { ...task, scope: { ...task.scope, provider } };
  });
};
function serial(owner, action) {
  const task = (queues.get(owner) || Promise.resolve()).then(action);
  const tail = task.catch(() => {}); queues.set(owner, tail);
  void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner); });
  return task;
}
const save = (owner, tasks) => AsyncStorage.setItem(key(owner), JSON.stringify(tasks));

export async function beginAssistantJob({ scope, conversationId, request, token, userMessageId }) {
  const provider = scope.provider || 'deepseek';
  if (!['deepseek', 'bailian'].includes(provider) || request.provider != null && request.provider !== provider
    || request.historyScope != null && request.historyScope !== provider) throw Object.assign(new Error('assistantProviderMismatch'), { code: 'assistantProviderMismatch' });
  scope = { ...scope, provider };
  const id = `job-${createAssistantSessionId()}`;
  const messageId = userMessageId || `${id}-user`;
  const task = { id, scope, conversationId, request: { ...request, provider, historyScope: provider, conversation: {
    id: conversationId, locale: scope.locale, provider, userMessageId: messageId, createdAt: new Date().toISOString(),
  } }, userMessageId: messageId, createdAt: Date.now(), accepted: false, stage: 'submitting' };
  await serial(scope.owner, async () => {
    const tasks = await read(scope.owner);
    if (tasks.some(x => x.conversationId === conversationId && x.scope.locale === scope.locale && x.scope.provider === provider)) throw Object.assign(new Error('assistantJobBusy'), { code: 'assistantJobBusy' });
    // Persist the outbox before contacting the server. A retry keeps the same ID.
    await save(scope.owner, [...tasks, task]);
    await appendAssistantJobMessages({ ...scope, conversationId, messages: [{ id: task.userMessageId, sender: 'user', text: request.message, provider }] });
  });
  changed(scope.owner);
  // Sending is independent of page lifetime. Foreground reconciliation resumes
  // an uncertain POST with the same id; the server never generates it twice.
  await resumeAssistantJobs({ owner: scope.owner, token });
  return id;
}

export const pendingAssistantJobs = owner => serial(owner, async () => (await read(owner)).map(task => ({ ...task, stage: assistantJobStage(task) })));
// Explicit retry reconciles the existing durable IDs. It never adds another
// question or provider job when the first response may have been lost.
export async function recheckAssistantJobs({ owner, token }) {
  await running.get(owner)?.catch(() => {});
  return resumeAssistantJobs({ owner, token });
}
export function resumeAssistantJobs({ owner, token }) {
  if (running.has(owner)) return running.get(owner);
  const operation = (async () => {
    const tasks = await pendingAssistantJobs(owner);
    const reconcile = async task => {
      let job;
      try {
        job = task.completion || (task.accepted ? await getAssistantJob(token, task.id) : await createAssistantJob(token, task.id, task.request));
        if (!job || !['queued', 'running', 'complete', 'failed'].includes(job.status)) throw Object.assign(new Error('assistantInvalidStatus'), { code: 'assistantInvalidStatus' });
        // Legacy jobs have no provider field and belong to DeepSeek only. Never
        // reinterpret a returned answer as the provider currently on screen.
        if ((job.provider || 'deepseek') !== task.scope.provider
          || job.result?.provider != null && job.result.provider !== task.scope.provider
          || task.scope.provider === 'bailian' && job.status === 'complete' && job.model && job.model !== job.result?.model) {
          throw Object.assign(new Error('assistantProviderMismatch'), { code: 'assistantProviderMismatch', status: 409 });
        }
      } catch (error) {
        // A disconnect, suspended JS runtime or timeout does not mean failure.
        if (!error.status || error.status >= 500 || error.status === 401 || error.status === 429 || error.code === 'assistantJobBusy') {
          await serial(owner, async () => {
            const current = await read(owner), entry = current.find(x => x.id === task.id);
            if (!entry) return;
            entry.stage = error.status === 401 ? 'authentication_required' : 'reconnecting';
            entry.lastError = /^[A-Za-z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'networkError';
            entry.lastCheckedAt = Date.now();
            await save(owner, current);
          });
          changed(owner);
          return;
        }
        job = { status: 'failed', error: error.code };
      }
      await serial(owner, async () => {
        const current = await read(owner), entry = current.find(x => x.id === task.id);
        if (!entry) return;
        if (job.status === 'complete' && (!job.result || Array.isArray(job.result) || ![job.result.text, job.result.reply].some(x => typeof x === 'string' && x.trim()))) job = { status: 'failed', error: 'deepSeekInvalidResponse' };
        if (['complete', 'failed'].includes(job.status)) {
          if (job.status === 'complete') job.result = { ...job.result, provider: task.scope.provider,
            text: typeof job.result.text === 'string' && job.result.text.trim() ? job.result.text : undefined,
            reply: typeof job.result.reply === 'string' && job.result.reply.trim() ? job.result.reply : undefined };
          // Persist a received answer before merging history. A storage/merge
          // failure can then retry locally even after server job retention ends.
          entry.completion = job;
          entry.stage = 'saving';
          entry.lastCheckedAt = Date.now();
          await save(owner, current);
          const failure = job.error === 'deepSeekInvalidResponse'
            ? (task.scope.locale === 'en' ? 'No complete reply was received. Please send your question again.' : '未收到完整回覆，請重新發送您的問題。')
            : job.error === 'assistantTimeout'
              ? (task.scope.locale === 'en' ? 'The reply timed out. Please send your question again.' : '回覆等候逾時，請重新發送您的問題。')
              : (task.scope.locale === 'en' ? 'This request could not be completed. Your question is saved; please send it again.' : '此查詢未能完成。您的問題已保留，請重新發送。');
          const message = job.status === 'complete' ? { ...job.result, id: `${task.id}-answer`, sender: 'ai' }
            : { id: `${task.id}-answer`, sender: 'ai', provider: task.scope.provider, errorCode: /^[A-Za-z0-9_]{1,64}$/.test(job.error || '') ? job.error : 'assistantUnavailable', action: ['unauthorized','accountDeleted'].includes(job.error) ? 'auth_error' : 'error', reply: failure, recommendations: [] };
          try {
            await appendAssistantJobMessages({ ...task.scope, conversationId: task.conversationId, messages: [
              { id: task.userMessageId, sender: 'user', text: task.request.message, provider: task.scope.provider }, message,
            ] });
            await save(owner, current.filter(x => x.id !== task.id));
          } catch {
            entry.stage = 'save_failed';
            entry.lastError = 'ASSISTANT_LOCAL_SAVE_FAILED';
            await save(owner, current);
          }
        } else {
          entry.accepted = true;
          entry.stage = job.status;
          entry.lastCheckedAt = Date.now();
          delete entry.lastError;
          await save(owner, current);
        }
      });
      changed(owner);
    };
    // One slow poll must not delay completed answers in other conversations.
    // Bound parallel requests rather than allowing an accumulated outbox burst.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        try { await reconcile(task); } catch { changed(owner); }
      }
    }));
  })().finally(() => { running.delete(owner); });
  running.set(owner, operation); return operation;
}
