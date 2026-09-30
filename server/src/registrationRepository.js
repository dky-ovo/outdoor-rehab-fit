import crypto from "node:crypto";

const CODE_COLUMNS = "id, code_hash, code_hint, name, phone, profile_role, created_by, created_at, used_at, used_by, revoked_at, revoked_by";
const LIST_COLUMNS = "id, code_hint, name, phone, profile_role, created_at, used_at, revoked_at";
const SQL = Object.freeze({
  invitation: `SELECT ${CODE_COLUMNS} FROM registration_codes WHERE code_hash = ? AND phone = ? AND used_at IS NULL AND revoked_at IS NULL`,
  duplicateUser: "SELECT phone, email FROM users WHERE phone = ? OR (? IS NOT NULL AND email = ?)",
  activePhone: "SELECT id FROM registration_codes WHERE phone = ? AND used_at IS NULL AND revoked_at IS NULL",
  codeHash: "SELECT id FROM registration_codes WHERE code_hash = ?",
  byId: `SELECT ${CODE_COLUMNS} FROM registration_codes WHERE id = ?`,
  insertUser: "INSERT INTO users (id, name, phone, email, profile_role, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  consume: "UPDATE registration_codes SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
  insertCode: "INSERT INTO registration_codes (id, code_hash, code_hint, name, phone, profile_role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  revoke: "UPDATE registration_codes SET revoked_at = ?, revoked_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
});

export function registrationFailure(code, status = 400) {
  return Object.assign(new Error(code), { registrationError: code, status });
}

function requireInvitation(row) {
  if (!row) throw registrationFailure("invalidRegistrationCode");
  return row;
}
function requireAvailable(rows, phone) {
  if (rows.some((row) => row.phone === phone)) throw registrationFailure("phoneExists", 409);
  if (rows.length) throw registrationFailure("emailExists", 409);
}
function userFor(invitation, { name, phone, email, passwordRecord }) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, phone, email, profile_role: invitation.profile_role,
    password_salt: passwordRecord.salt, password_hash: passwordRecord.hash, created_at: now, updated_at: now };
}
const userValues = (user) => [user.id, user.name, user.phone, user.email, user.profile_role, user.password_salt, user.password_hash, user.created_at, user.updated_at];
const codeValues = (row) => [row.id, row.code_hash, row.code_hint, row.name, row.phone, row.profile_role, row.created_by, row.created_at];
const isUniqueViolation = (error) => ["ER_DUP_ENTRY", "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"].includes(error?.code);
function requireMysqlWrite(result, conditional = false) {
  if (result?.warningStatus !== 0) throw Object.assign(new Error("Registration write reported a warning"), { code: "REGISTRATION_WRITE_INVALID" });
  if (result.affectedRows !== 1) {
    if (conditional) throw registrationFailure("invalidRegistrationCode");
    throw Object.assign(new Error("Registration write affected an unexpected number of rows"), { code: "REGISTRATION_WRITE_INVALID" });
  }
}
function requireSync(value) {
  if (value && typeof value.then === "function") throw new TypeError("SQLite registration transaction callbacks must be synchronous");
}
function revokeState(row) {
  if (!row) return { error: "registrationCodeNotFound", status: 404 };
  if (row.used_at) return { error: "registrationCodeAlreadyUsed", status: 409 };
  return null;
}

// SQLite LIKE folds only ASCII. Literal substring matching also keeps %, _ and
// backslash literal without depending on MySQL's connection collation/sql_mode.
const asciiFold = (value) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
function pageOf(rows, { search, pageSize, requestedPage }) {
  const needle = asciiFold(search);
  const matches = needle ? rows.filter((row) => asciiFold(row.name).includes(needle) || asciiFold(row.phone).includes(needle)) : rows;
  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  return { codes: matches.slice((page - 1) * pageSize, page * pageSize), total, totalPages, page, pageSize };
}
function listSql(status) {
  const condition = status === "active" ? " WHERE used_at IS NULL AND revoked_at IS NULL" : status === "used" ? " WHERE used_at IS NOT NULL" : status === "revoked" ? " WHERE revoked_at IS NOT NULL" : "";
  return `SELECT ${LIST_COLUMNS} FROM registration_codes${condition} ORDER BY created_at DESC, id DESC`;
}

