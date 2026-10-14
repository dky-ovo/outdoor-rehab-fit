import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../src/database.js";
import { createEquipmentImageRetirement, managedImageLocation, textMayReferenceImage, isPermanentlyRetiredMedia, auditEquipmentImageRetirement } from "../src/mysqlEquipmentImageRetirement.js";
import { mysqlRouteTransaction } from "../src/mysqlRouteTransaction.js";
import { registerMediaLibrary } from "../src/mysqlMediaLibrary.js";
import { createMysqlApp } from "../src/appMysql.js";
import { signToken } from "../src/security.js";

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const digest = value => crypto.createHash("sha256").update(value).digest();
const now = "2026-09-24T00:00:00.000Z";

// Real isolated SQLite rows plus an injected MySQL-shaped executor. This tests
// business rollback and file effects, NOT InnoDB locks or live RDS SQL support.
function fixture(t, source = "legacy") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outdoor-retirement-test-"));
  const equipmentUploadDir = path.join(root, "equipment"), mediaUploadDir = path.join(root, "media");
  fs.mkdirSync(equipmentUploadDir); fs.mkdirSync(mediaUploadDir);
  const sqlite = createDatabase(":memory:");
  sqlite.function("OCTET_LENGTH", value => value === null ? null : Buffer.byteLength(String(value)));
  let helper;
  t.after(async () => {
    await helper?.stop(); sqlite.close();
    const ownedRoot = path.resolve(root);
    assert.ok(ownedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(ownedRoot).startsWith("outdoor-retirement-test-"));
    fs.rmSync(ownedRoot, { recursive: true, force: true });
  });
  sqlite.exec("ALTER TABLE media_files ADD COLUMN __url_sha256 BLOB");
  sqlite.prepare("INSERT INTO ai_configuration(id,updated_at) VALUES('default',?) ON CONFLICT(id) DO NOTHING").run(now);
  sqlite.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES('tester','Synthetic','+85200000000','staff','unused','unused',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES('tester','super_admin','[]',1,?,?)").run(now, now);
  const calls = [], logs = [], audits = [];
  const clean = sql => sql.replace(/ FOR (?:UPDATE|SHARE)\b/g, "");
  const database = {
    dialect: "mysql", isolation: "REPEATABLE-READ", failCommit: null,
    get inTransaction() { return sqlite.inTransaction; },
    async get(sql, values = []) {
      calls.push(sql);
      if (sql === "SELECT @@transaction_isolation AS level") return { level: database.isolation };
      return sqlite.prepare(clean(sql)).get(...values);
    },
    async all(sql, values = []) { calls.push(sql); return sqlite.prepare(clean(sql)).all(...values); },
    async run(sql, values = []) { calls.push(sql); const result = sqlite.prepare(clean(sql)).run(...values); return { affectedRows: result.changes, warningStatus: 0 }; },
    async transaction(callback, options) {
      assert.equal(sqlite.inTransaction, false, "reaper must start a fresh transaction");
      const originalIsolation = database.isolation;
      if (options?.isolationLevel) database.isolation = options.isolationLevel.replaceAll(" ", "-");
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(database);
        const failure = database.failCommit; database.failCommit = null;
        if (failure === "rollback") throw new Error("SYNTHETIC_COMMIT_FAILURE");
        sqlite.exec("COMMIT");
        if (failure === "unknown") throw Object.assign(new Error("unknown"), { code: "MYSQL_COMMIT_OUTCOME_UNKNOWN" });
        return result;
      } catch (error) { if (sqlite.inTransaction) sqlite.exec("ROLLBACK"); throw error; }
      finally { database.isolation = originalIsolation; }
    },
  };
  const addFile = (kind = "upload", extra = {}) => {
    const id = crypto.randomUUID(), name = `${id}.jpg`;
    const url = kind === "legacy" ? `/api/equipment-images/${name}` : `/api/media/${id}/${name}`;
    const file = path.join(kind === "legacy" ? equipmentUploadDir : mediaUploadDir, name);
    fs.writeFileSync(file, IMAGE);
    const row = { id, url, name, source: kind, storage_name: kind === "legacy" ? null : name, sha256: kind === "legacy" ? null : digest(IMAGE).toString("hex"), size_bytes: IMAGE.length, archived: 0, ...extra };
    sqlite.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_at,updated_at,__url_sha256) VALUES(@id,@url,@name,'image/jpeg','image',@size_bytes,'other',@source,@storage_name,@sha256,@archived,@created_at,@updated_at,@url_hash)").run({ ...row, created_at: now, updated_at: now, url_hash: digest(row.url) });
    return { ...row, file };
  };
  const old = addFile(source), next = addFile();
  sqlite.prepare("UPDATE app_equipment_items SET image_url=? WHERE id='9'").run(next.url);
  const writeSystemLog = async (...args) => { audits.push(args); };
  helper = createEquipmentImageRetirement({ database, equipmentUploadDir, mediaUploadDir, writeSystemLog, logger: value => logs.push(value) });
  const request = { admin: { user: { id: "tester" }, permissions: ["app_maintenance.files.manage", "app_maintenance.equipment.manage"] }, query: {} };
  const prepare = () => helper.prepare({ oldUrl: old.url, newUrl: next.url, equipmentId: "9", request });
  const row = id => sqlite.prepare("SELECT * FROM media_files WHERE id=?").get(id || old.id);
  return { database, sqlite, calls, logs, audits, helper, old, next, addFile, prepare, row, request, writeSystemLog, equipmentUploadDir, mediaUploadDir };
}

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
}

