import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPublicVideoDelivery, parsePublicVideoManifest, publicVideoCdnOrigin } from "../src/publicVideoDelivery.js";
import { createApp } from "../src/app.js";
import { createMysqlApp } from "../src/appMysql.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";

const SECRET = "synthetic-public-video-delivery-test-secret";
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const videoBytes = count => Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(4),Buffer.from("isommp42"),Buffer.from([0,0,0,16]),Buffer.from("mdat"),Buffer.alloc(count)]);

function files(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-video-delivery-"));
  const storageRoot = path.join(root, "media-library"), deliveryRoot = path.join(root, "video-delivery"), derivativeRoot = path.join(deliveryRoot, "derivatives");
  fs.mkdirSync(storageRoot); fs.mkdirSync(derivativeRoot, { recursive:true });
  const original = videoBytes(256), derivative = videoBytes(64), sourceStorageName = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4";
  const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", url: `/api/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${sourceStorageName}`, kind:"video", mime_type:"video/mp4", source:"upload", storage_name:sourceStorageName, sha256:digest(original), size_bytes:original.length, archived:0, deleted_at:null, name:"Public teaching original.mp4", category_id:"videos", folder_id:"" };
  // Synthetic bytes exercise deployment/HTTP guards; these QA flags simulate a
  // reviewed deployment and do not claim the fixture is a decodable teaching clip.
  const entry = { sourceSha256:row.sha256, sourceSizeBytes:original.length, derivativeSha256:digest(derivative), derivativeStorageName:`${digest(derivative)}.mp4`, derivativeSizeBytes:derivative.length, fullDecodePassed:true, visualReviewPassed:true, fastStart:true, videoCodec:"h264", audioCodec:"aac", sourcePlaybackDurationSeconds:20, durationSeconds:20, durationDifferenceSeconds:0, totalBitrateMbps:1.2 };
  fs.writeFileSync(path.join(storageRoot, sourceStorageName), original); fs.writeFileSync(path.join(derivativeRoot, entry.derivativeStorageName), derivative);
  const manifestPath = path.join(deliveryRoot, "manifest.json");
  const writeManifest = entries => fs.writeFileSync(manifestPath, JSON.stringify({ version:1, complete:true, entries }));
  writeManifest([entry]);
  const create = extra => createPublicVideoDelivery({ storageRoot, derivativeRoot, manifestPath, ...extra });
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, {recursive:true,force:true}); });
  return { root, storageRoot, deliveryRoot, derivativeRoot, manifestPath, original, derivative, row, entry, writeManifest, create };
}

test("verified rendition uses a content URL while identity and original bytes remain unchanged", t => {
  const f=files(t), delivery=f.create({cdnOrigin:"https://video.outdoorfit.hk"}), expected=`https://video.outdoorfit.hk/api/media/${f.row.id}/${f.entry.derivativeStorageName}`;
  assert.equal(delivery.enabled,true); assert.equal(delivery.publicUrl(f.row),expected);
  const mapped=delivery.mapEquipment({id:"0",videoUrl:f.row.url,videoUrlZh:f.row.url,videoUrlEn:"",additionalVideos:[{id:"extra",videoUrlZh:f.row.url,videoUrlEn:""}]},new Map([[f.row.id,f.row]]));
  assert.equal(mapped.id,"0"); assert.equal(mapped.videoUrl,f.row.url); assert.equal(mapped.videoPlaybackUrl,expected); assert.equal(mapped.videoIdentityUrl,f.row.url);
  assert.equal(mapped.videoIdentityDurationSeconds,20);
  assert.equal(mapped.additionalVideos[0].id,"extra"); assert.equal(mapped.additionalVideos[0].videoIdentityUrlZh,f.row.url);
  assert.equal(mapped.additionalVideos[0].videoUrlZh,f.row.url); assert.equal(mapped.additionalVideos[0].videoPlaybackUrlZh,expected);
  assert.equal(delivery.mapContent({id:"home-1",contentType:"video",value:f.row.url},new Map([[f.row.id,f.row]])).valueIdentity,f.row.url);
  assert.deepEqual(fs.readFileSync(path.join(f.storageRoot,f.row.storage_name)),f.original);
  for (const change of [{kind:"file"},{source:"external"},{deleted_at:"2026-10-03"},{archived:1},{id:"different"},{sha256:"0".repeat(64)},{storage_name:"../private.mp4"}]) assert.equal(delivery.rendition({...f.row,...change}),null);
  assert.ok(delivery.rendition({...f.row,archived:"0",size_bytes:String(f.original.length)}));
});

