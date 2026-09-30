import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { signToken } from "../src/security.js";
import { generateRegistrationCode, normalizeRegistrationCode, registrationCodeHash } from "../src/registrationCodes.js";

const SECRET = "registration-test-secret-used-only-in-tests";
async function fixture(run) {
  const database = createDatabase(":memory:");
  const now = new Date().toISOString();
  const tokens = {};
  for (const [index, [id, permissions, isActive]] of [["editor", ["users.edit", "users.read"], 1], ["reader", ["users.read"], 1], ["blocked", ["dashboard.read"], 1], ["inactive", ["users.edit", "users.read"], 0], ["ordinary", null, 1]].entries()) {
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)").run(id,id,`+8529111000${index}`,now,now);
    if (permissions) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,?,?,?)").run(id,JSON.stringify(permissions),isActive,now,now);
    tokens[id] = signToken({ id, profile_role: "staff" }, SECRET);
  }
  const app = createApp({ database, jwtSecret: SECRET });
  const server = app.listen(0, "127.0.0.1"); await new Promise((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { actor = null, method = "GET", body } = {}) => {
    const result = await fetch(base + path, { method, headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json(), headers: result.headers };
  };
  const issue = async (data = {}, actor = "editor") => request("/api/admin/registration-codes", { actor, method: "POST", body: { name: "Registered name", phone: "61234567", countryCode: "+852", profileRole: "participant", ...data } });
  const register = (code, data = {}) => request("/api/auth/register", { method: "POST", body: { name: "Chosen nickname", phone: "+85261234567", password: "test-password", confirmPassword: "test-password", registrationCode: code, ...data } });
  try { await run({ database, request, issue, register }); }
  finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); database.close(); }
}

test("registration codes are unpredictable, normalized and stored only as hashes", async () => {
  const generated = new Set(Array.from({ length: 300 }, generateRegistrationCode));
  assert.equal(generated.size, 300);
  for (const code of generated) assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  await fixture(async ({ issue, database, request }) => {
    const created = await issue(); assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "no-store");
    const { code, invitation } = created.data;
    assert.equal(invitation.phone, "+85261234567");
    assert.equal(invitation.status, "active");
    assert.equal(normalizeRegistrationCode(code).length, 8);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const stored = database.prepare("SELECT * FROM registration_codes").get();
    assert.equal(stored.code_hash, registrationCodeHash(code));
    assert.equal(JSON.stringify(stored).includes(normalizeRegistrationCode(code)), false);
    assert.equal(database.prepare("SELECT metadata_json FROM system_logs WHERE action = 'registration_code.create'").get().metadata_json.includes(normalizeRegistrationCode(code)), false);
    const listed = await request("/api/admin/registration-codes", { actor: "reader" });
    assert.equal(listed.data.codes[0].codeHint, normalizeRegistrationCode(code).slice(-4));
    assert.equal(JSON.stringify(listed.data).includes(stored.code_hash), false);
    assert.equal(JSON.stringify(listed.data).includes(code), false);
  });
});

test("new short codes use cryptographic randomInt for every symbol and preserve normalization", (t) => {
  const random = t.mock.method(crypto, "randomInt", () => 31);
  assert.equal(generateRegistrationCode(), "99999999");
  assert.equal(random.mock.callCount(), 8);
  for (const call of random.mock.calls) assert.deepEqual(call.arguments, [32]);
  assert.equal(normalizeRegistrationCode(" abcd-23ef \n"), "ABCD23EF");
  assert.equal(registrationCodeHash(" abcd-23ef "), registrationCodeHash("ABCD23EF"));
});

test("a previously issued long code is still phone-bound and single use", async () => {
  await fixture(async ({ database, register }) => {
    const code = "ABCDEFGHJKLMNPQRSTUV";
    assert.equal(code.length, 20);
    database.prepare("INSERT INTO registration_codes (id,code_hash,code_hint,name,phone,profile_role,created_at) VALUES (?,?,?,?,?,'staff',?)")
      .run("legacy-long", registrationCodeHash(code), code.slice(-4), "Legacy invited person", "+85261234567", "2026-09-10T00:00:00.000Z");
    assert.equal((await register(code, { phone: "+85261234568" })).data.error, "invalidRegistrationCode");
    const normalized = code.toLowerCase().match(/.{1,5}/g).join(" - ");
    const result = await register(normalized);
    assert.equal(result.status, 201);
    assert.equal(result.data.user.profileRole, "staff");
    assert.equal((await register(code)).data.error, "invalidRegistrationCode");
  });
});