test("managed identities reject external/traversal paths and normalize same-site query/encoded aliases", () => {
  const original = "/api/equipment-images/old-123.jpg";
  assert.equal(managedImageLocation(`https://api.outdoorfit.hk${original}?v=2`).url, original);
  assert.equal(managedImageLocation("https://admin.outdoorfit.hk/api/equipment-images/%6fld-123.jpg").url, original);
  for (const url of ["https://other.test" + original, "//other.test" + original, "/api/equipment-images/../secret.jpg", "/api/equipment-images/%2fetc.jpg"]) assert.equal(managedImageLocation(url), null);
  for (const text of [original, "https://elsewhere.test" + original + "?v=2", JSON.stringify({ image: original }).replaceAll("o", "\\u006f"), encodeURIComponent(original), "old&#45;123.jpg"]) assert.equal(textMayReferenceImage(text, "old-123.jpg"), true);
  assert.equal(textMayReferenceImage("An unrelated paragraph", "old-123.jpg"), false);
});

for (const source of ["legacy", "upload"]) test(`${source}: old file survives prepare; durable commit then exact cleanup preserves replacement`, async t => {
  const f = fixture(t, source);
  const result = await f.database.transaction(f.prepare);
  assert.deepEqual(result, { status: "pending", mediaId: f.old.id });
  assert.ok(fs.existsSync(f.old.file));
  assert.equal(f.row().storage_name, ""); assert.equal(f.row().sha256, digest(IMAGE).toString("hex"));
  await f.helper.enqueue();
  assert.equal(fs.existsSync(f.old.file), false); assert.deepEqual(fs.readFileSync(f.next.file), IMAGE);
  assert.equal(f.row().archived, 1); assert.ok(f.row().deleted_at);
  assert.ok(f.calls.some(sql => sql.includes("FROM app_text_overrides") && sql.endsWith("FOR SHARE")));
  assert.deepEqual(await auditEquipmentImageRetirement(f.database), { mode: "read-only", isolation: "REPEATABLE-READ", pendingCount: 0, completedCount: 1 });
});

test("rollback preserves old metadata/file and fresh runner has no historical orphan sweep", async t => {
  const f = fixture(t);
  f.database.failCommit = "rollback";
  await assert.rejects(f.database.transaction(f.prepare), /SYNTHETIC_COMMIT_FAILURE/);
  assert.equal(f.row().deleted_at, null); assert.equal(f.row().storage_name, null);
  await f.helper.enqueue(); assert.ok(fs.existsSync(f.old.file));
});

