// One account worker, one timer. Local writes stay in their existing durable
// journals; triggers here only coalesce when to attempt that work.
export function createAccountSyncScheduler({
  run, isCurrent = () => true, isActive = () => true,
  onStart = () => {}, onComplete = () => {}, random = Math.random,
  initialDelayMs = 750, initialJitterMs = 4250,
  changeDelayMs = 1500, changeJitterMs = 1500,
  intervalMs = 30000, intervalJitterMs = 15000,
  retryBaseMs = 5000, retryMaxMs = 120000,
}) {
  let disposed = false, running = false, timer, dueAt = 0, retryAt = 0, periodicAt = 0, failures = 0;
  const reasons = new Set();
  const current = () => !disposed && isCurrent();
  const spread = (base, jitter) => base + Math.floor(random() * jitter);
  const clear = () => { clearTimeout(timer); timer = undefined; dueAt = 0; };
  const schedule = delay => {
    if (!current() || !isActive() || running) return;
    const due = Math.max(Math.min(Date.now() + delay, periodicAt || Infinity), retryAt);
    if (timer !== undefined && due >= dueAt) return;
    clear(); dueAt = due;
    timer = setTimeout(() => {
      timer = undefined; dueAt = 0;
      if (!current() || !isActive()) return;
      if (!reasons.size || periodicAt && Date.now() >= periodicAt) reasons.add('periodic');
      void execute();
    }, Math.max(0, due - Date.now()));
  };
  const execute = async () => {
    if (!current() || !isActive() || running) return;
    running = true;
    const requested = [...reasons]; reasons.clear();
    onStart();
    let result;
    try { result = await run(requested); }
    catch (error) { result = { failed: true, retryAfterMs: error?.retryAfterMs }; }
    running = false;
    if (!current()) return;
    // Frequent local writes must not postpone downloads indefinitely. Periodic
    // work still joins the next serialized pass when its deadline arrives.
    if (requested.some(reason => ['initial', 'periodic', 'manual', 'foreground'].includes(reason))) {
      periodicAt = Date.now() + spread(intervalMs, intervalJitterMs);
    }
    const failed = Boolean(result?.failed);
    if (failed) {
      failures += 1;
      const base = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(failures - 1, 16));
      // Leave room for jitter even at the cap, so a prolonged outage cannot
      // bring every client back on exactly the same two-minute boundary.
      const lower = Math.min(base, Math.floor(retryMaxMs / 1.25));
      const delay = Math.min(retryMaxMs, spread(lower, Math.ceil(lower / 4)));
      const serverDelay = Number.isFinite(result?.retryAfterMs) ? Math.max(0, result.retryAfterMs) : 0;
      // A retry explicitly requested while this pass was running gets one
      // immediate follow-up. Ordinary edits/foreground events respect cooldown.
      retryAt = reasons.has('manual') ? Date.now() : Date.now() + Math.max(delay, serverDelay);
      reasons.add('retry');
    } else { failures = 0; retryAt = 0; }
    if (result?.more) reasons.add('continuation');
    const pending = reasons.size > 0;
    onComplete({ failed, pending });
    if (pending) schedule(reasons.has('manual') ? 0 : spread(changeDelayMs, changeJitterMs));
    else schedule(periodicAt ? Math.max(0, periodicAt - Date.now()) : spread(intervalMs, intervalJitterMs));
  };
  return {
    start() { if (current()) { reasons.add('initial'); schedule(spread(initialDelayMs, initialJitterMs)); } },
    request(reason = 'change') {
      if (!current()) return;
      reasons.add(reason);
      if (reason === 'manual') retryAt = 0;
      schedule(reason === 'manual' ? 0 : spread(changeDelayMs, changeJitterMs));
    },
    pause() { clear(); periodicAt = 0; },
    dispose() { disposed = true; clear(); reasons.clear(); },
  };
}
