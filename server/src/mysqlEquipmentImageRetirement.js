import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { lockMysqlMediaNamespace } from "./mysqlMediaFileOperations.js";
import { lockMysqlApplicationWrites } from "./mysqlRouteTransaction.js";
import { mediaSignatureMatches } from "./mediaLibrary.js";

// No import-time work, DDL or historical orphan sweep. Empty storage_name is a
// permanent tombstone; archived distinguishes pending (0) from removed (1).
const SOURCES = new Set(["upload", "legacy"]);
const HOSTS = new Set(["api.outdoorfit.hk", "admin.outdoorfit.hk", "app.outdoorfit.hk", "outdoor-fit.35-241-75-217.sslip.io"]);
const HASH = /^[a-f0-9]{64}$/;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const BATCH_SIZE = 8;
const RETRY_MS = 60000;
const REFERENCE_FIELDS = Object.freeze({
  app_equipment_items: "image_url,gif_left_url,gif_right_url,video_url,youtube_key,video_url_zh,video_url_en,details_zh,details_en,kinesiology_zh,kinesiology_en,pt_tip_zh,pt_tip_en,ot_tip_zh,ot_tip_en,tcm_zh,tcm_en,care_tip_zh,care_tip_en",
  content_items: "title,value",
  app_text_overrides: "zh,en",
  messages: "body,metadata_json",
  exercise_sessions: "journal,exercises_json,types_json",
  exercise_session_revisions: "snapshot_json,changed_fields_json",
  feedback: "subject,message,notes",
  equipment_document_previews: "payload_json",
});
const enabled = value => [1, "1", 1n].includes(value);
export const isPermanentlyRetiredMedia = row => Boolean(row && SOURCES.has(row.source) && row.storage_name === "");
export const retirementStatus = row => !isPermanentlyRetiredMedia(row) ? null : enabled(row.archived) ? "removed" : "pending";
const digest = value => crypto.createHash("sha256").update(value).digest();
const retained = reason => ({ status: "retained", reason });
function requireWrite(result) {
  if (result?.warningStatus !== 0 || result.affectedRows !== 1) throw new Error("IMAGE_RETIREMENT_WRITE_FAILED");
}

// Only explicit deployment origins and strict managed paths can own a file.
// Reference searches below are intentionally broader, including other origins.
export function managedImageLocation(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  let pathname;
  try {
    if (value.startsWith("/") && !value.startsWith("//")) pathname = new URL(value, "https://api.outdoorfit.hk").pathname;
    else {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname)) return null;
      pathname = url.pathname;
    }
    pathname = decodeURIComponent(pathname);
  } catch { return null; }
  let match = pathname.match(/^\/api\/equipment-images\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|webp))$/);
  if (match) return { url: pathname, source: "legacy", name: match[1] };
  match = pathname.match(/^\/api\/media\/([a-f0-9-]+)\/([a-f0-9-]+\.(?:png|jpg|jpeg|gif|webp|mp4|mov|webm))$/);
  return match ? { url: pathname, source: "upload", id: match[1], name: match[2] } : null;
}

// False positives retain a file. Decode JSON/HTML/URL aliases before comparing
// the unique basename, so absolute URLs and query strings cannot hide a use.
export function textMayReferenceImage(value, name) {
  if (value === null || value === undefined) return false;
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") return true;
  const needle = name.toLowerCase();
  for (let pass = 0; pass < 6; pass++) {
    if (text.toLowerCase().includes(needle)) return true;
    let decoded = text.replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, "/")
      .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (whole, digits) => {
        const number = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
        return number <= 0x10ffff ? String.fromCodePoint(number) : whole;
      });
    try { decoded = decodeURIComponent(decoded); }
    catch {
      // Malformed encoding near any managed media path is ambiguous: retain.
      if (/equipment-images|\/api\/media|%2fapi/i.test(decoded)) return true;
      decoded = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    if (decoded === text) return false;
    text = decoded;
  }
  return text.toLowerCase().includes(needle) || /%[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(text);
}

