import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidateAdmin } from "./adminAuthorization.js";
export { MEDIA_OPERATION_LIMITS } from "./mediaFileOperations.js";
import { MEDIA_OPERATION_LIMITS } from "./mediaFileOperations.js";

export class MysqlMediaError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function mediaFail(code, status = 409) { throw new MysqlMediaError(code, status); }
export const commitUnknown = error => error?.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN";
export function mediaWrite(result) {
  if (result?.warningStatus !== 0) mediaFail("mediaWriteFailed", 500);
  return result;
}
export function normalizeMediaRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of ["size_bytes", "archived"]) if (result[field] !== undefined && result[field] !== null) {
    const number = Number(result[field]);
    if (!Number.isSafeInteger(number) || number < 0) mediaFail("mediaMetadataInvalid", 500);
    result[field] = number;
  }
  return result;
}

// The imported category is an existing, durable lock anchor, including for the
// virtual root folder. Every media/reference writer takes this after actor locks.
export async function lockMysqlMediaNamespace(database) {
  if (!database.inTransaction) mediaFail("mediaTransactionRequired", 500);
  if (!await database.get("SELECT id FROM media_categories WHERE id=? FOR UPDATE", ["other"])) mediaFail("mediaNamespaceUnavailable", 503);
}
export async function mediaTransaction(database, request, permission, callback) {
  return database.transaction(async tx => {
    await revalidateAdmin(database, request, permission);
    await lockMysqlMediaNamespace(database);
    return callback(tx);
  });
}
export const mediaRoute = handler => async (request, response) => {
  try { await handler(request, response); }
  catch (error) {
    if (response.headersSent || request.aborted) return;
    const full = ["ENOSPC", "EDQUOT", "ER_RECORD_FILE_FULL", "ER_DISK_FULL"].includes(error?.code);
    const known = error instanceof MysqlMediaError || error?.authorizationError;
    const duplicate = error?.code === "ER_DUP_ENTRY";
    response.status(full ? 507 : known ? error.status : duplicate ? 409 : commitUnknown(error) ? 503 : 500).json({
      error: full ? "mediaStorageFull" : known ? error.code : duplicate ? "mediaNameConflict" : commitUnknown(error) ? "mediaCommitOutcomeUnknown" : "mediaOperationFailed",
    });
  }
};

