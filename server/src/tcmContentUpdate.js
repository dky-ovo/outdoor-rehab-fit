import crypto from "node:crypto";
import fs from "node:fs";
import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";

export const TCM_V24_REVISION = "equipment-tcm-v24-20260918";
export const TCM_V24_SOURCE_SHA256 = "aeb4eb8a0942d9c485300b310529507303ec54b60ed63b1d9f867033c65fe340";

// V24's body labels the pull-down machine 18a; its index and the older video
// document label it 18. Do not derive these identities from numeric offsets.
const EXPECTED_CODES = Object.freeze({
  "0": "1", "4": "5a", "6": "5c", "8": "7", "10": "9",
  "16": "14", "19": "17", "20": "18a", "22": "21",
});

export const TCM_CONTENT_UPDATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS equipment_tcm_content_updates (
    revision TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    before_json TEXT NOT NULL,
    applied_json TEXT NOT NULL,
    skipped_json TEXT NOT NULL
  );
`;

export function readTcmV24Content() {
  return JSON.parse(fs.readFileSync(new URL("./tcmV24Content.json", import.meta.url), "utf8"));
}

export function validateTcmV24Content(report) {
  if (report?.revision !== TCM_V24_REVISION || report?.sourceSha256 !== TCM_V24_SOURCE_SHA256) {
    throw new Error("V24 TCM revision or source document checksum mismatch");
  }
  if (!Array.isArray(report.items) || report.items.length !== Object.keys(EXPECTED_CODES).length) {
    throw new Error("V24 TCM update requires all nine reviewed bilingual facilities");
  }
  const expected = new Set(Object.keys(EXPECTED_CODES));
  const items = report.items.map((item) => {
    const identity = BUILT_IN_EQUIPMENT_CATALOG.find((equipment) => equipment.id === item?.id);
    if (!identity || !expected.delete(item.id) || item.code !== EXPECTED_CODES[item.id] || item.nameZh !== identity.nameZh) {
      throw new Error("V24 TCM facility identity mismatch");
    }
    for (const language of ["tcmZh", "tcmEn"]) {
      if (typeof item[language] !== "string" || !item[language].trim() || item[language].length > 200000) {
        throw new Error("V24 TCM update requires complete Chinese and English text");
      }
    }
    return { id: item.id, code: item.code, nameZh: item.nameZh, tcmZh: item.tcmZh, tcmEn: item.tcmEn };
  }).sort((left, right) => Number(left.id) - Number(right.id));
  const canonical = { revision: report.revision, sourceSha256: report.sourceSha256, items };
  return {
    ...canonical,
    contentSha256: crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

// This is a versioned content migration, not a recurring seed. Preserve later
// administrator edits, availability switches and every non-TCM content field.
// The private audit table retains the exact previous text for manual recovery.
export function applyTcmV24ContentUpdate(database, report = readTcmV24Content()) {
  const content = validateTcmV24Content(report);
  return database.transaction(() => {
    database.exec(TCM_CONTENT_UPDATE_SCHEMA);
    const previous = database.prepare("SELECT * FROM equipment_tcm_content_updates WHERE revision = ?").get(content.revision);
    if (previous) {
      if (previous.source_sha256 !== content.sourceSha256 || previous.content_sha256 !== content.contentSha256) {
        throw new Error("An applied V24 TCM revision cannot be reused for different content");
      }
      return { status: "already_applied", revision: content.revision, appliedAt: previous.applied_at };
    }

    const before = [], applied = [], skipped = [], appliedAt = new Date().toISOString();
    const lookup = database.prepare("SELECT * FROM app_equipment_items WHERE id = ?");
    const update = database.prepare(`
      UPDATE app_equipment_items SET tcm_zh = ?, tcm_en = ?, updated_at = ?
      WHERE id = ? AND is_custom = 0 AND deleted_at IS NULL
    `);
    for (const item of content.items) {
      const row = lookup.get(item.id);
      // A custom item occupying a numeric ID is not the reviewed built-in item.
      // Deleted entries are never resurrected; disabled built-ins stay disabled.
      const reason = !row ? "missing" : row.is_custom !== 0 ? "custom" : row.deleted_at !== null ? "deleted" : null;
      if (reason) { skipped.push({ id: item.id, reason }); continue; }
      before.push({
        id: row.id, nameZh: row.name_zh, nameEn: row.name_en,
        tcmZh: row.tcm_zh, tcmEn: row.tcm_en, tcmEnabled: row.tcm_enabled,
        isActive: row.is_active, updatedAt: row.updated_at,
      });
      const result = update.run(item.tcmZh, item.tcmEn, appliedAt, item.id);
      if (result.changes !== 1) throw new Error(`V24 TCM update did not update expected facility ${item.id}`);
      applied.push(item);
    }
    database.prepare(`
      INSERT INTO equipment_tcm_content_updates
        (revision, source_sha256, content_sha256, applied_at, before_json, applied_json, skipped_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(content.revision, content.sourceSha256, content.contentSha256, appliedAt,
      JSON.stringify(before), JSON.stringify(applied), JSON.stringify(skipped));
    return { status: "applied", revision: content.revision, appliedAt, updatedIds: applied.map((item) => item.id), skipped };
  }).immediate();
}
