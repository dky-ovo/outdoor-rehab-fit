import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { MEDIA_LIMITS, mediaSignatureMatches, safeMediaUrl } from "../src/mediaLibrary.js";

const SECRET = "media-test-secret-not-used-in-production";
const {snapshotBefore,inspectInstall}=createRequire(import.meta.url)("../../scripts/verify-file-storage-install.cjs");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64");
const MP4 = Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(4),Buffer.from("isommp42"),Buffer.from([0,0,0,16]),Buffer.from("mdat"),Buffer.alloc(8)]);

function seedAccounts(database) {
	const now = new Date().toISOString(), tokens = {};
	for (const [index,[id,permissions,active]] of [
		["files",["app_maintenance.files.manage"],1], ["equipment",["app_maintenance.equipment.manage"],1],
		["home",["app_maintenance.home.manage"],1], ["locations",["app_maintenance.locations.manage"],1],
		["legacy",["app_maintenance.manage"],1], ["ordinary",null,1], ["inactive",["app_maintenance.files.manage"],0],
	].entries()) {
		database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','not-used','not-used',?,?)").run(id,id,`+8529555000${index}`,now,now);
		if (permissions) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,?,?,?)").run(id,JSON.stringify(permissions),active,now,now);
		tokens[id] = signToken({id,profile_role:"staff"},SECRET);
	}
	return tokens;
}

async function fixture(run, prepare = () => {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(),"outdoor-media-test-"));
	const database = createDatabase(":memory:"), tokens = seedAccounts(database);
	const equipmentUploadDir = path.join(root,"equipment-images"), mediaUploadDir = path.join(root,"media-library"), mediaSeedDir = path.join(root,"media-seed");
	fs.mkdirSync(equipmentUploadDir);
	await prepare({root,database,equipmentUploadDir,mediaUploadDir,mediaSeedDir});
	const options = {database,jwtSecret:SECRET,equipmentUploadDir,mediaUploadDir,mediaSeedDir};
	const app = createApp(options), server = app.listen(0,"127.0.0.1");
	await new Promise((resolve)=>server.once("listening",resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const request = (route,{actor="files",method="GET",body,headers={}}={}) => fetch(`${base}${route}`,{method,headers:{...(actor?{Authorization:`Bearer ${tokens[actor]}`} : {}),...(body && !Buffer.isBuffer(body) ? {"Content-Type":"application/json"}:{}),...headers},...(body === undefined ? {} : {body:Buffer.isBuffer(body) ? body : JSON.stringify(body)})});
	const upload = (bytes=MP4,mimeType="video/mp4",name="教学 video.mp4",actor="files",category="videos")=>request(`/api/admin/media/upload?name=${encodeURIComponent(name)}&categoryId=${category}`,{actor,method:"POST",body:bytes,headers:{"Content-Type":mimeType}});
	try { await run({root,database,tokens,base,request,upload,options,mediaUploadDir,equipmentUploadDir}); }
	finally {
		server.closeAllConnections();
		await new Promise((resolve)=>server.close(resolve)); database.close();
		const ownedRoot = path.resolve(root);
		assert.ok(ownedRoot.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(ownedRoot).startsWith("outdoor-media-test-"));
		fs.rmSync(ownedRoot,{recursive:true,force:true});
	}
}

test("file library rejects visitors, ordinary users, inactive admins and unrelated maintenance roles",async()=>{
	await fixture(async({request,upload,database})=>{
		for (const [actor,status] of [[null,401],["ordinary",403],["inactive",403],["locations",403]]) {
			assert.equal((await request("/api/admin/media",{actor})).status,status);
			assert.equal((await upload(MP4,"video/mp4","video.mp4",actor)).status,status);
		}
		for (const actor of ["files","equipment","home","legacy"]) assert.equal((await request("/api/admin/media",{actor})).status,200);
		for (const actor of ["equipment","home"]) {
			assert.equal((await upload(MP4,"video/mp4","video.mp4",actor)).status,201);
			assert.equal((await request("/api/admin/media/categories",{actor,method:"POST",body:{name:"No expanded permission"}})).status,403);
		}
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,2);
	});
});

