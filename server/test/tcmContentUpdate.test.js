import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../src/database.js";
import {
  applyTcmV24ContentUpdate, readTcmV24Content, validateTcmV24Content,
  TCM_V24_REVISION, TCM_V24_SOURCE_SHA256,
} from "../src/tcmContentUpdate.js";

const content = readTcmV24Content();
const rows = (database) => database.prepare("SELECT * FROM app_equipment_items ORDER BY id").all();
const row = (database, id) => database.prepare("SELECT * FROM app_equipment_items WHERE id = ?").get(id);
const audit = (database) => database.prepare("SELECT * FROM equipment_tcm_content_updates WHERE revision = ?").get(TCM_V24_REVISION);

function legacyFixture(run) {
  const database = createDatabase(":memory:");
  database.prepare("DELETE FROM equipment_tcm_content_updates").run();
  database.prepare(`UPDATE app_equipment_items SET
    tcm_zh = '管理员原有中文说明', tcm_en = 'Previous administrator text',
    updated_at = '2026-09-01T00:00:00.000Z'`).run();
  try { return run(database); } finally { database.close(); }
}

test("new databases receive exactly the nine reviewed bilingual V24 sections and retain schema version 23", () => {
  const database = createDatabase(":memory:");
  try {
    assert.equal(content.items.length, 9);
    for (const item of content.items) {
      assert.equal(row(database, item.id).tcm_zh, item.tcmZh);
      assert.equal(row(database, item.id).tcm_en, item.tcmEn);
      assert.equal(row(database, item.id).tcm_enabled, null);
    }
    const ids = new Set(content.items.map((item) => item.id));
    for (const item of rows(database).filter((item) => !ids.has(item.id))) {
      assert.equal(item.tcm_zh, "");
      assert.equal(item.tcm_en, "");
    }
    assert.equal(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 23);
    const saved = audit(database);
    assert.equal(saved.source_sha256, TCM_V24_SOURCE_SHA256);
    assert.equal(saved.content_sha256, validateTcmV24Content(content).contentSha256);
    assert.equal(JSON.parse(saved.before_json).length, 9);
    assert.equal(JSON.parse(saved.applied_json).length, 9);
    assert.deepEqual(JSON.parse(saved.skipped_json), []);
  } finally { database.close(); }
});

