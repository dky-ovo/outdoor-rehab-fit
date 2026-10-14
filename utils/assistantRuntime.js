// Public, non-secret server contract. Missing or inconsistent configuration
// never means "use DeepSeek": a stale client must not answer in the wrong mode.
export const BAILIAN_RAW_RESPONSE_POLICY = "bailian-chat-raw-v1";
export const ASSISTANT_CLIENT_PROTOCOL = 2;

export function checkedAssistantRuntime(value) {
  const provider = value?.provider;
  const validProvider = provider === "deepseek" || provider === "bailian";
  const revision = value?.revision;
  if (!validProvider || value.protocol !== ASSISTANT_CLIENT_PROTOCOL || value.scope !== provider ||
      typeof revision !== "string" || !revision.trim() || revision.length > 256 ||
      typeof value.model !== "string" || !value.model.trim() || value.model.length > 160 ||
      value.promptMode !== (provider === "bailian" ? "none" : "app") ||
      value.faqEnabled !== (provider === "deepseek")) {
    throw Object.assign(new Error("assistantRuntimeUnavailable"), { code: "assistantRuntimeUnavailable" });
  }
  return { provider, model: value.model, scope: provider, revision,
    promptMode: value.promptMode, faqEnabled: value.faqEnabled, protocol: ASSISTANT_CLIENT_PROTOCOL };
}

export function assistantRuntimeRequest(runtime) {
  const checked = checkedAssistantRuntime(runtime);
  return { provider: checked.provider, runtimeRevision: checked.revision,
    historyScope: checked.provider, protocol: checked.protocol };
}

export function isBailianRawMessage(message) {
  return message?.provider === "bailian" && message?.responsePolicy === BAILIAN_RAW_RESPONSE_POLICY;
}

// Only text is displayed. Model-provided action/card fields are never wired to
// navigation, image loading or links in raw mode; the model's words stay intact.
export function plainBailianMessage(message) {
  return { ...message, action: ["error", "auth_error"].includes(message?.action) ? message.action : "general",
    recommendations: [], facility: undefined, confirmationRequired: false };
}

export function assistantProviderLabel(runtime, locale = "zh") {
  if (!runtime) return locale === "en" ? "Connecting to AI…" : "正在連接 AI…";
  const provider = runtime.provider === "bailian" ? (locale === "en" ? "Alibaba Bailian" : "阿里百煉") : "DeepSeek";
  return runtime.model ? `${provider} · ${runtime.model}` : provider;
}

export function assistantRequestHistory(messages, provider) {
  return (Array.isArray(messages) ? messages : []).filter(message => message && message.id !== "welcome" &&
    !["error", "auth_error"].includes(message.action) && !message.retiredImage &&
    (message.provider || "deepseek") === provider && ["user", "ai"].includes(message.sender))
    .slice(-8).map(message => ({ role: message.sender === "user" ? "user" : "assistant", content: message.text || message.reply || "" }))
    .filter(message => typeof message.content === "string" && message.content.trim());
}
