import crypto from "node:crypto";
import { DEFAULT_FACILITY_SOURCE, isSafeFacilitySourceUrl } from "./facilities.js";
import { revalidateAdmin } from "./adminAuthorization.js";
export { DEFAULT_FACILITY_SOURCE, isSafeFacilitySourceUrl } from "./facilities.js";

const enabled = value => [1, "1", 1n].includes(value);
function fail(code) { return Object.assign(new Error(code), { code }); }
function write(result, multiple = false) {
  if (result?.warningStatus !== 0 || !Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0 || (!multiple && result.affectedRows !== 1)) throw fail("FACILITY_WRITE_FAILED");
}
function publicSource(row) {
  if (!row) return null;
  const syncIntervalHours = Number(row.sync_interval_hours), lastRecordCount = Number(row.last_record_count || 0);
  if (!Number.isSafeInteger(syncIntervalHours) || syncIntervalHours < 1 || !Number.isSafeInteger(lastRecordCount) || lastRecordCount < 0) throw fail("FACILITY_SOURCE_INVALID");
  return { id: row.id, name: row.name, primaryUrl: row.primary_url, fallbackUrl: row.fallback_url, portalUrl: row.portal_url,
    syncIntervalHours, isActive: enabled(row.is_active), lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    lastError: row.last_error || "", lastRecordCount, lastUsedUrl: row.last_used_url || "", updatedAt: row.updated_at };
}
export async function facilitySource(database) {
  return publicSource(await database.get("SELECT * FROM facility_sources WHERE id=?", [DEFAULT_FACILITY_SOURCE.id]));
}
function safeError(error) {
  if (error?.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN") return "FACILITY_COMMIT_OUTCOME_UNKNOWN";
  return /^FACILITY_[A-Z0-9_]+$/.test(error?.code || "") ? error.code : "FACILITY_SYNC_FAILED";
}
async function authorize(database, triggeredBy, request) {
  if (triggeredBy == null) return; // Existing scheduled background sync.
  if (!request || request.admin?.user?.id !== triggeredBy) throw fail("FACILITY_ACTOR_REQUIRED");
  await revalidateAdmin(database, request, "facilities.manage");
}
function unchanged(source, context) {
  return source && source.last_attempt_at === context.startedAt && source.updated_at === context.source.updated_at
    && source.primary_url === context.source.primary_url && source.fallback_url === context.source.fallback_url
    && enabled(source.is_active) === enabled(context.source.is_active);
}

function normalizedFacility(feature) {
	const properties = feature?.properties || {};
	const coordinates = feature?.geometry?.coordinates || [];
	const longitude = Number(properties.Longitude_dec || coordinates[0]);
	const latitude = Number(properties.Latitude_dec || coordinates[1]);
	const sourceId = String(properties.OBJECTID ?? properties.GmlID ?? feature?.id ?? "").trim();
	if (!sourceId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	if (latitude < 22 || latitude > 23 || longitude < 113 || longitude > 115) return null;
	const photos = [properties.Photo_1, properties.Photo_2, properties.Photo_3, properties.Photo_4]
		.map((item) => String(item || "").trim()).filter(Boolean);
	return {
		sourceId,
		gmlId: String(properties.GmlID || ""),
		nameEn: String(properties.Name_en || "").trim(),
		nameZh: String(properties.Name_tc || properties.Name_cn || "").trim(),
		addressEn: String(properties.Address_en || "").trim(),
		addressZh: String(properties.Address_tc || properties.Address_cn || "").trim(),
		districtEn: String(properties.District_en || "").trim(),
		districtZh: String(properties.District_tc || properties.District_cn || "").trim(),
		phone: String(properties.Phone || properties.Enquiry_no || "").trim(),
		facilityType: String(properties.Types || "").trim(),
		latitude,
		longitude,
		photosJson: JSON.stringify(photos),
		sourceJson: JSON.stringify(properties),
	};
}

async function fetchGeoJson(url) {
  if (!isSafeFacilitySourceUrl(url)) throw fail("FACILITY_URL_INVALID");
  const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw fail(`FACILITY_HTTP_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw fail("FACILITY_RESPONSE_EMPTY");
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); throw fail("FACILITY_RESPONSE_TOO_LARGE"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw fail("FACILITY_INVALID_GEOJSON"); }
  if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) throw fail("FACILITY_INVALID_GEOJSON");
  const facilities = payload.features.map(normalizedFacility).filter(Boolean);
  if (!facilities.length) throw fail("FACILITY_RECORDS_EMPTY");
  if (new Set(facilities.map(item => item.sourceId)).size !== facilities.length) throw fail("FACILITY_DUPLICATE_SOURCE_ID");
  return facilities;
}

async function recordFailure(database, context, error) {
  // Never rewrite a possibly committed success as a failure after a lost COMMIT
  // reply. Such outcomes must be reconciled explicitly rather than retried.
  if (error?.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN") return;
  await database.transaction(async () => {
    const source = await database.get("SELECT * FROM facility_sources WHERE id=? FOR UPDATE", [context.source.id]);
    const run = await database.get("SELECT status FROM facility_sync_runs WHERE id=? FOR UPDATE", [context.runId]);
    if (!run || run.status !== "running") return;
    const message = safeError(error), finishedAt = new Date().toISOString();
    write(await database.run("UPDATE facility_sync_runs SET status='failed',error_message=?,finished_at=? WHERE id=? AND status='running'", [message, finishedAt, context.runId]));
    if (unchanged(source, context)) write(await database.run("UPDATE facility_sources SET last_error=? WHERE id=?", [message, context.source.id]));
  });
}

export async function syncFacilities(database, { triggeredBy = null, request = null } = {}) {
  const context = await database.transaction(async () => {
    await authorize(database, triggeredBy, request);
    const source = await database.get("SELECT * FROM facility_sources WHERE id=? FOR UPDATE", [DEFAULT_FACILITY_SOURCE.id]);
    if (!source) throw fail("FACILITY_SOURCE_MISSING");
    publicSource(source);
    // A monotonic attempt marker distinguishes starts in the same millisecond.
    // A slower older fetch must not overwrite the data from a newer attempt.
    const previousAttempt = Date.parse(source.last_attempt_at || "") || 0;
    const startedAt = new Date(Math.max(Date.now(), previousAttempt + 1)).toISOString(), runId = crypto.randomUUID();
    write(await database.run("INSERT INTO facility_sync_runs(id,source_id,status,triggered_by,started_at) VALUES(?,?,'running',?,?)", [runId, source.id, triggeredBy, startedAt]));
    write(await database.run("UPDATE facility_sources SET last_attempt_at=?,last_error=NULL WHERE id=?", [startedAt, source.id]));
    return { source, runId, startedAt };
  });
  try {
    let facilities, usedUrl = context.source.primary_url, primaryError = "";
    try { facilities = await fetchGeoJson(usedUrl); }
    catch (error) {
      primaryError = safeError(error);
      if (!context.source.fallback_url) throw error;
      usedUrl = context.source.fallback_url;
      facilities = await fetchGeoJson(usedUrl);
    }
    return await database.transaction(async () => {
      await authorize(database, triggeredBy, request);
      const source = await database.get("SELECT * FROM facility_sources WHERE id=? FOR UPDATE", [context.source.id]);
      if (!unchanged(source, context)) throw fail("FACILITY_SYNC_SUPERSEDED");
      const existing = new Map((await database.all("SELECT source_id,__mysql_row_id FROM facilities WHERE source_name=? ORDER BY __mysql_row_id FOR UPDATE", ["lcsd"])).map(row => [row.source_id, row.__mysql_row_id]));
      const syncedAt = new Date().toISOString();
      write(await database.run("UPDATE facilities SET is_active=0 WHERE source_name=?", ["lcsd"]), true);
      for (const item of [...facilities].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)) {
        const values = [item.gmlId, item.nameEn, item.nameZh, item.addressEn, item.addressZh, item.districtEn, item.districtZh,
          item.phone, item.facilityType, item.latitude, item.longitude, item.photosJson, item.sourceJson, syncedAt];
        if (existing.has(item.sourceId)) {
          write(await database.run(`UPDATE facilities SET gml_id=?,name_en=?,name_zh=?,address_en=?,address_zh=?,district_en=?,district_zh=?,
            phone=?,facility_type=?,latitude=?,longitude=?,photos_json=?,source_json=?,is_active=1,synced_at=? WHERE __mysql_row_id=? AND source_id=?`, [...values, existing.get(item.sourceId), item.sourceId]));
        } else {
          write(await database.run(`INSERT INTO facilities(source_id,source_name,gml_id,name_en,name_zh,address_en,address_zh,district_en,district_zh,
            phone,facility_type,latitude,longitude,photos_json,source_json,is_active,synced_at) VALUES(${Array(17).fill("?").join(",")})`, [item.sourceId, "lcsd", ...values.slice(0, -1), 1, syncedAt]));
        }
      }
      write(await database.run("UPDATE facility_sources SET last_success_at=?,last_error=NULL,last_record_count=?,last_used_url=? WHERE id=?", [syncedAt, facilities.length, usedUrl, source.id]));
      write(await database.run("UPDATE facility_sync_runs SET status='success',used_url=?,record_count=?,finished_at=?,details_json=? WHERE id=? AND status='running'", [usedUrl, facilities.length, syncedAt, JSON.stringify({ primaryError }), context.runId]));
      return { ok: true, recordCount: facilities.length, usedUrl, primaryError, syncedAt };
    });
  } catch (error) {
    try { await recordFailure(database, context, error); }
    catch { /* Preserve the original fixed failure; no unrelated run is changed. */ }
    throw error;
  }
}

export async function safeSyncFacilities(database, options = {}) {
  try { return await syncFacilities(database, options); }
  catch (error) {
    if (error?.authorizationError) throw error;
    return { ok: false, error: safeError(error), syncedAt: new Date().toISOString() };
  }
}
