import { validateAdminMedia } from "./adminMedia";
import { normalizeStorageRelativePath } from "./pickAdminMedia";

export async function importAdminMediaBatch({ batch, parentId = "", categoryId = "", kind = "", createFolder, uploadFile, signal, onProgress }) {
	const files = batch?.files || [], folders = new Set(batch?.folders || []);
	if (files.length + folders.size > 10000) throw new Error("invalidFolderPath");
	// Validate every path and size first, so an unsupported file does not leave
	// a half-created directory tree before the user is informed.
	const prepared = files.map(({file,relativePath})=>{
		const normalized = normalizeStorageRelativePath(relativePath || file.name);
		const parts = normalized.split("/");
		for (let depth=1;depth<parts.length;depth++) folders.add(parts.slice(0,depth).join("/"));
		return {file,metadata:validateAdminMedia(file,kind),folder:parts.slice(0,-1).join("/")};
	});
	for (const value of [...folders]) {
		const normalized = normalizeStorageRelativePath(value);
		if (normalized.split("/").length > 32) throw new Error("invalidFolderPath");
		const parts = normalized.split("/");
		for (let depth=1;depth<parts.length;depth++) folders.add(parts.slice(0,depth).join("/"));
	}
	const ids = new Map([["",parentId]]); let uploaded = 0, createdFolders = 0;
	const check = () => { if (signal?.aborted) throw new Error("uploadCancelled"); };
	try {
		for (const value of [...folders].sort((a,b)=>a.split("/").length-b.split("/").length || a.localeCompare(b))) {
			check(); const parts = value.split("/"), name = parts.pop();
			const response = await createFolder(name,ids.get(parts.join("/")));
			check(); ids.set(value,response.folder.id); if (!response.existing) createdFolders++;
		}
		for (const item of prepared) {
			check(); onProgress?.({uploaded,total:prepared.length,name:item.metadata.name,percent:0});
			await uploadFile(item.file.blob || item.file,{...item.metadata,categoryId,folderId:ids.get(item.folder),signal,onProgress:percent=>onProgress?.({uploaded,total:prepared.length,name:item.metadata.name,percent})});
			uploaded++; check();
		}
		return {uploaded,createdFolders};
	} catch (error) { error.uploaded = uploaded; error.createdFolders = createdFolders; throw error; }
}