test("raw media persists metadata/hash and provides unauthenticated HEAD, Range and immutable URLs",async()=>{
	await fixture(async({request,upload,base,database,mediaUploadDir})=>{
		const result = await upload(); assert.equal(result.status,201);
		const {item} = await result.json();
		assert.equal(item.kind,"video"); assert.equal(item.size,MP4.length); assert.equal(item.mimeType,"video/mp4");
		assert.equal(item.name,"教学 video.mp4"); assert.equal(item.selectable,true);
		const row=database.prepare("SELECT * FROM media_files WHERE id=?").get(item.id);
		assert.equal(row.sha256,crypto.createHash("sha256").update(MP4).digest("hex"));
		assert.deepEqual(fs.readFileSync(path.join(mediaUploadDir,row.storage_name)),MP4);
		const head=await fetch(base+item.url,{method:"HEAD"}); assert.equal(head.status,200); assert.equal(Number(head.headers.get("content-length")),MP4.length);
		assert.equal(head.headers.get("accept-ranges"),"bytes"); assert.equal(head.headers.get("x-content-type-options"),"nosniff");
		const range=await fetch(base+item.url,{headers:{Range:"bytes=8-15"}}); assert.equal(range.status,206);
		assert.equal(range.headers.get("content-range"),`bytes 8-15/${MP4.length}`); assert.deepEqual(Buffer.from(await range.arrayBuffer()),MP4.subarray(8,16));
		const invalid=await fetch(base+item.url,{headers:{Range:"bytes=900-999"}}); assert.equal(invalid.status,416);
		const rename=await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{name:"Renamed without moving file"}}); assert.equal(rename.status,200);
		assert.equal((await rename.json()).item.url,item.url);
		assert.equal((await fetch(base+item.url.replace(/\.mp4$/,".gif"))).status,404);
	});
});

test("media formats and magic signatures must agree; rejected streams leave no metadata or partial files",async()=>{
	await fixture(async({upload,database,mediaUploadDir})=>{
		for (const [bytes,mime,name] of [[Buffer.from("<html>fake</html>"),"video/mp4","x.mp4"],[PNG,"video/mp4","x.mp4"],[MP4,"image/png","x.png"],[MP4,"application/octet-stream","x.mp4"],[MP4,"video/mp4","x.exe"],[Buffer.alloc(0),"video/mp4","x.mp4"]]) {
			const response=await upload(bytes,mime,name); assert.ok([413,415].includes(response.status));
		}
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,0);
		assert.deepEqual(fs.existsSync(mediaUploadDir) ? fs.readdirSync(mediaUploadDir) : [],[]);
		assert.equal((await upload(PNG,"image/png","photo.png","equipment","facilities-images")).status,201);
		assert.equal((await upload(GIF,"image/gif","exercise.gif","equipment","facilities-gifs")).status,201);
	});
});

test("arbitrary documents are private authenticated attachments, never executable media",async()=>{
	await fixture(async({request,base,upload})=>{
		for(const [name,bytes,mime] of [["说明.html",Buffer.from("<script>alert(1)</script>"),"text/html"],["内容.json",Buffer.from('{"ok":true}'),"application/json"],["test.svg",Buffer.from('<svg onload="alert(1)"/>'),"image/svg+xml"],["empty.txt",Buffer.alloc(0),"text/plain"]]) {
			const response=await request(`/api/admin/media/upload?name=${encodeURIComponent(name)}&mimeType=${encodeURIComponent(mime)}`,{method:"POST",body:bytes,headers:{"Content-Type":"application/octet-stream"}});
			assert.equal(response.status,201);const {item}=await response.json();assert.equal(item.kind,"file");assert.equal(item.selectable,false);
			assert.equal((await fetch(base+item.url)).status,404);
			assert.equal((await request(`/api/admin/media-download/${item.id}`,{actor:null})).status,401);
			const download=await request(`/api/admin/media-download/${item.id}`);
			assert.equal(download.status,200);assert.equal(download.headers.get("content-type"),"application/octet-stream");assert.match(download.headers.get("content-disposition"),/^attachment;/);assert.equal(download.headers.get("cache-control"),"private, no-store");
			assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
		}
		assert.equal((await upload(Buffer.from("secret"),"text/plain","doc.txt","equipment","other")).status,403);
		assert.equal((await request("/api/admin/media/upload?name=bad.json",{method:"POST",body:{test:true}})).status,415);
	});
});

test("Chinese and English equipment video references both prevent deletion",async()=>{
	await fixture(async({request,upload,database})=>{
		for(const column of ["video_url_zh","video_url_en"]) {
			const {item}=await(await upload()).json();database.prepare(`UPDATE app_equipment_items SET ${column}=? WHERE id='0'`).run(item.url);
			assert.equal((await request("/api/admin/media/delete",{method:"POST",body:{items:[{id:item.id,kind:"file"}]}})).status,409);
			assert.equal((await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{archived:true}})).status,409);
			database.prepare(`UPDATE app_equipment_items SET ${column}='' WHERE id='0'`).run();
		}
	});
});

