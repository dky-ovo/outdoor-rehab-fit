// One budget covers provider work and the catalogue reads that surround it.
// Aborting also reaches the SDK transport; Promise.race alone would leave it running.
const budgets = new WeakMap();
export function createAssistantDeadline({ timeoutMs, signal, code = 'deepSeekUnavailable' }) {
  const controller = new AbortController();
  const pending = new Set();
  const ancestors = [pending, ...(budgets.get(signal) || [])];
  budgets.set(controller.signal, ancestors);
  let rejectDeadline;
  const expired = new Promise((_, reject) => { rejectDeadline = reject; });
  // An already-aborted parent is valid, even before the first run() call.
  void expired.catch(() => {});
  const abort = () => {
    if (controller.signal.aborted) return;
    const error = Object.assign(new Error(code), { code });
    rejectDeadline(error);
    controller.abort(error);
  };
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return {
    signal: controller.signal,
    run(action) {
      const operation = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return action(controller.signal);
      });
      // The containing job can retain its slot until the actual SDK request
      // settles, even if this helper's shorter deadline has already rejected.
      for (const tasks of ancestors) tasks.add(operation);
      const release = () => { for (const tasks of ancestors) tasks.delete(operation); };
      void operation.then(release, release);
      return Promise.race([expired, operation]);
    },
    async whenIdle() {
      while (pending.size) await Promise.all([...pending].map(operation => operation.catch(() => {})));
    },
    close() { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}
