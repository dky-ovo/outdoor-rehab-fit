import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Explorer folders are database metadata, never user-controlled disk paths.
// A copy owns new UUID bytes/URLs; moving or renaming never invalidates a URL.
export const MEDIA_OPERATION_LIMITS = Object.freeze({ selected:100, descendants:10000, copyBytes:1024 * 1024 * 1024, reserveBytes:64 * 1024 * 1024 });

class MediaOperationError extends Error {
	constructor(code,status=409) { super(code);this.code=code;this.status=status; }
}
function fail(code,status=409) { throw new MediaOperationError(code,status); }

export function registerMediaFileOperations({ app,database,storageRoot,managePermission,writeSystemLog,folderTrail,publicItem,publicFolder,validStorageName,maxFolderDepth }) {
	let copying = false;
	const folderById = id => database.prepare("SELECT * FROM media_folders WHERE id=? AND deleted_at IS NULL").get(id);
	const fileById = id => database.prepare("SELECT * FROM media_files WHERE id=? AND deleted_at IS NULL").get(id);
	const activeDescendants = id => database.prepare(`WITH RECURSIVE tree(id) AS (
		SELECT id FROM media_folders WHERE id=? AND deleted_at IS NULL
		UNION SELECT f.id FROM media_folders f JOIN tree t ON f.parent_id=t.id WHERE f.deleted_at IS NULL
	) SELECT f.* FROM media_folders f JOIN tree t ON f.id=t.id ORDER BY f.id LIMIT ?`).all(id,MEDIA_OPERATION_LIMITS.descendants+1);
	const namesIn = parentId => new Set([
		...database.prepare("SELECT name FROM media_folders WHERE parent_id=? AND deleted_at IS NULL").all(parentId),
		...database.prepare("SELECT name FROM media_files WHERE folder_id=? AND deleted_at IS NULL").all(parentId),
	].map(row=>row.name));
	const nameExists = (parentId,name,exceptKind="",exceptId="") => Boolean(
		database.prepare("SELECT 1 FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL AND id!=?").get(parentId,name,exceptKind === "folder" ? exceptId : "") ||
		database.prepare("SELECT 1 FROM media_files WHERE folder_id=? AND name=? AND deleted_at IS NULL AND id!=?").get(parentId,name,exceptKind === "file" ? exceptId : "")
	);
	const route = handler => async (request,response) => {
		try { await handler(request,response); }
		catch(error) {
			if (response.headersSent) return;
			const storageFull = ["ENOSPC","EDQUOT","SQLITE_FULL"].includes(error.code);
			response.status(storageFull ? 507 : error instanceof MediaOperationError ? error.status : 500).json({error:storageFull ? "mediaStorageFull" : error instanceof MediaOperationError ? error.code : "mediaOperationFailed"});
		}
	};
	const readSelection = (body,mode) => {
		if (!Array.isArray(body?.items) || !body.items.length || body.items.length > MEDIA_OPERATION_LIMITS.selected || body.items.some(item=>!item || typeof item.id !== "string" || !item.id || !["file","folder"].includes(item.kind))) fail("invalidMediaSelection",400);
		if (body.targetFolderId !== undefined && typeof body.targetFolderId !== "string") fail("mediaFolderNotFound",400);
		const targetFolderId = body.targetFolderId || "", targetTrail = folderTrail(targetFolderId);
		if (!targetTrail) fail("mediaFolderNotFound",404);
		const selected = [...new Map(body.items.map(item=>[`${item.kind}:${item.id}`,{kind:item.kind,id:item.id}])).values()];
		const allFolders = new Map(), allFiles = new Map();
		for (const item of selected) {
			const row = item.kind === "folder" ? folderById(item.id) : fileById(item.id);
			if (!row || !folderTrail(item.kind === "folder" ? row.id : row.folder_id)) fail(item.kind === "folder" ? "mediaFolderNotFound" : "mediaNotFound",404);
			item.row=row;
			if (item.kind === "folder") {
				const descendants = activeDescendants(row.id);
				if (descendants.length > MEDIA_OPERATION_LIMITS.descendants) fail("mediaSelectionTooLarge",400);
				for (const folder of descendants) {
					allFolders.set(folder.id,folder);
					for (const file of database.prepare("SELECT * FROM media_files WHERE folder_id=? AND deleted_at IS NULL LIMIT ?").all(folder.id,MEDIA_OPERATION_LIMITS.descendants+1)) allFiles.set(file.id,file);
					if (allFiles.size+allFolders.size > MEDIA_OPERATION_LIMITS.descendants) fail("mediaSelectionTooLarge",400);
				}
			} else allFiles.set(row.id,row);
		}
		if (allFiles.size+allFolders.size > MEDIA_OPERATION_LIMITS.descendants) fail("mediaSelectionTooLarge",400);
		// Ignore separately selected children when an ancestor is selected too.
		const roots = selected.filter(item=>!allFolders.has(item.kind === "folder" ? item.row.parent_id : item.row.folder_id));
		if (mode === "move" && allFolders.has(targetFolderId)) fail("mediaFolderCycle");
		for (const item of roots.filter(item=>item.kind === "folder")) {
			const sourceTrail=folderTrail(item.id);
			for (const folder of activeDescendants(item.id)) {
				const trail=folderTrail(folder.id);
				if (!trail || targetTrail.length + trail.length - sourceTrail.length + 1 > maxFolderDepth) fail("mediaFolderTooDeep");
			}
		}
		if (mode === "copy" && [...allFiles.values()].some(file=>file.source !== "upload" || !/^[a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|mov|webm|bin)$/.test(file.storage_name))) fail("mediaCopyUnsupported");
		return { targetFolderId,roots,folders:[...allFolders.values()].sort((a,b)=>a.id.localeCompare(b.id)),files:[...allFiles.values()].sort((a,b)=>a.id.localeCompare(b.id)) };
	};
	const snapshot = plan => JSON.stringify({roots:plan.roots,folders:plan.folders,files:plan.files});
	const rootResults = roots => roots.map(item=>item.kind === "folder" ? publicFolder(folderById(item.id)) : publicItem(fileById(item.id)));

	app.patch("/api/admin/media/folders/:id",managePermission,route((request,response)=>{
		const name=request.body?.name;
		if (!validStorageName(name)) fail("invalidStorageName",400);
		const result=database.transaction(()=>{
			const row=folderById(request.params.id);
			if (!row || !folderTrail(row.id)) fail("mediaFolderNotFound",404);
			if (nameExists(row.parent_id,name,"folder",row.id)) fail("mediaNameConflict");
			database.prepare("UPDATE media_folders SET name=?,updated_at=? WHERE id=?").run(name,new Date().toISOString(),row.id);
			writeSystemLog(database,request,"media.folder_rename","media_folder",row.id,{beforeName:row.name,name});
			return publicFolder(folderById(row.id));
		}).immediate();
		response.json({folder:result});
	}));

	app.post("/api/admin/media/move",managePermission,route((request,response)=>{
		const result=database.transaction(()=>{
			const plan=readSelection(request.body,"move"), reserved=new Set();
			for (const item of plan.roots) {
				if (reserved.has(item.row.name) || nameExists(plan.targetFolderId,item.row.name,item.kind,item.id)) fail("mediaNameConflict");
				reserved.add(item.row.name);
			}
			let movedFiles=0,movedFolders=0;
			const now=new Date().toISOString();
			for (const item of plan.roots) {
				if ((item.kind === "folder" ? item.row.parent_id : item.row.folder_id) === plan.targetFolderId) continue;
				if (item.kind === "folder") { database.prepare("UPDATE media_folders SET parent_id=?,updated_at=? WHERE id=?").run(plan.targetFolderId,now,item.id);movedFolders++; }
				else { database.prepare("UPDATE media_files SET folder_id=?,updated_at=? WHERE id=?").run(plan.targetFolderId,now,item.id);movedFiles++; }
			}
			writeSystemLog(database,request,"media.move","media_file",null,{targetFolderId:plan.targetFolderId,movedFiles,movedFolders});
			return {items:rootResults(plan.roots),movedFiles,movedFolders};
		}).immediate();
		response.json(result);
	}));

	const copyName = (name,occupied,isFolder) => {
		if (!occupied.has(name)) {occupied.add(name);return name;}
		const detectedExtension=isFolder ? "" : path.extname(name);
		// Real supported media suffixes are short. An arbitrary document may
		// have a 199-character "extension"; do not exceed the filename limit.
		const extension=detectedExtension.length <= 32 ? detectedExtension : "",stem=extension ? name.slice(0,-extension.length) : name;
		for(let number=1;number<=MEDIA_OPERATION_LIMITS.descendants+1000;number++) {
			const suffix=` - 副本${number === 1 ? "" : ` (${number})`}${extension}`;
			const candidate=stem.slice(0,Math.max(1,200-suffix.length))+suffix;
			if (!occupied.has(candidate)) {occupied.add(candidate);return candidate;}
		}
		fail("mediaNameConflict");
	};
	app.post("/api/admin/media/copy",managePermission,route(async(request,response)=>{
		if(copying) fail("tooManyMediaCopies",429);
		copying=true;
		const ownedPaths=[];let committed=false;
		try {
			const plan=readSelection(request.body,"copy"), before=snapshot(plan), copies=[];
			if(plan.files.length) {
				if(!fs.existsSync(storageRoot) || fs.lstatSync(storageRoot).isSymbolicLink() || !fs.statSync(storageRoot).isDirectory()) fail("mediaUnavailable",404);
				let bytes=0;
				for(const row of plan.files) {
					const stat=fs.lstatSync(path.join(storageRoot,row.storage_name));
					if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) fail("mediaUnavailable",404);
					bytes+=stat.size;
					if(bytes > MEDIA_OPERATION_LIMITS.copyBytes) fail("mediaCopyTooLarge",413);
				}
				const free=fs.statfsSync(storageRoot);
				if(free.bavail*free.bsize < bytes+MEDIA_OPERATION_LIMITS.reserveBytes) fail("mediaStorageFull",507);
			}
			for(const row of plan.files) {
				if(request.aborted || response.destroyed) fail("mediaCopyCancelled",409);
				const id=crypto.randomUUID(),storageName=`${id}${path.extname(row.storage_name)}`,newPath=path.join(storageRoot,storageName),partialPath=path.join(storageRoot,`${id}.partial`);
				let source,destination;
				try {
					source=await fs.promises.open(path.join(storageRoot,row.storage_name),fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
					const stat=await source.stat();
					if(!stat.isFile() || stat.nlink > 1 || (row.size_bytes !== null && stat.size !== row.size_bytes)) fail("mediaUnavailable",404);
					destination=await fs.promises.open(partialPath,"wx",0o600);ownedPaths.push(partialPath);
					const hash=crypto.createHash("sha256"),buffer=Buffer.alloc(1024*1024);let bytes=0;
					while(true) {
						const {bytesRead}=await source.read(buffer,0,buffer.length,null);if(!bytesRead) break;
						bytes+=bytesRead;if(bytes > stat.size) fail("mediaChangedDuringCopy");
						if(request.aborted || response.destroyed) fail("mediaCopyCancelled");
						const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);await destination.writeFile(chunk);
					}
					const sha256=hash.digest("hex");
					if(bytes !== stat.size || (row.sha256 && sha256 !== row.sha256)) fail("mediaChangedDuringCopy");
					await destination.sync();await destination.close();destination=null;
					// link() publishes without replacing any existing file; unlink the
					// temporary name immediately so the completed object has one link.
					await fs.promises.link(partialPath,newPath);ownedPaths.push(newPath);await fs.promises.unlink(partialPath);
					copies.push({old:row,id,storageName,size:bytes,sha256,url:`/api/media/${id}/${storageName}`});
				} finally {if(source) await source.close().catch(()=>{});if(destination) await destination.close().catch(()=>{});}
			}
			const result=database.transaction(()=>{
				// Async file IO must not resurrect a source deleted or moved while
				// copying, nor copy an unobserved newly added child into a folder.
				if(snapshot(readSelection(request.body,"copy")) !== before) fail("mediaChangedDuringCopy");
				const now=new Date().toISOString(),folderIds=new Map(plan.folders.map(folder=>[folder.id,crypto.randomUUID()])),rootKeys=new Set(plan.roots.map(item=>`${item.kind}:${item.id}`)),occupied=new Map();
				const availableNames = parentId => {if(!occupied.has(parentId)) occupied.set(parentId,namesIn(parentId));return occupied.get(parentId);};
				// Folder rows have no FK on parent_id; names and ancestry have
				// already been validated as a bounded active tree under this lock.
				for(const row of plan.folders) {
					const parentId=rootKeys.has(`folder:${row.id}`) ? plan.targetFolderId : folderIds.get(row.parent_id);
					if(parentId === undefined) fail("mediaChangedDuringCopy");
					const name=copyName(row.name,availableNames(parentId),true);
					database.prepare("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(folderIds.get(row.id),parentId,name,now,now);
				}
				for(const item of copies) {
					const parentId=rootKeys.has(`file:${item.old.id}`) ? plan.targetFolderId : folderIds.get(item.old.folder_id);
					if(parentId === undefined) fail("mediaChangedDuringCopy");
					const name=copyName(item.old.name,availableNames(parentId),false);
					database.prepare(`INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_by,created_at,updated_at,folder_id)
						VALUES(?,?,?,?,?,?,?,'upload',?,?,?,?,?,?,?)`).run(item.id,item.url,name,item.old.mime_type,item.old.kind,item.size,item.old.category_id,item.storageName,item.sha256,item.old.archived,request.admin.user.id,now,now,parentId);
				}
				const roots=plan.roots.map(item=>({kind:item.kind,id:item.kind === "folder" ? folderIds.get(item.id) : copies.find(copy=>copy.old.id === item.id).id}));
				writeSystemLog(database,request,"media.copy","media_file",null,{targetFolderId:plan.targetFolderId,copiedFiles:copies.length,copiedFolders:plan.folders.length});
				return {items:rootResults(roots),copiedFiles:copies.length,copiedFolders:plan.folders.length};
			}).immediate();
			committed=true;response.status(201).json(result);
		} finally {
			if(!committed) for(const file of ownedPaths) await fs.promises.unlink(file).catch(()=>{});
			copying=false;
		}
	}));
}
