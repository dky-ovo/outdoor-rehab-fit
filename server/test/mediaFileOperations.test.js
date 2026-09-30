import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { MEDIA_OPERATION_LIMITS } from "../src/mediaFileOperations.js";

const SECRET="file-operation-tests-only-not-production";
const MP4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(4),Buffer.from("isommp42"),Buffer.from([0,0,0,16]),Buffer.from("mdat"),Buffer.alloc(8)]);
async function fixture(run) {
	const root=fs.mkdtempSync(path.join(os.tmpdir(),"outdoor-file-operations-")),database=createDatabase(":memory:"),tokens={};
	const mediaUploadDir=path.join(root,"media"),now=new Date().toISOString();
	for(const [index,[id,permissions]] of [["files",["app_maintenance.files.manage"]],["equipment",["app_maintenance.equipment.manage"]],["home",["app_maintenance.home.manage"]],["ordinary",null]].entries()) {
		database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,'staff','test','test',?,?)").run(id,id,`+8529666000${index}`,now,now);
		if(permissions) database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES(?,'operator',?,1,?,?)").run(id,JSON.stringify(permissions),now,now);
		tokens[id]=signToken({id,profile_role:"staff"},SECRET);
	}
	const app=createApp({database,jwtSecret:SECRET,mediaUploadDir,equipmentUploadDir:path.join(root,"images")}),server=app.listen(0,"127.0.0.1");
	await new Promise(resolve=>server.once("listening",resolve));
	const base=`http://127.0.0.1:${server.address().port}`;
	const request=(route,{method="GET",body,actor="files",headers={}}={})=>fetch(base+route,{method,headers:{...(actor ? {Authorization:`Bearer ${tokens[actor]}`} : {}),...(body !== undefined && !Buffer.isBuffer(body) ? {"Content-Type":"application/json"} : {}),...headers},...(body === undefined ? {} : {body:Buffer.isBuffer(body) ? body : JSON.stringify(body)})});
	const folder=async(name,parentId="")=>{const result=await request("/api/admin/media/folders",{method:"POST",body:{name,parentId}});assert.equal(result.status,201);return (await result.json()).folder;};
	const upload=async(name="video.mp4",folderId="",bytes=MP4,mimeType="video/mp4")=>{const result=await request(`/api/admin/media/upload?${new URLSearchParams({name,folderId,mimeType})}`,{method:"POST",body:bytes,headers:{"Content-Type":"application/octet-stream"}});assert.equal(result.status,201);return (await result.json()).item;};
	const action=(verb,items,targetFolderId="",actor="files")=>request(`/api/admin/media/${verb}`,{method:"POST",body:{items,targetFolderId},actor});
	try {await run({database,request,folder,upload,action,mediaUploadDir,base});}
	finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();assert.ok(path.dirname(root)===path.resolve(os.tmpdir()) && path.basename(root).startsWith("outdoor-file-operations-"));fs.rmSync(root,{recursive:true,force:true});}
}
const selected=item=>({id:item.id,kind:item.kind === "folder" ? "folder" : "file"});

test("explorer write operations require file management permission, including for public video metadata",async()=>{
	await fixture(async({folder,upload,action,request})=>{
		const directory=await folder("Root"),file=await upload();
		for(const actor of [null,"ordinary","equipment","home"]) {
			const expected=actor === null ? 401 : 403;
			assert.equal((await action("move",[selected(file)],directory.id,actor)).status,expected);
			assert.equal((await action("copy",[selected(file)],directory.id,actor)).status,expected);
			assert.equal((await request(`/api/admin/media/folders/${directory.id}`,{method:"PATCH",body:{name:"No"},actor})).status,expected);
		}
	});
});

test("folder rename updates breadcrumbs without changing descendant URLs and rejects traversal or conflicts",async()=>{
	await fixture(async({folder,upload,request,database})=>{
		const directory=await folder("Old"),file=await upload("one.mp4",directory.id);await folder("Taken");await upload("File name.mp4");
		const result=await request(`/api/admin/media/folders/${directory.id}`,{method:"PATCH",body:{name:"New"}});assert.equal(result.status,200);assert.equal((await result.json()).folder.name,"New");
		const listed=await(await request(`/api/admin/media?folderId=${directory.id}`)).json();assert.equal(listed.trail[0].name,"New");assert.equal(listed.items[0].url,file.url);
		for(const name of ["../escape","bad/name","bad\\name","."," bad ","bad\u0000name"]) assert.equal((await request(`/api/admin/media/folders/${directory.id}`,{method:"PATCH",body:{name}})).status,400);
		for(const name of ["Taken","File name.mp4"]) assert.equal((await request(`/api/admin/media/folders/${directory.id}`,{method:"PATCH",body:{name}})).status,409);
		assert.equal(database.prepare("SELECT name FROM media_folders WHERE id=?").get(directory.id).name,"New");
	});
});

