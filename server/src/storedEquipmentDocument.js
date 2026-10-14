import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EQUIPMENT_DOCUMENT_LIMITS } from "./equipmentDocumentImport.js";

const fail = (code = "storedDocumentUnavailable", status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};

// Only read an authorized library record, never a caller-supplied URL/path.
// Generic attachments remain inaccessible through public media endpoints.
export async function readStoredEquipmentDocument({ database, mediaUploadDir, mediaId }) {
  if (typeof mediaId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(mediaId)) fail();
  const sql = "SELECT * FROM media_files WHERE id = ?";
  const row = database.dialect === "mysql" ? await database.get(sql, [mediaId]) : database.prepare(sql).get(mediaId);
  if (!row || row.deleted_at || Number(row.archived) || row.source !== "upload" || row.kind !== "file") fail();
  if (typeof row.name !== "string" || !/\.docx$/i.test(row.name) || row.name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(row.name)) fail("invalidDocxName");
  if (!/^[a-f0-9-]+\.bin$/.test(row.storage_name || "")) fail();
  const root = path.resolve(mediaUploadDir);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail();
  const target = path.join(root, row.storage_name);
  const targetStat = await fs.lstat(target);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) fail();
  let file;
  try {
    file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > EQUIPMENT_DOCUMENT_LIMITS.uploadBytes || stat.size !== Number(row.size_bytes)) fail("invalidDocx");
    const buffer = await file.readFile();
    if (buffer.length !== stat.size || !/^[a-f0-9]{64}$/.test(row.sha256 || "") || crypto.createHash("sha256").update(buffer).digest("hex") !== row.sha256) fail("invalidDocx");
    return { buffer, fileName: row.name };
  } finally { await file?.close(); }
}
