#!/usr/bin/env node
"use strict";

// The reviewed prior checker is used only for Linux runtime inspection and
// inventory constants. Its image-aware smoke and release routines are never called.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const prior = require("./verify-ai-chatbox-guide-backend-patch.cjs");
const RELEASE = "admin-document-voice-20260921";
const BASELINES = ["v24-activity-content-20260918", "learning-voice-input-20260921"];
const PAYLOADS = ["app.js", "assistant.js", "database.js", "adminAssistant.js", "adminAssistantPrivacy.js", "equipmentDocumentImport.js", "package.json", "package-lock.json"];
const payloadPath = name => name.startsWith("package") ? name : `src/${name}`;
const ROOT_FILES = [...PAYLOADS, "install-admin-document-voice-20260921.sh", "verify-admin-document-voice-release.cjs", "verify-ai-chatbox-guide-backend-patch.cjs", "release-manifest.json", "checksums.sha256", "README.md"];
const KNOWN_FILES = [...prior.INSTALLED_FILES, "src/feedback.js", "src/tcmContentUpdate.js", "src/tcmV24Content.json"];
const INVENTORIES = [KNOWN_FILES, KNOWN_FILES];
const MAX_WEB_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const DEPENDENCY_VERSIONS = { "@xmldom/xmldom": "0.9.12", "yauzl": "3.4.0", "pend": "1.2.0", "better-sqlite3": "12.4.1" };
function exact(value, keys, label) { check(value && typeof value === "object" && !Array.isArray(value) && same(Object.keys(value), keys), `${label}: unexpected keys`); }
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
function read(target, maximum = 2 * 1024 * 1024) {
  const file = safePath(target), fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd); check(stat.isFile() && stat.nlink === 1 && stat.size <= maximum, "File size/type outside release limits");
    const bytes = fs.readFileSync(fd); check(bytes.length === stat.size, "File changed while reading"); return bytes;
  } finally { fs.closeSync(fd); }
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
function verifyPackage(stageRoot) {
  const root = safePath(stageRoot, "directory");
  check(same(fs.readdirSync(root), [...ROOT_FILES, "web"]), "Unexpected package root entries");
  const bytes = Object.fromEntries(ROOT_FILES.map(name => [name, read(path.join(root, name), name === "release-manifest.json" ? 8 * 1024 * 1024 : undefined)]));
  const manifest = JSON.parse(bytes["release-manifest.json"]);
  exact(manifest, ["version", "release", "files", "baselines", "web"], "Manifest");
  check(manifest.version === 1 && manifest.release === RELEASE, "Unsupported Admin document/voice release");
  check(Array.isArray(manifest.files) && manifest.files.length === PAYLOADS.length, "Exactly eight backend/package payloads required");
  const targets = {};
  for (const item of manifest.files) {
    exact(item, ["path", "archive", "sha256"], "Payload");
    check(PAYLOADS.includes(item.archive) && item.path === payloadPath(item.archive) && !Object.hasOwn(targets, item.path), "Unsafe/duplicate backend payload");
    check(isHash(item.sha256) && item.sha256 === hash(bytes[item.archive]), "Backend payload checksum mismatch");
    targets[item.path] = item.sha256;
  }
  const packageJson = JSON.parse(bytes["package.json"]), lock = JSON.parse(bytes["package-lock.json"]);
  check(packageJson.name === "outdoor-fit-api" && packageJson.type === "module" && packageJson.private === true, "Unexpected API package identity");
  exact(packageJson.dependencies, ["@xmldom/xmldom", "better-sqlite3", "express", "openai", "yauzl"], "Runtime dependency set");
  check(packageJson.dependencies["@xmldom/xmldom"] === "0.9.12" && packageJson.dependencies.yauzl === "3.4.0", "Unreviewed document parser versions");
  check(packageJson.dependencies["better-sqlite3"] === "12.4.1" && packageJson.dependencies.express === "5.2.1" && packageJson.dependencies.openai === "^7.10.0", "Unexpected existing dependency change");
  check(packageJson.scripts && same(Object.keys(packageJson.scripts), ["start", "test"]) && packageJson.scripts.start === "node src/index.js" && packageJson.scripts.test === "node --test", "Unexpected lifecycle scripts");
  check(lock.lockfileVersion === 3 && JSON.stringify(lock.packages?.[""]?.dependencies) === JSON.stringify(packageJson.dependencies), "Package and lock dependencies disagree");
  for (const [name, version] of Object.entries(DEPENDENCY_VERSIONS)) check(lock.packages[`node_modules/${name}`]?.version === version, "Unreviewed locked runtime dependency");
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    check(name.startsWith("node_modules/") && !entry.link && typeof entry.version === "string" && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(entry.version), "Dependency version is not locked");
    check(typeof entry.resolved === "string" && /^https:\/\/registry\.npmjs\.org\/[A-Za-z0-9@%._+/-]+\.tgz$/.test(entry.resolved), "Dependency download must use the npm registry");
    check(typeof entry.integrity === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity), "Dependency integrity is missing or unsupported");
  }
  check(Array.isArray(manifest.baselines) && manifest.baselines.length === 2, "Reviewed complete V24 and learning baselines required");
  const seen = new Set();
  for (const baseline of manifest.baselines) {
    exact(baseline, ["release", "files"], "Baseline");
    const index = BASELINES.indexOf(baseline.release);
    check(index !== -1 && !seen.has(baseline.release), "Unknown/duplicate baseline"); seen.add(baseline.release);
    exact(baseline.files, INVENTORIES[index], "Baseline inventory");
    for (const value of Object.values(baseline.files)) check(isHash(value), "Malformed baseline hash");
  }
  for (const name of KNOWN_FILES.filter(name => !Object.hasOwn(targets, name))) {
    check(new Set(manifest.baselines.map(item => item.files[name])).size === 1, `Unrelated baseline drift: ${name}`);
  }
  check(Array.isArray(manifest.web) && manifest.web.length > 0 && manifest.web.length <= 10000, "Invalid web inventory");
  for (const item of manifest.web) {
    exact(item, ["path", "sha256", "bytes"], "Web payload");
    check(validWebPath(item.path) && isHash(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= MAX_WEB_BYTES, "Unsafe web manifest entry");
  }
  check(same(manifest.web.map(item => item.path), new Set(manifest.web.map(item => item.path))), "Duplicate web payload");
  const actualWeb = webInventory(path.join(root, "web"));
  check(JSON.stringify([...manifest.web].sort((a, b) => a.path.localeCompare(b.path, "en"))) === JSON.stringify([...actualWeb].sort((a, b) => a.path.localeCompare(b.path, "en"))), "Web payload checksum or inventory mismatch");
  const expectedChecksums = ROOT_FILES.filter(name => name !== "checksums.sha256");
  const checksumLines = bytes["checksums.sha256"].toString("utf8").trimEnd().split(/\r?\n/), checked = new Set();
  check(checksumLines.length === expectedChecksums.length, "Invalid checksum entry count");
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    check(match && expectedChecksums.includes(match[2]) && !checked.has(match[2]), "Unsafe/duplicate checksum entry");
    check(hash(bytes[match[2]]) === match[1], `Package checksum mismatch: ${match[2]}`); checked.add(match[2]);
  }
  return { manifest, targets };
}
function verifyBaseline(apiRoot, stageRoot) {
  const { manifest, targets } = verifyPackage(stageRoot), root = safePath(apiRoot, "directory");
  const source = walk(path.join(root, "src")).map(name => `src/${name}`), current = {};
  const installed = { ...manifest.baselines.find(item => item.release === BASELINES[0]).files, ...targets };
  check(source.every(name => Object.hasOwn(installed, name)), "Unexpected API source file");
  for (const name of [...source, "package.json", "package-lock.json"]) current[name] = hash(read(path.join(root, name)));
  const candidates = [...manifest.baselines.map(item => ({ ...item, state: "baseline" })), { release: RELEASE, state: "installed", files: installed }];
  for (const candidate of candidates) if (same(Object.keys(current), Object.keys(candidate.files)) && Object.entries(candidate.files).every(([name, value]) => current[name] === value)) return { release: candidate.release, state: candidate.state };
  throw new Error("Unknown, mixed or pre-staged API baseline; refusing overwrite");
}
function verifyWebTarget(webRoot, stageRoot) {
  const root = safePath(webRoot, "directory"), { manifest } = verifyPackage(stageRoot);
  for (const item of manifest.web) {
    const target = safePath(path.join(root, item.path), "file", true);
    if (fs.existsSync(target) && /^(?:assets|_expo)\//.test(item.path)) check(hash(read(target, MAX_WEB_BYTES)) === item.sha256, "Immutable web asset collision would break an older index");
  }
  return { webTarget: "verified", files: manifest.web.length };
}
function verifyInstalledWeb(webRoot, stageRoot) {
  safePath(webRoot, "directory"); const { manifest } = verifyPackage(stageRoot);
  for (const item of manifest.web) check(hash(read(path.join(webRoot, item.path), MAX_WEB_BYTES)) === item.sha256, `Installed Web hash mismatch: ${item.path}`);
  return { installedWeb: "verified", files: manifest.web.length };
}
function ensureDirectory(directory, owner) {
  safePath(directory, "directory", true);
  const missing = [];
  for (let current = path.resolve(directory); !fs.existsSync(current); current = path.dirname(current)) missing.push(current);
  for (const target of missing.reverse()) {
    const mode = owner ? 0o755 : 0o700;
    fs.mkdirSync(target, { mode }); fs.chmodSync(target, mode);
    if (owner && process.platform !== "win32") fs.chownSync(target, owner.uid, owner.gid);
  }
  safePath(directory, "directory");
}
function atomicFile(target, bytes, mode, owner) {
  safePath(target, "file", true); ensureDirectory(path.dirname(target), owner);
  const temporary = path.join(path.dirname(target), `.admin-document-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", mode);
  const created = fs.fstatSync(fd);
  let moved = false;
  try {
    try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); if (process.platform !== "win32") fs.fchownSync(fd, owner.uid, owner.gid); }
    finally { fs.closeSync(fd); }
    safePath(target, "file", true); fs.renameSync(temporary, target); moved = true;
  } finally {
    if (!moved && fs.existsSync(temporary)) {
      const remaining = fs.lstatSync(temporary);
      check(remaining.isFile() && !remaining.isSymbolicLink() && remaining.nlink === 1 && remaining.dev === created.dev && remaining.ino === created.ino, "Temporary release file identity changed; manual inspection required");
      fs.unlinkSync(temporary);
    }
  }
}
function backupDeployment(apiRoot, webRoot, stageRoot, backupRoot, runtimeFile) {
  verifyBaseline(apiRoot, stageRoot); verifyWebTarget(webRoot, stageRoot);
  safePath(backupRoot, "directory"); check(fs.readdirSync(backupRoot).length === 0, "Backup directory must be empty");
  const { manifest } = verifyPackage(stageRoot), runtime = JSON.parse(read(runtimeFile));
  const api = path.resolve(apiRoot), web = path.resolve(webRoot);
  const dbPath = safePath(runtime.dbPath); check(dbPath.startsWith(`${api}${path.sep}data${path.sep}`) && runtime.port === 3000, "Unapproved runtime database backup path");
  const entries = [];
  for (const [kind, root, files] of [["api", api, PAYLOADS.map(payloadPath)], ["web", web, manifest.web.map(item => item.path)]]) {
    for (const relative of files) {
      const file = safePath(path.join(root, relative), "file", true), exists = fs.existsSync(file), entry = { kind, path: relative, exists };
      if (exists) {
        const bytes = read(file, kind === "web" ? MAX_WEB_BYTES : undefined), stat = fs.statSync(file), saved = path.join(backupRoot, kind, relative);
        ensureDirectory(path.dirname(saved)); fs.writeFileSync(saved, bytes, { flag: "wx", mode: 0o600 });
        Object.assign(entry, { sha256: hash(bytes), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid });
      }
      entries.push(entry);
    }
  }
  ensureDirectory(path.join(backupRoot, "database"));
  const database = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = safePath(dbPath + suffix, "file", true);
    if (!fs.existsSync(source)) { database.push({ suffix, exists: false }); continue; }
    const destination = path.join(backupRoot, "database", `database.sqlite${suffix}`);
    // Stream/copy the stopped database without loading user data into memory.
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o600);
    const digestFile = file => {
      const digest = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), descriptor = fs.openSync(safePath(file), "r");
      try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
      finally { fs.closeSync(descriptor); }
      return digest.digest("hex");
    };
    const sourceHash = digestFile(source);
    check(fs.statSync(source).size === fs.statSync(destination).size && digestFile(destination) === sourceHash, "Database backup checksum mismatch");
    database.push({ suffix, exists: true, bytes: fs.statSync(destination).size, sha256: sourceHash });
  }
  fs.writeFileSync(path.join(backupRoot, "recovery.json"), JSON.stringify({ release: RELEASE, api, web, dbPath, entries, database }, null, 2), { flag: "wx", mode: 0o600 });
  return { backup: "complete", files: entries.length, database: "copied with available WAL/SHM; manual restoration only" };
}
function recoveryPlan(apiRoot, webRoot, stageRoot, backupRoot) {
  const { manifest } = verifyPackage(stageRoot), plan = JSON.parse(read(path.join(backupRoot, "recovery.json"), 8 * 1024 * 1024));
  check(plan.release === RELEASE && plan.api === path.resolve(apiRoot) && plan.web === path.resolve(webRoot), "Recovery roots do not match");
  const expected = [...PAYLOADS.map(name => `api:${payloadPath(name)}`), ...manifest.web.map(item => `web:${item.path}`)];
  check(Array.isArray(plan.entries) && same(plan.entries.map(entry => `${entry.kind}:${entry.path}`), expected), "Recovery file inventory mismatch");
  for (const entry of plan.entries) {
    check(safeRelative(entry.path) && typeof entry.exists === "boolean", "Invalid recovery entry");
    safePath(path.join(entry.kind === "api" ? apiRoot : webRoot, entry.path), "file", true);
    if (entry.exists) check(isHash(entry.sha256) && hash(read(path.join(backupRoot, entry.kind, entry.path), entry.kind === "web" ? MAX_WEB_BYTES : undefined)) === entry.sha256, "Recovery backup checksum mismatch");
  }
  return plan;
}
function applyDeployment(apiRoot, webRoot, stageRoot, backupRoot) {
  verifyBaseline(apiRoot, stageRoot); verifyWebTarget(webRoot, stageRoot);
  const plan = recoveryPlan(apiRoot, webRoot, stageRoot, backupRoot), { manifest } = verifyPackage(stageRoot);
  for (const entry of plan.entries) {
    const target = path.join(entry.kind === "api" ? apiRoot : webRoot, entry.path);
    check(fs.existsSync(target) === entry.exists && (!entry.exists || hash(read(target, entry.kind === "web" ? MAX_WEB_BYTES : undefined)) === entry.sha256), "Target changed after backup");
  }
  for (const name of PAYLOADS) atomicFile(path.join(apiRoot, payloadPath(name)), read(path.join(stageRoot, name)), 0o644, fs.statSync(path.join(apiRoot, "src", "app.js")));
  // Referenced assets first, HTML entrypoints last; retain all older assets.
  const ordered = [...manifest.web].sort((a, b) => Number(a.path.endsWith(".html")) - Number(b.path.endsWith(".html")));
  for (const item of ordered) atomicFile(path.join(webRoot, item.path), read(path.join(stageRoot, "web", item.path), MAX_WEB_BYTES), 0o644, fs.statSync(webRoot));
  return { applied: RELEASE, backendFiles: PAYLOADS.length, webFiles: manifest.web.length };
}
function rollbackDeployment(apiRoot, webRoot, stageRoot, backupRoot) {
  const plan = recoveryPlan(apiRoot, webRoot, stageRoot, backupRoot);
  const { manifest, targets } = verifyPackage(stageRoot);
  const installedWeb = new Map(manifest.web.map(item => [item.path, item.sha256]));
  // Refuse to overwrite an unrelated edit made after a failed deployment.
  // A partial install can contain only the recorded original or new bytes.
  for (const entry of plan.entries) {
    const target = safePath(path.join(entry.kind === "api" ? apiRoot : webRoot, entry.path), "file", true);
    if (!fs.existsSync(target)) { check(!entry.exists, "Existing recovery target disappeared; manual inspection required"); continue; }
    const current = hash(read(target, entry.kind === "web" ? MAX_WEB_BYTES : undefined));
    const installed = entry.kind === "api" ? targets[entry.path] : installedWeb.get(entry.path);
    check(current === installed || (entry.exists && current === entry.sha256), "Recovery target changed outside deployment; refusing overwrite");
  }
  // No database paths from recovery.json are read or restored here. Migrations
  // are additive, and post-restart feedback must survive a code rollback.
  for (const entry of [...plan.entries].sort((a, b) => Number(a.path.endsWith(".html")) - Number(b.path.endsWith(".html")))) {
    const target = path.join(entry.kind === "api" ? apiRoot : webRoot, entry.path);
    if (entry.exists) atomicFile(target, read(path.join(backupRoot, entry.kind, entry.path), entry.kind === "web" ? MAX_WEB_BYTES : undefined), entry.mode, entry);
    else if (fs.existsSync(target)) {
      const retained = path.join(backupRoot, "failed-release", entry.kind, entry.path);
      ensureDirectory(path.dirname(retained)); check(!fs.existsSync(retained), "Recovery destination already exists");
      // Web and home backups may be on different filesystems. Copy and verify
      // the failed file before removing only that exact newly installed path.
      const bytes = read(target, entry.kind === "web" ? MAX_WEB_BYTES : undefined);
      fs.writeFileSync(retained, bytes, { flag: "wx", mode: 0o600 });
      check(hash(read(retained, entry.kind === "web" ? MAX_WEB_BYTES : undefined)) === hash(bytes), "Failed release file retention failed");
      fs.unlinkSync(safePath(target));
    }
  }
  for (const entry of plan.entries) {
    const target = path.join(entry.kind === "api" ? apiRoot : webRoot, entry.path);
    check(fs.existsSync(target) === entry.exists && (!entry.exists || hash(read(target, entry.kind === "web" ? MAX_WEB_BYTES : undefined)) === entry.sha256), "Rollback verification failed");
  }
  return { rollback: "code-and-web-only", database: "untouched", uploads: "untouched" };
}

function relativeDependencyLink(relative, link) {
  if (typeof link !== "string" || path.isAbsolute(link) || path.win32.parse(link).root) return false;
  let depth = relative.split("/").length - 1;
  for (const part of link.split(/[\\/]/)) {
    if (!part || part === ".") continue;
    if (part === "..") { if (--depth < 0) return false; }
    else depth++;
  }
  return true;
}
function dependencyTree(root) {
  const resolved = safePath(root, "directory"), entries = [];
  let total = 0;
  const visit = (directory, prefix, depth) => {
    check(depth < 40, "Dependency tree too deep");
    for (const name of fs.readdirSync(directory).sort()) {
      check(name !== "." && name !== ".." && !/[\\/\u0000-\u001f]/.test(name), "Unsafe dependency entry");
      const target = path.join(directory, name), relative = prefix ? `${prefix}/${name}` : name, stat = fs.lstatSync(target);
      check(entries.length < 100000, "Too many dependency entries");
      if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(target);
        check(!path.isAbsolute(link) && !path.win32.isAbsolute(link), "Absolute dependency symlink cannot survive atomic tree rename");
        check(relativeDependencyLink(relative, link), "Dependency symlink leaves the tree while resolving; cannot survive atomic rename");
        const destination = fs.realpathSync(target);
        check(destination.startsWith(`${resolved}${path.sep}`), "Dependency symlink escapes its tree");
        entries.push({ path: relative, type: "link", target: link });
      } else if (stat.isDirectory()) { entries.push({ path: relative, type: "directory" }); visit(target, relative, depth + 1); }
      else {
        check(stat.isFile() && stat.nlink === 1 && stat.size < 512 * 1024 * 1024, "Unsafe dependency file");
        total += stat.size; check(total < 2 * 1024 * 1024 * 1024, "Dependency tree too large");
        const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), digest = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
        try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
        finally { fs.closeSync(fd); }
        entries.push({ path: relative, type: "file", bytes: stat.size, sha256: digest.digest("hex") });
      }
    }
  };
  visit(resolved, "", 0);
  return { sha256: hash(JSON.stringify(entries)), entries: entries.length, bytes: total };
}

function prepareDependencySwap(apiRoot, stagedRoot, backupRoot) {
  const api = safePath(apiRoot, "directory"), staged = safePath(stagedRoot, "directory"), backup = safePath(backupRoot, "directory");
  const live = safePath(path.join(api, "node_modules"), "directory");
  check(staged !== live && !staged.startsWith(`${live}${path.sep}`) && !live.startsWith(`${staged}${path.sep}`), "Dependency staging overlaps live tree");
  check(fs.statSync(live).dev === fs.statSync(staged).dev && fs.statSync(live).dev === fs.statSync(backup).dev, "Dependency rename requires one filesystem");
  const original = path.join(backup, "node_modules-original"), failed = path.join(backup, "node_modules-failed"), planPath = path.join(backup, "dependency-recovery.json");
  check(!fs.existsSync(original) && !fs.existsSync(failed) && !fs.existsSync(planPath), "Dependency recovery targets must not exist");
  const oldFingerprint = dependencyTree(live), newFingerprint = dependencyTree(staged);
  const owner = fs.statSync(live);
  // npm ci ran isolated under root, but the service user must be able to read
  // its output even with the installer's private umask. Never follow symlinks.
  if (process.platform !== "win32") {
    const chown = target => {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) fs.lchownSync(target, owner.uid, owner.gid);
      else {
        fs.chownSync(target, owner.uid, owner.gid);
        fs.chmodSync(target, stat.isDirectory() ? 0o755 : (stat.mode & 0o111) ? 0o755 : 0o644);
        if (stat.isDirectory()) for (const name of fs.readdirSync(target)) chown(path.join(target, name));
      }
    };
    chown(staged);
  }
  fs.writeFileSync(planPath, JSON.stringify({ release: RELEASE, api, staged, backup, oldFingerprint, newFingerprint }, null, 2), { flag: "wx", mode: 0o600 });
  return { dependencies: "prepared", previous: oldFingerprint, staged: newFingerprint };
}
function dependencyPlan(apiRoot, backupRoot) {
  const api = safePath(apiRoot, "directory"), backup = safePath(backupRoot, "directory"), plan = JSON.parse(read(path.join(backup, "dependency-recovery.json")));
  check(plan.release === RELEASE && plan.api === api && plan.backup === backup && typeof plan.staged === "string" && isHash(plan.oldFingerprint?.sha256) && isHash(plan.newFingerprint?.sha256), "Invalid dependency recovery plan");
  return { ...plan, live: path.join(api, "node_modules"), original: path.join(backup, "node_modules-original"), failed: path.join(backup, "node_modules-failed") };
}
function applyDependencySwap(apiRoot, backupRoot) {
  const plan = dependencyPlan(apiRoot, backupRoot);
  check(!fs.existsSync(plan.original) && !fs.existsSync(plan.failed), "Dependency swap already started");
  check(dependencyTree(plan.live).sha256 === plan.oldFingerprint.sha256 && dependencyTree(plan.staged).sha256 === plan.newFingerprint.sha256, "Dependency tree changed after preflight");
  fs.renameSync(plan.live, plan.original);
  // If the next rename fails, rollback recognises the absent live tree and
  // restores the untouched original directory. No recursive deletion is used.
  fs.renameSync(plan.staged, plan.live);
  check(dependencyTree(plan.live).sha256 === plan.newFingerprint.sha256, "Installed dependency fingerprint mismatch");
  return { dependencies: "installed", previousDirectoryRetained: true };
}
function rollbackDependencySwap(apiRoot, backupRoot) {
  const plan = dependencyPlan(apiRoot, backupRoot);
  if (!fs.existsSync(plan.original)) {
    check(fs.existsSync(plan.live) && dependencyTree(plan.live).sha256 === plan.oldFingerprint.sha256, "Original dependencies are missing; manual recovery required");
    return { dependencies: "original-already-active" };
  }
  check(dependencyTree(plan.original).sha256 === plan.oldFingerprint.sha256, "Original dependency backup changed");
  if (fs.existsSync(plan.live)) {
    check(dependencyTree(plan.live).sha256 === plan.newFingerprint.sha256, "Live dependencies changed outside deployment; refusing overwrite");
    check(!fs.existsSync(plan.failed), "Failed dependency recovery target already exists");
    fs.renameSync(plan.live, plan.failed);
  }
  fs.renameSync(plan.original, plan.live);
  check(dependencyTree(plan.live).sha256 === plan.oldFingerprint.sha256, "Dependency rollback verification failed");
  return { dependencies: "restored", failedDirectoryRetained: fs.existsSync(plan.failed) };
}
async function aiSmoke(apiRoot, scratchRoot) {
  const root = safePath(apiRoot, "directory"), scratch = safePath(scratchRoot, "directory");
  const within = (a, b) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); };
  check(!within(root, scratch) && !within(scratch, root) && fs.readdirSync(scratch).length === 0, "Smoke scratch must be empty and separate");
  const load = name => import(pathToFileURL(safePath(path.join(root, "src", name))).href);
  const [{ createApp }, { createDatabase }, { signToken }] = await Promise.all([load("app.js"), load("database.js"), load("security.js")]);
  const database = createDatabase(":memory:"), now = new Date().toISOString(), secret = "learning-voice-isolated-smoke-only";
  let server, providerCalls = 0;
  try {
    database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('reader','Smoke reader','+85267770921','participant','x','x',?,?)").run(now, now);
    database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key='smoke-key-never-sent' WHERE id='default'").run();
    server = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, "equipment"), mediaUploadDir: path.join(scratch, "media"), mediaSeedDir: null,
      deepSeekClientFactory: () => ({ chat: { completions: { create: async body => {
        providerCalls++;
        assert.equal(body.model, "deepseek-v4-flash");
        assert.ok(body.messages.every(message => typeof message.content === "string"), "No multimodal input reaches provider");
        return { choices: [{ message: { content: JSON.stringify({ reply: "Hello! How can I help?", recommendations: [] }) } }] };
      } } } }) }).listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const request = async (body, authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${signToken({ id: "reader" }, secret)}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await request({ message: "Hello" }, false)).status, 401);
    for (const locale of ["zh", "en"]) {
      const photo = await request({ message: "Hello", imageData: "data:image/jpeg;base64,/9j/2Q==", locale });
      assert.equal(photo.status, 400); assert.equal(photo.data.error, "aiImageInputRetired"); assert.equal(photo.data.deepSeekUsed, false);
      assert.deepEqual(photo.data.recommendations, []); assert.equal(providerCalls, 0);
      const malformed = await request({ imageData: "invalid", locale }); assert.equal(malformed.status, 400); assert.equal(malformed.data.error, "aiImageInputRetired");
    }
    const guide = await request({ message: "太極揉推器怎麼使用？", locale: "zh" });
    assert.equal(guide.status, 200); assert.equal(guide.data.deepSeekUsed, false); assert.equal(guide.data.recommendations[0].id, "0"); assert.equal(providerCalls, 0);
    const knee = await request({ message: "膝頭哥痛可以用什麼戶外儀器", locale: "zh" });
    assert.equal(knee.status, 200); assert.equal(knee.data.deepSeekUsed, false); assert.equal(knee.data.evidencePolicy, "app-symptom-v1");
    assert.ok(knee.data.recommendations.every(item => item.id !== "28")); assert.equal(providerCalls, 0);
    const greeting = await request({ message: "Hello", locale: "en", imageData: "" });
    assert.equal(greeting.status, 200); assert.deepEqual(greeting.data.recommendations, []); assert.equal(providerCalls, 1);
    return { smoke: "passed", database: "memory", textGuideAndSymptoms: "verified", retiredImages: "400 without provider calls", mockProviderCalls: providerCalls, externalAiCalls: 0 };
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); }
}

async function tcmSmoke(apiRoot, scratchRoot) {
  const root = safePath(apiRoot, "directory"), scratch = safePath(scratchRoot, "directory");
  const relative = path.relative(root, scratch);
  check(relative && (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) && fs.readdirSync(scratch).length === 0, "TCM smoke requires empty independent scratch");
  const { createDatabase } = await import(pathToFileURL(safePath(path.join(root, "src/database.js"))).href);
  const content = JSON.parse(read(path.join(root, "src/tcmV24Content.json")));
  const evidence = JSON.parse(read(path.join(root, "src/equipmentGuideEvidence.json")));
  assert.equal(content.items.length, 9);
  const databasePath = path.join(scratch, "smoke.sqlite");
  let database = createDatabase(databasePath);
  try {
    for (const item of content.items) {
      const row = database.prepare("SELECT tcm_zh,tcm_en FROM app_equipment_items WHERE id=?").get(String(item.id));
      assert.equal(row.tcm_zh, item.tcmZh); assert.equal(row.tcm_en, item.tcmEn);
      assert.equal(evidence[String(item.id)].zh.tcmTip, item.tcmZh);
      assert.equal(evidence[String(item.id)].en.tcmTip, item.tcmEn);
    }
    database.prepare("UPDATE app_equipment_items SET tcm_zh=? WHERE id='0'").run("Later administrator edit");
    database.close(); database = null;
    database = createDatabase(databasePath);
    assert.equal(database.prepare("SELECT tcm_zh FROM app_equipment_items WHERE id='0'").get().tcm_zh, "Later administrator edit");
    return { smoke: "passed", revision: content.revision, equipment: 9, languages: 2, repeatStartupPreservesEdits: true, externalAiCalls: 0 };
  } finally { if (database) database.close(); }
}
async function feedbackSmoke(apiRoot, scratchRoot) {
  const root = safePath(apiRoot, "directory"), scratch = safePath(scratchRoot, "directory");
  const within = (a, b) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); };
  check(!within(root, scratch) && !within(scratch, root) && fs.readdirSync(scratch).length === 0, "Smoke scratch must be empty and separate");
  const load = name => import(pathToFileURL(safePath(path.join(root, "src", name))).href);
  const [{ createApp }, { createDatabase }, { signToken }] = await Promise.all([load("app.js"), load("database.js"), load("security.js")]);
  const database = createDatabase(":memory:"), now = new Date().toISOString(), secret = "contact-release-isolated-smoke-only";
  let server;
  try {
    for (const [index, [id, role, permissions]] of [["reader", "operator", ["feedback.read"]], ["editor", "operator", ["feedback.read", "feedback.manage"]], ["blocked", "operator", []], ["admin", "admin", []]].entries()) {
      database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','x','x',?,?)").run(id, id, `+8526777000${index}`, now, now);
      database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)").run(id, role, JSON.stringify(permissions), now, now);
    }
    server = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, "equipment"), mediaUploadDir: path.join(scratch, "media"), mediaSeedDir: null,
      deepSeekClientFactory: () => { throw new Error("External AI must not run in feedback smoke"); } }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const request = async (url, method = "GET", body, actor) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${signToken({ id: actor }, secret)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      return { status: response.status, data: await response.json() };
    };
    const body = { submissionId: crypto.randomUUID(), name: "Release smoke", email: "smoke@example.invalid", subject: "Test only", message: "Feedback integration smoke", locale: "en", userId: "admin" };
    const created = await request("/api/feedback", "POST", body); assert.equal(created.status, 201);
    assert.equal((await request("/api/feedback", "POST", body)).status, 200);
    assert.equal((await request("/api/feedback", "POST", { ...body, message: "changed" })).status, 409);
    const list = await request("/api/admin/feedback", "GET", null, "reader"); assert.equal(list.status, 200); assert.equal(list.data.pagination.total, 1);
    const item = list.data.items[0]; assert.equal(item.userId, null); assert.equal(item.isGuest, true);
    assert.equal((await request("/api/admin/feedback", "GET")).status, 401);
    assert.equal((await request("/api/admin/feedback", "GET", null, "blocked")).status, 403);
    const update = { status: "resolved", notes: "Smoke handled", expectedUpdatedAt: item.updatedAt };
    assert.equal((await request(`/api/admin/feedback/${item.id}`, "PATCH", update, "reader")).status, 403);
    assert.equal((await request(`/api/admin/feedback/${item.id}`, "PATCH", update, "editor")).status, 200);
    assert.equal((await request(`/api/admin/feedback/${item.id}`, "PATCH", update, "editor")).status, 409);
    assert.equal((await request(`/api/admin/feedback/${item.id}`, "GET", null, "admin")).data.feedback.status, "resolved");
    assert.equal(database.prepare("SELECT COUNT(*) n FROM feedback").get().n, 1);
    assert.ok(!JSON.stringify(database.prepare("SELECT metadata_json FROM system_logs WHERE action LIKE 'feedback.%'").all()).includes(body.email));
    return { smoke: "passed", database: "memory", feedback: "submit/idempotency/identity/permissions/pagination/update/conflict verified", externalAiCalls: 0 };
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); }
}

async function adminSmoke(apiRoot, scratchRoot) {
  const root = safePath(apiRoot, "directory"), scratch = safePath(scratchRoot, "directory");
  const within = (a, b) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); };
  check(!within(root, scratch) && !within(scratch, root) && fs.readdirSync(scratch).length === 0, "Admin smoke scratch must be empty and separate");
  const load = name => import(pathToFileURL(safePath(path.join(root, "src", name))).href);
  const [{ createApp }, { createDatabase }, { signToken }, documentImport] = await Promise.all([load("app.js"), load("database.js"), load("security.js"), load("equipmentDocumentImport.js")]);
  const database = createDatabase(":memory:"), now = new Date().toISOString(), secret = "admin-release-isolated-smoke-only", calls = [];
  let server;
  try {
    assert.equal(typeof documentImport.createEquipmentDocumentImport, "function");
    assert.equal(typeof documentImport.parseEquipmentDocumentXml, "function");
    for (const table of ["equipment_document_previews", "equipment_document_commits"]) assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    for (const [index, [id, permissions]] of [["ai", ["admin_assistant.use"]], ["equipment", ["app_maintenance.equipment.manage"]], ["blocked", []]].entries()) {
      database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?, 'PRIVATE_USER_SENTINEL', ?, 'staff', 'PRIVATE_PASSWORD_SENTINEL', 'PRIVATE_PASSWORD_SENTINEL', ?, ?)").run(id, `+8526777000${index}`, now, now);
      database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,1,?,?)").run(id, JSON.stringify(permissions), now, now);
    }
    database.prepare("UPDATE ai_configuration SET provider='deepseek',model='deepseek-v4-flash',api_key='PRIVATE_KEY_SENTINEL' WHERE id='default'").run();
    server = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, "equipment"), mediaUploadDir: path.join(scratch, "media"), mediaSeedDir: null,
      deepSeekClientFactory: ({ apiKey }) => {
        assert.equal(apiKey, "PRIVATE_KEY_SENTINEL");
        return { chat: { completions: { create: async body => {
          calls.push(structuredClone(body));
          return { choices: [{ message: { content: JSON.stringify({ reply: "請審閱以下教學草稿。", draft: "雙腳站穩，保持姿勢良好。", guideReferences: [] }) } }] };
        } } } };
      } }).listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const request = async (route, body, actor = "ai", headers = {}, raw) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${signToken({ id: actor }, secret)}` } : {}), ...headers }, body: raw ?? JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return { status: response.status, data: await response.json() };
    };
    const input = { message: "請整理教學草稿", history: [], locale: "zh", documentText: "雙腳站穩，保持姿勢良好。" };
    for (const endpoint of ["assistant/preview", "assistant/chat"]) {
      assert.equal((await request(endpoint, input, null)).status, 401);
      assert.equal((await request(endpoint, input, "blocked")).status, 403);
      assert.equal((await request(endpoint, input, "equipment")).status, 403);
    }
    for (const field of ["message", "documentText"]) {
      const rejected = await request("assistant/preview", { ...input, [field]: "聯絡電郵：private@example.invalid" });
      assert.equal(rejected.status, 400); assert.equal(rejected.data.error, "adminAssistantSensitiveContent");
    }
    assert.equal((await request("assistant/chat", input)).data.error, "adminAssistantPreviewRequired");
    assert.equal(calls.length, 0);
    const preview = await request("assistant/preview", input);
    assert.equal(preview.status, 200); assert.equal(preview.data.summary.writesAllowed, false); assert.equal(preview.data.summary.sensitiveDataAllowed, false); assert.equal(calls.length, 0);
    const confirmed = { ...input, previewToken: preview.data.previewToken };
    const answer = await request("assistant/chat", confirmed);
    assert.equal(answer.status, 200); assert.equal(answer.data.draftOnly, true); assert.equal(answer.data.published, false); assert.equal(calls.length, 1);
    assert.equal((await request("assistant/chat", confirmed)).status, 409);
    const sent = JSON.stringify(calls);
    for (const forbidden of ["PRIVATE_USER_SENTINEL", "PRIVATE_PASSWORD_SENTINEL", "PRIVATE_KEY_SENTINEL", "+8526777000", "private@example.invalid"]) assert.ok(!sent.includes(forbidden));
    assert.ok(calls[0].tools.every(tool => ["search_facility_guide", "get_facility_guide"].includes(tool.function.name)));
    for (const endpoint of ["equipment/import/preview", "equipment/import/confirm"]) {
      assert.equal((await request(endpoint, {}, null)).status, 401);
      assert.equal((await request(endpoint, {}, "ai")).status, 403);
    }
    assert.equal((await request("equipment/import/preview", null, "equipment", { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "X-Document-Name": "synthetic-smoke.docx" }, "not a document archive")).status, 400);
    assert.equal((await request("equipment/import/confirm", { actorId: "ai" }, "equipment")).status, 400);
    for (const table of ["equipment_document_previews", "equipment_document_commits"]) assert.equal(database.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    assert.equal(calls.length, 1);
    return { smoke: "passed", database: "memory", adminAi: "permission/preview/confirmation/privacy/draft-only verified", documentImport: "schema/permissions/invalid-input/no-writes verified", mockProviderCalls: calls.length, externalAiCalls: 0 };
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); }
}

