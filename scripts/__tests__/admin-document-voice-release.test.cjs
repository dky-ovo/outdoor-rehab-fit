const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const checker = require("../verify-admin-document-voice-release.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const roots = [];

function fixture(state = checker.BASELINES[0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-document-release-test-")); roots.push(root);
  const api = path.join(root, "api"), web = path.join(root, "web"), stage = path.join(root, "stage"), backup = path.join(root, "backup");
  for (const directory of [path.join(api, "src"), path.join(api, "data"), path.join(api, "uploads"), path.join(web, "uploads"), path.join(stage, "web", "assets"), backup]) fs.mkdirSync(directory, { recursive: true });
  const old = Object.fromEntries(checker.INVENTORIES[0].map(name => [name, `baseline ${name}`]));
  const payload = Object.fromEntries(checker.PAYLOADS.map(name => [checker.payloadPath(name), name.startsWith("package") ? fs.readFileSync(path.join(__dirname, "../../server", name), "utf8") : `new ${name}`]));
  const learning = { ...old, "src/app.js": "learning app.js", "src/assistant.js": "learning assistant.js" };
  const states = { [checker.BASELINES[0]]: old, [checker.BASELINES[1]]: learning, [checker.RELEASE]: { ...learning, ...payload } };
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
    baselines: checker.BASELINES.map(release => ({ release, files: Object.fromEntries(Object.entries(states[release]).map(([name, bytes]) => [name, hash(bytes)])) })),
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
    assert.ok(path.basename(root).startsWith("admin-document-release-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("both complete V24 and learning baselines and eight payloads are supported", () => {
  assert.deepEqual(checker.BASELINES, ["v24-activity-content-20260918", "learning-voice-input-20260921"]);
  assert.deepEqual(checker.PAYLOADS, ["app.js", "assistant.js", "database.js", "adminAssistant.js", "adminAssistantPrivacy.js", "equipmentDocumentImport.js", "package.json", "package-lock.json"]);
  assert.ok(checker.INVENTORIES[0].includes("src/feedback.js"));
  for (const release of [...checker.BASELINES, checker.RELEASE]) {
    const data = fixture(release);
    assert.deepEqual(checker.verifyBaseline(data.api, data.stage), { release, state: release === checker.RELEASE ? "installed" : "baseline" });
    assert.equal(checker.verifyPackage(data.stage).manifest.files.length, 8);
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
  for (const name of [...checker.PAYLOADS, "verify-admin-document-voice-release.cjs", "verify-ai-chatbox-guide-backend-patch.cjs", "web/index.html", "web/assets/new-hash.png"]) {
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
    m => { m.files[0].path = "src/assistant.js"; },
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
  fs.linkSync(path.join(data.stage, "app.js"), path.join(data.root, "hardlink.js"));
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
    assert.equal(fs.readFileSync(path.join(data.api, "src", name), "utf8"), `baseline src/${name}`);
  }
  assert.equal(fs.existsSync(path.join(data.web, "assets", "new-hash.png")), false);
  assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "web", "assets", "new-hash.png"), "utf8"), "new image");
});

test("partial API write failure restores overwritten files without orphan temporary files", () => {
  const data = fixture(); checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(data.api, "src", "assistant.js")) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
    return original(from, to);
  };
  try { assert.throws(() => checker.applyDeployment(data.api, data.web, data.stage, data.backup), /injected rename failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(path.join(data.api, "src", "app.js"), "utf8"), "new app.js");
  checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
  assertPreserved(data);
  assert.deepEqual(fs.readdirSync(path.join(data.api, "src")).filter(name => name.startsWith(".")), []);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  assert.equal(fs.readFileSync(path.join(data.api, "src", "app.js"), "utf8"), "baseline src/app.js");
});

test("changed target or recovery bytes stop before further application changes", () => {
  const data = fixture(); checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  fs.writeFileSync(path.join(data.web, "index.html"), "concurrent edit");
  assert.throws(() => checker.applyDeployment(data.api, data.web, data.stage, data.backup), /changed after backup/);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  fs.writeFileSync(path.join(data.backup, "api", "src", "app.js"), "corrupt backup");
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
    assert.equal(fs.statSync(path.join(data.api, "src", "app.js")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(data.backup, "database", "database.sqlite")).mode & 0o777, 0o600);
    checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
  } finally { process.umask(previous); }
});

