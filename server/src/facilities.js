import crypto from "node:crypto";

const DEFAULT_WFS_URL = "https://portal.csdi.gov.hk/server/services/common/lcsd_rcd_1670389505454_91091/MapServer/WFSServer?service=WFS&version=2.0.0&request=GetFeature&typeNames=csdi%3Ageotagging&outputFormat=GeoJSON&srsName=EPSG%3A4326&count=1000&resultType=results&startIndex=0";
const DEFAULT_FEATURE_URL = "https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1670389505454_91091/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
const DEFAULT_PORTAL_URL = "https://portal.csdi.gov.hk/csdi-webpage/dataset/lcsd_rcd_1670389505454_91091";

export const DEFAULT_FACILITY_SOURCE = {
	id: "lcsd-outdoor-fitness",
	name: "康樂及文化事務署戶外健身設施",
	primaryUrl: DEFAULT_WFS_URL,
	fallbackUrl: DEFAULT_FEATURE_URL,
	portalUrl: DEFAULT_PORTAL_URL,
	syncIntervalHours: 24,
	isActive: true,
};

export function isSafeFacilitySourceUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return url.protocol === "https:" && !url.username && !url.password && url.hostname !== "localhost";
	} catch {
		return false;
	}
}

export function facilitySource(database) {
	const row = database.prepare("SELECT * FROM facility_sources WHERE id = ?").get(DEFAULT_FACILITY_SOURCE.id);
	return row ? {
		id: row.id,
		name: row.name,
		primaryUrl: row.primary_url,
		fallbackUrl: row.fallback_url,
		portalUrl: row.portal_url,
		syncIntervalHours: row.sync_interval_hours,
		isActive: Boolean(row.is_active),
		lastAttemptAt: row.last_attempt_at,
		lastSuccessAt: row.last_success_at,
		lastError: row.last_error || "",
		lastRecordCount: row.last_record_count || 0,
		lastUsedUrl: row.last_used_url || "",
		updatedAt: row.updated_at,
	} : null;
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
	const response = await fetch(url, {
		headers: { accept: "application/geo+json, application/json" },
		signal: AbortSignal.timeout(45_000),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const payload = await response.json();
	if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
		throw new Error("Response is not a GeoJSON FeatureCollection");
	}
	const facilities = payload.features.map(normalizedFacility).filter(Boolean);
	if (!facilities.length) throw new Error("No valid facility records returned");
	return facilities;
}

export async function syncFacilities(database, { triggeredBy = null } = {}) {
	const source = facilitySource(database);
	if (!source) throw new Error("Facility source is not configured");
	const startedAt = new Date().toISOString();
	const runId = crypto.randomUUID();
	database.prepare(`INSERT INTO facility_sync_runs (id, source_id, status, triggered_by, started_at) VALUES (?, ?, 'running', ?, ?)`)
		.run(runId, source.id, triggeredBy, startedAt);
	database.prepare("UPDATE facility_sources SET last_attempt_at = ?, last_error = NULL WHERE id = ?").run(startedAt, source.id);

	let facilities;
	let usedUrl = "";
	let primaryError = "";
	try {
		usedUrl = source.primaryUrl;
		facilities = await fetchGeoJson(source.primaryUrl);
	} catch (error) {
		primaryError = String(error?.message || error);
		if (!source.fallbackUrl) throw error;
		usedUrl = source.fallbackUrl;
		facilities = await fetchGeoJson(source.fallbackUrl);
	}

	const syncedAt = new Date().toISOString();
	const upsert = database.prepare(`
		INSERT INTO facilities (
			source_id, gml_id, name_en, name_zh, address_en, address_zh, district_en, district_zh,
			phone, facility_type, latitude, longitude, photos_json, source_json, is_active, synced_at
		) VALUES (
			@sourceId, @gmlId, @nameEn, @nameZh, @addressEn, @addressZh, @districtEn, @districtZh,
			@phone, @facilityType, @latitude, @longitude, @photosJson, @sourceJson, 1, @syncedAt
		)
		ON CONFLICT(source_id) DO UPDATE SET
			gml_id=excluded.gml_id, name_en=excluded.name_en, name_zh=excluded.name_zh,
			address_en=excluded.address_en, address_zh=excluded.address_zh,
			district_en=excluded.district_en, district_zh=excluded.district_zh,
			phone=excluded.phone, facility_type=excluded.facility_type,
			latitude=excluded.latitude, longitude=excluded.longitude,
			photos_json=excluded.photos_json, source_json=excluded.source_json,
			is_active=1, synced_at=excluded.synced_at
	`);
	const save = database.transaction((items) => {
		database.prepare("UPDATE facilities SET is_active = 0 WHERE source_name = 'lcsd'").run();
		for (const item of items) upsert.run({ ...item, syncedAt });
	});
	save(facilities);
	database.prepare(`
		UPDATE facility_sources SET last_success_at=?, last_error=NULL, last_record_count=?, last_used_url=? WHERE id=?
	`).run(syncedAt, facilities.length, usedUrl, source.id);
	database.prepare(`
		UPDATE facility_sync_runs SET status='success', used_url=?, record_count=?, finished_at=?, details_json=? WHERE id=?
	`).run(usedUrl, facilities.length, syncedAt, JSON.stringify({ primaryError }), runId);
	return { ok: true, recordCount: facilities.length, usedUrl, primaryError, syncedAt };
}

export async function safeSyncFacilities(database, options = {}) {
	try {
		return await syncFacilities(database, options);
	} catch (error) {
		const message = String(error?.message || error).slice(0, 1000);
		const finishedAt = new Date().toISOString();
		database.prepare("UPDATE facility_sources SET last_error=? WHERE id=?").run(message, DEFAULT_FACILITY_SOURCE.id);
		database.prepare(`
			UPDATE facility_sync_runs SET status='failed', error_message=?, finished_at=?
			WHERE id=(SELECT id FROM facility_sync_runs WHERE status='running' ORDER BY started_at DESC LIMIT 1)
		`).run(message, finishedAt);
		return { ok: false, error: message, syncedAt: finishedAt };
	}
}
