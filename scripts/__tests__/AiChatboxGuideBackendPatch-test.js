const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { verifyPackage, verifyBaseline, ROOT_FILES, ORIGINAL_FILES, SEP14_FILES, SEP16_FILES, SEP16_PROSE_FILES, INSTALLED_FILES, MAX_FILE_BYTES } = require("../verify-ai-chatbox-guide-backend-patch.cjs");
const RELEASE = "ai-chatbox-guide-20260917";
const OLD = "pdf-app-timer-20260911", PREVIOUS = "ai-symptom-evidence-20260914", EXCERPTS = "ai-tcm-excerpts-20260916", PROSE = "ai-tcm-prose-20260916";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const created = [];
const payloads = {
  "src/app.js": "new app", "src/assistant.js": "new assistant", "src/assistantGuide.js": "new read-only guide implementation",
  "src/assistantSymptomEvidence.js": "new symptom implementation", "src/assistantTcm.js": "new TCM implementation",
  "src/equipmentGuideEvidence.json": JSON.stringify(Object.fromEntries(Array.from({ length: 29 }, (_, id) => [String(id), Object.fromEntries(["zh", "en"].map(locale => [locale, {
    details: `${locale} complete instructions ${id}`, kinesiologyTip: "", ptTip: `${locale} original guide ${id}`, otTip: "", tcmTip: "", tcmEnabled: false, careTip: "",
  }]))]))),
};

function fixture(state = OLD) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outdoor-fit-chatbox-guide-patch-test-"));
  created.push(root);
  const stage = path.join(root, "stage"), api = path.join(root, "api");
  fs.mkdirSync(stage);
  fs.mkdirSync(path.join(api, "src"), { recursive: true });
  const old = Object.fromEntries(ORIGINAL_FILES.map(name => [name, `old ${name}`]));
  const previous = { ...old, "src/app.js": "previous app", "src/assistant.js": "previous assistant", "src/assistantSymptomEvidence.js": "previous symptom implementation", "src/equipmentGuideEvidence.json": payloads["src/equipmentGuideEvidence.json"] };
  const excerpts = { ...previous, "src/app.js": "TCM excerpt app", "src/assistantSymptomEvidence.js": "TCM excerpt symptom implementation", "src/assistantTcm.js": "TCM excerpt helper" };
  const prose = { ...excerpts, "src/app.js": "TCM prose app", "src/assistantSymptomEvidence.js": "TCM prose symptom implementation", "src/assistantTcm.js": "TCM prose helper" };
  const installed = { ...prose, ...payloads };
  const states = { [OLD]: old, [PREVIOUS]: previous, [EXCERPTS]: excerpts, [PROSE]: prose, [RELEASE]: installed };
  for (const [name, bytes] of Object.entries(states[state])) fs.writeFileSync(path.join(api, name), bytes);
  const manifest = {
    version: 4, release: RELEASE,
    files: Object.entries(payloads).map(([name, bytes]) => ({ path: name, archive: path.basename(name), sha256: hash(bytes) })),
    baselines: [[OLD, old], [PREVIOUS, previous], [EXCERPTS, excerpts], [PROSE, prose]].map(([release, files]) => ({ release, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])) })),
  };
  for (const name of ROOT_FILES) fs.writeFileSync(path.join(stage, name), name);
  for (const [name, bytes] of Object.entries(payloads)) fs.writeFileSync(path.join(stage, path.basename(name)), bytes);
  const seal = () => {
    fs.writeFileSync(path.join(stage, "patch-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(stage, "checksums.sha256"), ROOT_FILES.filter(name => name !== "checksums.sha256").map(name => `${hash(fs.readFileSync(path.join(stage, name)))}  ${name}\n`).join(""));
  };
  seal();
  return { root, stage, api, manifest, seal, states };
}

afterAll(() => {
  for (const root of created) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("outdoor-fit-chatbox-guide-patch-test-")) throw new Error("Unsafe test cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exact release inventories contain 19 initial, 21 symptom, 22 excerpt/prose, 23 installed and 11 archive entries", () => {
  expect(ORIGINAL_FILES).toHaveLength(19);
  expect(SEP14_FILES).toHaveLength(21);
  expect(SEP16_FILES).toHaveLength(22);
  expect(SEP16_PROSE_FILES).toHaveLength(22);
  expect(INSTALLED_FILES).toHaveLength(23);
  expect(ROOT_FILES).toHaveLength(11);
  expect(ROOT_FILES.filter(name => name !== "checksums.sha256")).toHaveLength(10);
  expect(INSTALLED_FILES).toContain("src/assistantGuide.js");
  expect(SEP16_PROSE_FILES).not.toContain("src/assistantGuide.js");
  expect(ORIGINAL_FILES).not.toContain("src/assistantSymptomEvidence.js");
  expect(SEP14_FILES).not.toContain("src/assistantTcm.js");
  expect(SEP16_FILES).toContain("src/assistantTcm.js");
});

test.each([OLD, PREVIOUS, EXCERPTS, PROSE, RELEASE])("accepts only the complete %s version and changes no source files", state => {
  const data = fixture(state), before = fs.readFileSync(path.join(data.api, "src/app.js"));
  expect(verifyPackage(data.stage).targets["src/app.js"]).toBe(hash(payloads["src/app.js"]));
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: state === RELEASE ? "installed" : "baseline", release: state });
  expect(fs.readFileSync(path.join(data.api, "src/app.js"))).toEqual(before);
  expect(fs.existsSync(path.join(data.api, "src/assistantTcm.js"))).toBe([EXCERPTS, PROSE, RELEASE].includes(state));
});

