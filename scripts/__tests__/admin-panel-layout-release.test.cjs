const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const checker = require("../verify-admin-panel-layout-release.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-web-release-test-")); roots.push(root);
  const stage = path.join(root, "stage"), web = path.join(root, "web"), backup = path.join(root, "backup");
  for (const directory of [path.join(stage, "web", "assets"), path.join(web, "assets"), backup]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), "old index");
  fs.writeFileSync(path.join(web, "assets", "old-hash.png"), "old asset");
  fs.mkdirSync(path.join(web, "uploads")); fs.writeFileSync(path.join(web, "uploads", "sentinel.png"), "existing upload");
  fs.mkdirSync(path.join(root, "api")); fs.writeFileSync(path.join(root, "api", "app.sqlite"), "existing database");
  for (const name of checker.ROOT_FILES) fs.writeFileSync(path.join(stage, name), name);
  fs.writeFileSync(path.join(stage, "web", "index.html"), "new index");
  fs.writeFileSync(path.join(stage, "web", "assets", "new-hash.png"), "new asset");
  const manifest = { version: 1, release: checker.RELEASE, web: checker.webInventory(path.join(stage, "web")) };
  const seal = () => {
    fs.writeFileSync(path.join(stage, "release-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(stage, "checksums.sha256"), checker.ROOT_FILES.filter(name => name !== "checksums.sha256").map(name => `${hash(fs.readFileSync(path.join(stage, name)))}  ${name}\n`).join(""));
  };
  seal(); return { root, stage, web, backup, manifest, seal };
}
test.after(() => {
  for (const root of roots) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("admin-web-release-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("portable Windows PowerShell packaging rejects overwrite and emits slash members", () => {
  const source = fs.readFileSync(path.join(__dirname, "../package-admin-panel-layout.ps1"), "utf8");
  assert.match(source, /CreateEntryFromFile\(\$newZip,/);
  assert.match(source, /'web\/' \+ \$_\.path/);
  assert.match(source, /\$webInventory = ConvertFrom-Json -InputObject/);
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
  for (const name of ["verify-admin-panel-layout-release.cjs", "verify-contact-feedback-release.cjs", "verify-ai-chatbox-guide-backend-patch.cjs", "web/index.html", "web/assets/new-hash.png"]) {
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
  const installer = fs.readFileSync(path.join(__dirname, "../../deploy/2026-09-18/install-admin-panel-layout-20260918.sh"), "utf8");
  assert.doesNotMatch(installer, /\bsystemctl\b|\bnpm\b|\bnginx\s|API_DIR=|\brm\s+-|\bmv\s+/);
  assert.match(installer, /flock -n 9/); assert.match(installer, /disk_usage/); assert.match(installer, /cmp "\$0"/);
});