test("installer locks deployments, validates before writing, stops before backup and never restores the live database", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../deploy/2026-09-21/install-admin-document-voice-20260921.sh"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(source.includes("/run/outdoor-fit-file-explorer-deploy.lock"));
  assert.ok(source.indexOf('STOPPED=1\nsystemctl stop') < source.indexOf('"$CHECKER" backup'));
  assert.ok(source.indexOf('"$CHECKER" backup') < source.indexOf('"$CHECKER" apply'));
  assert.ok(source.indexOf("shutil.disk_usage(destination).free") < source.indexOf("target = os.path.join(destination"));
  assert.ok(source.includes('"$CHECKER" tcm-smoke'));
  assert.ok(source.includes('"$CHECKER" feedback-smoke'));
  assert.ok(source.includes('"$CHECKER" admin-smoke "$WORK_DIR/api"'));
  assert.ok(source.includes('"$CHECKER" admin-smoke "$API_DIR"'));
  assert.ok(source.indexOf('dependencies-tree "$API_DIR/node_modules"') < source.indexOf('STOPPED=1\nsystemctl stop'));
  assert.ok(source.indexOf('dependencies-tree "$WORK_DIR/api/node_modules"') < source.indexOf('STOPPED=1\nsystemctl stop'));
  assert.ok(source.includes('"$CHECKER" web-installed'));
  assert.ok(source.includes('cmp "$WORK_DIR/runtime-before.json" "$WORK_DIR/runtime-after.json"'));
  assert.doesNotMatch(source, /systemctl\s+\w+\s+nginx|rm\s+-rf/);
  assert.ok(source.includes('"$NODE" "$NPM_CLI" ci --omit=dev'));
  assert.ok(source.indexOf('"$NPM_CLI" ci') < source.indexOf('STOPPED=1\nsystemctl stop'));
  assert.ok(source.includes('"$CHECKER" dependencies-rollback'));
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

test("isolated admin smoke validates draft-only AI privacy, confirmation and protected document-import schema", async () => {
  const data = fixture(), scratch = path.join(data.root, "admin-smoke"); fs.mkdirSync(scratch);
  const result = await checker.adminSmoke(path.resolve(__dirname, "../../server"), scratch);
  assert.equal(result.smoke, "passed"); assert.equal(result.database, "memory");
  assert.equal(result.externalAiCalls, 0); assert.equal(result.mockProviderCalls, 1);
  assert.match(result.documentImport, /no-writes/); assertPreserved(data);
});


test("repeat installation is supported with a fresh backup and rollback preserves the already installed release", () => {
  const data = fixture();
  checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  checker.applyDeployment(data.api, data.web, data.stage, data.backup);
  const second = path.join(data.root, "backup-second"); fs.mkdirSync(second);
  checker.backupDeployment(data.api, data.web, data.stage, second, data.runtimeFile);
  checker.applyDeployment(data.api, data.web, data.stage, second);
  checker.rollbackDeployment(data.api, data.web, data.stage, second);
  checker.rollbackDeployment(data.api, data.web, data.stage, second);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "installed");
  assert.equal(checker.verifyInstalledWeb(data.web, data.stage).installedWeb, "verified");
  assertPreserved(data);
});

test("rollback refuses to overwrite an unrelated post-deployment edit or remove an unknown new file", () => {
  for (const relative of ["src/app.js", "assets/new-hash.png"]) {
    const data = fixture();
    checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
    checker.applyDeployment(data.api, data.web, data.stage, data.backup);
    const target = path.join(relative.startsWith("src/") ? data.api : data.web, relative);
    fs.writeFileSync(target, "concurrent unrelated edit");
    assert.throws(() => checker.rollbackDeployment(data.api, data.web, data.stage, data.backup), /outside deployment/);
    assert.equal(fs.readFileSync(target, "utf8"), "concurrent unrelated edit");
    assertPreserved(data);
  }
});

test("isolated AI smoke exercises text, published guide, symptoms and image retirement without external requests", async () => {
  const data = fixture(), scratch = path.join(data.root, "ai-smoke"); fs.mkdirSync(scratch);
  const result = await checker.aiSmoke(path.resolve(__dirname, "../../server"), scratch);
  assert.equal(result.smoke, "passed"); assert.equal(result.database, "memory");
  assert.equal(result.externalAiCalls, 0); assert.equal(result.mockProviderCalls, 1);
  assert.equal(result.retiredImages, "400 without provider calls");
  assertPreserved(data);
});

