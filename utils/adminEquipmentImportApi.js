import { API_BASE_URL, ApiError } from "./api";

export const EQUIPMENT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const EQUIPMENT_DOCX_MAX_BYTES = 12 * 1024 * 1024;
export function validateEquipmentDocumentFile(file) {
	if (!file || !/\.docx$/i.test(file.name || "") || file.name.length > 200 || /[\\/\u0000-\u001f]/.test(file.name)) throw new Error("请选择标准 .docx 文件，不支持 .doc、PDF 或其他格式。");
	if (!Number.isFinite(file.size) || file.size <= 0 || file.size > EQUIPMENT_DOCX_MAX_BYTES) throw new Error("DOCX 文件必须大于 0 且不超过 12 MB。");
	return file;
}
const messages = {
	importConflict: "预览后后台内容已被修改。本次未更新，请重新预览并核对。", importPreviewExpired: "导入预览已过期，请重新选择文档。", importPreviewNotFound: "找不到该导入预览，请重新选择文档。", importAlreadyConfirmed: "该预览已确认，不能改变确认内容。请查看导入记录。", importPreviewHasErrors: "文档有未解决错误，不能导入。", invalidImportSelection: "字段选择无效，请重新预览后选择。", invalidImportConfirmation: "请选择需要更新的字段后确认。", tooManyImportPreviews: "当前预览过多，请等待旧预览过期后重试。", invalidDocxName: "请选择标准 .docx 文件。", invalidDocx: "文件不是有效的 Word DOCX 文档。", invalidDocxXml: "Word 正文格式错误，请另存为标准 DOCX 后重试。", unsafeDocx: "文件含不安全内容或超过解压限制，未导入。", unsafeDocxXml: "不支持外部实体或文档类型声明。", unsafeDocxField: "请移除动态域或公式后再导入。", unsupportedDocxObjects: "请移除嵌入对象、外部文档或公式后再导入。", docxTooLarge: "Word 正文超出处理上限，请缩小文档后重试。", importAuditNotFound: "没有找到该导入记录。",
};
const errorWithMessage = (code, status, message) => { const error = new ApiError(code, status); error.message = message; return error; };
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isText = (value) => typeof value === "string" && value.length <= 30000;
const validResult = (value) => isObject(value) && value.ok === true && typeof value.previewId === "string" && Number.isInteger(value.equipmentCount) && value.equipmentCount > 0 && Number.isInteger(value.fieldCount) && value.fieldCount > 0;
const validPreview = (value) => isObject(value) && typeof value.previewId === "string" && typeof value.confirmationKey === "string" && typeof value.fileName === "string" && Number.isFinite(value.expiresAt) && typeof value.canConfirm === "boolean" && Array.isArray(value.entries) && value.entries.length <= 29 && value.entries.every((entry) => isObject(entry) && typeof entry.id === "string" && typeof entry.code === "string" && typeof entry.nameZh === "string" && typeof entry.nameEn === "string" && Array.isArray(entry.fields) && entry.fields.length <= 12 && entry.fields.every((field) => isObject(field) && typeof field.field === "string" && typeof field.label === "string" && isText(field.before) && isText(field.after) && typeof field.changed === "boolean" && typeof field.emptySkipped === "boolean")) && Array.isArray(value.issues) && value.issues.every((issue) => isObject(issue) && typeof issue.code === "string" && typeof issue.message === "string") && Array.isArray(value.skipped) && value.skipped.every((entry) => isObject(entry) && typeof entry.code === "string");
async function importRequest(path, token, { body, headers = {}, signal, method = "POST", timeoutMs = 20000, validate = isObject } = {}) {
	const controller = new AbortController(); let timer; let abort;
	try {
		if (signal?.aborted) throw errorWithMessage("importRequestCancelled", 0, "操作已取消。");
		const limit = new Promise((_, reject) => {
			abort = () => { controller.abort(); reject(errorWithMessage("importRequestCancelled", 0, "操作已取消。")); };
			signal?.addEventListener("abort", abort, { once: true });
			timer = setTimeout(() => { controller.abort(); reject(errorWithMessage("importRequestTimeout", 0, path === "confirm" ? "确认请求超时。保存结果可能已生效，请重试同一确认或查看导入记录，勿重复上传。" : "请求超时，请检查网络后重试。")); }, timeoutMs);
		});
		const operation = (async () => {
			const response = await fetch(`${API_BASE_URL}/admin/equipment/import/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body, signal: controller.signal });
			const payload = await response.json().catch(() => null);
			if (!response.ok) { const code = typeof payload?.error === "string" ? payload.error : "equipmentImportFailed"; throw errorWithMessage(Object.hasOwn(messages, code) ? code : "equipmentImportFailed", response.status, response.status === 401 ? "登录已失效，请重新登录。" : response.status === 403 ? "没有户外器材维护权限。" : messages[code] || "导入请求未成功，请重试或重新预览。"); }
			if (!validate(payload)) throw errorWithMessage("invalidImportResponse", response.status, path === "confirm" ? "服务器返回异常。请重试同一确认或查看导入记录，勿重复上传。" : "服务器返回内容不完整，请刷新后重试。");
			return payload;
		})();
		return await Promise.race([operation, limit]);
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw errorWithMessage("importNetworkError", 0, path === "confirm" ? "网络连接中断。保存结果可能已生效，请重试同一确认或查看导入记录，勿重复上传。" : "网络连接失败，请检查网络后重试。");
	} finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}
export function previewAdminEquipmentDocument(token, file, { signal } = {}) {
	validateEquipmentDocumentFile(file);
	return importRequest("preview", token, { body: file, headers: { "Content-Type": EQUIPMENT_DOCX_MIME, "X-Document-Name": encodeURIComponent(file.name) }, signal, timeoutMs: 30000, validate: validPreview });
}
export function previewStoredAdminEquipmentDocument(token, mediaId, { signal } = {}) {
	if (typeof mediaId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(mediaId)) throw new Error("请选择文件存储中的 Word 文档。");
	return importRequest("preview-stored", token, { body: JSON.stringify({ mediaId }), headers: { "Content-Type": "application/json" }, signal, timeoutMs: 30000, validate: validPreview });
}
export function confirmAdminEquipmentDocument(token, { previewId, selections, idempotencyKey }, { signal } = {}) {
	return importRequest("confirm", token, { body: JSON.stringify({ previewId, selections, idempotencyKey }), headers: { "Content-Type": "application/json" }, signal, validate: validResult });
}
export function getAdminEquipmentImportHistory(token, page = 1, { signal } = {}) { return importRequest(`history?page=${encodeURIComponent(page)}&pageSize=10`, token, { method: "GET", signal, validate: (value) => isObject(value) && Number.isInteger(value.page) && value.page > 0 && Number.isInteger(value.pageSize) && value.pageSize > 0 && value.pageSize <= 20 && Number.isInteger(value.total) && value.total >= 0 && Array.isArray(value.items) && value.items.length <= value.pageSize && value.items.every((item) => validResult(item) && typeof item.fileName === "string" && Number.isFinite(item.createdAt)) }); }
export function getAdminEquipmentImportAudit(token, previewId, { signal } = {}) { return importRequest(`history/${encodeURIComponent(previewId)}`, token, { method: "GET", signal, validate: (value) => validResult(value) && Array.isArray(value.changes) && value.changes.length <= 348 && value.changes.every((change) => isObject(change) && typeof change.id === "string" && typeof change.field === "string" && isText(change.before) && isText(change.after) && isText(change.effectiveBefore)) }); }
