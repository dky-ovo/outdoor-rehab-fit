import { Platform } from "react-native";
import { captureAccountSession, reportAccountDeleted } from "./accountSessionEvents";
import { createPublicEquipmentCatalogCache } from "./publicEquipmentCatalogCache";

const PRODUCTION_API_BASE_URL = "https://outdoor-fit.35-241-75-217.sslip.io/api";
export const API_BASE_URL = Platform.OS === "web"
	? "/api"
	: process.env.EXPO_PUBLIC_API_BASE_URL || PRODUCTION_API_BASE_URL;

export function resolveApiAssetUrl(value) {
	if (!value || /^https:\/\//i.test(value)) return value;
	if (Platform.OS === "web") return value;
	return `${API_BASE_URL.replace(/\/api\/?$/, "")}${value.startsWith("/") ? value : `/${value}`}`;
}

export class ApiError extends Error {
	constructor(code, status) {
		super(code);
		this.code = code;
		this.status = status;
	}
}

// Session traffic resumes after screen lock and may have a stale connection.
// Bound both fetch and response-body reading; AbortController alone is not a
// timeout on every native transport. Other endpoints keep their own behavior.
export const SESSION_REQUEST_TIMEOUT_MS = 15000;
// Allow the server's 55-second AI budget plus transport time, while also
// bounding transports that ignore abort or stall while reading the response.
export const ASSISTANT_REQUEST_TIMEOUT_MS = 65000;
export const PUBLIC_CONTENT_REQUEST_TIMEOUT_MS = 15000;

async function request(path, { method = "GET", body, token, timeoutMs = 0, timeoutCode = "networkError", cache, signal } = {}) {
	if (signal?.aborted) throw new ApiError("requestCancelled", 0);
	const accountScope = captureAccountSession(token);
	const controller = (timeoutMs > 0 || signal) && typeof AbortController !== "undefined" ? new AbortController() : null;
	let timer, onCancel;
	try {
		const operation = (async () => {
			const response = await fetch(`${API_BASE_URL}${path}`, {
				method,
				...(cache ? { cache } : {}),
				headers: {
					...(body ? { "Content-Type": "application/json" } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
				...(controller || signal ? { signal: controller?.signal || signal } : {}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				reportAccountDeleted(accountScope, response.status, payload?.error);
				const error = new ApiError(payload?.error || "serverError", response.status);
				const retrySeconds = Number(response.headers?.get?.("Retry-After"));
				if (Number.isFinite(retrySeconds) && retrySeconds > 0) error.retryAfterMs = Math.min(120000, retrySeconds * 1000);
				throw error;
			}
			return payload;
		})();
		if (!timeoutMs && !signal) return await operation;
		return await Promise.race([
			operation,
			...(timeoutMs ? [new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new ApiError(timeoutCode, 0));
					controller?.abort();
				}, timeoutMs);
			})] : []),
			...(signal ? [new Promise((_, reject) => {
				onCancel = () => {
					reject(new ApiError("requestCancelled", 0));
					controller?.abort();
				};
				if (signal.aborted) onCancel();
				else signal.addEventListener("abort", onCancel, { once: true });
			})] : []),
		]);
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("networkError", 0);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (onCancel) signal.removeEventListener("abort", onCancel);
	}
}

function post(path, body) {
	return request(path, { method: "POST", body });
}

export function requestSmsCode(phone, purpose = "registration", countryCode = "+852") {
	return post("/auth/sms/request", { phone, purpose, countryCode });
}

export function verifySmsCode(phone, code, purpose = "registration", countryCode = "+852") {
	return post("/auth/sms/verify", { phone, code, purpose, countryCode });
}

export function resetPassword(identifier, newPassword, verificationToken, countryCode = "+852") {
	return post("/auth/password/reset", { identifier, newPassword, verificationToken, countryCode });
}

export function registerAccount(data) {
	return request("/auth/register", { method: "POST", body: data, timeoutMs: 30000 });
}

export function getAdminRegistrationCodes(token, { page = 1, pageSize = 20, search = "", status = "" } = {}) {
	const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status });
	return request(`/admin/registration-codes?${query.toString()}`, { token, timeoutMs: 30000 });
}
export function createAdminRegistrationCode(token, data) {
	return request("/admin/registration-codes", { method: "POST", body: data, token, timeoutMs: 30000 });
}
export function revokeAdminRegistrationCode(token, id) {
	return request(`/admin/registration-codes/${encodeURIComponent(id)}/revoke`, { method: "POST", token, timeoutMs: 30000 });
}