test("packaging pins the reviewed V24 archive, supports staging only and never overwrites an existing ZIP", () => {
  const source = fs.readFileSync(path.join(__dirname, "../package-admin-document-voice.ps1"), "utf8");
  assert.match(source, /0B02C151847701FF9977AD05F868A4887F9EA196C69EBF7CF8CCCF6E988B1E00/);
  assert.match(source, /\$manifest\.baselines\[0\]\.files/);
  assert.match(source, /\$manifest\.files/);
  assert.match(source, /if \(\$StageOnly\)/);
  assert.match(source, /Release ZIP already exists; it will not be overwritten/);
  assert.match(source, /\[IO.File\]::Move/);
  assert.match(source, /CreateEntryFromFile/);
  assert.doesNotMatch(source, /Compress-Archive|Remove-Item/);
});



function dependencyFixture() {
  const data = fixture();
  const live = path.join(data.api, "node_modules"), staged = path.join(data.root, "staged-node-modules");
  for (const dir of [live, staged]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(live, "old.js"), "original dependencies");
  fs.writeFileSync(path.join(staged, "new.js"), "new dependencies");
  return { ...data, live, staged };
}

test("missing new source files or changed dependencies never look like an installed release", () => {
  for (const name of ["src/adminAssistant.js", "src/adminAssistantPrivacy.js", "src/equipmentDocumentImport.js", "package-lock.json"]) {
    const data = fixture(checker.RELEASE); fs.unlinkSync(path.join(data.api, name));
    assert.throws(() => checker.verifyBaseline(data.api, data.stage));
  }
});

test("package files and new source paths are backed up, applied and restored without altering user data", () => {
  const data = fixture(), oldPackage = fs.readFileSync(path.join(data.api, "package.json"));
  checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  checker.applyDeployment(data.api, data.web, data.stage, data.backup);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data.api, "package.json"))).dependencies.yauzl, "3.4.0");
  checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
  assert.deepEqual(fs.readFileSync(path.join(data.api, "package.json")), oldPackage);
  for (const name of ["adminAssistant.js", "adminAssistantPrivacy.js", "equipmentDocumentImport.js"]) {
    assert.equal(fs.existsSync(path.join(data.api, "src", name)), false);
    assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "api", "src", name), "utf8"), "new " + name);
  }
  assertPreserved(data);
});

test("dependency swap and rollback retain both original and failed directories and are repeat-safe", () => {
  const data = dependencyFixture(), oldHash = checker.dependencyTree(data.live).sha256;
  checker.prepareDependencySwap(data.api, data.staged, data.backup);
  checker.applyDependencySwap(data.api, data.backup);
  assert.equal(fs.readFileSync(path.join(data.live, "new.js"), "utf8"), "new dependencies");
  assert.equal(fs.readFileSync(path.join(data.backup, "node_modules-original", "old.js"), "utf8"), "original dependencies");
  checker.rollbackDependencySwap(data.api, data.backup);
  checker.rollbackDependencySwap(data.api, data.backup);
  assert.equal(checker.dependencyTree(data.live).sha256, oldHash);
  assert.equal(fs.readFileSync(path.join(data.backup, "node_modules-failed", "new.js"), "utf8"), "new dependencies");
  assertPreserved(data);
});

