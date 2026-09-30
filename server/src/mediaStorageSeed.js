import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Version 2 imports only a locally supplied, hash-verified deployment manifest.
// No network fetch, archive extraction, filesystem recursion or equipment edits.
// Import ledgers preserve later administrator renames, archiving and deletion.
export function importMediaStorageSeed({database,mediaSeedDir,storageRoot,types,limits,signatureMatches,validName}) {
	if (!mediaSeedDir) return null;
	const manifestPath = path.join(mediaSeedDir,"manifest.json"), filesRoot = path.join(mediaSeedDir,"files");
	let manifest;
	try {
		if (fs.lstatSync(mediaSeedDir).isSymbolicLink() || fs.lstatSync(filesRoot).isSymbolicLink()) return null;
		const stat = fs.lstatSync(manifestPath);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2*1024*1024) return null;
		manifest = JSON.parse(fs.readFileSync(manifestPath,"utf8"));
	} catch { return null; }
	if (manifest?.version !== 2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.importId || "") || !Array.isArray(manifest.items) || manifest.items.length > 10000) return null;
	const report = {importId:manifest.importId,items:[],errors:[],complete:false};
	const folderIds = new Map([["",""]]);
	const ensureFolder = value => {
		if (!value) return "";
		if (typeof value !== "string") throw new Error("invalidFolderPath");
		const parts = value.split("/");
		if (parts.length > limits.maxFolderDepth || parts.some(part=>!validName(part))) throw new Error("invalidFolderPath");
		let folderPath = "", parentId = "";
		for (const name of parts) {
			folderPath = folderPath ? `${folderPath}/${name}` : name;
			if (folderIds.has(folderPath)) { parentId = folderIds.get(folderPath); continue; }
			const imported = database.prepare("SELECT folder_id FROM media_seed_folders WHERE import_id=? AND folder_path=?").get(manifest.importId,folderPath);
			let row = imported ? database.prepare("SELECT * FROM media_folders WHERE id=?").get(imported.folder_id) : database.prepare("SELECT * FROM media_folders WHERE parent_id=? AND name=? AND deleted_at IS NULL").get(parentId,name);
			if (imported && (!row || row.deleted_at)) throw new Error("seedFolderDeletedByAdministrator");
			if (!row) {
				const now=new Date().toISOString(); row={id:crypto.randomUUID()};
				database.prepare("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(row.id,parentId,name,now,now);
			}
			database.prepare("INSERT OR IGNORE INTO media_seed_folders(import_id,folder_path,folder_id) VALUES(?,?,?)").run(manifest.importId,folderPath,row.id);
			parentId=row.id; folderIds.set(folderPath,row.id);
		}
		return parentId;
	};
	try {
		fs.mkdirSync(storageRoot,{recursive:true});
		if (fs.lstatSync(storageRoot).isSymbolicLink()) throw new Error("unsafeMediaStorage");
		for (const folder of (Array.isArray(manifest.folders) ? manifest.folders : []).slice(0,10000)) ensureFolder(folder);
	} catch(error) {report.errors.push({fileName:"",error:error.message});return report;}
	const seen = new Set();
	for (const item of manifest.items) {
		let finalPath, copied = false, fd;
		try {
			const fileName=String(item?.fileName || ""), mimeType=String(item?.mimeType || "application/octet-stream").toLowerCase(), expected=String(item?.sha256 || "").toLowerCase();
			if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}$/.test(fileName) || seen.has(fileName) || !/^[a-f0-9]{64}$/.test(expected) || !validName(item.name)) throw new Error("invalidSeedItem");
			seen.add(fileName);
			const extension=path.extname(fileName).slice(1).toLowerCase();
			if (types[mimeType] && !types[mimeType].includes(extension)) throw new Error("invalidSeedMediaType");
			const kind=types[mimeType] ? mimeType.startsWith("video/") ? "video" : "image" : "file";
			const previous=database.prepare("SELECT file_id FROM media_seed_items WHERE import_id=? AND file_name=?").get(manifest.importId,fileName);
			let row=previous && database.prepare("SELECT * FROM media_files WHERE id=?").get(previous.file_id);
			if (previous && !row) throw new Error("seedFileRemovedByAdministrator");
			if (row && row.sha256 !== expected) throw new Error("seedImportIdContentChanged");
			if (!row) {
				const sourcePath=path.join(filesRoot,fileName), stat=fs.lstatSync(sourcePath);
				const maximum=kind === "video" ? limits.videoBytes : kind === "image" ? limits.imageBytes : limits.fileBytes;
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || (!stat.size && kind !== "file")) throw new Error("invalidSeedFile");
				fd=fs.openSync(sourcePath,"r"); const hash=crypto.createHash("sha256"), buffer=Buffer.alloc(1024*1024); let head=Buffer.alloc(0), count;
				while ((count=fs.readSync(fd,buffer,0,buffer.length,null))>0) { const chunk=buffer.subarray(0,count);hash.update(chunk);if(!head.length) head=Buffer.from(chunk.subarray(0,65536)); }
				fs.closeSync(fd);fd=null;
				if (hash.digest("hex") !== expected || (kind !== "file" && !signatureMatches(head,mimeType))) throw new Error("invalidSeedHashOrSignature");
				const folderId=ensureFolder(item.folderPath || ""), now=new Date().toISOString(), id=crypto.randomUUID(), storageName=`${id}.${types[mimeType]?.[0] || "bin"}`;
				let categoryId=database.prepare("SELECT id FROM media_categories WHERE id=?").get(item.categoryId)?.id;
				if (!categoryId && typeof item.categoryName === "string" && validName(item.categoryName) && item.categoryName.length <= 80) {
					let category=database.prepare("SELECT id FROM media_categories WHERE name=?").get(item.categoryName);
					if (!category) {category={id:crypto.randomUUID()};database.prepare("INSERT INTO media_categories(id,name,created_at,updated_at) VALUES(?,?,?,?)").run(category.id,item.categoryName,now,now);}
					categoryId=category.id;
				}
				categoryId ||= kind === "video" ? "videos" : kind === "image" ? mimeType === "image/gif" ? "facilities-gifs" : "facilities-images" : "other";
				finalPath=path.join(storageRoot,storageName); fs.copyFileSync(sourcePath,finalPath,fs.constants.COPYFILE_EXCL);copied=true;fs.chmodSync(finalPath,0o600);
				// Verify the committed copy too: a concurrently changed source file
				// must not publish metadata for bytes that were not actually copied.
				fd=fs.openSync(finalPath,"r");const copiedHash=crypto.createHash("sha256");
				while ((count=fs.readSync(fd,buffer,0,buffer.length,null))>0) copiedHash.update(buffer.subarray(0,count));
				fs.closeSync(fd);fd=null;
				if (copiedHash.digest("hex") !== expected) throw new Error("seedChangedDuringCopy");
				database.transaction(()=>{
					database.prepare(`INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_at,updated_at,folder_id) VALUES(?,?,?,?,?,?,?,'upload',?,?,?,?,?,?)`).run(id,`/api/media/${id}/${storageName}`,item.name,mimeType,kind,stat.size,categoryId,storageName,expected,item.archived || item.archiveOnly ? 1 : 0,now,now,folderId);
					database.prepare("INSERT INTO media_seed_items(import_id,file_name,file_id,created_at) VALUES(?,?,?,?)").run(manifest.importId,fileName,id,now);
				})();
				copied=false;row=database.prepare("SELECT * FROM media_files WHERE id=?").get(id);
			}
			report.items.push({id:row.id,url:row.url,name:row.name,sha256:row.sha256,kind:row.kind,folderId:row.folder_id,archived:Boolean(row.archived),deleted:Boolean(row.deleted_at),equipmentId:item.equipmentId === undefined ? null : String(item.equipmentId),locale:["zh","en"].includes(item.locale) ? item.locale : null,fileName});
		} catch(error) {report.errors.push({fileName:String(item?.fileName || ""),error:error.message});}
		finally {if(fd!==undefined && fd!==null) fs.closeSync(fd);if(copied&&finalPath) try{fs.unlinkSync(finalPath);}catch{/* preserve unrelated files */}}
	}
	report.complete=report.errors.length===0 && report.items.length===manifest.items.length;
	return report;
}
