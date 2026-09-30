import crypto from "node:crypto";
import { createRegistrationRepository } from "./registrationRepository.js";
import { revalidateAdmin as defaultRevalidateAdmin } from "./adminAuthorization.js";

// Codes are phone-bound, single-use invitations, not SMS verification codes.
// Only their hashes are retained; the plaintext is shown once to the issuer.
export const REGISTRATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS registration_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    profile_role TEXT NOT NULL CHECK (profile_role IN ('participant', 'staff')),
    created_by TEXT,
    created_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT,
    revoked_at TEXT,
    revoked_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS registration_codes_active_phone
    ON registration_codes(phone) WHERE used_at IS NULL AND revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS registration_codes_created ON registration_codes(created_at DESC, id);
`;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const GENERATION_ATTEMPTS = 10;
export function generateRegistrationCode() {
  // 32 unambiguous symbols: 40 random bits, sampled without modulo bias.
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
}
export function normalizeRegistrationCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[\s-]/g, "") : "";
}
export function registrationCodeHash(value) {
  return crypto.createHash("sha256").update(normalizeRegistrationCode(value)).digest("hex");
}
function publicCode(row) {
  return {
    id: row.id, name: row.name, phone: row.phone, profileRole: row.profile_role,
    codeHint: row.code_hint, createdAt: row.created_at, usedAt: row.used_at,
    revokedAt: row.revoked_at, status: row.used_at ? "used" : row.revoked_at ? "revoked" : "active",
  };
}
export function createRegistrationService({ database, jwtSecret, normalizePhone, isValidE164, normalizeEmail, hashPassword, publicUser, signToken, writeSystemLog, revalidateAdmin = defaultRevalidateAdmin }) {
  // Bound guessing per phone without grouping every participant behind the
  // same reverse proxy into one IP quota. Wrong codes are rejected before the
  // expensive password hash. Keep only keyed digests for 15 minutes.
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;
  function allowAttempt(phone) {
    const now = Date.now();
    for (const [key, value] of attempts) if (now >= value.until) attempts.delete(key);
    const keys = [[`phone:${phone}`, 15]].map(([value, max]) => [crypto.createHmac("sha256", jwtSecret).update(value).digest("hex"), max]);
    if (attempts.size > 10000 || keys.some(([key, max]) => (attempts.get(key)?.count || 0) >= max)) return false;
    for (const [key] of keys) {
      const value = attempts.get(key) || { count: 0, until: now + windowMs };
      value.count += 1; attempts.set(key, value);
    }
    return true;
  }
  const repository = createRegistrationRepository(database, {
    writeSystemLog, revalidateAdmin, generationAttempts: GENERATION_ATTEMPTS,
    makeInvitation({ name, phone, profileRole }, actorId) {
      const code = generateRegistrationCode();
      const row = { id: crypto.randomUUID(), code_hash: registrationCodeHash(code), code_hint: code.slice(-4), name, phone,
        profile_role: profileRole, created_by: actorId, created_at: new Date().toISOString() };
      return { row, code: `${code.slice(0, 4)}-${code.slice(4)}` };
    },
  });

  const register = async (request, response) => {
    const body = request.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = normalizePhone(body.phone, body.countryCode || "+852");
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmation = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const code = normalizeRegistrationCode(body.registrationCode);
    if (!allowAttempt(phone)) return response.status(429).json({ error: "registrationRateLimited" });
    if (!name) return response.status(400).json({ error: "nameRequired" });
    if (name.length > 50) return response.status(400).json({ error: "invalidRegistration" });
    if (!isValidE164(phone)) return response.status(400).json({ error: "invalidPhone" });
    if (password.length < 8) return response.status(400).json({ error: "passwordTooShort" });
    if (password.length > 256) return response.status(400).json({ error: "passwordTooLong" });
    if (!confirmation || password !== confirmation) return response.status(400).json({ error: "passwordMismatch" });
    if (!code) return response.status(400).json({ error: "registrationCodeRequired" });
    // Keep every previously accepted 20-character invitation usable. Short
    // codes use the same unambiguous alphabet as the generator.
    if (!/^(?:[A-HJ-NP-Z2-9]{8}|[A-Z2-9]{20})$/.test(code)) return response.status(400).json({ error: "invalidRegistrationCode" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "invalidEmail" });
    try {
      const codeHash = registrationCodeHash(code);
      await repository.checkRegistration({ codeHash, phone, email });
      const passwordRecord = await hashPassword(password);
      const user = await repository.consume({ codeHash, phone, email, name, passwordRecord });
      return response.status(201).json({ user: publicUser(user), token: signToken(user, jwtSecret) });
    } catch (error) {
      if (error.registrationError) return response.status(error.status).json({ error: error.registrationError });
      throw error;
    }
  };

  function registerAdminRoutes(app, requirePermission) {
    app.get("/api/admin/registration-codes", requirePermission("users.read"), async (request, response) => {
      response.set("Cache-Control", "no-store");
      const pageSize = Math.max(1, Math.min(50, Math.floor(Number(request.query.pageSize) || 20)));
      const requestedPage = Math.max(1, Math.min(1000000, Math.floor(Number(request.query.page) || 1)));
      const search = String(request.query.search || "").trim().slice(0, 100);
      const status = String(request.query.status || "");
      const result = await repository.list({ search, status, pageSize, requestedPage });
      return response.json({ ...result, codes: result.codes.map(publicCode) });
    });
    app.post("/api/admin/registration-codes", requirePermission("users.edit"), async (request, response) => {
      response.set("Cache-Control", "no-store");
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      const phone = normalizePhone(request.body?.phone, request.body?.countryCode || "+852");
      const profileRole = request.body?.profileRole;
      if (!name || name.length > 50 || !isValidE164(phone) || !["participant", "staff"].includes(profileRole)) return response.status(400).json({ error: "invalidRegistrationInvitation" });
      try {
        const result = await repository.issue({ name, phone, profileRole }, request);
        return response.status(201).json({ invitation: publicCode(result.row), code: result.code });
      } catch (error) {
        if (error.registrationError) return response.status(error.status).json({ error: error.registrationError });
        throw error;
      }
    });
    app.post("/api/admin/registration-codes/:id/revoke", requirePermission("users.edit"), async (request, response) => {
      try {
        const result = await repository.revoke(request.params.id, request);
        return response.status(result.status || 200).json(result.error ? { error: result.error } : result);
      } catch (error) {
        if (error.registrationError) return response.status(error.status).json({ error: error.registrationError });
        throw error;
      }
    });
  }
  return { register, registerAdminRoutes };
}
