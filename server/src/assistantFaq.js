import { retrieveAssistantFaq, renderAssistantFaq, assistantFaqEmergency } from "./assistantFaqKnowledge.js";

// Called only inside the existing authenticated/rate-limited assistant handler.
// Receives a trusted public catalog, never the request, user, DB or provider.
export function assistantFaqAnswer({ message, history = [], catalog, locale = "zh" }) {
	const urgent = assistantFaqEmergency(message, locale);
	if (urgent) return urgent;
	const entry = retrieveAssistantFaq(message, { history });
	return entry ? renderAssistantFaq(entry, catalog, locale, { message }) : null;
}
