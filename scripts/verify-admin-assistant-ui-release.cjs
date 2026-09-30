#!/usr/bin/env node
"use strict";

// Static copy of the reviewed Web-only admin-panel-layout helper (SHA-256
// 12dcb67ab4318ec97e641e8a0c68634db221b3287d7ce291c7ac3fcefdf96060).
// Its file deployment/recovery algorithm is retained. Only release identity,
// support-file names and explicit pinning of imported helpers are changed.
// No backend, database, runtime or smoke-test entry point is invoked.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const RELEASE = "admin-assistant-ui-20260921";
const PINNED_HELPERS = Object.freeze({
  "verify-contact-feedback-release.cjs": "2f2b53e730af4828a8e87263be38a4e646a424d5d1ee57dcf2f9d498c10ecf73",
  "verify-ai-chatbox-guide-backend-patch.cjs": "1d13a9ee3597c06c24c92986f2606696c044be53939ca984d2847bbbef44f461",
});
const ROOT_FILES = ["install-admin-assistant-ui-20260921.sh", "verify-admin-assistant-ui-release.cjs", ...Object.keys(PINNED_HELPERS), "release-manifest.json", "checksums.sha256", "README.md"];
const MAX = 64 * 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const check = (value, message) => { if (!value) throw new Error(message); };
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
// Verify the exact reviewed dependencies before importing their code. These
// files are shipped only because safePath/webInventory depend on them.
for (const [name, expected] of Object.entries(PINNED_HELPERS)) {
  const file = path.join(__dirname, name), stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 8 * 1024 * 1024, "Invalid reviewed helper file");
  check(hash(fs.readFileSync(file)) === expected, `Reviewed helper changed: ${name}`);
}
const { safePath, validWebPath, webInventory } = require("./verify-contact-feedback-release.cjs");
function read(file, maximum = MAX) {
  const target = safePath(file), descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const stat = fs.fstatSync(descriptor); check(stat.isFile() && stat.nlink === 1 && stat.size <= maximum, "Invalid release file type/size"); const bytes = fs.readFileSync(descriptor); check(bytes.length === stat.size, "File changed while reading"); return bytes; }
  finally { fs.closeSync(descriptor); }
}
function verifyPackage(stage) {
  safePath(stage, "directory");
  check(same(fs.readdirSync(stage), [...ROOT_FILES, "web"]), "Unexpected package root entries");
  const files = Object.fromEntries(ROOT_FILES.map(name => [name, read(path.join(stage, name), 8 * 1024 * 1024)]));
  for (const [name, expected] of Object.entries(PINNED_HELPERS)) check(hash(files[name]) === expected, `Reviewed helper changed: ${name}`);
  const manifest = JSON.parse(files["release-manifest.json"]);
  check(manifest && same(Object.keys(manifest), ["version", "release", "web"]) && manifest.version === 1 && manifest.release === RELEASE, "Invalid Web-only manifest");
  check(Array.isArray(manifest.web), "Missing web inventory");
  const actual = webInventory(path.join(stage, "web"));
  const sorted = items => [...items].sort((a, b) => a.path.localeCompare(b.path, "en"));
  check(JSON.stringify(sorted(manifest.web)) === JSON.stringify(sorted(actual)), "Web inventory/hash mismatch");
  const expected = ROOT_FILES.filter(name => name !== "checksums.sha256"), seen = new Set();
  for (const line of files["checksums.sha256"].toString("utf8").trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    check(match && expected.includes(match[2]) && !seen.has(match[2]), "Unsafe/duplicate checksum entry");
    check(hash(files[match[2]]) === match[1], "Package checksum mismatch"); seen.add(match[2]);
  }
  check(same(seen, expected), "Missing package checksum");
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
  const plan = recoveryPlan(web, stage, backup);
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
module.exports = { RELEASE, ROOT_FILES, PINNED_HELPERS, webInventory, verifyPackage, verifyTarget, backupDeployment, applyDeployment, verifyInstalled, rollbackDeployment };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const handlers = { "web-inventory": [webInventory, 1], package: [verifyPackage, 1], target: [verifyTarget, 2], backup: [backupDeployment, 3], apply: [applyDeployment, 3], installed: [verifyInstalled, 2], rollback: [rollbackDeployment, 3] };
    check(handlers[command] && handlers[command][1] === args.length, "Unsupported Web-only command/arguments");
    const result = handlers[command][0](...args);
    process.stdout.write(`${JSON.stringify(command === "package" || command === "target" ? { verified: command, files: result.web.length } : result)}\n`);
  } catch (error) { process.stderr.write(`Admin assistant UI Web release check failed: ${error.message}\n`); process.exitCode = 1; }
}
