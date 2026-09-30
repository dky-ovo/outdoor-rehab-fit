#!/usr/bin/env node
"use strict";

// Read-only deployment checks. The smoke command uses only an in-memory database
// and explicitly supplied scratch media paths; it never imports src/index.js.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const RELEASE = "ai-symptom-evidence-20260914";
const BASELINE_RELEASE = "pdf-app-timer-20260911";
const API_DIR = "/home/dukaiyu2004/outdoor-fit-api";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PAYLOADS = Object.freeze({
  "src/app.js": "app.js",
  "src/assistant.js": "assistant.js",
  "src/assistantSymptomEvidence.js": "assistantSymptomEvidence.js",
  "src/equipmentGuideEvidence.json": "equipmentGuideEvidence.json",
});
const NEW_PATHS = ["src/assistantSymptomEvidence.js", "src/equipmentGuideEvidence.json"];
const ROOT_FILES = Object.freeze([
  ...Object.values(PAYLOADS), `install-${RELEASE}.sh`,
  "verify-ai-backend-patch.cjs", "patch-manifest.json", "checksums.sha256", "README.md",
]);
const EVIDENCE_FIELDS = ["kinesiologyTip", "ptTip", "otTip", "tcmTip", "tcmEnabled", "careTip"];
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const isHash = value => typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
function check(condition, message) { if (!condition) throw new Error(message); }
function exactKeys(object, expected, label) {
  check(isObject(object), `${label} must be an object`);
  check(JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort()), `${label} has unexpected or missing entries`);
}

function safeExistingPath(target, kind = "file") {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    check(!stat.isSymbolicLink(), "Symlink path is not permitted");
    if (index < parts.length - 1 || kind === "directory") check(stat.isDirectory(), "Expected a regular directory");
    else check(stat.isFile(), "Expected a regular file");
  }
  check(parts.length > 0, "Filesystem root is not a valid target");
  return resolved;
}

