import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2/promise";
import { readMysqlConfig } from "./mysqlConfig.js";

// This asynchronous adapter is intentionally not wired into the SQLite app yet.
// SQL must already be MySQL SQL; neither statements nor transaction callbacks
// are silently translated or retried.
function driverError(error, operation) {
  const code = /^[A-Z0-9_]+$/.test(error?.code || "") ? error.code : "MYSQL_OPERATION_FAILED";
  const safe = new Error(`MySQL ${operation} failed (${code})`);
  safe.name = "MysqlOperationError";
  safe.code = code;
  if (Number.isInteger(error?.errno)) safe.errno = error.errno;
  if (/^[A-Z0-9]{5}$/.test(error?.sqlState || "")) safe.sqlState = error.sqlState;
  // mysql2 errors can contain bound passwords, tokens and business values in
  // sql/sqlMessage/message. Do not attach the original error as a cause.
  return safe;
}

function localError(code, message) {
  return Object.assign(new Error(message), { code });
}

const ISOLATION_SQL = Object.freeze({
  "READ-UNCOMMITTED": "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
  "READ-COMMITTED": "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
  "REPEATABLE-READ": "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  SERIALIZABLE: "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE",
});
const SESSION_ISOLATION_SQL = "SELECT @@SESSION.transaction_isolation AS isolationLevel";

function transactionOptions(options) {
  if (options === undefined) return {};
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some(key => !["isolationLevel", "readOnly"].includes(key)) ||
      (options.readOnly !== undefined && typeof options.readOnly !== "boolean")) {
    throw new TypeError("Invalid MySQL transaction options");
  }
  const isolationLevel = options.isolationLevel;
  if (isolationLevel !== undefined && !["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].includes(isolationLevel)) {
    throw new TypeError("Invalid MySQL transaction isolation level");
  }
  return { isolationLevel: isolationLevel?.replaceAll(" ", "-"), readOnly: options.readOnly === true };
}

async function readSessionIsolation(connection) {
  const [rows] = await connection.query(SESSION_ISOLATION_SQL);
  const raw = Array.isArray(rows) && rows.length === 1 ? rows[0]?.isolationLevel : undefined;
  const value = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  if (typeof value !== "string" || !Object.hasOwn(ISOLATION_SQL, value)) {
    throw localError("MYSQL_ISOLATION_VALUE_INVALID", "MySQL returned an invalid isolation level");
  }
  return value;
}

function validateStatement(sql, values) {
  if (typeof sql !== "string" || !sql.trim() || !Array.isArray(values)) {
    throw new TypeError("MySQL statements require SQL and an array of bound values");
  }
}

function methods(execute) {
  return Object.freeze({
    async all(sql, values = []) {
      const rows = await execute(sql, values);
      if (!Array.isArray(rows)) throw new TypeError("Expected a MySQL row result");
      return rows;
    },
    async get(sql, values = []) {
      const rows = await execute(sql, values);
      if (!Array.isArray(rows)) throw new TypeError("Expected a MySQL row result");
      return rows[0];
    },
    async run(sql, values = []) {
      const result = await execute(sql, values);
      if (Array.isArray(result) || !result || typeof result.affectedRows !== "number") {
        throw new TypeError("Expected a MySQL statement result");
      }
      // Preserve MySQL result semantics. affectedRows is not SQLite changes,
      // especially for ON DUPLICATE KEY UPDATE and FOUND_ROWS.
      return {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        warningStatus: result.warningStatus,
      };
    },
  });
}

export async function initializeMysqlSession(connection) {
  // Handshake uses utf8mb4_bin (ID 46) because the handshake field is uint8.
  // Apply the final comparison semantics only after that handshake succeeds.
  await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin");
  await connection.query("SET SESSION time_zone = '+00:00'");
}

