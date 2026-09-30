import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";
import { REGISTRATION_SCHEMA } from "./registrationCodes.js";
import { EDUCATION_VIDEO_IMPORT_SCHEMA } from "./educationVideoImport.js";
import { initializeEquipmentCategories } from "./equipmentCategories.js";
import { FEEDBACK_SCHEMA } from "./feedback.js";
import { applyTcmV24ContentUpdate } from "./tcmContentUpdate.js";
import { EQUIPMENT_DOCUMENT_IMPORT_SCHEMA } from "./equipmentDocumentImport.js";
import { LEARNING_PROGRESS_SCHEMA } from "./learningProgress.js";
import { APP_TEXT_SCHEMA } from "./appTexts.js";

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
	${EDUCATION_VIDEO_IMPORT_SCHEMA}
  ${APP_TEXT_SCHEMA}

	CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL
	);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    profile_role TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS research_events (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_time TEXT NOT NULL,
    app_version TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (participant_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS research_events_participant_time
    ON research_events(participant_id, event_time);

	CREATE TABLE IF NOT EXISTS guest_profiles (
		id TEXT PRIMARY KEY,
		age INTEGER NOT NULL CHECK (age BETWEEN 18 AND 120),
		gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'other')),
		purpose TEXT NOT NULL CHECK (purpose IN ('personal', 'family', 'industry')),
		created_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS guest_profiles_created
		ON guest_profiles(created_at DESC);

  CREATE TABLE IF NOT EXISTS sms_verifications (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sms_verifications_phone_created
    ON sms_verifications(phone, created_at DESC);

	CREATE TABLE IF NOT EXISTS push_tokens (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		expo_push_token TEXT NOT NULL UNIQUE,
		platform TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id, updated_at DESC);

	CREATE TABLE IF NOT EXISTS research_consents (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		consent_version TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn')),
		consented_at TEXT NOT NULL,
		withdrawn_at TEXT,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS research_consents_user_time
		ON research_consents(user_id, consented_at DESC);

	CREATE TABLE IF NOT EXISTS app_sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		started_at TEXT NOT NULL,
		ended_at TEXT,
		app_version TEXT,
		platform TEXT,
		device_pseudonym TEXT,
		metadata_json TEXT NOT NULL DEFAULT '{}',
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS app_sessions_user_started
		ON app_sessions(user_id, started_at DESC);

	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'support')),
		title TEXT,
		created_by TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
	);

	CREATE TABLE IF NOT EXISTS conversation_members (
		conversation_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner', 'moderator', 'member')),
		joined_at TEXT NOT NULL,
		last_read_at TEXT,
		left_at TEXT,
		PRIMARY KEY (conversation_id, user_id),
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS conversation_members_user
		ON conversation_members(user_id, joined_at DESC);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		sender_id TEXT NOT NULL,
		message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'system')),
		body TEXT,
		metadata_json TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		edited_at TEXT,
		deleted_at TEXT,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT
	);

	CREATE INDEX IF NOT EXISTS messages_conversation_time
		ON messages(conversation_id, created_at DESC);

	CREATE TABLE IF NOT EXISTS message_reactions (
		message_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		emoji TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (message_id, user_id, emoji),
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS message_reactions_message
		ON message_reactions(message_id);

	CREATE TABLE IF NOT EXISTS admin_accounts (
		user_id TEXT PRIMARY KEY,
		system_role TEXT NOT NULL CHECK (system_role IN ('super_admin', 'admin', 'operator')),
		permissions_json TEXT NOT NULL DEFAULT '[]',
		is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
		created_by TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
	);

	CREATE INDEX IF NOT EXISTS admin_accounts_role_active
		ON admin_accounts(system_role, is_active);

	CREATE TABLE IF NOT EXISTS system_logs (
		id TEXT PRIMARY KEY,
		actor_user_id TEXT,
		actor_role TEXT,
		action TEXT NOT NULL,
		target_type TEXT,
		target_id TEXT,
		created_at TEXT NOT NULL,
		ip_address TEXT,
		metadata_json TEXT NOT NULL DEFAULT '{}',
		FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
	);

	CREATE INDEX IF NOT EXISTS system_logs_created
		ON system_logs(created_at DESC);

	CREATE INDEX IF NOT EXISTS system_logs_actor
		ON system_logs(actor_user_id, created_at DESC);

	CREATE TABLE IF NOT EXISTS content_items (
		id TEXT PRIMARY KEY, page_key TEXT NOT NULL, content_type TEXT NOT NULL CHECK (content_type IN ('video','text','feature')),
		title TEXT NOT NULL, value TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
		created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS content_items_page ON content_items(page_key, is_active, sort_order);

	CREATE TABLE IF NOT EXISTS app_equipment_items (
		id TEXT PRIMARY KEY,
		is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
		name_zh TEXT NOT NULL DEFAULT '',
		name_en TEXT NOT NULL DEFAULT '',
		categories_json TEXT NOT NULL DEFAULT '[]',
		image_url TEXT NOT NULL DEFAULT '',
		gif_left_url TEXT NOT NULL DEFAULT '',
		gif_right_url TEXT NOT NULL DEFAULT '',
		youtube_key TEXT NOT NULL DEFAULT '',
		details_zh TEXT NOT NULL DEFAULT '',
		details_en TEXT NOT NULL DEFAULT '',
		kinesiology_zh TEXT NOT NULL DEFAULT '',
		kinesiology_en TEXT NOT NULL DEFAULT '',
		pt_tip_zh TEXT NOT NULL DEFAULT '',
		pt_tip_en TEXT NOT NULL DEFAULT '',
		ot_tip_zh TEXT NOT NULL DEFAULT '',
		ot_tip_en TEXT NOT NULL DEFAULT '',
		tcm_zh TEXT NOT NULL DEFAULT '',
		tcm_en TEXT NOT NULL DEFAULT '',
		tcm_enabled INTEGER CHECK (tcm_enabled IN (0, 1)),
		care_tip_zh TEXT NOT NULL DEFAULT '',
		care_tip_en TEXT NOT NULL DEFAULT '',
		sort_order INTEGER NOT NULL DEFAULT 0,
		is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
		created_by TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS app_equipment_items_active_sort ON app_equipment_items(is_active, sort_order);

	CREATE TABLE IF NOT EXISTS media_categories (
		id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS media_folders (
		id TEXT PRIMARY KEY, parent_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
		deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS media_folder_active_name ON media_folders(parent_id,name) WHERE deleted_at IS NULL;
	CREATE TABLE IF NOT EXISTS media_seed_items (
		import_id TEXT NOT NULL, file_name TEXT NOT NULL, file_id TEXT NOT NULL,
		created_at TEXT NOT NULL, PRIMARY KEY(import_id,file_name)
	);
	CREATE TABLE IF NOT EXISTS media_seed_folders (
		import_id TEXT NOT NULL, folder_path TEXT NOT NULL, folder_id TEXT NOT NULL,
		PRIMARY KEY(import_id,folder_path)
	);
	CREATE TABLE IF NOT EXISTS media_files (
		id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
		mime_type TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file')),
		size_bytes INTEGER, category_id TEXT NOT NULL,
		source TEXT NOT NULL CHECK (source IN ('upload', 'legacy', 'external', 'youtube')),
		storage_name TEXT, sha256 TEXT, archived INTEGER NOT NULL DEFAULT 0,
		created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		folder_id TEXT NOT NULL DEFAULT '', deleted_at TEXT,
		FOREIGN KEY (category_id) REFERENCES media_categories(id),
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS media_files_category_kind ON media_files(category_id, kind, archived, created_at);

	CREATE TABLE IF NOT EXISTS equipment_locations (
		id TEXT PRIMARY KEY,
		equipment_id TEXT NOT NULL,
		region_zh TEXT NOT NULL DEFAULT '',
		region_en TEXT NOT NULL DEFAULT '',
		latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
		longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
		sort_order INTEGER NOT NULL DEFAULT 0,
		is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
		created_by TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS equipment_locations_equipment_active_sort
		ON equipment_locations(equipment_id, is_active, sort_order, created_at);

	CREATE TABLE IF NOT EXISTS exercise_sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		completed_at TEXT NOT NULL,
		duration_sec INTEGER NOT NULL DEFAULT 0,
		mode TEXT NOT NULL CHECK (mode IN ('outdoor', 'home')),
		emotion INTEGER,
		rpe INTEGER,
		journal TEXT NOT NULL DEFAULT '',
		exercises_json TEXT NOT NULL DEFAULT '[]',
		types_json TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS exercise_sessions_user_date ON exercise_sessions(user_id, completed_at DESC);

	CREATE TABLE IF NOT EXISTS exercise_session_revisions (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		version_number INTEGER NOT NULL,
		snapshot_json TEXT NOT NULL,
		changed_fields_json TEXT NOT NULL DEFAULT '[]',
		changed_at TEXT NOT NULL,
		FOREIGN KEY (session_id) REFERENCES exercise_sessions(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		UNIQUE (session_id, version_number)
	);
	CREATE INDEX IF NOT EXISTS exercise_session_revisions_session
		ON exercise_session_revisions(session_id, version_number DESC);

	CREATE TABLE IF NOT EXISTS volunteer_participants (
		volunteer_user_id TEXT NOT NULL,
		participant_user_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (volunteer_user_id, participant_user_id),
		FOREIGN KEY (volunteer_user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (participant_user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS volunteer_participants_participant
		ON volunteer_participants(participant_user_id, created_at DESC);

	CREATE TABLE IF NOT EXISTS ai_configuration (
		id TEXT PRIMARY KEY,
		is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
		provider TEXT NOT NULL DEFAULT 'openai_compatible',
		base_url TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT '',
		api_key TEXT NOT NULL DEFAULT '',
		updated_by TEXT,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS facility_sources (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		primary_url TEXT NOT NULL,
		fallback_url TEXT NOT NULL DEFAULT '',
		portal_url TEXT NOT NULL DEFAULT '',
		sync_interval_hours INTEGER NOT NULL DEFAULT 24,
		is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
		last_attempt_at TEXT,
		last_success_at TEXT,
		last_error TEXT,
		last_record_count INTEGER NOT NULL DEFAULT 0,
		last_used_url TEXT,
		updated_by TEXT,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS facilities (
		source_id TEXT PRIMARY KEY,
		source_name TEXT NOT NULL DEFAULT 'lcsd',
		gml_id TEXT,
		name_en TEXT NOT NULL DEFAULT '',
		name_zh TEXT NOT NULL DEFAULT '',
		address_en TEXT NOT NULL DEFAULT '',
		address_zh TEXT NOT NULL DEFAULT '',
		district_en TEXT NOT NULL DEFAULT '',
		district_zh TEXT NOT NULL DEFAULT '',
		phone TEXT NOT NULL DEFAULT '',
		facility_type TEXT NOT NULL DEFAULT '',
		latitude REAL NOT NULL,
		longitude REAL NOT NULL,
		photos_json TEXT NOT NULL DEFAULT '[]',
		source_json TEXT NOT NULL DEFAULT '{}',
		is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
		synced_at TEXT NOT NULL,
		updated_at TEXT
	);
	CREATE INDEX IF NOT EXISTS facilities_active_district ON facilities(is_active, district_zh);
	CREATE INDEX IF NOT EXISTS facilities_name_zh ON facilities(name_zh);

	CREATE TABLE IF NOT EXISTS facility_sync_runs (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
		triggered_by TEXT,
		used_url TEXT,
		record_count INTEGER NOT NULL DEFAULT 0,
		error_message TEXT,
		details_json TEXT NOT NULL DEFAULT '{}',
		started_at TEXT NOT NULL,
		finished_at TEXT,
		FOREIGN KEY (source_id) REFERENCES facility_sources(id) ON DELETE CASCADE,
		FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS facility_sync_runs_started ON facility_sync_runs(started_at DESC);
`;

export function createDatabase(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 5000");
  database.exec(SCHEMA);
  database.exec(REGISTRATION_SCHEMA);
  database.exec(EQUIPMENT_DOCUMENT_IMPORT_SCHEMA);
	database.prepare(`
		INSERT OR IGNORE INTO schema_migrations (version, applied_at)
		VALUES (?, ?)
	`).run(1, new Date().toISOString());
	database.prepare(`
		INSERT OR IGNORE INTO schema_migrations (version, applied_at)
		VALUES (?, ?)
	`).run(2, new Date().toISOString());
	database.prepare(`
		INSERT OR IGNORE INTO schema_migrations (version, applied_at)
		VALUES (?, ?)
	`).run(3, new Date().toISOString());
	const userColumns = database.prepare("PRAGMA table_info(users)").all();
	if (!userColumns.some((column) => column.name === "deleted_at")) {
		database.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
	}
	if (!userColumns.some((column) => column.name === "last_seen_at")) database.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT");
	if (!userColumns.some((column) => column.name === "avatar_data")) database.exec("ALTER TABLE users ADD COLUMN avatar_data TEXT");
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(4, new Date().toISOString());
	const conversationColumns = database.prepare("PRAGMA table_info(conversations)").all();
	if (!conversationColumns.some((column) => column.name === "deleted_at")) database.exec("ALTER TABLE conversations ADD COLUMN deleted_at TEXT");
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(5, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(6, new Date().toISOString());
	const facilitySourceNow = new Date().toISOString();
	database.prepare(`
		INSERT OR IGNORE INTO facility_sources
			(id, name, primary_url, fallback_url, portal_url, sync_interval_hours, is_active, updated_at)
		VALUES (?, ?, ?, ?, ?, 24, 1, ?)
	`).run(
		"lcsd-outdoor-fitness",
		"康乐及文化事务署户外健身设施",
		"https://portal.csdi.gov.hk/server/services/common/lcsd_rcd_1670389505454_91091/MapServer/WFSServer?service=WFS&version=2.0.0&request=GetFeature&typeNames=csdi%3Ageotagging&outputFormat=GeoJSON&srsName=EPSG%3A4326&count=1000&resultType=results&startIndex=0",
		"https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1670389505454_91091/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson",
		"https://portal.csdi.gov.hk/csdi-webpage/dataset/lcsd_rcd_1670389505454_91091",
		facilitySourceNow,
	);
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(7, facilitySourceNow);
	const memberColumns = database.prepare("PRAGMA table_info(conversation_members)").all();
	if (!memberColumns.some((column) => column.name === "left_at")) database.exec("ALTER TABLE conversation_members ADD COLUMN left_at TEXT");
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(8, new Date().toISOString());
	database.exec(`
		UPDATE users
		SET name = '已删除用户（' || COALESCE((
			SELECT json_extract(log.metadata_json, '$.before.name')
			FROM system_logs log
			WHERE log.action = 'user.delete' AND log.target_id = users.id
			ORDER BY log.created_at DESC LIMIT 1
		), '原姓名未记录') || '）'
		WHERE deleted_at IS NOT NULL AND name = '已删除用户'
	`);
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(9, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(10, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(11, new Date().toISOString());
	const equipmentColumns = database.prepare("PRAGMA table_info(app_equipment_items)").all();
	if (!equipmentColumns.some((column) => column.name === "deleted_at")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN deleted_at TEXT");
	if (!equipmentColumns.some((column) => column.name === "tcm_zh")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN tcm_zh TEXT NOT NULL DEFAULT ''");
	if (!equipmentColumns.some((column) => column.name === "tcm_en")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN tcm_en TEXT NOT NULL DEFAULT ''");
	if (!equipmentColumns.some((column) => column.name === "tcm_enabled")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN tcm_enabled INTEGER CHECK (tcm_enabled IN (0, 1))");
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(12, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(13, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(14, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(15, new Date().toISOString());
	const volunteerMigrationAt = new Date().toISOString();
	database.exec(`UPDATE users SET profile_role = 'volunteer' WHERE profile_role = 'caregiver'`);
	database.prepare(`INSERT OR IGNORE INTO ai_configuration (id, updated_at) VALUES ('default', ?)`).run(volunteerMigrationAt);
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(16, volunteerMigrationAt);
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(17, new Date().toISOString());
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(18, new Date().toISOString());
	const equipmentSeededAt = new Date().toISOString();
	const seedEquipment = database.prepare(`
		INSERT OR IGNORE INTO app_equipment_items
			(id, is_custom, name_zh, name_en, categories_json, sort_order, is_active, created_at, updated_at)
		VALUES (?, 0, ?, ?, ?, ?, 1, ?, ?)
	`);
	const seedBuiltInEquipment = database.transaction(() => {
		BUILT_IN_EQUIPMENT_CATALOG.forEach((item, index) => seedEquipment.run(
			item.id,
			item.nameZh,
			item.nameEn,
			JSON.stringify(item.categories),
			index,
			equipmentSeededAt,
			equipmentSeededAt,
		));
	});
	seedBuiltInEquipment();
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(19, equipmentSeededAt);
	const latestEquipmentColumns = database.prepare("PRAGMA table_info(app_equipment_items)").all();
	if (!latestEquipmentColumns.some((column) => column.name === "gif_left_url")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN gif_left_url TEXT NOT NULL DEFAULT ''");
	if (!latestEquipmentColumns.some((column) => column.name === "gif_right_url")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN gif_right_url TEXT NOT NULL DEFAULT ''");
	if (!latestEquipmentColumns.some((column) => column.name === "video_url")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN video_url TEXT NOT NULL DEFAULT ''");
	if (!latestEquipmentColumns.some((column) => column.name === "video_url_zh")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN video_url_zh TEXT NOT NULL DEFAULT ''");
	if (!latestEquipmentColumns.some((column) => column.name === "video_url_en")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN video_url_en TEXT NOT NULL DEFAULT ''");
	if (!latestEquipmentColumns.some((column) => column.name === "video_localized")) database.exec("ALTER TABLE app_equipment_items ADD COLUMN video_localized INTEGER NOT NULL DEFAULT 0 CHECK (video_localized IN (0,1))");
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(20, new Date().toISOString());
	const mediaCreatedAt = new Date().toISOString();
	// Preserve existing immutable URLs, metadata and references when upgrading
	// the old image/video CHECK constraint to support private attachments.
	if (!database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_files'").get().sql.includes("'file'")) {
		database.transaction(() => {
			database.exec(`CREATE TABLE media_files_upgrade (
				id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
				mime_type TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('image','video','file')),
				size_bytes INTEGER, category_id TEXT NOT NULL,
				source TEXT NOT NULL CHECK (source IN ('upload','legacy','external','youtube')),
				storage_name TEXT, sha256 TEXT, archived INTEGER NOT NULL DEFAULT 0,
				created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
				folder_id TEXT NOT NULL DEFAULT '', deleted_at TEXT,
				FOREIGN KEY(category_id) REFERENCES media_categories(id),
				FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
			);
			INSERT INTO media_files_upgrade (id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_by,created_at,updated_at)
			SELECT id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,archived,created_by,created_at,updated_at FROM media_files;
			DROP TABLE media_files;
			ALTER TABLE media_files_upgrade RENAME TO media_files;`);
		})();
	}
	const mediaColumns = database.prepare("PRAGMA table_info(media_files)").all();
	if (!mediaColumns.some(column => column.name === "folder_id")) database.exec("ALTER TABLE media_files ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''");
	if (!mediaColumns.some(column => column.name === "deleted_at")) database.exec("ALTER TABLE media_files ADD COLUMN deleted_at TEXT");
	database.exec("CREATE INDEX IF NOT EXISTS media_files_category_kind ON media_files(category_id,kind,archived,created_at); CREATE INDEX IF NOT EXISTS media_files_folder ON media_files(folder_id,deleted_at,name)");
	for (const [id, name] of [["facilities-images", "设施图片"], ["facilities-gifs", "设施 GIF"], ["videos", "教学视频"], ["other", "其他公开资源"]]) {
		database.prepare("INSERT OR IGNORE INTO media_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)").run(id,name,mediaCreatedAt,mediaCreatedAt);
	}
	database.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(21, mediaCreatedAt);
	database.exec(`
    UPDATE users SET phone = '+852' || phone
      WHERE length(phone) = 8 AND phone NOT LIKE '+%';
    UPDATE sms_verifications SET phone = '+852' || phone
      WHERE length(phone) = 8 AND phone NOT LIKE '+%';
  `);
  initializeEquipmentCategories(database);
  database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(22, new Date().toISOString());
  database.transaction(() => {
    database.exec(FEEDBACK_SCHEMA);
    database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(23, new Date().toISOString());
  })();
  applyTcmV24ContentUpdate(database);
  database.exec(LEARNING_PROGRESS_SCHEMA);
  return database;
}
