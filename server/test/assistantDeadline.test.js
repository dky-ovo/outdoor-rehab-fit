import test from 'node:test';
import assert from 'node:assert/strict';
import { deepSeekSymptomRecommendations } from '../src/mysqlAssistantSymptomRecommendations.js';
import { completeAssistantWithGuide } from '../src/mysqlAssistantGuide.js';
import { createAssistantDeadline } from '../src/assistantDeadline.js';

const input = { model: 'deepseek-v4-flash', question: '下背痛可以用什么器械', history: [], locale: 'zh', concern: { targets: ['back'] }, catalog: [] };
const payload = { choices: [{ finish_reason: 'stop', message: { content: '{"style":"direct","recommendations":[]}' } }] };
test('MySQL symptom post-provider catalogue reread shares the deadline', async () => {
  let read = false;
  await assert.rejects(deepSeekSymptomRecommendations({ ...input, timeoutMs: 15,
    client: { chat: { completions: { create: async () => payload } } },
    getCatalog: () => { read = true; return new Promise(() => {}); },
  }), { code: 'deepSeekUnavailable' });
  assert.equal(read, true);
});
test('parent cancellation prevents a delayed catalogue path from starting a provider call', async () => {
  let calls = 0;
  const parent = new AbortController(); parent.abort();
  await assert.rejects(deepSeekSymptomRecommendations({ ...input, signal: parent.signal,
    client: { chat: { completions: { create: async () => { calls++; return payload; } } } }, getCatalog: () => [],
  }), { code: 'deepSeekUnavailable' });
  assert.equal(calls, 0);
});
test('parent cancellation reaches the running provider transport without retrying', async () => {
  const parent = new AbortController(); let transportSignal, calls = 0;
  const pending = completeAssistantWithGuide({ signal: parent.signal, body: { messages: [] }, access: {},
    client: { chat: { completions: { create: (_body, { signal }) => {
      calls++; transportSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } } } },
  });
  await Promise.resolve(); parent.abort();
  await assert.rejects(pending, { code: 'deepSeekUnavailable' });
  assert.equal(calls, 1); assert.equal(transportSignal.aborted, true);
});
test('a parent retains unfinished provider work after a shorter child timeout', async () => {
  const parent = createAssistantDeadline({ timeoutMs: 1000 });
  let finish, idle = false;
  try {
    await assert.rejects(completeAssistantWithGuide({ signal: parent.signal, timeoutMs: 15, body: { messages: [] }, access: {},
      client: { chat: { completions: { create: () => new Promise(resolve => { finish = resolve; }) } } },
    }), { code: 'deepSeekUnavailable' });
    const waiting = parent.whenIdle().then(() => { idle = true; });
    await Promise.resolve(); assert.equal(idle, false);
    finish(payload); await waiting; assert.equal(idle, true);
  } finally { finish?.(payload); parent.close(); }
});
