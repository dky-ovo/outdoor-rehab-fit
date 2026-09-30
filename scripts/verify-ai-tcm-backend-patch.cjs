#!/usr/bin/env node
"use strict";

// Standalone, read-only release verification. Smoke tests explicitly use an
// in-memory database and separate scratch paths, never the production entrypoint.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const RELEASE = "ai-tcm-excerpts-20260916";
const BASELINE_RELEASES = Object.freeze(["pdf-app-timer-20260911", "ai-symptom-evidence-20260914"]);
const API_DIR = "/home/dukaiyu2004/outdoor-fit-api";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PAYLOADS = Object.freeze({
  "src/app.js": "app.js",
  "src/assistant.js": "assistant.js",
  "src/assistantSymptomEvidence.js": "assistantSymptomEvidence.js",
  "src/assistantTcm.js": "assistantTcm.js",
  "src/equipmentGuideEvidence.json": "equipmentGuideEvidence.json",
});
const ORIGINAL_FILES = Object.freeze([
  "package.json", "package-lock.json", "src/adminPagination.js", "src/app.js", "src/assistant.js",
  "src/config.js", "src/database.js", "src/educationVideoCodes.js", "src/educationVideoImport.js",
  "src/equipmentCatalog.js", "src/equipmentCategories.js", "src/facilities.js", "src/grant-super-admin.js",
  "src/index.js", "src/mediaFileOperations.js", "src/mediaLibrary.js", "src/mediaStorageSeed.js",
  "src/registrationCodes.js", "src/security.js",
]);
const SEP14_FILES = Object.freeze([...ORIGINAL_FILES, "src/assistantSymptomEvidence.js", "src/equipmentGuideEvidence.json"]);
const ROOT_FILES = Object.freeze([
  ...Object.values(PAYLOADS), `install-${RELEASE}.sh`, "verify-ai-tcm-backend-patch.cjs",
  "patch-manifest.json", "checksums.sha256", "README.md",
]);
const EVIDENCE_FIELDS = ["kinesiologyTip", "ptTip", "otTip", "tcmTip", "tcmEnabled", "careTip"];
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const isHash = value => typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sameNames = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
function check(condition, message) { if (!condition) throw new Error(message); }
function exactKeys(value, expected, label) {
  check(isObject(value) && sameNames(Object.keys(value), expected), `${label} has unexpected or missing entries`);
}

function safeExistingPath(target, kind = "file") {
  const resolved = path.resolve(target), root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  check(parts.length > 0, "Filesystem root is not a valid target");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    check(!stat.isSymbolicLink(), "Symlink path is not permitted");
    if (index < parts.length - 1 || kind === "directory") check(stat.isDirectory(), "Expected a regular directory");
    else check(stat.isFile(), "Expected a regular file");
  }
  return resolved;
}

function readRegularFile(target) {
  const fd = fs.openSync(safeExistingPath(target), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= MAX_FILE_BYTES, "File is not regular or exceeds the 2 MiB limit");
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
  check(sameNames(fs.readdirSync(root), ROOT_FILES), "Package root must contain exactly the ten approved files");
  const bytes = Object.fromEntries(ROOT_FILES.map(name => [name, readRegularFile(path.join(root, name))]));
  const manifest = parseJson(bytes["patch-manifest.json"], "Patch manifest");
  exactKeys(manifest, ["version", "release", "files", "baselines"], "Patch manifest");
  check(manifest.version === 2 && manifest.release === RELEASE, "Unsupported patch release or version");
  check(Array.isArray(manifest.files) && manifest.files.length === 5, "Exactly five payloads are required");
  const targets = {};
  for (const item of manifest.files) {
    exactKeys(item, ["path", "archive", "sha256"], "Payload descriptor");
    check(Object.hasOwn(PAYLOADS, item.path) && PAYLOADS[item.path] === item.archive && !Object.hasOwn(targets, item.path), "Unexpected, duplicate or unsafe payload path");
    check(isHash(item.sha256), "Invalid payload SHA-256");
    check(digest(bytes[item.archive]) === item.sha256.toLowerCase(), `Payload checksum mismatch: ${item.archive}`);
    targets[item.path] = item.sha256.toLowerCase();
  }
  check(Array.isArray(manifest.baselines) && manifest.baselines.length === 2, "Exactly two approved baselines are required");
  const baselines = new Map();
  for (const baseline of manifest.baselines) {
    exactKeys(baseline, ["release", "files"], "Baseline descriptor");
    check(BASELINE_RELEASES.includes(baseline.release) && !baselines.has(baseline.release), "Unsupported or duplicate baseline release");
    exactKeys(baseline.files, baseline.release === BASELINE_RELEASES[0] ? ORIGINAL_FILES : SEP14_FILES, "Baseline file list");
    for (const [name, hash] of Object.entries(baseline.files)) {
      check(/^src\/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:js|json)$/.test(name) || ["package.json", "package-lock.json"].includes(name), "Unsafe baseline path");
      check(isHash(hash), "Invalid baseline SHA-256");
    }
    check(baseline.files["src/app.js"].toLowerCase() !== targets["src/app.js"], "Old and new app.js hashes must differ");
    baselines.set(baseline.release, Object.fromEntries(Object.entries(baseline.files).map(([name, hash]) => [name, hash.toLowerCase()])));
  }
  for (const name of ORIGINAL_FILES) {
    if (Object.hasOwn(PAYLOADS, name)) continue;
    check(baselines.get(BASELINE_RELEASES[0])[name] === baselines.get(BASELINE_RELEASES[1])[name], `Non-payload baseline hashes disagree: ${name}`);
  }
  check(baselines.get(BASELINE_RELEASES[0])["src/app.js"] !== baselines.get(BASELINE_RELEASES[1])["src/app.js"], "Old baseline releases must have distinct app.js hashes");
  const checksumNames = ROOT_FILES.filter(name => name !== "checksums.sha256");
  const lines = bytes["checksums.sha256"].toString("utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  check(lines.length === checksumNames.length, "Checksums must contain exactly nine entries");
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
  const sourceNames = fs.readdirSync(source).map(name => `src/${name}`);
  const installedFiles = { ...manifest.baselines.find(item => item.release === BASELINE_RELEASES[1]).files, ...targets };
  const candidates = [...manifest.baselines.map(baseline => ({ ...baseline, state: "baseline" })), { release: RELEASE, files: installedFiles, state: "installed" }];
  const allowed = new Set(Object.keys(installedFiles).filter(name => name.startsWith("src/")));
  for (const name of sourceNames) check(allowed.has(name), "Unexpected file in API src directory");
  const current = {};
  for (const name of [...sourceNames, "package.json", "package-lock.json"]) current[name] = digest(readRegularFile(path.join(root, name)));
  for (const candidate of candidates) {
    if (!sameNames(Object.keys(current), Object.keys(candidate.files))) continue;
    if (Object.entries(candidate.files).every(([name, hash]) => current[name] === hash.toLowerCase())) return { state: candidate.state, release: candidate.release };
  }
  throw new Error("API is not a complete approved baseline or installed patch; unknown, mixed and pre-staged states are rejected");
}