test("unknown COMMIT does not run request after-effects; later fresh durable scan can resume", async t => {
  const f = fixture(t);
  let immediateEffects = 0;
  const { afterMysqlCommit } = await import("../src/mysqlRouteTransaction.js");
  const handler = mysqlRouteTransaction(f.database, async () => {}, null, async (_request, res) => {
    const result = await f.prepare();
    afterMysqlCommit(() => { immediateEffects++; return f.helper.enqueue(); });
    res.json(result);
  }, { media: true });
  f.database.failCommit = "unknown";
  await assert.rejects(handler(f.request, response()), error => error.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN");
  assert.equal(immediateEffects, 0); assert.ok(fs.existsSync(f.old.file)); assert.ok(isPermanentlyRetiredMedia(f.row()));
  await f.helper.enqueue(); assert.equal(fs.existsSync(f.old.file), false);
});

test("request success schedules cleanup only after COMMIT and reports pending without premature removed claim", async t => {
  const f = fixture(t);
  const { afterMysqlCommit } = await import("../src/mysqlRouteTransaction.js");
  let scheduled;
  const handler = mysqlRouteTransaction(f.database, async () => {}, null, async (_request, res) => {
    const result = await f.prepare();
    afterMysqlCommit(() => { assert.equal(f.database.inTransaction, false); scheduled = f.helper.enqueue(); return scheduled; });
    res.json({ oldImageCleanup: result });
  }, { media: true });
  const res = response(); await handler(f.request, res); await Promise.resolve(); await scheduled;
  assert.equal(res.body.oldImageCleanup.status, "pending"); assert.equal(fs.existsSync(f.old.file), false);
});

for (const protection of ["seed", "archived", "shared", "absolute", "text-json", "feedback", "revision", "media-alias", "weak-isolation"]) test(`retains protected file: ${protection}`, async t => {
  const f = fixture(t);
  if (protection === "seed") f.sqlite.prepare("INSERT INTO media_seed_items(import_id,file_name,file_id,created_at) VALUES('synthetic','old.jpg',?,?)").run(f.old.id, now);
  if (protection === "archived") f.sqlite.prepare("UPDATE media_files SET archived=1 WHERE id=?").run(f.old.id);
  if (protection === "shared") f.sqlite.prepare("UPDATE app_equipment_items SET gif_left_url=? WHERE id='10'").run(f.old.url);
  if (protection === "absolute") f.sqlite.prepare("UPDATE app_equipment_items SET image_url=? WHERE id='10'").run("https://api.outdoorfit.hk" + f.old.url.replace(".jpg", "%2Ejpg") + "?v=1");
  if (protection === "text-json") f.sqlite.prepare("INSERT INTO app_text_overrides(text_key,zh,en,revision,updated_at) VALUES('synthetic',?,NULL,1,?)").run(JSON.stringify({ nested: [encodeURIComponent(f.old.url)] }), now);
  if (protection === "feedback") f.sqlite.prepare("INSERT INTO feedback(id,submission_id,content_hash,submitter_type,name,email,message,locale,created_at,updated_at) VALUES('synthetic','synthetic','hash','guest','Synthetic','synthetic@example.test',?,'en',?,?)").run(f.old.url, now, now);
  if (protection === "revision") {
    f.sqlite.prepare("INSERT INTO exercise_sessions(id,user_id,completed_at,mode,created_at,updated_at) VALUES('synthetic','tester',?,'outdoor',?,?)").run(now, now, now);
    f.sqlite.prepare("INSERT INTO exercise_session_revisions(id,session_id,user_id,version_number,snapshot_json,changed_at) VALUES('synthetic','synthetic','tester',1,?,?)").run(JSON.stringify({ old: f.old.url }), now);
  }
  if (protection === "media-alias") f.addFile("upload", { url: "https://api.outdoorfit.hk" + f.old.url, source: "external", storage_name: null });
  if (protection === "weak-isolation") f.database.isolation = "READ-COMMITTED";
  assert.equal((await f.database.transaction(f.prepare)).status, "retained");
  assert.equal(f.row().deleted_at, null); assert.ok(fs.existsSync(f.old.file));
});

test("only changed nonempty replacement participates; missing new bytes cannot retire old file", async t => {
  const f = fixture(t);
  for (const newUrl of ["", f.old.url, "https://api.outdoorfit.hk" + f.old.url + "?v=2"]) {
    assert.equal((await f.database.transaction(() => f.helper.prepare({ oldUrl: f.old.url, newUrl, equipmentId: "9", request: f.request }))).status, "unchanged");
  }
  fs.unlinkSync(f.next.file);
  assert.deepEqual(await f.database.transaction(f.prepare), { status: "retained", reason: "replacement_unverified" });
  assert.ok(fs.existsSync(f.old.file));
});

test("changed bytes and hardlinks prevent deletion and remain pending", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  fs.writeFileSync(f.old.file, Buffer.concat([IMAGE, Buffer.from([9])]));
  await f.helper.enqueue(); assert.ok(fs.existsSync(f.old.file)); assert.equal(f.row().archived, 0);
  fs.writeFileSync(f.old.file, IMAGE);
  const link = path.join(f.equipmentUploadDir, "shared-hardlink.jpg"); fs.linkSync(f.old.file, link);
  await f.helper.enqueue(); await f.helper.enqueue(); assert.ok(fs.existsSync(f.old.file)); assert.ok(fs.existsSync(link));
  fs.unlinkSync(link); await f.helper.enqueue(); await f.helper.enqueue();
  assert.equal(fs.existsSync(f.old.file), false);
});

