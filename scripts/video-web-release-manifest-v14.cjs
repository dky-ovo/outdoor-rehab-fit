'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'workspace-artifacts/video-capacity-20261003-v14-web');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function walk(root){const rows={};for(const entry of fs.readdirSync(root,{withFileTypes:true})){const full=path.join(root,entry.name);if(entry.isSymbolicLink())throw Error('SOURCE_LINK_REFUSED');if(entry.isDirectory()){for(const [name,row] of Object.entries(walk(full)))rows[entry.name+'/'+name]=row;}else if(entry.isFile())rows[entry.name]={sha256:hash(fs.readFileSync(full)),bytes:fs.statSync(full).size};}return rows;}
function sources(){const rows={};for(const dir of ['app','components','hooks','utils','constants','assets']){for(const [name,row] of Object.entries(walk(path.join(ROOT,dir))))if(!name.includes('__tests__')&&!name.endsWith('.map'))rows[dir+'/'+name]=row;}for(const name of ['app.json','package.json','package-lock.json','metro.config.js'])if(fs.existsSync(path.join(ROOT,name)))rows[name]={sha256:hash(fs.readFileSync(path.join(ROOT,name)))};return rows;}
fs.mkdirSync(OUT,{recursive:true});
if(process.argv[2]==='capture'){
 const target=path.join(OUT,'source-before-build.json');if(fs.existsSync(target))throw Error('BUILD_ALREADY_CAPTURED');
 fs.writeFileSync(target,JSON.stringify({release:'video-capacity-20261003-v14-web',files:sources()},null,2));console.log('V14_WEB_SOURCE_CAPTURED=PASS');
}else if(process.argv[2]==='seal'){
 const before=JSON.parse(fs.readFileSync(path.join(OUT,'source-before-build.json'))),current=sources();
 if(JSON.stringify(before.files)!==JSON.stringify(current))throw Error('CLIENT_SOURCE_CHANGED_DURING_BUILD');
 const exportRoot=path.join(OUT,'export'),files=walk(exportRoot);
 if(!files['index.html'])throw Error('WEB_INDEX_MISSING');
 const target=path.join(OUT,'release-manifest.json');if(fs.existsSync(target))throw Error('WEB_ALREADY_SEALED');
 fs.writeFileSync(target,JSON.stringify({release:before.release,builtAtUTC:new Date().toISOString(),apiBaseUrl:'https://api.outdoorfit.hk/api',sourceFiles:current,files},null,2));
 console.log(JSON.stringify({release:before.release,files:Object.keys(files).length,bytes:Object.values(files).reduce((s,x)=>s+x.bytes,0),sourceStable:true}));
}else throw Error('Use capture or seal');
