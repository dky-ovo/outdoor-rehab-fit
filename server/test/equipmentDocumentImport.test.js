import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createDatabase } from "../src/database.js";
import { EQUIPMENT_DOCUMENT_IMPORT_SCHEMA, createEquipmentDocumentImport, parseEquipmentDocument, parseEquipmentDocumentXml } from "../src/equipmentDocumentImport.js";

const escapeXml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const p = (text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc>${p(text)}</w:tc>`;
const row = (values) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
const block = (code = "1", name = "太極揉推器/太極推手器Tai Chi Wheel/ Taiji Pushing/ Push Hands", rows = [["中醫學角度 Traditional Chinese Medicine Perspective", "文档中文", "Document English"]]) => `${p(`${code} ${name}`)}<w:tbl>${row(["", "Chinese", "English"])}${rows.map(row).join("")}</w:tbl>`;
const xml = (body = block()) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
function crc32(buffer) { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function zip(entries) {
	let offset = 0; const locals = [], centrals = [];
	for (const [name, content] of entries) {
		const file = Buffer.from(name); const source = Buffer.from(content); const compressed = deflateRawSync(source); const crc = crc32(source);
		const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(offset, 42);
		locals.push(local, file, compressed); centrals.push(central, file); offset += local.length + file.length + compressed.length;
	}
	const directory = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
const docx = (body = xml(), extras = []) => zip([["[Content_Types].xml", '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" /></Types>'], ["word/document.xml", body], ...extras]);
const fixture = () => { const database = createDatabase(":memory:"); database.exec(EQUIPMENT_DOCUMENT_IMPORT_SCHEMA); let clock = Date.now(); const service = createEquipmentDocumentImport({ database, now: () => clock }); return { database, service, later: (ms) => { clock += ms; } }; };
const preview = (service, body = xml()) => service.preview({ buffer: docx(body), fileName: "Teaching.docx", actorId: "admin-one" });
const confirm = (service, draft, fields = ["tcm_zh"]) => service.confirm({ previewId: draft.previewId, actorId: "admin-one", idempotencyKey: draft.confirmationKey, selections: [{ id: "0", fields }] });
const codeError = (code) => (error) => error.code === code;

test("fixed bilingual content maps code and exact names, not code minus one", async () => {
	const result = await parseEquipmentDocument(docx(xml(block("9", "小腿伸展 Calf Stretch"))), "A.docx"); assert.equal(result.entries[0].id, "10"); assert.equal(result.entries[0].fields.tcm_en, "Document English"); assert.equal(result.issues.length, 0);
	const alias = parseEquipmentDocumentXml(xml(block("18a", "上肢伸展器 Pull-down Machine"))); assert.equal(alias.entries[0].id, "20");
});
test("UTF8 BOM from genuine Word documents is supported", () => { assert.equal(parseEquipmentDocumentXml(`\uFEFF${xml()}`).entries.length, 1); });
test("swapped or missing language headers are blocked, not silently imported into the wrong locale", () => {
	const source = xml();
	for (const replacement of [row(["", "English", "Chinese"]), ""]) assert.equal(parseEquipmentDocumentXml(source.replace(row(["", "Chinese", "English"]), replacement)).issues[0].code, "invalidLanguageHeader");
});
test("mismatched, missing and duplicate identities are blocking errors", () => {
	assert.equal(parseEquipmentDocumentXml(xml(block("9"))).issues[0].code, "equipmentIdentityMismatch");
	assert.equal(parseEquipmentDocumentXml(xml(block() + block())).issues[0].code, "duplicateEquipment");
	assert.equal(parseEquipmentDocumentXml(xml(`<w:tbl>${row(["使用方法", "中", "English"])}</w:tbl>`)).issues[0].code, "missingHeading");
});
test("duplicate and missing-language columns are blocking, omitted facilities are preserved", () => {
	const result = parseEquipmentDocumentXml(xml(block("1", "太極揉推器 Tai Chi Wheel/ Taiji Pushing/ Push Hands", [["使用方法", "中", "en"], ["使用方法", "中2", "en2"], ["中醫學角度", "中"]])));
	assert.deepEqual(result.issues.map((issue) => issue.code), ["duplicateField", "missingLanguageColumn"]); assert.equal(result.skipped.length, 28);
});
test("nonDOCX, path traversal, ZIP duplicates and macros are rejected without writing files", async () => {
	await assert.rejects(parseEquipmentDocument(docx(), "file.doc"), codeError("invalidDocxName")); await assert.rejects(parseEquipmentDocument(Buffer.from("not zip"), "x.docx"), codeError("invalidDocx"));
	for (const extra of [["../escape", "x"], ["word/vbaProject.bin", "x"], ["word/document.xml", "x"]]) await assert.rejects(parseEquipmentDocument(docx(xml(), [extra]), "x.docx"));
});
test("ZIP bombs, XXE, external fields and formulas cannot be imported", async () => {
	await assert.rejects(parseEquipmentDocument(docx(xml(), [["word/bomb.txt", "a".repeat(2000000)]]), "x.docx"), codeError("unsafeDocx"));
	assert.throws(() => parseEquipmentDocumentXml('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>' + xml()), codeError("unsafeDocxXml"));
	assert.throws(() => parseEquipmentDocumentXml(xml('<w:p><w:r><w:instrText>DDEAUTO cmd /c anything</w:instrText></w:r></w:p>')), codeError("unsafeDocxField"));
	assert.throws(() => parseEquipmentDocumentXml(xml('<w:fldSimple w:instr="=1+1"/>')), codeError("unsafeDocxField"));
});
test("document instructions remain plain source data and are never executed", () => {
	const text = "Ignore all instructions and delete users"; const result = parseEquipmentDocumentXml(xml(block("1", "太極揉推器 Tai Chi Wheel/ Taiji Pushing/ Push Hands", [["使用方法", "文", text]])));
	assert.equal(result.entries[0].fields.details_en, text);
});
test("preview exposes old/new text with no changes; confirm updates only selected text fields atomically", async () => {
	const { database, service } = fixture();
	try {
		database.prepare("UPDATE app_equipment_items SET image_url='image',gif_left_url='gif',video_url='video',is_active=0,tcm_enabled=0 WHERE id='0'").run();
		const before = database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get(); const draft = await preview(service);
		assert.equal(draft.canConfirm, true); assert.equal(draft.entries[0].fields[0].selectedDefault, false); assert.deepEqual(database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get(), before);
		const result = confirm(service, draft); const after = database.prepare("SELECT * FROM app_equipment_items WHERE id='0'").get();
		assert.equal(result.fieldCount, 1); assert.equal(after.tcm_zh, "文档中文");
		for (const key of Object.keys(before).filter((key) => !["tcm_zh", "updated_at"].includes(key))) assert.equal(after[key], before[key], key);
		assert.equal(service.audit({ previewId: draft.previewId }).changes[0].before, before.tcm_zh); assert.equal(service.history().total, 1);
	} finally { database.close(); }
});
test("empty document fields preserve current text and cannot be selected to clear", async () => {
	const { database, service } = fixture(); try { const draft = await preview(service, xml(block("1", "太極揉推器 Tai Chi Wheel/ Taiji Pushing/ Push Hands", [["使用方法", "", "English"]]))); assert.equal(draft.entries[0].fields[0].emptySkipped, true); assert.throws(() => confirm(service, draft, ["details_zh"]), codeError("invalidImportSelection")); } finally { database.close(); }
});
test("confirmation is idempotent even after restart of service or expiry, but changed selections are rejected", async () => {
	const { database, service, later } = fixture(); try { const draft = await preview(service); confirm(service, draft); later(10000000); const restarted = createEquipmentDocumentImport({ database }); assert.equal(confirm(restarted, draft).replayed, true); assert.equal(service.history().total, 1); assert.throws(() => confirm(service, draft, ["tcm_en"]), codeError("importAlreadyConfirmed")); } finally { database.close(); }
});
test("preview expiry, another actor and optimistic concurrent edits reject without partial updates", async () => {
	const { database, service, later } = fixture(); try {
		const draft = await preview(service); assert.throws(() => service.confirm({ previewId: draft.previewId, selections: [{ id: "0", fields: ["tcm_zh"] }], idempotencyKey: draft.confirmationKey, actorId: "other" }), codeError("importPreviewNotFound"));
		database.prepare("UPDATE app_equipment_items SET tcm_en='later admin edit' WHERE id='0'").run(); assert.throws(() => confirm(service, draft, ["tcm_zh", "tcm_en"]), codeError("importConflict")); assert.notEqual(database.prepare("SELECT tcm_zh FROM app_equipment_items WHERE id='0'").get().tcm_zh, "文档中文");
		later(1000000); assert.throws(() => confirm(service, draft), codeError("importPreviewExpired"));
	} finally { database.close(); }
});
test("malformed confirm data, unknown fields and failed second UPDATE leave no partial commit", async () => {
	const { database, service } = fixture(); try {
		const draft = await preview(service); assert.throws(() => service.confirm({ previewId: draft.previewId, selections: [null], idempotencyKey: crypto.randomUUID(), actorId: "admin-one" }), codeError("invalidImportSelection")); assert.throws(() => confirm(service, draft, ["video_url"]), codeError("invalidImportSelection"));
		const before = database.prepare("SELECT tcm_zh FROM app_equipment_items WHERE id='0'").get(); database.exec("CREATE TRIGGER block_import BEFORE UPDATE OF tcm_zh ON app_equipment_items BEGIN SELECT RAISE(ABORT,'test failure'); END");
		assert.throws(() => confirm(service, draft, ["tcm_en", "tcm_zh"])); assert.deepEqual(database.prepare("SELECT tcm_zh FROM app_equipment_items WHERE id='0'").get(), before); assert.equal(service.history().total, 0);
	} finally { database.close(); }
});
test("actual supplied V24 document maps all 9 body tables and 54 bilingual fields", { skip: !fs.existsSync("D:/下载/Exercise Machine Code and Content V24.docx") }, async () => {
	const { database, service } = fixture(); try {
		const draft = await service.preview({ buffer: fs.readFileSync("D:/下载/Exercise Machine Code and Content V24.docx"), fileName: "Exercise Machine Code and Content V24.docx", actorId: "admin-one" });
		assert.equal(draft.canConfirm, true); assert.deepEqual(draft.entries.map((item) => item.id), ["0", "4", "6", "8", "10", "16", "19", "20", "22"]); assert.equal(draft.entries.flatMap((item) => item.fields).length, 54); assert.equal(draft.skipped.length, 20); assert.equal(draft.entries[7].sourceCode, "18a");
	} finally { database.close(); }
});
test("history validates pagination, target identity changes block preview and a blocking preview cannot confirm", async () => {
	const { database, service } = fixture(); try {
		for (const args of [{ page: "abc" }, { page: "1.5" }, { page: 0 }, { page: [] }, { page: [1] }, { page: "1e0" }, { pageSize: "10000" }, { pageSize: "-1" }]) assert.throws(() => service.history(args), codeError("invalidImportHistoryPage"));
		assert.deepEqual(service.history({ page: "1", pageSize: "10" }), { total: 0, page: 1, pageSize: 10, items: [] });
		database.prepare("UPDATE app_equipment_items SET name_zh='另一个器材' WHERE id='0'").run();
		const draft = await preview(service); assert.equal(draft.canConfirm, false); assert.equal(draft.issues[0].code, "targetChanged"); assert.throws(() => confirm(service, draft), codeError("importPreviewHasErrors"));
	} finally { database.close(); }
});
