// Only authenticated requests captured during the same local login may revoke
// that login. Do not expose credentials in logs, persisted events or URLs.
const listeners = new Set();
let activeSession = null;
export function activateAccountSession(token) {
  activeSession = token ? { token } : null;
  return activeSession;
}
export function clearAccountSession(scope) {
  if (scope && activeSession === scope) activeSession = null;
}
export function captureAccountSession(token) {
  return token && activeSession?.token === token ? activeSession : null;
}
export function reportAccountDeleted(scope, status, code) {
  if (!scope || scope !== activeSession || status !== 401 || code !== 'accountDeleted') return;
  for (const listener of listeners) { try { listener(scope); } catch { /* API failures still propagate normally. */ } }
}
export function subscribeAccountDeleted(listener) { listeners.add(listener); return () => listeners.delete(listener); }