test("failure between dependency renames restores the original tree without deleting staging", () => {
  const data = dependencyFixture(); checker.prepareDependencySwap(data.api, data.staged, data.backup);
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { if (from === data.staged) throw new Error("injected swap failure"); return original(from, to); };
  try { assert.throws(() => checker.applyDependencySwap(data.api, data.backup), /injected/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(data.live), false);
  checker.rollbackDependencySwap(data.api, data.backup);
  assert.equal(fs.readFileSync(path.join(data.live, "old.js"), "utf8"), "original dependencies");
  assert.equal(fs.readFileSync(path.join(data.staged, "new.js"), "utf8"), "new dependencies");
});

test("changed staged or live dependency bytes block overwrite and preserve originals", () => {
  const changed = dependencyFixture(); checker.prepareDependencySwap(changed.api, changed.staged, changed.backup);
  fs.appendFileSync(path.join(changed.staged, "new.js"), "tampered");
  assert.throws(() => checker.applyDependencySwap(changed.api, changed.backup), /changed after preflight/);
  assert.equal(fs.existsSync(path.join(changed.live, "old.js")), true);
  const active = dependencyFixture(); checker.prepareDependencySwap(active.api, active.staged, active.backup);
  checker.applyDependencySwap(active.api, active.backup);
  fs.appendFileSync(path.join(active.live, "new.js"), "third-party change");
  assert.throws(() => checker.rollbackDependencySwap(active.api, active.backup), /changed outside deployment/);
  assert.equal(fs.existsSync(path.join(active.backup, "node_modules-original", "old.js")), true);
});

test("dependency tree rejects links escaping to user data and hard-linked files", t => {
  const data = dependencyFixture(), linked = path.join(data.staged, "outside");
  try { fs.symlinkSync(path.join(data.api, "data"), linked, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host denies symlinks"); throw error; }
  assert.throws(() => checker.prepareDependencySwap(data.api, data.staged, data.backup), /escapes|Absolute dependency symlink/);
  fs.unlinkSync(linked);
  fs.linkSync(path.join(data.staged, "new.js"), path.join(data.root, "hardlinked.js"));
  assert.throws(() => checker.prepareDependencySwap(data.api, data.staged, data.backup), /Unsafe dependency file/);
});

test("absolute dependency links within the tree are rejected before any live rename", t => {
  const data = dependencyFixture(), inner = path.join(data.staged, "inner"), linked = path.join(data.staged, "absolute-link");
  fs.mkdirSync(inner); fs.writeFileSync(path.join(inner, "file.js"), "keep");
  const original = checker.dependencyTree(data.live);
  try { fs.symlinkSync(inner, linked, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host denies symlinks"); throw error; }
  assert.throws(() => checker.prepareDependencySwap(data.api, data.staged, data.backup), /Absolute dependency symlink/);
  assert.deepEqual(checker.dependencyTree(data.live), original);
  assert.equal(fs.existsSync(path.join(data.backup, "dependency-recovery.json")), false);
});

test("relative npm-style dependency links survive full tree swap and rollback", t => {
  const data = dependencyFixture(); fs.mkdirSync(path.join(data.staged, ".bin"));
  try { fs.symlinkSync("../new.js", path.join(data.staged, ".bin", "command"), "file"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host denies relative symlinks"); throw error; }
  const oldHash = checker.dependencyTree(data.live).sha256, stagedHash = checker.dependencyTree(data.staged).sha256;
  checker.prepareDependencySwap(data.api, data.staged, data.backup); checker.applyDependencySwap(data.api, data.backup);
  assert.equal(checker.dependencyTree(data.live).sha256, stagedHash);
  checker.rollbackDependencySwap(data.api, data.backup);
  assert.equal(checker.dependencyTree(data.live).sha256, oldHash);
  assert.equal(checker.dependencyTree(path.join(data.backup, "node_modules-failed")).sha256, stagedHash);
});

test("relative link traversal cannot leave and re-enter through the original directory name", () => {
  assert.equal(checker.relativeDependencyLink(".bin/command", "../package/cli.js"), true);
  assert.equal(checker.relativeDependencyLink("link", "./package/cli.js"), true);
  assert.equal(checker.relativeDependencyLink("link", "../node_modules/package/cli.js"), false);
  assert.equal(checker.relativeDependencyLink(".bin/command", "../../node_modules/package/cli.js"), false);
  assert.equal(checker.relativeDependencyLink(".bin/command", "C:package/cli.js"), false);
  assert.equal(checker.relativeDependencyLink(".bin/command", "C:\\package\\cli.js"), false);
  assert.equal(checker.relativeDependencyLink(".bin/command", "/package/cli.js"), false);
});

test("dependency lock refuses external download sources, missing integrity and moving versions", () => {
  for (const change of [entry => { entry.resolved = "https://example.invalid/archive.tgz"; }, entry => { delete entry.integrity; }, entry => { entry.version = "latest"; }, entry => { entry.link = true; }]) {
    const data = fixture(), file = path.join(data.stage, "package-lock.json"), lock = JSON.parse(fs.readFileSync(file));
    change(lock.packages["node_modules/pend"]); fs.writeFileSync(file, JSON.stringify(lock));
    data.manifest.files.find(item => item.archive === "package-lock.json").sha256 = hash(fs.readFileSync(file)); data.seal();
    assert.throws(() => checker.verifyPackage(data.stage)); assertPreserved(data);
  }
});

test("unreviewed document dependency versions or lifecycle scripts cannot be packaged", () => {
  for (const change of [pkg => { pkg.dependencies.yauzl = "latest"; }, pkg => { pkg.scripts.postinstall = "node dangerous.js"; }]) {
    const data = fixture(), file = path.join(data.stage, "package.json"), pkg = JSON.parse(fs.readFileSync(file));
    change(pkg); fs.writeFileSync(file, JSON.stringify(pkg));
    data.manifest.files.find(item => item.archive === "package.json").sha256 = hash(fs.readFileSync(file)); data.seal();
    assert.throws(() => checker.verifyPackage(data.stage));
  }
});