test.each([
  [OLD, "src/assistantSymptomEvidence.js"], [OLD, "src/equipmentGuideEvidence.json"],
  [OLD, "src/assistantTcm.js"], [PREVIOUS, "src/assistantTcm.js"],
  ...[OLD, PREVIOUS, EXCERPTS, PROSE].map(state => [state, "src/assistantGuide.js"]),
])("rejects pre-staged new file %s / %s even with the exact target hash", (state, name) => {
  const data = fixture(state);
  fs.writeFileSync(path.join(data.api, name), payloads[name]);
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/pre-staged/);
});

test.each([
  [OLD, "src/app.js", PREVIOUS], [PREVIOUS, "src/assistant.js", OLD],
  [PREVIOUS, "src/app.js", RELEASE], [RELEASE, "src/assistant.js", PREVIOUS],
  [RELEASE, "src/assistantSymptomEvidence.js", PREVIOUS],
  [EXCERPTS, "src/app.js", PREVIOUS], [PREVIOUS, "src/app.js", EXCERPTS],
  [EXCERPTS, "src/app.js", RELEASE], [RELEASE, "src/app.js", EXCERPTS],
  [EXCERPTS, "src/assistantTcm.js", RELEASE], [RELEASE, "src/assistantTcm.js", EXCERPTS],
  [EXCERPTS, "src/assistantSymptomEvidence.js", PREVIOUS],
  [PROSE, "src/app.js", EXCERPTS], [EXCERPTS, "src/app.js", PROSE],
  [PROSE, "src/app.js", RELEASE], [RELEASE, "src/app.js", PROSE],
  [PROSE, "src/assistantTcm.js", EXCERPTS], [RELEASE, "src/assistantTcm.js", PROSE],
  [RELEASE, "src/assistantSymptomEvidence.js", PROSE],
])("rejects mixed version %s with %s from %s", (state, name, source) => {
  const data = fixture(state);
  fs.writeFileSync(path.join(data.api, name), data.states[source][name]);
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/mixed/);
});

test.each(["src/database.js", "package.json", "package-lock.json", "src/app.js"])("rejects changed source %s", name => {
  const data = fixture(PREVIOUS);
  fs.appendFileSync(path.join(data.api, name), "unauthorized");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow();
});

test.each(["app.js", "assistantTcm.js", "assistantGuide.js", "README.md", "verify-ai-chatbox-guide-backend-patch.cjs"])("rejects altered package file %s", name => {
  const data = fixture();
  fs.appendFileSync(path.join(data.stage, name), "unauthorized");
  expect(() => verifyPackage(data.stage)).toThrow(/checksum mismatch/);
});