test("folder tree, empty directories and combined pagination retain names without path traversal or overwrites",async()=>{
	await fixture(async({request,database})=>{
		const first=await request("/api/admin/media/folders",{method:"POST",body:{name:"中文视频"}});assert.equal(first.status,201);const parent=(await first.json()).folder;
		const duplicate=await request("/api/admin/media/folders",{method:"POST",body:{name:"中文视频"}});assert.equal((await duplicate.json()).folder.id,parent.id);
		const nested=(await (await request("/api/admin/media/folders",{method:"POST",body:{name:"空目录",parentId:parent.id}})).json()).folder;
		for(const name of ["../secret","a/b","a\\b","..","."," name "]) assert.equal((await request("/api/admin/media/folders",{method:"POST",body:{name}})).status,400);
		for(let i=0;i<2;i++) assert.equal((await request(`/api/admin/media/upload?name=same.mp4&mimeType=video%2Fmp4&folderId=${parent.id}`,{method:"POST",body:MP4,headers:{"Content-Type":"application/octet-stream"}})).status,201);
		const rows=database.prepare("SELECT * FROM media_files").all();assert.equal(rows.length,2);assert.notEqual(rows[0].storage_name,rows[1].storage_name);
		const firstPage=await(await request(`/api/admin/media?folderId=${parent.id}&limit=1&page=1`)).json();assert.equal(firstPage.total,3);assert.equal(firstPage.items[0].id,nested.id);
		const secondPage=await(await request(`/api/admin/media?folderId=${parent.id}&limit=1&page=2`)).json();assert.equal(secondPage.items[0].kind,"video");assert.equal(secondPage.trail[0].name,"中文视频");
		assert.equal((await request("/api/admin/media/folders",{actor:"equipment",method:"POST",body:{name:"not allowed"}})).status,403);
	});
});

test("batch delete blocks all when any descendant is referenced and recycle restore preserves previous deletions",async()=>{
	await fixture(async({request,base,database})=>{
		const folder=(await(await request("/api/admin/media/folders",{method:"POST",body:{name:"测试"}})).json()).folder;
		const makeFile=async name=>(await(await request(`/api/admin/media/upload?name=${name}.mp4&mimeType=video%2Fmp4&folderId=${folder.id}`,{method:"POST",body:MP4,headers:{"Content-Type":"application/octet-stream"}})).json()).item;
		const a=await makeFile("a"), b=await makeFile("b"), c=await makeFile("c");
		database.prepare("UPDATE app_equipment_items SET video_url=? WHERE id='0'").run(a.url);
		const remove=()=>request("/api/admin/media/delete",{method:"POST",body:{items:[{id:folder.id,kind:"folder"}]}});
		assert.equal((await remove()).status,409);assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files WHERE deleted_at IS NOT NULL").get().n,0);
		database.prepare("UPDATE app_equipment_items SET video_url='' WHERE id='0'").run();
		assert.equal((await request("/api/admin/media/delete",{method:"POST",body:{items:[{id:c.id,kind:"file"}]}})).status,200);
		// Make the older deletion distinct from the folder's deletion transaction.
		database.prepare("UPDATE media_files SET deleted_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(c.id);
		assert.equal((await remove()).status,200);assert.equal((await fetch(base+a.url)).status,404);
		assert.equal((await request("/api/admin/media/restore",{method:"POST",body:{id:b.id,kind:"file"}})).status,409);
		assert.equal((await request("/api/admin/media/restore",{method:"POST",body:{id:folder.id,kind:"folder"}})).status,200);
		assert.equal((await fetch(base+a.url)).status,200);assert.equal((await fetch(base+c.url)).status,404);
		assert.equal((await request("/api/admin/media/delete",{actor:"equipment",method:"POST",body:{items:[{id:a.id,kind:"file"}]}})).status,403);
	});
});

test("declared oversized upload is rejected before reading bytes and unknown categories are rejected",async()=>{
	await fixture(async({base,tokens,upload,database})=>{
		const status=await new Promise((resolve,reject)=>{
			const req=http.request(base+"/api/admin/media/upload?name=large.mp4",{method:"POST",headers:{Authorization:`Bearer ${tokens.files}`,"Content-Type":"video/mp4","Content-Length":MEDIA_LIMITS.videoBytes+1}},res=>{res.resume();resolve(res.statusCode);});
			req.on("error",reject); req.end();
		});
		assert.equal(status,413);
		assert.equal((await upload(MP4,"video/mp4","x.mp4","files","nonexistent")).status,400);
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,0);
	});
});