test("changed source or rendition fails back without publishing stale optimized bytes", t => {
  const f=files(t), delivery=f.create(); assert.ok(delivery.rendition(f.row));
  fs.writeFileSync(path.join(f.storageRoot,f.row.storage_name),Buffer.alloc(f.original.length,3));
  assert.equal(delivery.publicUrl(f.row),f.row.url);
  // A restart also rehashes and rejects mismatching source bytes.
  assert.equal(f.create().rendition(f.row),null);
  fs.writeFileSync(path.join(f.storageRoot,f.row.storage_name),f.original);
  const restarted=f.create(); assert.ok(restarted.rendition(f.row));
  fs.writeFileSync(path.join(f.derivativeRoot,f.entry.derivativeStorageName),Buffer.alloc(f.derivative.length,4));
  assert.equal(restarted.rendition(f.row),null); assert.equal(f.create().enabled,false);
});

test("unsafe, ambiguous or incomplete deployment entries are not activated", t => {
  const f=files(t);
  for (const change of [{sourceStorageName:"../private.mp4"},{derivativeStorageName:"../private.mp4"},{fullDecodePassed:false},{visualReviewPassed:false},{sourcePlaybackDurationSeconds:undefined},{fastStart:false},{durationDifferenceSeconds:0.2},{totalBitrateMbps:10},{derivativeSizeBytes:f.original.length},{audioCodec:"mp3"}]) {
    f.writeManifest([{...f.entry,...change}]); assert.equal(f.create().enabled,false);
  }
  assert.deepEqual(parsePublicVideoManifest({version:1,complete:true,entries:[f.entry,{...f.entry}]}),[]);
  assert.deepEqual(parsePublicVideoManifest({version:1,complete:false,entries:[f.entry]}),[]);
  f.writeManifest([{...f.entry,sourceStorageName:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4"}]);
  assert.equal(f.create().rendition(f.row),null);
  fs.writeFileSync(f.manifestPath,"not json"); assert.equal(f.create().publicUrl(f.row),f.row.url);
});

test("warmed playback requests use stat fingerprints without rehashing full media", t => {
  const f=files(t), delivery=f.create(); assert.ok(delivery.rendition(f.row));
  const originalRead=fs.readSync; let reads=0;
  fs.readSync=(...args)=>{reads++;return originalRead(...args);};
  try { for(let i=0;i<50;i++) assert.ok(delivery.rendition(f.row)); assert.equal(reads,0); }
  finally { fs.readSync=originalRead; }
});

test("symlinked derivative directories fail closed before serving any bytes", t => {
  const f=files(t), realRoot=f.derivativeRoot+"-real";
  fs.renameSync(f.derivativeRoot,realRoot);
  try { fs.symlinkSync(realRoot,f.derivativeRoot,process.platform==="win32"?"junction":"dir"); }
  catch(error) { if(["EPERM","EACCES","ENOTSUP"].includes(error.code)){t.skip("OS cannot create test symlinks");return;}throw error; }
  assert.equal(f.create().enabled,false);
});

test("CDN accepts only an explicit HTTPS public DNS origin", () => {
  assert.equal(publicVideoCdnOrigin(),""); assert.equal(publicVideoCdnOrigin("https://video.outdoorfit.hk/"),"https://video.outdoorfit.hk");
  for (const value of ["http://video.outdoorfit.hk","https://u:p@video.outdoorfit.hk","https://video.outdoorfit.hk/private","https://video.outdoorfit.hk/?token=x","https://127.0.0.1","https://localhost","https://host.local","https://10.0.0.1","https://[::1]","https://video.outdoorfit.hk:444"]) assert.throws(()=>publicVideoCdnOrigin(value),/INVALID_PUBLIC_VIDEO_CDN_ORIGIN/);
});

async function httpFixture(t, mysql=false, cdnOrigin="") {
  const f=files(t), equipment={id:"0", name_zh:"Fixture",name_en:"Fixture",categories_json:"[]",video_url:f.row.url,video_url_zh:f.row.url,video_url_en:"",additional_videos_json:"[]",teaching_sections_json:"[]",is_active:1,video_localized:1}, content={id:"video-content",pageKey:"home",contentType:"video",title:"Fixture",value:f.row.url,sortOrder:0};
  let deleted=false, app, database;
  const options={jwtSecret:SECRET,equipmentUploadDir:path.join(f.root,"equipment-images"),mediaUploadDir:f.storageRoot,mediaSeedDir:null,mediaVideoDeliveryRoot:f.deliveryRoot,mediaVideoDeliveryManifest:f.manifestPath,mediaVideoCdnOrigin:cdnOrigin};
  fs.mkdirSync(options.equipmentUploadDir);
  if (mysql) {
    database={dialect:"mysql",async get(sql,params){ if(sql.includes("FROM media_files"))return params?.[0]===f.row.id?{...f.row,deleted_at:deleted?"2026-10-03":null}:undefined; return {total:0,ready:1}; },async all(sql){if(sql.includes("FROM app_equipment_items"))return[equipment];if(sql.includes("FROM media_files"))return deleted?[]:[f.row];if(sql.includes("FROM content_items")&&sql.includes("page_key AS"))return[content];return[];},async run(){return{affectedRows:0,insertId:0,warningStatus:0};},async transaction(callback){return callback(database);}};
    app=await createMysqlApp({database,...options});
  } else {
    database=createDatabase(":memory:");
    const now=new Date().toISOString();
    database.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(f.row.id,f.row.url,f.row.name,f.row.mime_type,f.row.kind,f.row.size_bytes,f.row.category_id,f.row.source,f.row.storage_name,f.row.sha256,now,now);
    database.prepare("UPDATE app_equipment_items SET video_url=?,video_url_zh=?,video_localized=1 WHERE id='0'").run(f.row.url,f.row.url);
    database.prepare("INSERT INTO content_items(id,page_key,content_type,title,value,sort_order,is_active,created_at,updated_at) VALUES(?,'home','video','Fixture',?,0,1,?,?)").run(content.id,content.value,now,now);
    database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES('files','files','+85279990001','staff','not-used','not-used',?,?)").run(now,now);
    database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES('files','operator','[\"app_maintenance.files.manage\"]',1,?,?)").run(now,now);
    app=createApp({database,...options});
  }
  const server=app.listen(0,"127.0.0.1"); await new Promise(resolve=>server.once("listening",resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.locals.imageRetirement?.stop();database.close?.();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const remove=()=>{deleted=true;if(!mysql)database.prepare("UPDATE media_files SET deleted_at='2026-10-03' WHERE id=?").run(f.row.id);};
  const changeVisibility=(kind,archived)=>{f.row.kind=kind;f.row.archived=archived;if(!mysql)database.prepare("UPDATE media_files SET kind=?,archived=? WHERE id=?").run(kind,archived,f.row.id);};
  return {...f,base,remove,changeVisibility,token:signToken({id:"files",profile_role:"staff"},SECRET)};
}

for (const mysql of [false,true]) test(`${mysql?"MySQL":"SQLite"} public playback and catalogue preserve identity, ranges and deletion guards`,async t=>{
  const f=await httpFixture(t,mysql), localUrl=`/api/media/${f.row.id}/${f.entry.derivativeStorageName}`;
  const original=await fetch(f.base+f.row.url,{redirect:"manual"}); assert.equal(original.status,200); assert.equal(original.headers.get("location"),null); assert.deepEqual(Buffer.from(await original.arrayBuffer()),f.original);
  const originalHead=await fetch(f.base+f.row.url,{method:"HEAD"}); assert.equal(originalHead.headers.get("content-length"),String(f.original.length));
  const playback=await fetch(f.base+localUrl,{headers:{Range:"bytes=0-23"}}); assert.equal(playback.status,206); assert.equal(playback.headers.get("content-range"),`bytes 0-23/${f.derivative.length}`); assert.deepEqual(Buffer.from(await playback.arrayBuffer()),f.derivative.subarray(0,24));
  assert.match(playback.headers.get("cache-control"),/max-age=3600/); assert.equal(playback.headers.get("content-type"),"video/mp4");
  const head=await fetch(f.base+localUrl,{method:"HEAD"});assert.equal(head.status,200);assert.equal(head.headers.get("content-length"),String(f.derivative.length));
  const rangeError=await fetch(f.base+localUrl,{headers:{Range:"bytes=9999-10000"}});assert.equal(rangeError.status,416);assert.equal(rangeError.headers.get("content-range"),`bytes */${f.derivative.length}`);
  const catalog=await(await fetch(f.base+"/api/equipment-catalog")).json(), item=catalog.items.find(item=>item.id==="0");assert.equal(item.videoUrl,f.row.url);assert.equal(item.videoPlaybackUrl,localUrl);assert.equal(item.videoIdentityUrl,f.row.url);
  const content=await(await fetch(f.base+"/api/content?pageKey=home")).json();assert.equal(content.items.find(item=>item.id==="video-content").value,f.row.url);assert.equal(content.items.find(item=>item.id==="video-content").playbackValue,localUrl);
  assert.equal((await fetch(f.base+`/api/admin/media-download/${f.row.id}`)).status,401);
  if(!mysql){const download=await fetch(f.base+`/api/admin/media-download/${f.row.id}`,{headers:{Authorization:`Bearer ${f.token}`}});assert.equal(download.status,200);assert.equal(download.headers.get("cache-control"),"private, no-store");assert.deepEqual(Buffer.from(await download.arrayBuffer()),f.original);}
  f.changeVisibility("video",1);assert.equal((await fetch(f.base+localUrl)).status,404);assert.equal((await fetch(f.base+f.row.url)).status,200);
  f.changeVisibility("file",0);assert.equal((await fetch(f.base+localUrl)).status,404);assert.equal((await fetch(f.base+f.row.url)).status,404);
  f.changeVisibility("video",0);assert.equal((await fetch(f.base+localUrl)).status,200);
  f.remove();assert.equal((await fetch(f.base+localUrl)).status,404);assert.equal((await fetch(f.base+f.row.url)).status,404);
});

test("configured CDN is additive while legacy public URLs keep original bytes",async t=>{
  const f=await httpFixture(t,true,"https://video.outdoorfit.hk"), localUrl=`/api/media/${f.row.id}/${f.entry.derivativeStorageName}`;
  const original=await fetch(f.base+f.row.url,{redirect:"manual"});assert.equal(original.status,200);assert.equal(original.headers.get("location"),null);assert.deepEqual(Buffer.from(await original.arrayBuffer()),f.original);
  const catalog=await(await fetch(f.base+"/api/equipment-catalog")).json();assert.equal(catalog.items[0].videoUrl,f.row.url);assert.equal(catalog.items[0].videoPlaybackUrl,"https://video.outdoorfit.hk"+localUrl);
  const origin=await fetch(f.base+localUrl,{redirect:"manual"});assert.equal(origin.status,200);assert.equal(origin.headers.get("location"),null);
});