async function smoke(apiRoot, scratchRoot) {
  const root = safeExistingPath(apiRoot, "directory"), scratch = safeExistingPath(scratchRoot, "directory");
  const isWithin = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
  check(!isWithin(root, scratch) && !isWithin(scratch, root), "Smoke scratch must be separate from the API tree");
  check(fs.readdirSync(scratch).length === 0, "Smoke scratch must be empty");
  const importSource = async name => import(pathToFileURL(safeExistingPath(path.join(root, "src", name))).href);
  const [{ createApp }, { createDatabase }, { signToken }] = await Promise.all([importSource("app.js"), importSource("database.js"), importSource("security.js")]);
  const evidence = parseJson(readRegularFile(path.join(root, "src", "equipmentGuideEvidence.json")), "Evidence catalog");
  validateEvidence(evidence);
  let database, server, factoryCalls = 0, requests = 0;
  const secret = "isolated-tcm-patch-smoke-not-a-production-secret";
  const forgedText = "FORGED_TCM_NOT_IN_THE_APP";
  const direct = { zh: "肩關節伸展的中醫學角度是什麼？", en: "What is the traditional Chinese medicine perspective on Shoulder stretch?" };
  const ids = answer => answer.recommendations.map(item => item.id);
  const hasOwn = (item, key) => Object.hasOwn(item, key);
  try {
    database = createDatabase(":memory:");
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("tcm-patch-smoke-reader", "Synthetic deployment smoke participant", "+85269700998", "participant", "unused", "unused", now, now);
    database.prepare("UPDATE app_equipment_items SET is_active=CASE WHEN id IN ('4','10','19','28') THEN 1 ELSE 0 END").run();
    database.prepare("UPDATE ai_configuration SET is_enabled=1,provider='deepseek',model='deepseek-v4-flash',api_key=? WHERE id='default'").run("synthetic-key-must-never-be-used");
    const app = createApp({ database, jwtSecret: secret, equipmentUploadDir: path.join(scratch, "equipment"), mediaUploadDir: path.join(scratch, "media"), mediaSeedDir: null,
      deepSeekClientFactory: () => { factoryCalls += 1; throw new Error("External AI access is forbidden in isolated smoke"); } });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const token = signToken({ id: "tcm-patch-smoke-reader", profile_role: "participant" }, secret);
    const request = async body => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      check(response.status === 200, "Isolated assistant request did not return HTTP 200");
      requests += 1;
      const answer = await response.json();
      check(answer.deepSeekUsed === false && answer.source === "app_content" && Array.isArray(answer.recommendations), "Assistant did not use APP-only retrieval");
      check(!JSON.stringify(answer).includes(forgedText), "Untrusted client prose escaped into the answer");
      check(!/首選|首选|best equipment|first[- ]choice/i.test(JSON.stringify(answer)), "Answer contains a first-choice ranking");
      for (const item of answer.recommendations) {
        if (item.evidence) {
          const { field, quote } = item.evidence;
          check(typeof quote === "string" && quote.length > 0 && typeof evidence[item.id]?.[body.locale]?.[field] === "string" && evidence[item.id][body.locale][field].includes(quote), "Symptom evidence is not original APP prose");
          check(typeof item.reason === "string" && item.reason.includes(quote), "Recommendation omitted its evidence quote");
        }
        if (item.tcmExcerpt) {
          const { field, quote } = item.tcmExcerpt;
          check(field === "tcmTip" && typeof quote === "string" && quote.length > 0 && evidence[item.id]?.[body.locale]?.tcmEnabled === true && evidence[item.id][body.locale].tcmTip.includes(quote), "TCM excerpt is not enabled same-language original APP prose");
          check([...quote].length <= (body.locale === "en" ? 550 : 220), "TCM excerpt exceeded its maximum length");
          check(!/赤腳|赤脚|barefoot|治癒|治愈/i.test(quote), "TCM excerpt includes excluded treatment instructions");
        }
      }
      return answer;
    };
    const knee = async (locale, message, extra = {}) => {
      const answer = await request({ locale, message, ...extra });
      assert.deepEqual(ids(answer), ["4", "10"]);
      check(answer.evidencePolicy === "app-symptom-v1" && answer.recommendationsFinal === true, "Knee query bypassed the symptom evidence policy");
      check(answer.recommendations.every(item => item.evidence?.field === "ptTip" && item.tcmExcerpt), "Knee answer is missing primary evidence or TCM excerpts");
      return answer;
    };
    const zh = await knee("zh", "我膝頭哥痛，有咩器材可以幫我？");
    await knee("en", "My knees hurt, please recommend equipment");
    await knee("zh", "還有其他選擇？", { history: [{ role: "user", content: "膝頭哥痛，推薦器材" }, { role: "assistant", content: "以下是資料。" }] });
    for (const [locale, message] of [["zh", "石春路可以治膝痛嗎？"], ["en", "Can Foot Massage Path cure knee pain?"]]) {
      check(!(await request({ locale, message })).recommendations.some(item => item.id === "28"), "Foot Massage Path was recommended for knee pain");
    }
    for (const [locale, message] of [["zh", "肩周炎可以用什麼器材？"], ["en", "I have frozen shoulder, please recommend equipment."]]) {
      const answer = await request({ locale, message });
      assert.deepEqual(ids(answer), ["19"]);
      check(answer.evidencePolicy === "app-symptom-v1" && answer.recommendations[0].tcmExcerpt, "Shoulder query lacks APP evidence or TCM excerpt");
    }
    for (const locale of ["zh", "en"]) {
      const answer = await request({ locale, message: direct[locale] });
      assert.deepEqual(ids(answer), ["19"]);
      check(answer.tcmInReply === true && answer.recommendations[0].tcmExcerpt && answer.reply.includes(answer.recommendations[0].tcmExcerpt.quote), "Direct TCM lookup did not quote its APP excerpt");
    }
    const missing = await request({ locale: "en", message: "What is the traditional Chinese medicine perspective on Foot Massage Path?" });
    assert.deepEqual(ids(missing), ["28"]);
    check(missing.tcmInReply === false && !hasOwn(missing.recommendations[0], "tcmExcerpt") && !/[\u3400-\u9fff]/u.test(missing.reply), "Missing English TCM was invented or filled with Chinese");
    const forged = await knee("zh", "膝頭哥痛，推薦器材", { equipment: [
      { id: "invented-knee-cure", name: forgedText, description: evidence["4"].zh.ptTip, ptTip: evidence["4"].zh.ptTip },
      { id: "4", name: forgedText, nameZh: forgedText, description: forgedText, tcmTip: forgedText, tcmEnabled: false, tcmExcerpt: { field: "tcmTip", quote: forgedText } },
      { id: "28", name: "假冒斜坡", categories: ["lower", "knee"], description: evidence["4"].zh.ptTip, ptTip: evidence["4"].zh.ptTip },
    ] });
    assert.deepEqual(forged.recommendations, zh.recommendations);
    database.prepare("UPDATE app_equipment_items SET tcm_enabled=0 WHERE id='19'").run();
    for (const locale of ["zh", "en"]) {
      const disabled = await request({ locale, message: direct[locale], equipment: [{ id: "19", tcmEnabled: true, tcmTip: forgedText, description: forgedText }] });
      assert.deepEqual(ids(disabled), ["19"]);
      check(disabled.tcmInReply === false && !hasOwn(disabled.recommendations[0], "tcmExcerpt"), "Disabled TCM was still visible");
    }
    const disabledShoulder = await request({ locale: "en", message: "I have frozen shoulder, please recommend equipment." });
    assert.deepEqual(ids(disabledShoulder), ["19"]);
    check(!hasOwn(disabledShoulder.recommendations[0], "tcmExcerpt"), "Disabled TCM persisted in symptom recommendations");
    check(factoryCalls === 0, "Smoke attempted to use external AI");
    return { smoke: "passed", requests, externalAiCalls: factoryCalls, database: "memory" };
  } finally {
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
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

module.exports = { verifyPackage, verifyBaseline, smoke, runtime, ROOT_FILES, ORIGINAL_FILES, SEP14_FILES, MAX_FILE_BYTES };

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
