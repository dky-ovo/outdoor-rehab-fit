#!/usr/bin/env node
"use strict";

// A standalone complete Web + one JSON catalog patch. No historical archive,
// production config, database import or dependency installer is used.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const RELEASE = "team-about-20260924";
const INSTALLER = "install-team-about-20260924.sh";
const ROOT_FILES = [INSTALLER, "verify-team-about-release.cjs", "release-manifest.json", "README.md", "appTextCatalog.json"];
const SUPPORT_FILES = ["src/index.js", "src/app.js", "src/appTexts.js", "src/adminPagination.js", "package.json"];
// Reviewed package metadata variants: the only difference is the optional local
// mysql2 3.24.4 dependency. This catalog-only release never installs dependencies
// or replaces package.json; all four runtime source files must still match.
const REVIEWED_PACKAGE_HASHES = new Set([
  "dba7e32f1722f1060d614ec705ce9314d73aa065852744b8680a2da1790b4600",
  "d89cedf2ca1c6c6f45dad134d7cfdb3b6d29a2d8e1a937170f6c57ea7996e644",
]);
function supportedSourceHash(name, current, expected) {
  if (name === "package.json") return REVIEWED_PACKAGE_HASHES.has(current) && REVIEWED_PACKAGE_HASHES.has(expected);
  return current === expected;
}
const CATALOG_PATH = "src/appTextCatalog.json";
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
  exact(manifest, ["version", "release", "web", "catalog", "support"], "Team/About release manifest");
  check(manifest.version === 1 && manifest.release === RELEASE && Array.isArray(manifest.web), "Invalid Team/About release");
  exact(manifest.catalog, ["path", "archive", "sha256", "bytes"], "Catalog payload");
  check(manifest.catalog.path === CATALOG_PATH && manifest.catalog.archive === "appTextCatalog.json" && manifest.catalog.sha256 === hash(files["appTextCatalog.json"]) && manifest.catalog.bytes === files["appTextCatalog.json"].length, "Only the checksummed text catalog may be patched");
  validateCatalog(files["appTextCatalog.json"], true);
  exact(manifest.support, SUPPORT_FILES, "Supported backend inventory");
  for (const digest of Object.values(manifest.support)) check(/^[a-f0-9]{64}$/.test(digest), "Invalid support hash");
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
  const temporary = path.join(path.dirname(target), `.team-about-${crypto.randomUUID()}.tmp`);
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
function validateCatalog(bytes, requireTeam = false) {
  const catalog = JSON.parse(bytes);
  exact(catalog, ["version", "items"], "Text catalog");
  check(catalog.version === 1 && Array.isArray(catalog.items) && catalog.items.length > 0 && catalog.items.length <= 10000, "Unsupported text catalog");
  const items = new Map();
  for (const item of catalog.items) {
    exact(item, ["key", "group", "label", "kind", "zh", "en", "sources"], "Text entry");
    check(typeof item.key === "string" && /^[A-Za-z0-9_.-]+$/.test(item.key) && !item.key.split(".").some(v => ["__proto__", "constructor", "prototype"].includes(v)) && !items.has(item.key), "Invalid or duplicate text key");
    check(["text", "url"].includes(item.kind) && typeof item.group === "string" && typeof item.label === "string" && Array.isArray(item.sources) && item.sources.every(value => typeof value === "string"), "Invalid text metadata");
    for (const locale of ["zh", "en"]) check(item[locale] === null || typeof item[locale] === "string" && item[locale].length <= 20000, "Invalid catalog language");
    check(item.zh !== null || item.en !== null, "Text entry has no language");
    items.set(item.key, item);
  }
  if (requireTeam) {
    for (const prefix of ["privacy.", "teamInfo."]) {
      const entries = [...items.values()].filter(item => item.key.startsWith(prefix));
      check(entries.length > 0 && entries.every(item => typeof item.zh === "string" && item.zh.trim() && typeof item.en === "string" && item.en.trim()), `Bilingual ${prefix} catalog missing`);
    }
  }
  return items;
}
function supportInventory(api) {
  safePath(api, "directory");
  const files = Object.fromEntries(SUPPORT_FILES.map(name => [name, read(path.join(api, name), 8 * 1024 * 1024)]));
  const app = files["src/app.js"].toString(), helper = files["src/appTexts.js"].toString();
  check(/import\s*\{\s*registerAppTexts\s*\}\s*from\s*["']\.\/appTexts\.js["']/.test(app) && /registerAppTexts\(\{\s*app,\s*database,\s*requirePermission,\s*writeSystemLog\s*\}\)/.test(app), "Backend does not register the supported text API");
  check(helper.includes("new URL('./appTextCatalog.json', import.meta.url)") && helper.includes("'/api/app-texts'") && helper.includes("'/api/admin/app-texts'") && helper.includes("catalog.items.map"), "Backend does not support the reviewed JSON catalog");
  check(JSON.parse(files["package.json"]).type === "module", "Backend module mode is incompatible");
  return Object.fromEntries(SUPPORT_FILES.map(name => [name, hash(files[name])]));
}
function verifyBackend(api, stage) {
  const manifest = verifyPackage(stage), support = supportInventory(api);
  for (const name of SUPPORT_FILES) check(supportedSourceHash(name, support[name], manifest.support[name]), `Unsupported backend source: ${name}; no files changed`);
  const oldBytes = read(path.join(api, CATALOG_PATH), 8 * 1024 * 1024);
  const current = validateCatalog(oldBytes), incoming = validateCatalog(read(path.join(stage, "appTextCatalog.json"), 8 * 1024 * 1024), true);
  // Add the team copy and preserve every existing key, field kind and default.
  // Catalog labels, group names and source labels may be clarified when old APP
  // keys are retained for compatibility; they are not administrator text values.
  for (const [key, item] of current) {
    const next = incoming.get(key);
    check(next && ["kind", "zh", "en"].every(field => next[field] === item[field]), `Existing text default differs or would be removed: ${key}`);
  }
  return { support, catalog: hash(oldBytes), state: hash(oldBytes) === manifest.catalog.sha256 ? "installed" : "compatible" };
}
function runtime(pid, api) {
  check(process.platform === "linux" && /^[1-9][0-9]*$/.test(String(pid)), "Linux service PID required");
  const root = safePath(api, "directory"), proc = `/proc/${pid}`;
  check(fs.readlinkSync(`${proc}/cwd`) === root, "Running service cwd is not the expected API directory");
  const args = fs.readFileSync(`${proc}/cmdline`).toString().split("\0").filter(Boolean);
  check(args.length === 2 && path.resolve(root, args[1]) === path.join(root, "src", "index.js"), "Running service does not execute the expected API entrypoint");
  const node = fs.readlinkSync(`${proc}/exe`);
  check(path.basename(node) === "node", "Running service is not Node");
  return { cwd: root, entrypoint: path.join(root, "src", "index.js"), node };
}
function catalogRecovery(api, web, stage, backup) {
  separateRoots(api, web, stage); separateRoots(api, stage, backup); separateRoots(web, stage, backup);
  const manifest = verifyPackage(stage), plan = JSON.parse(read(path.join(backup, "catalog-recovery.json"), 8 * 1024 * 1024));
  exact(plan, ["release", "api", "web", "catalog", "support"], "Catalog recovery");
  check(plan.release === RELEASE && plan.api === path.resolve(api) && plan.web === path.resolve(web), "Catalog recovery root mismatch");
  exact(plan.catalog, ["sha256", "mode", "uid", "gid"], "Catalog recovery metadata");
  for (const key of ["mode", "uid", "gid"]) check(Number.isInteger(plan.catalog[key]) && plan.catalog[key] >= 0, "Invalid recovery ownership");
  check(plan.catalog.mode <= 0o777 && hash(read(path.join(backup, "appTextCatalog.json"), 8 * 1024 * 1024)) === plan.catalog.sha256, "Catalog recovery checksum mismatch");
  exact(plan.support, SUPPORT_FILES, "Recovery support inventory");
  const support = supportInventory(api);
  for (const name of SUPPORT_FILES) check(supportedSourceHash(name, support[name], manifest.support[name]) && support[name] === plan.support[name], `Backend changed during deployment: ${name}`);
  return plan;
}
function backup(api, web, stage, directory) {
  separateRoots(api, web, stage); separateRoots(api, stage, directory); separateRoots(web, stage, directory);
  const state = verifyBackend(api, stage); verifyTarget(web, stage);
  check(fs.readdirSync(directory).length === 0, "Backup directory must be empty");
  const source = path.join(api, CATALOG_PATH), stat = fs.statSync(source), bytes = read(source, 8 * 1024 * 1024);
  check(hash(bytes) === state.catalog, "Catalog changed during backup");
  fs.writeFileSync(path.join(directory, "appTextCatalog.json"), bytes, { flag: "wx", mode: 0o600 });
  const webBackup = path.join(directory, "web-deployment"); fs.mkdirSync(webBackup, { mode: 0o700 });
  backupDeployment(web, stage, webBackup);
  const plan = { release: RELEASE, api: path.resolve(api), web: path.resolve(web), catalog: { sha256: state.catalog, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }, support: state.support };
  fs.writeFileSync(path.join(directory, "catalog-recovery.json"), JSON.stringify(plan), { flag: "wx", mode: 0o600 });
  return { backup: "complete", catalogFiles: 1, webFiles: verifyPackage(stage).web.length };
}
function checkWebRecoveryTarget(web, stage, directory, allowIncoming) {
  const plan = recoveryPlan(web, stage, directory), manifest = verifyPackage(stage), incoming = new Map(manifest.web.map(item => [item.path, item.sha256]));
  for (const entry of plan.entries) {
    const target = safePath(path.join(web, entry.path), "file", true), current = fs.existsSync(target) ? hash(read(target)) : null;
    check(current === (entry.exists ? entry.sha256 : null) || allowIncoming && current === incoming.get(entry.path), "Concurrent target change prevents deployment/recovery");
  }
}
function apply(api, web, stage, directory) {
  const plan = catalogRecovery(api, web, stage, directory), manifest = verifyPackage(stage);
  verifyBackend(api, stage); verifyTarget(web, stage);
  check(hash(read(path.join(api, CATALOG_PATH))) === plan.catalog.sha256, "Catalog changed after backup");
  checkWebRecoveryTarget(web, stage, path.join(directory, "web-deployment"), false);
  atomicFile(path.join(api, CATALOG_PATH), read(path.join(stage, "appTextCatalog.json")), plan.catalog, plan.catalog.mode);
  applyDeployment(web, stage, path.join(directory, "web-deployment"));
  return installed(api, web, stage);
}
function installed(api, web, stage) {
  check(verifyBackend(api, stage).state === "installed", "Installed catalog hash mismatch");
  verifyInstalled(web, stage);
  return { installed: RELEASE, catalogFiles: 1, webFiles: verifyPackage(stage).web.length, database: "untouched", uploads: "untouched" };
}
function rollback(api, web, stage, directory) {
  const plan = catalogRecovery(api, web, stage, directory), manifest = verifyPackage(stage);
  const current = hash(read(path.join(api, CATALOG_PATH)));
  check(current === plan.catalog.sha256 || current === manifest.catalog.sha256, "Concurrent catalog change prevents recovery");
  checkWebRecoveryTarget(web, stage, path.join(directory, "web-deployment"), true);
  // Validate every recovery target before restoring either scope.
  rollbackDeployment(web, stage, path.join(directory, "web-deployment"));
  atomicFile(path.join(api, CATALOG_PATH), read(path.join(directory, "appTextCatalog.json")), plan.catalog, plan.catalog.mode);
  check(hash(read(path.join(api, CATALOG_PATH))) === plan.catalog.sha256, "Restored catalog checksum mismatch");
  return { rollback: "catalog-and-web-only", database: "untouched", uploads: "untouched" };
}
module.exports = { RELEASE, INSTALLER, ROOT_FILES, SUPPORT_FILES, CATALOG_PATH, webInventory, verifyPackage, verifyTarget, validateCatalog, supportInventory, verifyBackend, backup, apply, installed, rollback, runtime };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const handlers = { "web-inventory": [webInventory, 1], "support-inventory": [supportInventory, 1], package: [verifyPackage, 1], target: [verifyTarget, 2], backend: [verifyBackend, 2], backup: [backup, 4], apply: [apply, 4], installed: [installed, 3], rollback: [rollback, 4], runtime: [runtime, 2] };
    check(handlers[command] && handlers[command][1] === args.length, "Unsupported Team/About release command/arguments");
    const result = handlers[command][0](...args);
    process.stdout.write(`${JSON.stringify(command === "package" || command === "target" ? { verified: command, files: result.web.length } : result)}\n`);
  } catch (error) { process.stderr.write(`Team/About release check failed: ${error.message}\n`); process.exitCode = 1; }
}
