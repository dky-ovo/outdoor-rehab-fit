import { API_BASE_URL, ApiError } from "./api";

async function post(token, path, body, timeoutMs) {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`${API_BASE_URL}/admin/assistant/${path}`, { method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), ...(controller ? { signal: controller.signal } : {}) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new ApiError(typeof result?.error === "string" ? result.error : "adminAssistantUnavailable", response.status);
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new ApiError("adminAssistantUnavailable", 502);
        return result;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new ApiError("adminAssistantUnavailable", 0)); }, timeoutMs); }),
    ]);
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("adminAssistantUnavailable", 0); }
  finally { clearTimeout(timer); }
}

// Pick exact content fields. Never serialize component props, account objects,
// admin permissions or document import metadata into a provider request.
function inputBody(input) {
  return { message: input.message, history: (input.history || []).map(({ role, content }) => ({ role, content })), locale: input.locale,
    ...(input.documentText ? { documentText: input.documentText } : {}) };
}
export async function previewAdminAssistant(token, input) {
  const result = await post(token, "preview", inputBody(input), 15000);
  if (typeof result.previewToken !== "string" || !/^[a-f0-9]{64}$/.test(result.previewToken) || !Number.isFinite(result.expiresAt) || !result.summary || result.summary.writesAllowed !== false || result.summary.sensitiveDataAllowed !== false || result.summary.recipient !== "DeepSeek") throw new ApiError("adminAssistantUnavailable", 502);
  return result;
}
export async function sendAdminAssistant(token, input, previewToken) {
  const result = await post(token, "chat", { ...inputBody(input), previewToken }, 65000);
  if (typeof result.reply !== "string" || typeof result.draft !== "string" || !Array.isArray(result.references) || result.draftOnly !== true || result.published !== false) throw new ApiError("adminAssistantUnavailable", 502);
  return result;
}
