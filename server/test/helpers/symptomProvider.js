// Provider test double: choose only evidence actually supplied by the server.
// This does not compute a response from client-submitted facility data.
export function symptomProviderSelection(body) {
  for (const message of body?.messages || []) {
    if (message.role !== 'user') continue;
    let context;
    try { context = JSON.parse(message.content); } catch { continue; }
    if (!context || !Array.isArray(context.candidates) || !context.concern) continue;
    return { style: 'direct', recommendations: context.candidates.slice(0, 3).map(({ id, evidence }) => ({ id, evidence })) };
  }
  return null;
}
