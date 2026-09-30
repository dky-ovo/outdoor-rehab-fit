const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const checker = require("../verify-admin-shortcuts-language-release.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-shortcuts-language-test-")); roots.push(root);
  const stage = path.join(root, "stage"), web = path.join(root, "web"), backup = path.join(root, "backup");
  for (const directory of [path.join(stage, "web", "assets"), path.join(web, "assets"), backup]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), "old index");
  fs.writeFileSync(path.join(web, "assets", "old-hash.png"), "old asset");
  fs.mkdirSync(path.join(web, "uploads")); fs.writeFileSync(path.join(web, "uploads", "sentinel.png"), "existing upload");
  fs.mkdirSync(path.join(root, "api")); fs.writeFileSync(path.join(root, "api", "app.sqlite"), "existing database");
  for (const name of checker.ROOT_FILES) fs.writeFileSync(path.join(stage, name), name.endsWith(".cjs") ? fs.readFileSync(path.join(__dirname, "..", name)) : name);
  fs.writeFileSync(path.join(stage, "web", "index.html"), "new index");
  fs.writeFileSync(path.join(stage, "web", "assets", "new-hash.png"), "new asset");
  const manifest = { version: 1, release: checker.RELEASE, web: checker.webInventory(path.join(stage, "web")) };
  const seal = () => {
    fs.writeFileSync(path.join(stage, "release-manifest.json"), JSON.stringify(manifest));
    const installer = "install-admin-shortcuts-language-20260923.sh";
    const sums = checker.ROOT_FILES.filter(name => name !== installer).map(name => `${hash(fs.readFileSync(path.join(stage, name)))}  ${name}`).join("\n");
    const template = fs.readFileSync(path.join(__dirname, "..", installer + ".in"), "utf8");
    fs.writeFileSync(path.join(stage, installer), template.replace("@@EMBEDDED_CHECKSUMS@@", sums));
  };
  seal(); return { root, stage, web, backup, manifest, seal };
}
test.after(() => {
  for (const root of roots) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("admin-shortcuts-language-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("portable Windows PowerShell packaging rejects overwrite and emits slash members", () => {
  const source = fs.readFileSync(path.join(__dirname, "../package-admin-shortcuts-language.ps1"), "utf8");
  assert.match(source, /CreateEntryFromFile\(\$newZip,/);
  assert.match(source, /'web\/' \+ \$_\.path/);
  assert.match(source, /\$webInventory = foreach/);
  assert.match(source, /\[IO.FileMode\]::CreateNew/);
  assert.match(source, /Add-Type -AssemblyName System\.IO\.Compression\r?\n/);
  assert.match(source, /\[IO.File\]::Open\(\$stagedZip,/);
  assert.match(source, /\[IO.File\]::Move\(\$stagedZip,\$outputZip\)/);
  assert.doesNotMatch(source, /\[IO.File\]::Open\(\$outputZip,/);
  assert.doesNotMatch(source, /CreateFromDirectory/);
});
test("package requires exact support-file and Web inventories", () => {
  const f = fixture(); assert.equal(checker.verifyPackage(f.stage).web.length, 2);
  fs.writeFileSync(path.join(f.stage, "app.js"), "unapproved backend");
  assert.throws(() => checker.verifyPackage(f.stage), /Unexpected package/);
});
test("all helper, manifest and Web content is checksummed", () => {
  for (const name of ["verify-admin-shortcuts-language-release.cjs", "README.md", "web/index.html", "web/assets/new-hash.png"]) {
    const f = fixture(); fs.appendFileSync(path.join(f.stage, name), "changed");
    assert.throws(() => checker.verifyPackage(f.stage));
  }
});
test("missing, duplicate, traversal and backend manifest paths fail closed", () => {
  for (const mutate of [
    m => m.web.pop(), m => m.web.push(m.web[0]), m => m.web[0].path = "../outside.html",
    m => m.web[0].path = "uploads/file.png", m => m.web[0].bytes++, m => m.api = [],
    m => m.release = "unexpected", m => m.web[0].extra = true,
  ]) { const f = fixture(); mutate(f.manifest); f.seal(); assert.throws(() => checker.verifyPackage(f.stage)); }
});
test("actual mixed native exports are rejected before packing", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.stage, "web", "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: { android: {} } }));
  assert.throws(() => checker.webInventory(path.join(f.stage, "web")), /Mixed native/);
});
test("Web apply retains old assets, uploads and database and installs HTML last", () => {
  const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup);
  const renamed = [], original = fs.renameSync;
  fs.renameSync = (source, target) => { renamed.push(target); return original(source, target); };
  try { assert.equal(checker.applyDeployment(f.web, f.stage, f.backup).files, 2); }
  finally { fs.renameSync = original; }
  assert.equal(path.basename(renamed.at(-1)), "index.html");
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "new index");
  assert.equal(fs.readFileSync(path.join(f.web, "assets", "old-hash.png"), "utf8"), "old asset");
  assert.equal(fs.readFileSync(path.join(f.web, "uploads", "sentinel.png"), "utf8"), "existing upload");
  assert.equal(fs.readFileSync(path.join(f.root, "api", "app.sqlite"), "utf8"), "existing database");
});
test("immutable asset collisions are rejected before backup or writes", () => {
  const f = fixture(); fs.writeFileSync(path.join(f.web, "assets", "new-hash.png"), "unexpected collision");
  assert.throws(() => checker.backupDeployment(f.web, f.stage, f.backup), /Immutable/);
  assert.equal(fs.readdirSync(f.backup).length, 0);
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "old index");
});
test("target changes after backup stop deployment", () => {
  const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup);
  fs.writeFileSync(path.join(f.web, "index.html"), "another operator changed this");
  assert.throws(() => checker.applyDeployment(f.web, f.stage, f.backup), /changed after backup/);
  assert.equal(fs.existsSync(path.join(f.web, "assets", "new-hash.png")), false);
});
test("rollback restores overwritten pages and retains removed new files in backup", () => {
  const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup); checker.applyDeployment(f.web, f.stage, f.backup);
  assert.equal(checker.rollbackDeployment(f.web, f.stage, f.backup).rollback, "web-only");
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "old index");
  assert.equal(fs.existsSync(path.join(f.web, "assets", "new-hash.png")), false);
  assert.equal(fs.readFileSync(path.join(f.backup, "failed-release", "assets", "new-hash.png"), "utf8"), "new asset");
  assert.equal(fs.readFileSync(path.join(f.web, "uploads", "sentinel.png"), "utf8"), "existing upload");
  assert.equal(fs.readFileSync(path.join(f.root, "api", "app.sqlite"), "utf8"), "existing database");
});
test("corrupt backups or mismatched recovery roots never replace live files", () => {
  for (const mutate of [
    f => fs.writeFileSync(path.join(f.backup, "web", "index.html"), "corrupt backup"),
    f => { const name = path.join(f.backup, "recovery.json"), plan = JSON.parse(fs.readFileSync(name)); plan.web = f.root; fs.writeFileSync(name, JSON.stringify(plan)); },
  ]) { const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup); checker.applyDeployment(f.web, f.stage, f.backup); mutate(f); assert.throws(() => checker.rollbackDeployment(f.web, f.stage, f.backup)); assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "new index"); }
});
test("deployment roots may not overlap and backup must be empty", () => {
  const f = fixture(); assert.throws(() => checker.backupDeployment(f.web, f.stage, f.web), /separate/);
  fs.writeFileSync(path.join(f.backup, "keep.txt"), "existing backup"); assert.throws(() => checker.backupDeployment(f.web, f.stage, f.backup), /empty/);
});
test("linked destination files are rejected", () => {
  const f = fixture(), linked = path.join(f.web, "assets", "new-hash.png");
  fs.linkSync(path.join(f.root, "api", "app.sqlite"), linked);
  assert.throws(() => checker.verifyTarget(f.web, f.stage), /hard links/);
});
test("symbolic directory targets cannot redirect an installation outside its Web root", () => {
  const f = fixture(), alias = path.join(f.root, "linked-web");
  fs.symlinkSync(f.web, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => checker.verifyTarget(alias, f.stage), /Symlink/);
  assert.throws(() => checker.backupDeployment(alias, f.stage, f.backup), /Symlink/);
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "old index");
});
test("public permissions survive restrictive umask", { skip: process.platform === "win32" }, () => {
  const f = fixture(), old = process.umask(0o077);
  try {
    fs.mkdirSync(path.join(f.stage, "web", "nested")); fs.writeFileSync(path.join(f.stage, "web", "nested", "page.html"), "new page");
    f.manifest.web = checker.webInventory(path.join(f.stage, "web")); f.seal();
    checker.backupDeployment(f.web, f.stage, f.backup); checker.applyDeployment(f.web, f.stage, f.backup);
    assert.equal(fs.statSync(path.join(f.web, "nested")).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(f.web, "nested", "page.html")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(f.backup, "web")).mode & 0o777, 0o700);
  } finally { process.umask(old); }
});
test("installer contains no service, API, database, Nginx or dependency modification command", () => {
  const installer = fs.readFileSync(path.join(__dirname, "../install-admin-shortcuts-language-20260923.sh.in"), "utf8");
  assert.doesNotMatch(installer, /\bsystemctl\b|\bnpm\b|\bnginx\s|API_DIR=|\brm\s+-|\bmv\s+/);
  assert.match(installer, /flock -n 9/); assert.match(installer, /disk_usage/); assert.match(installer, /cmp "\$0"/);
});


