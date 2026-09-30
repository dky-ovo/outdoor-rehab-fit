import crypto from "node:crypto";
import fs from "node:fs";
import yauzl from "yauzl";
import { DOMParser } from "@xmldom/xmldom";
import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";
import { EDUCATION_VIDEO_CODES, equipmentIdForVideoCode } from "./educationVideoCodes.js";

export const EQUIPMENT_DOCUMENT_IMPORT_SCHEMA = `
CREATE TABLE IF NOT EXISTS equipment_document_previews (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, document_sha256 TEXT NOT NULL,
 file_name TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_document_previews_actor ON equipment_document_previews(actor_id,expires_at);
CREATE TABLE IF NOT EXISTS equipment_document_commits (
 idempotency_key TEXT PRIMARY KEY, actor_id TEXT NOT NULL, preview_id TEXT NOT NULL UNIQUE,
 selection_hash TEXT NOT NULL, result_json TEXT NOT NULL, changes_json TEXT NOT NULL, created_at INTEGER NOT NULL
);`;
export const EQUIPMENT_DOCUMENT_LIMITS = Object.freeze({ uploadBytes: 12 * 1024 * 1024, expandedBytes: 40 * 1024 * 1024, xmlBytes: 4 * 1024 * 1024, entries: 300, textLength: 30000, ttlMs: 15 * 60 * 1000 });
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const evidence = JSON.parse(fs.readFileSync(new URL("./equipmentGuideEvidence.json", import.meta.url), "utf8"));
const BASE_FIELDS = [
	["details", "details", "使用方法", ["使用方法", "Detailed Instructions"]],
	["kinesiology", "kinesiologyTip", "运动学专家介绍", ["運動學專家的介紹", "Introduction by Exercise Specialists"]],
	["pt_tip", "ptTip", "物理治疗师提示", ["物理治療師的小貼士", "Tips from Physiotherapists"]],
	["ot_tip", "otTip", "职业治疗师提示", ["職業治療師的小貼士", "Tips from Occupational Therapists"]],
	["tcm", "tcmTip", "中医学角度", ["中醫學角度", "Traditional Chinese Medicine Perspective"]],
	["care_tip", "careTip", "照顾者提示", ["給照顧者的提示", "Tips for caregiver"]],
];
export const EQUIPMENT_DOCUMENT_FIELDS = Object.freeze(Object.fromEntries(BASE_FIELDS.flatMap(([column, key, label]) => ["zh", "en"].map((locale) => [`${column}_${locale}`, { key, locale, label: `${label}（${locale === "zh" ? "中文" : "英文"}）` }]))));
const canonicalCode = (code) => code === "18a" ? "18" : code;
const normalize = (text) => String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const zhAliases = { "0": ["太極揉推器/太極推手器"], "16": ["下肢的伸展（膕繩肌伸展）"], "28": ["石春路"] };
const sourceNames = (item) => [item.nameZh, ...(zhAliases[item.id] || [])];
const children = (node, local) => Array.from(node?.childNodes || []).filter((item) => item.nodeType === 1 && item.namespaceURI === W && (!local || item.localName === local));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function failure(code, message, status = 400, details) { const error = new Error(message); Object.assign(error, { code, status, details }); return error; }

function paragraphText(node) {
	let text = "";
	const visit = (item) => {
		if (item.nodeType !== 1) return;
		if (item.namespaceURI === W && ["del", "moveFrom", "instrText", "drawing", "pict", "object"].includes(item.localName)) return;
		if (item.namespaceURI === W && item.localName === "t") { text += item.textContent; return; }
		if (item.namespaceURI === W && ["br", "cr"].includes(item.localName)) { text += "\n"; return; }
		if (item.namespaceURI === W && item.localName === "tab") { text += " "; return; }
		for (const child of item.childNodes || []) visit(child);
	};
	visit(node);
	return text.replace(/[\t \u00a0]+/g, " ").trim();
}
const cellText = (cell) => children(cell, "p").map(paragraphText).filter(Boolean).join("\n\n");

