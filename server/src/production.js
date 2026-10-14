// Dedicated MySQL entry point: no schema creation, SQLite fallback or seed replay.
import fs from "node:fs";
import { createMysqlApp } from "./appMysql.js";
import { readConfig } from "./config.js";
import { readMysqlConfig } from "./mysqlConfig.js";
import { createMysqlDatabase } from "./mysqlDatabase.js";
import { facilitySource, safeSyncFacilities } from "./mysqlFacilities.js";
import { createBailianFaqSelector } from "./assistantBailian.js";

function productionConfiguration(env) {
  env = { ...env };
  for (const key of ["JWT_SECRET", "MYSQL_PASSWORD"]) {
    const file = env[key + "_FILE"];
    if (!file || !fs.lstatSync(file).isFile()) throw new Error("PRODUCTION_SECRET_FILE_REQUIRED");
    env[key] = fs.readFileSync(file, "utf8");
    if (!env[key] || /[\0\r\n]/.test(env[key])) throw new Error("PRODUCTION_SECRET_FILE_INVALID");
  }
  if (env.NODE_ENV !== "production" || env.DATABASE_CLIENT !== "mysql") {
    throw new Error("PRODUCTION_MYSQL_CONFIGURATION_REQUIRED");
  }
  if (env.HOST !== "0.0.0.0" || env.PORT !== "3000") {
    throw new Error("PRODUCTION_CONTAINER_LISTENER_REQUIRED");
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET === "development-only-secret-change-before-production") {
    throw new Error("PRODUCTION_JWT_SECRET_REQUIRED");
  }
  // The legacy mock mode returns codes in HTTP responses, including password
  // resets. It is not a production SMS transport even with test codes disabled.
  if (env.SMS_MODE !== "disabled" || env.TEST_SMS_CODE_ENABLED !== "false") {
    throw new Error("PRODUCTION_SMS_CONFIGURATION_REQUIRED");
  }
  const config = readConfig(env);
  const mysql = readMysqlConfig(env);
  if (mysql.database !== "outdoor_fit_prod" || mysql.user !== "outdoor_fit_app") {
    throw new Error("PRODUCTION_DATABASE_ACCOUNT_REQUIRED");
  }
  return { config, mysql };
}

let database, server, facilityTimer, syncWork, imageRetirement, accountContinuity, stopping = false;

async function scheduleFacilitySync() {
  if (stopping) return;
  let delay = 60 * 60 * 1000;
  try {
    const source = await facilitySource(database);
    if (source?.isActive) {
      const dueAt = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) + source.syncIntervalHours * 3600000 : 0;
      if (!dueAt || dueAt <= Date.now()) {
        const result = await safeSyncFacilities(database);
        console.log("FACILITY_SYNC " + (result?.ok ? "COMPLETE" : "FAILED"));
      }
      const refreshed = await facilitySource(database);
      delay = Math.max(60000, Math.min((refreshed?.syncIntervalHours || 24) * 3600000, 86400000));
    }
  } catch {
    // Do not print driver SQL, credentials, source response bodies or user rows.
    console.error("FACILITY_SYNC FAILED");
  } finally {
    if (!stopping) facilityTimer = setTimeout(() => { syncWork = scheduleFacilitySync(); }, delay);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(facilityTimer);
  // A bounded stop gives active HTTP requests and the current background job
  // a chance to finish before the pool closes. Docker's grace period is longer.
  const deadline = setTimeout(() => process.exit(1), 90000);
  deadline.unref();
  try {
    await new Promise((resolve, reject) => {
      if (!server) return resolve();
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    await imageRetirement?.stop();
    await accountContinuity?.stop();
    await syncWork;
    await database?.close();
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch {
    console.error("PRODUCTION_SHUTDOWN_FAILED");
    process.exitCode = 1;
  }
}

try {
  const { config, mysql } = productionConfiguration(process.env);
  const faqSelector = createBailianFaqSelector();
  database = createMysqlDatabase(mysql);
  const tables = await database.get("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
  if (Number(tables?.count) !== 42 ||
      !await database.get("SELECT id FROM ai_configuration WHERE id = 'default'") ||
      !await database.get("SELECT id FROM media_categories WHERE id = 'other'") ||
      !await database.get("SELECT a.user_id FROM admin_accounts a JOIN users u ON u.id = a.user_id WHERE a.is_active = 1 AND u.deleted_at IS NULL LIMIT 1")) {
    throw new Error("PRODUCTION_IMPORTED_DATA_REQUIRED");
  }
  for (const [directory, writable] of [[config.equipmentUploadDir, true], [config.mediaUploadDir, true], [config.mediaSeedDir, false]]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("PRODUCTION_MEDIA_DIRECTORY_REQUIRED");
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK | (writable ? fs.constants.W_OK : 0));
  }
  const app = await createMysqlApp({
    database, jwtSecret: config.jwtSecret, smsMode: config.smsMode,
    faqSelector,
    testSmsCodeEnabled: false, testSmsCode: config.testSmsCode, twilio: config.twilio,
    equipmentUploadDir: config.equipmentUploadDir, mediaUploadDir: config.mediaUploadDir,
    mediaSeedDir: config.mediaSeedDir,
    mediaVideoDeliveryRoot: process.env.MEDIA_VIDEO_DELIVERY_ROOT || null,
    mediaVideoDeliveryManifest: process.env.MEDIA_VIDEO_DELIVERY_MANIFEST || null,
    mediaVideoCdnOrigin: process.env.MEDIA_VIDEO_CDN_ORIGIN || "",
  });
  imageRetirement = app.locals.imageRetirement;
  accountContinuity = app.locals.accountContinuity;
  await accountContinuity.start();
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(config.port, "0.0.0.0", () => resolve(listening));
    listening.once("error", reject);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Only the listening production process retries committed image retirements.
  // Importing or staging a candidate application must never delete files.
  imageRetirement?.start();
  facilityTimer = setTimeout(() => { syncWork = scheduleFacilitySync(); }, 10000);
  console.log("PRODUCTION_API_LISTENING 3000");
} catch (error) {
  const code = error?.message === "MySQL application routes are not yet fully migrated"
    ? "MYSQL_APPLICATION_INCOMPLETE"
    : /^PRODUCTION_[A-Z_]+$/.test(error?.message || "") ? error.message : "PRODUCTION_START_FAILED";
  console.error(code);
  try { await imageRetirement?.stop();
    await accountContinuity?.stop(); } catch { /* Retain the startup error. */ }
  if (server?.listening) {
    try { await new Promise(resolve => server.close(resolve)); } catch { /* Retain the startup error. */ }
  }
  try { await database?.close(); } catch { /* Retain the startup error. */ }
  process.exitCode = 1;
}
