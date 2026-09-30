import crypto from "node:crypto";
import fs from "node:fs";
import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";
import { EQUIPMENT_DOCUMENT_FIELDS, EQUIPMENT_DOCUMENT_LIMITS, parseEquipmentDocument } from "./equipmentDocumentImport.js";
import { revalidateAdmin } from "./adminAuthorization.js";
import { writeSystemLog } from "./systemLog.js";
export { EQUIPMENT_DOCUMENT_FIELDS, EQUIPMENT_DOCUMENT_LIMITS, parseEquipmentDocument, parseEquipmentDocumentXml } from "./equipmentDocumentImport.js";

const evidence = JSON.parse(fs.readFileSync(new URL("./equipmentGuideEvidence.json", import.meta.url), "utf8"));
const normalize = text => String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const aliases = { "0": ["太極揉推器/太極推手器"], "16": ["下肢的伸展（膕繩肌伸展）"], "28": ["石春路"] };
const sourceNames = item => [item.nameZh, ...(aliases[item.id] || [])];
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const enabled = value => [1, "1", 1n].includes(value);
function failure(code, message, status = 400, details) { return Object.assign(new Error(message), { code, status, details }); }
function integer(value) {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("DOCUMENT_IMPORT_INTEGER_INVALID");
  return Number(value);
}
function write(result, multiple = false) {
  if (result?.warningStatus !== 0 || !Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0 || (!multiple && result.affectedRows !== 1)) throw new Error("DOCUMENT_IMPORT_WRITE_FAILED");
}
async function authorize(database, request, actorId) {
  if (!request || !actorId || request.admin?.user?.id !== actorId) throw failure("importActorRequired", "请先登录管理员。", 401);
  await revalidateAdmin(database, request, "app_maintenance.equipment.manage");
}
function draftFrom(stored, now) {
  if (!stored) throw failure("importPreviewNotFound", "导入预览不存在，请重新选择文件。", 404);
  if (integer(stored.expires_at) <= now()) throw failure("importPreviewExpired", "导入预览已过期，请重新预览。", 409);
  return JSON.parse(stored.payload_json);
}