test("moving an in-use bilingual video keeps its immutable URL, bytes and reference protection",async()=>{
	await fixture(async({folder,upload,action,database,request,base})=>{
		const target=await folder("Target"),file=await upload();database.prepare("UPDATE app_equipment_items SET video_url_zh=?,video_url_en=? WHERE id='0'").run(file.url,file.url);
		const response=await action("move",[selected(file)],target.id);assert.equal(response.status,200);const result=await response.json();assert.equal(result.movedFiles,1);assert.equal(result.items[0].url,file.url);assert.equal(result.items[0].isReferenced,true);
		assert.deepEqual(Buffer.from(await(await fetch(base+file.url)).arrayBuffer()),MP4);
		assert.equal((await request("/api/admin/media/delete",{method:"POST",body:{items:[selected(target)]}})).status,409);
		assert.equal((await action("move",[selected(file)],target.id)).status,200);
		assert.equal(database.prepare("SELECT video_url_zh FROM app_equipment_items WHERE id='0'").get().video_url_zh,file.url);
	});
});

test("folder moves preserve nested structure, collapse overlapping selections and prevent cycles",async()=>{
	await fixture(async({folder,upload,action,database})=>{
		const a=await folder("A"),b=await folder("B",a.id),target=await folder("Target"),file=await upload("nested.mp4",b.id);
		let response=await action("move",[selected(a)],b.id);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaFolderCycle");
		response=await action("move",[selected(a),selected(b),selected(file)],target.id);assert.equal(response.status,200);const result=await response.json();assert.equal(result.items.length,1);assert.equal(result.movedFolders,1);assert.equal(result.movedFiles,0);
		assert.equal(database.prepare("SELECT parent_id FROM media_folders WHERE id=?").get(a.id).parent_id,target.id);
		assert.equal(database.prepare("SELECT parent_id FROM media_folders WHERE id=?").get(b.id).parent_id,a.id);
		assert.equal(database.prepare("SELECT folder_id,url FROM media_files WHERE id=?").get(file.id).url,file.url);
	});
});

test("move conflicts, invalid targets and mixed selections fail atomically",async()=>{
	await fixture(async({folder,upload,action,database,request})=>{
		const target=await folder("Target"),one=await upload("same.mp4"),two=await upload("other.mp4");await upload("same.mp4",target.id);
		const response=await action("move",[selected(two),selected(one)],target.id);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaNameConflict");
		assert.equal(database.prepare("SELECT folder_id FROM media_files WHERE id=?").get(two.id).folder_id,"");
		assert.equal((await action("move",[selected(one)],"../filesystem")).status,404);
		assert.equal((await action("move",[selected(one),{kind:"folder",id:"missing"}],target.id)).status,404);
		assert.equal((await action("move",[],target.id)).status,400);
		assert.equal((await request("/api/admin/media/move",{method:"POST",body:{items:[selected(one)],targetFolderId:{path:"/"}}})).status,400);
	});
});