module.exports = { RELEASE, BASELINES, PAYLOADS, ROOT_FILES, INVENTORIES, payloadPath, safeRelative, safePath, validWebPath, webInventory, verifyPackage, verifyBaseline, verifyWebTarget, verifyInstalledWeb, backupDeployment, applyDeployment, rollbackDeployment, feedbackSmoke, tcmSmoke, aiSmoke, adminSmoke, relativeDependencyLink, dependencyTree, prepareDependencySwap, applyDependencySwap, rollbackDependencySwap };
if (require.main === module) {
  const watchdog = setTimeout(() => { process.stderr.write("Release verification timed out\n"); process.exit(1); }, 120000); watchdog.unref();
  (async () => {
    const [command, ...args] = process.argv.slice(2); let result;
    if (command === "package" && args.length === 1) { verifyPackage(...args); result = { package: "verified", release: RELEASE }; }
    else if (command === "baseline" && args.length === 2) result = verifyBaseline(...args);
    else if (command === "web-inventory" && args.length === 1) result = webInventory(...args);
    else if (command === "web-target" && args.length === 2) result = verifyWebTarget(...args);
    else if (command === "web-installed" && args.length === 2) result = verifyInstalledWeb(...args);
    else if (command === "runtime" && args.length === 1) result = prior.runtime(...args);
    else if (command === "ai-smoke" && args.length === 2) result = await aiSmoke(...args);
    else if (command === "tcm-smoke" && args.length === 2) result = await tcmSmoke(...args);
    else if (command === "feedback-smoke" && args.length === 2) result = await feedbackSmoke(...args);
    else if (command === "admin-smoke" && args.length === 2) result = await adminSmoke(...args);
    else if (command === "backup" && args.length === 5) result = backupDeployment(...args);
    else if (command === "apply" && args.length === 4) result = applyDeployment(...args);
    else if (command === "rollback" && args.length === 4) result = rollbackDeployment(...args);
    else if (command === "dependencies-prepare" && args.length === 3) result = prepareDependencySwap(...args);
    else if (command === "dependencies-apply" && args.length === 2) result = applyDependencySwap(...args);
    else if (command === "dependencies-rollback" && args.length === 2) result = rollbackDependencySwap(...args);
    else if (command === "dependencies-tree" && args.length === 1) result = dependencyTree(...args);
    else throw new Error("Unsupported verifier command/arguments");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Admin document/voice release check failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
