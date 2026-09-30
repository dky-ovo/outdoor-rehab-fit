import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mediaTransaction, mediaFail, mediaWrite, commitUnknown, normalizeMediaRow } from "./mysqlMediaFileOperations.js";

const DIGEST = /^[a-f0-9]{64}$/;
function hashFile(file, maximum) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximum) mediaFail("invalidSeedFile");
    const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0, head = Buffer.alloc(0), count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      const chunk = buffer.subarray(0, count);
      hash.update(chunk); bytes += count;
      if (bytes > stat.size || bytes > maximum) mediaFail("seedChangedDuringCopy");
      if (!head.length) head = Buffer.from(chunk.subarray(0, 65536));
    }
    if (bytes !== stat.size) mediaFail("seedChangedDuringCopy");
    return { sha256: hash.digest("hex"), size: bytes, head };
  } finally { fs.closeSync(descriptor); }
}

// Startup must omit allowImport (the default is a complete no-op). This entry
// is solely for a future, explicitly authorized seed import after migration.
// It preserves existing ledger decisions and never rewrites deleted media.
export async function importMediaStorageSeed({ database, mediaSeedDir, storageRoot, types, limits, signatureMatches, validName,
  allowImport = false, request, writeSystemLog }) {
  if (!allowImport || !mediaSeedDir) return null;
  if (database?.dialect !== "mysql" || !request || typeof writeSystemLog !== "function") mediaFail("mediaSeedAuthorizationRequired", 500);
  const manifestPath = path.join(mediaSeedDir, "manifest.json"), filesRoot = path.join(mediaSeedDir, "files");
  let manifest;
  try {
    if (fs.lstatSync(mediaSeedDir).isSymbolicLink() || fs.lstatSync(filesRoot).isSymbolicLink()) return null;
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return null;
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch { return null; }
  if (manifest?.version !== 2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.importId || "") || !Array.isArray(manifest.items) || manifest.items.length > 10000) return null;
  const report = { importId: manifest.importId, items: [], errors: [], complete: false };
  const change = callback => mediaTransaction(database, request, "app_maintenance.files.manage", callback);
  // Even a fully imported, read-only ledger result requires a current actor.
  await change(async () => {});
  const ensureFolder = async value => {
    if (!value) return "";
    if (typeof value !== "string") mediaFail("invalidFolderPath");
    const parts = value.split("/");
    if (parts.length > limits.maxFolderDepth || parts.some(part => !validName(part))) mediaFail("invalidFolderPath");
    let folderPath = "", parentId = "";
    for (const name of parts) {
      folderPath = folderPath ? `${folderPath}/${name}` : name;
      const digest = crypto.createHash("sha256").update(folderPath, "utf8").digest();
      const imported = await database.get("SELECT folder_path,folder_id FROM media_seed_folders WHERE import_id=? AND __folder_path_sha256=?", [manifest.importId, digest]);
      if (imported && imported.folder_path !== folderPath) mediaFail("mediaFolderDigestCollision", 500);
      let row = imported ? await database.get("SELECT * FROM media_folders WHERE id=?", [imported.folder_id]) : await database.get("SELECT * FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL", [parentId, name]);
      if (imported && (!row || row.deleted_at)) mediaFail("seedFolderDeletedByAdministrator");
      if (!row) {
        const now = new Date().toISOString(); row = { id: crypto.randomUUID() };
        mediaWrite(await database.run("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)", [row.id, parentId, name, now, now]));
      }
      if (!imported) mediaWrite(await database.run("INSERT INTO media_seed_folders(import_id,folder_path,folder_id) VALUES(?,?,?)", [manifest.importId, folderPath, row.id]));
      parentId = row.id;
    }
    return parentId;
  };
  try {
    const rootStat = fs.lstatSync(storageRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) mediaFail("unsafeMediaStorage");
    const folders = (Array.isArray(manifest.folders) ? manifest.folders : []).slice(0, 10000);
    if (folders.length) await change(async () => {
      for (const folder of folders) await ensureFolder(folder);
      await writeSystemLog(database, request, "media.seed_folders", "media_seed", manifest.importId, { folderCount: folders.length });
    });
  } catch (error) {
    if (commitUnknown(error)) throw error;
    report.errors.push({ fileName: "", error: error?.status ? error.code : "mediaSeedImportFailed" }); return report;
  }
  const seen = new Set();
  for (const item of manifest.items) {
    let ownedPath, retainFile = false;
    try {
      const fileName = String(item?.fileName || ""), mimeType = String(item?.mimeType || "application/octet-stream").toLowerCase(), expected = String(item?.sha256 || "").toLowerCase();
      if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}$/.test(fileName) || seen.has(fileName) || !DIGEST.test(expected) || !validName(item.name)) mediaFail("invalidSeedItem");
      seen.add(fileName);
      const extension = path.extname(fileName).slice(1).toLowerCase();
      if (types[mimeType] && !types[mimeType].includes(extension)) mediaFail("invalidSeedMediaType");
      const kind = types[mimeType] ? mimeType.startsWith("video/") ? "video" : "image" : "file";
      const previous = await database.get("SELECT file_id FROM media_seed_items WHERE import_id=? AND file_name=?", [manifest.importId, fileName]);
      let row = previous && await database.get("SELECT * FROM media_files WHERE id=?", [previous.file_id]);
      if (previous && !row) mediaFail("seedFileRemovedByAdministrator");
      if (row && row.sha256 !== expected) mediaFail("seedImportIdContentChanged");
      if (!row) {
        const sourcePath = path.join(filesRoot, fileName), stat = fs.lstatSync(sourcePath);
        const maximum = kind === "video" ? limits.videoBytes : kind === "image" ? limits.imageBytes : limits.fileBytes;
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || (!stat.size && kind !== "file")) mediaFail("invalidSeedFile");
        const source = hashFile(sourcePath, maximum);
        if (source.sha256 !== expected || source.size > maximum || (kind !== "file" && !signatureMatches(source.head, mimeType))) mediaFail("invalidSeedHashOrSignature");
        const id = crypto.randomUUID(), storageName = `${id}.${types[mimeType]?.[0] || "bin"}`;
        const destination = path.join(storageRoot, storageName);
        // Reserve the exact owned name first; failed copy can only remove it.
        const descriptor = fs.openSync(destination, "wx", 0o600); ownedPath = destination; fs.closeSync(descriptor);
        fs.copyFileSync(sourcePath, destination); fs.chmodSync(destination, 0o600);
        const copied = hashFile(destination, maximum);
        if (copied.sha256 !== expected || copied.size !== source.size) mediaFail("seedChangedDuringCopy");
        const output = await change(async () => {
          const ledger = await database.get("SELECT file_id FROM media_seed_items WHERE import_id=? AND file_name=?", [manifest.importId, fileName]);
          if (ledger) {
            const existing = await database.get("SELECT * FROM media_files WHERE id=?", [ledger.file_id]);
            if (!existing) mediaFail("seedFileRemovedByAdministrator");
            if (existing.sha256 !== expected) mediaFail("seedImportIdContentChanged");
            return { row: existing, created: false };
          }
          const folderId = await ensureFolder(item.folderPath || ""), now = new Date().toISOString();
          let categoryId = (await database.get("SELECT id FROM media_categories WHERE id=?", [typeof item.categoryId === "string" ? item.categoryId : ""]))?.id;
          if (!categoryId && typeof item.categoryName === "string" && validName(item.categoryName) && item.categoryName.length <= 80) {
            let category = await database.get("SELECT id FROM media_categories WHERE name=?", [item.categoryName]);
            if (!category) {
              category = { id: crypto.randomUUID() };
              mediaWrite(await database.run("INSERT INTO media_categories(id,name,created_at,updated_at) VALUES(?,?,?,?)", [category.id, item.categoryName, now, now]));
            }
            categoryId = category.id;
          }
          categoryId ||= kind === "video" ? "videos" : kind === "image" ? mimeType === "image/gif" ? "facilities-gifs" : "facilities-images" : "other";
          if (!await database.get("SELECT id FROM media_categories WHERE id=?", [categoryId])) mediaFail("mediaCategoryNotFound");
          mediaWrite(await database.run("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_at,updated_at,folder_id) VALUES(?,?,?,?,?,?,?,'upload',?,?,?,?,?,?)", [id, `/api/media/${id}/${storageName}`, item.name, mimeType, kind, copied.size, categoryId, storageName, expected, item.archived || item.archiveOnly ? 1 : 0, now, now, folderId]));
          mediaWrite(await database.run("INSERT INTO media_seed_items(import_id,file_name,file_id,created_at) VALUES(?,?,?,?)", [manifest.importId, fileName, id, now]));
          await writeSystemLog(database, request, "media.seed_import", "media_file", id, { importId: manifest.importId, size: copied.size });
          return { row: await database.get("SELECT * FROM media_files WHERE id=?", [id]), created: true };
        });
        row = output.row; retainFile = output.created;
      }
      row = normalizeMediaRow(row);
      report.items.push({ id: row.id, url: row.url, name: row.name, sha256: row.sha256, kind: row.kind, folderId: row.folder_id, archived: Boolean(row.archived), deleted: Boolean(row.deleted_at),
        equipmentId: item.equipmentId === undefined ? null : String(item.equipmentId), locale: ["zh", "en"].includes(item.locale) ? item.locale : null, fileName });
    } catch (error) {
      if (commitUnknown(error)) { retainFile = true; throw error; }
      report.errors.push({ fileName: String(item?.fileName || ""), error: error?.status ? error.code : "mediaSeedImportFailed" });
    } finally {
      if (ownedPath && !retainFile) try { fs.unlinkSync(ownedPath); } catch { /* Only this attempt's newly owned path is eligible. */ }
    }
  }
  report.complete = report.errors.length === 0 && report.items.length === manifest.items.length;
  return report;
}
