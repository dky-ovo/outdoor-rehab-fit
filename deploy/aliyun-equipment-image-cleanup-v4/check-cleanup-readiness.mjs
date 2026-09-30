// Run on stdin in the candidate image, cwd /app. No app/worker is started.
// Exercise the real adapter on one TLS connection and a READ ONLY transaction.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkServerIdentity } from "node:tls";
import mysql from "mysql2/promise";

let database, pool, failure = null, result, baseline;
const levels = new Set(["READ-UNCOMMITTED", "READ-COMMITTED", "REPEATABLE-READ", "SERIALIZABLE"]);
const requireCondition = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
const stateSql = "SELECT DATABASE() AS db, CURRENT_USER() AS account, VERSION() AS version, CONNECTION_ID() AS connectionId, @@session.transaction_isolation AS sessionLevel, @@global.transaction_isolation AS globalLevel";
try {
  const moduleAt = name => import(pathToFileURL(path.join(process.cwd(), "src", name)).href);
  const [{ readMysqlConfig }, { createMysqlDatabase }, { auditEquipmentImageRetirement }] = await Promise.all([
    moduleAt("mysqlConfig.js"), moduleAt("mysqlDatabase.js"), moduleAt("mysqlEquipmentImageRetirement.js"),
  ]);
  const secretFile = process.env.MYSQL_PASSWORD_FILE;
  requireCondition(typeof secretFile === "string" && path.isAbsolute(secretFile)
    && fs.lstatSync(secretFile).isFile(), "CLEANUP_CHECK_SECRET_FILE_REQUIRED");
  const password = fs.readFileSync(secretFile, "utf8");
  requireCondition(password.length > 0 && !/[\0\r\n]/.test(password), "CLEANUP_CHECK_SECRET_FILE_INVALID");
  const config = { ...readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password }), connectionLimit: 1 };
  requireCondition(config.database === "outdoor_fit_prod" && config.user === "outdoor_fit_app",
    "CLEANUP_CHECK_PRODUCTION_ACCOUNT_REQUIRED");
  requireCondition(config.ssl?.rejectUnauthorized === true && config.ssl?.verifyIdentity === true,
    "CLEANUP_CHECK_TLS_IDENTITY_REQUIRED");
  pool = mysql.createPool(config);
  database = createMysqlDatabase(config, { poolFactory: () => ({
    async getConnection() {
      const connection = await pool.getConnection();
      try {
        const socket = connection.connection?.stream;
        requireCondition(socket?.encrypted === true && socket.authorized === true
          && typeof socket.getPeerCertificate === "function"
          && checkServerIdentity(config.host, socket.getPeerCertificate(true)) === undefined,
        "CLEANUP_CHECK_TLS_NOT_VERIFIED");
        return connection;
      } catch (error) { connection.destroy(); throw error; }
    },
    end: () => pool.end(),
  }) });
  const validateState = state => {
    requireCondition(state?.db === "outdoor_fit_prod" && typeof state.account === "string"
      && state.account.split("@")[0] === "outdoor_fit_app" && /^8\.0\./.test(state.version)
      && Number.isSafeInteger(Number(state.connectionId)) && Number(state.connectionId) > 0
      && levels.has(state.sessionLevel) && levels.has(state.globalLevel), "CLEANUP_CHECK_SESSION_MISMATCH");
  };
  baseline = await database.get(stateSql);
  validateState(baseline);
  result = await database.transaction(async tx => {
    const current = await tx.get(stateSql);
    validateState(current);
    requireCondition(String(current.connectionId) === String(baseline.connectionId)
      && current.sessionLevel === "REPEATABLE-READ" && current.globalLevel === baseline.globalLevel,
    "CLEANUP_CHECK_TRANSACTION_ISOLATION_FAILED");
    const select = async (method, sql, values = []) => {
      requireCondition(typeof sql === "string" && /^SELECT\s/i.test(sql) && !sql.includes(";")
        && Array.isArray(values), "CLEANUP_CHECK_SELECT_ONLY");
      return tx[method](sql, values);
    };
    return auditEquipmentImageRetirement(Object.freeze({
      all: (sql, values) => select("all", sql, values),
      get: (sql, values) => select("get", sql, values),
    }));
  }, { isolationLevel: "REPEATABLE READ", readOnly: true });
  requireCondition(result?.mode === "read-only" && result.isolation === "REPEATABLE-READ"
    && [result.pendingCount, result.completedCount].every(value => Number.isSafeInteger(value) && value >= 0),
  "CLEANUP_CHECK_RESULT_INVALID");
  const restored = await database.get(stateSql);
  validateState(restored);
  requireCondition(String(restored.connectionId) === String(baseline.connectionId), "CLEANUP_CHECK_CONNECTION_REUSE_FAILED");
  requireCondition(restored.sessionLevel === baseline.sessionLevel, "CLEANUP_CHECK_SESSION_RESTORE_FAILED");
  requireCondition(restored.globalLevel === baseline.globalLevel, "CLEANUP_CHECK_GLOBAL_CHANGED");
} catch (error) {
  failure = /^(?:ER_|MYSQL_|CLEANUP_CHECK_|IMAGE_RETIREMENT_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_TLS_)[A-Z0-9_]*$/.test(error?.code || "")
    ? error.code : "CLEANUP_CHECK_FAILED";
} finally {
  try { if (database) await database.close(); else await pool?.end(); }
  catch { failure ||= "CLEANUP_CHECK_CONNECTION_CLOSE_FAILED"; }
}
if (failure) {
  console.log("CLEANUP_READ_ONLY_CHECK=FAIL");
  console.log("ERROR_CODE=" + failure);
  process.exitCode = 1;
} else {
  console.log("CLEANUP_READ_ONLY_CHECK=PASS");
  console.log("DEFAULT_ISOLATION=" + baseline.sessionLevel);
  console.log("TRANSACTION_ISOLATION=" + result.isolation);
  console.log("SESSION_RESTORED=PASS");
  console.log("GLOBAL_UNCHANGED=PASS");
  console.log("PENDING_COUNT=" + result.pendingCount);
  console.log("COMPLETED_COUNT=" + result.completedCount);
}
