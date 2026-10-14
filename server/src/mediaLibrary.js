import { additionalEquipmentVideoUrls } from "./equipmentExtensions.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { importMediaStorageSeed } from "./mediaStorageSeed.js";
import { registerMediaFileOperations } from "./mediaFileOperations.js";
import { createPublicVideoDelivery } from "./publicVideoDelivery.js";

export const MEDIA_LIMITS = Object.freeze({ imageBytes: 12 * 1024 * 1024, videoBytes: 250 * 1024 * 1024, fileBytes: 250 * 1024 * 1024, maxFolderDepth: 32 });
const TYPES = {
	"image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/gif": ["gif"], "image/webp": ["webp"],
	"video/mp4": ["mp4", "m4v"], "video/quicktime": ["mov"], "video/webm": ["webm"],
};
const SAFE_LOCAL_IMAGE = /^\/api\/equipment-images\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|webp)$/i;
const SAFE_LIBRARY_URL = /^\/api\/media\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(?:png|jpg|jpeg|gif|webp|mp4|mov|webm)$/i;

export function safeMediaUrl(value, { allowYoutube = false } = {}) {
	if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return false;
	if (SAFE_LOCAL_IMAGE.test(value) || SAFE_LIBRARY_URL.test(value)) return true;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
		// Never index credentials, pre-signed private URLs, or non-public address space.
		if ([...url.searchParams.keys()].some((key) => /token|key|signature|credential|authorization|secret/i.test(key))) return false;
		if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname) || !url.hostname.includes(".")) return false;
		if (/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i.test(url.hostname)) return allowYoutube;
		return true;
	} catch { return false; }
}

export function safeDirectVideoUrl(value) {
	if (!safeMediaUrl(value)) return false;
	if (SAFE_LIBRARY_URL.test(value)) return /\.(?:mp4|mov|webm)$/i.test(value);
	try { return /\.(?:mp4|m4v|mov|webm)$/i.test(new URL(value).pathname); } catch { return false; }
}

export function mediaSignatureMatches(bytes, mimeType) {
	if (!Buffer.isBuffer(bytes)) return false;
	if (mimeType === "image/jpeg") return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (mimeType === "image/png") return bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii",12,16) === "IHDR";
	if (mimeType === "image/gif") return bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii",0,6));
	if (mimeType === "image/webp") return bytes.length >= 16 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
	if (mimeType === "video/webm") return bytes.length >= 16 && bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && bytes.subarray(0,4096).includes(Buffer.from("webm"));
	if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
		if (bytes.length < 24 || bytes.toString("ascii",4,8) !== "ftyp") return false;
		const boxSize = bytes.readUInt32BE(0);
		if (boxSize < 16 || boxSize > bytes.length) return false;
		const brands = [bytes.toString("ascii",8,12)];
		for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(bytes.toString("ascii",at,at+4));
		return mimeType === "video/quicktime" ? brands.includes("qt  ") : brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand));
	}
	return false;
}

function cleanName(value) { return String(value || "").replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0,200); }
export function validStorageName(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f/\\]/.test(value) && ![".",".."].includes(value);
}
function mimeForPath(value) {
	let pathname = value;
	try { pathname = new URL(value).pathname; } catch { /* A validated local path. */ }
	const ext = path.extname(pathname).slice(1).toLowerCase();
	return Object.entries(TYPES).find(([, extensions]) => extensions.includes(ext))?.[0] || "";
}
function integer(value, fallback, maximum) { const n = Number(value); return Number.isInteger(n) && n > 0 ? Math.min(n,maximum) : fallback; }