test("new references after preparation conservatively defer the committed cleanup", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  f.sqlite.prepare("UPDATE app_equipment_items SET details_zh=? WHERE id='10'").run(f.old.url);
  await f.helper.enqueue(); assert.ok(fs.existsSync(f.old.file)); assert.equal(f.row().archived, 0);
  assert.ok(f.logs.includes("EQUIPMENT_IMAGE_CLEANUP_PENDING"));
});

test("tombstone rejects reuse through relative/absolute/encoded URLs; dry audit has no writes or file effects", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  for (const url of [f.old.url, "https://api.outdoorfit.hk" + f.old.url + "?v=2", "https://admin.outdoorfit.hk" + f.old.url.replace(".jpg", "%2Ejpg"), "https://outdoor-fit.35-241-75-217.sslip.io" + f.old.url]) assert.equal(await f.helper.referenceAllowed(url, "image"), false);
  assert.equal(await f.helper.referenceAllowed(f.next.url, "image"), true);
  assert.equal(await f.helper.referenceAllowed("https://outdoor-fit.35-241-75-217.sslip.io" + f.next.url, "image"), true);
  f.calls.length = 0;
  assert.equal((await auditEquipmentImageRetirement(f.database)).pendingCount, 1);
  assert.ok(f.calls.every(sql => sql.startsWith("SELECT "))); assert.ok(fs.existsSync(f.old.file));
  f.database.isolation = "READ-COMMITTED";
  await assert.rejects(auditEquipmentImageRetirement(f.database), error => error.code === "IMAGE_RETIREMENT_ISOLATION_REQUIRED");
});

test("reaper rejects preparation context and stop prevents later enqueue", async t => {
  const f = fixture(t);
  await f.database.transaction(async () => { assert.throws(() => f.helper.enqueue(), /FRESH_CONTEXT/); });
  await f.database.transaction(f.prepare);
  await f.helper.stop(); await f.helper.enqueue(); f.helper.start();
  assert.ok(fs.existsSync(f.old.file));
});

test("unlink failure stays pending; restart and missing-file acknowledgement safely finish", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async file => { if (file === f.old.file) throw Object.assign(new Error("synthetic"), { code: "EACCES" }); return unlink(file); };
  try { await f.helper.enqueue(); }
  finally { fs.promises.unlink = unlink; }
  assert.ok(fs.existsSync(f.old.file)); assert.equal(f.row().archived, 0);
  await f.helper.stop();
  const resumed = createEquipmentImageRetirement({ ...f, logger: () => {} });
  t.after(() => resumed.stop());
  // A failed acknowledgement cannot make a physically removed row restorable.
  f.database.failCommit = "rollback";
  await resumed.enqueue();
  assert.equal(fs.existsSync(f.old.file), false); assert.equal(f.row().archived, 0); assert.ok(isPermanentlyRetiredMedia(f.row()));
  await resumed.enqueue(); await resumed.enqueue();
  assert.equal(f.row().archived, 1); assert.ok(fs.existsSync(f.next.file));
});

