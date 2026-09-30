import { importAdminMediaBatch } from "../adminMediaBatch";
import { normalizeStorageRelativePath } from "../pickAdminMedia";
jest.mock("expo-image-picker",()=>({}));
const file = name => ({name,size:20,type:name.endsWith("mp4") ? "video/mp4" : "application/octet-stream"});
const setup = () => ({createFolder:jest.fn(async(name,parentId)=>({folder:{id:`${parentId}/${name}`}})),uploadFile:jest.fn(async()=>({})),onProgress:jest.fn()});
test("creates nested and empty folders in dependency order and streams files to exact parents",async()=>{
	const api=setup();
	await expect(importAdminMediaBatch({...api,parentId:"root",batch:{folders:["中文/空目录"],files:[{file:file("01.mp4"),relativePath:"中文/01.mp4"},{file:file("code.docx"),relativePath:"code.docx"}]}})).resolves.toEqual({uploaded:2,createdFolders:2});
	expect(api.createFolder.mock.calls).toEqual([["中文","root"],["空目录","root/中文"]]);
	expect(api.uploadFile.mock.calls[0][1]).toMatchObject({folderId:"root/中文",mimeType:"video/mp4"});
	expect(api.uploadFile.mock.calls[1][1]).toMatchObject({folderId:"root",kind:"file"});
});
test.each(["../private.mp4","/absolute.mp4","x\\private.mp4","x//private.mp4","x/./private.mp4","x/../private.mp4"])("rejects unsafe relative path %s before any network writes",async relativePath=>{
	const api=setup();await expect(importAdminMediaBatch({...api,batch:{files:[{file:file("private.mp4"),relativePath}]}})).rejects.toThrow("invalidFolderPath");
	expect(api.createFolder).not.toHaveBeenCalled();expect(api.uploadFile).not.toHaveBeenCalled();
});
test("validates all sizes before uploading the first file",async()=>{
	const api=setup();await expect(importAdminMediaBatch({...api,batch:{files:[{file:file("ok.mp4"),relativePath:"ok.mp4"},{file:{...file("large.mp4"),size:251*1024*1024},relativePath:"large.mp4"}]}})).rejects.toThrow("mediaFileTooLarge");expect(api.uploadFile).not.toHaveBeenCalled();
});
test("cancelled folder import stops before remaining uploads and reports completed items",async()=>{
	const api=setup(), controller=new AbortController();
	api.uploadFile.mockImplementationOnce(async()=>controller.abort());
	await expect(importAdminMediaBatch({...api,signal:controller.signal,batch:{files:[{file:file("a.mp4"),relativePath:"a.mp4"},{file:file("b.mp4"),relativePath:"b.mp4"}]}})).rejects.toMatchObject({message:"uploadCancelled",uploaded:1});
	expect(api.uploadFile).toHaveBeenCalledTimes(1);
});
test("enforces folder nesting depth while accepting traditional Chinese and English names",()=>{
	expect(normalizeStorageRelativePath("中文/English video/01 太極揉推器.mp4")).toBe("中文/English video/01 太極揉推器.mp4");
	expect(()=>normalizeStorageRelativePath(Array(34).fill("x").join("/"))).toThrow("invalidFolderPath");
});