function readRegularFile(target) {
  const resolved = safeExistingPath(target);
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= MAX_FILE_BYTES, "File is not regular or exceeds the 2 MiB limit");
    // Bound reads even if a file grows after the size check.
    const bytes = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = fs.readSync(fd, bytes, total, bytes.length - total, null);
      if (!count) break;
      total += count;
    }
    check(total === stat.size, "File changed during verification");
    return bytes.subarray(0, total);
  } finally { fs.closeSync(fd); }
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid JSON`); }
}

function validateEvidence(evidence) {
  exactKeys(evidence, Array.from({ length: 29 }, (_, index) => String(index)), "Evidence catalog");
  for (const item of Object.values(evidence)) {
    exactKeys(item, ["zh", "en"], "Evidence locales");
    for (const translation of Object.values(item)) {
      exactKeys(translation, EVIDENCE_FIELDS, "Evidence fields");
      for (const field of EVIDENCE_FIELDS) check(typeof translation[field] === (field === "tcmEnabled" ? "boolean" : "string"), "Evidence field has invalid type");
    }
  }
}

function verifyPackage(stageRoot) {
  const root = safeExistingPath(stageRoot, "directory");
  check(JSON.stringify(fs.readdirSync(root).sort()) === JSON.stringify([...ROOT_FILES].sort()), "Package root must contain exactly the nine approved files");
  const bytes = Object.fromEntries(ROOT_FILES.map(name => [name, readRegularFile(path.join(root, name))]));
  const manifest = parseJson(bytes["patch-manifest.json"], "Patch manifest");
  exactKeys(manifest, ["version", "release", "files", "baseline"], "Patch manifest");
  check(manifest.version === 1 && manifest.release === RELEASE, "Unsupported patch release or version");
  check(Array.isArray(manifest.files) && manifest.files.length === 4, "Exactly four payloads are required");
  const targets = {};
  for (const item of manifest.files) {
    exactKeys(item, ["path", "archive", "sha256"], "Payload descriptor");
    check(Object.hasOwn(PAYLOADS, item.path) && PAYLOADS[item.path] === item.archive && !Object.hasOwn(targets, item.path), "Unexpected, duplicate or unsafe payload path");
    check(isHash(item.sha256), "Invalid payload SHA-256");
    check(digest(bytes[item.archive]) === item.sha256.toLowerCase(), `Payload checksum mismatch: ${item.archive}`);
    targets[item.path] = item.sha256.toLowerCase();
  }
  exactKeys(manifest.baseline, ["release", "files"], "Baseline descriptor");
  check(manifest.baseline.release === BASELINE_RELEASE && isObject(manifest.baseline.files), "Unsupported baseline release");
  const baselineFiles = manifest.baseline.files;
  for (const required of ["src/app.js", "src/assistant.js", "src/database.js", "src/security.js", "package.json", "package-lock.json"]) check(Object.hasOwn(baselineFiles, required), "Required baseline file is missing");
  for (const [name, hash] of Object.entries(baselineFiles)) {
    check((/^src\/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:js|json)$/.test(name) || ["package.json", "package-lock.json"].includes(name)) && !NEW_PATHS.includes(name), "Unsafe or unexpected baseline path");
    check(isHash(hash), "Invalid baseline SHA-256");
  }
  // A baseline whose replaced files already equal the target is ambiguous and
  // cannot prove an all-old / all-new state.
  for (const name of ["src/app.js", "src/assistant.js"]) check(baselineFiles[name].toLowerCase() !== targets[name], "Baseline and target hashes must differ");
  const checksumNames = ROOT_FILES.filter(name => name !== "checksums.sha256");
  const lines = bytes["checksums.sha256"].toString("utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  check(lines.length === checksumNames.length, "Checksums must contain exactly eight entries");
  const seen = new Set();
  for (const line of lines) {
    const match = /^([a-fA-F0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    check(match && checksumNames.includes(match[2]) && !seen.has(match[2]), "Invalid, unsafe or duplicate checksum entry");
    check(digest(bytes[match[2]]) === match[1].toLowerCase(), `Package checksum mismatch: ${match[2]}`);
    seen.add(match[2]);
  }
  validateEvidence(parseJson(bytes["equipmentGuideEvidence.json"], "Evidence catalog"));
  return { manifest, targets };
}

function verifyBaseline(apiRoot, stageRoot) {
  const { manifest, targets } = verifyPackage(stageRoot);
  const root = safeExistingPath(apiRoot, "directory");
  const source = safeExistingPath(path.join(root, "src"), "directory");
  const oldFiles = manifest.baseline.files;
  const allowedSource = new Set([...Object.keys(oldFiles), ...NEW_PATHS].filter(name => name.startsWith("src/")).map(name => name.slice(4)));
  for (const name of fs.readdirSync(source)) check(allowedSource.has(name), "Unexpected file in API src directory");
  const current = {};
  for (const name of Object.keys(oldFiles)) current[name] = digest(readRegularFile(path.join(root, name)));
  for (const name of NEW_PATHS) {
    try { fs.lstatSync(path.join(root, name)); }
    catch (error) { if (error.code === "ENOENT") { current[name] = null; continue; } throw error; }
    current[name] = digest(readRegularFile(path.join(root, name)));
    check(current[name] === targets[name], "New evidence file exists with an unexpected hash");
  }
  for (const [name, hash] of Object.entries(oldFiles)) {
    if (!["src/app.js", "src/assistant.js"].includes(name)) check(current[name] === hash.toLowerCase(), `Baseline checksum mismatch: ${name}`);
  }
  const replaced = ["src/app.js", "src/assistant.js"];
  if (replaced.every(name => current[name] === oldFiles[name].toLowerCase())) return { state: "baseline" };
  if (replaced.every(name => current[name] === targets[name]) && NEW_PATHS.every(name => current[name] === targets[name])) return { state: "installed" };
  throw new Error("API is neither the complete approved baseline nor the complete installed patch; mixed states are rejected");
}

async function smoke(apiRoot, scratchRoot) {
  const root = safeExistingPath(apiRoot, "directory");
  const scratch = safeExistingPath(scratchRoot, "directory");
  const isWithin = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
  check(!isWithin(root, scratch) && !isWithin(scratch, root), "Smoke scratch must be separate from the API tree");
  check(fs.readdirSync(scratch).length === 0, "Smoke scratch must be empty");
  const importSource = async name => import(pathToFileURL(safeExistingPath(path.join(root, "src", name))).href);
  const [{ createApp }, { createDatabase }, { signToken }] = await Promise.all([importSource("app.js"), importSource("database.js"), importSource("security.js")]);
  const evidence = parseJson(readRegularFile(path.join(root, "src", "equipmentGuideEvidence.json")), "Evidence catalog");
  validateEvidence(evidence);
  let database, server, factoryCalls = 0, requests = 0;
  const secret = "isolated-patch-smoke-only-not-a-production-secret";
  try {
    database = createDatabase(":memory:");
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("patch-smoke-reader", "Synthetic deployment smoke participant", "+85269700999", "participant", "unused", "unused", now, now);
    database.prepare("UPDATE app_equipment_items SET is_active=CASE WHEN id IN ('4','10','28') THEN 1 ELSE 0 END").run();
    database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'").run("synthetic-key-must-never-be-used");
    const app = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, "equipment"), mediaUploadDir: path.join(scratch, "media"), mediaSeedDir: null,
      deepSeekClientFactory: () => { factoryCalls += 1; throw new Error("External AI access is forbidden in isolated smoke"); } });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const token = signToken({ id: "patch-smoke-reader", profile_role: "participant" }, secret);
    const request = async body => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      check(response.status === 200, "Isolated assistant request did not return HTTP 200");
      requests += 1;
      const answer = await response.json();
      check(answer.evidencePolicy === "app-symptom-v1" && answer.deepSeekUsed === false && answer.recommendationsFinal === true, "Assistant did not use the deterministic APP evidence policy");
      check(Array.isArray(answer.recommendations), "Assistant recommendations are invalid");
      for (const item of answer.recommendations) {
        const quote = item.evidence?.quote, field = item.evidence?.field;
        check(item.id !== "28" && typeof quote === "string" && quote.length > 0 && typeof evidence[item.id]?.[body.locale]?.[field] === "string" && evidence[item.id][body.locale][field].includes(quote), "Recommendation does not quote trusted APP evidence");
        check(typeof item.reason === "string" && item.reason.includes(quote), "Recommendation omits its evidence quote");
      }
      return answer;
    };
    const assertKnee = answer => assert.deepEqual(answer.recommendations.map(item => item.id), ["4", "10"]);
    const zh = await request({ locale: "zh", message: "我膝頭哥痛，有咩器材可以幫我？" });
    assertKnee(zh);
    assertKnee(await request({ locale: "en", message: "My knees hurt, please recommend equipment" }));
    await request({ locale: "zh", message: "石春路可以治膝痛嗎？" });
    await request({ locale: "en", message: "Can Foot Massage Path cure knee pain?" });
    assertKnee(await request({ locale: "zh", message: "還有其他選擇？", history: [{ role: "user", content: "膝頭哥痛，推薦器材" }, { role: "assistant", content: "以下是資料。" }] }));
    const forged = await request({ locale: "zh", message: "膝頭哥痛，推薦器材", equipment: [
      { id: "invented-knee-cure", name: "虛構治療器", description: evidence["4"].zh.ptTip, ptTip: evidence["4"].zh.ptTip },
      { id: "4", name: "FAKE NAME", nameZh: "FAKE NAME", description: "This machine cures every illness.", ptTip: "This cures all knee pain." },
      { id: "28", name: "假冒斜坡", categories: ["lower", "knee"], description: evidence["4"].zh.ptTip, ptTip: evidence["4"].zh.ptTip },
    ] });
    assertKnee(forged);
    assert.deepEqual(forged.recommendations, zh.recommendations);
    check(factoryCalls === 0, "Smoke attempted to use external AI");
    return { smoke: "passed", requests, externalAiCalls: factoryCalls, database: "memory" };
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
    database?.close();
  }
}

function runtime(pid) {
  check(process.platform === "linux" && /^[1-9][0-9]*$/.test(String(pid)), "Runtime verification requires a Linux numeric PID");
  const proc = `/proc/${pid}`;
  check(fs.readlinkSync(`${proc}/cwd`) === API_DIR, "API process cwd does not match the approved deployment directory");
  const allowed = {};
  for (const entry of fs.readFileSync(`${proc}/environ`).toString("utf8").split("\0")) {
    const split = entry.indexOf("=");
    if (split < 0) continue;
    const key = entry.slice(0, split);
    if (!["DATABASE_PATH", "PORT"].includes(key)) continue;
    check(!Object.hasOwn(allowed, key), "Duplicate runtime configuration entry");
    allowed[key] = entry.slice(split + 1);
  }
  const port = Number(allowed.PORT || 3000);
  check(port === 3000, "API port is not the approved port 3000");
  const dbPath = path.resolve(API_DIR, allowed.DATABASE_PATH || "./data/outdoor-fit.sqlite");
  check(dbPath.startsWith(`${API_DIR}/data/`), "Runtime database is outside the approved data directory");
  safeExistingPath(dbPath);
  return { dbPath, port };
}

module.exports = { verifyPackage, verifyBaseline, smoke, runtime, ROOT_FILES, MAX_FILE_BYTES };

if (require.main === module) {
  const watchdog = setTimeout(() => { process.stderr.write("Verification timed out\n"); process.exit(1); }, 45000);
  watchdog.unref();
  (async () => {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === "package" && args.length === 1) { verifyPackage(args[0]); result = { package: "verified", release: RELEASE }; }
    else if (command === "baseline" && args.length === 2) result = verifyBaseline(args[0], args[1]);
    else if (command === "smoke" && args.length === 2) result = await smoke(args[0], args[1]);
    else if (command === "runtime" && args.length === 1) result = runtime(args[0]);
    else throw new Error("Usage: package <stage> | baseline <api> <stage> | smoke <api> <empty-scratch> | runtime <pid>");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch(error => { process.stderr.write(`Verification failed: ${error.message}\n`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