test("reference scan bound fails closed and reads each table under current locking reads", async t => {
  const f = fixture(t), all = f.database.all;
  f.database.all = async (sql, values) => sql.includes("FROM content_items LIMIT") ? Array.from({ length: 5001 }, () => ({ value: "synthetic" })) : all(sql, values);
  assert.deepEqual(await f.database.transaction(f.prepare), { status: "retained", reason: "reference_limit" });
  assert.equal(f.row().deleted_at, null); assert.ok(fs.existsSync(f.old.file));
});

test("oversized text is rejected from numeric lengths before loading the text body", async t => {
  const f = fixture(t), all = f.database.all;
  f.database.all = async (sql, values) => {
    if (sql.startsWith("SELECT OCTET_LENGTH(body)") && sql.includes("FROM messages ")) return [{ body: 8 * 1024 * 1024 + 1, metadata_json: 0 }];
    assert.ok(!sql.startsWith("SELECT body,metadata_json FROM messages"), "oversized bodies must not be loaded");
    return all(sql, values);
  };
  assert.deepEqual(await f.database.transaction(f.prepare), { status: "retained", reason: "reference_limit" });
  assert.equal(f.row().deleted_at, null); assert.ok(fs.existsSync(f.old.file));
});

test("production app PUT with injected executor retires precisely old image and rejects tombstone legacy GET/reuse", async t => {
  const f = fixture(t);
  f.database.isolation = "READ-COMMITTED";
  f.sqlite.prepare("UPDATE app_equipment_items SET image_url=? WHERE id='9'").run(f.old.url);
  const secret = "synthetic-local-image-retirement-secret";
  const app = await createMysqlApp({ database: f.database, jwtSecret: secret, equipmentUploadDir: f.equipmentUploadDir, mediaUploadDir: f.mediaUploadDir });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.imageRetirement.stop(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: "tester", profile_role: "staff" }, secret);
  const save = body => fetch(base + "/api/admin/equipment/9", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await save({ imageUrl: f.next.url });
  assert.equal(result.status, 200); const body = await result.json();
  assert.equal(body.item.imageUrl, f.next.url); assert.equal(body.oldImageCleanup.status, "pending");
  await app.locals.imageRetirement.enqueue();
  assert.equal((await fetch(base + f.old.url)).status, 404);
  assert.equal((await save({ imageUrl: "https://outdoor-fit.35-241-75-217.sslip.io" + f.old.url })).status, 400);
  assert.equal(f.sqlite.prepare("SELECT image_url FROM app_equipment_items WHERE id='9'").get().image_url, f.next.url);
  assert.equal(f.database.isolation, "READ-COMMITTED");
  assert.ok(fs.existsSync(f.next.file));
});

test("fresh cleanup opts into RR even when the pooled session default is RC", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  f.database.isolation = "READ-COMMITTED";
  await f.helper.enqueue();
  assert.equal(fs.existsSync(f.old.file), false); assert.equal(f.row().archived, 1);
  assert.equal(f.database.isolation, "READ-COMMITTED");
});

test("media routes exclude permanent rows from bin, reject file restore/copy, and folder restore cannot revive them", async t => {
  const f = fixture(t);
  await f.database.transaction(f.prepare);
  const routes = new Map(), app = {};
  for (const method of ["get", "post", "patch"]) app[method] = (route, ...handlers) => routes.set(`${method} ${route}`, handlers.at(-1));
  await registerMediaLibrary({ app, database: f.database, mediaUploadDir: f.mediaUploadDir, equipmentUploadDir: f.equipmentUploadDir,
    requirePermission: () => () => {}, requireAnyPermission: () => () => {}, writeSystemLog: f.writeSystemLog });
  const call = async (method, route, body, query = {}) => { const res = response(); await routes.get(`${method} ${route}`)({ ...f.request, body, query }, res); return res; };
  const listed = await call("get", "/api/admin/media", undefined, { deleted: "true" });
  assert.equal(listed.body.items.some(item => item.id === f.old.id), false);
  const statuses = await call("get", "/api/admin/media-retirements");
  assert.deepEqual(statuses.body.items.map(item => [item.id, item.status, item.recoverable]), [[f.old.id, "pending", false]]);
  const restore = await call("post", "/api/admin/media/restore", { kind: "file", id: f.old.id });
  assert.equal(restore.statusCode, 409); assert.equal(restore.body.error, "mediaPermanentlyDeleted");
  const copied = await call("post", "/api/admin/media/copy", { items: [{ kind: "file", id: f.old.id }], targetFolderId: "" });
  assert.equal(copied.statusCode, 404);
  const deletedAt = f.row().deleted_at;
  f.sqlite.prepare("INSERT INTO media_folders(id,parent_id,name,deleted_at,created_at,updated_at) VALUES('retired-folder','','Synthetic',?,?,?)").run(deletedAt, now, now);
  f.sqlite.prepare("UPDATE media_files SET folder_id='retired-folder' WHERE id=?").run(f.old.id);
  assert.equal((await call("post", "/api/admin/media/restore", { kind: "folder", id: "retired-folder" })).statusCode, 200);
  assert.ok(f.row().deleted_at); assert.ok(isPermanentlyRetiredMedia(f.row()));
});

