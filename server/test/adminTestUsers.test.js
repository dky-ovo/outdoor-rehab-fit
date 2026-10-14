import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken, verifyPassword } from "../src/security.js";

const SECRET = "test-users-api-local-synthetic-secret";
const credentials = () => ({ batchId: crypto.randomUUID(), passwords: Array.from({ length: 50 }, () => `T_${crypto.randomBytes(24).toString("hex")}`) });
async function fixture(t, enabled = true) {
 const database = createDatabase(":memory:"), now = new Date().toISOString(), tokens = {};
 for (const [index, [id, role, permissions]] of [["owner", "super_admin", []], ["other", "super_admin", []], ["operator", "operator", ["users.edit"]], ["ordinary", null, []]].entries()) {
  database.prepare("INSERT INTO users(id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,'unused','unused',?,?)").run(id,id,`+8526000000${index}`,`${id}@example.invalid`,"staff",now,now);
  if (role) database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)").run(id,role,JSON.stringify(permissions),now,now);
  tokens[id] = signToken({ id, profile_role: "staff" }, SECRET);
 }
 const app = createApp({ database, jwtSecret: SECRET, temporaryTestUsersEnabled: enabled }), server = app.listen(0,"127.0.0.1");
 await new Promise(done => server.once("listening",done));
 t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); database.close(); });
 const request = async (path, { method = "GET", body, actor = "owner", token } = {}) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(token || tokens[actor] ? { Authorization: `Bearer ${token || tokens[actor]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
 };
 const create = (body, actor) => request("/api/admin/test-users", { method:"POST",body,actor });
 return { database, request, create, now };
}

test("temporary batch creation is off by default and restricted to active super administrators", async t => {
 const f = await fixture(t, false);
 assert.deepEqual((await f.request("/api/admin/test-users")).body, { enabled:false,batches:[] });
 assert.equal((await f.create(credentials())).status,404);
 for (const [actor,status] of [["operator",403],["ordinary",403],[null,401]]) assert.equal((await f.create(credentials(),actor)).status,status);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM test_user_batches").get().n,0);
});

test("creates exactly 50 email-login users atomically, binds retry credentials and never stores plaintext", async t => {
 const f = await fixture(t), draft = credentials();
 // Manually created test accounts and unrelated occupied numbers stay intact.
 f.database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES('manual','Manual','+447700900001','participant','s','h',?,?),('occupied','Occupied','+447700900125','participant','s','h',?,?)").run(f.now,f.now,f.now,f.now);
 const created = await f.create(draft); assert.equal(created.status,201); assert.equal(created.cache,"no-store");
 assert.equal(created.body.accounts.length,50); assert.equal(created.body.accounts[0].phone,"+447700900126");
 assert.equal(JSON.stringify(created.body).includes(draft.passwords[0]),false);
 const user = f.database.prepare("SELECT * FROM users WHERE id=?").get(created.body.accounts[0].id);
 assert.equal(await verifyPassword(draft.passwords[0],user.password_salt,user.password_hash),true);
 const login = await f.request("/api/auth/login",{method:"POST",actor:null,body:{identifier:user.email,password:draft.passwords[0]}}); assert.equal(login.status,200);
 const replay = await f.create(draft); assert.equal(replay.status,200); assert.equal(replay.body.replayed,true); assert.deepEqual(replay.body.accounts,created.body.accounts);
 assert.equal((await f.create({...draft,passwords:credentials().passwords})).status,409);
 assert.equal((await f.create(draft,"other")).status,409);
 const stored = JSON.stringify({ batches:f.database.prepare("SELECT * FROM test_user_batches").all(), logs:f.database.prepare("SELECT * FROM system_logs").all(), users:f.database.prepare("SELECT * FROM users").all() });
 for (const password of draft.passwords) assert.equal(stored.includes(password),false);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users").get().n,56);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM system_logs WHERE action='test_users.create'").get().n,1);
 assert.equal(f.database.prepare("SELECT name FROM users WHERE id='manual'").get().name,"Manual");
 const disabled = await f.request(`/api/admin/test-users/${draft.batchId}/disable`,{method:"POST",body:{confirmation:draft.batchId}}); assert.equal(disabled.status,200); assert.ok(disabled.body.disabledAt);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users WHERE deleted_at IS NOT NULL").get().n,50);
 assert.equal((await f.request("/api/equipment-catalog",{token:login.body.token})).body.error,"accountDeleted");
 assert.equal((await f.request("/api/auth/login",{method:"POST",actor:null,body:{identifier:user.email,password:draft.passwords[0]}})).status,401);
 assert.equal(f.database.prepare("SELECT deleted_at FROM users WHERE id='manual'").get().deleted_at,null);
 assert.equal((await f.create(draft)).body.error,"testUserBatchDisabled");
});

test("a late insert failure rolls back every user and the batch", async t => {
 const f = await fixture(t), draft = credentials();
 f.database.exec("CREATE TRIGGER fail_test_user BEFORE INSERT ON users WHEN NEW.phone='+447700900120' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await f.create(draft)).status,500);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users").get().n,4);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM test_user_batches").get().n,0);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM system_logs WHERE action='test_users.create'").get().n,0);
});

test("batch disable refuses changed or privileged accounts without partially disabling others", async t => {
 const f = await fixture(t), draft = credentials(), created = await f.create(draft); assert.equal(created.status,201);
 const changed = created.body.accounts[20]; f.database.prepare("UPDATE users SET email='changed-normal@example.invalid' WHERE id=?").run(changed.id);
 assert.equal((await f.request(`/api/admin/test-users/${draft.batchId}/disable`,{method:"POST",body:{confirmation:draft.batchId}})).body.error,"testUserBatchChanged");
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users WHERE deleted_at IS NOT NULL").get().n,0);
 assert.equal((await f.request(`/api/admin/test-users/${draft.batchId}/disable`,{method:"POST",actor:"other",body:{confirmation:draft.batchId}})).status,404);
 assert.equal((await f.request(`/api/admin/test-users/${draft.batchId}/disable`,{method:"POST",body:{confirmation:"wrong"}})).status,400);
 f.database.prepare("UPDATE users SET email=? WHERE id=?").run(changed.email,changed.id);
 f.database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES(?,'operator','[]',1,?,?)").run(changed.id,f.now,f.now);
 assert.equal((await f.request(`/api/admin/test-users/${draft.batchId}/disable`,{method:"POST",body:{confirmation:draft.batchId}})).body.error,"testUserBatchChanged");
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users WHERE deleted_at IS NOT NULL").get().n,0);
});

test("administrator deactivation while passwords are being hashed blocks the entire write", async t => {
 const f = await fixture(t), pending = f.create(credentials());
 await new Promise(resolve=>setTimeout(resolve,100));
 f.database.prepare("UPDATE admin_accounts SET is_active=0 WHERE user_id='owner'").run();
 assert.equal((await pending).status,403);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM users").get().n,4);
 assert.equal(f.database.prepare("SELECT COUNT(*) n FROM test_user_batches").get().n,0);
});
