import AsyncStorage from '@react-native-async-storage/async-storage';
import { beginAssistantJob, pendingAssistantJobs, resumeAssistantJobs, recheckAssistantJobs, assistantJobStage } from '../assistantJobs';
import { appendAssistantJobMessages } from '../assistantConversations';
import { createAssistantJob, getAssistantJob } from '../api';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../api', () => ({ createAssistantJob: jest.fn(), getAssistantJob: jest.fn() }));
let mockId = 0;
jest.mock('../assistantConversations', () => ({ createAssistantSessionId: () => `recovery-${++mockId}`, appendAssistantJobMessages: jest.fn() }));
let owner;
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); owner = `owner-${++mockId}`;
  appendAssistantJobMessages.mockResolvedValue(undefined);
  createAssistantJob.mockResolvedValue({ status: 'queued' });
});
const begin = (conversationId = 'conversation') => beginAssistantJob({ scope: { owner, locale: 'zh' }, conversationId, request: { message: '下背痛可以用什么器械' }, token: 'token' });
test('network and authorization failures are visible while retries retain the exact original ID', async () => {
  createAssistantJob.mockRejectedValueOnce({ status: 0, code: 'networkError' });
  const id = await begin();
  expect((await pendingAssistantJobs(owner))[0]).toMatchObject({ stage: 'reconnecting', lastError: 'networkError', accepted: false });
  await recheckAssistantJobs({ owner, token: 'token' });
  expect(createAssistantJob.mock.calls.map(args => args[1])).toEqual([id, id]);
  getAssistantJob.mockRejectedValueOnce({ status: 401, code: 'unauthorized' });
  await resumeAssistantJobs({ owner, token: 'token' });
  expect((await pendingAssistantJobs(owner))[0].stage).toBe('authentication_required');
});
test('long server processing changes waiting presentation without deleting or recreating the job', async () => {
  expect(assistantJobStage({ createdAt: 100, stage: 'running' }, 90200)).toBe('waiting');
  expect(assistantJobStage({ createdAt: 100, stage: 'running' }, 1000)).toBe('running');
  const id = await begin();
  getAssistantJob.mockResolvedValue({ status: 'running' });
  await recheckAssistantJobs({ owner, token: 'token' });
  expect(createAssistantJob).toHaveBeenCalledTimes(1);
  expect((await pendingAssistantJobs(owner))[0].id).toBe(id);
});
test('a received result survives history-save failure and recovers without another HTTP call', async () => {
  const id = await begin();
  getAssistantJob.mockResolvedValue({ status: 'complete', result: { reply: 'stored answer' } });
  appendAssistantJobMessages.mockRejectedValueOnce(new Error('storage busy'));
  await resumeAssistantJobs({ owner, token: 'token' });
  expect((await pendingAssistantJobs(owner))[0]).toMatchObject({ id, stage: 'save_failed', completion: { result: { reply: 'stored answer' } } });
  await recheckAssistantJobs({ owner, token: 'token' });
  expect(getAssistantJob).toHaveBeenCalledTimes(1);
  expect(await pendingAssistantJobs(owner)).toEqual([]);
});
test('one stalled poll does not block a completed reply for another conversation', async () => {
  const first = await begin('one');
  getAssistantJob.mockResolvedValue({ status: 'running' });
  const second = await begin('two');
  let finish;
  getAssistantJob.mockImplementation((_token, id) => id === first ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ status: 'complete', result: { reply: 'second answer' } }));
  const pending = resumeAssistantJobs({ owner, token: 'token' });
  for (let n = 0; n < 50 && !(appendAssistantJobMessages.mock.calls.some(([args]) => args.messages.some(message => message.id === `${second}-answer`))); n++) await Promise.resolve();
  expect(appendAssistantJobMessages.mock.calls.some(([args]) => args.messages.some(message => message.id === `${second}-answer`))).toBe(true);
  finish({ status: 'running' }); await pending;
  expect((await pendingAssistantJobs(owner)).map(task => task.id)).toEqual([first]);
});