export async function auditEquipmentImageRetirement(database) {
  const isolation = (await database.get("SELECT @@transaction_isolation AS level"))?.level;
  if (!["REPEATABLE-READ", "SERIALIZABLE"].includes(isolation)) throw Object.assign(new Error("IMAGE_RETIREMENT_ISOLATION_REQUIRED"), { code: "IMAGE_RETIREMENT_ISOLATION_REQUIRED" });
  const row = await database.get("SELECT SUM(CASE WHEN archived=0 THEN 1 ELSE 0 END) AS pendingCount,SUM(CASE WHEN archived=1 THEN 1 ELSE 0 END) AS completedCount FROM media_files WHERE storage_name='' AND deleted_at IS NOT NULL AND source IN ('upload','legacy') AND kind='image'");
  const count = value => { const number = Number(value ?? 0); if (!Number.isSafeInteger(number) || number < 0) throw new Error("IMAGE_RETIREMENT_COUNT_INVALID"); return number; };
  return { mode: "read-only", isolation, pendingCount: count(row.pendingCount), completedCount: count(row.completedCount) };
}

export function createEquipmentImageRetirement({ database, equipmentUploadDir, mediaUploadDir, writeSystemLog, logger = code => console.log(code) }) {
  const roots = { legacy: path.resolve(equipmentUploadDir), upload: path.resolve(mediaUploadDir) };
  let running = false, stopped = false, timer, work, cursor = "";

  async function byUrl(url, lock = false) {
    const row = await database.get(`SELECT * FROM media_files WHERE __url_sha256=?${lock ? " FOR UPDATE" : ""}`, [digest(url)]);
    if (row && row.url !== url) throw new Error("IMAGE_RETIREMENT_DIGEST_COLLISION");
    return row;
  }
  async function referenceAllowed(url, kind, { allowUnregisteredLegacy = false } = {}) {
    const location = managedImageLocation(url);
    if (!location) {
      // A malformed path on our own origin is never treated as an external URL.
      try {
        const parsed = new URL(url, "https://api.outdoorfit.hk");
        if (HOSTS.has(parsed.hostname) && /^\/api\/(?:media|equipment-images)(?:\/|%)/i.test(parsed.pathname)) return false;
      } catch { /* Normal caller validation handles non-URL values. */ }
      return true;
    }
    const row = await byUrl(location.url);
    if (!row) return location.source === "legacy" && allowUnregisteredLegacy;
    return row.kind === kind && !enabled(row.archived) && !row.deleted_at && !isPermanentlyRetiredMedia(row);
  }
  async function protectedReason(row, location) {
    if (await database.get("SELECT file_id FROM media_seed_items WHERE file_id=? LIMIT 1 FOR SHARE", [row.id])) return "seed";
    // Current locking reads retain the range locks until the filesystem action.
    // Refuse weaker isolation rather than assuming a new JSON/text insertion
    // cannot race this scan (some writers do not take the media namespace lock).
    const isolation = await database.get("SELECT @@transaction_isolation AS level");
    if (!["REPEATABLE-READ", "SERIALIZABLE"].includes(isolation?.level)) return "isolation";
    let bytes = 0;
    async function withinBudget(table, columns) {
      // Lock and inspect numeric lengths before transferring potentially large
      // JSON/text values. These same row/range locks prevent a concurrent resize.
      const lengths = columns.split(",").map(column => `OCTET_LENGTH(${column}) AS ${column}`).join(",");
      const rows = await database.all(`SELECT ${lengths} FROM ${table} LIMIT ${MAX_ROWS + 1} FOR SHARE`);
      if (rows.length > MAX_ROWS) return false;
      for (const record of rows) for (const value of Object.values(record)) {
        const length = Number(value ?? 0);
        if (!Number.isSafeInteger(length) || length < 0) return false;
        bytes += length;
        if (bytes > MAX_TEXT_BYTES) return false;
      }
      return true;
    }
    for (const [table, columns] of Object.entries(REFERENCE_FIELDS)) {
      if (!await withinBudget(table, columns)) return "reference_limit";
      const rows = await database.all(`SELECT ${columns} FROM ${table} LIMIT ${MAX_ROWS + 1} FOR SHARE`);
      if (rows.length > MAX_ROWS) return "reference_limit";
      for (const record of rows) for (const value of Object.values(record)) {
        if (textMayReferenceImage(value, location.name)) return "referenced";
      }
    }
    if (!await withinBudget("media_files", "id,url,storage_name")) return "reference_limit";
    const aliases = await database.all(`SELECT id,url,storage_name FROM media_files LIMIT ${MAX_ROWS + 1} FOR SHARE`);
    if (aliases.length > MAX_ROWS) return "reference_limit";
    if (aliases.some(other => other.id !== row.id && (textMayReferenceImage(other.url, location.name) || other.storage_name === location.name))) return "shared_storage";
    return null;
  }
  function storageLocation(row) {
    const location = managedImageLocation(row.url);
    if (!location || row.url !== location.url || location.source !== row.source || row.kind !== "image" || !/^image\/(?:jpeg|png|gif|webp)$/.test(row.mime_type)) return null;
    if (location.source === "upload" && location.id !== row.id) return null;
    if (!isPermanentlyRetiredMedia(row) && location.source === "upload" && row.storage_name !== location.name) return null;
    if (location.source === "legacy" && row.storage_name !== null && row.storage_name !== "") return null;
    return { ...location, root: roots[location.source], file: path.join(roots[location.source], location.name) };
  }
  async function inspectFile(row, location, allowMissing = false) {
    const rootStat = await fs.promises.lstat(location.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.promises.realpath(location.root) !== location.root) throw new Error("IMAGE_RETIREMENT_UNSAFE_ROOT");
    let handle;
    try {
      handle = await fs.promises.open(location.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat(), link = await fs.promises.lstat(location.file);
      if (!stat.isFile() || link.isSymbolicLink() || !link.isFile() || stat.nlink !== 1 || link.nlink !== 1 || stat.ino !== link.ino || stat.dev !== link.dev || stat.size > MAX_IMAGE_BYTES || stat.size < 1) throw new Error("IMAGE_RETIREMENT_UNSAFE_FILE");
      const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(256 * 1024);
      let size = 0, head;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > stat.size || size > MAX_IMAGE_BYTES) throw new Error("IMAGE_RETIREMENT_FILE_CHANGED");
        if (!head) head = Buffer.from(buffer.subarray(0, bytesRead));
        hash.update(buffer.subarray(0, bytesRead));
      }
      const sha256 = hash.digest("hex"), after = await handle.stat();
      if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || !mediaSignatureMatches(head, row.mime_type) ||
          (row.size_bytes !== null && row.size_bytes !== undefined && Number(row.size_bytes) !== size) || (row.sha256 && row.sha256 !== sha256)) throw new Error("IMAGE_RETIREMENT_FILE_CHANGED");
      return { sha256, size, stat };
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") return { missing: true };
      throw error;
    } finally { await handle?.close(); }
  }

  async function prepare({ oldUrl, newUrl, equipmentId, request }) {
    if (!database.inTransaction) throw new Error("IMAGE_RETIREMENT_TRANSACTION_REQUIRED");
    if (!oldUrl || !newUrl || oldUrl === newUrl) return { status: "unchanged" };
    const previous = managedImageLocation(oldUrl), next = managedImageLocation(newUrl);
    if (!previous) return retained("unmanaged");
    if (previous.url === next?.url) return { status: "unchanged" };
    if (!next) return retained("replacement_unmanaged");
    const replacement = await byUrl(next.url, true), replacementLocation = replacement && storageLocation(replacement);
    if (!replacementLocation || replacement.deleted_at || enabled(replacement.archived) || isPermanentlyRetiredMedia(replacement)) return retained("replacement_unverified");
    try { await inspectFile(replacement, replacementLocation); }
    catch { return retained("replacement_unverified"); }
    const row = await byUrl(previous.url, true);
    if (!row || row.deleted_at || enabled(row.archived) || isPermanentlyRetiredMedia(row)) return retained("protected");
    const location = storageLocation(row);
    if (!location) return retained("unmanaged");
    const reason = await protectedReason(row, location);
    if (reason) return retained(reason);
    let evidence;
    try { evidence = await inspectFile(row, location); }
    catch { return retained("file_unverified"); }
    const now = new Date().toISOString();
    requireWrite(await database.run("UPDATE media_files SET deleted_at=?,storage_name='',sha256=?,size_bytes=?,archived=0,updated_at=? WHERE id=? AND deleted_at IS NULL", [now, evidence.sha256, evidence.size, now, row.id]));
    await writeSystemLog(database, request, "equipment.image_retire", "media_file", row.id, { equipmentId, oldUrl: row.url, newUrl, status: "pending", sha256: evidence.sha256, size: evidence.size });
    return { status: "pending", mediaId: row.id };
  }
  async function removeCommitted(id) {
    return database.transaction(async () => {
      await lockMysqlApplicationWrites(database);
      await lockMysqlMediaNamespace(database);
      const row = await database.get("SELECT * FROM media_files WHERE id=? FOR UPDATE", [id]);
      if (!isPermanentlyRetiredMedia(row) || !row.deleted_at || enabled(row.archived)) return "skipped";
      const location = storageLocation(row);
      if (!location || !HASH.test(row.sha256 || "") || !Number.isSafeInteger(Number(row.size_bytes)) || Number(row.size_bytes) < 1) return "pending";
      if (await protectedReason(row, location)) return "pending";
      try {
        const inspected = await inspectFile(row, location, true);
        if (!inspected.missing) {
          const latest = await fs.promises.lstat(location.file), root = await fs.promises.lstat(location.root);
          if (!root.isDirectory() || root.isSymbolicLink() || await fs.promises.realpath(location.root) !== location.root || latest.isSymbolicLink() || !latest.isFile() || latest.nlink !== 1 || latest.ino !== inspected.stat.ino || latest.dev !== inspected.stat.dev || latest.size !== inspected.stat.size || latest.mtimeMs !== inspected.stat.mtimeMs || latest.ctimeMs !== inspected.stat.ctimeMs) return "pending";
          await fs.promises.unlink(location.file);
        }
      } catch { return "pending"; }
      // The prior committed tombstone still blocks restore if this acknowledgement
      // fails or COMMIT becomes unknown. A future attempt safely observes ENOENT.
      requireWrite(await database.run("UPDATE media_files SET archived=1,updated_at=? WHERE id=? AND storage_name='' AND deleted_at IS NOT NULL", [new Date().toISOString(), row.id]));
      return "removed";
    }, { isolationLevel: "REPEATABLE READ" });
  }
  async function drain() {
    if (database.inTransaction) throw new Error("IMAGE_RETIREMENT_REQUIRES_FRESH_CONTEXT");
    const rows = await database.all(`SELECT id FROM media_files WHERE storage_name='' AND deleted_at IS NOT NULL AND source IN ('upload','legacy') AND kind='image' AND archived=0 AND id>? ORDER BY id LIMIT ${BATCH_SIZE}`, [cursor]);
    if (!rows.length) { cursor = ""; return; }
    let pending = 0, removed = 0;
    for (const row of rows) {
      if (stopped) break;
      cursor = row.id;
      try { const result = await removeCommitted(row.id); if (result === "removed") removed++; else if (result === "pending") pending++; }
      catch { pending++; }
    }
    if (pending) logger("EQUIPMENT_IMAGE_CLEANUP_PENDING");
    if (removed) logger("EQUIPMENT_IMAGE_CLEANUP_REMOVED " + removed);
  }
  function enqueue() {
    if (stopped || work) return work ?? Promise.resolve();
    if (database.inTransaction) throw new Error("IMAGE_RETIREMENT_REQUIRES_FRESH_CONTEXT");
    work = drain().catch(() => logger("EQUIPMENT_IMAGE_CLEANUP_PENDING")).finally(() => { work = undefined; });
    return work;
  }
  function start() {
    if (stopped || running) return;
    running = true;
    timer = setInterval(() => { void enqueue(); }, RETRY_MS);
    timer.unref?.();
    void enqueue();
  }
  async function stop() { stopped = true; clearInterval(timer); await work; }
  return { prepare, referenceAllowed, byUrl, enqueue, start, stop };
}