test("rejects missing installed payload and extra root/source entries", () => {
  const data = fixture(RELEASE);
  fs.unlinkSync(path.join(data.api, "src/assistantTcm.js"));
  expect(() => verifyBaseline(data.api, data.stage)).toThrow();
  fs.writeFileSync(path.join(data.stage, "extra.js"), "unexpected");
  expect(() => verifyPackage(data.stage)).toThrow(/eleven approved/);
  fs.unlinkSync(path.join(data.stage, "extra.js"));
  fs.writeFileSync(path.join(data.api, "src/extra.js"), "unexpected");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/Unexpected file/);
});

test.each(["src/../outside.js", "src\\app.js", "/tmp/app.js", "src/sub/app.js", "src/.hidden.js", "constructor"])("rejects an unsafe or extra baseline entry %s", name => {
  const data = fixture();
  data.manifest.baselines[0].files[name] = hash("unsafe");
  data.seal();
  expect(() => verifyPackage(data.stage)).toThrow(/Baseline file list/);
});

test("rejects wrong/duplicate baseline releases, incomplete inventories and non-payload baseline differences", () => {
  for (const change of [
    manifest => { manifest.baselines[0].release = "unknown"; },
    manifest => { manifest.baselines[1].release = OLD; },
    manifest => { manifest.baselines[2].release = PREVIOUS; },
    manifest => { manifest.baselines[3].release = EXCERPTS; },
    manifest => { manifest.baselines.pop(); },
    manifest => { manifest.baselines.push(manifest.baselines[2]); },
    manifest => { delete manifest.baselines[0].files["src/security.js"]; },
    manifest => { manifest.baselines[0].files["src/assistantTcm.js"] = hash("new"); },
    manifest => { manifest.baselines[1].files["package.json"] = hash("different dependency"); },
    manifest => { manifest.baselines[1].files["src/database.js"] = hash("different schema"); },
    manifest => { manifest.baselines[2].files["src/database.js"] = hash("third baseline different schema"); },
    manifest => { manifest.baselines[2].files["package-lock.json"] = hash("third baseline different dependency"); },
    manifest => { delete manifest.baselines[2].files["src/assistantTcm.js"]; },
    manifest => { manifest.baselines[2].files["src/app.js"] = manifest.baselines[1].files["src/app.js"]; },
    manifest => { manifest.baselines[2].files["src/app.js"] = hash(payloads["src/app.js"]); },
    manifest => { manifest.baselines[0].files["src/app.js"] = hash(payloads["src/app.js"]); },
    manifest => { manifest.baselines[3].files["src/database.js"] = hash("fourth baseline schema drift"); },
    manifest => { manifest.baselines[3].files["package-lock.json"] = hash("fourth baseline dependency drift"); },
    manifest => { manifest.baselines[3].files["src/assistantGuide.js"] = hash("pre-staged helper"); },
    manifest => { delete manifest.baselines[3].files["src/assistantTcm.js"]; },
    manifest => { manifest.baselines[3].files["src/app.js"] = manifest.baselines[2].files["src/app.js"]; },
    manifest => { manifest.baselines[3].files["src/app.js"] = hash(payloads["src/app.js"]); },
    manifest => { manifest.baselines[1].files["src/app.js"] = manifest.baselines[0].files["src/app.js"]; },
  ]) {
    const data = fixture();
    change(data.manifest);
    data.seal();
    expect(() => verifyPackage(data.stage)).toThrow();
  }
});

test("rejects wrong manifest version, unsafe/duplicate payloads, malformed hashes and unknown keys", () => {
  for (const change of [
    manifest => { manifest.version = 1; }, manifest => { manifest.version = 2; }, manifest => { manifest.version = 3; }, manifest => { manifest.release = OLD; },
    manifest => { manifest.files[0].archive = "../app.js"; },
    manifest => { manifest.files[1] = { ...manifest.files[0] }; },
    manifest => { manifest.files[0].sha256 = "bad-hash"; },
    manifest => { manifest.baselines[1].files["src/security.js"] = "bad-hash"; },
    manifest => { manifest.extra = true; },
  ]) {
    const data = fixture();
    change(data.manifest);
    data.seal();
    expect(() => verifyPackage(data.stage)).toThrow();
  }
});