test("classified search/GIF filtering and pagination are applied before LIMIT; category names are unique",async()=>{
	await fixture(async({request,upload})=>{
		const create=await request("/api/admin/media/categories",{method:"POST",body:{name:"研究公开教学"}}); assert.equal(create.status,201);
		const {category}=await create.json();
		await upload(MP4,"video/mp4","片段一.mp4","files",category.id);
		await upload(MP4,"video/mp4","片段二.mp4","files",category.id);
		await upload(GIF,"image/gif","拉伸.gif","files","facilities-gifs");
		const list=await (await request(`/api/admin/media?categoryId=${category.id}&search=${encodeURIComponent("片段")}&limit=1&page=2`)).json();
		assert.equal(list.total,2); assert.equal(list.items.length,1); assert.equal(list.page,2); assert.equal(list.limits.videoBytes,MEDIA_LIMITS.videoBytes);
		const gifs=await (await request("/api/admin/media?kind=gif&limit=1")).json(); assert.equal(gifs.total,1); assert.equal(gifs.items[0].mimeType,"image/gif");
		assert.equal((await request("/api/admin/media/categories",{method:"POST",body:{name:category.name}})).status,409);
		assert.equal((await request(`/api/admin/media/categories/${category.id}`,{method:"PATCH",body:{name:"已重命名"}})).status,200);
	});
});

test("in-use media cannot be archived; archives keep immutable URLs and cannot be newly selected",async()=>{
	await fixture(async({request,upload,base})=>{
		const {item}=await (await upload()).json();
		const create=await request("/api/admin/content",{actor:"home",method:"POST",body:{pageKey:"home",contentType:"video",title:"上传视频",value:item.url}}); assert.equal(create.status,201);
		const content=await create.json();
		assert.equal((await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{archived:true}})).status,409);
		assert.equal((await request(`/api/admin/content/${content.id}`,{actor:"home",method:"DELETE"})).status,200);
		assert.equal((await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{archived:true}})).status,200);
		assert.equal((await (await request("/api/admin/media")).json()).items.length,0);
		assert.equal((await (await request("/api/admin/media?archived=true")).json()).items[0].selectable,false);
		assert.equal((await fetch(base+item.url)).status,200);
		assert.equal((await request("/api/admin/content",{actor:"home",method:"POST",body:{pageKey:"home",contentType:"video",title:"Cannot select archive",value:item.url}})).status,400);
	});
});

test("equipment videoUrl persists through edits alongside legacy youtubeKey and rejects image-as-video URLs",async()=>{
	await fixture(async({request,upload})=>{
		const {item}=await (await upload()).json();
		const created=await request("/api/admin/equipment",{actor:"equipment",method:"POST",body:{nameZh:"测试设施",youtubeKey:"abcdefghijk",videoUrl:item.url}}); assert.equal(created.status,201);
		const equipment=(await created.json()).item; assert.equal(equipment.videoUrl,item.url); assert.equal(equipment.youtubeKey,"abcdefghijk");
		const changed=await request(`/api/admin/equipment/${equipment.id}`,{actor:"equipment",method:"PUT",body:{nameZh:"改名"}}); assert.equal(changed.status,200);
		assert.equal((await changed.json()).item.videoUrl,item.url);
		const catalog=await (await request("/api/equipment-catalog",{actor:null})).json(); assert.equal(catalog.items.find(row=>row.id===equipment.id).videoUrl,item.url);
		assert.equal((await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{archived:true}})).status,409);
		const photo=(await (await upload(GIF,"image/gif","x.gif","files","facilities-gifs")).json()).item;
		assert.equal((await request(`/api/admin/equipment/${equipment.id}`,{actor:"equipment",method:"PUT",body:{videoUrl:photo.url}})).status,400);
		assert.equal((await request(`/api/admin/equipment/${equipment.id}`,{actor:"equipment",method:"PUT",body:{videoUrl:"https://www.youtube.com/watch?v=abcdefghijk"}})).status,400);
	});
});