export function loginAccount(identifier, password, countryCode = "+852") {
	return post("/auth/login", { identifier, password, countryCode });
}

export function registerGuestProfile(data) {
	return post("/guest-profiles", data);
}

export function updateCurrentUser(token, data) {
	return request("/users/me", { method: "PATCH", body: data, token });
}

export function getCurrentUser(token) { return request("/users/me", { token, timeoutMs: 15000 }); }

export function sendResearchEvent(token, eventName, metadata = {}) {
	return request("/research/events", { method: "POST", body: { eventName, metadata, appVersion: "1.0.0" }, token });
}

export function getPublicContent(pageKey = "", { signal } = {}) {
	return request(`/content?pageKey=${encodeURIComponent(pageKey)}`, {
		timeoutMs: PUBLIC_CONTENT_REQUEST_TIMEOUT_MS, timeoutCode: "publicContentTimeout", signal,
	});
}

export function getAppTexts() { return request('/app-texts', { timeoutMs: 12000 }); }
export function getAdminAppTexts(token, { page = 1, search = '', group = '', modified = false } = {}) {
	return request(`/admin/app-texts?${new URLSearchParams({ page: String(page), pageSize: '20', search, group, modified: modified ? '1' : '' })}`, { token, timeoutMs: 15000 });
}
export function updateAdminAppText(token, key, body) { return request(`/admin/app-texts/${encodeURIComponent(key)}`, { token, method: 'PATCH', body, timeoutMs: 15000 }); }

export function getFacilities({ search = "", district = "", type = "" } = {}) {
	const query = new URLSearchParams({ search, district, type, limit: "1000" });
	return request(`/facilities?${query.toString()}`);
}

export function getEquipmentLocations(equipmentId = "") {
	const query = new URLSearchParams({ limit: "1000" });
	if (String(equipmentId || "").trim()) query.set("equipmentId", String(equipmentId).trim());
	return request(`/equipment-locations?${query.toString()}`);
}

// Public catalog only. Screens reuse the latest directory; login/foreground
// synchronization can explicitly refresh it without making every tap refetch.
const equipmentCatalogCache = createPublicEquipmentCatalogCache(API_BASE_URL);
let equipmentCatalogRequest = null;
let equipmentCatalogFetchedAt = null;
const equipmentCatalogListeners = new Set();
export const EQUIPMENT_CATALOG_FRESH_MS = 60000;
function notifyEquipmentCatalog() {
	for (const listener of equipmentCatalogListeners) {
		try { listener(equipmentCatalogCache.get()); } catch { /* A view cannot break a public refresh. */ }
	}
}
export function subscribeEquipmentCatalog(listener) {
	equipmentCatalogListeners.add(listener);
	return () => equipmentCatalogListeners.delete(listener);
}
export function getCachedEquipmentCatalog() { return equipmentCatalogCache.get(); }
export async function loadCachedEquipmentCatalog() {
	const previous = equipmentCatalogCache.get();
	const result = await equipmentCatalogCache.load();
	if (previous !== result) notifyEquipmentCatalog();
	return result;
}
export function getEquipmentCatalog({ forceRefresh = false } = {}) {
	const cached = equipmentCatalogCache.get();
	const age = equipmentCatalogFetchedAt === null ? Infinity : Date.now() - equipmentCatalogFetchedAt;
	if (!equipmentCatalogRequest && !forceRefresh && Platform.OS !== "web" && cached
		&& age >= 0 && age < EQUIPMENT_CATALOG_FRESH_MS) return Promise.resolve(cached);
	if (!equipmentCatalogRequest) {
		const pending = request("/equipment-catalog", { timeoutMs: 15000 }).then(result => {
			equipmentCatalogFetchedAt = equipmentCatalogCache.store(result) ? Date.now() : null;
			notifyEquipmentCatalog();
			return result;
		});
		equipmentCatalogRequest = pending;
		const clear = () => { if (equipmentCatalogRequest === pending) equipmentCatalogRequest = null; };
		void pending.then(clear, clear);
	}
	return equipmentCatalogRequest;
}