test("short code hash collisions retry without modifying revoked invitations", async (t) => {
  await fixture(async ({ database, issue, register }) => {
    database.prepare("INSERT INTO registration_codes (id,code_hash,code_hint,name,phone,profile_role,created_at,revoked_at) VALUES (?,?,?,?,?,'participant',?,?)")
      .run("old-revoked", registrationCodeHash("AAAAAAAA"), "AAAA", "Previous invitation", "+85261234569", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");
    let calls = 0;
    const random = t.mock.method(crypto, "randomInt", () => calls++ < 8 ? 0 : 1);
    const result = await issue();
    assert.equal(result.status, 201);
    assert.equal(result.data.code, "BBBB-BBBB");
    assert.equal(random.mock.callCount(), 16);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM registration_codes").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action='registration_code.create'").get().count, 1);
    assert.equal(database.prepare("SELECT revoked_at FROM registration_codes WHERE id='old-revoked'").get().revoked_at, "2026-09-11T00:00:00.000Z");
    assert.equal((await register("AAAA-AAAA", { phone: "+85261234569" })).data.error, "invalidRegistrationCode");
    assert.equal((await register(" bbbb - bbbb ")).status, 201);
  });
});

test("repeated collisions fail safely after a bounded retry and can be retried later", async (t) => {
  await fixture(async ({ database, issue }) => {
    database.prepare("INSERT INTO registration_codes (id,code_hash,code_hint,name,phone,profile_role,created_at) VALUES (?,?,?,?,?,'participant',?)")
      .run("existing-short", registrationCodeHash("AAAAAAAA"), "AAAA", "Existing invitation", "+85261234569", "2026-09-10T00:00:00.000Z");
    const random = t.mock.method(crypto, "randomInt", () => 0);
    const failed = await issue();
    assert.equal(failed.status, 503);
    assert.equal(failed.data.error, "registrationCodeGenerationUnavailable");
    assert.equal(random.mock.callCount(), 80);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM registration_codes").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action='registration_code.create'").get().count, 0);
    random.mock.restore();
    assert.equal((await issue()).status, 201);
  });
});

test("malformed short codes and unsupported intermediate lengths cannot consume the valid code", async () => {
  await fixture(async ({ database, issue, register }) => {
    const created = await issue();
    for (const code of ["ABCDEFG", "ABCDEFGHJ", "ABCDEFGH23456789", "ABCDO234", "ABCDI234", "ABCD0234", "ABCD1234", "ABCD_234"]) {
      assert.equal((await register(code)).data.error, "invalidRegistrationCode");
      assert.equal(database.prepare("SELECT used_at FROM registration_codes").get().used_at, null);
    }
    assert.equal((await register(created.data.code)).status, 201);
  });
});

test("registration permissions reject unauthenticated, ordinary, inactive and unrelated accounts", async () => {
  await fixture(async ({ issue, request }) => {
    for (const [actor, status] of [[null,401], ["ordinary",403], ["inactive",403], ["blocked",403]]) {
      assert.equal((await issue({}, actor)).status, status);
      assert.equal((await request("/api/admin/registration-codes", { actor })).status, status);
    }
    assert.equal((await issue({}, "reader")).status, 403);
    const created = await issue();
    assert.equal((await request(`/api/admin/registration-codes/${created.data.invitation.id}/revoke`, { actor: "reader", method: "POST" })).status, 403);
  });
});