test("new manifest and recovery records use only the current release identity", () => {
  const f = fixture();
  assert.equal(checker.RELEASE, "admin-shortcuts-language-20260923");
  checker.backupDeployment(f.web, f.stage, f.backup);
  const recoveryFile = path.join(f.backup, "recovery.json");
  const recovery = JSON.parse(fs.readFileSync(recoveryFile));
  assert.equal(recovery.release, checker.RELEASE);
  recovery.release = "admin-panel-layout-20260918";
  fs.writeFileSync(recoveryFile, JSON.stringify(recovery));
  assert.throws(() => checker.applyDeployment(f.web, f.stage, f.backup), /Recovery inventory/);
  f.manifest.release = "admin-panel-layout-20260918"; f.seal();
  assert.throws(() => checker.verifyPackage(f.stage), /Invalid Web-only release/);
});

test("a partial Web installation can recover without touching backend or uploads", () => {
  const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup);
  const original = fs.renameSync; let writes = 0;
  fs.renameSync = (source, target) => {
    if (++writes === 2) throw new Error("simulated replacement failure");
    return original(source, target);
  };
  try { assert.throws(() => checker.applyDeployment(f.web, f.stage, f.backup), /simulated replacement failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(path.join(f.web, "assets", "new-hash.png"), "utf8"), "new asset");
  checker.rollbackDeployment(f.web, f.stage, f.backup);
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "old index");
  assert.equal(fs.existsSync(path.join(f.web, "assets", "new-hash.png")), false);
  assert.equal(fs.readFileSync(path.join(f.web, "assets", "old-hash.png"), "utf8"), "old asset");
  assert.equal(fs.readFileSync(path.join(f.root, "api", "app.sqlite"), "utf8"), "existing database");
  assert.equal(fs.readFileSync(path.join(f.web, "uploads", "sentinel.png"), "utf8"), "existing upload");
});