export function createMysqlMediaFileOperations({ database, storageRoot, maxFolderDepth = 32 }) {
  let copying = false;
  const folderById = async id => database.get("SELECT * FROM media_folders WHERE id=? AND deleted_at IS NULL", [id]);
  const fileById = async id => normalizeMediaRow(await database.get("SELECT * FROM media_files WHERE id=? AND deleted_at IS NULL", [id]));
  const folderTrail = async (id, allowDeleted = false) => {
    const trail = [], visited = new Set();
    while (id) {
      if (visited.has(id) || trail.length >= maxFolderDepth) return null;
      visited.add(id);
      const row = await database.get("SELECT * FROM media_folders WHERE id=?", [id]);
      if (!row || (!allowDeleted && row.deleted_at)) return null;
      trail.unshift({ id: row.id, name: row.name, parentId: row.parent_id }); id = row.parent_id;
    }
    return trail;
  };
  const descendants = async (id, activeOnly = false) => {
    const rows = await database.all("SELECT * FROM media_folders ORDER BY id");
    const eligible = rows.filter(row => !activeOnly || !row.deleted_at), root = eligible.find(row => row.id === id);
    if (!root) return [];
    const children = new Map();
    for (const row of eligible) { if (!children.has(row.parent_id)) children.set(row.parent_id, []); children.get(row.parent_id).push(row); }
    const result = [], visited = new Set(), queue = [root];
    for (let index = 0; index < queue.length; index++) {
      const row = queue[index];
      if (visited.has(row.id)) continue;
      visited.add(row.id); result.push(row);
      if (result.length > MEDIA_OPERATION_LIMITS.descendants) break;
      queue.push(...(children.get(row.id) || []));
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  };
  const namesIn = async parentId => new Set([
    ...await database.all("SELECT name FROM media_folders WHERE parent_id=? AND deleted_at IS NULL", [parentId]),
    ...await database.all("SELECT name FROM media_files WHERE folder_id=? AND deleted_at IS NULL", [parentId]),
  ].map(row => row.name));
  const nameExists = async (parentId, name, exceptKind = "", exceptId = "") => Boolean(
    await database.get("SELECT id FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL AND id!=? LIMIT 1", [parentId, name, exceptKind === "folder" ? exceptId : ""]) ||
    await database.get("SELECT id FROM media_files WHERE folder_id=? AND name=? AND deleted_at IS NULL AND id!=? LIMIT 1", [parentId, name, exceptKind === "file" ? exceptId : ""])
  );
  const readSelection = async (body, mode) => {
    if (!Array.isArray(body?.items) || !body.items.length || body.items.length > MEDIA_OPERATION_LIMITS.selected || body.items.some(item => !item || typeof item.id !== "string" || !item.id || !["file", "folder"].includes(item.kind))) mediaFail("invalidMediaSelection", 400);
    if (body.targetFolderId !== undefined && typeof body.targetFolderId !== "string") mediaFail("mediaFolderNotFound", 400);
    const targetFolderId = body.targetFolderId || "", targetTrail = await folderTrail(targetFolderId);
    if (!targetTrail) mediaFail("mediaFolderNotFound", 404);
    const selected = [...new Map(body.items.map(item => [`${item.kind}:${item.id}`, { kind: item.kind, id: item.id }])).values()];
    const allFolders = new Map(), allFiles = new Map();
    for (const item of selected) {
      const row = item.kind === "folder" ? await folderById(item.id) : await fileById(item.id);
      if (!row || !await folderTrail(item.kind === "folder" ? row.id : row.folder_id)) mediaFail(item.kind === "folder" ? "mediaFolderNotFound" : "mediaNotFound", 404);
      item.row = row;
      if (item.kind === "folder") {
        const children = await descendants(row.id, true);
        if (children.length > MEDIA_OPERATION_LIMITS.descendants) mediaFail("mediaSelectionTooLarge", 400);
        for (const folder of children) {
          allFolders.set(folder.id, folder);
          for (const file of await database.all("SELECT * FROM media_files WHERE folder_id=? AND deleted_at IS NULL LIMIT 10001", [folder.id])) allFiles.set(file.id, normalizeMediaRow(file));
          if (allFiles.size + allFolders.size > MEDIA_OPERATION_LIMITS.descendants) mediaFail("mediaSelectionTooLarge", 400);
        }
      } else allFiles.set(row.id, row);
    }
    if (allFiles.size + allFolders.size > MEDIA_OPERATION_LIMITS.descendants) mediaFail("mediaSelectionTooLarge", 400);
    const roots = selected.filter(item => !allFolders.has(item.kind === "folder" ? item.row.parent_id : item.row.folder_id));
    if (mode === "move" && allFolders.has(targetFolderId)) mediaFail("mediaFolderCycle");
    for (const item of roots.filter(item => item.kind === "folder")) {
      const sourceTrail = await folderTrail(item.id);
      for (const folder of await descendants(item.id, true)) {
        const trail = await folderTrail(folder.id);
        if (!trail || targetTrail.length + trail.length - sourceTrail.length + 1 > maxFolderDepth) mediaFail("mediaFolderTooDeep");
      }
    }
    if (mode === "copy" && [...allFiles.values()].some(file => file.source !== "upload" || !/^[a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|mov|webm|bin)$/.test(file.storage_name))) mediaFail("mediaCopyUnsupported");
    return { targetFolderId, roots, folders: [...allFolders.values()].sort((a, b) => a.id.localeCompare(b.id)), files: [...allFiles.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  };
  const snapshot = plan => JSON.stringify({ roots: plan.roots, folders: plan.folders, files: plan.files });
  const copyName = (name, occupied, isFolder) => {
    if (!occupied.has(name)) { occupied.add(name); return name; }
    const detected = isFolder ? "" : path.extname(name), extension = detected.length <= 32 ? detected : "", stem = extension ? name.slice(0, -extension.length) : name;
    for (let number = 1; number <= MEDIA_OPERATION_LIMITS.descendants + 1000; number++) {
      const suffix = ` - 副本${number === 1 ? "" : ` (${number})`}${extension}`, candidate = stem.slice(0, Math.max(1, 200 - suffix.length)) + suffix;
      if (!occupied.has(candidate)) { occupied.add(candidate); return candidate; }
    }
    mediaFail("mediaNameConflict");
  };
  const register = ({ app, managePermission, writeSystemLog, publicItem, publicFolder, validStorageName }) => {
    const change = (request, callback) => mediaTransaction(database, request, "app_maintenance.files.manage", callback);
    const rootResults = async roots => {
      const result = [];
      for (const item of roots) result.push(item.kind === "folder" ? publicFolder(await folderById(item.id)) : await publicItem(await fileById(item.id)));
      return result;
    };
    app.patch("/api/admin/media/folders/:id", managePermission, mediaRoute(async (request, response) => {
      const name = request.body?.name;
      if (!validStorageName(name)) mediaFail("invalidStorageName", 400);
      const result = await change(request, async () => {
        const row = await folderById(request.params.id);
        if (!row || !await folderTrail(row.id)) mediaFail("mediaFolderNotFound", 404);
        if (await nameExists(row.parent_id, name, "folder", row.id)) mediaFail("mediaNameConflict");
        mediaWrite(await database.run("UPDATE media_folders SET name=?,updated_at=? WHERE id=?", [name, new Date().toISOString(), row.id]));
        await writeSystemLog(database, request, "media.folder_rename", "media_folder", row.id, { beforeName: row.name, name });
        return publicFolder(await folderById(row.id));
      });
      response.json({ folder: result });
    }));
    app.post("/api/admin/media/move", managePermission, mediaRoute(async (request, response) => {
      const result = await change(request, async () => {
        const plan = await readSelection(request.body, "move"), reserved = new Set();
        for (const item of plan.roots) {
          if (reserved.has(item.row.name) || await nameExists(plan.targetFolderId, item.row.name, item.kind, item.id)) mediaFail("mediaNameConflict");
          reserved.add(item.row.name);
        }
        let movedFiles = 0, movedFolders = 0;
        const now = new Date().toISOString();
        for (const item of plan.roots) {
          if ((item.kind === "folder" ? item.row.parent_id : item.row.folder_id) === plan.targetFolderId) continue;
          if (item.kind === "folder") { mediaWrite(await database.run("UPDATE media_folders SET parent_id=?,updated_at=? WHERE id=?", [plan.targetFolderId, now, item.id])); movedFolders++; }
          else { mediaWrite(await database.run("UPDATE media_files SET folder_id=?,updated_at=? WHERE id=?", [plan.targetFolderId, now, item.id])); movedFiles++; }
        }
        await writeSystemLog(database, request, "media.move", "media_file", null, { targetFolderId: plan.targetFolderId, movedFiles, movedFolders });
        return { items: await rootResults(plan.roots), movedFiles, movedFolders };
      });
      response.json(result);
    }));
    app.post("/api/admin/media/copy", managePermission, mediaRoute(async (request, response) => {
      if (copying) mediaFail("tooManyMediaCopies", 429);
      copying = true;
      const ownedPaths = []; let retainFiles = false;
      try {
        const plan = await readSelection(request.body, "copy"), before = snapshot(plan), copies = [];
        if (plan.files.length) {
          const rootStat = fs.lstatSync(storageRoot);
          if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) mediaFail("mediaUnavailable", 404);
          let bytes = 0;
          for (const row of plan.files) {
            const stat = fs.lstatSync(path.join(storageRoot, row.storage_name));
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) mediaFail("mediaUnavailable", 404);
            bytes += stat.size; if (bytes > MEDIA_OPERATION_LIMITS.copyBytes) mediaFail("mediaCopyTooLarge", 413);
          }
          const free = fs.statfsSync(storageRoot);
          if (free.bavail * free.bsize < bytes + MEDIA_OPERATION_LIMITS.reserveBytes) mediaFail("mediaStorageFull", 507);
        }
        for (const row of plan.files) {
          if (request.aborted || response.destroyed) mediaFail("mediaCopyCancelled");
          const id = crypto.randomUUID(), storageName = `${id}${path.extname(row.storage_name)}`, finalPath = path.join(storageRoot, storageName), partialPath = path.join(storageRoot, `${id}.partial`);
          let source, destination;
          try {
            source = await fs.promises.open(path.join(storageRoot, row.storage_name), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
            const stat = await source.stat();
            if (!stat.isFile() || stat.nlink > 1 || (row.size_bytes !== null && stat.size !== row.size_bytes)) mediaFail("mediaUnavailable", 404);
            destination = await fs.promises.open(partialPath, "wx", 0o600); ownedPaths.push(partialPath);
            const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
            while (true) {
              const { bytesRead } = await source.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
              bytes += bytesRead; if (bytes > stat.size) mediaFail("mediaChangedDuringCopy");
              if (request.aborted || response.destroyed) mediaFail("mediaCopyCancelled");
              const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await destination.writeFile(chunk);
            }
            const sha256 = hash.digest("hex");
            if (bytes !== stat.size || (row.sha256 && sha256 !== row.sha256)) mediaFail("mediaChangedDuringCopy");
            await destination.sync(); await destination.close(); destination = null;
            await fs.promises.link(partialPath, finalPath); ownedPaths.push(finalPath); await fs.promises.unlink(partialPath);
            copies.push({ old: row, id, storageName, size: bytes, sha256, url: `/api/media/${id}/${storageName}` });
          } finally { if (source) await source.close().catch(() => {}); if (destination) await destination.close().catch(() => {}); }
        }
        const result = await change(request, async () => {
          if (snapshot(await readSelection(request.body, "copy")) !== before) mediaFail("mediaChangedDuringCopy");
          const now = new Date().toISOString(), folderIds = new Map(plan.folders.map(folder => [folder.id, crypto.randomUUID()])), rootKeys = new Set(plan.roots.map(item => `${item.kind}:${item.id}`)), occupied = new Map();
          const availableNames = async parentId => { if (!occupied.has(parentId)) occupied.set(parentId, await namesIn(parentId)); return occupied.get(parentId); };
          // Insert parents before children even though the source UUID order is arbitrary.
          const folders = [...plan.folders];
          const insertedFolders = new Set();
          while (folders.length) {
            const index = folders.findIndex(row => rootKeys.has(`folder:${row.id}`) || insertedFolders.has(row.parent_id));
            if (index < 0) mediaFail("mediaFolderCycle");
            const [row] = folders.splice(index, 1), parentId = rootKeys.has(`folder:${row.id}`) ? plan.targetFolderId : folderIds.get(row.parent_id);
            const name = copyName(row.name, await availableNames(parentId), true);
            mediaWrite(await database.run("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)", [folderIds.get(row.id), parentId, name, now, now]));
            insertedFolders.add(row.id);
          }
          for (const item of copies) {
            const parentId = rootKeys.has(`file:${item.old.id}`) ? plan.targetFolderId : folderIds.get(item.old.folder_id);
            if (parentId === undefined) mediaFail("mediaChangedDuringCopy");
            const name = copyName(item.old.name, await availableNames(parentId), false);
            mediaWrite(await database.run("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_by,created_at,updated_at,folder_id) VALUES(?,?,?,?,?,?,?,'upload',?,?,?,?,?,?,?)", [item.id, item.url, name, item.old.mime_type, item.old.kind, item.size, item.old.category_id, item.storageName, item.sha256, item.old.archived, request.admin.user.id, now, now, parentId]));
          }
          const roots = plan.roots.map(item => ({ kind: item.kind, id: item.kind === "folder" ? folderIds.get(item.id) : copies.find(copy => copy.old.id === item.id).id }));
          await writeSystemLog(database, request, "media.copy", "media_file", null, { targetFolderId: plan.targetFolderId, copiedFiles: copies.length, copiedFolders: plan.folders.length });
          return { items: await rootResults(roots), copiedFiles: copies.length, copiedFolders: plan.folders.length };
        });
        retainFiles = true; response.status(201).json(result);
      } catch (error) { if (commitUnknown(error)) retainFiles = true; throw error; }
      finally { if (!retainFiles) for (const file of ownedPaths) await fs.promises.unlink(file).catch(() => {}); copying = false; }
    }));
  };
  return { folderById, fileById, folderTrail, descendants, namesIn, nameExists, register };
}

export async function registerMediaFileOperations(options) {
  const operations = createMysqlMediaFileOperations(options);
  operations.register(options);
  return operations;
}