async function readDocumentXml(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > EQUIPMENT_DOCUMENT_LIMITS.uploadBytes || buffer.readUInt32LE(0) !== 0x04034b50) throw failure("invalidDocx", "请选择有效的 DOCX 文件（最多 12 MB）。");
	return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
		if (error) { reject(failure("invalidDocx", "DOCX 压缩结构无效。")); return; }
		let count = 0, expanded = 0, finished = false; const names = new Set(); const texts = {};
		const fail = (reason) => { if (finished) return; finished = true; zip.close(); reject(reason); };
		zip.on("error", () => fail(failure("invalidDocx", "DOCX 压缩内容损坏。")));
		zip.on("entry", (entry) => {
			const name = entry.fileName; count += 1; expanded += entry.uncompressedSize;
			const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
			if (count > EQUIPMENT_DOCUMENT_LIMITS.entries || expanded > EQUIPMENT_DOCUMENT_LIMITS.expandedBytes || entry.uncompressedSize / Math.max(1, entry.compressedSize) > 250 ||
				entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod) || mode === 0xa000 || names.has(name.toLowerCase()) || name.startsWith("/") || /[\\\u0000-\u001f:]/.test(name) || name.split("/").some((part) => [".", ".."].includes(part)) || /vbaProject|activeX|embeddings|\.exe$/i.test(name)) {
				fail(failure("unsafeDocx", "文件含不安全路径、宏、嵌入程序、重复项目或超出解压限制。")); return;
			}
			names.add(name.toLowerCase());
			if (!["[Content_Types].xml", "word/document.xml"].includes(name)) { zip.readEntry(); return; }
			if (entry.uncompressedSize > EQUIPMENT_DOCUMENT_LIMITS.xmlBytes) { fail(failure("docxTooLarge", "Word 正文超出处理上限。")); return; }
			zip.openReadStream(entry, (streamError, stream) => {
				if (streamError) { fail(failure("invalidDocx", "无法读取 Word 正文。")); return; }
				let bytes = 0; const chunks = [];
				stream.on("data", (chunk) => { bytes += chunk.length; if (bytes > EQUIPMENT_DOCUMENT_LIMITS.xmlBytes) { stream.destroy(); fail(failure("docxTooLarge", "Word 正文超出处理上限。")); } else chunks.push(chunk); });
				stream.on("error", () => fail(failure("invalidDocx", "Word 正文解压失败。")));
				stream.on("end", () => { if (finished) return; texts[name] = Buffer.concat(chunks).toString("utf8"); zip.readEntry(); });
			});
		});
		zip.on("end", () => {
			if (finished) return;
			if (!texts["word/document.xml"] || !texts["[Content_Types].xml"]?.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) { fail(failure("invalidDocx", "文件不是标准 Word DOCX 文档。")); return; }
			finished = true; resolve(texts["word/document.xml"]);
		});
		zip.readEntry();
	}));
}

