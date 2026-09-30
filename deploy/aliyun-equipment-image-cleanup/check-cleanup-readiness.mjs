// Candidate-image stdin probe, cwd /app. No app factory or worker is started.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkServerIdentity } from "node:tls";
import mysql from "mysql2/promise";

let connection, failure = null, result;
const requireCondition = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
try {
  const moduleAt = name => import(pathToFileURL(path.join(process.cwd(), "src", name)).href);
  const [{ readMysqlConfig }, { initializeMysqlSession }, { auditEquipmentImageRetirement }] = await Promise.all([
    moduleAt("mysqlConfig.js"), moduleAt("mysqlDatabase.js"), moduleAt("mysqlEquipmentImageRetirement.js"),
  ]);
  const secretFile = process.env.MYSQL_PASSWORD_FILE;
  requireCondition(typeof secretFile === "string" && path.isAbsolute(secretFile)
    && fs.lstatSync(secretFile).isFile(), "CLEANUP_CHECK_SECRET_FILE_REQUIRED");
  const password = fs.readFileSync(secretFile, "utf8");
  requireCondition(password.length > 0 && !/[\0\r\n]/.test(password), "CLEANUP_CHECK_SECRET_FILE_INVALID");
  const config = readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password });
  requireCondition(config.database === "outdoor_fit_prod" && config.user === "outdoor_fit_app",
    "CLEANUP_CHECK_PRODUCTION_ACCOUNT_REQUIRED");
  requireCondition(config.ssl?.rejectUnauthorized === true && config.ssl?.verifyIdentity === true,
    "CLEANUP_CHECK_TLS_IDENTITY_REQUIRED");
  connection = await mysql.createConnection(config);
  const socket = connection.connection?.stream;
  requireCondition(socket?.encrypted === true && socket.authorized === true
    && typeof socket.getPeerCertificate === "function"
    && checkServerIdentity(config.host, socket.getPeerCertificate(true)) === undefined,
  "CLEANUP_CHECK_TLS_NOT_VERIFIED");
  await initializeMysqlSession(connection);
  const select = async (sql, values = []) => {
    requireCondition(typeof sql === "string" && /^SELECT\s/i.test(sql) && !sql.includes(";")
      && Array.isArray(values), "CLEANUP_CHECK_SELECT_ONLY");
    const [rows] = await connection.execute({ sql, timeout: 8000 }, values);
    requireCondition(Array.isArray(rows), "CLEANUP_CHECK_ROWS_REQUIRED");
    return rows;
  };
  // Server enforcement supplements the deliberately get/all-only facade.
  await connection.query({ sql: "START TRANSACTION READ ONLY", timeout: 8000 });
  const [state] = await select("SELECT DATABASE() AS db, CURRENT_USER() AS account, VERSION() AS version");
  requireCondition(state.db === "outdoor_fit_prod" && state.account.split("@")[0] === "outdoor_fit_app"
    && /^8\.0\./.test(state.version), "CLEANUP_CHECK_SESSION_MISMATCH");
  result = await auditEquipmentImageRetirement(Object.freeze({
    all: select,
    get: async (sql, values = []) => (await select(sql, values))[0],
  }));
  requireCondition(result?.mode === "read-only" && ["REPEATABLE-READ", "SERIALIZABLE"].includes(result.isolation)
    && [result.pendingCount, result.completedCount].every(value => Number.isSafeInteger(value) && value >= 0),
  "CLEANUP_CHECK_RESULT_INVALID");
  await connection.query({ sql: "ROLLBACK", timeout: 8000 });
} catch (error) {
  failure = /^(?:ER_|CLEANUP_CHECK_|IMAGE_RETIREMENT_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_TLS_)[A-Z0-9_]*$/.test(error?.code || "")
    ? error.code : "CLEANUP_CHECK_FAILED";
} finally {
  if (connection) {
    try { await connection.end(); }
    catch { connection.destroy(); failure ||= "CLEANUP_CHECK_CONNECTION_CLOSE_FAILED"; }
  }
}
if (failure) {
  console.log("CLEANUP_READ_ONLY_CHECK=FAIL");
  console.log("ERROR_CODE=" + failure);
  process.exitCode = 1;
} else {
  console.log("CLEANUP_READ_ONLY_CHECK=PASS");
  console.log("PENDING_COUNT=" + result.pendingCount);
  console.log("COMPLETED_COUNT=" + result.completedCount);
}
