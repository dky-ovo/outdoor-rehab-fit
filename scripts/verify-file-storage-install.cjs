const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const IMPORT_ID='education-videos-20260910';
const API_ROOT='/home/dukaiyu2004/outdoor-fit-api';
const EXPECTED_MANIFEST_SHA='8340866ae6e02ad1e6f1ee81a46966d84a9311aa5d8562a63fcca078f0a7ef39';
// These are explicit app IDs from the reviewed code table, not code minus one.
const MISSING_IDS=['15','28'];

function snapshotBefore(database) {
  const table=database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_seed_video_bindings'").get();
  const alreadyApplied=Boolean(table && database.prepare('SELECT 1 FROM media_seed_video_bindings WHERE import_id=?').get(IMPORT_ID));
  const missing=MISSING_IDS.map(id=>{
    const row=database.prepare('SELECT * FROM app_equipment_items WHERE id=?').get(id);
    return {id,exists:Boolean(row),videoUrl:row?.video_url || '',videoUrlZh:row?.video_url_zh || '',videoUrlEn:row?.video_url_en || '',videoLocalized:row?.video_localized || 0,youtubeKey:row?.youtube_key || ''};
  });
  return {alreadyApplied,missing};
}
function hashFile(file) {
  const stat=fs.lstatSync(file);if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('Media file is missing or linked');
  const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
  try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
  return hash.digest('hex');
}
function inspectInstall(database,manifest,mediaRoot,before) {
  if(manifest.importId!==IMPORT_ID || manifest.items?.length!==57) throw new Error('Unexpected education manifest');
  for(const [table,columns] of [['media_files',['folder_id','deleted_at']],['media_folders',['parent_id','deleted_at']],['media_seed_items',['import_id','file_name','file_id']],['media_seed_video_bindings',['import_id','bindings_json','before_json']],['registration_codes',['code_hash','phone','profile_role','used_at','revoked_at']],['app_equipment_items',['video_url_zh','video_url_en','video_localized']]]) {
    const available=new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
    if(columns.some(column=>!available.has(column))) throw new Error(`Required schema not installed: ${table}`);
  }
  const record=database.prepare('SELECT * FROM media_seed_video_bindings WHERE import_id=?').get(IMPORT_ID);
  if(!record?.applied_at) throw new Error('Education video binding was not applied');
  const bindings=JSON.parse(record.bindings_json);
  if(bindings.length!==54) throw new Error('Expected 54 reviewed video bindings');
  let files=0,videos=0,documents=0,archived=0,currentBindings=0,preservedChanges=0;
  for(const item of manifest.items) {
    const ledger=database.prepare('SELECT file_id FROM media_seed_items WHERE import_id=? AND file_name=?').get(IMPORT_ID,item.fileName);
    const row=ledger && database.prepare('SELECT * FROM media_files WHERE id=?').get(ledger.file_id);
    if(!row || row.sha256!==item.sha256 || row.size_bytes!==item.size || !/^[a-f0-9-]+\.(?:mp4|bin)$/.test(row.storage_name || '')) throw new Error('Imported media metadata differs from the reviewed manifest');
    if(hashFile(path.join(mediaRoot,row.storage_name))!==item.sha256) throw new Error('Stored media hash verification failed');
    files++;if(row.kind==='video') videos++;else if(row.kind==='file') documents++;
    if(row.archived) archived++;
    if(item.equipmentId!==undefined && item.equipmentId!==null) {
      const binding=bindings.find(entry=>entry.equipmentId===String(item.equipmentId)&&entry.locale===item.locale);
      if(!binding || binding.id!==row.id || binding.url!==row.url || binding.sha256!==row.sha256) throw new Error('Stored video binding does not match its reviewed language and file');
      const equipment=database.prepare('SELECT * FROM app_equipment_items WHERE id=?').get(String(item.equipmentId));
      if(!equipment || equipment.is_custom || equipment.deleted_at) {preservedChanges++;continue;}
      const current=item.locale==='zh'?equipment.video_url_zh:equipment.video_url_en;
      if(current===row.url && equipment.video_localized) currentBindings++;
      else if(before.alreadyApplied) preservedChanges++;
      else throw new Error('Newly installed facility is not using its reviewed language video');
    }
  }
  if(files!==57 || videos!==56 || documents!==1 || (!before.alreadyApplied && archived!==2)) throw new Error('Imported file totals are not correct');
  if(JSON.stringify(snapshotBefore(database).missing)!==JSON.stringify(before.missing)) throw new Error('Missing video codes 13 or 27 were unexpectedly changed');
  return {schemaVerified:true,importId:IMPORT_ID,bindingStatus:'applied',files,videos,privateDocuments:documents,archived,plannedVideoBindings:bindings.length,currentVideoBindings:currentBindings,preservedAdministratorChanges:preservedChanges,missingCodesPreserved:['13','27'],sha256Verified:true};
}
function runtimePaths(pid) {
  if(!/^[1-9][0-9]*$/.test(pid || '')) throw new Error('A running API service PID is required');
  const cwd=fs.readlinkSync(`/proc/${pid}/cwd`);
  if(cwd!==API_ROOT) throw new Error('Unexpected API service working directory');
  // Read only these non-secret configuration values; never print credentials.
  const allow=new Set(['DATABASE_PATH','MEDIA_UPLOAD_DIR','MEDIA_SEED_DIR','PORT']);const env={};
  for(const entry of fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0')) {const at=entry.indexOf('=');if(at>0&&allow.has(entry.slice(0,at))) env[entry.slice(0,at)]=entry.slice(at+1);}
  const databasePath=path.resolve(cwd,env.DATABASE_PATH || './data/outdoor-fit.sqlite');
  const mediaUploadDir=path.resolve(cwd,env.MEDIA_UPLOAD_DIR || path.join(path.dirname(databasePath),'media-library'));
  const mediaSeedDir=path.resolve(cwd,env.MEDIA_SEED_DIR || 'media-seed');
  if(mediaSeedDir!==path.join(API_ROOT,'media-seed')) throw new Error('Custom MEDIA_SEED_DIR requires manual review before this deployment');
  if(Number(env.PORT || 3000)!==3000) throw new Error('Custom API port requires manual review');
  for(const candidate of [databasePath,mediaUploadDir,mediaSeedDir]) {
    if(candidate==='/' || candidate===API_ROOT || candidate.startsWith('/etc/') || candidate.startsWith('/proc/') || candidate.startsWith('/dev/') || /\/(?:\.ssh|\.git|\.outdoor-fit-deploy|outdoor-fit-backups)(?:\/|$)/.test(candidate)) throw new Error('Unsafe configured runtime path');
    for(let current=candidate;current!==path.dirname(current);current=path.dirname(current)) if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked runtime path requires manual review');
  }
  return {databasePath,mediaUploadDir,mediaSeedDir,port:3000};
}
module.exports={snapshotBefore,inspectInstall,runtimePaths};
if(require.main===module) {
  const [mode,...args]=process.argv.slice(2);
  if(mode==='runtime') console.log(JSON.stringify(runtimePaths(args[0])));
  else if(mode==='snapshot' || mode==='verify') {
    const [apiDir,runtimeFile,manifestFile,beforeFile]=args;
    const paths=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
    const Database=require(path.join(path.resolve(apiDir),'node_modules','better-sqlite3'));
    const database=new Database(paths.databasePath,{readonly:true,fileMustExist:true});
    try {
      if(mode==='snapshot') console.log(JSON.stringify(snapshotBefore(database)));
      else {
        if(hashFile(manifestFile)!==EXPECTED_MANIFEST_SHA) throw new Error('Reviewed education manifest hash does not match');
        console.log(JSON.stringify(inspectInstall(database,JSON.parse(fs.readFileSync(manifestFile,'utf8')),paths.mediaUploadDir,JSON.parse(fs.readFileSync(beforeFile,'utf8')))));
      }
    }finally{database.close();}
  }else throw new Error('Expected runtime, snapshot or verify mode');
}
