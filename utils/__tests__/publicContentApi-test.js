import { ApiError, API_BASE_URL, getPublicContent, PUBLIC_CONTENT_REQUEST_TIMEOUT_MS } from '../api';

const originalFetch = global.fetch;
const originalAbortController = global.AbortController;
const stalled = () => new Promise(() => {});
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; global.AbortController = originalAbortController; });

test.each(['fetch', 'body'])('public content bounds a stalled %s even if transport ignores abort', async stage => {
  global.fetch.mockImplementation(stage === 'fetch' ? stalled : async () => ({ ok: true, status: 200, json: stalled }));
  const settled = jest.fn();
  const result = getPublicContent('exercise_videos').catch(error => { settled(error); return error; });
  await jest.advanceTimersByTimeAsync(PUBLIC_CONTENT_REQUEST_TIMEOUT_MS - 1);
  expect(settled).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBeInstanceOf(ApiError);
  expect(await result).toMatchObject({ code: 'publicContentTimeout', status: 0 });
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('public content retains its deadline without native AbortController', async () => {
  global.AbortController = undefined;
  global.fetch.mockImplementation(stalled);
  const result = getPublicContent('exercise_videos').catch(error => error);
  await jest.advanceTimersByTimeAsync(PUBLIC_CONTENT_REQUEST_TIMEOUT_MS);
  expect(await result).toMatchObject({ code: 'publicContentTimeout', status: 0 });
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['fetch', 'body'])('caller cancellation settles stalled %s promptly and clears the deadline', async stage => {
  const controller = new AbortController();
  global.fetch.mockImplementation(stage === 'fetch' ? stalled : async () => ({ ok: true, status: 200, json: stalled }));
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  const result = getPublicContent('exercise_videos', { signal: controller.signal }).catch(error => error);
  await Promise.resolve();
  controller.abort();
  expect(await result).toMatchObject({ code: 'requestCancelled', status: 0 });
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
});

test('an already cancelled load does not start a fetch', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(getPublicContent('exercise_videos', { signal: controller.signal })).rejects.toMatchObject({ code: 'requestCancelled' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('successful public content preserves items and removes its timer and cancellation listener', async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  const payload = { items: [{ id: 'one', title: 'Synthetic published video' }] };
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });
  await expect(getPublicContent('exercise videos', { signal: controller.signal })).resolves.toBe(payload);
  expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/content?pageKey=exercise%20videos`, expect.objectContaining({ method: 'GET', headers: {} }));
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
  controller.abort();
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
});