test('same conversation ID on two providers reconciles each response to its original provider scope', async () => {
  const ds = await begin('same');
  getAssistantJob.mockResolvedValue({ status: 'running', provider: 'deepseek' });
  createAssistantJob.mockResolvedValue({ status: 'queued', provider: 'bailian', model: 'qwen' });
  const b = await beginAssistantJob({ scope: { owner, locale: 'zh', provider: 'bailian' }, conversationId: 'same', request: { message: 'Bailian question', provider: 'bailian', historyScope: 'bailian', runtimeRevision: 'r1' }, token: 'token' });
  expect((await pendingAssistantJobs(owner)).map(task => task.scope.provider)).toEqual(['deepseek', 'bailian']);
  getAssistantJob.mockImplementation(async (_token, id) => id === ds
    ? { status: 'complete', provider: 'deepseek', result: { reply: 'ds reply' } }
    : { status: 'complete', provider: 'bailian', model: 'qwen', result: { reply: 'raw reply', provider: 'bailian', model: 'qwen', responsePolicy: 'provider_raw' } });
  await resumeAssistantJobs({ owner, token: 'token' });
  const completions = appendAssistantJobMessages.mock.calls.map(([value]) => value).filter(value => value.messages.some(message => message.sender === 'ai'));
  expect(completions.find(value => value.messages.some(message => message.id === `${ds}-answer`)).provider).toBe('deepseek');
  expect(completions.find(value => value.messages.some(message => message.id === `${b}-answer`))).toMatchObject({ provider: 'bailian', messages: expect.arrayContaining([expect.objectContaining({ reply: 'raw reply', provider: 'bailian', model: 'qwen', responsePolicy: 'provider_raw' })]) });
  expect(await pendingAssistantJobs(owner)).toEqual([]);
});

test('a wrong-provider result never enters history and runtime-switch errors retain their code', async () => {
  createAssistantJob.mockResolvedValue({ status: 'complete', provider: 'deepseek', result: { reply: 'must not merge' } });
  await beginAssistantJob({ scope: { owner, locale: 'en', provider: 'bailian' }, conversationId: 'b', request: { message: 'q' }, token: 'token' });
  expect(JSON.stringify(appendAssistantJobMessages.mock.calls)).not.toContain('must not merge');
  expect(appendAssistantJobMessages.mock.calls.at(-1)[0].messages.at(-1)).toMatchObject({ action: 'error', provider: 'bailian', errorCode: 'assistantProviderMismatch' });
  createAssistantJob.mockRejectedValue({ status: 409, code: 'assistantProviderChanged' });
  await begin('changed');
  expect(appendAssistantJobMessages.mock.calls.at(-1)[0].messages.at(-1).errorCode).toBe('assistantProviderChanged');
});

test('a v2 endpoint missing after rollback preserves both unaccepted and accepted tasks until compatible service returns', async () => {
  const unavailable = { status: 503, code: 'assistantClientUpdateRequired' };
  createAssistantJob.mockRejectedValueOnce(unavailable);
  const first = await begin('unaccepted');
  expect((await pendingAssistantJobs(owner))[0]).toMatchObject({ id: first, accepted: false, stage: 'reconnecting', lastError: 'assistantClientUpdateRequired' });
  expect(appendAssistantJobMessages.mock.calls.every(([value]) => value.messages.every(message => message.sender === 'user'))).toBe(true);
  createAssistantJob.mockResolvedValue({ status: 'queued', provider: 'deepseek' });
  await resumeAssistantJobs({ owner, token: 'token' });
  getAssistantJob.mockRejectedValueOnce(unavailable);
  await resumeAssistantJobs({ owner, token: 'token' });
  expect((await pendingAssistantJobs(owner))[0]).toMatchObject({ id: first, accepted: true, stage: 'reconnecting' });
  getAssistantJob.mockResolvedValue({ status: 'complete', provider: 'deepseek', result: { provider: 'deepseek', reply: 'original task answer' } });
  await resumeAssistantJobs({ owner, token: 'token' });
  expect(await pendingAssistantJobs(owner)).toEqual([]);
  expect(createAssistantJob.mock.calls.map(([, id]) => id)).toEqual([first, first]);
  expect(appendAssistantJobMessages.mock.calls.at(-1)[0].messages.at(-1).reply).toBe('original task answer');
});
