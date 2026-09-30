const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const checker = require("../verify-v24-content-release.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const roots = [];

function fixture(state = checker.BASELINES[0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v24-release-test-")); roots.push(root);
  const api = path.join(root, "api"), web = path.join(root, "web"), stage = path.join(root, "stage"), backup = path.join(root, "backup");
  for (const directory of [path.join(api, "src"), path.join(api, "data"), path.join(api, "uploads"), path.join(web, "uploads"), path.join(stage, "web", "assets"), backup]) fs.mkdirSync(directory, { recursive: true });
  const old = Object.fromEntries(checker.INVENTORIES[0].map(name => [name, `baseline ${name}`]));
  const payload = Object.fromEntries(checker.PAYLOADS.map(name => [`src/${name}`, `new ${name}`]));
  const states = { [checker.BASELINES[0]]: old, [checker.RELEASE]: { ...old, ...payload } };
  for (const [name, bytes] of Object.entries(states[state])) fs.writeFileSync(path.join(api, name), bytes);
  fs.writeFileSync(path.join(api, "data", "app.sqlite"), "existing accounts and feedback");
  fs.writeFileSync(path.join(api, "data", "app.sqlite-wal"), "pending journal");
  fs.writeFileSync(path.join(api, "data", "app.sqlite-shm"), "shared memory");
  fs.writeFileSync(path.join(api, ".env"), "PRIVATE_SENTINEL");
  fs.writeFileSync(path.join(api, "uploads", "video.mp4"), "API video upload");
  fs.writeFileSync(path.join(web, "uploads", "photo.png"), "Web user upload");
  fs.writeFileSync(path.join(web, "index.html"), "old index");
  fs.mkdirSync(path.join(web, "assets")); fs.writeFileSync(path.join(web, "assets", "old-hash.png"), "keep old asset");
  for (const name of checker.ROOT_FILES) fs.writeFileSync(path.join(stage, name), name);
  for (const [name, bytes] of Object.entries(payload)) fs.writeFileSync(path.join(stage, path.basename(name)), bytes);
  fs.writeFileSync(path.join(stage, "web", "index.html"), "new index");
  fs.writeFileSync(path.join(stage, "web", "assets", "new-hash.png"), "new image");
  const manifest = { version: 1, release: checker.RELEASE,
    files: Object.entries(payload).map(([name, bytes]) => ({ path: name, archive: path.basename(name), sha256: hash(bytes) })),
    baselines: [{ release: checker.BASELINES[0], files: Object.fromEntries(Object.entries(old).map(([name, bytes]) => [name, hash(bytes)])) }],
    web: checker.webInventory(path.join(stage, "web")),
  };
  const seal = () => {
    fs.writeFileSync(path.join(stage, "release-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(stage, "checksums.sha256"), checker.ROOT_FILES.filter(name => name !== "checksums.sha256").map(name => `${hash(fs.readFileSync(path.join(stage, name)))}  ${name}\n`).join(""));
  };
  seal();
  const runtimeFile = path.join(root, "runtime.json");
  fs.writeFileSync(runtimeFile, JSON.stringify({ port: 3000, dbPath: path.join(api, "data", "app.sqlite") }));
  return { root, api, web, stage, backup, manifest, states, seal, runtimeFile };
}

function assertPreserved(data, database = "existing accounts and feedback") {
  assert.equal(fs.readFileSync(path.join(data.api, "data", "app.sqlite"), "utf8"), database);
  assert.equal(fs.readFileSync(path.join(data.api, "data", "app.sqlite-wal"), "utf8"), "pending journal");
  assert.equal(fs.readFileSync(path.join(data.api, "data", "app.sqlite-shm"), "utf8"), "shared memory");
  assert.equal(fs.readFileSync(path.join(data.api, ".env"), "utf8"), "PRIVATE_SENTINEL");
  assert.equal(fs.readFileSync(path.join(data.api, "uploads", "video.mp4"), "utf8"), "API video upload");
  assert.equal(fs.readFileSync(path.join(data.web, "uploads", "photo.png"), "utf8"), "Web user upload");
  assert.equal(fs.readFileSync(path.join(data.web, "assets", "old-hash.png"), "utf8"), "keep old asset");
  assert.equal(fs.readFileSync(path.join(data.api, "src", "feedback.js"), "utf8"), "baseline src/feedback.js");
}

test.after(() => {
  for (const root of roots) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("v24-release-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exactly one complete contact-feedback baseline and four payloads are supported", () => {
  assert.deepEqual(checker.BASELINES, ["contact-feedback-20260918"]);
  assert.deepEqual(checker.PAYLOADS, ["database.js", "equipmentGuideEvidence.json", "tcmContentUpdate.js", "tcmV24Content.json"]);
  assert.ok(checker.INVENTORIES[0].includes("src/feedback.js"));
  for (const release of [...checker.BASELINES, checker.RELEASE]) {
    const data = fixture(release);
    assert.deepEqual(checker.verifyBaseline(data.api, data.stage), { release, state: release === checker.RELEASE ? "installed" : "baseline" });
    assert.equal(checker.verifyPackage(data.stage).manifest.files.length, 4);
    assertPreserved(data);
  }
});

test("unknown, mixed, prestaged, missing feedback, dependency and extra-source states fail closed without writes", () => {
  for (const mutation of [
    data => fs.writeFileSync(path.join(data.api, "src", "tcmContentUpdate.js"), "new tcmContentUpdate.js"),
    data => fs.writeFileSync(path.join(data.api, "src", "database.js"), "new database.js"),
    data => fs.appendFileSync(path.join(data.api, "src", "app.js"), "unknown"),
    data => fs.appendFileSync(path.join(data.api, "src", "feedback.js"), "unknown"),
    data => fs.unlinkSync(path.join(data.api, "src", "feedback.js")),
    data => fs.appendFileSync(path.join(data.api, "package-lock.json"), "new dependency"),
    data => fs.writeFileSync(path.join(data.api, "src", "extra.js"), "unknown"),
  ]) {
    const data = fixture(); mutation(data);
    const before = fs.readFileSync(path.join(data.api, "src", "app.js"));
    assert.throws(() => checker.verifyBaseline(data.api, data.stage));
    assert.throws(() => checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile));
    assert.deepEqual(fs.readFileSync(path.join(data.api, "src", "app.js")), before);
    assert.equal(fs.readdirSync(data.backup).length, 0);
    assert.equal(fs.readFileSync(path.join(data.web, "index.html"), "utf8"), "old index");
  }
});

test("backend, Web, helper and root inventory tampering invalidate package verification", () => {
  for (const name of [...checker.PAYLOADS, "verify-v24-content-release.cjs", "verify-ai-chatbox-guide-backend-patch.cjs", "web/index.html", "web/assets/new-hash.png"]) {
    const data = fixture(); fs.appendFileSync(path.join(data.stage, name), "altered");
    assert.throws(() => checker.verifyPackage(data.stage));
  }
  for (const name of ["extra.js", "web/extra.js"]) {
    const data = fixture(); fs.writeFileSync(path.join(data.stage, name), "unlisted");
    assert.throws(() => checker.verifyPackage(data.stage));
  }
});

test("manifest rejects unknown baseline, incomplete feedback inventory, duplicate payloads and path traversal", () => {
  for (const mutate of [
    m => { m.baselines[0].release = "older-release"; },
    m => { delete m.baselines[0].files["src/feedback.js"]; },
    m => { m.baselines.push(m.baselines[0]); },
    m => { m.files[0].archive = "../outside.js"; },
    m => { m.files[1] = m.files[0]; },
    m => { m.files[0].path = "src/app.js"; },
    m => { m.web[0].path = "../outside.html"; },
    m => { m.web.push(m.web[0]); },
    m => { m.extra = true; },
  ]) {
    const data = fixture(); mutate(data.manifest); data.seal();
    assert.throws(() => checker.verifyPackage(data.stage));
  }
});

test("only Web assets are permitted: native bundles, secrets, media uploads and private files are excluded", () => {
  for (const name of ["../index.html", "/index.html", "a\\index.html", "a//index.html", ".env", "assets/../index.html", "assets/private.key", "assets/video.mp4", "data/users.db", "uploads/photo.png", "node_modules/pkg/index.js", "_expo/static/js/android/bundle.js", "_expo/static/js/ios/bundle.js"]) assert.equal(checker.validWebPath(name), false, name);
  for (const name of ["index.html", "_expo/static/js/web/entry-abcd.js", "assets/node_modules/font/icon.ttf", "assets/images/icon.png", "assets/sounds/timer.wav"]) assert.equal(checker.validWebPath(name), true, name);
  const data = fixture();
  fs.writeFileSync(path.join(data.stage, "web", "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: {} }));
  assert.equal(checker.webInventory(path.join(data.stage, "web")).length, 3);
  fs.writeFileSync(path.join(data.stage, "web", "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: { android: {} } }));
  assert.throws(() => checker.webInventory(path.join(data.stage, "web")), /Mixed native/);
});

test("symlink/junction and hard-link boundaries cannot be traversed by package or target validation", t => {
  const data = fixture(), link = path.join(data.root, "linked");
  try { fs.symlinkSync(data.stage, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host denies creating symlinks"); throw error; }
  assert.throws(() => checker.verifyPackage(link), /Symlink/);
  fs.symlinkSync(data.api, path.join(data.web, "assets", "new-hash.png"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /Symlink/);
  fs.linkSync(path.join(data.stage, "database.js"), path.join(data.root, "hardlink.js"));
  assert.throws(() => checker.verifyPackage(data.stage), /hard links/);
});

test("Web preflight preserves older assets and refuses immutable collisions or file/directory mismatches", () => {
  const data = fixture(); assert.equal(checker.verifyWebTarget(data.web, data.stage).files, 2);
  fs.writeFileSync(path.join(data.web, "assets", "new-hash.png"), "collision");
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /collision/);
  fs.unlinkSync(path.join(data.web, "assets", "new-hash.png")); fs.mkdirSync(path.join(data.web, "assets", "new-hash.png"));
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /regular file/);
});

test("backup/apply/rollback preserve database, WAL, SHM, uploads, feedback, private files and older assets", () => {
  const data = fixture();
  assert.equal(checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile).backup, "complete");
  for (const [name, value] of [["database.sqlite", "existing accounts and feedback"], ["database.sqlite-wal", "pending journal"], ["database.sqlite-shm", "shared memory"]]) assert.equal(fs.readFileSync(path.join(data.backup, "database", name), "utf8"), value);
  assertPreserved(data);
  checker.applyDeployment(data.api, data.web, data.stage, data.backup);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "installed");
  assert.equal(checker.verifyInstalledWeb(data.web, data.stage).installedWeb, "verified");
  assertPreserved(data);
  fs.writeFileSync(path.join(data.api, "data", "app.sqlite"), "new feedback after migration");
  assert.deepEqual(checker.rollbackDeployment(data.api, data.web, data.stage, data.backup), { rollback: "code-and-web-only", database: "untouched", uploads: "untouched" });
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  assertPreserved(data, "new feedback after migration");
  assert.equal(fs.readFileSync(path.join(data.web, "index.html"), "utf8"), "old index");
  for (const name of ["tcmContentUpdate.js", "tcmV24Content.json"]) {
    assert.equal(fs.existsSync(path.join(data.api, "src", name)), false);
    assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "api", "src", name), "utf8"), `new ${name}`);
  }
  assert.equal(fs.existsSync(path.join(data.web, "assets", "new-hash.png")), false);
  assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "web", "assets", "new-hash.png"), "utf8"), "new image");
});

test("partial API write failure restores overwritten files and quarantines new backend files without orphan temporary files", () => {
  const data = fixture(); checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(data.api, "src", "tcmV24Content.json")) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
    return original(from, to);
  };
  try { assert.throws(() => checker.applyDeployment(data.api, data.web, data.stage, data.backup), /injected rename failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(path.join(data.api, "src", "tcmContentUpdate.js")), true);
  checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
  assertPreserved(data);
  assert.deepEqual(fs.readdirSync(path.join(data.api, "src")).filter(name => name.startsWith(".")), []);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  assert.equal(fs.existsSync(path.join(data.api, "src", "tcmContentUpdate.js")), false);
  assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "api", "src", "tcmContentUpdate.js"), "utf8"), "new tcmContentUpdate.js");
});