test("rejects oversized package and baseline files before allocating arbitrary input sizes", () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.stage, "README.md"), Buffer.alloc(MAX_FILE_BYTES + 1));
  expect(() => verifyPackage(data.stage)).toThrow(/2 MiB/);
  fs.writeFileSync(path.join(data.stage, "README.md"), "small");
  data.seal();
  fs.writeFileSync(path.join(data.api, "src/database.js"), Buffer.alloc(MAX_FILE_BYTES + 1));
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/2 MiB/);
});

test("rejects extra, duplicate, unsafe and malformed checksum entries", () => {
  for (const change of [
    text => `${text}${hash("x")}  extra.js\n`,
    text => text.replace("  README.md", "  app.js"),
    text => text.replace("  README.md", "  ../README.md"),
    text => text.replace("  README.md", " *README.md"),
  ]) {
    const data = fixture(), target = path.join(data.stage, "checksums.sha256");
    fs.writeFileSync(target, change(fs.readFileSync(target, "utf8")));
    expect(() => verifyPackage(data.stage)).toThrow(/checksum/i);
  }
});

test("rejects invalid evidence schema even with correctly resealed checksums", () => {
  const data = fixture(), invalid = JSON.stringify({ 28: { zh: { description: "invented" } } });
  fs.writeFileSync(path.join(data.stage, "equipmentGuideEvidence.json"), invalid);
  data.manifest.files.find(item => item.archive === "equipmentGuideEvidence.json").sha256 = hash(invalid);
  data.seal();
  expect(() => verifyPackage(data.stage)).toThrow(/Evidence/);
});

test("rejects symlinked stage and source directories without following them", () => {
  const data = fixture(), linked = path.join(data.root, "linked-stage");
  fs.symlinkSync(data.stage, linked, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyPackage(linked)).toThrow(/Symlink/);
  const source = path.join(data.api, "src"), moved = path.join(data.root, "original-source");
  fs.renameSync(source, moved);
  fs.symlinkSync(moved, source, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/Symlink/);
});

test("rejects a payload replaced with a directory junction/symlink", () => {
  const data = fixture(), target = path.join(data.stage, "assistantTcm.js");
  fs.unlinkSync(target);
  fs.symlinkSync(data.api, target, process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyPackage(data.stage)).toThrow(/Symlink/);
});



test.each([OLD, PREVIOUS, EXCERPTS, PROSE, RELEASE])("baseline order does not change recognition of %s", state => {
  const data = fixture(state);
  data.manifest.baselines.reverse();
  data.seal();
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: state === RELEASE ? "installed" : "baseline", release: state });
});

test.each([OLD, PREVIOUS, EXCERPTS, PROSE, RELEASE])("rejects a tampered complete %s baseline without modifying files", state => {
  const data = fixture(state), target = path.join(data.api, "src/security.js");
  fs.appendFileSync(target, " tampered authorization code");
  const before = fs.readFileSync(target);
  expect(() => verifyBaseline(data.api, data.stage)).toThrow(/approved baseline/);
  expect(fs.readFileSync(target)).toEqual(before);
});

test("the smoke verifier asserts answer prose and excludes live entrypoints and external AI", () => {
  const source = fs.readFileSync(path.join(__dirname, "../verify-ai-chatbox-guide-backend-patch.cjs"), "utf8");
  expect(source).toContain('createDatabase(":memory:")');
  expect(source).toContain('mediaSeedDir: null');
  expect(source).toContain('app.listen(0, "127.0.0.1")');
  expect(source).toContain('factoryCalls === 0');
  expect(source).toContain('deepSeekClientFactory: () =>');
  expect(source).toContain('call("search_facility_guide"');
  expect(source).toContain('call("get_facility_guide"');
  expect(source).toContain('SELECT total_changes() AS total');
  expect(source).toContain('answer.reply.includes(item.name)');
  expect(source).toContain('answer.reply.includes(quote)');
  expect(source).toContain('Disabled TCM persisted in symptom answer prose');
  expect(source).toContain('Disabled TCM persisted in direct answer prose');
  expect(source).not.toContain('importSource("index.js")');
  expect(source).not.toContain('importSource("config.js")');
});

