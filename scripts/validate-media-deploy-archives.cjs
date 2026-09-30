const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { safeRelativePath } = require('./validate-media-deploy-paths.cjs');
const protectedNames = new Set(['.env','.git','.ssh','data','uploads','media-library','equipment-images','.well-known']);

function validateNames(names,kind) {
  const seen=new Set();
  for(const name of names) {
    if (!safeRelativePath(name)) throw new Error('Unsafe archive path');
    const clean=name.replace(/\/$/,'');
    if (seen.has(clean)) throw new Error('Duplicate archive path'); seen.add(clean);
    const parts=clean.split('/');
    if (parts.some(part=>protectedNames.has(part) || part.startsWith('.env.'))) throw new Error('Protected runtime path in archive');
    if(parts.includes('node_modules') && !(kind==='web' && parts[0]==='assets' && parts[1]==='node_modules' && parts.lastIndexOf('node_modules')===1 && (name.endsWith('/') || /\.(?:ttf|otf|woff2?|png|jpe?g|gif|webp)$/i.test(name)))) throw new Error('Executable dependency tree in archive');
    if (kind==='api' && !['src','media-seed','package.json','package-lock.json'].includes(parts[0])) throw new Error('Unexpected API archive root');
  }
  return names.length;
}

function validateZip(file) {
  const bytes=fs.readFileSync(file);
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--) if(bytes.readUInt32LE(at)===0x06054b50){end=at;break;}
  if(end<0) throw new Error('ZIP end record missing');
  const count=bytes.readUInt16LE(end+10), directory=bytes.readUInt32LE(end+16);
  if(count===0xffff || directory===0xffffffff || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) throw new Error('ZIP64 or split ZIP is not supported');
  let at=directory;const names=[];
  for(let index=0;index<count;index++) {
    if(at+46>bytes.length || bytes.readUInt32LE(at)!==0x02014b50) throw new Error('Invalid ZIP central directory');
    const nameLength=bytes.readUInt16LE(at+28), extra=bytes.readUInt16LE(at+30), comment=bytes.readUInt16LE(at+32), mode=bytes.readUInt32LE(at+38)>>>16, type=mode&0xf000;
    if (bytes.readUInt16LE(at+8)&1) throw new Error('Encrypted archive is not supported');
    if (type && type!==0x8000 && type!==0x4000) throw new Error('ZIP contains a link or special entry');
    const local=bytes.readUInt32LE(at+42), name=bytes.subarray(at+46,at+46+nameLength).toString('utf8');
    if(local+30>bytes.length || bytes.readUInt32LE(local)!==0x04034b50) throw new Error('Invalid ZIP local header');
    const localLength=bytes.readUInt16LE(local+26);
    if(bytes.subarray(local+30,local+30+localLength).toString('utf8')!==name) throw new Error('ZIP local and central paths differ');
    names.push(name);at+=46+nameLength+extra+comment;
  }
  return validateNames(names,'web');
}

function validateTar(file) {
  const options={encoding:'utf8',maxBuffer:10*1024*1024};
  const names=execFileSync('tar',['-tzf',file],options).trimEnd().split(/\r?\n/);
  const details=execFileSync('tar',['-tvzf',file],options).trimEnd().split(/\r?\n/);
  if(details.length!==names.length || details.some(line=>!['-','d'].includes(line[0]))) throw new Error('TAR contains a link or special entry');
  return validateNames(names,'api');
}

module.exports={validateNames,validateZip,validateTar};
if(require.main===module) {
  const [api,web]=process.argv.slice(2);
  console.log(JSON.stringify({apiEntries:validateTar(api),webEntries:validateZip(web),safeToExtract:true}));
}