test("copies create separate verified bytes and preserve public Range and private attachment access",async()=>{
	await fixture(async({folder,upload,action,database,request,base,mediaUploadDir})=>{
		const target=await folder("Copies"),video=await upload(),document=await upload("private.html","",Buffer.from("<p>private</p>"),"text/html");
		database.prepare("UPDATE app_equipment_items SET video_url_en=? WHERE id='0'").run(video.url);
		const response=await action("copy",[selected(video),selected(document)],target.id);assert.equal(response.status,201);const result=await response.json();assert.equal(result.copiedFiles,2);
		const copy=result.items.find(item=>item.kind === "video"),privateCopy=result.items.find(item=>item.kind === "file");assert.notEqual(copy.id,video.id);assert.notEqual(copy.url,video.url);assert.equal(copy.isReferenced,false);
		const row=database.prepare("SELECT * FROM media_files WHERE id=?").get(copy.id);assert.equal(row.sha256,crypto.createHash("sha256").update(MP4).digest("hex"));assert.deepEqual(fs.readFileSync(path.join(mediaUploadDir,row.storage_name)),MP4);assert.equal(fs.statSync(path.join(mediaUploadDir,row.storage_name)).nlink,1);
		const range=await fetch(base+copy.url,{headers:{Range:"bytes=8-15"}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),MP4.subarray(8,16));
		assert.equal((await fetch(base+privateCopy.url)).status,404);assert.equal((await request(`/api/admin/media-download/${privateCopy.id}`,{actor:"equipment"})).status,403);
		const downloaded=await request(`/api/admin/media-download/${privateCopy.id}`);assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),"<p>private</p>");
		assert.equal((await request("/api/admin/media/delete",{method:"POST",body:{items:[selected(copy)]}})).status,200);assert.equal((await fetch(base+video.url)).status,200);
	});
});

test("public video download query cannot request attachment; authenticated admin download and playback ranges remain available",async()=>{
	await fixture(async({upload,request,base})=>{
		const file=await upload();
		for(const suffix of ["","?download=true","?download=1"]) {
			const response=await fetch(base+file.url+suffix,{headers:{Range:"bytes=8-15"}});
			assert.equal(response.status,206);assert.equal(response.headers.get("content-disposition"),"inline");assert.equal(response.headers.get("content-type"),"video/mp4");
			assert.deepEqual(Buffer.from(await response.arrayBuffer()),MP4.subarray(8,16));
		}
		assert.equal((await request(`/api/admin/media-download/${file.id}`,{actor:null})).status,401);
		assert.equal((await request(`/api/admin/media-download/${file.id}`,{actor:"ordinary"})).status,403);
		const download=await request(`/api/admin/media-download/${file.id}`);assert.equal(download.status,200);assert.match(download.headers.get("content-disposition"),/^attachment;/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),MP4);
	});
});

test("recursive copy preserves empty folders and archived files but not deleted children",async()=>{
	await fixture(async({folder,upload,action,database,request})=>{
		const root=await folder("Source"),empty=await folder("Empty",root.id),nested=await folder("Nested",root.id),archived=await upload("archive.mp4",nested.id),deleted=await upload("deleted.mp4",root.id),target=await folder("Target");
		await request(`/api/admin/media/${archived.id}`,{method:"PATCH",body:{archived:true}});await request("/api/admin/media/delete",{method:"POST",body:{items:[selected(deleted)]}});
		const response=await action("copy",[selected(root),selected(empty),selected(archived)],target.id);assert.equal(response.status,201);const result=await response.json();assert.equal(result.copiedFolders,3);assert.equal(result.copiedFiles,1);assert.equal(result.items.length,1);
		const newRoot=result.items[0];const children=database.prepare("SELECT * FROM media_folders WHERE parent_id=?").all(newRoot.id);assert.deepEqual(children.map(row=>row.name).sort(),["Empty","Nested"]);
		const copy=database.prepare("SELECT * FROM media_files WHERE folder_id=?").get(children.find(row=>row.name === "Nested").id);assert.equal(copy.archived,1);assert.notEqual(copy.url,archived.url);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files WHERE name='deleted.mp4'").get().n,1);
	});
});

test("copying to the same directory generates collision-safe names without overwriting",async()=>{
	await fixture(async({folder,upload,action,database})=>{
		const root=await folder("Folder"),file=await upload("original.mp4");
		for(let run=1;run<=2;run++) {
			const result=await(await action("copy",[selected(root),selected(file)])).json();assert.equal(result.items.length,2);assert.match(result.items.find(item=>item.kind === "video").name,/^original - 副本/);
		}
		assert.equal(database.prepare("SELECT COUNT(DISTINCT name) n FROM media_files").get().n,3);assert.equal(database.prepare("SELECT name,url FROM media_files WHERE id=?").get(file.id).name,"original.mp4");
	});
});

test("external references cannot be copied and a mixed batch makes no partial copies",async()=>{
	await fixture(async({folder,upload,action,database,mediaUploadDir,request})=>{
		const real=await upload(),target=await folder("Target"),now=new Date().toISOString();
		database.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,category_id,source,created_at,updated_at) VALUES('legacy','https://example.org/video.mp4','External','video/mp4','video','videos','external',?,?)").run(now,now);
		const before=fs.readdirSync(mediaUploadDir),response=await action("copy",[selected(real),{id:"legacy",kind:"file"}],target.id);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaCopyUnsupported");assert.deepEqual(fs.readdirSync(mediaUploadDir),before);
		const listed=await(await request("/api/admin/media?folderId=")).json();assert.equal(listed.items.find(item=>item.id === "legacy").canCopy,false);
	});
});

