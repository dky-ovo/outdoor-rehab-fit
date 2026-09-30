import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAssistantJob, getAssistantJob } from './api';
import { appendAssistantJobMessages, createAssistantSessionId } from './assistantConversations';

const queues = new Map();
const running = new Map();
const listeners = new Set();
export const subscribeAssistantJobs = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const changed = owner => { for (const listener of listeners) listener(owner); };
const key = owner => `@outdoor_fit_ai_jobs_v1:${encodeURIComponent(owner)}`;
const read = async owner => {
  const value = JSON.parse(await AsyncStorage.getItem(key(owner)) || '[]');
  if (!Array.isArray(value)) throw new Error('ASSISTANT_OUTBOX_INVALID');
  return value;
};
function serial(owner, action) {
  const task = (queues.get(owner) || Promise.resolve()).then(action);
  const tail = task.catch(() => {}); queues.set(owner, tail);
  void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner); });
  return task;
}
const save = (owner, tasks) => AsyncStorage.setItem(key(owner), JSON.stringify(tasks));

export async function beginAssistantJob({ scope, conversationId, request, token, userMessageId }) {
  const id = `job-${createAssistantSessionId()}`;
  const messageId = userMessageId || `${id}-user`;
  const task = { id, scope, conversationId, request: { ...request, conversation: {
    id: conversationId, locale: scope.locale, userMessageId: messageId, createdAt: new Date().toISOString(),
  } }, userMessageId: messageId, createdAt: Date.now(), accepted: false };
  await serial(scope.owner, async () => {
    const tasks = await read(scope.owner);
    if (tasks.some(x => x.conversationId === conversationId && x.scope.locale === scope.locale)) throw Object.assign(new Error('assistantJobBusy'), { code: 'assistantJobBusy' });
    // Persist the outbox before contacting the server. A retry keeps the same ID.
    await save(scope.owner, [...tasks, task]);
    await appendAssistantJobMessages({ ...scope, conversationId, messages: [{ id: task.userMessageId, sender: 'user', text: request.message }] });
  });
  changed(scope.owner);
  // Sending is independent of page lifetime. Foreground reconciliation resumes
  // an uncertain POST with the same id; the server never generates it twice.
  await resumeAssistantJobs({ owner: scope.owner, token });
  return id;
}

export const pendingAssistantJobs = owner => serial(owner, () => read(owner));
export function resumeAssistantJobs({ owner, token }) {
  if (running.has(owner)) return running.get(owner);
  const operation = (async () => {
    const tasks = await pendingAssistantJobs(owner);
    for (const task of tasks) {
      let job;
      try {
        job = task.accepted ? await getAssistantJob(token, task.id) : await createAssistantJob(token, task.id, task.request);
      } catch (error) {
        // A disconnect, suspended JS runtime or timeout does not mean failure.
        if (!error.status || error.status >= 500 || error.status === 401) continue;
        job = { status: 'failed', error: error.code };
      }
      await serial(owner, async () => {
        const current = await read(owner), entry = current.find(x => x.id === task.id);
        if (!entry) return;
        if (job.status === 'complete' && (!job.result || Array.isArray(job.result) || ![job.result.text, job.result.reply].some(x => typeof x === 'string' && x.trim()))) job = { status: 'failed', error: 'deepSeekInvalidResponse' };
        if (['complete', 'failed'].includes(job.status)) {
          if (job.status === 'complete') job.result = { ...job.result,
            text: typeof job.result.text === 'string' && job.result.text.trim() ? job.result.text : undefined,
            reply: typeof job.result.reply === 'string' && job.result.reply.trim() ? job.result.reply : undefined };
          const failure = job.error === 'deepSeekInvalidResponse'
            ? (task.scope.locale === 'en' ? 'No complete reply was received. Please send your question again.' : '未收到完整回覆，請重新發送您的問題。')
            : job.error === 'assistantTimeout'
              ? (task.scope.locale === 'en' ? 'The reply timed out. Please send your question again.' : '回覆等候逾時，請重新發送您的問題。')
              : (task.scope.locale === 'en' ? 'This request could not be completed. Your question is saved; please send it again.' : '此查詢未能完成。您的問題已保留，請重新發送。');
          const message = job.status === 'complete' ? { ...job.result, id: `${task.id}-answer`, sender: 'ai' }
            : { id: `${task.id}-answer`, sender: 'ai', action: ['unauthorized','accountDeleted'].includes(job.error) ? 'auth_error' : 'error', reply: failure, recommendations: [] };
          await appendAssistantJobMessages({ ...task.scope, conversationId: task.conversationId, messages: [
            { id: task.userMessageId, sender: 'user', text: task.request.message }, message,
          ] });
          await save(owner, current.filter(x => x.id !== task.id));
        } else {
          entry.accepted = true;
          await save(owner, current);
        }
      });
      changed(owner);
    }
  })().finally(() => { running.delete(owner); });
  running.set(owner, operation); return operation;
}
