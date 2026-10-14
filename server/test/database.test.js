import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/database.js";

test("creates the complete application database schema", () => {
	const database = createDatabase(":memory:");
	const tables = database.prepare(`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
		ORDER BY name
	`).all().map((row) => row.name);

	assert.deepEqual(tables, [
		"admin_accounts",
		"ai_configuration",
		"app_equipment_items",
		"app_sessions",
		"app_text_overrides",
		"content_items",
		"conversation_members",
		"conversations",
		"equipment_categories",
		"equipment_document_commits",
		"equipment_document_previews",
		"equipment_locations",
		"equipment_tcm_content_updates",
		"exercise_session_revisions",
		"exercise_sessions",
		"facilities",
		"facility_learning_progress",
		"facility_sources",
		"facility_sync_runs",
		"feedback",
		"guest_profiles",
		"media_categories",
		"media_files",
		"media_folders",
		"media_seed_folders",
		"media_seed_items",
		"media_seed_video_bindings",
		"message_reactions",
		"messages",
		"push_tokens",
		"registration_codes",
		"research_consents",
		"research_events",
		"schema_migrations",
		"sms_verifications",
		"system_logs",
		"test_user_batches",
		"users",
		"volunteer_participants",
	]);
	assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
	assert.equal(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 23);
	assert.equal(database.prepare("SELECT COUNT(*) AS count FROM app_equipment_items WHERE is_custom = 0").get().count, 29);
	assert.deepEqual(
		database.prepare("SELECT name_zh AS nameZh, name_en AS nameEn, categories_json AS categoriesJson FROM app_equipment_items WHERE id = '10'").get(),
		{ nameZh: "小腿伸展", nameEn: "Calf Stretch", categoriesJson: '["mobility","lower"]' },
	);
	assert.ok(database.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "avatar_data"));
	const equipmentColumns = database.prepare("PRAGMA table_info(app_equipment_items)").all().map((column) => column.name);
	assert.ok(equipmentColumns.includes("tcm_zh"));
	assert.ok(equipmentColumns.includes("tcm_en"));
	assert.ok(equipmentColumns.includes("tcm_enabled"));
	assert.ok(equipmentColumns.includes("gif_left_url"));
	assert.ok(equipmentColumns.includes("gif_right_url"));
	assert.ok(equipmentColumns.includes("video_url"));
	assert.ok(equipmentColumns.includes("video_url_zh"));
	assert.ok(equipmentColumns.includes("video_url_en"));
	assert.ok(equipmentColumns.includes("video_localized"));
	assert.deepEqual(
		database.prepare("PRAGMA table_info(exercise_session_revisions)").all().map((column) => column.name),
		["id", "session_id", "user_id", "version_number", "snapshot_json", "changed_fields_json", "changed_at"],
	);
	const locationColumns = database.prepare("PRAGMA table_info(equipment_locations)").all().map((column) => column.name);
	assert.deepEqual(locationColumns, ["id", "equipment_id", "region_zh", "region_en", "latitude", "longitude", "sort_order", "is_active", "created_by", "created_at", "updated_at"]);
	assert.deepEqual(
		database.prepare("PRAGMA table_info(guest_profiles)").all().map((column) => column.name),
		["id", "age", "gender", "purpose", "created_at"],
	);
	const source = database.prepare("SELECT * FROM facility_sources WHERE id = 'lcsd-outdoor-fitness'").get();
	assert.equal(source.sync_interval_hours, 24);
	assert.match(source.primary_url, /WFSServer/);
	database.close();
});