test("folder-only listing and sorting retain real server pagination and reject SQL-like sorting",async()=>{
	await fixture(async({folder,upload,request})=>{
		for(const name of ["Z folder","A folder","M folder"]) await folder(name);
		for(const name of ["C.mp4","A.mp4","B.mp4"]) await upload(name);
		const listed=await(await request("/api/admin/media?folderId=&kind=folder&limit=2&page=2&sort=name&direction=asc")).json();assert.equal(listed.total,3);assert.equal(listed.items.length,1);assert.equal(listed.items[0].name,"Z folder");assert.equal(listed.items[0].parentId,"");assert.ok(listed.items[0].updatedAt);
		const videos=await(await request("/api/admin/media?kind=video&limit=2&page=1&sort=name&direction=desc")).json();assert.deepEqual(videos.items.map(row=>row.name),["C.mp4","B.mp4"]);assert.equal(videos.total,3);
		assert.equal((await request("/api/admin/media?sort=name%3BDROP%20TABLE%20users")).status,400);assert.equal((await request("/api/admin/media?sort=name&direction=unsafe")).status,400);
	});
});

test("copy detects a changed hash and removes only its new temporary objects",async()=>{
	await fixture(async({upload,action,database,mediaUploadDir})=>{
		const file=await upload(),row=database.prepare("SELECT * FROM media_files WHERE id=?").get(file.id),bytes=Buffer.from(MP4);bytes[bytes.length-1]=1;fs.writeFileSync(path.join(mediaUploadDir,row.storage_name),bytes);
		const before=fs.readdirSync(mediaUploadDir),response=await action("copy",[selected(file)]);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaChangedDuringCopy");assert.deepEqual(fs.readdirSync(mediaUploadDir),before);assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files").get().n,1);
	});
});

test("copy refuses insufficient disk space before writing new objects",async(t)=>{
	await fixture(async({upload,action,database,mediaUploadDir})=>{
		const file=await upload(),before=fs.readdirSync(mediaUploadDir),original=fs.statfsSync;t.mock.method(fs,"statfsSync",(...args)=>({...original(...args),bavail:0}));
		try {const response=await action("copy",[selected(file)]);assert.equal(response.status,507);assert.equal((await response.json()).error,"mediaStorageFull");assert.deepEqual(fs.readdirSync(mediaUploadDir),before);assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files").get().n,1);}
		finally {t.mock.restoreAll();}
	});
});

test("copy rechecks metadata after asynchronous IO and rolls back unpublished objects",async(t)=>{
	await fixture(async({upload,action,database,mediaUploadDir})=>{
		const file=await upload(),before=fs.readdirSync(mediaUploadDir),original=fs.promises.link;
		t.mock.method(fs.promises,"link",async(...args)=>{await original(...args);database.prepare("UPDATE media_files SET name='Changed by another operator' WHERE id=?").run(file.id);});
		try {const response=await action("copy",[selected(file)]);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaChangedDuringCopy");assert.deepEqual(fs.readdirSync(mediaUploadDir),before);assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files").get().n,1);}
		finally {t.mock.restoreAll();}
	});
});

test("folder operations enforce depth and reject trashed source trees",async()=>{
	await fixture(async({folder,upload,action,database,request})=>{
		const source=await folder("Source"),child=await folder("Child",source.id),file=await upload("child.mp4",child.id),now=new Date().toISOString();let parent="";
		for(let index=0;index<32;index++) {const id=`depth-${index}`;database.prepare("INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,parent,`Depth ${index}`,now,now);parent=id;}
		for(const verb of ["move","copy"]) {const response=await action(verb,[selected(source)],parent);assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaFolderTooDeep");}
		await request("/api/admin/media/delete",{method:"POST",body:{items:[selected(source)]}});
		for(const verb of ["move","copy"]) assert.equal((await action(verb,[selected(file)])).status,404);
		assert.ok(MEDIA_OPERATION_LIMITS.copyBytes>0);
	});
});
