const listeners = new Set();
export function subscribeAccountData(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function notifyAccountData(owner, kind, remote = false) {
  for (const listener of listeners) { try { listener({ owner, kind, remote }); } catch { /* Views cannot abort a committed write. */ } }
}
