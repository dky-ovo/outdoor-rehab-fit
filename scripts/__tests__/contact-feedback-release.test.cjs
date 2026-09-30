const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const checker = require("../verify-contact-feedback-release.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const roots = [];
test("PowerShell packaging enumerates portable slash ZIP members on Windows PowerShell 5.1", () => {
  const script = fs.readFileSync(path.join(__dirname, "../package-contact-feedback.ps1"), "utf8");
  assert.match(script, /CreateEntryFromFile\(\$newZip,/);
  assert.match(script, /'web\/' \+ \$_\.path/);
  assert.doesNotMatch(script, /ZipFile\]::CreateFromDirectory/);
  assert.match(script, /\$webInventory = ConvertFrom-Json -InputObject/);
});
function fixture(state = checker.BASELINES[0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contact-release-test-")); roots.push(root);
  const api = path.join(root, "api"), web = path.join(root, "web"), stage = path.join(root, "stage"), backup = path.join(root, "backup");
  for (const directory of [path.join(api, "src"), path.join(api, "data"), web, path.join(stage, "web", "assets"), backup]) fs.mkdirSync(directory, { recursive: true });
  const states = {};
  checker.BASELINES.forEach((release, index) => {
    states[release] = Object.fromEntries(checker.INVENTORIES[index].map(name => [name, name === "src/app.js" ? `old app ${release}` : `unchanged ${name}`]));
  });
  const payload = Object.fromEntries(checker.PAYLOADS.map(name => [`src/${name}`, `new ${name}`]));
  states[checker.RELEASE] = { ...states[checker.BASELINES[4]], ...payload };
  for (const [name, bytes] of Object.entries(states[state])) fs.writeFileSync(path.join(api, name), bytes);
  fs.writeFileSync(path.join(api, "data", "app.sqlite"), "existing accounts and sessions");
  fs.writeFileSync(path.join(api, "data", "app.sqlite-wal"), "pending journal");
  fs.writeFileSync(path.join(api, ".env"), "PRIVATE_SENTINEL");
  fs.writeFileSync(path.join(web, "index.html"), "old index");
  fs.mkdirSync(path.join(web, "assets")); fs.writeFileSync(path.join(web, "assets", "old-hash.png"), "keep old asset");
  for (const name of checker.ROOT_FILES) fs.writeFileSync(path.join(stage, name), name);
  for (const [name, bytes] of Object.entries(payload)) fs.writeFileSync(path.join(stage, path.basename(name)), bytes);
  fs.writeFileSync(path.join(stage, "web", "index.html"), "new index"); fs.writeFileSync(path.join(stage, "web", "assets", "new-hash.png"), "new image");
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
  const runtimeFile = path.join(root, "runtime.json"); fs.writeFileSync(runtimeFile, JSON.stringify({ port: 3000, dbPath: path.join(api, "data", "app.sqlite") }));
  return { root, api, web, stage, backup, manifest, states, seal, runtimeFile };
}
test.after(() => {
  for (const root of roots) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("contact-release-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("strict release recognizes all five complete old baselines and this complete installed release", () => {
  for (const release of [...checker.BASELINES, checker.RELEASE]) {
    const data = fixture(release);
    assert.deepEqual(checker.verifyBaseline(data.api, data.stage), { release, state: release === checker.RELEASE ? "installed" : "baseline" });
    assert.equal(checker.verifyPackage(data.stage).manifest.files.length, 8);
    assert.equal(fs.readFileSync(path.join(data.api, ".env"), "utf8"), "PRIVATE_SENTINEL");
  }
});

test("unknown, mixed, prestaged, dependency and extra-source states stop without writing", () => {
  for (const mutation of [
    data => fs.writeFileSync(path.join(data.api, "src", "feedback.js"), "new feedback.js"),
    data => fs.appendFileSync(path.join(data.api, "src", "app.js"), "unknown"),
    data => fs.appendFileSync(path.join(data.api, "package-lock.json"), "new dependency"),
    data => fs.writeFileSync(path.join(data.api, "src", "extra.js"), "unknown"),
    data => fs.writeFileSync(path.join(data.api, "src", "app.js"), data.states[checker.BASELINES[4]]["src/app.js"]),
  ]) {
    const data = fixture(); mutation(data); const before = fs.readFileSync(path.join(data.api, "src", "app.js"));
    assert.throws(() => checker.verifyBaseline(data.api, data.stage)); assert.deepEqual(fs.readFileSync(path.join(data.api, "src", "app.js")), before);
  }
});

test("backend, web and verifier tampering or unexpected release entries invalidate checksums", () => {
  for (const name of ["app.js", "feedback.js", "database.js", "verify-contact-feedback-release.cjs", "web/index.html", "web/assets/new-hash.png"]) {
    const data = fixture(); fs.appendFileSync(path.join(data.stage, name), "altered"); assert.throws(() => checker.verifyPackage(data.stage));
  }
  const data = fixture(); fs.writeFileSync(path.join(data.stage, "web", "extra.js"), "unlisted"); assert.throws(() => checker.verifyPackage(data.stage));
});

test("malformed manifests reject unknown baselines, missing inventory, duplicate payloads and traversals", () => {
  for (const mutate of [
    m => { m.baselines[0].release = "unknown"; }, m => { delete m.baselines[0].files["src/security.js"]; },
    m => { m.baselines[1].files["package.json"] = hash("different"); }, m => { m.baselines[1] = m.baselines[0]; },
    m => { m.files[0].archive = "../outside.js"; }, m => { m.files[1] = m.files[0]; },
    m => { m.web[0].path = "../outside.html"; }, m => { m.web.push(m.web[0]); }, m => { m.extra = true; },
  ]) { const data = fixture(); mutate(data.manifest); data.seal(); assert.throws(() => checker.verifyPackage(data.stage)); }
});

test("only safe web exports pass; native bundles, secrets, videos and real node_modules are excluded", () => {
  for (const name of ["../index.html", "/index.html", "a\\index.html", "a//index.html", ".env", "assets/../index.html", "assets/private.key", "assets/video.mp4", "data/users.db", "uploads/photo.png", "node_modules/pkg/index.js", "_expo/static/js/android/bundle.js", "_expo/static/js/ios/bundle.js"]) assert.equal(checker.validWebPath(name), false, name);
  for (const name of ["index.html", "_expo/static/js/web/entry-abcd.js", "assets/node_modules/font/icon.ttf", "assets/images/icon.png", "assets/sounds/timer.wav"]) assert.equal(checker.validWebPath(name), true, name);
  const data = fixture();
  fs.writeFileSync(path.join(data.stage, "web", "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: {} }));
  assert.equal(checker.webInventory(path.join(data.stage, "web")).length, 3);
  fs.writeFileSync(path.join(data.stage, "web", "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: { android: {} } }));
  assert.throws(() => checker.webInventory(path.join(data.stage, "web")), /Mixed native/);
});

test("symlink/junction and hard-link boundaries cannot be used for source, web or stage traversal", t => {
  const data = fixture(), link = path.join(data.root, "linked");
  try { fs.symlinkSync(data.stage, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host denies creating symlinks"); throw error; }
  assert.throws(() => checker.verifyPackage(link), /Symlink/);
  const nested = path.join(data.web, "assets", "new-hash.png"); fs.symlinkSync(data.api, nested, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /Symlink/);
  fs.linkSync(path.join(data.stage, "app.js"), path.join(data.root, "hardlink.js")); assert.throws(() => checker.verifyPackage(data.stage), /hard links/);
});

test("web preflight retains old assets and refuses immutable asset collisions or target type mismatches", () => {
  const data = fixture(); assert.equal(checker.verifyWebTarget(data.web, data.stage).files, 2);
  fs.writeFileSync(path.join(data.web, "assets", "new-hash.png"), "different bytes under same hash name");
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /collision/);
  fs.unlinkSync(path.join(data.web, "assets", "new-hash.png")); fs.mkdirSync(path.join(data.web, "assets", "new-hash.png"));
  assert.throws(() => checker.verifyWebTarget(data.web, data.stage), /regular file/);
});

test("backup, apply and code/Web rollback retain changed live database, WAL, private files and old assets", () => {
  const data = fixture();
  const backup = checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile); assert.equal(backup.backup, "complete");
  assert.equal(fs.readFileSync(path.join(data.backup, "database", "database.sqlite"), "utf8"), "existing accounts and sessions");
  assert.equal(fs.readFileSync(path.join(data.backup, "database", "database.sqlite-wal"), "utf8"), "pending journal");
  checker.applyDeployment(data.api, data.web, data.stage, data.backup);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "installed");
  assert.equal(checker.verifyInstalledWeb(data.web, data.stage).installedWeb, "verified");
  fs.writeFileSync(path.join(data.api, "data", "app.sqlite"), "new user feedback after migration");
  const result = checker.rollbackDeployment(data.api, data.web, data.stage, data.backup); assert.equal(result.database, "untouched");
  assert.equal(checker.verifyBaseline(data.api, data.stage).release, checker.BASELINES[0]);
  assert.equal(fs.readFileSync(path.join(data.api, "data", "app.sqlite"), "utf8"), "new user feedback after migration");
  assert.equal(fs.readFileSync(path.join(data.api, "data", "app.sqlite-wal"), "utf8"), "pending journal");
  assert.equal(fs.readFileSync(path.join(data.api, ".env"), "utf8"), "PRIVATE_SENTINEL");
  assert.equal(fs.readFileSync(path.join(data.web, "index.html"), "utf8"), "old index");
  assert.equal(fs.readFileSync(path.join(data.web, "assets", "old-hash.png"), "utf8"), "keep old asset");
  assert.equal(fs.existsSync(path.join(data.web, "assets", "new-hash.png")), false);
  assert.equal(fs.readFileSync(path.join(data.backup, "failed-release", "web", "assets", "new-hash.png"), "utf8"), "new image");
});

test("umask 077 never makes new Web assets or restored source unreadable", { skip: process.platform === "win32" }, () => {
  const data = fixture(), original = process.umask(0o077);
  try {
    fs.mkdirSync(path.join(data.stage, "web", "new-section", "deep"), { recursive: true });
    fs.writeFileSync(path.join(data.stage, "web", "new-section", "deep", "page.html"), "New nested page");
    data.manifest.web = checker.webInventory(path.join(data.stage, "web")); data.seal();
    fs.chmodSync(path.join(data.api, "src", "app.js"), 0o644);
    checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
    checker.applyDeployment(data.api, data.web, data.stage, data.backup);
    assert.equal(fs.statSync(path.join(data.web, "assets", "new-hash.png")).mode & 0o777, 0o644);
    for (const relative of ["new-section", "new-section/deep"]) assert.equal(fs.statSync(path.join(data.web, relative)).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(data.web, "new-section", "deep", "page.html")).mode & 0o777, 0o644);
    checker.rollbackDeployment(data.api, data.web, data.stage, data.backup);
    assert.equal(fs.statSync(path.join(data.api, "src", "app.js")).mode & 0o777, 0o644);
  } finally { process.umask(original); }
});

test("changed targets after backup, tampered recovery files and mismatched roots stop safely", () => {
  const data = fixture(); checker.backupDeployment(data.api, data.web, data.stage, data.backup, data.runtimeFile);
  fs.writeFileSync(path.join(data.web, "index.html"), "concurrent change");
  assert.throws(() => checker.applyDeployment(data.api, data.web, data.stage, data.backup), /changed after backup/);
  assert.equal(checker.verifyBaseline(data.api, data.stage).state, "baseline");
  fs.writeFileSync(path.join(data.backup, "api", "src", "app.js"), "corrupt backup");
  assert.throws(() => checker.rollbackDeployment(data.api, data.web, data.stage, data.backup), /checksum/);
});

test("installer preserves ordering and uses scoped recovery without dependency/Nginx/database restoration", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../deploy/2026-09-18/install-contact-feedback-20260918.sh"), "utf8");
  assert.ok(source.includes('/run/outdoor-fit-file-explorer-deploy.lock'));
  assert.ok(source.indexOf('STOPPED=1\nsystemctl stop') < source.indexOf('"$CHECKER" backup'));
  assert.ok(source.indexOf('"$CHECKER" backup') < source.indexOf('"$CHECKER" apply'));
  assert.ok(source.indexOf('shutil.disk_usage(destination).free') < source.indexOf("target = os.path.join(destination"));
  assert.ok(source.includes('"$CHECKER" web-installed')); assert.ok(source.includes('cmp "$WORK_DIR/runtime-before.json" "$WORK_DIR/runtime-after.json"'));
  assert.ok(!/npm\s+(?:ci|install)|systemctl\s+\w+\s+nginx|rm\s+-rf/.test(source));
});

test("actual isolated HTTP smoke verifies feedback identity, permissions and optimistic updates", async () => {
  const data = fixture(), scratch = path.join(data.root, "smoke"); fs.mkdirSync(scratch);
  const result = await checker.feedbackSmoke(path.resolve(__dirname, "../../server"), scratch);
  assert.equal(result.smoke, "passed"); assert.equal(result.database, "memory"); assert.equal(result.externalAiCalls, 0);
});