test("existing overrides update in both languages without changing any other content, availability or permissions", () => legacyFixture((database) => {
  database.prepare(`UPDATE app_equipment_items SET
    name_zh = '管理员修改后的名称', name_en = 'An edited built-in name',
    tcm_enabled = 0, is_active = 0, sort_order = 211,
    categories_json = '["relaxation"]', image_url = '/keep-image.png',
    gif_left_url = '/left.gif', gif_right_url = '/right.gif',
    video_url = '/video.mp4', video_url_zh = '/video-zh.mp4',
    video_url_en = '/video-en.mp4', video_localized = 1,
    details_zh = '保留使用说明', pt_tip_en = 'Keep physiotherapy advice'
    WHERE id = '0'`).run();
  database.prepare("UPDATE app_equipment_items SET tcm_enabled = 1 WHERE id = '4'").run();
  const before = rows(database);
  const result = applyTcmV24ContentUpdate(database);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.updatedIds, content.items.map((item) => item.id));
  const replacements = new Map(content.items.map((item) => [item.id, item]));
  for (const previous of before) {
    const current = row(database, previous.id), replacement = replacements.get(previous.id);
    assert.deepEqual(current, replacement ? {
      ...previous, tcm_zh: replacement.tcmZh, tcm_en: replacement.tcmEn, updated_at: result.appliedAt,
    } : previous);
  }
  const backups = JSON.parse(audit(database).before_json);
  assert.deepEqual(backups.find((item) => item.id === "0"), {
    id: "0", nameZh: "管理员修改后的名称", nameEn: "An edited built-in name",
    tcmZh: "管理员原有中文说明", tcmEn: "Previous administrator text",
    tcmEnabled: 0, isActive: 0, updatedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(row(database, "28").tcm_zh, "管理员原有中文说明");
}));

test("repeated application and database restart preserve later administrator changes and the original audit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outdoor-fit-tcm-v24-test-"));
  const databasePath = path.join(directory, "app.sqlite");
  let database;
  try {
    database = createDatabase(databasePath);
    const originalAudit = audit(database);
    database.prepare("UPDATE app_equipment_items SET tcm_zh = '新维护内容', tcm_en = '', tcm_enabled = 0, is_active = 0 WHERE id = '0'").run();
    assert.equal(applyTcmV24ContentUpdate(database).status, "already_applied");
    database.close();
    database = createDatabase(databasePath);
    assert.equal(row(database, "0").tcm_zh, "新维护内容");
    assert.equal(row(database, "0").tcm_en, "");
    assert.equal(row(database, "0").tcm_enabled, 0);
    assert.equal(row(database, "0").is_active, 0);
    assert.deepEqual(audit(database), originalAudit);
  } finally {
    if (database?.open) database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("custom IDs, deleted items and missing identities are skipped with explicit audit reasons", () => legacyFixture((database) => {
  database.prepare("UPDATE app_equipment_items SET is_custom = 1 WHERE id = '0'").run();
  database.prepare("UPDATE app_equipment_items SET is_active = 0, deleted_at = '2026-09-15T00:00:00.000Z' WHERE id = '4'").run();
  database.prepare("DELETE FROM app_equipment_items WHERE id = '6'").run();
  const before = rows(database), result = applyTcmV24ContentUpdate(database);
  assert.equal(result.updatedIds.length, 6);
  assert.deepEqual(result.skipped, [{ id: "0", reason: "custom" }, { id: "4", reason: "deleted" }, { id: "6", reason: "missing" }]);
  for (const id of ["0", "4", "28"]) assert.deepEqual(row(database, id), before.find((item) => item.id === id));
  assert.equal(row(database, "6"), undefined);
  assert.deepEqual(JSON.parse(audit(database).skipped_json), result.skipped);
}));

test("an SQL error rolls back all text updates and the content revision marker", () => legacyFixture((database) => {
  const before = rows(database);
  database.exec(`CREATE TRIGGER reject_tcm_v24 BEFORE UPDATE OF tcm_zh ON app_equipment_items
    WHEN OLD.id = '6' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
  assert.throws(() => applyTcmV24ContentUpdate(database), /simulated write failure/);
  assert.deepEqual(rows(database), before);
  assert.equal(audit(database), undefined);
  database.exec("DROP TRIGGER reject_tcm_v24");
  assert.equal(applyTcmV24ContentUpdate(database).updatedIds.length, 9);
}));

test("an audit write failure rolls back the text updates as well", () => legacyFixture((database) => {
  const before = rows(database);
  database.exec(`CREATE TRIGGER reject_tcm_audit BEFORE INSERT ON equipment_tcm_content_updates
    BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END`);
  assert.throws(() => applyTcmV24ContentUpdate(database), /simulated audit failure/);
  assert.deepEqual(rows(database), before);
  assert.equal(audit(database), undefined);
}));

test("unknown source, revision, duplicate or mismapped IDs and incomplete bilingual text fail before writing", () => {
  const changes = [
    (report) => { report.revision = "another-version"; },
    (report) => { report.sourceSha256 = "0".repeat(64); },
    (report) => { report.items.pop(); },
    (report) => { report.items[1] = report.items[0]; },
    (report) => { report.items[0].id = 0; },
    (report) => { report.items[0].id = "28"; },
    (report) => { report.items[0].code = "21"; },
    (report) => { report.items[0].nameZh = "错误器材"; },
    (report) => { report.items[0].tcmZh = " "; },
    (report) => { report.items[0].tcmEn = null; },
    (report) => { report.items[0].tcmEn = "x".repeat(200001); },
  ];
  for (const change of changes) legacyFixture((database) => {
    const report = structuredClone(content), before = rows(database);
    change(report);
    assert.throws(() => applyTcmV24ContentUpdate(database, report), /V24 TCM/);
    assert.deepEqual(rows(database), before);
    assert.equal(audit(database), undefined);
  });
});

test("reusing a revision with different text is rejected, while JSON item order is immaterial", () => {
  const database = createDatabase(":memory:");
  try {
    const before = rows(database), report = structuredClone(content);
    report.items[0].tcmEn += " Unexpected replacement.";
    assert.throws(() => applyTcmV24ContentUpdate(database, report), /cannot be reused/);
    assert.deepEqual(rows(database), before);
    const reordered = { ...content, items: [...content.items].reverse() };
    assert.equal(applyTcmV24ContentUpdate(database, reordered).status, "already_applied");
  } finally { database.close(); }
});