test("changed target or recovery bytes stop before further application changes", () => {
  const data = fixture(); checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  fs.writeFileSync(path.join(data.web, "index.html"), "concurrent edit");
  assert.throws(() => checker.applyDeployment(data.api, data.web, data.stage, data.backup), /changed after backup/);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  fs.writeFileSync(path.join(data.backup, "api", "src", "database.js"), "corrupt backup");
  assert.throws(() => checker.rollbackDeployment(data.api, data.web, data.stage, data.backup), /checksum/);
  assertPreserved(data);
});

test("unapproved runtime database and nonempty backup targets are rejected", () => {
  const data = fixture(); fs.writeFileSync(data.runtimeFile, JSON.stringify({ port: 3000, dbPath: path.join(data.web, "index.html") }));
  assert.throws(() => checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile), /Unapproved/);
  assert.equal(fs.readdirSync(data.backup).length, 0);
  fs.writeFileSync(path.join(data.backup, "existing"), "keep");
  assert.throws(() => checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile), /must be empty/);
  assert.equal(fs.readFileSync(path.join(data.backup, "existing"), "utf8"), "keep");
  assertPreserved(data);
});

test("umask 077 still produces readable public assets while backup contents stay private", { skip: process.platform === "win32" }, () => {
  const data = fixture(), previous = process.umask(0o077);
  try {
    fs.mkdirSync(path.join(data.stage, "web", "activity-advice", "deep"), { recursive: true });
    fs.writeFileSync(path.join(data.stage, "web", "activity-advice", "deep", "page.html"), "New page");
    data.manifest.web = checker.webInventory(path.join(data.stage, "web")); data.seal();
    checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
    checker.applyDeployment(data.api, data.web, data.stage, data.backup);
    assert.equal(fs.statSync(path.join(data.web, "activity-advice", "deep")).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(data.web, "activity-advice", "deep", "page.html")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(data.api, "src", "tcmContentUpdate.js")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(data.backup, "database", "database.sqlite")).mode & 0o777, 0o600);
    checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
  } finally { process.umask(previous); }
});

