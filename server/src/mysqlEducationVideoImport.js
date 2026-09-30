import { EDUCATION_VIDEO_CODES, equipmentIdForVideoCode } from "./educationVideoCodes.js";
import { EDUCATION_VIDEO_IMPORT_ID } from "./educationVideoImport.js";
import { revalidateAdmin } from "./adminAuthorization.js";
import { writeSystemLog } from "./systemLog.js";
import { lockMysqlMediaNamespace } from "./mysqlMediaFileOperations.js";
export { EDUCATION_VIDEO_IMPORT_ID } from "./educationVideoImport.js";

const enabled = value => [1, "1", 1n].includes(value);
function write(result) {
  if (result?.warningStatus !== 0 || result.affectedRows !== 1) throw new Error("EDUCATION_VIDEO_WRITE_FAILED");
}

// Startup is observational: restoring the database must never replay a historic
// batch over later administrator edits. Explicit maintenance uses the function below.
export async function applyEducationVideoSeed(database, report) {
  if (report?.importId !== EDUCATION_VIDEO_IMPORT_ID) return null;
  const previous = await database.get("SELECT applied_at FROM media_seed_video_bindings WHERE import_id=?", [report.importId]);
  return previous ? { status: "already_applied", appliedAt: previous.applied_at } : { status: "not_applied", requiresExplicitApply: true };
}

export async function applyEducationVideoBindings(database, report, { request } = {}) {
  if (report?.importId !== EDUCATION_VIDEO_IMPORT_ID) return null;
  if (!report.complete || !Array.isArray(report.items)) throw new Error("EDUCATION_VIDEO_IMPORT_INCOMPLETE");
  const availableCodes = EDUCATION_VIDEO_CODES.filter(code => !["13", "27"].includes(code));
  const expected = new Set(availableCodes.flatMap(code => ["zh", "en"].map(locale => `${equipmentIdForVideoCode(code)}:${locale}`)));
  const bindings = report.items.filter(item => item.equipmentId != null);
  for (const item of bindings) {
    const code = String(item.name).match(/^(\d+[a-d]?)(?:\s*\((?:Chi|ENG)\))?\s*\.mp4$/i)?.[1].toLowerCase();
    if (!expected.delete(`${item.equipmentId}:${item.locale}`) || equipmentIdForVideoCode(code) !== item.equipmentId || item.kind !== "video" || item.archived || item.deleted) throw new Error("EDUCATION_VIDEO_IDENTITY_INVALID");
  }
  if (expected.size || bindings.length !== 54) throw new Error("EDUCATION_VIDEO_BINDINGS_INCOMPLETE");
  return database.transaction(async () => {
    await revalidateAdmin(database, request, "app_maintenance.equipment.manage");
    await lockMysqlMediaNamespace(database);
    const previous = await database.get("SELECT applied_at FROM media_seed_video_bindings WHERE import_id=? FOR UPDATE", [report.importId]);
    if (previous) return { status: "already_applied", appliedAt: previous.applied_at };
    for (const item of [...bindings].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const file = await database.get("SELECT id,url,sha256,kind,archived,deleted_at FROM media_files WHERE id=? FOR UPDATE", [item.id]);
      if (!file || file.url !== item.url || file.sha256 !== item.sha256 || file.kind !== "video" || enabled(file.archived) || file.deleted_at) throw new Error("EDUCATION_VIDEO_STORAGE_INVALID");
    }
    const before = [], skipped = [], now = new Date().toISOString();
    const ids = availableCodes.map(equipmentIdForVideoCode).sort();
    for (const id of ids) {
      const equipment = await database.get("SELECT id,is_custom,deleted_at,video_url,video_url_zh,video_url_en,video_localized,youtube_key FROM app_equipment_items WHERE id=? FOR UPDATE", [id]);
      if (!equipment || enabled(equipment.is_custom) || equipment.deleted_at) { skipped.push(id); continue; }
      const zh = bindings.find(item => item.equipmentId === id && item.locale === "zh");
      const en = bindings.find(item => item.equipmentId === id && item.locale === "en");
      before.push({ id, videoUrl: equipment.video_url, videoUrlZh: equipment.video_url_zh, videoUrlEn: equipment.video_url_en,
        videoLocalized: Number(equipment.video_localized), youtubeKey: equipment.youtube_key });
      write(await database.run("UPDATE app_equipment_items SET video_url_zh=?,video_url_en=?,video_localized=1,updated_at=? WHERE id=?", [zh.url, en.url, now, id]));
    }
    write(await database.run("INSERT INTO media_seed_video_bindings(import_id,applied_at,bindings_json,before_json) VALUES(?,?,?,?)", [report.importId, now, JSON.stringify(bindings), JSON.stringify(before)]));
    const result = { status: "applied", facilities: before.length, videos: before.length * 2, skipped, missingCodesPreserved: ["13", "27"] };
    await writeSystemLog(database, request, "education_video.bindings_apply", "media_seed_import", report.importId, result);
    return result;
  });
}