test("only existing public images and explicit public content references are indexed, never private data",async()=>{
	await fixture(async({request,database,base})=>{
		const list=await (await request("/api/admin/media")).json();
		assert.equal(list.items.length,4);
		assert.ok(list.items.some(item=>item.url==="/api/equipment-images/public.gif"));
		assert.ok(list.items.some(item=>item.url==="https://assets.example.org/facility.png"));
		assert.equal(list.items.find(item=>item.source==="youtube").selectable,false);
		assert.ok(!JSON.stringify(list).includes("private-avatar")); assert.ok(!JSON.stringify(list).includes("secret-token"));
		assert.equal(database.prepare("SELECT avatar_data FROM users WHERE id='ordinary'").get().avatar_data,"https://assets.example.org/private-avatar.jpg");
		assert.equal((await fetch(base+"/api/equipment-images/secret.env")).status,404);
		assert.equal((await fetch(base+"/api/equipment-images/public.gif")).status,200);
		assert.equal((await fetch(base+"/api/equipment-images/")).status,404);
	},({root,database,equipmentUploadDir})=>{
		fs.writeFileSync(path.join(equipmentUploadDir,"public.gif"),GIF);
		fs.writeFileSync(path.join(equipmentUploadDir,"spoof.png"),"not an image");
		fs.writeFileSync(path.join(equipmentUploadDir,"secret.env"),"API_KEY=secret-token");
		fs.mkdirSync(path.join(root,"avatars")); fs.writeFileSync(path.join(root,"avatars","private-avatar.png"),PNG);
		database.prepare("UPDATE users SET avatar_data=? WHERE id='ordinary'").run("https://assets.example.org/private-avatar.jpg");
		database.prepare("UPDATE app_equipment_items SET image_url=?,gif_left_url=?,video_url=?,youtube_key=? WHERE id='0'").run("https://assets.example.org/facility.png","https://assets.example.org/private.gif?token=secret-token","https://assets.example.org/training.mp4","https://www.youtube.com/watch?v=abcdefghijk");
	});
});

test("seed import validates hashes and paths, is idempotent, and preserves administrator names/categories",async()=>{
	await fixture(async({request,database,options,mediaUploadDir})=>{
		const list=await (await request("/api/admin/media")).json(); assert.equal(list.total,1);
		const item=list.items[0]; assert.equal(item.name,"太极动作 GIF");
		await request(`/api/admin/media/${item.id}`,{method:"PATCH",body:{name:"用户改名",categoryId:"other"}});
		createApp(options);
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,1);
		const row=database.prepare("SELECT * FROM media_files WHERE id=?").get(item.id); assert.equal(row.name,"用户改名"); assert.equal(row.category_id,"other");
		assert.equal(fs.readdirSync(mediaUploadDir).length,1);
	},({mediaSeedDir})=>{
		fs.mkdirSync(path.join(mediaSeedDir,"files"),{recursive:true});
		fs.writeFileSync(path.join(mediaSeedDir,"files","taichi.gif"),GIF);
		fs.writeFileSync(path.join(mediaSeedDir,"manifest.json"),JSON.stringify({items:[
			{fileName:"taichi.gif",name:"太极动作 GIF",mimeType:"image/gif",categoryName:"设施 GIF",sha256:crypto.createHash("sha256").update(GIF).digest("hex")},
			{fileName:"../../secret.png",name:"Do not traverse",mimeType:"image/png",sha256:"f".repeat(64)},
			{fileName:"taichi.gif",name:"Wrong hash",mimeType:"image/gif",sha256:"f".repeat(64)},
		]}));
	});
});

test("media URL validation rejects local/private/network credentials and magic signatures reject arbitrary documents",()=>{
	for (const value of ["file:///etc/passwd","/api/equipment-images/../secret","https://example.org/a.mp4?api_key=secret","https://user:secret@example.org/x.mp4","https://127.0.0.1/x.mp4","https://10.0.0.1/x.mp4","https://[::1]/x.mp4","https://example.org/a\\b.mp4","javascript:alert(1)"]) assert.equal(safeMediaUrl(value),false,value);
	assert.equal(safeMediaUrl("https://cdn.example.org/movie.mp4"),true);
	assert.equal(mediaSignatureMatches(MP4,"video/mp4"),true);
	assert.equal(mediaSignatureMatches(PNG,"image/png"),true);
	assert.equal(mediaSignatureMatches(GIF,"image/gif"),true);
	assert.equal(mediaSignatureMatches(Buffer.from("<svg></svg>"),"image/png"),false);
});

