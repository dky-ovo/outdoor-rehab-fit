import { API_BASE_URL, ApiError } from "./api";

export const FEEDBACK_REQUEST_TIMEOUT_MS = 30000;
const STATUSES = new Set(["new", "in_progress", "resolved"]);
let sequence = 0;

// This is an idempotency identifier, not an authentication token. Native
// engines without Web Crypto still need a synchronous, dependency-free ID.
export function createFeedbackSubmissionId() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	const bytes = new Uint8Array(16);
	if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
	else {
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
		let stamp = Date.now();
		for (let index = 0; index < 6; index += 1) { bytes[index] ^= stamp % 256; stamp = Math.floor(stamp / 256); }
		sequence = (sequence + 1) >>> 0;
		for (let index = 0; index < 4; index += 1) bytes[12 + index] ^= (sequence >>> (index * 8)) & 255;
	}
	bytes[6] = (bytes[6] & 15) | 64;
	bytes[8] = (bytes[8] & 63) | 128;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request(path, { token, method = "GET", body } = {}) {
	const controller = typeof AbortController === "undefined" ? null : new AbortController();
	let timer;
	try {
		return await Promise.race([
			(async () => {
				const response = await fetch(`${API_BASE_URL}${path}`, {
					method,
					headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
					...(controller ? { signal: controller.signal } : {}),
				});
				const payload = await response.json().catch(() => null);
				if (!response.ok) {
					const error = new ApiError(typeof payload?.error === "string" ? payload.error : "serverError", response.status);
					const retryAfter = Number(response.headers?.get?.("Retry-After"));
					if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter;
					throw error;
				}
				if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError("invalidFeedbackResponse", 502);
				return payload;
			})(),
			new Promise((_, reject) => {
				timer = setTimeout(() => { reject(new ApiError("feedbackTimeout", 0)); controller?.abort(); }, FEEDBACK_REQUEST_TIMEOUT_MS);
			}),
		]);
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("networkError", 0);
	} finally {
		clearTimeout(timer);
	}
}

function validReceipt(item) {
	return item && typeof item.id === "string" && item.id.length > 0 && STATUSES.has(item.status) && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
}

function requireFeedback(payload, detailed = false) {
	const item = payload.feedback;
	if (!validReceipt(item) || (detailed && (!["name", "email", "subject", "message", "notes", "updatedAt"].every((key) => typeof item[key] === "string") || !Number.isFinite(Date.parse(item.updatedAt))))) {
		throw new ApiError("invalidFeedbackResponse", 502);
	}
	return payload;
}

export async function submitContactFeedback(data, token) {
	const { submissionId, name, email, subject, message, locale } = data;
	return requireFeedback(await request("/feedback", { method: "POST", token, body: { submissionId, name, email, subject, message, locale } }));
}

export async function getAdminFeedback(token, { page = 1, pageSize = 20, search = "", status = "" } = {}) {
	const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status });
	const payload = await request(`/admin/feedback?${query.toString()}`, { token });
	const pagination = payload.pagination;
	if (!Array.isArray(payload.items) || !pagination || !["page", "pageSize", "totalPages"].every((key) => Number.isSafeInteger(pagination[key]) && pagination[key] > 0) || !Number.isSafeInteger(pagination.total) || pagination.total < 0 || pagination.page > pagination.totalPages) {
		throw new ApiError("invalidFeedbackResponse", 502);
	}
	for (const feedback of payload.items) requireFeedback({ feedback }, true);
	return payload;
}

export async function getAdminFeedbackDetail(token, id) {
	return requireFeedback(await request(`/admin/feedback/${encodeURIComponent(id)}`, { token }), true);
}

export async function updateAdminFeedback(token, id, { status, notes, expectedUpdatedAt }) {
	return requireFeedback(await request(`/admin/feedback/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { status, notes, expectedUpdatedAt } }), true);
}