export function getAssistantRuntime(token) {
	return request("/assistant/runtime", { token, timeoutMs: SESSION_REQUEST_TIMEOUT_MS, cache: "no-store", timeoutCode: "assistantRuntimeUnavailable" });
}

// Old servers do not recognize the provider protocol. A distinct path closes
// the race where the server is rolled back after the runtime was fetched.
// Never retry these requests on the legacy DeepSeek-only routes.
async function assistantV2Request(path, options) {
	try { return await request(`/assistant/v2/${path}`, options); }
	catch (error) {
		if (error?.status === 404 && error?.code !== 'assistantJobNotFound') throw new ApiError('assistantClientUpdateRequired', 503);
		throw error;
	}
}

export async function sendAssistantMessage(data, token = "") {
	const payload = await assistantV2Request("chat", {
		method: "POST", body: data, token,
		timeoutMs: ASSISTANT_REQUEST_TIMEOUT_MS, timeoutCode: "assistantTimeout",
	});
	if (!payload || typeof payload !== "object" || Array.isArray(payload)
		|| ![payload.reply, payload.text].some((value) => typeof value === "string" && value.trim())) {
		throw new ApiError("deepSeekInvalidResponse", 502);
	}
	return payload;
}

export const createAssistantJob = (token, id, data) => assistantV2Request('jobs', {
	method: 'POST', token, body: { id, request: data }, timeoutMs: 15000,
});
export const getAssistantJob = (token, id) => assistantV2Request(`jobs/${encodeURIComponent(id)}`, { token, timeoutMs: 15000 });
export const syncAccountBookmarks = (token, changes) => request('/account/bookmarks/sync', {
	method: 'POST', token, body: { changes }, timeoutMs: 15000,
});
export const syncAccountDocuments = (token, body) => request('/account/data/sync', { method: 'POST', token, body, timeoutMs: 20000 });
export const getOwnLearningProgress = (token, page = 1) => request(`/account/learning?page=${page}&pageSize=50`, { token, timeoutMs: 20000 });

export function getVolunteerParticipants(token) {
	return request("/volunteer/participants", { token });
}

export function addVolunteerParticipant(token, phone, countryCode = "+852") {
	return request("/volunteer/participants", { method: "POST", body: { phone, countryCode }, token });
}

export function getVolunteerParticipantUsage(token, participantId) {
	return request(`/volunteer/participants/${encodeURIComponent(participantId)}/usage`, { token });
}

export function getVolunteerParticipantLearning(token, participantId, { date, equipmentId, page = 1, pageSize = 20 } = {}) {
	const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
	if (date) query.set("date", date);
	if (equipmentId !== undefined && equipmentId !== null && String(equipmentId) !== "") query.set("equipmentId", String(equipmentId));
	return request(`/volunteer/participants/${encodeURIComponent(participantId)}/learning?${query}`, { token, timeoutMs: 15000 });
}

export function saveLearningProgress(token, records) {
	return request("/learning/progress", { method: "POST", body: { records }, token, timeoutMs: 15000 });
}

export function getServerSessions(token) {
	return request("/sessions", { token, timeoutMs: SESSION_REQUEST_TIMEOUT_MS });
}

export function saveServerSession(token, session) {
	return request("/sessions", { method: "POST", body: session, token, timeoutMs: SESSION_REQUEST_TIMEOUT_MS });
}

export function deleteServerSession(token, id) {
	return request(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE", token, timeoutMs: SESSION_REQUEST_TIMEOUT_MS });
}

export function getServerChatMessages(token) {
	return request("/chat/messages?limit=150", { token });
}

export function sendServerChatMessage(token, data) {
	return request("/chat/messages", { method: "POST", body: data, token });
}

export function toggleServerChatReaction(token, messageId, emoji) {
	return request(`/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
		method: "POST",
		body: { emoji },
		token,
	});
}

export function searchChatParticipant(token, phone, countryCode = "+852") {
	return request(`/chat/participants?phone=${encodeURIComponent(phone)}&countryCode=${encodeURIComponent(countryCode)}`, { token });
}

export function getChatConversations(token) {
	return request("/chat/conversations", { token });
}

export function createChatConversation(token, participantId) {
	return request("/chat/conversations", { method: "POST", body: { participantId }, token });
}

export function getConversationMessages(token, conversationId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=150`, { token });
}

export function sendConversationMessage(token, conversationId, data) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: data, token });
}

