import { EDUCATION_VIDEO_CODES, equipmentIdForVideoCode } from './educationVideoCodes.js';

export const EDUCATION_VIDEO_IMPORT_ID = 'education-videos-20260910';
export const EDUCATION_VIDEO_IMPORT_SCHEMA = `CREATE TABLE IF NOT EXISTS media_seed_video_bindings (
	import_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, bindings_json TEXT NOT NULL, before_json TEXT NOT NULL
);`;

// Only this reviewed deployment batch changes existing video references. Files
// and old links remain available, and later administrator edits are never reset.
export function applyEducationVideoSeed(database, report) {
	if (report?.importId !== EDUCATION_VIDEO_IMPORT_ID) return null;
	const previous = database.prepare('SELECT applied_at FROM media_seed_video_bindings WHERE import_id=?').get(report.importId);
	if (previous) return { status: 'already_applied', appliedAt: previous.applied_at };
	if (!report.complete) throw new Error('Education video import incomplete; existing facility videos were not changed');
	const availableCodes = EDUCATION_VIDEO_CODES.filter((code) => !['13', '27'].includes(code));
	const expected = new Set(availableCodes.flatMap((code) => ['zh', 'en'].map((locale) => `${equipmentIdForVideoCode(code)}:${locale}`)));
	const bindings = report.items.filter((item) => item.equipmentId != null);
	for (const item of bindings) {
		const key = `${item.equipmentId}:${item.locale}`;
		const code = String(item.name).match(/^(\d+[a-d]?)(?:\s*\((?:Chi|ENG)\))?\s*\.mp4$/i)?.[1].toLowerCase();
		if (!expected.delete(key) || equipmentIdForVideoCode(code) !== item.equipmentId || item.kind !== 'video' || item.archived || item.deleted) throw new Error('Education video identity or availability mismatch');
		const file = database.prepare('SELECT * FROM media_files WHERE id=?').get(item.id);
		if (!file || file.url !== item.url || file.sha256 !== item.sha256 || file.kind !== 'video' || file.archived || file.deleted_at) throw new Error('Education video storage verification failed');
	}
	if (expected.size || bindings.length !== 54) throw new Error('Expected 27 matched Chinese and English video pairs');
	return database.transaction(() => {
		const before = [], skipped = [], now = new Date().toISOString();
		for (const code of availableCodes) {
			const id = equipmentIdForVideoCode(code), equipment = database.prepare('SELECT * FROM app_equipment_items WHERE id=?').get(id);
			// Never resurrect a deleted facility or overwrite a custom row identity.
			if (!equipment || equipment.is_custom || equipment.deleted_at) { skipped.push(id); continue; }
			const zh = bindings.find((item) => item.equipmentId === id && item.locale === 'zh');
			const en = bindings.find((item) => item.equipmentId === id && item.locale === 'en');
			before.push({ id, videoUrl: equipment.video_url, videoUrlZh: equipment.video_url_zh, videoUrlEn: equipment.video_url_en, videoLocalized: equipment.video_localized, youtubeKey: equipment.youtube_key });
			database.prepare('UPDATE app_equipment_items SET video_url_zh=?,video_url_en=?,video_localized=1,updated_at=? WHERE id=?').run(zh.url,en.url,now,id);
		}
		database.prepare('INSERT INTO media_seed_video_bindings(import_id,applied_at,bindings_json,before_json) VALUES(?,?,?,?)').run(report.importId,now,JSON.stringify(bindings),JSON.stringify(before));
		return { status: 'applied', facilities: before.length, videos: before.length * 2, skipped, missingCodesPreserved: ['13', '27'] };
	}).immediate();
}