export function registerMediaLibrary({ app, database, mediaUploadDir, equipmentUploadDir, mediaSeedDir, mediaVideoDeliveryRoot, mediaVideoDeliveryManifest, mediaVideoCdnOrigin, requirePermission, requireAnyPermission, writeSystemLog }) {
	const readPermission = requireAnyPermission("app_maintenance.files.manage", "app_maintenance.equipment.manage", "app_maintenance.home.manage");
	const managePermission = requirePermission("app_maintenance.files.manage");
	const storageRoot = path.resolve(mediaUploadDir);
	const videoDelivery = createPublicVideoDelivery({ storageRoot, derivativeRoot: mediaVideoDeliveryRoot && path.join(mediaVideoDeliveryRoot, "derivatives"), manifestPath: mediaVideoDeliveryManifest, cdnOrigin: mediaVideoCdnOrigin });
	let activeUploads = 0;
	const insert = database.prepare(`INSERT OR IGNORE INTO media_files (id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,created_by,created_at,updated_at) VALUES (@id,@url,@name,@mimeType,@kind,@size,@categoryId,@source,@storageName,@sha256,@createdBy,@createdAt,@updatedAt)`);
	const byUrl = database.prepare("SELECT * FROM media_files WHERE url = ?");
	const equipmentFields = ["image_url","gif_left_url","gif_right_url","video_url","youtube_key","video_url_zh","video_url_en","additional_videos_json"].filter(field => database.prepare("PRAGMA table_info(app_equipment_items)").all().some(column => column.name === field));
	const references = () => {
		const result = new Set();
		// Explicit public-content allowlist: no users, avatars, messages, or arbitrary JSON.
		for (const row of database.prepare(`SELECT ${equipmentFields.join(",")} FROM app_equipment_items`).all()) {
			for (const field of equipmentFields) if (row[field]) result.add(row[field]);
			for (const url of additionalEquipmentVideoUrls(row.additional_videos_json)) result.add(url);
			if (/^[A-Za-z0-9_-]{11}$/.test(row.youtube_key)) result.add(`https://www.youtube.com/watch?v=${row.youtube_key}`);
		}
		for (const row of database.prepare("SELECT value FROM content_items WHERE content_type = 'video'").all()) { result.add(row.value); if (/^[A-Za-z0-9_-]{11}$/.test(row.value)) result.add(`https://www.youtube.com/watch?v=${row.value}`); }
		return result;
	};
	const categories = () => database.prepare("SELECT id,name FROM media_categories ORDER BY created_at,id").all();
	const publicItem = (row, used = references()) => ({
		id: row.id, url: row.url, name: row.name, mimeType: row.mime_type, kind: row.kind, size: row.size_bytes,
		categoryId: row.category_id, categoryName: database.prepare("SELECT name FROM media_categories WHERE id = ?").get(row.category_id)?.name || "",
		source: row.source, archived: Boolean(row.archived), isReferenced: used.has(row.url), folderId: row.folder_id || "", deletedAt: row.deleted_at || null,
		canCopy: row.source === "upload" && !row.deleted_at, modifiedAt: row.updated_at,
		selectable: !row.archived && !row.deleted_at && row.kind !== "file" && row.source !== "youtube" && (row.kind !== "video" || safeDirectVideoUrl(row.url)), createdAt: row.created_at, updatedAt: row.updated_at,
	});
	const folderTrail = (id, allowDeleted = false) => {
		const trail = [], visited = new Set();
		while (id) {
			if (visited.has(id) || trail.length >= MEDIA_LIMITS.maxFolderDepth) return null;
			visited.add(id);
			const folder = database.prepare("SELECT * FROM media_folders WHERE id=?").get(id);
			if (!folder || (!allowDeleted && folder.deleted_at)) return null;
			trail.unshift({id:folder.id,name:folder.name,parentId:folder.parent_id}); id = folder.parent_id;
		}
		return trail;
	};
	const publicFolder = row => ({id:row.id,name:row.name,kind:"folder",folderId:row.parent_id,parentId:row.parent_id,deletedAt:row.deleted_at,createdAt:row.created_at,updatedAt:row.updated_at,modifiedAt:row.updated_at,canCopy:!row.deleted_at,selectable:false});
	const addReference = (url, name, mimeType, source = "external", size = null) => {
		if (!safeMediaUrl(url, { allowYoutube: true }) || byUrl.get(url)) return;
		const now = new Date().toISOString();
		const isYoutube = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
		const mime = isYoutube ? "video/youtube" : mimeType || mimeForPath(url);
		if (!mime || (!mime.startsWith("image/") && !mime.startsWith("video/"))) return;
		insert.run({ id: crypto.randomUUID(), url, name: cleanName(name) || "公开资源", mimeType: mime, kind: mime.startsWith("video/") ? "video" : "image", size,
			categoryId: mime.startsWith("video/") ? "videos" : mime === "image/gif" ? "facilities-gifs" : "facilities-images",
			source: isYoutube ? "youtube" : source, storageName: null, sha256: null, createdBy: null, createdAt: now, updatedAt: now });
	};
	const importReferences = () => {
		for (const row of database.prepare(`SELECT name_zh,name_en,${equipmentFields.join(",")} FROM app_equipment_items`).all()) {
			const label = row.name_zh || row.name_en || "设施";
			addReference(row.image_url, `${label} 图片`, mimeForPath(row.image_url) || "image/jpeg");
			addReference(row.gif_left_url, `${label} 左侧 GIF`, "image/gif");
			addReference(row.gif_right_url, `${label} 右侧 GIF`, "image/gif");
			addReference(row.video_url, `${label} 视频`, mimeForPath(row.video_url) || "video/mp4");
			addReference(row.video_url_zh, `${label} 中文视频`, mimeForPath(row.video_url_zh || "") || "video/mp4");
			addReference(row.video_url_en, `${label} 英文视频`, mimeForPath(row.video_url_en || "") || "video/mp4");
			// Keep legacy identifiers untouched in equipment; they are not direct-video URLs.
			if (row.youtube_key && /^https:\/\//.test(row.youtube_key)) addReference(row.youtube_key, `${label} 旧版视频`, "video/youtube");
			else if (/^[A-Za-z0-9_-]{11}$/.test(row.youtube_key)) addReference(`https://www.youtube.com/watch?v=${row.youtube_key}`, `${label} 旧版视频`, "video/youtube");
		}
		for (const row of database.prepare("SELECT title,value FROM content_items WHERE content_type = 'video'").all()) addReference(/^[A-Za-z0-9_-]{11}$/.test(row.value) ? `https://www.youtube.com/watch?v=${row.value}` : row.value,row.title,mimeForPath(row.value) || "video/mp4");
	};
	const importLegacyImages = () => {
		if (!fs.existsSync(equipmentUploadDir) || fs.lstatSync(equipmentUploadDir).isSymbolicLink()) return;
		for (const entry of fs.readdirSync(equipmentUploadDir, { withFileTypes: true })) {
			const url = `/api/equipment-images/${entry.name}`;
			if (!entry.isFile() || !SAFE_LOCAL_IMAGE.test(url) || byUrl.get(url)) continue;
			const filePath = path.join(equipmentUploadDir,entry.name);
			const stat = fs.lstatSync(filePath);
			if (stat.isSymbolicLink() || stat.size > MEDIA_LIMITS.imageBytes || !stat.size) continue;
			const head = Buffer.alloc(Math.min(stat.size,4096));
			const fd = fs.openSync(filePath,"r");
			try { fs.readSync(fd,head,0,head.length,0); } finally { fs.closeSync(fd); }
			const mimeType = mimeForPath(entry.name);
			if (mediaSignatureMatches(head,mimeType)) addReference(url,entry.name,mimeType,"legacy",stat.size);
		}
	};
	const importSeedImages = () => {
		if (!mediaSeedDir || !fs.existsSync(mediaSeedDir) || fs.lstatSync(mediaSeedDir).isSymbolicLink()) return;
		const manifestPath = path.join(mediaSeedDir,"manifest.json"), seedFiles = path.join(mediaSeedDir,"files");
		if (!fs.existsSync(manifestPath) || !fs.existsSync(seedFiles) || fs.lstatSync(seedFiles).isSymbolicLink()) return;
		const manifestStat = fs.lstatSync(manifestPath);
		if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 1024 * 1024) return;
		let manifest;
		try { manifest = JSON.parse(fs.readFileSync(manifestPath,"utf8")); } catch { return; }
		if (!Array.isArray(manifest?.items)) return;
		for (const item of manifest.items.slice(0,2000)) {
			const mimeType = item?.mimeType, fileName = String(item?.fileName || "");
			if (!/^[-a-zA-Z0-9_]+\.(?:jpg|jpeg|png|gif|webp)$/.test(fileName) || !mimeType?.startsWith("image/") || !TYPES[mimeType]?.includes(path.extname(fileName).slice(1))) continue;
			const expected = String(item.sha256 || "").toLowerCase();
			if (!/^[a-f0-9]{64}$/.test(expected) || database.prepare("SELECT 1 FROM media_files WHERE sha256 = ?").get(expected)) continue;
			let finalPath;
			try {
				const sourcePath = path.join(seedFiles,fileName), stat = fs.lstatSync(sourcePath);
				if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MEDIA_LIMITS.imageBytes) continue;
				const bytes = fs.readFileSync(sourcePath);
				if (crypto.createHash("sha256").update(bytes).digest("hex") !== expected || !mediaSignatureMatches(bytes,mimeType)) continue;
				const now = new Date().toISOString(), id = crypto.randomUUID(), storageName = `${id}.${TYPES[mimeType][0]}`;
				const categoryName = cleanName(item.categoryName).slice(0,80) || (mimeType === "image/gif" ? "设施 GIF" : "设施图片");
				let category = database.prepare("SELECT id FROM media_categories WHERE name = ?").get(categoryName);
				if (!category) { category = {id:crypto.randomUUID()}; database.prepare("INSERT INTO media_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)").run(category.id,categoryName,now,now); }
				fs.mkdirSync(storageRoot,{recursive:true});
				if (fs.lstatSync(storageRoot).isSymbolicLink()) continue;
				finalPath = path.join(storageRoot,storageName);
				fs.writeFileSync(finalPath,bytes,{flag:"wx",mode:0o600});
				insert.run({id,url:`/api/media/${id}/${storageName}`,name:cleanName(item.name) || fileName,mimeType,kind:"image",size:bytes.length,categoryId:category.id,source:"upload",storageName,sha256:expected,createdBy:null,createdAt:now,updatedAt:now});
				finalPath = null;
			} catch { if (finalPath) { try { fs.unlinkSync(finalPath); } catch { /* Do not disturb other media. */ } } }
		}
	};
	// Index only already-public uploads. Never traverse data/ or fetch remote URLs.
	const seedImport = importMediaStorageSeed({database,mediaSeedDir,storageRoot,types:TYPES,limits:MEDIA_LIMITS,signatureMatches:mediaSignatureMatches,validName:validStorageName});
	importSeedImages();
	importLegacyImages();
	importReferences();

	const serveStoredFile = (request,response,row,download = false,rendition = null) => {
		if (!row || row.deleted_at || !/^[a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|mov|webm|bin)$/.test(row.storage_name)) return response.status(404).json({ error:"mediaNotFound" });
		const filePath = rendition?.filePath || path.join(storageRoot,row.storage_name);
		try {
			if (fs.lstatSync(storageRoot).isSymbolicLink() || !fs.lstatSync(filePath).isFile() || fs.lstatSync(filePath).isSymbolicLink()) return response.status(404).json({ error:"mediaNotFound" });
		} catch { return response.status(404).json({ error:"mediaNotFound" }); }
		response.set({ "Content-Type":rendition ? "video/mp4" : row.kind === "file" ? "application/octet-stream" : row.mime_type, "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; sandbox", "Cache-Control":download || row.kind === "file" ? "private, no-store" : rendition ? "public, max-age=3600, s-maxage=3600" : "public, max-age=2592000, immutable" });
		// Only the authenticated admin download route may request attachment
		// delivery. A public playback query parameter grants no download right.
		if (row.kind === "file" || download) response.set("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`);
		else response.set("Content-Disposition","inline");
		return response.sendFile(filePath,{ acceptRanges:true, dotfiles:"deny" },(error)=>{
			if (!error || response.headersSent) return;
			if (error.status === 416) { response.set("Content-Range",`bytes */${rendition?.sizeBytes || row.size_bytes}`); response.status(416).end(); }
			else response.status(error.status === 404 ? 404 : 500).json({error:"mediaUnavailable"});
		});
	};
	app.get("/api/media/:id/:fileName", (request,response) => {
		const row = database.prepare("SELECT * FROM media_files WHERE id = ? AND source = 'upload'").get(request.params.id);
		if (!row || row.kind === "file" || row.deleted_at) return response.status(404).json({error:"mediaNotFound"});
		const rendition = videoDelivery.rendition(row);
		if (rendition && request.params.fileName === rendition.fileName) return serveStoredFile(request,response,row,false,rendition);
		if (row.storage_name !== request.params.fileName) return response.status(404).json({error:"mediaNotFound"});
		return serveStoredFile(request,response,row);
	});
	app.get("/api/admin/media-download/:id",readPermission,(request,response)=>{
		const row = database.prepare("SELECT * FROM media_files WHERE id=? AND source='upload'").get(request.params.id);
		if (row?.kind === "file" && !request.admin.permissions.includes("app_maintenance.files.manage")) return response.status(403).json({error:"permissionDenied"});
		return serveStoredFile(request,response,row,true);
	});

	app.get("/api/admin/media", readPermission, (request,response) => {
		importReferences();
		const page = integer(request.query.page,1,1000000), limit = integer(request.query.limit,40,100);
		const sort = request.query.sort === undefined ? "" : String(request.query.sort);
		const direction = request.query.direction === undefined ? "asc" : String(request.query.direction);
		const sorts = { name:"name COLLATE NOCASE",size:"size_bytes",modified:"updated_at",created:"created_at",kind:"kind" };
		if ((sort && !Object.hasOwn(sorts,sort)) || !["asc","desc"].includes(direction)) return response.status(400).json({error:"invalidMediaSort"});
		const fileOrder = sort ? `${sorts[sort]} ${direction},id ASC` : "created_at DESC,id";
		const folderOrder = sort ? `${sort === "size" || sort === "kind" ? "name COLLATE NOCASE" : sorts[sort]} ${direction},id ASC` : "name,id";
		const kind = String(request.query.kind || ""), categoryId = String(request.query.categoryId || ""), search = String(request.query.search || "").trim().slice(0,200);
		const deleted = request.query.deleted === "true";
		const folderId = request.query.folderId === undefined ? null : String(request.query.folderId);
		const trail = folderId === null ? [] : folderTrail(folderId,deleted);
		if (!trail) return response.status(404).json({error:"mediaFolderNotFound"});
		const clauses = [deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL", "archived = ?"], params = [request.query.archived === "true" ? 1 : 0];
		if (!request.admin.permissions.includes("app_maintenance.files.manage")) clauses.push("kind != 'file'");
		if (kind === "image" || kind === "video" || kind === "file") { clauses.push("kind = ?"); params.push(kind); }
		if (kind === "folder") clauses.push("1 = 0");
		if (kind === "gif") { clauses.push("mime_type = ?"); params.push("image/gif"); }
		if (categoryId) { clauses.push("category_id = ?"); params.push(categoryId); }
		if (search) { clauses.push("instr(lower(name),lower(?)) > 0"); params.push(search); }
		if (folderId !== null && !search) { clauses.push("folder_id = ?"); params.push(folderId); }
		const where = clauses.join(" AND ");
		const folderWhere = [deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"], folderParams = [];
		if (search) { folderWhere.push("instr(lower(name),lower(?)) > 0"); folderParams.push(search); }
		else { folderWhere.push("parent_id = ?"); folderParams.push(folderId || ""); }
		const showFolders = folderId !== null && !categoryId && request.query.archived !== "true";
		const folderCount = showFolders ? database.prepare(`SELECT COUNT(*) AS n FROM media_folders WHERE ${folderWhere.join(" AND ")}`).get(...folderParams).n : 0;
		const fileCount = database.prepare(`SELECT COUNT(*) AS total FROM media_files WHERE ${where}`).get(...params).total;
		const total = folderCount + fileCount;
		const used = references();
		const offset = (page-1)*limit;
		const folders = showFolders ? database.prepare(`SELECT * FROM media_folders WHERE ${folderWhere.join(" AND ")} ORDER BY ${folderOrder} LIMIT ? OFFSET ?`).all(...folderParams,limit,offset).map(publicFolder) : [];
		const files = database.prepare(`SELECT * FROM media_files WHERE ${where} ORDER BY ${fileOrder} LIMIT ? OFFSET ?`).all(...params,Math.max(0,limit-folders.length),Math.max(0,offset-folderCount)).map((row)=>publicItem(row,used));
		return response.json({ items:[...folders,...files],total,page,limit,trail,folderId,sort,direction,categories:categories(),limits:MEDIA_LIMITS,storage:{provider:"server",privateAttachments:true,deleteMode:"recycle-bin"} });
	});

	app.post("/api/admin/media/upload", readPermission, async (request,response) => {
		// JSON middleware must never turn an uploaded .json document into an
		// empty stored file. New clients send octet-stream + mimeType metadata.
		if (request.body !== undefined && /^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(String(request.headers["content-type"] || ""))) return response.status(415).json({error:"rawUploadRequired"});
		const mimeType = String(request.query.mimeType || request.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
		const name = String(request.query.name || "");
		if (!validStorageName(name)) return response.status(400).json({error:"invalidStorageName"});
		const extension = path.extname(name).slice(1).toLowerCase();
		const knownExtension = Object.values(TYPES).some(extensions => extensions.includes(extension));
		if ((TYPES[mimeType] || knownExtension) && !TYPES[mimeType]?.includes(extension)) return response.status(415).json({ error:"unsupportedMediaType" });
		const kind = !TYPES[mimeType] ? "file" : mimeType.startsWith("video/") ? "video" : "image";
		if (kind === "file" && !request.admin.permissions.includes("app_maintenance.files.manage")) return response.status(403).json({error:"permissionDenied"});
		const folderId = String(request.query.folderId || "");
		if (!folderTrail(folderId)) return response.status(400).json({error:"mediaFolderNotFound"});
		const categoryId = String(request.query.categoryId || (kind === "file" ? "other" : kind === "video" ? "videos" : mimeType === "image/gif" ? "facilities-gifs" : "facilities-images"));
		if (!database.prepare("SELECT 1 FROM media_categories WHERE id = ?").get(categoryId)) return response.status(400).json({ error:"mediaCategoryNotFound" });
		const maximum = kind === "file" ? MEDIA_LIMITS.fileBytes : kind === "video" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes;
		const declared = request.headers["content-length"];
		if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum || (Number(declared) === 0 && kind !== "file"))) return response.status(413).json({ error:"mediaTooLarge", maximum });
		if (activeUploads >= 3) return response.status(429).json({ error:"tooManyMediaUploads" });
		activeUploads++;
		let handle, tempPath, finalPath, inserted = false;
		try {
			fs.mkdirSync(storageRoot,{ recursive:true });
			if (fs.lstatSync(storageRoot).isSymbolicLink()) throw new Error("Unsafe media storage directory");
			const id = crypto.randomUUID();
			const storageName = `${id}.${TYPES[mimeType]?.[0] || "bin"}`;
			tempPath = path.join(storageRoot,`${id}.partial`);
			handle = await fs.promises.open(tempPath,"wx",0o600);
			const hash = crypto.createHash("sha256");
			let size = 0, head = Buffer.alloc(0);
			// Bound memory independently of video size; no JSON/base64 or full-body buffering.
			for await (const chunk of request.iterator({destroyOnReturn:false})) {
				size += chunk.length;
				if (size > maximum) { request.resume(); response.status(413).json({ error:"mediaTooLarge",maximum }); return; }
				if (head.length < 65536) head = Buffer.concat([head,chunk.subarray(0,65536-head.length)]);
				hash.update(chunk);
				await handle.writeFile(chunk);
			}
			if (kind !== "file" && (!size || !mediaSignatureMatches(head,mimeType))) return response.status(415).json({ error:"invalidMediaSignature" });
			// The folder may be deleted while a long upload is in flight. Never
			// publish an orphan in an invisible or deleted branch.
			if (!folderTrail(folderId)) return response.status(409).json({error:"mediaFolderNotFound"});
			await handle.sync();
			await handle.close(); handle = null;
			finalPath = path.join(storageRoot,storageName);
			await fs.promises.rename(tempPath,finalPath); tempPath = null;
			const now = new Date().toISOString();
			// No await is allowed between this final check and the row commit.
			// BEGIN IMMEDIATE also serializes another server process deleting a
			// folder after disk sync/rename has yielded to an administrator request.
			const committed = database.transaction(() => {
				if (!folderTrail(folderId)) return false;
				insert.run({ id,url:`/api/media/${id}/${storageName}`,name,mimeType,kind,size,categoryId,source:"upload",storageName,sha256:hash.digest("hex"),createdBy:request.admin.user.id,createdAt:now,updatedAt:now });
				database.prepare("UPDATE media_files SET folder_id=? WHERE id=?").run(folderId,id);
				return true;
			}).immediate();
			if (!committed) return response.status(409).json({error:"mediaFolderNotFound"});
			inserted = true;
			writeSystemLog(database,request,"media.upload","media_file",id,{ name,mimeType,size,categoryId });
			return response.status(201).json({ item:publicItem(database.prepare("SELECT * FROM media_files WHERE id = ?").get(id)) });
		} catch (error) {
			if (!response.headersSent && !request.aborted) response.status(500).json({ error:"mediaUploadFailed" });
		} finally {
			if (handle) await handle.close().catch(()=>{});
			if (tempPath) await fs.promises.unlink(tempPath).catch(()=>{});
			if (finalPath && !inserted) await fs.promises.unlink(finalPath).catch(()=>{});
			activeUploads--;
		}
	});

	app.post("/api/admin/media/folders", managePermission, (request,response) => {
		const name = request.body?.name, parentId = String(request.body?.parentId || "");
		if (!validStorageName(name)) return response.status(400).json({error:"invalidStorageName"});
		const trail = folderTrail(parentId);
		if (!trail || trail.length >= MEDIA_LIMITS.maxFolderDepth) return response.status(400).json({error:"mediaFolderNotFound"});
		const existing = database.prepare("SELECT * FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL").get(parentId,name);
		// Idempotent directory creation permits an interrupted folder import to
		// resume without duplicating the hierarchy or overwriting any file.
		if (existing) return response.json({folder:publicFolder(existing),existing:true});
		const id = crypto.randomUUID(), now = new Date().toISOString();
		database.prepare("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,parentId,name,now,now);
		writeSystemLog(database,request,"media.folder_create","media_folder",id,{name,parentId});
		return response.status(201).json({folder:publicFolder(database.prepare("SELECT * FROM media_folders WHERE id=?").get(id))});
	});
	const folderDescendants = id => database.prepare(`WITH RECURSIVE tree(id) AS (
		SELECT id FROM media_folders WHERE id=? UNION SELECT f.id FROM media_folders f JOIN tree t ON f.parent_id=t.id
	) SELECT f.* FROM media_folders f JOIN tree ON f.id=tree.id LIMIT 10001`).all(id);
	registerMediaFileOperations({ app,database,storageRoot,managePermission,writeSystemLog,folderTrail,publicItem,publicFolder,validStorageName,maxFolderDepth:MEDIA_LIMITS.maxFolderDepth });
	app.post("/api/admin/media/delete", managePermission, (request,response) => {
		const selected = request.body?.items;
		if (!Array.isArray(selected) || !selected.length || selected.length > 100 || selected.some(item=>!item?.id || !["file","folder"].includes(item.kind))) return response.status(400).json({error:"invalidMediaSelection"});
		// Collect descendants and validate references under the same write lock
		// as deletion; another server worker must not insert an uncollected file.
		const result = database.transaction(() => {
		const files = new Map(), folders = new Map();
		for (const item of selected) {
			if (item.kind === "folder") {
				const descendants = folderDescendants(item.id);
				if (!descendants.length) return {status:404,body:{error:"mediaFolderNotFound"}};
				if (descendants.length > 10000) return {status:400,body:{error:"mediaSelectionTooLarge"}};
				for (const folder of descendants) {
					folders.set(folder.id,folder);
					for (const file of database.prepare("SELECT * FROM media_files WHERE folder_id=? AND deleted_at IS NULL").all(folder.id)) files.set(file.id,file);
				}
			} else {
				const file = database.prepare("SELECT * FROM media_files WHERE id=?").get(item.id);
				if (!file) return {status:404,body:{error:"mediaNotFound"}};
				files.set(file.id,file);
			}
		}
		const used = references(), blocked = [...files.values()].filter(file=>used.has(file.url));
		if (blocked.length) return {status:409,body:{error:"mediaInUse",blocked:blocked.slice(0,20).map(file=>({id:file.id,name:file.name}))}};
		const now = new Date().toISOString();
			for (const file of files.values()) database.prepare("UPDATE media_files SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(now,now,file.id);
			for (const folder of folders.values()) database.prepare("UPDATE media_folders SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(now,now,folder.id);
		writeSystemLog(database,request,"media.delete","media_file",null,{fileCount:files.size,folderCount:folders.size,mode:"recycle-bin"});
		return {status:200,body:{deletedFiles:files.size,deletedFolders:folders.size,recoverable:true}};
		}).immediate();
		return response.status(result.status).json(result.body);
	});
	app.post("/api/admin/media/restore", managePermission, (request,response) => {
		const {id,kind} = request.body || {};
		if (!id || !["file","folder"].includes(kind)) return response.status(400).json({error:"invalidMediaSelection"});
		if (kind === "file") {
			const row = database.prepare("SELECT * FROM media_files WHERE id=?").get(id);
			if (!row) return response.status(404).json({error:"mediaNotFound"});
			if (!folderTrail(row.folder_id)) return response.status(409).json({error:"restoreParentFolderFirst"});
			database.prepare("UPDATE media_files SET deleted_at=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
		} else {
			const root = database.prepare("SELECT * FROM media_folders WHERE id=?").get(id);
			if (!root) return response.status(404).json({error:"mediaFolderNotFound"});
			if (!folderTrail(root.parent_id)) return response.status(409).json({error:"restoreParentFolderFirst"});
			const folders = folderDescendants(id);
			if (folders.length > 10000) return response.status(400).json({error:"mediaSelectionTooLarge"});
			// Restore only this deletion batch: previously deleted children remain
			// deleted. Check active-name collisions before changing any rows.
			const restoring = folders.filter(folder=>folder.deleted_at && folder.deleted_at === root.deleted_at);
			if (restoring.some(folder=>database.prepare("SELECT 1 FROM media_folders WHERE parent_id=? AND name=? AND id!=? AND deleted_at IS NULL").get(folder.parent_id,folder.name,folder.id))) return response.status(409).json({error:"mediaFolderExists"});
			database.transaction(()=>{ for (const folder of restoring) {
				database.prepare("UPDATE media_folders SET deleted_at=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),folder.id);
				database.prepare("UPDATE media_files SET deleted_at=NULL,updated_at=? WHERE folder_id=? AND deleted_at=?").run(new Date().toISOString(),folder.id,root.deleted_at);
			} })();
		}
		writeSystemLog(database,request,"media.restore",`media_${kind}`,id,{});
		return response.json({restored:true});
	});

	app.post("/api/admin/media/categories", managePermission, (request,response) => {
		const name = cleanName(request.body?.name);
		if (!name || name.length > 80) return response.status(400).json({ error:"invalidMediaCategory" });
		if (database.prepare("SELECT 1 FROM media_categories WHERE name = ?").get(name)) return response.status(409).json({ error:"mediaCategoryExists" });
		const id = crypto.randomUUID(), now = new Date().toISOString();
		database.prepare("INSERT INTO media_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)").run(id,name,now,now);
		writeSystemLog(database,request,"media.category_create","media_category",id,{name});
		return response.status(201).json({ category:{id,name} });
	});
	app.patch("/api/admin/media/categories/:id", managePermission, (request,response) => {
		const category = database.prepare("SELECT * FROM media_categories WHERE id = ?").get(request.params.id);
		if (!category) return response.status(404).json({ error:"mediaCategoryNotFound" });
		const name = cleanName(request.body?.name);
		if (!name || name.length > 80) return response.status(400).json({ error:"invalidMediaCategory" });
		if (database.prepare("SELECT 1 FROM media_categories WHERE name = ? AND id != ?").get(name,category.id)) return response.status(409).json({ error:"mediaCategoryExists" });
		database.prepare("UPDATE media_categories SET name = ?,updated_at = ? WHERE id = ?").run(name,new Date().toISOString(),category.id);
		writeSystemLog(database,request,"media.category_update","media_category",category.id,{name});
		return response.json({ category:{id:category.id,name} });
	});
	app.patch("/api/admin/media/:id", managePermission, (request,response) => {
		const row = database.prepare("SELECT * FROM media_files WHERE id = ?").get(request.params.id);
		if (!row || row.deleted_at) return response.status(404).json({ error:"mediaNotFound" });
		const name = cleanName(request.body?.name ?? row.name), categoryId = String(request.body?.categoryId ?? row.category_id);
		if (request.body?.archived !== undefined && typeof request.body.archived !== "boolean") return response.status(400).json({error:"invalidMediaMetadata"});
		const archived = request.body?.archived === undefined ? row.archived : request.body.archived ? 1 : 0;
		if (!name || !database.prepare("SELECT 1 FROM media_categories WHERE id = ?").get(categoryId)) return response.status(400).json({error:"invalidMediaMetadata"});
		if (archived && references().has(row.url)) return response.status(409).json({error:"mediaInUse"});
		database.prepare("UPDATE media_files SET name=?,category_id=?,archived=?,updated_at=? WHERE id=?").run(name,categoryId,archived,new Date().toISOString(),row.id);
		writeSystemLog(database,request,"media.update","media_file",row.id,{name,categoryId,archived:Boolean(archived)});
		return response.json({item:publicItem(database.prepare("SELECT * FROM media_files WHERE id = ?").get(row.id))});
	});

	return { seedImport, videoDelivery, registerLegacyImage: (url,name,mimeType,size) => addReference(url,name,mimeType,"legacy",size) };
}