/** Whole business operations; SQLite transactions never cross an await. */
export function createRegistrationRepository(database, { makeInvitation, generationAttempts = 10, writeSystemLog, revalidateAdmin }) {
  if (database?.dialect === "mysql") {
    const get = (key, values, lock = false) => database.get(SQL[key] + (lock ? " FOR UPDATE" : ""), values);
    const available = async (phone, email, lock = false) => requireAvailable(await database.all(SQL.duplicateUser + (lock ? " FOR UPDATE" : ""), [phone, email, email]), phone);
    return Object.freeze({
      async checkRegistration({ codeHash, phone, email }) {
        requireInvitation(await get("invitation", [codeHash, phone]));
        await available(phone, email);
      },
      async consume(input) {
        return database.transaction(async () => {
          const invitation = requireInvitation(await get("invitation", [input.codeHash, input.phone], true));
          // Do not gap-lock absent unique keys before inserting. Constraints
          // arbitrate competing inserts; only conflict diagnosis needs current reads.
          await available(input.phone, input.email);
          const user = userFor(invitation, input);
          try { requireMysqlWrite(await database.run(SQL.insertUser, userValues(user))); }
          catch (error) {
            // The adapter intentionally drops raw driver messages. Current reads
            // identify known conflicts even under REPEATABLE READ after a race.
            if (isUniqueViolation(error)) await available(input.phone, input.email, true);
            throw error;
          }
          const consumed = await database.run(SQL.consume, [user.created_at, user.id, invitation.id]);
          requireMysqlWrite(consumed, true);
          return user;
        });
      },
      async list(options) { return pageOf(await database.all(listSql(options.status), []), options); },
      async issue(input, request) {
        return database.transaction(async () => {
          await revalidateAdmin(database, request, "users.edit");
          await available(input.phone, null);
          if (await get("activePhone", [input.phone])) throw registrationFailure("activeRegistrationCodeExists", 409);
          for (let attempt = 0; attempt < generationAttempts; attempt++) {
            const result = makeInvitation(input, request.admin.user.id);
            try { requireMysqlWrite(await database.run(SQL.insertCode, codeValues(result.row))); }
            catch (error) {
              if (isUniqueViolation(error)) {
                if (await get("activePhone", [input.phone], true)) throw registrationFailure("activeRegistrationCodeExists", 409);
                if (await get("codeHash", [result.row.code_hash], true)) continue;
              }
              throw error;
            }
            await writeSystemLog(database, request, "registration_code.create", "registration_code", result.row.id, input);
            return result;
          }
          throw registrationFailure("registrationCodeGenerationUnavailable", 503);
        });
      },
      async revoke(id, request) {
        return database.transaction(async () => {
          await revalidateAdmin(database, request, "users.edit");
          const row = await get("byId", [id], true);
          const failure = revokeState(row);
          if (failure) return failure;
          if (!row.revoked_at) {
            const updated = await database.run(SQL.revoke, [new Date().toISOString(), request.admin.user.id, row.id]);
            requireMysqlWrite(updated, true);
            await writeSystemLog(database, request, "registration_code.revoke", "registration_code", row.id);
          }
          return { ok: true };
        });
      },
    });
  }
  const statements = Object.fromEntries(Object.entries(SQL).map(([key, sql]) => [key, database.prepare(sql)]));
  const available = (phone, email) => requireAvailable(statements.duplicateUser.all(phone, email, email), phone);
  const consume = database.transaction((input) => {
    const invitation = requireInvitation(statements.invitation.get(input.codeHash, input.phone));
    available(input.phone, input.email);
    const user = userFor(invitation, input);
    try { statements.insertUser.run(...userValues(user)); }
    catch (error) { if (isUniqueViolation(error)) available(input.phone, input.email); throw error; }
    if (statements.consume.run(user.created_at, user.id, invitation.id).changes !== 1) throw registrationFailure("invalidRegistrationCode");
    return user;
  });
  const issue = database.transaction((input, request) => {
    requireSync(revalidateAdmin(database, request, "users.edit"));
    available(input.phone, null);
    if (statements.activePhone.get(input.phone)) throw registrationFailure("activeRegistrationCodeExists", 409);
    for (let attempt = 0; attempt < generationAttempts; attempt++) {
      const result = makeInvitation(input, request.admin.user.id);
      try { statements.insertCode.run(...codeValues(result.row)); }
      catch (error) {
        if (isUniqueViolation(error)) {
          if (statements.activePhone.get(input.phone)) throw registrationFailure("activeRegistrationCodeExists", 409);
          if (statements.codeHash.get(result.row.code_hash)) continue;
        }
        throw error;
      }
      requireSync(writeSystemLog(database, request, "registration_code.create", "registration_code", result.row.id, input));
      return result;
    }
    throw registrationFailure("registrationCodeGenerationUnavailable", 503);
  });
  const revoke = database.transaction((id, request) => {
    requireSync(revalidateAdmin(database, request, "users.edit"));
    const row = statements.byId.get(id);
    const failure = revokeState(row);
    if (failure) return failure;
    if (!row.revoked_at) {
      if (statements.revoke.run(new Date().toISOString(), request.admin.user.id, row.id).changes !== 1) throw registrationFailure("invalidRegistrationCode");
      requireSync(writeSystemLog(database, request, "registration_code.revoke", "registration_code", row.id));
    }
    return { ok: true };
  });
  return Object.freeze({
    checkRegistration({ codeHash, phone, email }) { requireInvitation(statements.invitation.get(codeHash, phone)); available(phone, email); },
    consume(input) { return consume.immediate(input); },
    list(options) { return pageOf(database.prepare(listSql(options.status)).all(), options); },
    issue(input, request) { return issue.immediate(input, request); },
    revoke(id, request) { return revoke.immediate(id, request); },
  });
}