test("installer locks deployments, validates before writing, stops before backup and never restores the live database", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../deploy/2026-09-18/install-v24-activity-content-20260918.sh"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(source.includes("/run/outdoor-fit-file-explorer-deploy.lock"));
  assert.ok(source.indexOf('STOPPED=1\nsystemctl stop') < source.indexOf('"$CHECKER" backup'));
  assert.ok(source.indexOf('"$CHECKER" backup') < source.indexOf('"$CHECKER" apply'));
  assert.ok(source.indexOf("shutil.disk_usage(destination).free") < source.indexOf("target = os.path.join(destination"));
  assert.ok(source.includes('"$CHECKER" tcm-smoke'));
  assert.ok(source.includes('"$CHECKER" feedback-smoke'));
  assert.ok(source.includes('"$CHECKER" web-installed'));
  assert.ok(source.includes('cmp "$WORK_DIR/runtime-before.json" "$WORK_DIR/runtime-after.json"'));
  assert.doesNotMatch(source, /npm\s+(?:ci|install)|systemctl\s+\w+\s+nginx|rm\s+-rf/);
});

test("isolated TCM smoke validates all nine bilingual facilities and preserves later edits after repeat startup", async () => {
  const data = fixture(), scratch = path.join(data.root, "tcm-smoke"); fs.mkdirSync(scratch);
  const result = await checker.tcmSmoke(path.resolve(__dirname, "../../server"), scratch);
  assert.equal(result.smoke, "passed"); assert.equal(result.equipment, 9); assert.equal(result.languages, 2);
  assert.equal(result.repeatStartupPreservesEdits, true); assert.equal(result.externalAiCalls, 0);
  assertPreserved(data);
});

test("isolated feedback smoke retains contact permissions and optimistic update behavior", async () => {
  const data = fixture(), scratch = path.join(data.root, "feedback-smoke"); fs.mkdirSync(scratch);
  const result = await checker.feedbackSmoke(path.resolve(__dirname, "../../server"), scratch);
  assert.equal(result.smoke, "passed"); assert.equal(result.database, "memory"); assert.equal(result.externalAiCalls, 0);
  assertPreserved(data);
});