export function parseEquipmentDocumentXml(xml) {
	if (typeof xml !== "string" || Buffer.byteLength(xml) > EQUIPMENT_DOCUMENT_LIMITS.xmlBytes || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) throw failure("unsafeDocxXml", "不支持外部实体或文档类型声明。");
	xml = xml.replace(/^\uFEFF/, ""); // Word may prefix UTF-8 XML with a BOM.
	const errors = [];
	let doc;
	try { doc = new DOMParser({ onError: (_level, message) => { errors.push(message); } }).parseFromString(xml, "application/xml"); }
	catch { throw failure("invalidDocxXml", "Word XML 格式不正确。"); }
	if (errors.length || !doc || doc.documentElement?.namespaceURI !== W || doc.documentElement.localName !== "document") throw failure("invalidDocxXml", "Word XML 格式不正确。");
	const nodes = [[doc.documentElement, 0]]; let nodeCount = 0;
	while (nodes.length) { const [node, depth] = nodes.pop(); nodeCount += 1; if (depth > 80 || nodeCount > 120000) throw failure("docxTooLarge", "Word XML 层级或节点过多。"); for (const child of node.childNodes || []) if (child.nodeType === 1) nodes.push([child, depth + 1]); }
	if (doc.getElementsByTagNameNS(W, "altChunk").length || doc.getElementsByTagNameNS(W, "object").length || doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMath").length) throw failure("unsupportedDocxObjects", "请移除嵌入对象、外部文档或公式后再导入。");
	for (const field of Array.from(doc.getElementsByTagNameNS(W, "instrText"))) if (!/^\s*HYPERLINK\s+\\l\s+"[A-Za-z0-9_]+"\s*$/.test(field.textContent)) throw failure("unsafeDocxField", "文档包含不支持的动态域或公式。");
	if (doc.getElementsByTagNameNS(W, "fldSimple").length) throw failure("unsafeDocxField", "文档包含不支持的动态域或公式。");
	const body = doc.getElementsByTagNameNS(W, "body")[0];
	if (!body || doc.getElementsByTagNameNS(W, "p").length > 6000) throw failure("docxTooLarge", "正文段落数量超出上限。");
	const entries = [], issues = []; let heading = null;
	const issue = (code, message, extra = {}) => issues.push({ severity: "error", code, message, ...extra });
	for (const block of children(body)) {
		if (block.localName === "p") {
			const text = paragraphText(block); const match = text.match(/^(\d+[a-d]?)[.、\s]*(.+)$/i);
			if (match) heading = { code: match[1].toLowerCase(), name: match[2].trim() };
			continue;
		}
		if (block.localName !== "tbl") continue;
		const rows = children(block, "tr").map((row) => children(row, "tc").map(cellText));
		if (rows[0]?.[0] === "Code") continue; // The source's indexes are not teaching prose.
		const relevant = rows.filter((row) => BASE_FIELDS.some(([, , , labels]) => labels.some((label) => normalize(row[0]).includes(normalize(label)))));
		if (!relevant.length) { if (rows.some((row) => row.some((cell) => cell.trim()))) issue("unknownTable", "无法识别的正文表格，请使用固定中英三栏格式。"); heading = null; continue; }
		if (!heading) { issue("missingHeading", "正文表格缺少设施编号和中英文名称。"); continue; }
		const sourceCode = heading.code; const code = canonicalCode(sourceCode); const id = equipmentIdForVideoCode(code); const item = BUILT_IN_EQUIPMENT_CATALOG.find((candidate) => candidate.id === id);
		if (!item || !sourceNames(item).some((zh) => normalize(heading.name) === normalize(`${zh}${item.nameEn}`))) { issue("equipmentIdentityMismatch", `编号 ${sourceCode} 与中英文名称不匹配，未映射到器材。`, { codeValue: sourceCode, name: heading.name }); heading = null; continue; }
		if (entries.some((entry) => entry.id === id)) { issue("duplicateEquipment", `文档重复出现设施 ${sourceCode}。`, { id, codeValue: sourceCode }); heading = null; continue; }
		const languageHeaders = rows.filter((row) => row[0] === "" && row.some((cell) => /^(?:Chinese|English)$/i.test(cell.trim())));
		if (languageHeaders.length !== 1 || languageHeaders[0].length !== 3 || languageHeaders[0][0] !== "" || normalize(languageHeaders[0][1]) !== "chinese" || normalize(languageHeaders[0][2]) !== "english") issue("invalidLanguageHeader", `设施 ${sourceCode} 必须按栏目、Chinese、English 的顺序排列，不能交换或缺少语言表头。`, { id });
		if (block.getElementsByTagNameNS(W, "tbl").length || block.getElementsByTagNameNS(W, "sdt").length) issue("unsupportedNestedContent", `设施 ${sourceCode} 包含嵌套表格或内容控件，请先转换为固定三栏的普通文字。`, { id });
		const fields = {}; const seen = new Set();
		for (const row of rows) {
			const definition = BASE_FIELDS.find(([, , , labels]) => labels.some((label) => normalize(row[0]).includes(normalize(label))));
			if (!definition) {
				if (row.some(Boolean) && !/^(?:photo|chinese|english)?$/i.test(row[0].trim()) && !row.some((cell) => cell === "Chinese" || cell === "English")) issue("unknownField", `设施 ${sourceCode} 有无法识别的栏目：${row[0].slice(0, 100)}`, { id });
				continue;
			}
			const [column] = definition;
			if (seen.has(column)) { issue("duplicateField", `设施 ${sourceCode} 的 ${definition[2]} 重复。`, { id }); continue; } seen.add(column);
			if (row.length !== 3) { issue("missingLanguageColumn", `设施 ${sourceCode} 的 ${definition[2]} 必须包含栏目名、中文、英文三栏。`, { id }); continue; }
			for (const [index, locale] of [[1, "zh"], [2, "en"]]) {
				const value = row[index] === "/" ? "" : row[index];
				if (value.length > EQUIPMENT_DOCUMENT_LIMITS.textLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) issue("fieldTooLarge", `设施 ${sourceCode} 的文本超长或包含控制字符。`, { id });
				else fields[`${column}_${locale}`] = value;
			}
		}
		entries.push({ id, code, sourceCode, nameZh: item.nameZh, nameEn: item.nameEn, fields }); heading = null;
	}
	if (!entries.length) issue("noEquipmentContent", "未找到可导入的设施教学正文。");
	if (entries.length > 29) issue("tooManyEquipment", "设施数量超出固定格式上限。");
	const skipped = EDUCATION_VIDEO_CODES.filter((code) => !entries.some((entry) => entry.code === code)).map((code) => ({ code, id: equipmentIdForVideoCode(code), reason: "文档没有该设施正文，保留现有内容" }));
	const tracked = doc.getElementsByTagNameNS(W, "ins").length + doc.getElementsByTagNameNS(W, "del").length;
	if (tracked) issues.push({ severity: "warning", code: "trackedChanges", message: "文档含修订标记：导入当前可见文本（包含插入、不包含删除），请核对预览。" });
	return { entries, issues, skipped };
}

export async function parseEquipmentDocument(buffer, fileName) {
	if (typeof fileName !== "string" || !/\.docx$/i.test(fileName) || fileName.length > 200 || /[\\/\u0000-\u001f]/.test(fileName)) throw failure("invalidDocxName", "请选择 .docx 文件，不支持 .doc、PDF 或其他格式。");
	return parseEquipmentDocumentXml(await readDocumentXml(buffer));
}

export function createEquipmentDocumentImport({ database, now = () => Date.now(), ttlMs = EQUIPMENT_DOCUMENT_LIMITS.ttlMs }) {
	const getPreview = ({ previewId, actorId }) => {
		const stored = database.prepare("SELECT * FROM equipment_document_previews WHERE id=? AND actor_id=?").get(previewId, actorId);
		if (!stored) throw failure("importPreviewNotFound", "导入预览不存在，请重新选择文件。", 404);
		if (stored.expires_at <= now()) throw failure("importPreviewExpired", "导入预览已过期，请重新预览。", 409);
		return JSON.parse(stored.payload_json);
	};
	const preview = async ({ buffer, fileName, actorId }) => {
		if (!actorId) throw failure("importActorRequired", "请先登录管理员。", 401);
		const parsed = await parseEquipmentDocument(buffer, fileName);
		const entries = parsed.entries.map((entry) => {
			const row = database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(entry.id);
			const canonical = BUILT_IN_EQUIPMENT_CATALOG.find((item) => item.id === entry.id);
			if (!row || row.is_custom || row.deleted_at || !sourceNames(canonical).some((name) => normalize(row.name_zh) === normalize(name)) || normalize(row.name_en) !== normalize(canonical.nameEn)) parsed.issues.push({ severity: "error", code: "targetChanged", id: entry.id, message: `设施 ${entry.code} 的后台名称/身份已变更或已删除，必须先人工核对。` });
			return { ...entry, updatedAt: row?.updated_at || null, fields: Object.entries(entry.fields).map(([field, after]) => {
				const meta = EQUIPMENT_DOCUMENT_FIELDS[field]; const beforeRaw = row?.[field] ?? ""; const before = beforeRaw || evidence[entry.id]?.[meta.locale]?.[meta.key] || "";
				return { field, label: meta.label, before, beforeRaw, after, changed: before !== after, emptySkipped: !after.trim(), selectedDefault: false };
			}) };
		});
		const createdAt = now(); const previewId = crypto.randomUUID();
		const payload = { previewId, confirmationKey: crypto.randomUUID(), documentSha256: hash(buffer), fileName, createdAt, expiresAt: createdAt + ttlMs, entries, issues: parsed.issues, skipped: parsed.skipped, canConfirm: !parsed.issues.some((issue) => issue.severity === "error") };
		database.prepare("DELETE FROM equipment_document_previews WHERE expires_at < ? AND id NOT IN (SELECT preview_id FROM equipment_document_commits)").run(createdAt);
		if (database.prepare("SELECT count(*) AS total FROM equipment_document_previews WHERE actor_id=? AND expires_at>?").get(actorId, createdAt).total >= 10) throw failure("tooManyImportPreviews", "当前预览过多，请等待旧预览过期后重试。", 429);
		database.prepare("INSERT INTO equipment_document_previews(id,actor_id,document_sha256,file_name,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)").run(previewId, actorId, payload.documentSha256, fileName, JSON.stringify(payload), createdAt, payload.expiresAt);
		return payload;
	};
	const confirm = ({ previewId, selections, idempotencyKey, actorId }) => {
		if (!actorId || !/^[a-f0-9-]{32,36}$/i.test(String(idempotencyKey || "")) || !Array.isArray(selections) || !selections.length || selections.length > 29) throw failure("invalidImportConfirmation", "请明确选择需要更新的设施和字段后确认。");
		if (selections.some((entry) => !entry || typeof entry !== "object" || typeof entry.id !== "string" || !Array.isArray(entry.fields) || entry.fields.length > 12 || entry.fields.some((field) => typeof field !== "string"))) throw failure("invalidImportSelection", "字段选择格式无效。");
		const normalized = selections.map((entry) => ({ id: entry.id, fields: [...entry.fields].sort() })).sort((a, b) => a.id.localeCompare(b.id));
		if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length || normalized.some((entry) => !entry.fields.length || new Set(entry.fields).size !== entry.fields.length || entry.fields.some((field) => !Object.hasOwn(EQUIPMENT_DOCUMENT_FIELDS, field)))) throw failure("invalidImportSelection", "字段选择无效或重复。");
		const selectionHash = hash(JSON.stringify({ previewId, selections: normalized }));
		return database.transaction(() => {
			const completed = database.prepare("SELECT * FROM equipment_document_commits WHERE idempotency_key=? OR preview_id=?").get(idempotencyKey, previewId);
			if (completed) {
				if (completed.actor_id !== actorId || completed.preview_id !== previewId || completed.selection_hash !== selectionHash) throw failure("importAlreadyConfirmed", "该预览或确认编号已被使用，不能改变其选择。", 409);
				return { ...JSON.parse(completed.result_json), replayed: true };
			}
			const draft = getPreview({ previewId, actorId });
			if (!draft.canConfirm) throw failure("importPreviewHasErrors", "文档有未解决错误，不能导入。", 409);
			const changes = [];
			for (const selection of normalized) {
				const entry = draft.entries.find((item) => item.id === selection.id); const current = database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(selection.id);
				if (!entry || !current || current.is_custom || current.deleted_at || current.updated_at !== entry.updatedAt) throw failure("importConflict", "预览后设施资料已被修改，请重新预览后确认；本次未更新任何内容。", 409, { id: selection.id });
				for (const field of selection.fields) {
					const value = entry.fields.find((candidate) => candidate.field === field);
					if (!value || !value.changed || value.emptySkipped) throw failure("invalidImportSelection", "不能导入空值、未变化或不在预览中的字段。");
					if (String(current[field] ?? "") !== value.beforeRaw) throw failure("importConflict", "所选字段已被修改，请重新预览；本次未更新任何内容。", 409, { id: selection.id, field });
					changes.push({ id: selection.id, field, label: value.label, before: value.beforeRaw, effectiveBefore: value.before, after: value.after });
				}
			}
			const changedAt = new Date(now()).toISOString();
			for (const change of changes) database.prepare(`UPDATE app_equipment_items SET ${change.field}=?,updated_at=? WHERE id=?`).run(change.after, changedAt, change.id);
			const result = { ok: true, previewId, documentSha256: draft.documentSha256, equipmentCount: normalized.length, fieldCount: changes.length, updatedAt: changedAt };
			database.prepare("INSERT INTO equipment_document_commits(idempotency_key,actor_id,preview_id,selection_hash,result_json,changes_json,created_at) VALUES(?,?,?,?,?,?,?)").run(idempotencyKey, actorId, previewId, selectionHash, JSON.stringify(result), JSON.stringify(changes), now());
			return result;
		}).immediate();
	};
	const history = ({ page = 1, pageSize = 10 } = {}) => {
		if (![page, pageSize].every((value) => typeof value === "number" || (typeof value === "string" && /^[1-9]\d{0,5}$/.test(value)))) throw failure("invalidImportHistoryPage", "分页参数无效。");
		page = Number(page); pageSize = Number(pageSize);
		if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw failure("invalidImportHistoryPage", "分页参数无效。");
		const total = database.prepare("SELECT count(*) AS count FROM equipment_document_commits").get().count;
		const rows = database.prepare("SELECT c.preview_id,c.created_at,c.result_json,p.file_name FROM equipment_document_commits c LEFT JOIN equipment_document_previews p ON p.id=c.preview_id ORDER BY c.created_at DESC,c.preview_id LIMIT ? OFFSET ?").all(pageSize, (page - 1) * pageSize);
		return { total, page, pageSize, items: rows.map((row) => ({ ...JSON.parse(row.result_json), fileName: row.file_name || "DOCX", createdAt: row.created_at })) };
	};
	const audit = ({ previewId }) => {
		if (typeof previewId !== "string" || !/^[a-f0-9-]{36}$/i.test(previewId)) throw failure("invalidImportAudit", "导入记录编号无效。");
		const row = database.prepare("SELECT result_json,changes_json FROM equipment_document_commits WHERE preview_id=?").get(previewId);
		if (!row) throw failure("importAuditNotFound", "没有找到该导入记录。", 404);
		return { ...JSON.parse(row.result_json), changes: JSON.parse(row.changes_json) };
	};
	return { preview, getPreview, confirm, history, audit };
}