export function toggleConversationReaction(token, conversationId, messageId, emoji) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
		method: "POST", body: { emoji }, token,
	});
}

export function getChatNotifications(token) {
	return request("/chat/notifications", { token });
}

export function registerPushToken(token, pushToken, platform) {
	return request("/push-tokens", { method: "POST", body: { token: pushToken, platform }, token });
}

export function getAdminOverview(token) {
	return request("/admin/overview", { token });
}

export function getAdminMe(token) {
	return request("/admin/me", { token });
}

export function getAdminUsers(token, search = "", pagination = {}) {
	const query = researchQuery({ search, page: 1, pageSize: 20, ...pagination });
	return request(`/admin/users?${query}`, { token, timeoutMs: 30000 });
}
export function exportAdminUsers(token, search = "") {
	return request(`/admin/users-export?${researchQuery({ search })}`, { token, timeoutMs: 30000 });
}

export function getAdminGuestProfiles(token, { page = 1, pageSize = 20, gender = "", purpose = "" } = {}) {
	const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), gender, purpose });
	return request(`/admin/guest-profiles?${query.toString()}`, { token });
}

export function getAdminTestUsers(token) { return request("/admin/test-users", { token, timeoutMs: 30000 }); }
export function createAdminTestUsers(token, body) { return request("/admin/test-users", { method: "POST", body, token, timeoutMs: 45000 }); }
export function disableAdminTestUsers(token, batchId) { return request(`/admin/test-users/${encodeURIComponent(batchId)}/disable`, { method: "POST", body: { confirmation: batchId }, token, timeoutMs: 30000 }); }

export function createAdminUser(token, data) {
	return request("/admin/users", { method: "POST", body: data, token });
}

export function updateAdminUser(token, userId, updates) {
	return request(`/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: updates, token });
}

export function deleteAdminUser(token, userId) {
	return request(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", token });
}

export function createChatGroup(token, title, participantIds) {
	return request("/chat/groups", { method: "POST", body: { title, participantIds }, token });
}

export function addChatGroupMember(token, conversationId, participantId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/members`, { method: "POST", body: { participantId }, token });
}

export function getChatConversationDetails(token, conversationId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/details`, { token });
}

export function renameChatGroup(token, conversationId, title) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: { title }, token });
}

export function leaveChatGroup(token, conversationId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}?mode=leave`, { method: "DELETE", token });
}

export function dissolveChatGroup(token, conversationId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE", token });
}

export function deleteChatContact(token, conversationId) {
	return request(`/chat/conversations/${encodeURIComponent(conversationId)}/contact`, { method: "DELETE", token });
}

export function getAdminResearchEvents(token, filters = {}) {
	const query = researchQuery({ page: 1, pageSize: 20, ...filters });
	return request(`/admin/research-events?${query}`, { token, timeoutMs: 30000 });
}

function researchQuery(filters = {}) {
	const query = new URLSearchParams();
	Object.entries(filters).forEach(([key, value]) => {
		if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, String(value).trim());
	});
	return query.toString();
}

export function getAdminResearchAnalytics(token, filters = {}) {
	const query = researchQuery({ page: 1, pageSize: 20, ...filters });
	return request(`/admin/research-analytics${query ? `?${query}` : ""}`, { token, timeoutMs: 30000 });
}

export function exportAdminResearchData(token, filters = {}) {
	const query = researchQuery(filters);
	return request(`/admin/research-export${query ? `?${query}` : ""}`, { token });
}

export function getAdminContent(token) { return request("/admin/content", { token }); }
export function createAdminContent(token, data) { return request("/admin/content", { method: "POST", body: data, token }); }
export function updateAdminContent(token, id, data) { return request(`/admin/content/${encodeURIComponent(id)}`, { method: "PATCH", body: data, token }); }
export function deleteAdminContent(token, id) { return request(`/admin/content/${encodeURIComponent(id)}`, { method: "DELETE", token }); }