test("APP registration uses the invitation role and never the client's requested role or permissions", async () => {
  await fixture(async ({ issue, register, database, request }) => {
    const created = await issue();
    const result = await register(created.data.code.toLowerCase(), { profileRole: "staff", systemRole: "super_admin", permissions: ["users.edit"] });
    assert.equal(result.status, 201); assert.equal(result.data.user.profileRole, "participant");
    assert.equal(result.data.user.name, "Chosen nickname");
    assert.equal(database.prepare("SELECT * FROM admin_accounts WHERE user_id = ?").get(result.data.user.id), undefined);
    assert.equal(database.prepare("SELECT used_by FROM registration_codes").get().used_by, result.data.user.id);
    const login = await request("/api/auth/login", { method: "POST", body: { identifier: "+85261234567", password: "test-password" } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, result.data.user.id);
    assert.equal((await register(created.data.code)).data.error, "invalidRegistrationCode");
  });
});

test("therapist invitation creates staff APP role but no admin role", async () => {
  await fixture(async ({ issue, register, database }) => {
    const created = await issue({ profileRole: "staff" });
    const result = await register(created.data.code, { profileRole: "participant" });
    assert.equal(result.status, 201); assert.equal(result.data.user.profileRole, "staff");
    assert.equal(database.prepare("SELECT * FROM admin_accounts WHERE user_id = ?").get(result.data.user.id), undefined);
  });
});

test("required code, wrong number/code and mismatched/missing passwords cannot consume invitations", async () => {
  await fixture(async ({ issue, register, database }) => {
    const created = await issue(); const code = created.data.code;
    for (const [changes, expected] of [[{ registrationCode: "" }, "registrationCodeRequired"], [{ registrationCode: "ABCDEFGH23456789ABCD" }, "invalidRegistrationCode"], [{ phone: "+85261234568" }, "invalidRegistrationCode"], [{ confirmPassword: "wrong-password" }, "passwordMismatch"], [{ confirmPassword: undefined }, "passwordMismatch"], [{ password: "short", confirmPassword: "short" }, "passwordTooShort"], [{ password: "x".repeat(257), confirmPassword: "x".repeat(257) }, "passwordTooLong"]]) {
      const result = await register(code, changes); assert.equal(result.status, 400); assert.equal(result.data.error, expected);
      assert.equal(database.prepare("SELECT used_at FROM registration_codes").get().used_at, null);
    }
    assert.equal((await register(code)).status, 201);
  });
});

test("revoked invitations stay unusable, regenerate safely, and do not affect existing users", async () => {
  await fixture(async ({ issue, register, request, database }) => {
    const first = await issue(); const route = `/api/admin/registration-codes/${first.data.invitation.id}/revoke`;
    assert.equal((await issue()).data.error, "activeRegistrationCodeExists");
    assert.equal((await request(route, { actor: "editor", method: "POST" })).status, 200);
    assert.equal((await request(route, { actor: "editor", method: "POST" })).status, 200);
    assert.equal((await register(first.data.code)).data.error, "invalidRegistrationCode");
    const second = await issue(); assert.equal(second.status, 201); assert.notEqual(second.data.code, first.data.code);
    assert.equal((await register(second.data.code)).status, 201);
    assert.equal((await issue()).data.error, "phoneExists");
    assert.equal((await request(`/api/admin/registration-codes/${second.data.invitation.id}/revoke`, { actor: "editor", method: "POST" })).data.error, "registrationCodeAlreadyUsed");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE phone = '+85261234567'").get().count, 1);
  });
});

test("two simultaneous registrations create one user and consume one invitation atomically", async () => {
  await fixture(async ({ issue, register, database }) => {
    const created = await issue();
    const results = await Promise.all([register(created.data.code), register(created.data.code)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE phone = '+85261234567'").get().count, 1);
    assert.ok(database.prepare("SELECT used_at FROM registration_codes").get().used_at);
  });
});

test("an account created by another workflow cannot bypass duplicate-phone checks or consume a code", async () => {
  await fixture(async ({ issue, register, database }) => {
    const created = await issue();
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('already','Existing','+85261234567','participant','unused','unused',?,?)").run(now,now);
    const result = await register(created.data.code);
    assert.equal(result.status, 409); assert.equal(result.data.error, "phoneExists");
    assert.equal(database.prepare("SELECT used_at FROM registration_codes").get().used_at, null);
  });
});

test("admin registration list has bounded pagination, filtering and stable totals", async () => {
  await fixture(async ({ issue, request }) => {
    for (let index = 0; index < 23; index += 1) assert.equal((await issue({ phone: `6200${String(index).padStart(4,"0")}`, name: `Person ${index}` })).status, 201);
    const first = (await request("/api/admin/registration-codes", { actor: "reader" })).data;
    const second = (await request("/api/admin/registration-codes?page=2", { actor: "reader" })).data;
    assert.equal(first.codes.length,20); assert.equal(second.codes.length,3); assert.equal(first.total,23); assert.equal(first.totalPages,2);
    assert.equal(new Set([...first.codes,...second.codes].map((code)=>code.id)).size,23);
    const search = (await request("/api/admin/registration-codes?search=62000022", { actor: "reader" })).data;
    assert.equal(search.total,1); assert.equal(search.codes[0].name,"Person 22");
    const huge = (await request("/api/admin/registration-codes?pageSize=999&page=9999", { actor: "reader" })).data;
    assert.equal(huge.pageSize,50); assert.equal(huge.page,1);
    assert.equal((await request("/api/admin/registration-codes?search=%25", { actor: "reader" })).data.total,0);
    assert.equal((await request("/api/admin/registration-codes?status=used", { actor: "reader" })).data.total,0);
  });
});

test("invalid registration invitation fields and invalid administrative roles are rejected", async () => {
  await fixture(async ({ issue, database }) => {
    for (const data of [{ name: "" }, { name: "x".repeat(51) }, { phone: "12" }, { profileRole: "super_admin" }, { profileRole: "volunteer" }, { profileRole: "" }]) assert.equal((await issue(data)).status, 400);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM registration_codes").get().count,0);
  });
});

test("repeated invalid registration attempts are rate limited without consuming invitations", async () => {
  await fixture(async ({ issue, register, database }) => {
    const created = await issue();
    for (let index=0; index<15; index+=1) assert.equal((await register("ZZZZ-ZZZZ")).status,400);
    const blocked = await register(created.data.code);
    assert.equal(blocked.status,429); assert.equal(blocked.data.error,"registrationRateLimited");
    assert.equal(database.prepare("SELECT used_at FROM registration_codes").get().used_at,null);
  });
});