export function createMysqlDatabase(config = readMysqlConfig(), { poolFactory = mysql.createPool } = {}) {
  if (config?.ssl?.rejectUnauthorized !== true || config?.ssl?.verifyIdentity !== true || !config?.ssl?.ca) {
    throw new TypeError("MySQL requires a CA and certificate identity verification");
  }
  const pool = poolFactory(config);
  const transactions = new AsyncLocalStorage();
  let closing = false;
  let closePromise;

  function assertOpen() {
    if (closing) throw localError("MYSQL_CLOSED", "MySQL database is closing or closed");
  }

  async function acquire() {
    assertOpen();
    let connection;
    try {
      connection = await pool.getConnection();
      // Reset comparison rules and UTC on every checkout, including recycled
      // connections. Driver timezone controls JS conversion, not server NOW().
      await initializeMysqlSession(connection);
      return connection;
    } catch (error) {
      connection?.destroy();
      throw driverError(error, "connection setup");
    }
  }

  async function executeOn(connection, sql, values, scope) {
    validateStatement(sql, values);
    if (scope?.failure) throw scope.failure;
    try {
      const [result] = await connection.execute(sql, values);
      return result;
    } catch (error) {
      const safe = driverError(error, "statement");
      if (scope && (error?.fatal || error?.sqlState === "40001" ||
        ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ER_SERVER_SHUTDOWN"].includes(safe.code))) {
        // InnoDB may already have rolled back the whole transaction. Even if
        // the callback catches this error, subsequent writes must not fall
        // through to autocommit and a final COMMIT must not report success.
        scope.failure = safe;
        scope.unusable = Boolean(error?.fatal) || ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ER_SERVER_SHUTDOWN"].includes(safe.code);
      }
      throw safe;
    }
  }

  async function execute(sql, values) {
    assertOpen();
    validateStatement(sql, values);
    const scope = transactions.getStore();
    if (scope) {
      return executeInScope(scope, sql, values);
    }
    const connection = await acquire();
    try {
      return await executeOn(connection, sql, values);
    } finally {
      connection.release();
    }
  }

  function executeInScope(scope, sql, values) {
    validateStatement(sql, values);
    if (!scope.active) throw localError("MYSQL_TRANSACTION_FINISHED", "MySQL transaction has finished");
    // Keep queued work here, rather than in the driver. A deadlock can roll
    // back the transaction before the driver's next queued command executes.
    const pending = scope.tail.then(() => {
      if (scope.failure) throw scope.failure;
      if (!scope.active) throw localError("MYSQL_TRANSACTION_FINISHED", "MySQL transaction has finished");
      return executeOn(scope.connection, sql, values, scope);
    });
    scope.tail = pending.catch(() => {});
    return pending;
  }

  async function transaction(callback, options) {
    assertOpen();
    if (typeof callback !== "function") throw new TypeError("MySQL transaction requires a callback");
    const settings = transactionOptions(options);
    if (transactions.getStore()) {
      throw localError("MYSQL_NESTED_TRANSACTION", "Use the current transaction instead of nesting transactions");
    }
    const connection = await acquire();
    const scope = { connection, active: true, tail: Promise.resolve() };
    const scopedMethods = methods((sql, values) => executeInScope(scope, sql, values));
    let reusable = true;
    let previousIsolation;
    try {
      try {
        if (settings.isolationLevel) {
          previousIsolation = await readSessionIsolation(connection);
          // SESSION is set before BEGIN so the live transaction and the session
          // variable agree. A one-transaction SET would not update that variable.
          await connection.query(ISOLATION_SQL[settings.isolationLevel]);
          if (await readSessionIsolation(connection) !== settings.isolationLevel) {
            throw localError("MYSQL_ISOLATION_SETUP_FAILED", "MySQL transaction isolation was not applied");
          }
        }
        if (settings.readOnly) await connection.query("START TRANSACTION READ ONLY");
        else await connection.beginTransaction();
      } catch (error) {
        reusable = false;
        throw driverError(error, "transaction start");
      }
      let value;
      try {
        value = await transactions.run(scope, () => callback(scopedMethods));
        await scope.tail;
        if (scope.failure) throw scope.failure;
      } catch (error) {
        scope.active = false;
        await scope.tail;
        try {
          await connection.rollback();
        } catch {
          reusable = false;
        }
        throw error;
      }
      scope.active = false;
      try {
        await connection.commit();
      } catch (error) {
        // A lost COMMIT response does not prove a rollback. Never retry the
        // business operation or put this connection back into the pool.
        reusable = false;
        const uncertain = localError("MYSQL_COMMIT_OUTCOME_UNKNOWN", "MySQL commit outcome is unknown; reconcile before retrying");
        uncertain.driverCode = driverError(error, "commit").code;
        throw uncertain;
      }
      return value;
    } finally {
      scope.active = false;
      if (previousIsolation && reusable && !scope.unusable) {
        try {
          await connection.query(ISOLATION_SQL[previousIsolation]);
          if (await readSessionIsolation(connection) !== previousIsolation) reusable = false;
        } catch {
          reusable = false;
        }
        // A committed business result remains committed if reset fails. Destroy
        // the connection rather than leaking its setting or reporting rollback.
      }
      if (reusable && !scope.unusable) connection.release();
      else connection.destroy();
    }
  }

  function close() {
    if (transactions.getStore()) {
      return Promise.reject(localError("MYSQL_CLOSE_IN_TRANSACTION", "Close MySQL after the transaction finishes"));
    }
    if (!closePromise) {
      closing = true;
      closePromise = Promise.resolve().then(() => pool.end()).catch((error) => {
        throw driverError(error, "close");
      });
    }
    return closePromise;
  }

  return Object.freeze({
    dialect: "mysql",
    get inTransaction() {
      const scope = transactions.getStore();
      return Boolean(scope?.active && !scope.failure);
    },
    ...methods(execute), transaction, close,
  });
}
