const states = new Map(), listeners = new Set(), retries = new Set();
export const getAccountSyncStatus = owner => states.get(owner) || { state: 'pending' };
export function setAccountSyncStatus(owner, value) {
  states.set(owner, { ...states.get(owner), ...value });
  for (const listener of listeners) listener(owner);
}
export function subscribeAccountSyncStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function subscribeAccountSyncRetry(listener) { retries.add(listener); return () => retries.delete(listener); }
export function retryAccountSync(owner) { for (const listener of retries) listener(owner); }
