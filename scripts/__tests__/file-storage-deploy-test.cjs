const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateNames,validateZip,validateTar}=require('../validate-media-deploy-archives.cjs');
const {validateApiPayload,safeRelativePath}=require('../validate-media-deploy-paths.cjs');
const {execFileSync}=require('node:child_process');
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'file-storage-deploy-'));try{return run(root);}finally{assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('file-storage-deploy-'));fs.rmSync(root,{recursive:true,force:true});}}
function zipEntry(name,mode=0x81a4,localName=name){
  const localBuffer=Buffer.from(localName),nameBuffer=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(localBuffer.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(nameBuffer.length,28);central.writeUInt32LE((mode*65536)>>>0,38);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+nameBuffer.length,12);end.writeUInt32LE(30+localBuffer.length,16);
  return Buffer.concat([local,localBuffer,central,nameBuffer,end]);
}
test('archive path validation allows legitimate Unicode assets and rejects traversal/private destinations',()=>{
  for(const name of ['../etc/passwd','/etc/passwd','C:/data/file','src/../../file','a\\b','./index.html','data/file','.env','.env.production','a/.ssh/key']) assert.throws(()=>validateNames([name],'web'));
  assert.equal(validateNames(['index.html','assets/中文图.png'],'web'),2);
  assert.equal(validateNames(['assets/node_modules/@expo/vector-icons/font.ttf'],'web'),1);
  assert.throws(()=>validateNames(['assets/node_modules/package/secret.js'],'web'),/dependency/);
  assert.throws(()=>validateNames(['node_modules/package/font.ttf'],'web'),/dependency/);
  assert.equal(safeRelativePath('media-seed/files/abc.docx'),true);
  assert.throws(()=>validateNames(['src/a.js','src/a.js'],'api'),/Duplicate/);
  assert.throws(()=>validateNames(['credentials/key.json'],'api'),/Unexpected/);
});
test('ZIP central and local paths are both checked and symlinks are rejected before extraction',()=>fixture(root=>{
  const archive=path.join(root,'web.zip');
  fs.writeFileSync(archive,zipEntry('index.html'));assert.equal(validateZip(archive),1);
  fs.writeFileSync(archive,zipEntry('safe','0x81a4','../escape'));assert.throws(()=>validateZip(archive),/paths differ/);
  fs.writeFileSync(archive,zipEntry('link',0xa1ff));assert.throws(()=>validateZip(archive),/link or special/);
}));
test('API seed validator accepts verified MP4 and DOCX while rejecting unlisted or mismatched bytes',()=>fixture(root=>{
  fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','app.js'),'export {}');
  fs.writeFileSync(path.join(root,'package.json'),'{}');fs.writeFileSync(path.join(root,'package-lock.json'),'{}');fs.mkdirSync(path.join(root,'media-seed','files'),{recursive:true});
  const items=['video.mp4','code.docx'].map(fileName=>{const bytes=Buffer.from(fileName);fs.writeFileSync(path.join(root,'media-seed','files',fileName),bytes);return{fileName,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
  fs.writeFileSync(path.join(root,'media-seed','manifest.json'),JSON.stringify({version:2,importId:'test',items}));
  assert.equal(validateApiPayload(root).files,2);
  fs.writeFileSync(path.join(root,'media-seed','files','code.docx'),'changed');assert.throws(()=>validateApiPayload(root),/checksum/);
  fs.writeFileSync(path.join(root,'media-seed','files','private.env'),'secret');assert.throws(()=>validateApiPayload(root),/count/);
}));
test('TAR validation accepts regular API sources and rejects unexpected top-level files',()=>fixture(root=>{
  const source=path.join(root,'source');fs.mkdirSync(path.join(source,'src'),{recursive:true});fs.writeFileSync(path.join(source,'src','app.js'),'export {}');
  const archive=path.join(root,'api.tar.gz');execFileSync('tar',['-czf',archive,'-C',source,'src']);assert.equal(validateTar(archive),2);
  fs.writeFileSync(path.join(source,'private.env'),'secret');execFileSync('tar',['-czf',archive,'-C',source,'private.env']);assert.throws(()=>validateTar(archive),/Unexpected/);
}));
test('new installer validates archives before extraction, backs up database and checks schema without resetting data',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../deploy/2026-09-10/install-file-storage-bilingual-registration-20260910.sh'),'utf8');
  assert.ok(source.indexOf('validate-media-deploy-archives.cjs" "$WORK_DIR/$API_ARCHIVE"')<source.indexOf('tar --no-same-owner -xzf'));
  assert.match(source,/verify-file-storage-install\.cjs" verify/);assert.match(source,/video-state-before\.json/);
  assert.ok(source.indexOf('systemctl stop outdoor-fit-api\nnode')<source.indexOf('snapshot "$WORK_DIR/api"'));
  assert.doesNotMatch(source,/rm\s+-rf/);assert.match(source,/database, uploads and new registrations are NOT rolled back/);
});