export function getAdminEquipment(token) { return request("/admin/equipment", { token }); }
export function getEquipmentCategories() { return request("/equipment-categories"); }
export function getAdminEquipmentCategories(token, { page = 1, pageSize = 20, search = "" } = {}) {
	const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search });
	return request(`/admin/equipment-categories?${query}`, { token });
}
export function createAdminEquipmentCategory(token, data) { return request("/admin/equipment-categories", { method: "POST", body: data, token }); }
// PATCH requires the two names originally read by the editor (compare-and-swap).
export function updateAdminEquipmentCategory(token, id, data) { return request(`/admin/equipment-categories/${encodeURIComponent(id)}`, { method: "PATCH", body: data, token }); }
export function createAdminEquipment(token, data) { return request("/admin/equipment", { method: "POST", body: data, token }); }
export function updateAdminEquipment(token, id, data) { return request(`/admin/equipment/${encodeURIComponent(id)}`, { method: "PUT", body: data, token }); }
export function deleteAdminEquipment(token, id) { return request(`/admin/equipment/${encodeURIComponent(id)}`, { method: "DELETE", token }); }
export function uploadAdminEquipmentImage(token, imageData) { return request("/admin/equipment/image", { method: "POST", body: { imageData }, token }); }

export function getAdminMedia(token, { kind = "", categoryId = "", search = "", page = 1, limit = 20, archived = false, deleted = false, folderId, sort = "", direction = "asc" } = {}) {
	const query = new URLSearchParams({ kind, categoryId, search, page: String(page), limit: String(limit), archived: String(archived) });
	if (sort) { query.set("sort",sort);query.set("direction",direction); }
	if (folderId !== undefined) query.set("folderId",folderId);
	if (deleted) query.set("deleted","true");
	return request(`/admin/media?${query.toString()}`, { token, timeoutMs: 30000 });
}
export function updateAdminMedia(token, id, data) { return request(`/admin/media/${encodeURIComponent(id)}`, { method: "PATCH", body: data, token }); }
export function createAdminMediaCategory(token, name) { return request("/admin/media/categories", { method: "POST", body: { name }, token }); }
export function updateAdminMediaCategory(token, id, name) { return request(`/admin/media/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: { name }, token }); }
export function createAdminMediaFolder(token, name, parentId = "") { return request("/admin/media/folders", { method:"POST",body:{name,parentId},token }); }
export function renameAdminMediaFolder(token, id, name) { return request(`/admin/media/folders/${encodeURIComponent(id)}`, {method:"PATCH",body:{name},token}); }
export function moveAdminMediaItems(token, items, targetFolderId = "") { return request("/admin/media/move", {method:"POST",body:{items,targetFolderId},token,timeoutMs:30000}); }
export function copyAdminMediaItems(token, items, targetFolderId = "") { return request("/admin/media/copy", {method:"POST",body:{items,targetFolderId},token,timeoutMs:15 * 60 * 1000}); }
export function deleteAdminMediaItems(token, items) { return request("/admin/media/delete", {method:"POST",body:{items},token}); }
export function restoreAdminMediaItem(token, item) { return request("/admin/media/restore", {method:"POST",body:item,token}); }
export async function downloadAdminMedia(token,item) {
	const accountScope = captureAccountSession(token);
	if (typeof document === "undefined") throw new Error("folderUploadRequiresDesktop");
	// Private attachments are fetched with the authorization header, never a
	// persistent credential in a download URL or a public executable preview.
	if (!/^\/api\/media\/[a-f0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/i.test(item?.url || "")) throw new ApiError("mediaNotFound",404);
	const response = await fetch(`${API_BASE_URL}/admin/media-download/${encodeURIComponent(item.id)}?download=true`,{headers:{Authorization:`Bearer ${token}`}});
	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		reportAccountDeleted(accountScope, response.status, payload?.error);
		throw new ApiError(payload?.error || "mediaDownloadFailed",response.status);
	}
	const url = URL.createObjectURL(await response.blob());
	const anchor = document.createElement("a"); anchor.href=url; anchor.download=item.name || "download";
	document.body.appendChild(anchor); anchor.click(); anchor.remove();
	setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// Raw binary keeps videos out of JSON/base64; XHR exposes upload progress and
// allows an explicit cancellation without silently retrying a committed file.
export function uploadAdminMedia(token, file, { name, mimeType, categoryId = "", folderId = "", onProgress, signal } = {}) {
	const accountScope = captureAccountSession(token);
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(new ApiError("uploadCancelled", 0)); return; }
		const xhr = new XMLHttpRequest();
		const query = new URLSearchParams({ name: name || file.name || "upload", categoryId, folderId, mimeType: mimeType || file.type || "application/octet-stream" });
		const cleanup = () => signal?.removeEventListener("abort", abort);
		const fail = (code, status = 0) => { cleanup(); reject(new ApiError(code, status)); };
		const abort = () => xhr.abort();
		xhr.open("POST", `${API_BASE_URL}/admin/media/upload?${query.toString()}`);
		xhr.timeout = 15 * 60 * 1000;
		xhr.setRequestHeader("Authorization", `Bearer ${token}`);
		xhr.setRequestHeader("Content-Type", "application/octet-stream");
		xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100))); };
		xhr.onload = () => {
			let payload;
			try { payload = JSON.parse(xhr.responseText || "{}"); } catch { fail("invalidUploadResponse", xhr.status); return; }
			if (xhr.status < 200 || xhr.status >= 300) { reportAccountDeleted(accountScope, xhr.status, payload.error); fail(payload.error || "uploadFailed", xhr.status); return; }
			if (!payload.item?.url) { fail("invalidUploadResponse", xhr.status); return; }
			cleanup(); resolve(payload);
		};
		xhr.onerror = () => fail("networkError");
		xhr.ontimeout = () => fail("networkError");
		xhr.onabort = () => fail("uploadCancelled");
		signal?.addEventListener("abort", abort, { once: true });
		try { xhr.send(file); } catch { fail("networkError"); }
	});
}

export function getAdminEquipmentLocations(token) { return request("/admin/equipment-locations", { token }); }
export function createAdminEquipmentLocation(token, data) { return request("/admin/equipment-locations", { method: "POST", body: data, token }); }
export function updateAdminEquipmentLocation(token, id, data) { return request(`/admin/equipment-locations/${encodeURIComponent(id)}`, { method: "PUT", body: data, token }); }
export function deleteAdminEquipmentLocation(token, id) { return request(`/admin/equipment-locations/${encodeURIComponent(id)}`, { method: "DELETE", token }); }

export function getAdminMessages(token) {
	return request("/admin/messages?limit=100", { token });
}

export function getAdminChatUsers(token) {
	return request("/admin/chat-users", { token });
}

export function getAdminUsageUsers(token) {
	return request("/admin/user-usage", { token });
}

export function getAdminUserUsage(token, userId) {
	return request(`/admin/user-usage/${encodeURIComponent(userId)}`, { token });
}

export function getAdminAiConfiguration(token) {
	return request("/admin/ai-configuration", { token });
}

export function updateAdminAiConfiguration(token, data) {
	return request("/admin/ai-configuration", { method: "PATCH", body: data, token });
}

export function testAdminAiConfiguration(token, data = {}) {
	return request("/admin/ai-configuration/test", { method: "POST", body: data, token });
}

export function getAdminUserChatMessages(token, userId) {
	return request(`/admin/chat-users/${encodeURIComponent(userId)}/messages`, { token });
}

export function deleteAdminMessage(token, messageId) {
	return request(`/admin/messages/${encodeURIComponent(messageId)}`, { method: "DELETE", token });
}

export function getAdminSelectedMessages(token, selection) {
	return request("/admin/messages/selection", { method: "POST", body: selection, token });
}

export function bulkDeleteAdminMessages(token, selection) {
	return request("/admin/messages/bulk-delete", { method: "POST", body: selection, token });
}

export function getAdminPersonnel(token) {
	return request("/admin/personnel", { token });
}

export function createAdminPersonnel(token, data) {
	return request("/admin/personnel", { method: "POST", body: data, token });
}

export function updateAdminPersonnel(token, userId, data) {
	return request(`/admin/personnel/${encodeURIComponent(userId)}`, { method: "PATCH", body: data, token });
}

export function getAdminSystemLogs(token, pagination = {}) {
	const query = researchQuery({ page: 1, pageSize: 20, ...pagination });
	return request(`/admin/system-logs?${query}`, { token, timeoutMs: 30000 });
}

export function getAdminFacilitySource(token) {
	return request("/admin/facilities/source", { token });
}

export function updateAdminFacilitySource(token, data) {
	return request("/admin/facilities/source", { method: "PATCH", body: data, token });
}

export function syncAdminFacilities(token) {
	return request("/admin/facilities/sync", { method: "POST", body: {}, token });
}

export function updateAdminFacility(token, id, data) {
	return request(`/admin/facilities/${encodeURIComponent(id)}`, { method: "PATCH", body: data, token });
}
