import { additionalEquipmentVideoUrls } from "./equipmentExtensions.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MEDIA_LIMITS, safeMediaUrl, safeDirectVideoUrl, mediaSignatureMatches, validStorageName } from "./mediaLibrary.js";
import { revalidateAdmin } from "./adminAuthorization.js";
import { createMysqlMediaFileOperations, mediaTransaction, lockMysqlMediaNamespace, mediaRoute, mediaFail, mediaWrite, commitUnknown, normalizeMediaRow } from "./mysqlMediaFileOperations.js";
import { isPermanentlyRetiredMedia, retirementStatus } from "./mysqlEquipmentImageRetirement.js";
import { createPublicVideoDelivery } from "./publicVideoDelivery.js";
export { MEDIA_LIMITS, safeMediaUrl, safeDirectVideoUrl, mediaSignatureMatches, validStorageName };

const TYPES = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/gif": ["gif"], "image/webp": ["webp"],
  "video/mp4": ["mp4", "m4v"], "video/quicktime": ["mov"], "video/webm": ["webm"],
};
const READ_PERMISSIONS = ["app_maintenance.files.manage", "app_maintenance.equipment.manage", "app_maintenance.home.manage"];
const MANAGE = "app_maintenance.files.manage";
const EQUIPMENT_FIELDS = ["image_url", "gif_left_url", "gif_right_url", "video_url", "youtube_key", "video_url_zh", "video_url_en", "additional_videos_json"];
const cleanName = value => String(value || "").replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 200);
const asciiLower = value => String(value).replace(/[A-Z]/g, character => character.toLowerCase());
const integer = (value, fallback, maximum) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), maximum) : fallback;
const textCompare = (a, b) => Buffer.compare(Buffer.from(String(a ?? ""), "utf8"), Buffer.from(String(b ?? ""), "utf8"));

