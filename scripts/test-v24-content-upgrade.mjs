import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

// Offline upgrade fixture only. No production DB, credentials or remote API.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(process.argv[2], "Usage: node scripts/test-v24-content-upgrade.mjs <verified-package-stage>");
const stage = path.resolve(process.argv[2]);
assert.ok(stage.startsWith(`${projectRoot}${path.sep}workspace-artifacts${path.sep}`));
const require = createRequire(import.meta.url);
const checker = require(path.join(stage, "verify-v24-content-release.cjs"));
const { manifest } = checker.verifyPackage(stage);
const baseline = manifest.baselines.find((item) => item.release === "contact-feedback-20260918");
assert.ok(baseline);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const archive = fs.readFileSync(path.join(projectRoot, "deploy/2026-09-18/outdoor-fit-contact-feedback-20260918-update.zip"));
assert.equal(sha256(archive), "351b1ae40bbaa06be02925ef91b890abd48e61e2ad75aceb5189f8a05dc3fb7e");

// Read only named, small members from the pinned archive. Never extract its
// supplied paths onto disk; all destinations come from the reviewed manifest.
function archiveMembers(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "ZIP end record missing");
  const members = new Map(), count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.ok(!members.has(name), "Duplicate ZIP member");
    members.set(name, {
      method: bytes.readUInt16LE(offset + 10), compressed: bytes.readUInt32LE(offset + 20),
      size: bytes.readUInt32LE(offset + 24), local: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return (name) => {
    const entry = members.get(name);
    assert.ok(entry && entry.size <= 2 * 1024 * 1024 && [0, 8].includes(entry.method), "Unapproved ZIP member");
    assert.equal(bytes.readUInt32LE(entry.local), 0x04034b50);
    const start = entry.local + 30 + bytes.readUInt16LE(entry.local + 26) + bytes.readUInt16LE(entry.local + 28);
    const compressed = bytes.subarray(start, start + entry.compressed);
    const result = entry.method === 8 ? inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 }) : compressed;
    assert.equal(result.length, entry.size);
    return result;
  };
}
const readMember = archiveMembers(archive);
const oldManifest = JSON.parse(readMember("release-manifest.json"));
assert.equal(oldManifest.release, baseline.release);
assert.equal(oldManifest.files.length, 8);
const oldPayloads = new Map(oldManifest.files.map((item) => [item.path, item]));
const runRoot = fs.mkdtempSync(path.join(projectRoot, "workspace-artifacts/v24-real-upgrade-"));
const apiRoot = path.join(runRoot, "api");
fs.mkdirSync(path.join(apiRoot, "src"), { recursive: true });
for (const [name, expected] of Object.entries(baseline.files)) {
  assert.match(name, /^(?:src\/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$/);
  const old = oldPayloads.get(name);
  if (old) {
    assert.equal(old.archive, name.slice(4));
    assert.equal(old.sha256, expected);
  }
  const bytes = old ? readMember(old.archive) : fs.readFileSync(path.join(projectRoot, "server", name));
  assert.equal(sha256(bytes), expected, `Historical baseline changed: ${name}`);
  fs.writeFileSync(path.join(apiRoot, name), bytes, { flag: "wx" });
}
const beforeBaseline = checker.verifyBaseline(apiRoot, stage);
assert.deepEqual(beforeBaseline, { release: "contact-feedback-20260918", state: "baseline" });
fs.symlinkSync(path.join(projectRoot, "server/node_modules"), path.join(apiRoot, "node_modules"), "junction");
const databasePath = path.join(runRoot, "upgrade.sqlite");
const oldModule = await import(`${pathToFileURL(path.join(apiRoot, "src/database.js")).href}?phase=before`);
let database = oldModule.createDatabase(databasePath);
let result;
try {
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='equipment_tcm_content_updates'").get(), undefined);
  const at = "2026-09-01T00:00:00.000Z";
  database.prepare(`INSERT INTO users
    (id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at)
    VALUES ('upgrade-test-user','Local upgrade fixture','+85260000123','upgrade@example.invalid','staff','test','test',?,?)`).run(at, at);
  database.prepare(`INSERT INTO admin_accounts
    (user_id,system_role,permissions_json,is_active,created_at,updated_at)
    VALUES ('upgrade-test-user','operator','["feedback.read"]',1,?,?)`).run(at, at);
  database.prepare(`INSERT INTO feedback
    (id,submission_id,content_hash,user_id,submitter_type,name,email,subject,message,locale,status,notes,created_at,updated_at)
    VALUES ('upgrade-test-feedback','upgrade-test-submission','test','upgrade-test-user','registered',
    'Local fixture','upgrade@example.invalid','Keep feedback','Existing feedback must survive',
    'en','in_progress','Existing internal note',?,?)`).run(at, at);
  database.prepare(`UPDATE app_equipment_items SET tcm_zh='旧版管理员中医说明',
    tcm_en='Previous administrator TCM text',tcm_enabled=0,is_active=0,
    video_url_zh='/api/media/test/preserved.mp4',details_zh='保留使用步骤',updated_at=? WHERE id='0'`).run(at);
  database.prepare("UPDATE app_equipment_items SET tcm_zh='足健径原说明',tcm_en='Keep foot massage text' WHERE id='28'").run();
  const preservedTables = ["users", "feedback", "admin_accounts"];
  const beforeProtected = Object.fromEntries(preservedTables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const beforeEquipment = database.prepare("SELECT * FROM app_equipment_items ORDER BY id").all();
  database.close(); database = null;

  // Precisely the four release files; no package/dependency or data replacement.
  assert.equal(manifest.files.length, 4);
  for (const item of manifest.files) {
    assert.match(item.path, /^src\/[A-Za-z0-9_-]+\.(js|json)$/);
    assert.equal(item.archive, item.path.slice(4));
    const bytes = fs.readFileSync(path.join(stage, item.archive));
    assert.equal(sha256(bytes), item.sha256);
    fs.writeFileSync(path.join(apiRoot, item.path), bytes);
  }
  const afterBaseline = checker.verifyBaseline(apiRoot, stage);
  assert.deepEqual(afterBaseline, { release: manifest.release, state: "installed" });
  const updatedModule = await import(`${pathToFileURL(path.join(apiRoot, "src/database.js")).href}?phase=after`);
  database = updatedModule.createDatabase(databasePath);
  const content = JSON.parse(fs.readFileSync(path.join(apiRoot, "src/tcmV24Content.json"), "utf8"));
  const replacements = new Map(content.items.map((item) => [item.id, item]));
  const audit = database.prepare("SELECT * FROM equipment_tcm_content_updates WHERE revision=?").get(content.revision);
  assert.ok(audit);
  assert.equal(JSON.parse(audit.before_json).length, 9);
  assert.equal(JSON.parse(audit.applied_json).length, 9);
  assert.deepEqual(JSON.parse(audit.skipped_json), []);
  for (const previous of beforeEquipment) {
    const current = database.prepare("SELECT * FROM app_equipment_items WHERE id=?").get(previous.id);
    const item = replacements.get(previous.id);
    assert.deepEqual(current, item ? {
      ...previous, tcm_zh: item.tcmZh, tcm_en: item.tcmEn, updated_at: audit.applied_at,
    } : previous);
  }
  for (const table of preservedTables) assert.deepEqual(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), beforeProtected[table]);
  const savedOriginal = JSON.parse(audit.before_json).find((item) => item.id === "0");
  assert.equal(savedOriginal.tcmZh, "旧版管理员中医说明");
  assert.equal(savedOriginal.tcmEn, "Previous administrator TCM text");
  assert.equal(savedOriginal.tcmEnabled, 0);
  assert.equal(savedOriginal.isActive, 0);
  database.prepare("UPDATE app_equipment_items SET tcm_zh='升级后的管理员编辑',tcm_en='New maintained text' WHERE id='0'").run();
  const afterAdminEdit = database.prepare("SELECT * FROM app_equipment_items ORDER BY id").all();
  database.close(); database = null;
  database = updatedModule.createDatabase(databasePath);
  assert.deepEqual(database.prepare("SELECT * FROM app_equipment_items ORDER BY id").all(), afterAdminEdit);
  assert.deepEqual(database.prepare("SELECT * FROM equipment_tcm_content_updates WHERE revision=?").get(content.revision), audit);
  for (const table of preservedTables) assert.deepEqual(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), beforeProtected[table]);
  result = {
    result: "passed", runRoot, archiveSha256: sha256(archive), beforeBaseline, afterBaseline,
    appliedFiles: manifest.files.length, bilingualFacilitiesUpdated: replacements.size,
    otherFacilitiesPreserved: beforeEquipment.length - replacements.size,
    availabilityAndTcmSwitchPreserved: true, allOtherEquipmentFieldsPreserved: true,
    originalTcmBackupVerified: true, usersPreserved: true, feedbackPreserved: true,
    adminPermissionsPreserved: true, repeatedStartupPreservesEdits: true, externalApiCalls: 0,
  };
} finally { if (database?.open) database.close(); }
fs.writeFileSync(path.join(runRoot, "results.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
