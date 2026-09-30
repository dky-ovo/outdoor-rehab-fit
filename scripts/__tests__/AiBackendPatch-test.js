const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyPackage, verifyBaseline, ROOT_FILES, MAX_FILE_BYTES } = require("../verify-ai-backend-patch.cjs");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const created = [];
const payloads = {
  "src/app.js": "new app",
  "src/assistant.js": "new assistant",
  "src/assistantSymptomEvidence.js": "new evidence implementation",
  "src/equipmentGuideEvidence.json": JSON.stringify(Object.fromEntries(Array.from({ length: 29 }, (_, id) => [String(id), Object.fromEntries(["zh", "en"].map(locale => [locale, {
    kinesiologyTip: "", ptTip: `${locale} original guide ${id}`, otTip: "", tcmTip: "", tcmEnabled: false, careTip: "",
  }]))]))),
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outdoor-fit-ai-patch-test-"));
  created.push(root);
  const stage = path.join(root, "stage"), api = path.join(root, "api");
  fs.mkdirSync(stage);
  fs.mkdirSync(path.join(api, "src"), { recursive: true });
  const oldFiles = {
    "src/app.js": "old app", "src/assistant.js": "old assistant", "src/database.js": "old database",
    "src/security.js": "old security", "src/index.js": "old entrypoint", "package.json": "{}", "package-lock.json": "{}",
  };
  for (const [name, bytes] of Object.entries(oldFiles)) fs.writeFileSync(path.join(api, name), bytes);
  const manifest = {
    version: 1, release: "ai-symptom-evidence-20260914",
    files: Object.entries(payloads).map(([name, bytes]) => ({ path: name, archive: path.basename(name), sha256: hash(bytes) })),
    baseline: { release: "pdf-app-timer-20260911", files: Object.fromEntries(Object.entries(oldFiles).map(([name, bytes]) => [name, hash(bytes)])) },
  };
  for (const name of ROOT_FILES) fs.writeFileSync(path.join(stage, name), name);
  for (const [name, bytes] of Object.entries(payloads)) fs.writeFileSync(path.join(stage, path.basename(name)), bytes);
  const seal = () => {
    fs.writeFileSync(path.join(stage, "patch-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(stage, "checksums.sha256"), ROOT_FILES.filter(name => name !== "checksums.sha256").map(name => `${hash(fs.readFileSync(path.join(stage, name)))}  ${name}\n`).join(""));
  };
  const install = () => { for (const [name, bytes] of Object.entries(payloads)) fs.writeFileSync(path.join(api, name), bytes); };
  seal();
  return { root, stage, api, manifest, seal, install };
}

afterAll(() => {
  for (const root of created) {
    // Only remove exact fixture directories created by this test process.
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("outdoor-fit-ai-patch-test-")) throw new Error("Unsafe test cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifies the exact package and an unchanged baseline without modifying either", () => {
  const data = fixture();
  const before = fs.readFileSync(path.join(data.api, "src/app.js"));
  expect(verifyPackage(data.stage).targets["src/app.js"]).toBe(hash(payloads["src/app.js"]));
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: "baseline" });
  expect(fs.readFileSync(path.join(data.api, "src/app.js"))).toEqual(before);
  expect(fs.existsSync(path.join(data.api, "src/assistantSymptomEvidence.js"))).toBe(false);
});

test("accepts baseline with pre-staged exact new files, and an all-new installed patch", () => {
  const data = fixture();
  for (const name of ["src/assistantSymptomEvidence.js", "src/equipmentGuideEvidence.json"]) fs.writeFileSync(path.join(data.api, name), payloads[name]);
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: "baseline" });
  data.install();
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: "installed" });
});

test.each(["src/app.js", "src/assistant.js"])("rejects mixed old/new state when only %s is replaced", changed => {
  const data = fixture();
  fs.writeFileSync(path.join(data.api, changed), payloads[changed]);
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/mixed states/);
});

test.each(["src/database.js", "package.json", "src/app.js"])("rejects tampered baseline source %s", changed => {
  const data = fixture();
  fs.appendFileSync(path.join(data.api, changed), "unauthorized change");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow();
});