test.each([undefined, null, 12, false, {}, []])("rejects missing or non-string snapshot details: %s", value => {
  const data = fixture();
  const evidence = JSON.parse(payloads["src/equipmentGuideEvidence.json"]);
  if (value === undefined) delete evidence["0"].en.details;
  else evidence["0"].en.details = value;
  const bytes = JSON.stringify(evidence);
  fs.writeFileSync(path.join(data.stage, "equipmentGuideEvidence.json"), bytes);
  data.manifest.files.find(item => item.archive === "equipmentGuideEvidence.json").sha256 = hash(bytes);
  data.seal();
  expect(() => verifyPackage(data.stage)).toThrow(/Evidence/);
});

test.each([OLD, PREVIOUS, EXCERPTS, PROSE, RELEASE])("baseline verification excludes private data and environment files for %s", state => {
  const data = fixture(state), privateRoot = path.join(data.api, "data");
  fs.mkdirSync(privateRoot);
  const privateDatabase = path.join(privateRoot, "outdoor-fit.sqlite"), environment = path.join(data.api, ".env");
  const secret = "SYNTHETIC_PRIVATE_DATA_DO_NOT_READ";
  fs.writeFileSync(privateDatabase, secret);
  fs.writeFileSync(environment, secret);
  expect(verifyBaseline(data.api, data.stage)).toEqual({ state: state === RELEASE ? "installed" : "baseline", release: state });
  expect(fs.readFileSync(privateDatabase, "utf8")).toBe(secret);
  expect(fs.readFileSync(environment, "utf8")).toBe(secret);
});

test("rejects a package missing its guide helper or containing a nested payload directory", () => {
  const data = fixture();
  const guide = path.join(data.stage, "assistantGuide.js");
  fs.unlinkSync(guide);
  expect(() => verifyPackage(data.stage)).toThrow(/eleven approved/);
  fs.mkdirSync(guide);
  expect(() => verifyPackage(data.stage)).toThrow(/regular file/);
});

test("rejects smoke scratch inside, outside-parent-of, or nonempty beside the API before importing source", () => {
  const data = fixture(), verifier = path.resolve(__dirname, "../verify-ai-chatbox-guide-backend-patch.cjs");
  const inside = path.join(data.api, "scratch"), nonempty = path.join(data.root, "nonempty");
  fs.mkdirSync(inside); fs.mkdirSync(nonempty);
  fs.writeFileSync(path.join(nonempty, "private.txt"), "untouched");
  for (const scratch of [inside, data.root, nonempty]) {
    expect(() => execFileSync(process.execPath, [verifier, "smoke", data.api, scratch], { encoding: "utf8", stdio: "pipe", timeout: 10000 })).toThrow();
  }
  expect(fs.readFileSync(path.join(nonempty, "private.txt"), "utf8")).toBe("untouched");
});

test("historical guide patch smoke fails closed against the later FAQ backend without changing its source", () => {
  const data = fixture(), scratch = path.join(data.root, "smoke"), api = path.resolve(__dirname, "../../server");
  fs.mkdirSync(scratch);
  const verifier = path.resolve(__dirname, "../verify-ai-chatbox-guide-backend-patch.cjs");
  const before = fs.readFileSync(path.join(api, "src/app.js"));
  // This release-bound verifier predates the deterministic FAQ path. It must
  // refuse that later backend, not silently accept changed response contracts.
  let failure;
  try { execFileSync(process.execPath, [verifier, "smoke", api, scratch], { encoding: "utf8", stdio: "pipe", timeout: 40000 }); }
  catch (error) { failure = error; }
  expect(failure).toBeDefined();
  expect(failure.status).toBe(1);
  expect(String(failure.stderr)).toContain("Verification failed: Assistant did not use the expected APP-only retrieval path");
  expect(fs.readFileSync(path.join(api, "src/app.js"))).toEqual(before);
  expect(fs.readdirSync(scratch).every(name => ["equipment", "media", "guide-equipment", "guide-media"].includes(name))).toBe(true);
}, 45000);
