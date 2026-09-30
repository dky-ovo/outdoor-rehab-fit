#!/usr/bin/env node
"use strict";

// The prior checker is used only for its isolated AI smoke and Linux runtime
// inspection. Its release/baseline routines are deliberately not called.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const prior = require("./verify-ai-chatbox-guide-backend-patch.cjs");
const RELEASE = "contact-feedback-20260918";
const BASELINES = ["pdf-app-timer-20260911", "ai-symptom-evidence-20260914", "ai-tcm-excerpts-20260916", "ai-tcm-prose-20260916", "ai-chatbox-guide-20260917"];
const PAYLOADS = ["app.js", "assistant.js", "assistantSymptomEvidence.js", "assistantTcm.js", "equipmentGuideEvidence.json", "assistantGuide.js", "database.js", "feedback.js"];
const ROOT_FILES = [...PAYLOADS, "install-contact-feedback-20260918.sh", "verify-contact-feedback-release.cjs", "verify-ai-chatbox-guide-backend-patch.cjs", "release-manifest.json", "checksums.sha256", "README.md"];
const INVENTORIES = [prior.ORIGINAL_FILES, prior.SEP14_FILES, prior.SEP16_FILES, prior.SEP16_PROSE_FILES, prior.INSTALLED_FILES];
const MAX_WEB_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
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
  check(manifest.version === 1 && manifest.release === RELEASE, "Unsupported contact release");
  check(Array.isArray(manifest.files) && manifest.files.length === 8, "Exactly eight backend payloads required");
  const targets = {};
  for (const item of manifest.files) {
    exact(item, ["path", "archive", "sha256"], "Payload");
    check(PAYLOADS.includes(item.archive) && item.path === `src/${item.archive}` && !Object.hasOwn(targets, item.path), "Unsafe/duplicate backend payload");
    check(isHash(item.sha256) && item.sha256 === hash(bytes[item.archive]), "Backend payload checksum mismatch");
    targets[item.path] = item.sha256;
  }
  check(Array.isArray(manifest.baselines) && manifest.baselines.length === 5, "Five reviewed baselines required");
  const seen = new Set();
  for (const baseline of manifest.baselines) {
    exact(baseline, ["release", "files"], "Baseline");
    const index = BASELINES.indexOf(baseline.release);
    check(index !== -1 && !seen.has(baseline.release), "Unknown/duplicate baseline"); seen.add(baseline.release);
    exact(baseline.files, INVENTORIES[index], "Baseline inventory");
    for (const value of Object.values(baseline.files)) check(isHash(value), "Malformed baseline hash");
  }
  for (const name of prior.ORIGINAL_FILES.filter(name => !Object.hasOwn(targets, name))) {
    check(new Set(manifest.baselines.map(item => item.files[name])).size === 1, `Unrelated baseline drift: ${name}`);
  }
  check(new Set(manifest.baselines.map(item => item.files["src/app.js"])).size === 5, "Mixed baseline releases");
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
  const installed = { ...manifest.baselines.find(item => item.release === BASELINES[4]).files, ...targets };
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
  const temporary = path.join(path.dirname(target), `.contact-feedback-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", mode);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); if (process.platform !== "win32") fs.fchownSync(fd, owner.uid, owner.gid); }
  finally { fs.closeSync(fd); }
  safePath(target, "file", true); fs.renameSync(temporary, target);
}
function backupDeployment(apiRoot, webRoot, stageRoot, backupRoot, runtimeFile) {
  verifyBaseline(apiRoot, stageRoot); verifyWebTarget(webRoot, stageRoot);
  safePath(backupRoot, "directory"); check(fs.readdirSync(backupRoot).length === 0, "Backup directory must be empty");
  const { manifest } = verifyPackage(stageRoot), runtime = JSON.parse(read(runtimeFile));
  const api = path.resolve(apiRoot), web = path.resolve(webRoot);
  const dbPath = safePath(runtime.dbPath); check(dbPath.startsWith(`${api}${path.sep}data${path.sep}`) && runtime.port === 3000, "Unapproved runtime database backup path");
  const entries = [];
  for (const [kind, root, files] of [["api", api, PAYLOADS.map(name => `src/${name}`)], ["web", web, manifest.web.map(item => item.path)]]) {
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
  const expected = [...PAYLOADS.map(name => `api:src/${name}`), ...manifest.web.map(item => `web:${item.path}`)];
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
  for (const name of PAYLOADS) atomicFile(path.join(apiRoot, "src", name), read(path.join(stageRoot, name)), 0o644, fs.statSync(path.join(apiRoot, "src", "app.js")));
  // Referenced assets first, HTML entrypoints last; retain all older assets.
  const ordered = [...manifest.web].sort((a, b) => Number(a.path.endsWith(".html")) - Number(b.path.endsWith(".html")));
  for (const item of ordered) atomicFile(path.join(webRoot, item.path), read(path.join(stageRoot, "web", item.path), MAX_WEB_BYTES), 0o644, fs.statSync(webRoot));
  return { applied: RELEASE, backendFiles: PAYLOADS.length, webFiles: manifest.web.length };
}
function rollbackDeployment(apiRoot, webRoot, stageRoot, backupRoot) {
  const plan = recoveryPlan(apiRoot, webRoot, stageRoot, backupRoot);
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

module.exports = { RELEASE, BASELINES, PAYLOADS, ROOT_FILES, INVENTORIES, safeRelative, safePath, validWebPath, webInventory, verifyPackage, verifyBaseline, verifyWebTarget, verifyInstalledWeb, backupDeployment, applyDeployment, rollbackDeployment, feedbackSmoke };
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
    else if (command === "ai-smoke" && args.length === 2) result = await prior.smoke(...args);
    else if (command === "feedback-smoke" && args.length === 2) result = await feedbackSmoke(...args);
    else if (command === "backup" && args.length === 5) result = backupDeployment(...args);
    else if (command === "apply" && args.length === 4) result = applyDeployment(...args);
    else if (command === "rollback" && args.length === 4) result = rollbackDeployment(...args);
    else throw new Error("Unsupported verifier command/arguments");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Contact release check failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
