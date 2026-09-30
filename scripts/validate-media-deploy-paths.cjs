const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u001f\u007f:]/.test(value) || value.startsWith('/')) return false;
  return value.replace(/\/$/,'').split('/').every(part => part && part !== '.' && part !== '..');
}

function validateApiPayload(apiStage) {
  const root = path.resolve(apiStage);
  const allowedRoots = new Set(['src','media-seed','package.json','package-lock.json']);
  for (const name of fs.readdirSync(root)) if (!allowedRoots.has(name)) throw new Error('Unexpected API archive root');
  for (const entry of fs.readdirSync(path.join(root,'src'),{withFileTypes:true})) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.js$/.test(entry.name)) throw new Error('Unexpected API source file');
  }
  const seedRoot = path.join(root,'media-seed'), manifest = JSON.parse(fs.readFileSync(path.join(seedRoot,'manifest.json'),'utf8'));
  if (!Array.isArray(manifest.items) || manifest.items.length > 10000) throw new Error('Invalid media seed manifest');
  const expected = new Map();
  for (const item of manifest.items) {
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}$/.test(item.fileName || '') || !/^[a-f0-9]{64}$/i.test(item.sha256 || '')) throw new Error('Unsafe media seed filename or hash');
    if (expected.has(item.fileName) && expected.get(item.fileName) !== item.sha256.toLowerCase()) throw new Error('Conflicting seed file hashes');
    expected.set(item.fileName,item.sha256.toLowerCase());
  }
  for (const name of fs.readdirSync(seedRoot)) if (!['manifest.json','files'].includes(name)) throw new Error('Unexpected media seed entry');
  const files = fs.readdirSync(path.join(seedRoot,'files'),{withFileTypes:true});
  if (files.length !== expected.size) throw new Error('Seed file count does not match manifest');
  for (const entry of files) {
    if (!entry.isFile() || !expected.has(entry.name)) throw new Error('Unlisted media seed file or symlink');
    const file = path.join(seedRoot,'files',entry.name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || stat.nlink > 1) throw new Error('Linked seed file is not allowed');
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024*1024), fd = fs.openSync(file,'r');
    try { let count; while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,count)); }
    finally { fs.closeSync(fd); }
    if (hash.digest('hex') !== expected.get(entry.name)) throw new Error('Seed checksum mismatch');
  }
  return {files:files.length,importId:manifest.importId || null};
}

function validateMerge(source, target) {
  const sourceRoot = path.resolve(source), targetRoot = path.resolve(target);
  function checkTargetAncestors(destination) {
    for (let current = destination; ; current = path.dirname(current)) {
      if (fs.existsSync(current) || (() => { try { return Boolean(fs.lstatSync(current)); } catch { return false; } })()) {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Deployment target contains symlink: ${current}`);
        if (fs.lstatSync(current).isFile() && fs.lstatSync(current).nlink > 1) throw new Error(`Deployment target contains hard link: ${current}`);
      }
      if (current === path.dirname(current)) break;
    }
  }
  function visit(from, to) {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsupported staged entry: ${from}`);
    checkTargetAncestors(to);
    if (fs.existsSync(to) && fs.statSync(to).isDirectory() !== stat.isDirectory()) throw new Error(`Deployment target type mismatch: ${to}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(from)) visit(path.join(from, name), path.join(to, name));
  }
  visit(sourceRoot, targetRoot);
}

function validStageRoots(apiStage, webStage) {
  const expectedStage = /^\/home\/dukaiyu2004\/\.outdoor-fit-deploy\/(?:timer-media-library-20260909|file-storage-bilingual-registration-20260910|file-explorer-video-20260910|pdf-app-timer-20260911)\.[A-Za-z0-9]+\/(?:api|web)$/;
  return expectedStage.test(apiStage || '') && expectedStage.test(webStage || '') && path.posix.dirname(apiStage) === path.posix.dirname(webStage) && path.posix.basename(apiStage) === 'api' && path.posix.basename(webStage) === 'web';
}

module.exports = { validateMerge, validateApiPayload, safeRelativePath, validStageRoots };
if (require.main === module) {
  const [apiStage, webStage] = process.argv.slice(2).map((value) => path.resolve(value));
  if (!validStageRoots(apiStage, webStage)) throw new Error('Unexpected staging roots');
  validateApiPayload(apiStage);
  for (const name of ['src','media-seed','package.json','package-lock.json']) validateMerge(path.join(apiStage, name), path.join('/home/dukaiyu2004/outdoor-fit-api', name));
  validateMerge(webStage, '/var/www/outdoor-fit');
  console.log('Staged application files and destination paths validated (no symlink traversal).');
}
