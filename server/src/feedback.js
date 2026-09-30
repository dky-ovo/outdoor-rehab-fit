import crypto from "node:crypto";
import { isIP } from "node:net";
import { createFeedbackRepository } from "./feedbackRepository.js";

export const FEEDBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    user_id TEXT,
    submitter_type TEXT NOT NULL CHECK (submitter_type IN ('guest', 'registered')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS feedback_status_created ON feedback(status, created_at DESC, id DESC);
`;

const STATUSES = new Set(["new", "in_progress", "resolved"]);
const WINDOW_MS = 15 * 60 * 1000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function normalizeSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const subject = body.subject === undefined ? "" : typeof body.subject === "string" ? body.subject.trim() : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(submissionId)
    || !name || name.length > 80 || /[\r\n\t]/.test(name)
    || !email || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    || subject === null || subject.length > 160 || /[\r\n\t]/.test(subject)
    || !message || message.length > 5000
    || !["zh", "en"].includes(body.locale)
    || [name, email, subject, message].some(value => CONTROL_CHARACTERS.test(value))) return null;
  return { submissionId, name, email, subject, message, locale: body.locale };
}

function receipt(row) {
  return { id: row.id, status: row.status, createdAt: row.created_at };
}

function adminFeedback(row) {
  return {
    id: row.id, name: row.name, email: row.email, subject: row.subject, message: row.message,
    locale: row.locale, status: row.status, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
    userId: row.user_id, userName: row.user_name || "", userProfileRole: row.user_profile_role || "",
    userDeletedAt: row.user_deleted_at || null, isGuest: row.submitter_type === "guest",
  };
}

export function createFeedbackService({ database, jwtSecret, authenticatedUser, writeSystemLog, revalidateAdmin }) {
  // The API listens on loopback behind nginx, without an established trusted
  // forwarding-header contract. Never use caller-controlled XFF/X-Real-IP or
  // collapse all proxy visitors into a single person's IP quota. Key independent
  // quotas by normalized contact email and verified account; only apply a broad
  // socket-IP quota to direct non-loopback traffic. A separate generous service
  // ceiling bounds address rotation, and expiring HMAC keys retain no raw email.
  const rateWindows = new Map();
  function allowSubmission(request, submission, user) {
    const now = Date.now();
    for (const [key, window] of rateWindows) if (now >= window.until) rateWindows.delete(key);
    const dimensions = [[`email:${submission.email}`, 5], ["service", 2000]];
    if (user) dimensions.push([`user:${user.id}`, 10]);
    const socketAddress = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    if (isIP(socketAddress) && socketAddress !== "::1" && !socketAddress.startsWith("127.")) dimensions.push([`ip:${socketAddress}`, 50]);
    const keys = dimensions.map(([value, maximum]) => [crypto.createHmac("sha256", jwtSecret).update(value).digest("hex"), maximum]);
    const blocked = keys.map(([key, maximum]) => rateWindows.get(key)).find((window, index) => window && window.count >= keys[index][1]);
    if (blocked || rateWindows.size >= 10_000) return Math.max(1, Math.ceil(((blocked?.until || now + WINDOW_MS) - now) / 1000));
    for (const [key] of keys) {
      const window = rateWindows.get(key) || { count: 0, until: now + WINDOW_MS };
      window.count += 1;
      rateWindows.set(key, window);
    }
    return 0;
  }

  const repository = createFeedbackRepository(database, { allowSubmission, writeSystemLog, revalidateAdmin });

  async function submit(request, response) {
    // A supplied invalid/expired credential must not silently become a guest.
    const user = request.headers.authorization ? await authenticatedUser(request, database, jwtSecret) : null;
    if (request.headers.authorization && !user) return response.status(401).json({ error: "unauthorized" });
    const submission = normalizeSubmission(request.body);
    if (!submission) return response.status(400).json({ error: "invalidFeedback" });
    const fingerprint = crypto.createHmac("sha256", jwtSecret)
      .update(JSON.stringify({ ...submission, userId: user?.id || null })).digest("hex");
    const result = await repository.saveSubmission(request, submission, user, fingerprint);
    if (result.status === 429) response.set("Retry-After", String(result.retryAfterSec));
    return response.status(result.status).json(result.error
      ? { error: result.error, ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}) }
      : { feedback: receipt(result.row) });
  }

  function registerAdminRoutes(app, requirePermission) {
    app.use("/api/admin/feedback", (_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
    app.get("/api/admin/feedback", requirePermission("feedback.read"), async (request, response) => {
      if ((request.query.status !== undefined && typeof request.query.status !== "string")
        || (request.query.search !== undefined && typeof request.query.search !== "string")) return response.status(400).json({ error: "invalidFeedback" });
      const status = request.query.status || "", search = (request.query.search || "").trim();
      if ((status && !STATUSES.has(status)) || search.length > 200) return response.status(400).json({ error: "invalidFeedback" });
      const result = await repository.list(request, { query: request.query, status, search });
      return response.json({ items: result.items.map(adminFeedback), pagination: result.pagination });
    });

    app.get("/api/admin/feedback/:id", requirePermission("feedback.read"), async (request, response) => {
      const row = await repository.getById(request, request.params.id);
      if (!row) return response.status(404).json({ error: "feedbackNotFound" });
      return response.json({ feedback: adminFeedback(row) });
    });

    app.patch("/api/admin/feedback/:id", requirePermission("feedback.read"), requirePermission("feedback.manage"), async (request, response) => {
      const { status, notes, expectedUpdatedAt } = request.body || {};
      if (!STATUSES.has(status) || typeof notes !== "string" || notes.length > 2000 || CONTROL_CHARACTERS.test(notes)
        || typeof expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expectedUpdatedAt)
        || !Number.isFinite(Date.parse(expectedUpdatedAt))) return response.status(400).json({ error: "invalidFeedback" });
      const result = await repository.update(request, { status, notes, expectedUpdatedAt });
      return response.status(result.status).json(result.error ? { error: result.error } : { feedback: adminFeedback(result.row) });
    });
  }
  return { submit, registerAdminRoutes };
}
