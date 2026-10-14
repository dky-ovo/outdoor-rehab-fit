import crypto from "node:crypto";
import { hashPassword } from "./security.js";
import { revalidateAdmin } from "./adminAuthorization.js";
import { lockMysqlApplicationWrites } from "./mysqlRouteTransaction.js";

export const TEST_USER_BATCH_SCHEMA = `CREATE TABLE IF NOT EXISTS test_user_batches (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, credentials_hash TEXT NOT NULL,
 accounts_json TEXT NOT NULL, created_at TEXT NOT NULL, disabled_at TEXT
); CREATE INDEX IF NOT EXISTS test_user_batches_actor_created ON test_user_batches(actor_id,created_at);`;
const COUNT = 50;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const batchIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const readAccounts = value => typeof value === "string" ? JSON.parse(value) : value;
const visibleBatch = row => ({ batchId: row.id, accounts: readAccounts(row.accounts_json), createdAt: row.created_at, disabledAt: row.disabled_at || null });
function superAdmin(request) { if (request.admin?.account?.system_role !== "super_admin") fail("permissionDenied", 403); }
function input(body) {
 if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["batchId", "passwords"].includes(key)) || !batchIdPattern.test(body.batchId || "") || !Array.isArray(body.passwords) || body.passwords.length !== COUNT) fail("invalidTestUserBatch");
 if (new Set(body.passwords).size !== COUNT || body.passwords.some(password => typeof password !== "string" || !/^[A-Za-z0-9_-]{24,64}$/.test(password))) fail("invalidTestUserBatch");
 return body;
}
function availablePhones(rows) {
 const used = new Set(rows.map(row => row.phone));
 // This is the explicitly reserved Ofcom drama range; never consume real
 // subscriber numbers or the manually provisioned 001–050 test accounts.
 for (let start = 101; start + COUNT - 1 <= 999; start++) {
  const phones = Array.from({ length: COUNT }, (_, i) => `+447700900${String(start + i).padStart(3, "0")}`);
  if (phones.every(phone => !used.has(phone))) return phones;
 }
 fail("testUserCapacityExceeded", 409);
}
function existingBatch(row, actorId, fingerprint) {
 if (!row) return null;
 if (row.actor_id !== actorId || row.credentials_hash !== fingerprint) fail("testUserBatchConflict", 409);
 if (row.disabled_at) fail("testUserBatchDisabled", 409);
 return { ...visibleBatch(row), replayed: true };
}
const insertUser = "INSERT INTO users(id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)";
const insertBatch = "INSERT INTO test_user_batches(id,actor_id,credentials_hash,accounts_json,created_at) VALUES(?,?,?,?,?)";
const disableUser = "UPDATE users SET name=?,phone=?,email=NULL,password_salt=?,password_hash=?,updated_at=?,deleted_at=? WHERE id=? AND deleted_at IS NULL";