test("streamed uploads without Content-Length enforce actual limits and remove partial files",async()=>{
	await fixture(async({base,tokens,database,mediaUploadDir})=>{
		const status=await new Promise((resolve,reject)=>{
			const req=http.request(base+"/api/admin/media/upload?name=too-large.gif",{method:"POST",headers:{Authorization:`Bearer ${tokens.files}`,"Content-Type":"image/gif","Transfer-Encoding":"chunked"}},res=>{res.resume();resolve(res.statusCode);});
			req.on("error",reject);
			req.write(GIF); req.end(Buffer.alloc(MEDIA_LIMITS.imageBytes));
		});
		assert.equal(status,413);
		await new Promise(resolve=>setTimeout(resolve,30));
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,0);
		assert.deepEqual(fs.readdirSync(mediaUploadDir),[]);
	});
});

test("cancelled upload removes incomplete disk files and never publishes a media row",async()=>{
	await fixture(async({base,tokens,database,mediaUploadDir})=>{
		const req=http.request(base+"/api/admin/media/upload?name=cancelled.mp4",{method:"POST",headers:{Authorization:`Bearer ${tokens.files}`,"Content-Type":"video/mp4","Transfer-Encoding":"chunked"}});
		req.on("error",()=>{}); req.write(MP4);
		for(let attempt=0;attempt<100;attempt++) {
			if(fs.existsSync(mediaUploadDir) && fs.readdirSync(mediaUploadDir).some(name=>name.endsWith(".partial"))) break;
			await new Promise(resolve=>setTimeout(resolve,10));
		}
		assert.ok(fs.existsSync(mediaUploadDir) && fs.readdirSync(mediaUploadDir).some(name=>name.endsWith(".partial")));
		req.destroy();
		for(let attempt=0;attempt<100 && fs.readdirSync(mediaUploadDir).length;attempt++) await new Promise(resolve=>setTimeout(resolve,10));
		assert.deepEqual(fs.readdirSync(mediaUploadDir),[]);
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,0);
	});
});

test("folder deleted while upload awaits rename cannot receive or publicly expose an orphan",async()=>{
	await fixture(async({request,upload,mediaUploadDir,database})=>{
		const survivor=(await(await upload()).json()).item;
		const survivorName=database.prepare("SELECT storage_name FROM media_files WHERE id=?").get(survivor.id).storage_name;
		const folder=(await(await request("/api/admin/media/folders",{method:"POST",body:{name:"Deleted during upload"}})).json()).folder;
		const originalRename=fs.promises.rename;
		let releaseRename, signalEntered;
		const entered=new Promise(resolve=>{signalEntered=resolve;});
		const released=new Promise(resolve=>{releaseRename=resolve;});
		fs.promises.rename=async(source,destination)=>{if(path.dirname(source)===mediaUploadDir) {signalEntered();await released;} return originalRename(source,destination);};
		let uploading;
		try {
			uploading=request(`/api/admin/media/upload?name=race.mp4&mimeType=video%2Fmp4&folderId=${folder.id}`,{method:"POST",body:MP4,headers:{"Content-Type":"application/octet-stream"}});
			await entered;
			assert.equal((await request("/api/admin/media/delete",{method:"POST",body:{items:[{id:folder.id,kind:"folder"}]}})).status,200);
			releaseRename();
			const response=await uploading;assert.equal(response.status,409);assert.equal((await response.json()).error,"mediaFolderNotFound");
			for(let attempt=0;attempt<100&&fs.readdirSync(mediaUploadDir).length>1;attempt++) await new Promise(resolve=>setTimeout(resolve,5));
			assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files").get().n,1);assert.deepEqual(fs.readdirSync(mediaUploadDir),[survivorName]);
			assert.deepEqual(fs.readFileSync(path.join(mediaUploadDir,survivorName)),MP4);
		} finally {releaseRename();fs.promises.rename=originalRename;if(uploading) await uploading.catch(()=>{});}
	});
});

test("real bundled public-media seed imports completely, is stable on restart, and preserves categories",{skip:!process.env.OUTDOOR_MEDIA_SEED_TEST_DIR},async()=>{
	await fixture(async({options,database,mediaUploadDir})=>{
		const mediaSeedDir=path.resolve(process.env.OUTDOOR_MEDIA_SEED_TEST_DIR);
		const manifest=JSON.parse(fs.readFileSync(path.join(mediaSeedDir,"manifest.json"),"utf8"));
		const expected=new Set(manifest.items.map(item=>item.sha256)).size;
		createApp({...options,mediaSeedDir});
		const rows=database.prepare("SELECT * FROM media_files ORDER BY id").all();
		assert.equal(rows.length,expected);
		assert.equal(fs.readdirSync(mediaUploadDir).length,expected);
		for (const row of rows) assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(mediaUploadDir,row.storage_name))).digest("hex"),row.sha256);
		database.prepare("UPDATE media_files SET name='保留用户更改',category_id='other' WHERE id=?").run(rows[0].id);
		createApp({...options,mediaSeedDir});
		assert.equal(database.prepare("SELECT COUNT(*) AS n FROM media_files").get().n,expected);
		assert.equal(database.prepare("SELECT name FROM media_files WHERE id=?").get(rows[0].id).name,"保留用户更改");
		const totals=database.prepare("SELECT mime_type AS mimeType,COUNT(*) AS count,SUM(size_bytes) AS size FROM media_files GROUP BY mime_type").all();
		console.log("Verified public media seed",JSON.stringify({manifestReferences:manifest.items.length,uniqueFiles:expected,totals}));
	});
});

