import path from "node:path";
import { fileURLToPath } from "node:url";

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const jwtSecret = env.JWT_SECRET || "development-only-secret-change-before-production";
  if (env.NODE_ENV === "production" && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters in production");
  }

  const smsMode = env.SMS_MODE || "mock";
  if (!new Set(["mock", "twilio", "disabled"]).has(smsMode)) {
    throw new Error("SMS_MODE must be mock, twilio, or disabled");
  }

  const twilio = {
    accountSid: env.TWILIO_ACCOUNT_SID || "",
    apiKeySid: env.TWILIO_API_KEY_SID || "",
    apiKeySecret: env.TWILIO_API_KEY_SECRET || "",
    verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID || "",
  };
  if (smsMode === "twilio" && (!twilio.apiKeySid || !twilio.apiKeySecret || !twilio.verifyServiceSid)) {
    throw new Error("Twilio Verify credentials are required when SMS_MODE=twilio");
  }

	const databasePath = path.resolve(env.DATABASE_PATH || "./data/outdoor-fit.sqlite");
	const testSmsCodeEnabled = String(env.TEST_SMS_CODE_ENABLED ?? "true").toLowerCase() !== "false";
	const testSmsCode = String(env.TEST_SMS_CODE || "123456");
	if (!/^\d{6}$/.test(testSmsCode)) throw new Error("TEST_SMS_CODE must contain exactly 6 digits");
  return {
    port,
    jwtSecret,
		databasePath,
		equipmentUploadDir: path.resolve(env.EQUIPMENT_UPLOAD_DIR || path.join(path.dirname(databasePath), "equipment-images")),
		mediaUploadDir: path.resolve(env.MEDIA_UPLOAD_DIR || path.join(path.dirname(databasePath), "media-library")),
		mediaSeedDir: path.resolve(env.MEDIA_SEED_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "../media-seed")),
    smsMode,
		testSmsCodeEnabled,
		testSmsCode,
    twilio,
  };
}
