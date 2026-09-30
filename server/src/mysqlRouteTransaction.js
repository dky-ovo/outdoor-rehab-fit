import { AsyncLocalStorage } from "node:async_hooks";
import { revalidateAdmin } from "./adminAuthorization.js";
import { lockMysqlMediaNamespace } from "./mysqlMediaFileOperations.js";

const effects = new AsyncLocalStorage();
class RejectedResponse extends Error {}

export function inMysqlTransaction(database, operation) {
  return database.inTransaction ? operation(database) : database.transaction(operation);
}

export async function lockMysqlApplicationWrites(database) {
  if (!database.inTransaction) throw new Error("Application write lock requires a transaction");
  // An existing imported singleton serializes legacy read/modify/write routes.
  // It requires no DDL or extra permissions for the production app account.
  if (!await database.get("SELECT id FROM ai_configuration WHERE id = 'default' FOR UPDATE")) {
    throw new Error("PRODUCTION_CONFIGURATION_ROW_REQUIRED");
  }
}

export function afterMysqlCommit(callback) {
  const scope = effects.getStore();
  if (!scope) throw new Error("Deferred effect requires a route transaction");
  scope.commit.push(callback);
}

export function afterMysqlRollback(callback) {
  const scope = effects.getStore();
  if (!scope) throw new Error("Rollback effect requires a route transaction");
  scope.rollback.push(callback);
}

// Hold the JSON response until COMMIT succeeds. An HTTP rejection rolls back
// writes, and a lost COMMIT response never triggers destructive FS compensation.
export function mysqlRouteTransaction(database, authenticate, permission, handler, { media = false, facilities = false, transactionOptions } = {}) {
  return async function transactionalRoute(request, response) {
    const scope = { commit: [], rollback: [] };
    let status = 200, body, ended = false;
    const headers = new Map();
    const buffered = {
      status(value) { status = value; return buffered; },
      set(name, value) { headers.set(name, value); return buffered; },
      json(value) { body = value; ended = true; return buffered; },
    };
    try {
      await database.transaction(async () => {
        await lockMysqlApplicationWrites(database);
        await authenticate(request);
        if (permission) await revalidateAdmin(database, request, permission);
        if (media) await lockMysqlMediaNamespace(database);
        if (facilities) await database.all("SELECT id FROM facility_sources ORDER BY id FOR UPDATE");
        await effects.run(scope, () => handler(request, buffered));
        if (!ended) throw new Error("Transactional route must return JSON");
        if (status >= 400) throw new RejectedResponse();
      }, transactionOptions);
    } catch (error) {
      if (error?.code !== "MYSQL_COMMIT_OUTCOME_UNKNOWN") {
        for (const callback of scope.rollback.reverse()) {
          try { await callback(); } catch { console.error("FILE_ROLLBACK_CLEANUP_FAILED"); }
        }
      }
      if (!(error instanceof RejectedResponse)) throw error;
      scope.commit.length = 0;
    }
    for (const [name, value] of headers) response.set(name, value);
    response.status(status).json(body);
    for (const callback of scope.commit) {
      // This runs outside the completed transaction's async context.
      Promise.resolve().then(callback).catch(() => console.error("POST_COMMIT_EFFECT_FAILED"));
    }
  };
}