test("v2 seed imports videos and private documents in folders once, preserving later admin edits and deletion",async()=>{
	await fixture(async({request,database,options,base})=>{
		const rows=database.prepare("SELECT * FROM media_files ORDER BY name").all();assert.equal(rows.length,3);
		const video=rows.find(row=>row.name==="01 中文.mp4"), document=rows.find(row=>row.kind==="file");
		assert.ok(video.folder_id);assert.ok(document.storage_name.endsWith(".bin"));assert.equal((await fetch(base+document.url)).status,404);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM media_folders WHERE name='空目录'").get().n,1);
		await request(`/api/admin/media/${video.id}`,{method:"PATCH",body:{name:"保留管理员名称",categoryId:"other"}});
		await request("/api/admin/media/delete",{method:"POST",body:{items:[{id:document.id,kind:"file"}]}});
		createApp(options);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files").get().n,3);
		assert.equal(database.prepare("SELECT name FROM media_files WHERE id=?").get(video.id).name,"保留管理员名称");
		assert.ok(database.prepare("SELECT deleted_at FROM media_files WHERE id=?").get(document.id).deleted_at);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM media_seed_items").get().n,3);
	},({mediaSeedDir})=>{
		fs.mkdirSync(path.join(mediaSeedDir,"files"),{recursive:true});
		fs.writeFileSync(path.join(mediaSeedDir,"files","cn01.mp4"),MP4);fs.writeFileSync(path.join(mediaSeedDir,"files","en01.mp4"),MP4);fs.writeFileSync(path.join(mediaSeedDir,"files","codes.docx"),Buffer.from("word-fixture"));
		fs.writeFileSync(path.join(mediaSeedDir,"manifest.json"),JSON.stringify({version:2,importId:"education-test",folders:["Chinese/空目录"],items:[
			{fileName:"cn01.mp4",name:"01 中文.mp4",mimeType:"video/mp4",folderPath:"Chinese",sha256:crypto.createHash("sha256").update(MP4).digest("hex"),equipmentId:"0",locale:"zh"},
			{fileName:"en01.mp4",name:"01 English.mp4",mimeType:"video/mp4",folderPath:"English/old",sha256:crypto.createHash("sha256").update(MP4).digest("hex"),archived:true},
			{fileName:"codes.docx",name:"Exercise Machine Code 2026.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",sha256:crypto.createHash("sha256").update("word-fixture").digest("hex")},
		]}));
	});
});