test("CLI refuses backend and historical release commands", () => {
  const { spawnSync } = require("node:child_process");
  for (const command of ["runtime", "baseline", "smoke", "feedback-smoke"]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, "../verify-admin-shortcuts-language-release.cjs"), command], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported Web-only command/);
  }
});



test("Windows PowerShell StageOnly builds a verified package without publishing a ZIP", { skip: process.platform !== "win32" }, () => {
  const { spawnSync } = require("node:child_process");
  const f = fixture(), projectRoot = path.resolve(__dirname, "../..");
  const zip = path.join(projectRoot, "deploy/2026-09-23/outdoor-fit-admin-shortcuts-language-20260923-update.zip");
  const artifactHashes = [zip, `${zip}.sha256`].map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(projectRoot, "scripts/package-admin-shortcuts-language.ps1"), "-WebDirectory", path.join(f.stage, "web"), "-StageOnly"], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const info = JSON.parse(result.stdout.slice(result.stdout.indexOf("\n") + 1).trim());
  const stageRoot = path.dirname(path.resolve(info.PackageStage));
  // Only the directory created by this smoke test is removable.
  assert.equal(path.dirname(stageRoot), path.join(projectRoot, "workspace-artifacts"));
  assert.match(path.basename(stageRoot), /^admslang23-[a-f0-9]{12}$/);
  try {
    assert.equal(checker.verifyPackage(info.PackageStage).release, checker.RELEASE);
    assert.equal(info.WebFiles, 2);
    assert.equal(fs.existsSync(path.join(stageRoot, "release.zip")), false);
    assert.deepEqual([zip, `${zip}.sha256`].map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null), artifactHashes);
  } finally { fs.rmSync(stageRoot, { recursive: true, force: true }); }
});


test("rollback never overwrites a concurrent operator edit", () => {
  const f = fixture(); checker.backupDeployment(f.web, f.stage, f.backup); checker.applyDeployment(f.web, f.stage, f.backup);
  fs.writeFileSync(path.join(f.web, "index.html"), "operator version");
  assert.throws(() => checker.rollbackDeployment(f.web, f.stage, f.backup), /Concurrent target change/);
  assert.equal(fs.readFileSync(path.join(f.web, "index.html"), "utf8"), "operator version");
  assert.equal(fs.readFileSync(path.join(f.web, "assets/new-hash.png"), "utf8"), "new asset");
});
test("embedded hashes are complete, safe and unique without a sidecar", () => {
  for (const mutation of [
    text => text.replace(/^[a-f0-9]{64}  README.md$/m, ""),
    text => text.replace(/([a-f0-9]{64}  README.md)/, "$1\\n$1".replace("\\n", "\n")),
    text => text.replace(/  README.md/, "  ../README.md"),
    text => text.replace(/<<'EMBEDDED_CHECKSUMS'/, "<<'MISSING'"),
  ]) {
    const f = fixture(), name = path.join(f.stage, "install-admin-shortcuts-language-20260923.sh");
    fs.writeFileSync(name, mutation(fs.readFileSync(name, "utf8")));
    assert.throws(() => checker.verifyPackage(f.stage));
  }
});
test("release commands are front-end only and require no checksum sidecar", () => {
  const source = fs.readFileSync(path.join(__dirname, "../package-admin-shortcuts-language.ps1"), "utf8");
  const notes = fs.readFileSync(path.join(__dirname, "../admin-shortcuts-language-release-README.md"), "utf8");
  assert.match(source, /Release ZIP exists and will not be overwritten/);
  assert.match(source, /admin-shortcuts-language-20260923-web/);
  assert.doesNotMatch(source, /server\\\\|Payload-Path|npm ci|eas update|outputZip \+ '.sha256'/);
  assert.match(notes, /校验值内嵌/);
  assert.doesNotMatch(notes, /gs:\/\/[^\s]+\.sha256/);
  assert.match(notes, /本轮后台页面更新无需手机 OTA/);
});
