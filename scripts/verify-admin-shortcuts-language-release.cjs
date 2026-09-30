#!/usr/bin/env node
"use strict";

// Standalone Web-only deployment checker. The validated path/inventory and
// atomic replace/recovery algorithms are retained from earlier Web releases,
// without importing any API, AI, database or obsolete release checker.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const RELEASE = "admin-shortcuts-language-20260923";
const INSTALLER = "install-admin-shortcuts-language-20260923.sh";
const ROOT_FILES = [INSTALLER, "verify-admin-shortcuts-language-release.cjs", "release-manifest.json", "README.md"];
const MAX = 64 * 1024 * 1024, MAX_WEB_BYTES = MAX, MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const check = (value, message) => { if (!value) throw new Error(message); };
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
function exact(value, keys, label) { check(value && typeof value === "object" && !Array.isArray(value) && same(Object.keys(value), keys), label + ": unexpected keys"); }
function safeRelative(value) {
  return typeof value === "string" && value.length < 500 && /^[A-Za-z0-9_@().+/-]+$/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== ".." && !part.startsWith("."));
}
function safePath(target, kind = "file", allowMissing = false) {
  const resolved = path.resolve(target), root = path.parse(resolved).root;
  check(resolved !== root, "Filesystem root is not a deployment target");
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (allowMissing && error.code === "ENOENT") continue; throw error; }
    check(!stat.isSymbolicLink(), "Symlink path rejected");
    if (i < parts.length - 1 || kind === "directory") check(stat.isDirectory(), "Expected regular directory");
    else check(stat.isFile() && stat.nlink === 1, "Expected regular file without hard links");
  }
  return resolved;
}
function walk(root) {
  safePath(root, "directory"); const files = [];
  const visit = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      check(safeRelative(name), "Unsafe relative release path");
      const target = path.join(directory, entry.name), stat = fs.lstatSync(target);
      check(!stat.isSymbolicLink(), "Symlink release entry rejected");
      if (stat.isDirectory()) { check(fs.readdirSync(target).length > 0, "Empty release directories rejected"); visit(target, name); }
      else { check(stat.isFile() && stat.nlink === 1, "Release entry must be a regular file"); files.push(name); }
    }
  };
  visit(root, ""); check(files.length <= 10000, "Too many release files"); return files.sort();
}
function validWebPath(name) {
  if (!safeRelative(name) || /(?:^|\/)(?:uploads?|media-seed|data|server|\.env)(?:\/|$)/i.test(name)) return false;
  if (/\.(?:sqlite(?:3)?|db|pem|key|p12|keystore|jks|zip|mp4|mov|webm|mkv|avi|hbc)$/i.test(name)) return false;
  if (/(?:^|\/)node_modules(?:\/|$)/.test(name) && !name.startsWith("assets/")) return false;
  if (name.startsWith("_expo/") && !name.startsWith("_expo/static/js/web/") && !name.startsWith("_expo/static/css/")) return false;
  return /\.(?:html|js|json|css|txt|ico|png|jpe?g|gif|webp|svg|ttf|otf|woff2?|mp3|wav)$/i.test(name);
}
function webInventory(root) {
  const files = walk(root); check(files.includes("index.html"), "Web export is missing index.html");
  if (files.includes("metadata.json")) {
    const metadata = JSON.parse(read(path.join(root, "metadata.json")));
    exact(metadata, ["version", "bundler", "fileMetadata"], "Expo Web metadata");
    check(metadata.version === 0 && metadata.bundler === "metro", "Unsupported Expo Web metadata");
    exact(metadata.fileMetadata, [], "Mixed native Expo export rejected; provide a web-only export");
  }
  let total = 0;
  return files.map(name => {
    check(validWebPath(name), `Unsupported web-only payload: ${name}`);
    const bytes = read(path.join(root, name), MAX_WEB_BYTES); total += bytes.length;
    check(total <= MAX_TOTAL_BYTES, "Web export exceeds release size limit");
    return { path: name, sha256: hash(bytes), bytes: bytes.length };
  });
}
function read(file, maximum = MAX) {
  const target = safePath(file), descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const stat = fs.fstatSync(descriptor); check(stat.isFile() && stat.nlink === 1 && stat.size <= maximum, "Invalid release file type/size"); const bytes = fs.readFileSync(descriptor); check(bytes.length === stat.size, "File changed while reading"); return bytes; }
  finally { fs.closeSync(descriptor); }
}
function verifyPackage(stage) {
  safePath(stage, "directory");
  check(same(fs.readdirSync(stage), [...ROOT_FILES, "web"]), "Unexpected package root entries");
  const files = Object.fromEntries(ROOT_FILES.map(name => [name, read(path.join(stage, name), 8 * 1024 * 1024)]));
  const manifest = JSON.parse(files["release-manifest.json"]);
  exact(manifest, ["version", "release", "web"], "Web-only manifest");
  check(manifest.version === 1 && manifest.release === RELEASE && Array.isArray(manifest.web), "Invalid Web-only release");
  const actual = webInventory(path.join(stage, "web"));
  const sorted = items => [...items].sort((a, b) => a.path.localeCompare(b.path, "en"));
  check(JSON.stringify(sorted(manifest.web)) === JSON.stringify(sorted(actual)), "Web inventory/hash mismatch");
  const expected = ROOT_FILES.filter(name => name !== INSTALLER), seen = new Set();
  const block = files[INSTALLER].toString("utf8").match(/<<'EMBEDDED_CHECKSUMS'\r?\n([\s\S]*?)\r?\nEMBEDDED_CHECKSUMS/);
  check(block, "Missing embedded checksums");
  for (const line of block[1].trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    check(match && expected.includes(match[2]) && !seen.has(match[2]), "Unsafe/duplicate embedded checksum");
    check(hash(files[match[2]]) === match[1], "Package checksum mismatch"); seen.add(match[2]);
  }
  check(same(seen, expected), "Incomplete embedded checksums");
  return manifest;
}
function verifyTarget(web, stage) {
  safePath(web, "directory"); const manifest = verifyPackage(stage);
  for (const item of manifest.web) {
    const target = safePath(path.join(web, item.path), "file", true);
    if (fs.existsSync(target) && /^(assets|_expo)\//.test(item.path)) check(hash(read(target)) === item.sha256, "Immutable web asset collision");
  }
  return manifest;
}
function ensureDirectory(directory, owner) {
  safePath(directory, "directory", true); const missing = [];
  for (let current = path.resolve(directory); !fs.existsSync(current); current = path.dirname(current)) missing.push(current);
  for (const target of missing.reverse()) {
    const mode = owner ? 0o755 : 0o700;
    fs.mkdirSync(target, { mode }); fs.chmodSync(target, mode);
    if (owner && process.platform !== "win32") fs.chownSync(target, owner.uid, owner.gid);
  }
}
function atomicFile(target, bytes, owner, mode = 0o644) {
  safePath(target, "file", true); ensureDirectory(path.dirname(target), owner);
  const temporary = path.join(path.dirname(target), `.admin-panel-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", mode);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); if (process.platform !== "win32") fs.fchownSync(fd, owner.uid, owner.gid); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  safePath(target, "file", true); fs.renameSync(temporary, target);
}
function separateRoots(web, stage, backup) {
  const roots = [web, stage, backup].map(target => safePath(target, "directory"));
  for (let i = 0; i < roots.length; i++) for (let j = 0; j < roots.length; j++) if (i !== j) {
    const relative = path.relative(roots[i], roots[j]);
    check(relative && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), "Deployment roots must be separate");
  }
}
function backupDeployment(web, stage, backup) {
  separateRoots(web, stage, backup); const manifest = verifyTarget(web, stage);
  check(fs.readdirSync(backup).length === 0, "Backup directory must be empty");
  const entries = manifest.web.map(item => {
    const target = safePath(path.join(web, item.path), "file", true), entry = { path: item.path, exists: fs.existsSync(target) };
    if (entry.exists) {
      const bytes = read(target), stat = fs.statSync(target), destination = path.join(backup, "web", item.path);
      ensureDirectory(path.dirname(destination)); fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
      Object.assign(entry, { sha256: hash(bytes), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid });
    }
    return entry;
  });
  fs.writeFileSync(path.join(backup, "recovery.json"), JSON.stringify({ release: RELEASE, web: path.resolve(web), entries }), { flag: "wx", mode: 0o600 });
  return { backup: "complete", files: entries.length };
}
function recoveryPlan(web, stage, backup) {
  separateRoots(web, stage, backup); const manifest = verifyPackage(stage), plan = JSON.parse(read(path.join(backup, "recovery.json"), 8 * 1024 * 1024));
  check(plan.release === RELEASE && plan.web === path.resolve(web) && Array.isArray(plan.entries) && same(plan.entries.map(item => item.path), manifest.web.map(item => item.path)), "Recovery inventory/root mismatch");
  for (const entry of plan.entries) {
    check(validWebPath(entry.path) && typeof entry.exists === "boolean", "Invalid recovery entry");
    safePath(path.join(web, entry.path), "file", true);
    if (entry.exists) {
      check(Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777 && Number.isInteger(entry.uid) && entry.uid >= 0 && Number.isInteger(entry.gid) && entry.gid >= 0, "Invalid recovery metadata");
      check(hash(read(path.join(backup, "web", entry.path))) === entry.sha256, "Recovery checksum mismatch");
    }
  }
  return plan;
}
const ordered = entries => [...entries].sort((a, b) => Number(a.path.endsWith(".html")) - Number(b.path.endsWith(".html")));
function applyDeployment(web, stage, backup) {
  const manifest = verifyTarget(web, stage), plan = recoveryPlan(web, stage, backup);
  for (const entry of plan.entries) {
    const target = path.join(web, entry.path);
    check(fs.existsSync(target) === entry.exists && (!entry.exists || hash(read(target)) === entry.sha256), "Target changed after backup");
  }
  // Install referenced assets first, entrypoints last. Never remove old assets.
  for (const item of ordered(manifest.web)) atomicFile(path.join(web, item.path), read(path.join(stage, "web", item.path)), fs.statSync(web));
  return verifyInstalled(web, stage);
}
function verifyInstalled(web, stage) {
  safePath(web, "directory"); const manifest = verifyPackage(stage);
  for (const item of manifest.web) check(hash(read(path.join(web, item.path))) === item.sha256, `Installed web hash mismatch: ${item.path}`);
  return { installed: RELEASE, files: manifest.web.length, api: "untouched", database: "untouched", uploads: "untouched" };
}
function rollbackDeployment(web, stage, backup) {
  const plan = recoveryPlan(web, stage, backup), manifest = verifyPackage(stage);
  const replacements = new Map(manifest.web.map(item => [item.path, item.sha256]));
  // Do not overwrite an operator's changes made during/after this deployment.
  for (const entry of plan.entries) {
    const target = safePath(path.join(web, entry.path), "file", true);
    const current = fs.existsSync(target) ? hash(read(target)) : null;
    check(current === (entry.exists ? entry.sha256 : null) || current === replacements.get(entry.path), "Concurrent target change prevents automatic rollback");
  }
  for (const entry of ordered(plan.entries)) {
    const target = path.join(web, entry.path);
    if (entry.exists) atomicFile(target, read(path.join(backup, "web", entry.path)), entry, entry.mode);
    else if (fs.existsSync(target)) {
      // Backup and Web roots may be on different filesystems: copy and verify
      // before removing only this exact new file. User data is out of scope.
      const retained = path.join(backup, "failed-release", entry.path), bytes = read(target);
      ensureDirectory(path.dirname(retained)); fs.writeFileSync(retained, bytes, { flag: "wx", mode: 0o600 });
      check(hash(read(retained)) === hash(bytes), "Failed file retention mismatch"); fs.unlinkSync(safePath(target));
    }
  }
  for (const entry of plan.entries) {
    const target = path.join(web, entry.path);
    check(fs.existsSync(target) === entry.exists && (!entry.exists || hash(read(target)) === entry.sha256), "Rollback verification failed");
  }
  return { rollback: "web-only", api: "untouched", database: "untouched", uploads: "untouched" };
}
module.exports = { RELEASE, ROOT_FILES, webInventory, verifyPackage, verifyTarget, backupDeployment, applyDeployment, verifyInstalled, rollbackDeployment };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const handlers = { "web-inventory": [webInventory, 1], package: [verifyPackage, 1], target: [verifyTarget, 2], backup: [backupDeployment, 3], apply: [applyDeployment, 3], installed: [verifyInstalled, 2], rollback: [rollbackDeployment, 3] };
    check(handlers[command] && handlers[command][1] === args.length, "Unsupported Web-only command/arguments");
    const result = handlers[command][0](...args);
    process.stdout.write(`${JSON.stringify(command === "package" || command === "target" ? { verified: command, files: result.web.length } : result)}\n`);
  } catch (error) { process.stderr.write(`Admin shortcuts language Web release check failed: ${error.message}\n`); process.exitCode = 1; }
}