test("old media CHECK migration retains every existing URL and hash without reindexing",async()=>{
	await fixture(async({root})=>{
		const file=path.join(root,"old.sqlite");let db=createDatabase(file);
		db.exec("DROP TABLE media_files; CREATE TABLE media_files (id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime_type TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('image','video')),size_bytes INTEGER,category_id TEXT NOT NULL,source TEXT NOT NULL,storage_name TEXT,sha256 TEXT,archived INTEGER NOT NULL DEFAULT 0,created_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
		db.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("original","/api/media/original/original.mp4","name","video/mp4","video",MP4.length,"videos","upload","original.mp4","hash","2020","2020");
		db.close();db=createDatabase(file);
		try {const row=db.prepare("SELECT * FROM media_files WHERE id='original'").get();assert.equal(row.url,"/api/media/original/original.mp4");assert.equal(row.sha256,"hash");assert.equal(row.folder_id,"");assert.equal(row.deleted_at,null);assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='media_files'").get().sql,/'file'/);}
		finally {db.close();}
	});
});

test("real education seed: all 57 originals import with correct hashes, public video HEAD/Range and private Word download",{skip:!process.env.OUTDOOR_EDUCATION_SEED_TEST_DIR},async()=>{
	const seedDir=path.resolve(process.env.OUTDOOR_EDUCATION_SEED_TEST_DIR);
	const manifest=JSON.parse(fs.readFileSync(path.join(seedDir,"manifest.json"),"utf8"));
	assert.equal(manifest.version,2);assert.equal(manifest.items.length,57);
	await fixture(async({database,request,base,mediaUploadDir,options})=>{
		const installerBefore=snapshotBefore(database);
		const seededApp=createApp({...options,mediaSeedDir:seedDir});
		assert.equal(seededApp.locals.educationVideoImport.status,"applied");
		assert.equal(seededApp.locals.educationVideoImport.facilities,27);assert.equal(seededApp.locals.educationVideoImport.videos,54);
		assert.deepEqual(seededApp.locals.educationVideoImport.missingCodesPreserved,["13","27"]);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM app_equipment_items WHERE video_url_zh!='' AND video_url_en!='' AND video_localized=1").get().n,27);
		const installationVerification=inspectInstall(database,manifest,mediaUploadDir,installerBefore);
		assert.equal(installationVerification.files,57);assert.equal(installationVerification.currentVideoBindings,54);assert.equal(installationVerification.schemaVerified,true);
		const rows=database.prepare("SELECT * FROM media_files WHERE source='upload' ORDER BY id").all();
		assert.equal(rows.length,57);assert.equal(rows.filter(row=>row.kind==="video").length,56);assert.equal(rows.filter(row=>row.archived).length,2);assert.equal(rows.filter(row=>row.kind==="file").length,1);
		let verifiedVideos=0,verifiedBytes=0;
		for(const item of manifest.items) {
			const ledger=database.prepare("SELECT file_id FROM media_seed_items WHERE import_id=? AND file_name=?").get(manifest.importId,item.fileName);
			assert.ok(ledger,item.fileName);const row=rows.find(row=>row.id===ledger.file_id);assert.ok(row,item.name);
			assert.equal(row.sha256,item.sha256);assert.equal(row.name,item.name);assert.equal(row.size_bytes,item.size);assert.equal(Boolean(row.archived),Boolean(item.archived || item.archiveOnly));
			const bytes=fs.readFileSync(path.join(mediaUploadDir,row.storage_name));assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),item.sha256);verifiedBytes+=bytes.length;
			const trail=[];let folderId=row.folder_id;
			while(folderId){const folder=database.prepare("SELECT * FROM media_folders WHERE id=?").get(folderId);trail.unshift(folder.name);folderId=folder.parent_id;}
			assert.equal(trail.join("/"),item.folderPath || "");
			if(row.kind==="video") {
				const head=await fetch(base+row.url,{method:"HEAD"});assert.equal(head.status,200);assert.equal(Number(head.headers.get("content-length")),bytes.length);assert.equal(head.headers.get("content-type"),"video/mp4");
				const range=await fetch(base+row.url,{headers:{Range:"bytes=0-1023"}});assert.equal(range.status,206);assert.equal(range.headers.get("content-range"),`bytes 0-1023/${bytes.length}`);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,1024));
				const full=await fetch(base+row.url);assert.equal(full.status,200);assert.equal(crypto.createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex"),item.sha256);
				verifiedVideos++;
			} else {
				assert.equal((await fetch(base+row.url)).status,404);
				assert.equal((await request(`/api/admin/media-download/${row.id}`,{actor:null})).status,401);
				assert.equal((await request(`/api/admin/media-download/${row.id}`,{actor:"equipment"})).status,403);
				const download=await request(`/api/admin/media-download/${row.id}`);assert.equal(download.status,200);assert.match(download.headers.get("content-disposition"),/^attachment;/);assert.equal(download.headers.get("content-type"),"application/octet-stream");assert.equal(crypto.createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"),item.sha256);
			}
		}
		const restartedApp=createApp({...options,mediaSeedDir:seedDir});assert.equal(restartedApp.locals.educationVideoImport.status,"already_applied");assert.equal(database.prepare("SELECT COUNT(*) n FROM media_files WHERE source='upload'").get().n,57);
		assert.equal(database.prepare("SELECT COUNT(*) n FROM app_equipment_items WHERE video_url_zh!='' AND video_url_en!='' AND video_localized=1").get().n,27);
		console.log("Education seed verified",JSON.stringify({files:rows.length,videoHeadRangeAndFullHash:verifiedVideos,archived:2,privateWord:1,bytes:verifiedBytes,folderHierarchyVerified:true,facilitiesBound:27,videosBound:54,restartStatus:restartedApp.locals.educationVideoImport.status,storage:"isolated temp and in-memory SQLite only"}));
	});
});
