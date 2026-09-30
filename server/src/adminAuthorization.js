import { ADMIN_ROLES, parsePermissions } from "./adminPermissions.js";

export class AdminAuthorizationError extends Error {
  constructor(code, status) {
    super(code);
    this.code = this.authorizationError = code;
    this.status = status;
  }
}

const USER = "SELECT id,name,phone,email,profile_role,avatar_data,created_at,updated_at,deleted_at FROM users WHERE id = ?";
const ACCOUNT = "SELECT user_id,system_role,permissions_json,is_active,created_by,created_at,updated_at FROM admin_accounts WHERE user_id = ?";

function checkUser(user) {
  if (!user) throw new AdminAuthorizationError("unauthorized", 401);
  if (user.deleted_at !== null && user.deleted_at !== undefined) throw new AdminAuthorizationError("accountDeleted", 401);
}

function authorize(request, user, account, permission) {
  if (!account || ![1, "1", 1n].includes(account.is_active) || !ADMIN_ROLES.has(account.system_role)) {
    throw new AdminAuthorizationError("adminRequired", 403);
  }
  const permissions = parsePermissions(account);
  if (!permissions.includes(permission)) throw new AdminAuthorizationError("permissionDenied", 403);
  request.admin = { user, account: { ...account, is_active: 1 }, permissions };
  return request.admin;
}

// Call inside the same transaction as the protected write and its audit. MySQL
// locks the user before the admin row, in the same order for every operation.
export function revalidateAdmin(database, request, permission) {
  const userId = request?.admin?.user?.id;
  if (typeof userId !== "string" || !userId) throw new AdminAuthorizationError("unauthorized", 401);
  if (database?.inTransaction !== true) throw new Error("Admin authorization requires an active database transaction");
  if (typeof permission !== "string" || !permission) throw new TypeError("An explicit administrator permission is required");
  if (database.dialect === "mysql") {
    return (async () => {
      const user = await database.get(USER + " FOR UPDATE", [userId]);
      checkUser(user);
      const account = await database.get(ACCOUNT + " FOR UPDATE", [userId]);
      return authorize(request, user, account, permission);
    })();
  }
  const user = database.prepare(USER).get(userId);
  checkUser(user);
  return authorize(request, user, database.prepare(ACCOUNT).get(userId), permission);
}