export function createEquipmentDocumentImport({ database, now = () => Date.now(), ttlMs = EQUIPMENT_DOCUMENT_LIMITS.ttlMs }) {
  const getPreview = async ({ previewId, actorId, request }) => database.transaction(async () => {
    await authorize(database, request, actorId);
    return draftFrom(await database.get("SELECT payload_json,expires_at FROM equipment_document_previews WHERE id=? AND actor_id=?", [previewId, actorId]), now);
  });
  const preview = async ({ buffer, fileName, actorId, request }) => {
    if (!actorId) throw failure("importActorRequired", "请先登录管理员。", 401);
    const parsed = await parseEquipmentDocument(buffer, fileName);
    return database.transaction(async () => {
      await authorize(database, request, actorId);
      const entries = [];
      for (const entry of parsed.entries) {
        const row = await database.get("SELECT * FROM app_equipment_items WHERE id=?", [entry.id]);
        const canonical = BUILT_IN_EQUIPMENT_CATALOG.find(item => item.id === entry.id);
        if (!row || enabled(row.is_custom) || row.deleted_at || !sourceNames(canonical).some(name => normalize(row.name_zh) === normalize(name)) || normalize(row.name_en) !== normalize(canonical.nameEn)) parsed.issues.push({ severity: "error", code: "targetChanged", id: entry.id, message: `设施 ${entry.code} 的后台名称/身份已变更或已删除，必须先人工核对。` });
        entries.push({ ...entry, updatedAt: row?.updated_at || null, fields: Object.entries(entry.fields).map(([field, after]) => {
          const meta = EQUIPMENT_DOCUMENT_FIELDS[field], beforeRaw = row?.[field] ?? "", before = beforeRaw || evidence[entry.id]?.[meta.locale]?.[meta.key] || "";
          return { field, label: meta.label, before, beforeRaw, after, changed: before !== after, emptySkipped: !after.trim(), selectedDefault: false };
        }) });
      }
      const createdAt = now(), previewId = crypto.randomUUID();
      const payload = { previewId, confirmationKey: crypto.randomUUID(), documentSha256: hash(buffer), fileName, createdAt, expiresAt: createdAt + ttlMs,
        entries, issues: parsed.issues, skipped: parsed.skipped, canConfirm: !parsed.issues.some(issue => issue.severity === "error") };
      // Actor lock serializes this owner's preview quota and avoids cross-owner
      // cleanup locking. Joined DELETE reads a different table, avoiding 1093.
      write(await database.run("DELETE p FROM equipment_document_previews p LEFT JOIN equipment_document_commits c ON c.preview_id=p.id WHERE p.actor_id=? AND p.expires_at<? AND c.preview_id IS NULL", [actorId, createdAt]), true);
      if (integer((await database.get("SELECT COUNT(*) AS total FROM equipment_document_previews WHERE actor_id=? AND expires_at>?", [actorId, createdAt])).total) >= 10) throw failure("tooManyImportPreviews", "当前预览过多，请等待旧预览过期后重试。", 429);
      write(await database.run("INSERT INTO equipment_document_previews(id,actor_id,document_sha256,file_name,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)", [previewId, actorId, payload.documentSha256, fileName, JSON.stringify(payload), createdAt, payload.expiresAt]));
      return payload;
    });
  };
  const confirm = async ({ previewId, selections, idempotencyKey, actorId, request }) => {
    if (!actorId || !/^[a-f0-9-]{32,36}$/i.test(String(idempotencyKey || "")) || !Array.isArray(selections) || !selections.length || selections.length > 29) throw failure("invalidImportConfirmation", "请明确选择需要更新的设施和字段后确认。");
    if (selections.some(entry => !entry || typeof entry !== "object" || typeof entry.id !== "string" || !Array.isArray(entry.fields) || entry.fields.length > 12 || entry.fields.some(field => typeof field !== "string"))) throw failure("invalidImportSelection", "字段选择格式无效。");
    const normalized = selections.map(entry => ({ id: entry.id, fields: [...entry.fields].sort() })).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(normalized.map(entry => entry.id)).size !== normalized.length || normalized.some(entry => !entry.fields.length || new Set(entry.fields).size !== entry.fields.length || entry.fields.some(field => !Object.hasOwn(EQUIPMENT_DOCUMENT_FIELDS, field)))) throw failure("invalidImportSelection", "字段选择无效或重复。");
    const selectionHash = hash(JSON.stringify({ previewId, selections: normalized }));
    return database.transaction(async () => {
      await authorize(database, request, actorId);
      const stored = await database.get("SELECT payload_json,expires_at FROM equipment_document_previews WHERE id=? AND actor_id=? FOR UPDATE", [previewId, actorId]);
      const completed = await database.all("SELECT actor_id,preview_id,selection_hash,result_json FROM equipment_document_commits WHERE idempotency_key=? OR preview_id=?", [idempotencyKey, previewId]);
      if (completed.length) {
        if (completed.length !== 1 || completed[0].actor_id !== actorId || completed[0].preview_id !== previewId || completed[0].selection_hash !== selectionHash) throw failure("importAlreadyConfirmed", "该预览或确认编号已被使用，不能改变其选择。", 409);
        return { ...JSON.parse(completed[0].result_json), replayed: true };
      }
      const draft = draftFrom(stored, now);
      if (!draft.canConfirm) throw failure("importPreviewHasErrors", "文档有未解决错误，不能导入。", 409);
      const changes = [], targets = [];
      // Every confirmation locks equipment in the same binary ID order. The
      // selection hash keeps the historic localeCompare ordering for retries.
      for (const selection of [...normalized].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const entry = draft.entries.find(item => item.id === selection.id);
        const current = await database.get("SELECT * FROM app_equipment_items WHERE id=? FOR UPDATE", [selection.id]);
        if (!entry || !current || enabled(current.is_custom) || current.deleted_at || current.updated_at !== entry.updatedAt) throw failure("importConflict", "预览后设施资料已被修改，请重新预览后确认；本次未更新任何内容。", 409, { id: selection.id });
        for (const field of selection.fields) {
          const value = entry.fields.find(candidate => candidate.field === field);
          if (!value || !value.changed || value.emptySkipped) throw failure("invalidImportSelection", "不能导入空值、未变化或不在预览中的字段。");
          if (String(current[field] ?? "") !== value.beforeRaw) throw failure("importConflict", "所选字段已被修改，请重新预览；本次未更新任何内容。", 409, { id: selection.id, field });
          changes.push({ id: selection.id, field, label: value.label, before: value.beforeRaw, effectiveBefore: value.before, after: value.after });
        }
        targets.push(current);
      }
      const changedAt = new Date(Math.max(now(), ...targets.map(row => Date.parse(row.updated_at) + 1))).toISOString();
      for (const target of targets) {
        const fields = changes.filter(change => change.id === target.id);
        write(await database.run(`UPDATE app_equipment_items SET ${fields.map(change => `${change.field}=?`).join(",")},updated_at=? WHERE id=? AND updated_at=?`, [...fields.map(change => change.after), changedAt, target.id, target.updated_at]));
      }
      const result = { ok: true, previewId, documentSha256: draft.documentSha256, equipmentCount: normalized.length, fieldCount: changes.length, updatedAt: changedAt };
      try {
        write(await database.run("INSERT INTO equipment_document_commits(idempotency_key,actor_id,preview_id,selection_hash,result_json,changes_json,created_at) VALUES(?,?,?,?,?,?,?)", [idempotencyKey, actorId, previewId, selectionHash, JSON.stringify(result), JSON.stringify(changes), now()]));
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") throw failure("importAlreadyConfirmed", "该预览或确认编号已被使用，不能改变其选择。", 409);
        throw error;
      }
      await writeSystemLog(database, request, "equipment_document.import", "equipment_document_preview", previewId, { documentSha256: draft.documentSha256, equipmentCount: result.equipmentCount, fieldCount: result.fieldCount });
      return result;
    });
  };
  const history = async ({ page = 1, pageSize = 10, request } = {}) => {
    if (![page, pageSize].every(value => typeof value === "number" || (typeof value === "string" && /^[1-9]\d{0,5}$/.test(value)))) throw failure("invalidImportHistoryPage", "分页参数无效。");
    page = Number(page); pageSize = Number(pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw failure("invalidImportHistoryPage", "分页参数无效。");
    return database.transaction(async () => {
      await authorize(database, request, request?.admin?.user?.id);
      const total = integer((await database.get("SELECT COUNT(*) AS count FROM equipment_document_commits", [])).count);
      const rows = await database.all(`SELECT c.preview_id,c.created_at,c.result_json,p.file_name FROM equipment_document_commits c LEFT JOIN equipment_document_previews p ON p.id=c.preview_id ORDER BY c.created_at DESC,c.preview_id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, []);
      return { total, page, pageSize, items: rows.map(row => ({ ...JSON.parse(row.result_json), fileName: row.file_name || "DOCX", createdAt: integer(row.created_at) })) };
    });
  };
  const audit = async ({ previewId, request }) => {
    if (typeof previewId !== "string" || !/^[a-f0-9-]{36}$/i.test(previewId)) throw failure("invalidImportAudit", "导入记录编号无效。");
    return database.transaction(async () => {
      await authorize(database, request, request?.admin?.user?.id);
      const row = await database.get("SELECT result_json,changes_json FROM equipment_document_commits WHERE preview_id=?", [previewId]);
      if (!row) throw failure("importAuditNotFound", "没有找到该导入记录。", 404);
      return { ...JSON.parse(row.result_json), changes: JSON.parse(row.changes_json) };
    });
  };
  return { preview, getPreview, confirm, history, audit };
}
