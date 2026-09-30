import crypto from "node:crypto";
import { adminPagination } from "./adminPagination.js";
import { revalidateAdmin as defaultRevalidateAdmin } from "./adminAuthorization.js";

const COLUMNS = "id,submission_id,content_hash,user_id,submitter_type,name,email,subject,message,locale,status,notes,created_at,updated_at".split(",");
const JOINED = `SELECT ${COLUMNS.map(column => `f.${column}`).join(",")}, u.name AS user_name, u.profile_role AS user_profile_role, u.deleted_at AS user_deleted_at
  FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;
const SQL = Object.freeze({
  submission: `SELECT ${COLUMNS.join(",")} FROM feedback WHERE submission_id = ?`,
  user: "SELECT id, profile_role, deleted_at FROM users WHERE id = ?",
  byId: `${JOINED} WHERE f.id = ?`,
  insert: `INSERT INTO feedback (${COLUMNS.join(",")}) VALUES (${COLUMNS.map(() => "?").join(",")})`,
  update: "UPDATE feedback SET status = ?, notes = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
});

function failure(code, status) { return { status, error: code }; }
function previousSubmission(row, fingerprint) {
  if (!row) return null;
  return row.content_hash === fingerprint ? { status: 200, row } : failure("feedbackSubmissionConflict", 409);
}
function inactiveUser(user) {
  if (!user) return failure("unauthorized", 401);
  if (user.deleted_at != null) return failure("accountDeleted", 401);
  return null;
}
function submissionRow(submission, user, fingerprint) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), submission_id: submission.submissionId, content_hash: fingerprint,
    user_id: user?.id || null, submitter_type: user ? "registered" : "guest", name: submission.name,
    email: submission.email, subject: submission.subject, message: submission.message, locale: submission.locale,
    status: "new", notes: "", created_at: now, updated_at: now };
}
function submissionAudit(request, user, row) {
  return [{ ip: request.ip, admin: user ? { user, account: { system_role: user.profile_role } } : undefined },
    "feedback.submitted", "feedback", row.id, { isGuest: !user, locale: row.locale }];
}
function updateState(current, expectedUpdatedAt) {
  if (!current) return failure("feedbackNotFound", 404);
  if (current.updated_at !== expectedUpdatedAt) return failure("feedbackConflict", 409);
  return null;
}
function nextUpdatedAt(current) {
  const value = Math.max(Date.now(), Date.parse(current.updated_at) + 1);
  if (!Number.isFinite(value) || value > 8.64e15) throw Object.assign(new Error("Feedback version is invalid"), { code: "FEEDBACK_VERSION_INVALID" });
  return new Date(value).toISOString();
}
function verifyMysqlWrite(result, conditional = false) {
  if (result?.warningStatus !== 0 || (result.affectedRows !== 1 && !(conditional && result.affectedRows === 0))) {
    throw Object.assign(new Error("Feedback write failed"), { code: "FEEDBACK_WRITE_FAILED" });
  }
  return result.affectedRows === 1;
}
function synchronous(value) {
  if (value && typeof value.then === "function") {
    Promise.resolve(value).catch(() => {});
    throw new TypeError("SQLite feedback transaction callbacks must be synchronous");
  }
}
function listed(rows, { query, search }) {
  // SQLite LIKE is case-insensitive only for ASCII. A literal substring keeps
  // %, _ and backslash literal without MySQL collation or SQL-mode differences.
  const fold = value => value.replace(/[A-Z]/g, character => character.toLowerCase());
  const needle = fold(search);
  const matches = needle ? rows.filter(row => [row.name, row.email, row.subject, row.message].some(value => fold(value).includes(needle))) : rows;
  const pagination = adminPagination(query, matches.length);
  const offset = (pagination.page - 1) * pagination.pageSize;
  return { items: matches.slice(offset, offset + pagination.pageSize), pagination };
}
const listQuery = status => [`${JOINED}${status ? " WHERE f.status = ?" : ""} ORDER BY f.created_at DESC, f.id DESC`, status ? [status] : []];

/** Whole feedback operations preserve synchronous SQLite transactions. MySQL
 * always uses the original adapter, so authorization and audit retain its ALS
 * transaction context. This module neither changes schema nor opens a database. */
export function createFeedbackRepository(database, { allowSubmission, writeSystemLog, revalidateAdmin = defaultRevalidateAdmin }) {
  if (database?.dialect === "mysql") {
    return Object.freeze({
      async saveSubmission(request, submission, user, fingerprint) {
        return database.transaction(async () => {
          if (user) {
            user = await database.get(SQL.user + " FOR SHARE", [user.id]);
            const invalid = inactiveUser(user);
            if (invalid) return invalid;
          }
          const previous = previousSubmission(await database.get(SQL.submission, [submission.submissionId]), fingerprint);
          if (previous) return previous;
          const retryAfterSec = allowSubmission(request, submission, user);
          if (retryAfterSec) return { ...failure("feedbackRateLimited", 429), retryAfterSec };
          const row = submissionRow(submission, user, fingerprint);
          try { verifyMysqlWrite(await database.run(SQL.insert, COLUMNS.map(column => row[column]))); }
          catch (error) {
            // Missing submission IDs are not gap-locked. A unique INSERT is the
            // arbiter; current read sees a competing commit under REPEATABLE READ.
            if (error?.code === "ER_DUP_ENTRY") {
              const concurrent = previousSubmission(await database.get(SQL.submission + " FOR SHARE", [submission.submissionId]), fingerprint);
              if (concurrent) return concurrent;
            }
            throw error;
          }
          await writeSystemLog(database, ...submissionAudit(request, user, row));
          return { status: 201, row };
        });
      },
      async list(request, options) {
        return database.transaction(async () => {
          await revalidateAdmin(database, request, "feedback.read");
          const [sql, values] = listQuery(options.status);
          return listed(await database.all(sql, values), options);
        });
      },
      async getById(request, id) {
        return database.transaction(async () => {
          await revalidateAdmin(database, request, "feedback.read");
          return await database.get(SQL.byId, [id]) ?? null;
        });
      },
      async update(request, { status, notes, expectedUpdatedAt }) {
        return database.transaction(async () => {
          await revalidateAdmin(database, request, "feedback.read");
          await revalidateAdmin(database, request, "feedback.manage");
          const current = await database.get(SQL.byId, [request.params.id]);
          const invalid = updateState(current, expectedUpdatedAt);
          if (invalid) return invalid;
          const updatedAt = nextUpdatedAt(current);
          const result = await database.run(SQL.update, [status, notes, updatedAt, current.id, expectedUpdatedAt]);
          if (!verifyMysqlWrite(result, true)) return failure("feedbackConflict", 409);
          await writeSystemLog(database, request, "feedback.updated", "feedback", current.id,
            { previousStatus: current.status, status, notesChanged: current.notes !== notes });
          const row = await database.get(SQL.byId, [current.id]);
          if (!row || row.updated_at !== updatedAt) throw Object.assign(new Error("Feedback write could not be verified"), { code: "FEEDBACK_WRITE_FAILED" });
          return { status: 200, row };
        });
      },
    });
  }
  const statements = Object.fromEntries(Object.entries(SQL).map(([key, sql]) => [key, database.prepare(sql)]));
  const saveSubmission = database.transaction((request, submission, user, fingerprint) => {
    if (user) {
      user = statements.user.get(user.id);
      const invalid = inactiveUser(user);
      if (invalid) return invalid;
    }
    const previous = previousSubmission(statements.submission.get(submission.submissionId), fingerprint);
    if (previous) return previous;
    const retryAfterSec = allowSubmission(request, submission, user);
    if (retryAfterSec) return { ...failure("feedbackRateLimited", 429), retryAfterSec };
    const row = submissionRow(submission, user, fingerprint);
    statements.insert.run(...COLUMNS.map(column => row[column]));
    synchronous(writeSystemLog(database, ...submissionAudit(request, user, row)));
    return { status: 201, row };
  });
  const list = database.transaction((request, options) => {
    synchronous(revalidateAdmin(database, request, "feedback.read"));
    const [sql, values] = listQuery(options.status);
    return listed(database.prepare(sql).all(...values), options);
  });
  const getById = database.transaction((request, id) => {
    synchronous(revalidateAdmin(database, request, "feedback.read"));
    return statements.byId.get(id) ?? null;
  });
  const update = database.transaction((request, { status, notes, expectedUpdatedAt }) => {
    synchronous(revalidateAdmin(database, request, "feedback.read"));
    synchronous(revalidateAdmin(database, request, "feedback.manage"));
    const current = statements.byId.get(request.params.id);
    const invalid = updateState(current, expectedUpdatedAt);
    if (invalid) return invalid;
    const updatedAt = nextUpdatedAt(current);
    if (statements.update.run(status, notes, updatedAt, current.id, expectedUpdatedAt).changes !== 1) return failure("feedbackConflict", 409);
    synchronous(writeSystemLog(database, request, "feedback.updated", "feedback", current.id,
      { previousStatus: current.status, status, notesChanged: current.notes !== notes }));
    return { status: 200, row: statements.byId.get(current.id) };
  });
  return Object.freeze({
    saveSubmission(...args) { return saveSubmission.immediate(...args); },
    list(...args) { return list.immediate(...args); },
    getById(...args) { return getById.immediate(...args); },
    update(...args) { return update.immediate(...args); },
  });
}