export function registerAdminTestUsers({ app, database, requirePermission, writeSystemLog, enabled = process.env.TEMP_TEST_USERS_ENABLED === "true" }) {
 const mysql = database.dialect === "mysql";
 const access = (request, response, next) => { try { superAdmin(request); response.set("Cache-Control", "no-store"); next(); } catch (error) { response.status(error.status).json({ error: error.code }); } };
 const route = handler => async (request, response) => {
  try { if (!enabled) return response.status(404).json({ error: "testUsersDisabled" }); return await handler(request, response); }
  catch (error) { const known = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500; return response.status(known ? error.status : 500).json({ error: known ? error.code : "testUserOperationFailed" }); }
 };
 const guard = () => [requirePermission("users.edit"), access];
 app.get("/api/admin/test-users", ...guard(), async (request, response) => {
  if (!enabled) return response.json({ enabled: false, batches: [] });
  try {
   const sql = "SELECT * FROM test_user_batches WHERE actor_id=? ORDER BY created_at DESC LIMIT 100";
   const rows = mysql ? await database.all(sql, [request.admin.user.id]) : database.prepare(sql).all(request.admin.user.id);
   return response.json({ enabled: true, batches: rows.map(visibleBatch) });
  } catch { return response.status(500).json({ error: "testUserOperationFailed" }); }
 });
 app.post("/api/admin/test-users", ...guard(), route(async (request, response) => {
  const { batchId, passwords } = input(request.body), actorId = request.admin.user.id;
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([actorId, batchId, passwords])).digest("hex");
  // Hash outside the write transaction. Sequential scrypt bounds memory; the
  // authenticated role is rechecked under the transaction before any insert.
  const hashes = []; for (const password of passwords) hashes.push(await hashPassword(password));
  const now = new Date().toISOString();
  const makeAccounts = phones => phones.map((phone, index) => ({ id: crypto.randomUUID(), name: `测试用户-${batchId.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`, phone, email: `test-${batchId}-${String(index + 1).padStart(3, "0")}@outdoorfit.example.invalid` }));
  const userValues = (account, i) => [account.id, account.name, account.phone, account.email, "participant", hashes[i].salt, hashes[i].hash, now, now];
  let result;
  if (mysql) result = await database.transaction(async () => {
   await lockMysqlApplicationWrites(database); await revalidateAdmin(database, request, "users.edit"); superAdmin(request);
   const previous = existingBatch(await database.get("SELECT * FROM test_user_batches WHERE id=? FOR UPDATE", [batchId]), actorId, fingerprint); if (previous) return previous;
   const accounts = makeAccounts(availablePhones(await database.all("SELECT phone FROM users WHERE phone LIKE '+447700900%' FOR UPDATE")));
   for (let i = 0; i < COUNT; i++) await database.run(insertUser, userValues(accounts[i], i));
   await database.run(insertBatch, [batchId, actorId, fingerprint, JSON.stringify(accounts), now]);
   await writeSystemLog(database, request, "test_users.create", "test_user_batch", batchId, { count: COUNT });
   return { batchId, accounts, createdAt: now, disabledAt: null, replayed: false };
  });
  else result = database.transaction(() => {
   revalidateAdmin(database, request, "users.edit"); superAdmin(request);
   const previous = existingBatch(database.prepare("SELECT * FROM test_user_batches WHERE id=?").get(batchId), actorId, fingerprint); if (previous) return previous;
   const accounts = makeAccounts(availablePhones(database.prepare("SELECT phone FROM users WHERE phone LIKE '+447700900%'").all()));
   for (let i = 0; i < COUNT; i++) database.prepare(insertUser).run(...userValues(accounts[i], i));
   database.prepare(insertBatch).run(batchId, actorId, fingerprint, JSON.stringify(accounts), now);
   writeSystemLog(database, request, "test_users.create", "test_user_batch", batchId, { count: COUNT });
   return { batchId, accounts, createdAt: now, disabledAt: null, replayed: false };
  }).immediate();
  return response.status(result.replayed ? 200 : 201).json(result);
 }));
 app.post("/api/admin/test-users/:batchId/disable", ...guard(), route(async (request, response) => {
  const batchId = request.params.batchId;
  if (!batchIdPattern.test(batchId) || request.body?.confirmation !== batchId || Object.keys(request.body || {}).some(key => key !== "confirmation")) fail("invalidTestUserBatch");
  const credentials = await hashPassword(crypto.randomBytes(32).toString("base64url")), now = new Date().toISOString();
  const checkBatch = row => { if (!row || row.actor_id !== request.admin.user.id) fail("testUserBatchNotFound", 404); return row; };
  const checkAccount = (account, user, admin) => { if (admin || !user || (!user.deleted_at && (user.email !== account.email || user.phone !== account.phone || user.profile_role !== "participant"))) fail("testUserBatchChanged", 409); };
  const values = account => [`已停用测试用户（${account.name}）`, `deleted-${account.id}`, credentials.salt, credentials.hash, now, now, account.id];
  const result = mysql ? await database.transaction(async () => {
   await lockMysqlApplicationWrites(database); await revalidateAdmin(database, request, "users.edit"); superAdmin(request);
   const row = checkBatch(await database.get("SELECT * FROM test_user_batches WHERE id=? FOR UPDATE", [batchId])); if (row.disabled_at) return visibleBatch(row);
   const accounts = readAccounts(row.accounts_json);
   for (const account of accounts) checkAccount(account, await database.get("SELECT * FROM users WHERE id=? FOR UPDATE", [account.id]), await database.get("SELECT 1 FROM admin_accounts WHERE user_id=?", [account.id]));
   for (const account of accounts) { await database.run(disableUser, values(account)); await database.run("DELETE FROM push_tokens WHERE user_id=?", [account.id]); await database.run("DELETE FROM assistant_jobs WHERE user_id=? AND status IN ('queued','running')", [account.id]); }
   await database.run("UPDATE test_user_batches SET disabled_at=? WHERE id=?", [now, batchId]);
   await writeSystemLog(database, request, "test_users.disable", "test_user_batch", batchId, { count: accounts.length }); return { ...visibleBatch(row), disabledAt: now };
  }) : database.transaction(() => {
   revalidateAdmin(database, request, "users.edit"); superAdmin(request);
   const row = checkBatch(database.prepare("SELECT * FROM test_user_batches WHERE id=?").get(batchId)); if (row.disabled_at) return visibleBatch(row);
   const accounts = readAccounts(row.accounts_json);
   for (const account of accounts) checkAccount(account, database.prepare("SELECT * FROM users WHERE id=?").get(account.id), database.prepare("SELECT 1 FROM admin_accounts WHERE user_id=?").get(account.id));
   for (const account of accounts) { database.prepare(disableUser).run(...values(account)); database.prepare("DELETE FROM push_tokens WHERE user_id=?").run(account.id); }
   database.prepare("UPDATE test_user_batches SET disabled_at=? WHERE id=?").run(now, batchId);
   writeSystemLog(database, request, "test_users.disable", "test_user_batch", batchId, { count: accounts.length }); return { ...visibleBatch(row), disabledAt: now };
  }).immediate();
  return response.json(result);
 }));
}
