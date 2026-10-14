import { createAccountSyncScheduler } from '../accountSyncScheduler';

const advance = ms => jest.advanceTimersByTimeAsync(ms);
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1700000000000); });
afterEach(() => { jest.useRealTimers(); });
const worker = (run, options = {}) => createAccountSyncScheduler({ run, random: () => 0, ...options });

test('fifty triggers coalesce and cannot overlap an in-flight pass', async () => {
  let finish;
  const run = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ failed: false });
  const sync = worker(run); sync.start();
  await advance(749); expect(run).not.toHaveBeenCalled();
  await advance(1); expect(run).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 50; i++) sync.request();
  await advance(10000); expect(run).toHaveBeenCalledTimes(1);
  finish({ failed: false }); await advance(0);
  await advance(1499); expect(run).toHaveBeenCalledTimes(1);
  await advance(1); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toEqual(['change']);
  sync.dispose();
});

test('failure cooldown survives new edits and successful retry resets it', async () => {
  const run = jest.fn().mockResolvedValueOnce({ failed: true }).mockResolvedValue({ failed: false });
  const complete = jest.fn(); const sync = worker(run, { onComplete: complete }); sync.start();
  await advance(750);
  for (let i = 0; i < 50; i++) sync.request();
  await advance(4999); expect(run).toHaveBeenCalledTimes(1);
  await advance(1); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toContain('change');
  expect(complete.mock.calls.map(([status]) => status.failed)).toEqual([true, false]);
  sync.request(); await advance(1500); expect(run).toHaveBeenCalledTimes(3);
  sync.dispose();
});

test('automatic retries back off exponentially and retain jitter at the cap', async () => {
  const run = jest.fn().mockResolvedValue({ failed: true });
  const sync = worker(run); sync.start(); await advance(750);
  for (const delay of [5000, 10000, 20000, 40000, 80000, 96000, 96000]) {
    const before = run.mock.calls.length;
    await advance(delay - 1); expect(run).toHaveBeenCalledTimes(before);
    await advance(1); expect(run).toHaveBeenCalledTimes(before + 1);
  }
  sync.dispose();
  const staggered = worker(run, { random: () => 0.999 });
  staggered.start(); await advance(4994); expect(run).toHaveBeenCalledTimes(8);
  await advance(1); expect(run).toHaveBeenCalledTimes(9);
  for (const delay of [6248, 12497, 24995, 49990, 99980, 119976]) {
    const before = run.mock.calls.length;
    await advance(delay - 1); expect(run).toHaveBeenCalledTimes(before);
    await advance(1); expect(run).toHaveBeenCalledTimes(before + 1);
  }
  staggered.dispose();
});

test('manual retry bypasses cooldown and repeated clicks still coalesce', async () => {
  const run = jest.fn().mockResolvedValueOnce({ failed: true }).mockResolvedValue({ failed: false });
  const sync = worker(run); sync.start(); await advance(750);
  for (let i = 0; i < 50; i++) sync.request('manual');
  await advance(0); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toContain('manual'); sync.dispose();
});

test('server retry-after is a lower bound for automatic retries, including foreground triggers', async () => {
  const run = jest.fn().mockRejectedValueOnce({ retryAfterMs: 20000 }).mockResolvedValue({ failed: false });
  const sync = worker(run); sync.start(); await advance(750);
  sync.request('foreground'); await advance(19999); expect(run).toHaveBeenCalledTimes(1);
  await advance(1); expect(run).toHaveBeenCalledTimes(2);
  sync.dispose();
});

test('continuous queued work cannot postpone the periodic download pass', async () => {
  const run = jest.fn().mockResolvedValue({ failed: false, more: true });
  const sync = worker(run); sync.start(); await advance(750);
  await advance(29999);
  expect(run.mock.calls.slice(1).every(([reasons]) => !reasons.includes('periodic'))).toBe(true);
  await advance(1);
  expect(run.mock.calls.at(-1)[0]).toContain('periodic');
  sync.dispose();
});

test('background pause, account invalidation and disposal stop queued or follow-up work', async () => {
  let active = true, current = true, finish;
  const run = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ failed: false });
  const complete = jest.fn();
  const sync = worker(run, { isCurrent: () => current, isActive: () => active, onComplete: complete });
  sync.start(); active = false; sync.pause(); await advance(60000); expect(run).not.toHaveBeenCalled();
  active = true; sync.request('foreground'); await advance(1500); expect(run).toHaveBeenCalledTimes(1);
  sync.request(); current = false; finish({ failed: true, more: true }); await advance(120000);
  expect(run).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled();
  sync.dispose();
  const next = worker(run); next.start(); next.dispose(); await advance(120000);
  expect(run).toHaveBeenCalledTimes(1);
});
