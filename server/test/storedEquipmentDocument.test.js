import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readStoredEquipmentDocument } from "../src/storedEquipmentDocument.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stored-word-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("the document parser validates DOCX separately");
  const row = { id: "abc", kind: "file", name: "Teaching.docx", source: "upload", archived: 0, deleted_at: null, storage_name: "abc.bin", size_bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  await fs.writeFile(path.join(root, row.storage_name), bytes);
  let calls = 0;
  const database = { dialect: "mysql", get: async (sql, values) => { calls++; assert.equal(sql, "SELECT * FROM media_files WHERE id = ?"); assert.deepEqual(values, ["abc"]); return row; } };
  return { root, row, bytes, database, calls: () => calls, read: () => readStoredEquipmentDocument({ database, mediaUploadDir: root, mediaId: "abc" }) };
}

test("reads only an unchanged private stored document and returns bytes to the existing parser", async t => {
  const f = await fixture(t);
  const result = await f.read();
  assert.deepEqual(result, { buffer: f.bytes, fileName: "Teaching.docx" });
});
test("rejects missing, deleted, archived, external and non-DOCX records", async t => {
  for (const patch of [{ deleted_at: "2026-10-02" }, { archived: 1 }, { source: "external" }, { kind: "image" }, { name: "README.txt" }, { storage_name: "../abc.bin" }, { size_bytes: 13 * 1024 * 1024 }]) {
    const f = await fixture(t); Object.assign(f.row, patch);
    await assert.rejects(f.read(), error => ["storedDocumentUnavailable", "invalidDocxName", "invalidDocx"].includes(error.code));
  }
});
test("rejects altered bytes even when size stays the same", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, f.row.storage_name), Buffer.alloc(f.bytes.length, 65));
  await assert.rejects(f.read(), { code: "invalidDocx" });
});
test("rejects caller paths before querying storage", async t => {
  const f = await fixture(t);
  await assert.rejects(readStoredEquipmentDocument({ database: f.database, mediaUploadDir: f.root, mediaId: "../../private" }), { code: "storedDocumentUnavailable" });
  assert.equal(f.calls(), 0);
});