test("MySQL application persists extension media and atomically creates, replays and disables test batches", async t => {
 const f = fixture(t), secret = "synthetic-v12-mysql-executor-secret";
 f.sqlite.exec("CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY,user_id TEXT,status TEXT)");
 const videoId = crypto.randomUUID(), videoUrl = `/api/media/${videoId}/${videoId}.mp4`;
 f.sqlite.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,category_id,source,storage_name,created_at,updated_at,__url_sha256) VALUES(?,?,?,'video/mp4','video','videos','upload',?,?,?,?)").run(videoId,videoUrl,"Exercise.mp4",`${videoId}.mp4`,now,now,digest(videoUrl));
 const app = await createMysqlApp({ database:f.database,jwtSecret:secret,equipmentUploadDir:f.equipmentUploadDir,mediaUploadDir:f.mediaUploadDir,temporaryTestUsersEnabled:true });
 const server = app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve));
 t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.imageRetirement.stop(); });
 const token = signToken({id:"tester",profile_role:"staff"},secret);
 const call = async (route, body, method="POST") => { const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body ? {body:JSON.stringify(body)} : {})}); return {status:response.status,body:await response.json()}; };
 const additionalVideos = [{id:"home",titleZh:"家居",titleEn:"Home",videoUrlZh:videoUrl,videoUrlEn:""}], teachingSections = [{id:"notes",titleZh:"提示",titleEn:"Tips",bodyZh:"練習",bodyEn:"Practice"}];
 const saved = await call("/api/admin/equipment/9",{additionalVideos,teachingSections},"PUT"); assert.equal(saved.status,200); assert.deepEqual(saved.body.item.additionalVideos,additionalVideos);
 assert.deepEqual((await call("/api/admin/equipment/9",{nameEn:"Legacy edit"},"PUT")).body.item.teachingSections,teachingSections);
 assert.equal((await call(`/api/admin/media/${videoId}`,{archived:true},"PATCH")).status,409);
 const body = {batchId:crypto.randomUUID(),passwords:Array.from({length:50},()=>`T_${crypto.randomBytes(24).toString("hex")}`)};
 f.database.failCommit = "unknown"; const uncertain = await call("/api/admin/test-users",body); assert.equal(uncertain.status,500);
 const created = await call("/api/admin/test-users",body); assert.equal(created.status,200); assert.equal(created.body.accounts.length,50);
 const replay = await call("/api/admin/test-users",body); assert.equal(replay.status,200); assert.deepEqual(replay.body.accounts,created.body.accounts);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM test_user_batches").get().n,1);
 f.sqlite.prepare("INSERT INTO assistant_jobs(id,user_id,status) VALUES('pending-job',?,'queued'),('completed-job',?,'complete')").run(created.body.accounts[0].id,created.body.accounts[0].id);
 const disabled = await call(`/api/admin/test-users/${body.batchId}/disable`,{confirmation:body.batchId}); assert.equal(disabled.status,200);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM users WHERE deleted_at IS NOT NULL").get().n,50);
 assert.ok(f.calls.some(sql=>sql.includes("test_user_batches WHERE id=? FOR UPDATE")));
 assert.deepEqual(f.sqlite.prepare("SELECT id FROM assistant_jobs").all(),[{id:"completed-job"}]);
});
