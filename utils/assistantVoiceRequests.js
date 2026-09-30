// URL parameters are not permission to record. Only a recent in-process Home
// tap creates an intent that the chat screen can consume once for that identity.
export const ASSISTANT_VOICE_REQUEST_TTL_MS = 30000;
let pending = null;
let sequence = 0;

export function assistantVoiceRequestScope(user, locale) {
  return JSON.stringify([user?.id || user?.phone || user?.email || "anonymous", user?.token || "", locale]);
}

export function createAssistantVoiceRequest(scope) {
  const id = `voice-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  pending = { id, scope, expiresAt: Date.now() + ASSISTANT_VOICE_REQUEST_TTL_MS };
  return id;
}

export function consumeAssistantVoiceRequest(id, scope) {
  if (!pending) return false;
  if (Date.now() >= pending.expiresAt) { pending = null; return false; }
  if (typeof id !== "string" || id !== pending.id) return false;
  const request = pending;
  pending = null;
  return request.scope === scope;
}