test("rejects an installed patch missing a new file or with a tampered new file", () => {
  const data = fixture();
  data.install();
  fs.unlinkSync(path.join(data.api, "src/assistantSymptomEvidence.js"));
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/mixed states/);
  fs.writeFileSync(path.join(data.api, "src/assistantSymptomEvidence.js"), "different source");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/unexpected hash/);
});

test.each(["app.js", "README.md", "verify-ai-backend-patch.cjs"])("rejects modified package content %s", name => {
  const data = fixture();
  fs.appendFileSync(path.join(data.stage, name), "modified");
  expect(() => verifyPackage(data.stage)).toThrow(/checksum mismatch/);
});

test("rejects extra package and source entries", () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.stage, "extra.js"), "unexpected");
  expect(() => verifyPackage(data.stage)).toThrow(/nine approved files/);
  fs.unlinkSync(path.join(data.stage, "extra.js"));
  fs.writeFileSync(path.join(data.api, "src/extra.js"), "unexpected");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/Unexpected file/);
});

test.each(["src/../outside.js", "src\\app.js", "/tmp/app.js", "src/subdir/app.js", "src/.hidden.js", "constructor"])("rejects unsafe manifest baseline path %s", name => {
  const data = fixture();
  data.manifest.baseline.files[name] = hash("unsafe");
  data.seal();
  expect(() => verifyPackage(data.stage)).toThrow(/baseline path/);
});

test("rejects payload traversal, duplicates and wrong manifest release", () => {
  for (const change of [
    manifest => { manifest.files[0].archive = "../app.js"; },
    manifest => { manifest.files[1] = { ...manifest.files[0] }; },
    manifest => { manifest.release = "different-release"; },
    manifest => { manifest.files[0].sha256 = "not-a-hash"; },
    manifest => { delete manifest.baseline.files["package-lock.json"]; },
  ]) {
    const data = fixture();
    change(data.manifest);
    data.seal();
    expect(() => verifyPackage(data.stage)).toThrow();
  }
});

test("rejects oversized regular package files and oversized baseline files", () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.stage, "README.md"), Buffer.alloc(MAX_FILE_BYTES + 1));
  expect(() => verifyPackage(data.stage)).toThrow(/2 MiB/);
  fs.writeFileSync(path.join(data.stage, "README.md"), "small");
  data.seal();
  fs.writeFileSync(path.join(data.api, "src/database.js"), Buffer.alloc(MAX_FILE_BYTES + 1));
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/2 MiB/);
});

test("rejects extra, duplicate, unsafe and malformed checksums", () => {
  for (const change of [
    text => `${text}${hash("x")}  extra.js\n`,
    text => text.replace("  README.md", "  app.js"),
    text => text.replace("  README.md", "  ../README.md"),
    text => text.replace("  README.md", " *README.md"),
  ]) {
    const data = fixture();
    const target = path.join(data.stage, "checksums.sha256");
    fs.writeFileSync(target, change(fs.readFileSync(target, "utf8")));
    expect(() => verifyPackage(data.stage)).toThrow(/checksum/i);
  }
});

test("rejects invalid evidence schema even when payload and package checksums match", () => {
  const data = fixture();
  const bad = JSON.stringify({ 28: { zh: { description: "invented" } } });
  fs.writeFileSync(path.join(data.stage, "equipmentGuideEvidence.json"), bad);
  data.manifest.files.find(item => item.archive === "equipmentGuideEvidence.json").sha256 = hash(bad);
  data.seal();
  expect(() => verifyPackage(data.stage)).toThrow(/Evidence/);
});

test("rejects linked stage or source directories without following them", () => {
  const data = fixture();
  const linkedStage = path.join(data.root, "linked-stage");
  fs.symlinkSync(data.stage, linkedStage, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyPackage(linkedStage)).toThrow(/Symlink/);
  const source = path.join(data.api, "src"), moved = path.join(data.root, "real-source");
  fs.renameSync(source, moved);
  fs.symlinkSync(moved, source, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/Symlink/);
});

test("rejects a payload path replaced by a directory link", () => {
  const data = fixture();
  const payload = path.join(data.stage, "app.js");
  fs.unlinkSync(payload);
  fs.symlinkSync(data.api, payload, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyPackage(data.stage)).toThrow(/Symlink/);
});
