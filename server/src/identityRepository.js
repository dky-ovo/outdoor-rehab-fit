// Shared identity queries only. Token verification, identifier normalization,
// permission policy and HTTP error handling stay in their existing callers.
const USER_COLUMNS = "id, name, phone, email, profile_role, password_salt, password_hash, created_at, updated_at, deleted_at, last_seen_at, avatar_data";
const SQL = Object.freeze({
  userById: `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  activeUserById: `SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND deleted_at IS NULL`,
  activeEmail: `SELECT ${USER_COLUMNS} FROM users WHERE email = ? AND deleted_at IS NULL`,
  activePhone: `SELECT ${USER_COLUMNS} FROM users WHERE phone = ? AND deleted_at IS NULL`,
  deletionState: "SELECT deleted_at FROM users WHERE id = ?",
  adminByUserId: "SELECT user_id, system_role, permissions_json, is_active, created_by, created_at, updated_at FROM admin_accounts WHERE user_id = ?",
  touchLastSeen: "UPDATE users SET last_seen_at = ? WHERE id = ? AND deleted_at IS NULL AND (last_seen_at IS NULL OR last_seen_at < ?)",
});

function identifierQuery(identifier) {
  if (!identifier || !["email", "phone"].includes(identifier.kind) || typeof identifier.value !== "string") {
    throw new TypeError("Identity lookup requires an email or phone kind and a normalized string value");
  }
  return [identifier.kind === "email" ? "activeEmail" : "activePhone", [identifier.value]];
}

function adminAccount(row) {
  if (row == null) return null;
  const value = row.is_active;
  // BIGINT decoding can return strings. In particular, '0' must never grant
  // access through the caller's ordinary Boolean/!is_active checks.
  if (![0, 1, "0", "1", 0n, 1n].includes(value)) {
    throw Object.assign(new TypeError("Administrator activation value is invalid"), { code: "IDENTITY_ADMIN_STATE_INVALID" });
  }
  return { ...row, is_active: Number(value) };
}

/**
 * SQLite methods return synchronous values, including while inside an existing
 * better-sqlite3 transaction. MySQL methods return Promises and use the supplied
 * adapter, retaining its transaction context. This factory opens no connection.
 */
export function createIdentityRepository(database) {
  if (database?.dialect === "mysql") {
    if (typeof database.get !== "function" || typeof database.run !== "function") {
      throw new TypeError("MySQL identity repository requires get and run methods");
    }
    const get = async (key, values) => (await database.get(SQL[key], values)) ?? null;
    return Object.freeze({
      dialect: "mysql",
      getUserById: (id) => get("userById", [id]),
      getActiveUserById: (id) => get("activeUserById", [id]),
      async findActiveUserByIdentifier(identifier) {
        const [key, values] = identifierQuery(identifier);
        return get(key, values);
      },
      getDeletionState: (id) => get("deletionState", [id]),
      async getAdminAccountByUserId(id) { return adminAccount(await get("adminByUserId", [id])); },
      async touchLastSeen(id, nowIso, cutoffIso) {
        await database.run(SQL.touchLastSeen, [nowIso, id, cutoffIso]);
      },
    });
  }
  if (typeof database?.prepare !== "function") {
    throw new TypeError("SQLite identity repository requires a prepare method");
  }
  const statements = Object.fromEntries(Object.entries(SQL).map(([key, sql]) => [key, database.prepare(sql)]));
  const get = (key, values) => statements[key].get(...values) ?? null;
  return Object.freeze({
    dialect: "sqlite",
    getUserById: (id) => get("userById", [id]),
    getActiveUserById: (id) => get("activeUserById", [id]),
    findActiveUserByIdentifier(identifier) {
      const [key, values] = identifierQuery(identifier);
      return get(key, values);
    },
    getDeletionState: (id) => get("deletionState", [id]),
    getAdminAccountByUserId: (id) => adminAccount(get("adminByUserId", [id])),
    touchLastSeen(id, nowIso, cutoffIso) { statements.touchLastSeen.run(nowIso, id, cutoffIso); },
  });
}
