import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { facilitySource, safeSyncFacilities } from "./facilities.js";
import { createBailianFaqSelector } from "./assistantBailian.js";

const config = readConfig();
const database = createDatabase(config.databasePath);
const app = createApp({
  database,
  faqSelector: createBailianFaqSelector(),
  jwtSecret: config.jwtSecret,
  smsMode: config.smsMode,
	testSmsCodeEnabled: config.testSmsCodeEnabled,
	testSmsCode: config.testSmsCode,
  twilio: config.twilio,
	equipmentUploadDir: config.equipmentUploadDir,
	mediaUploadDir: config.mediaUploadDir,
	mediaSeedDir: config.mediaSeedDir,
});

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`OUTDOOR-FIT API listening on http://127.0.0.1:${config.port}`);
});

let facilityTimer = null;
async function scheduleFacilitySync() {
	const source = facilitySource(database);
	if (!source?.isActive) return;
	const dueAt = source.lastSuccessAt
		? Date.parse(source.lastSuccessAt) + source.syncIntervalHours * 60 * 60 * 1000
		: 0;
	if (!dueAt || dueAt <= Date.now()) {
		const result = await safeSyncFacilities(database);
		console.log("Facility data sync", result);
	}
	const refreshed = facilitySource(database);
	const delay = Math.max(60_000, Math.min((refreshed?.syncIntervalHours || 24) * 60 * 60 * 1000, 24 * 60 * 60 * 1000));
	facilityTimer = setTimeout(scheduleFacilitySync, delay);
}

facilityTimer = setTimeout(scheduleFacilitySync, 10_000);

function shutdown() {
	if (facilityTimer) clearTimeout(facilityTimer);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