// Registration is intentionally read-only. Existing imported metadata and seed
// ledgers are authoritative: no startup scans, INSERT defaults or seed replay.
export async function registerMediaLibrary({ app, database, mediaUploadDir, equipmentUploadDir, mediaSeedDir, mediaVideoDeliveryRoot, mediaVideoDeliveryManifest, mediaVideoCdnOrigin, requirePermission, requireAnyPermission, writeSystemLog }) {
  if (database?.dialect !== "mysql") mediaFail("mediaMysqlRequired", 500);
  if (!await database.get("SELECT id FROM media_categories WHERE id=?", ["other"])) mediaFail("mediaNamespaceUnavailable", 503);
  const readPermission = requireAnyPermission(...READ_PERMISSIONS), managePermission = requirePermission(MANAGE);
  const storageRoot = path.resolve(mediaUploadDir);
  const videoDelivery = createPublicVideoDelivery({ storageRoot, derivativeRoot: mediaVideoDeliveryRoot && path.join(mediaVideoDeliveryRoot, "derivatives"), manifestPath: mediaVideoDeliveryManifest, cdnOrigin: mediaVideoCdnOrigin });
  const operations = createMysqlMediaFileOperations({ database, storageRoot, maxFolderDepth: MEDIA_LIMITS.maxFolderDepth });
  const { folderTrail, descendants } = operations;
  let activeUploads = 0;
  const change = (request, callback, permission = MANAGE) => mediaTransaction(database, request, permission, callback);
  const categories = () => database.all("SELECT id,name FROM media_categories ORDER BY created_at,id");
  const references = async () => {
    const used = new Set();
    // Identifiers are a fixed source-schema allowlist, never HTTP input.
    for (const row of await database.all(`SELECT ${EQUIPMENT_FIELDS.join(",")} FROM app_equipment_items`)) {
      for (const field of EQUIPMENT_FIELDS) if (row[field]) used.add(row[field]);
      for (const url of additionalEquipmentVideoUrls(row.additional_videos_json)) used.add(url);
      if (/^[A-Za-z0-9_-]{11}$/.test(row.youtube_key)) used.add(`https://www.youtube.com/watch?v=${row.youtube_key}`);
    }
    for (const row of await database.all("SELECT value FROM content_items WHERE content_type='video'")) {
      used.add(row.value);
      if (/^[A-Za-z0-9_-]{11}$/.test(row.value)) used.add(`https://www.youtube.com/watch?v=${row.value}`);
    }
    return used;
  };
  const publicItem = async (value, used, categoryNames) => {
    const row = normalizeMediaRow(value);
    used ??= await references();
    const categoryName = categoryNames ? categoryNames.get(row.category_id) || "" : (await database.get("SELECT name FROM media_categories WHERE id=?", [row.category_id]))?.name || "";
    return { id: row.id, url: row.url, name: row.name, mimeType: row.mime_type, kind: row.kind, size: row.size_bytes,
      categoryId: row.category_id, categoryName, source: row.source, archived: Boolean(row.archived), isReferenced: used.has(row.url),
      folderId: row.folder_id || "", deletedAt: row.deleted_at || null, canCopy: row.source === "upload" && !row.deleted_at,
      canRestore: Boolean(row.deleted_at && !isPermanentlyRetiredMedia(row)), permanentCleanup: retirementStatus(row),
      modifiedAt: row.updated_at, selectable: !row.archived && !row.deleted_at && !isPermanentlyRetiredMedia(row) && row.kind !== "file" && row.source !== "youtube" && (row.kind !== "video" || safeDirectVideoUrl(row.url)),
      createdAt: row.created_at, updatedAt: row.updated_at };
  };
  const publicFolder = row => ({ id: row.id, name: row.name, kind: "folder", folderId: row.parent_id, parentId: row.parent_id, deletedAt: row.deleted_at,
    createdAt: row.created_at, updatedAt: row.updated_at, modifiedAt: row.updated_at, canCopy: !row.deleted_at, selectable: false });
  const insertFile = async row => mediaWrite(await database.run("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,created_by,created_at,updated_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [row.id, row.url, row.name, row.mimeType, row.kind, row.size, row.categoryId, row.source, row.storageName, row.sha256, row.createdBy, row.createdAt, row.updatedAt, row.folderId || ""]));

  const serveStoredFile = (request, response, value, download = false, rendition = null) => {
    const row = normalizeMediaRow(value);
    if (!row || row.deleted_at || isPermanentlyRetiredMedia(row) || !/^[a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|mov|webm|bin)$/.test(row.storage_name)) return response.status(404).json({ error: "mediaNotFound" });
    const filePath = rendition?.filePath || path.join(storageRoot, row.storage_name);
    try {
      if (fs.lstatSync(storageRoot).isSymbolicLink() || !fs.lstatSync(filePath).isFile() || fs.lstatSync(filePath).isSymbolicLink()) return response.status(404).json({ error: "mediaNotFound" });
    } catch { return response.status(404).json({ error: "mediaNotFound" }); }
    response.set({ "Content-Type": row.kind === "file" ? "application/octet-stream" : row.mime_type, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": download || row.kind === "file" ? "private, no-store" : rendition ? "public, max-age=3600, s-maxage=3600" : "public, max-age=2592000, immutable" });
    if (rendition) response.set("Content-Type", "video/mp4");
    if (row.kind === "file" || download) response.set("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    else response.set("Content-Disposition", "inline");
    return response.sendFile(filePath, { acceptRanges: true, dotfiles: "deny" }, error => {
      if (!error || response.headersSent) return;
      if (error.status === 416) { response.set("Content-Range", `bytes */${rendition?.sizeBytes || row.size_bytes}`); response.status(416).end(); }
      else response.status(error.status === 404 ? 404 : 500).json({ error: "mediaUnavailable" });
    });
  };
  app.get("/api/media/:id/:fileName", mediaRoute(async (request, response) => {
    const row = await database.get("SELECT * FROM media_files WHERE id=? AND source='upload'", [request.params.id]);
    if (!row || row.kind === "file" || row.deleted_at || isPermanentlyRetiredMedia(row)) return response.status(404).json({ error: "mediaNotFound" });
    const rendition = videoDelivery.rendition(row);
    if (rendition && request.params.fileName === rendition.fileName) return serveStoredFile(request, response, row, false, rendition);
    if (row.storage_name !== request.params.fileName) return response.status(404).json({ error: "mediaNotFound" });
    return serveStoredFile(request, response, row);
  }));
  app.get("/api/admin/media-download/:id", readPermission, mediaRoute(async (request, response) => {
    const row = await database.get("SELECT * FROM media_files WHERE id=? AND source='upload'", [request.params.id]);
    if (row?.kind === "file" && !request.admin.permissions.includes(MANAGE)) return response.status(403).json({ error: "permissionDenied" });
    return serveStoredFile(request, response, row, true);
  }));

  app.get("/api/admin/media", readPermission, mediaRoute(async (request, response) => {
    const page = integer(request.query.page, 1, 1000000), limit = integer(request.query.limit, 40, 100);
    const sort = request.query.sort === undefined ? "" : String(request.query.sort), direction = request.query.direction === undefined ? "asc" : String(request.query.direction);
    if ((sort && !["name", "size", "modified", "created", "kind"].includes(sort)) || !["asc", "desc"].includes(direction)) mediaFail("invalidMediaSort", 400);
    const kind = String(request.query.kind || ""), categoryId = String(request.query.categoryId || ""), search = asciiLower(String(request.query.search || "").trim().slice(0, 200));
    const deleted = request.query.deleted === "true", archived = request.query.archived === "true", folderId = request.query.folderId === undefined ? null : String(request.query.folderId);
    const trail = folderId === null ? [] : await folderTrail(folderId, deleted);
    if (!trail) mediaFail("mediaFolderNotFound", 404);
    const showFolders = folderId !== null && !categoryId && !archived;
    const folders = showFolders ? (await database.all("SELECT * FROM media_folders")).filter(row => Boolean(row.deleted_at) === deleted && (search ? asciiLower(row.name).includes(search) : row.parent_id === (folderId || ""))) : [];
    const files = (await database.all("SELECT * FROM media_files")).map(normalizeMediaRow).filter(row =>
      !isPermanentlyRetiredMedia(row) && Boolean(row.deleted_at) === deleted && Boolean(row.archived) === archived && (request.admin.permissions.includes(MANAGE) || row.kind !== "file") &&
      (!["image", "video", "file"].includes(kind) || row.kind === kind) && kind !== "folder" && (kind !== "gif" || row.mime_type === "image/gif") &&
      (!categoryId || row.category_id === categoryId) && (!search || asciiLower(row.name).includes(search)) && (folderId === null || search || row.folder_id === folderId));
    const comparator = isFolder => (a, b) => {
      if (!sort) return (isFolder ? textCompare(a.name, b.name) : -textCompare(a.created_at, b.created_at)) || textCompare(a.id, b.id);
      const field = isFolder && ["size", "kind"].includes(sort) ? "name" : sort;
      let comparison;
      if (field === "size") comparison = a.size_bytes === b.size_bytes ? 0 : a.size_bytes === null ? -1 : b.size_bytes === null ? 1 : a.size_bytes - b.size_bytes;
      else if (field === "name") comparison = textCompare(asciiLower(a.name), asciiLower(b.name));
      else comparison = textCompare(a[{ modified: "updated_at", created: "created_at", kind: "kind" }[field]], b[{ modified: "updated_at", created: "created_at", kind: "kind" }[field]]);
      return (direction === "desc" ? -comparison : comparison) || textCompare(a.id, b.id);
    };
    folders.sort(comparator(true)); files.sort(comparator(false));
    const offset = (page - 1) * limit, selectedFolders = folders.slice(offset, offset + limit), selectedFiles = files.slice(Math.max(0, offset - folders.length), Math.max(0, offset - folders.length) + limit - selectedFolders.length);
    const used = await references(), categoryRows = await categories(), categoryNames = new Map(categoryRows.map(row => [row.id, row.name]));
    const items = selectedFolders.map(publicFolder);
    for (const row of selectedFiles) items.push(await publicItem(row, used, categoryNames));
    response.json({ items, total: folders.length + files.length, page, limit, trail, folderId, sort, direction, categories: categoryRows, limits: MEDIA_LIMITS, storage: { provider: "server", privateAttachments: true, deleteMode: "recycle-bin" } });
  }));

  // Permanent retirements are deliberately separate from the recoverable bin.
  app.get("/api/admin/media-retirements", readPermission, mediaRoute(async (request, response) => {
    const page = integer(request.query.page, 1, 1000000), limit = integer(request.query.limit, 40, 100);
    const rows = await database.all(`SELECT id,name,size_bytes,archived FROM media_files WHERE storage_name='' AND source IN ('upload','legacy') AND deleted_at IS NOT NULL ORDER BY updated_at DESC,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
    response.json({ items: rows.map(row => ({ id: row.id, name: row.name, size: Number(row.size_bytes), status: [1, "1", 1n].includes(row.archived) ? "removed" : "pending", recoverable: false })), page, limit });
  }));

  app.post("/api/admin/media/upload", readPermission, mediaRoute(async (request, response) => {
    if (request.body !== undefined && /^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(String(request.headers["content-type"] || ""))) mediaFail("rawUploadRequired", 415);
    const mimeType = String(request.query.mimeType || request.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase(), name = String(request.query.name || "");
    if (!validStorageName(name)) mediaFail("invalidStorageName", 400);
    const extension = path.extname(name).slice(1).toLowerCase(), knownExtension = Object.values(TYPES).some(extensions => extensions.includes(extension));
    if ((TYPES[mimeType] || knownExtension) && !TYPES[mimeType]?.includes(extension)) mediaFail("unsupportedMediaType", 415);
    const kind = !TYPES[mimeType] ? "file" : mimeType.startsWith("video/") ? "video" : "image";
    if (kind === "file" && !request.admin.permissions.includes(MANAGE)) mediaFail("permissionDenied", 403);
    const permission = kind === "file" ? MANAGE : READ_PERMISSIONS.find(value => request.admin.permissions.includes(value));
    const folderId = String(request.query.folderId || ""), categoryId = String(request.query.categoryId || (kind === "file" ? "other" : kind === "video" ? "videos" : mimeType === "image/gif" ? "facilities-gifs" : "facilities-images"));
    if (!await folderTrail(folderId)) mediaFail("mediaFolderNotFound", 400);
    if (!await database.get("SELECT id FROM media_categories WHERE id=?", [categoryId])) mediaFail("mediaCategoryNotFound", 400);
    const maximum = kind === "file" ? MEDIA_LIMITS.fileBytes : kind === "video" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes, declared = request.headers["content-length"];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum || (Number(declared) === 0 && kind !== "file"))) return response.status(413).json({ error: "mediaTooLarge", maximum });
    if (activeUploads >= 3) mediaFail("tooManyMediaUploads", 429);
    activeUploads++;
    let handle, tempPath, finalPath, retainFile = false;
    try {
      const rootStat = fs.lstatSync(storageRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) mediaFail("mediaUnavailable", 503);
      const id = crypto.randomUUID(), storageName = `${id}.${TYPES[mimeType]?.[0] || "bin"}`;
      const candidateTemp = path.join(storageRoot, `${id}.partial`);
      handle = await fs.promises.open(candidateTemp, "wx", 0o600); tempPath = candidateTemp;
      const hash = crypto.createHash("sha256"); let size = 0, head = Buffer.alloc(0);
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maximum) { request.resume(); return response.status(413).json({ error: "mediaTooLarge", maximum }); }
        if (head.length < 65536) head = Buffer.concat([head, chunk.subarray(0, 65536 - head.length)]);
        hash.update(chunk); await handle.writeFile(chunk);
      }
      if (kind !== "file" && (!size || !mediaSignatureMatches(head, mimeType))) mediaFail("invalidMediaSignature", 415);
      if (request.aborted || response.destroyed) mediaFail("mediaUploadCancelled");
      await handle.sync(); await handle.close(); handle = null;
      const candidateFinal = path.join(storageRoot, storageName);
      // Publish without replacing a pre-existing file, even on UUID collision.
      await fs.promises.link(tempPath, candidateFinal); finalPath = candidateFinal;
      await fs.promises.unlink(tempPath); tempPath = null;
      const now = new Date().toISOString(), sha256 = hash.digest("hex");
      const item = await change(request, async () => {
        if (!await folderTrail(folderId)) mediaFail("mediaFolderNotFound");
        if (!await database.get("SELECT id FROM media_categories WHERE id=?", [categoryId])) mediaFail("mediaCategoryNotFound");
        await insertFile({ id, url: `/api/media/${id}/${storageName}`, name, mimeType, kind, size, categoryId, source: "upload", storageName, sha256, createdBy: request.admin.user.id, createdAt: now, updatedAt: now, folderId });
        await writeSystemLog(database, request, "media.upload", "media_file", id, { name, mimeType, size, categoryId });
        return publicItem(await database.get("SELECT * FROM media_files WHERE id=?", [id]));
      }, permission);
      retainFile = true;
      response.status(201).json({ item });
    } catch (error) {
      if (commitUnknown(error)) retainFile = true;
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
      if (finalPath && !retainFile) await fs.promises.unlink(finalPath).catch(() => {});
      activeUploads--;
    }
  }));

  app.post("/api/admin/media/folders", managePermission, mediaRoute(async (request, response) => {
    const name = request.body?.name, parentId = String(request.body?.parentId || "");
    if (!validStorageName(name)) mediaFail("invalidStorageName", 400);
    const result = await change(request, async () => {
      const trail = await folderTrail(parentId);
      if (!trail || trail.length >= MEDIA_LIMITS.maxFolderDepth) mediaFail("mediaFolderNotFound", 400);
      const existing = await database.get("SELECT * FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL", [parentId, name]);
      if (existing) return { folder: publicFolder(existing), existing: true };
      const id = crypto.randomUUID(), now = new Date().toISOString();
      mediaWrite(await database.run("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)", [id, parentId, name, now, now]));
      await writeSystemLog(database, request, "media.folder_create", "media_folder", id, { name, parentId });
      return { folder: publicFolder(await database.get("SELECT * FROM media_folders WHERE id=?", [id])) };
    });
    response.status(result.existing ? 200 : 201).json(result);
  }));
  operations.register({ app, managePermission, writeSystemLog, publicItem, publicFolder, validStorageName });
  app.post("/api/admin/media/delete", managePermission, mediaRoute(async (request, response) => {
    const selected = request.body?.items;
    if (!Array.isArray(selected) || !selected.length || selected.length > 100 || selected.some(item => typeof item?.id !== "string" || !item.id || !["file", "folder"].includes(item.kind))) mediaFail("invalidMediaSelection", 400);
    const result = await change(request, async () => {
      const files = new Map(), folders = new Map();
      for (const item of selected) {
        if (item.kind === "folder") {
          const children = await descendants(item.id);
          if (!children.length) mediaFail("mediaFolderNotFound", 404);
          if (children.length > 10000) mediaFail("mediaSelectionTooLarge", 400);
          for (const folder of children) {
            folders.set(folder.id, folder);
            for (const file of await database.all("SELECT * FROM media_files WHERE folder_id=? AND deleted_at IS NULL", [folder.id])) files.set(file.id, file);
            if (folders.size + files.size > 10000) mediaFail("mediaSelectionTooLarge", 400);
          }
        } else {
          const file = await database.get("SELECT * FROM media_files WHERE id=?", [item.id]);
          if (!file) mediaFail("mediaNotFound", 404);
          if (isPermanentlyRetiredMedia(file)) mediaFail("mediaPermanentlyDeleted");
          files.set(file.id, file);
        }
        if (folders.size + files.size > 10000) mediaFail("mediaSelectionTooLarge", 400);
      }
      const used = await references(), blocked = [...files.values()].filter(file => used.has(file.url));
      if (blocked.length) return { status: 409, body: { error: "mediaInUse", blocked: blocked.slice(0, 20).map(file => ({ id: file.id, name: file.name })) } };
      const now = new Date().toISOString();
      for (const file of files.values()) mediaWrite(await database.run("UPDATE media_files SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL", [now, now, file.id]));
      for (const folder of folders.values()) mediaWrite(await database.run("UPDATE media_folders SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL", [now, now, folder.id]));
      await writeSystemLog(database, request, "media.delete", "media_file", null, { fileCount: files.size, folderCount: folders.size, mode: "recycle-bin" });
      return { status: 200, body: { deletedFiles: files.size, deletedFolders: folders.size, recoverable: true } };
    });
    response.status(result.status).json(result.body);
  }));
  app.post("/api/admin/media/restore", managePermission, mediaRoute(async (request, response) => {
    const { id, kind } = request.body || {};
    if (typeof id !== "string" || !id || !["file", "folder"].includes(kind)) mediaFail("invalidMediaSelection", 400);
    await change(request, async () => {
      const now = new Date().toISOString();
      if (kind === "file") {
        const row = await database.get("SELECT * FROM media_files WHERE id=?", [id]);
        if (!row) mediaFail("mediaNotFound", 404);
        if (isPermanentlyRetiredMedia(row)) mediaFail("mediaPermanentlyDeleted");
        if (!await folderTrail(row.folder_id)) mediaFail("restoreParentFolderFirst");
        mediaWrite(await database.run("UPDATE media_files SET deleted_at=NULL,updated_at=? WHERE id=?", [now, id]));
      } else {
        const root = await database.get("SELECT * FROM media_folders WHERE id=?", [id]);
        if (!root) mediaFail("mediaFolderNotFound", 404);
        if (!await folderTrail(root.parent_id)) mediaFail("restoreParentFolderFirst");
        const folders = await descendants(id);
        if (folders.length > 10000) mediaFail("mediaSelectionTooLarge", 400);
        const restoring = folders.filter(folder => folder.deleted_at && folder.deleted_at === root.deleted_at), names = new Set();
        for (const folder of restoring) {
          const key = JSON.stringify([folder.parent_id, folder.name]);
          if (names.has(key) || await database.get("SELECT id FROM media_folders WHERE parent_id=? AND name=? AND id!=? AND deleted_at IS NULL LIMIT 1", [folder.parent_id, folder.name, folder.id])) mediaFail("mediaFolderExists");
          names.add(key);
        }
        for (const folder of restoring) {
          mediaWrite(await database.run("UPDATE media_folders SET deleted_at=NULL,updated_at=? WHERE id=?", [now, folder.id]));
          mediaWrite(await database.run("UPDATE media_files SET deleted_at=NULL,updated_at=? WHERE folder_id=? AND deleted_at=? AND (source NOT IN ('upload','legacy') OR storage_name IS NULL OR storage_name<>'')", [now, folder.id, root.deleted_at]));
        }
      }
      await writeSystemLog(database, request, "media.restore", `media_${kind}`, id, {});
    });
    response.json({ restored: true });
  }));
  app.post("/api/admin/media/categories", managePermission, mediaRoute(async (request, response) => {
    const name = cleanName(request.body?.name);
    if (!name || name.length > 80) mediaFail("invalidMediaCategory", 400);
    const category = await change(request, async () => {
      if (await database.get("SELECT id FROM media_categories WHERE name=?", [name])) mediaFail("mediaCategoryExists");
      const id = crypto.randomUUID(), now = new Date().toISOString();
      mediaWrite(await database.run("INSERT INTO media_categories(id,name,created_at,updated_at) VALUES(?,?,?,?)", [id, name, now, now]));
      await writeSystemLog(database, request, "media.category_create", "media_category", id, { name });
      return { id, name };
    });
    response.status(201).json({ category });
  }));
  app.patch("/api/admin/media/categories/:id", managePermission, mediaRoute(async (request, response) => {
    const name = cleanName(request.body?.name);
    if (!name || name.length > 80) mediaFail("invalidMediaCategory", 400);
    const category = await change(request, async () => {
      const current = await database.get("SELECT id FROM media_categories WHERE id=?", [request.params.id]);
      if (!current) mediaFail("mediaCategoryNotFound", 404);
      if (await database.get("SELECT id FROM media_categories WHERE name=? AND id!=?", [name, current.id])) mediaFail("mediaCategoryExists");
      mediaWrite(await database.run("UPDATE media_categories SET name=?,updated_at=? WHERE id=?", [name, new Date().toISOString(), current.id]));
      await writeSystemLog(database, request, "media.category_update", "media_category", current.id, { name });
      return { id: current.id, name };
    });
    response.json({ category });
  }));
  app.patch("/api/admin/media/:id", managePermission, mediaRoute(async (request, response) => {
    const item = await change(request, async () => {
      const row = normalizeMediaRow(await database.get("SELECT * FROM media_files WHERE id=?", [request.params.id]));
      if (!row || row.deleted_at || isPermanentlyRetiredMedia(row)) mediaFail("mediaNotFound", 404);
      const name = cleanName(request.body?.name ?? row.name), categoryId = String(request.body?.categoryId ?? row.category_id);
      if (request.body?.archived !== undefined && typeof request.body.archived !== "boolean") mediaFail("invalidMediaMetadata", 400);
      const archived = request.body?.archived === undefined ? row.archived : request.body.archived ? 1 : 0;
      if (!name || !await database.get("SELECT id FROM media_categories WHERE id=?", [categoryId])) mediaFail("invalidMediaMetadata", 400);
      if (archived && (await references()).has(row.url)) mediaFail("mediaInUse");
      mediaWrite(await database.run("UPDATE media_files SET name=?,category_id=?,archived=?,updated_at=? WHERE id=?", [name, categoryId, archived, new Date().toISOString(), row.id]));
      await writeSystemLog(database, request, "media.update", "media_file", row.id, { name, categoryId, archived: Boolean(archived) });
      return publicItem(await database.get("SELECT * FROM media_files WHERE id=?", [row.id]));
    });
    response.json({ item });
  }));

  const registerLegacyImage = async (url, name, mimeType, size, request) => {
    if (!/^\/api\/equipment-images\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|webp)$/i.test(url) || !TYPES[mimeType] || !mimeType.startsWith("image/")) mediaFail("invalidMediaMetadata", 400);
    const insert = async () => {
      await revalidateAdmin(database, request, "app_maintenance.equipment.manage");
      await lockMysqlMediaNamespace(database);
      const digest = crypto.createHash("sha256").update(url, "utf8").digest();
      const existing = await database.get("SELECT * FROM media_files WHERE __url_sha256=?", [digest]);
      if (existing) {
        if (existing.url !== url) mediaFail("mediaUrlDigestCollision", 500);
        if (isPermanentlyRetiredMedia(existing)) mediaFail("mediaPermanentlyDeleted");
        return existing;
      }
      const now = new Date().toISOString(), id = crypto.randomUUID();
      await insertFile({ id, url, name: cleanName(name) || "公开资源", mimeType, kind: "image", size, categoryId: mimeType === "image/gif" ? "facilities-gifs" : "facilities-images", source: "legacy", storageName: null, sha256: null, createdBy: request.admin.user.id, createdAt: now, updatedAt: now, folderId: "" });
      return database.get("SELECT * FROM media_files WHERE id=?", [id]);
    };
    return database.inTransaction ? insert() : database.transaction(insert);
  };
  // Paths are intentionally unused for scanning: the restored catalogue is the source of truth.
  void equipmentUploadDir; void mediaSeedDir;
  return { seedImport: null, registerLegacyImage, videoDelivery };
}
