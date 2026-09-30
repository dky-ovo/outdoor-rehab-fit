CREATE TABLE `app_text_overrides` (
  `text_key` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `revision` BIGINT NOT NULL DEFAULT 0,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`text_key` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `equipment_categories` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `is_builtin` BIGINT NOT NULL DEFAULT 0,
  `show_in_guide` BIGINT NOT NULL DEFAULT 1,
  `is_locked` BIGINT NOT NULL DEFAULT 0,
  `sort_order` BIGINT NOT NULL DEFAULT 0,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `equipment_document_commits` (
  `idempotency_key` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `preview_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `selection_hash` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `result_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `changes_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`idempotency_key` ASC),
  UNIQUE KEY `uq_equipment_document_commits_preview_id` (`preview_id` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `equipment_document_previews` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `document_sha256` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `payload_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` BIGINT NOT NULL,
  `expires_at` BIGINT NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `equipment_document_previews_actor` (`actor_id` ASC, `expires_at` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `equipment_tcm_content_updates` (
  `revision` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_sha256` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_sha256` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `applied_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `before_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `applied_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `skipped_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`revision` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `facilities` (
  `source_id` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('lcsd'),
  `gml_id` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `name_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `name_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `address_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `address_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `district_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `district_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `phone` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `facility_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `photos_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('[]'),
  `source_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `synced_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `__mysql_row_id` BIGINT NOT NULL AUTO_INCREMENT,
  `__source_id_sha256` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(`source_id` AS BINARY),256))) STORED NULL,
  PRIMARY KEY (`__mysql_row_id` ASC),
  KEY `facilities_active_district` (`is_active` ASC, `district_zh`(191) ASC),
  KEY `facilities_name_zh` (`name_zh`(191) ASC),
  UNIQUE KEY `uq_facilities_source_id_sha256` (`__source_id_sha256` ASC),
  CONSTRAINT `ck_facilities_1` CHECK (is_active IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `guest_profiles` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `age` BIGINT NOT NULL,
  `gender` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `purpose` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `guest_profiles_created` (`created_at` DESC),
  CONSTRAINT `ck_guest_profiles_1` CHECK (age BETWEEN 18 AND 120),
  CONSTRAINT `ck_guest_profiles_2` CHECK (gender IN ('female', 'male', 'other')),
  CONSTRAINT `ck_guest_profiles_3` CHECK (purpose IN ('personal', 'family', 'industry'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_categories` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  UNIQUE KEY `uq_media_categories_name` (`name` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_folders` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `parent_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
  `name` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__active_name` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN `name` ELSE NULL END) STORED NULL,
  PRIMARY KEY (`id` ASC),
  UNIQUE KEY `media_folder_active_name` (`parent_id` ASC, `__active_name` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_seed_folders` (
  `import_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `folder_path` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `folder_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__mysql_row_id` BIGINT NOT NULL AUTO_INCREMENT,
  `__folder_path_sha256` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(`folder_path` AS BINARY),256))) STORED NULL,
  PRIMARY KEY (`__mysql_row_id` ASC),
  UNIQUE KEY `uq_media_seed_folders_folder_path_sha256` (`import_id` ASC, `__folder_path_sha256` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_seed_items` (
  `import_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`import_id` ASC, `file_name` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_seed_video_bindings` (
  `import_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `applied_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `bindings_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `before_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`import_id` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `schema_migrations` (
  `version` BIGINT NOT NULL,
  `applied_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`version` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `sms_verifications` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `phone` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `purpose` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `code_hash` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expires_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `verified_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `attempt_count` BIGINT NOT NULL DEFAULT 0,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `sms_verifications_phone_created` (`phone` ASC, `created_at` DESC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `users` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `phone` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `email` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `profile_role` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `password_salt` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `password_hash` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `last_seen_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `avatar_data` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `__email_sha256` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(`email` AS BINARY),256))) STORED NULL,
  PRIMARY KEY (`id` ASC),
  UNIQUE KEY `uq_users_phone` (`phone` ASC),
  UNIQUE KEY `uq_users_email_sha256` (`__email_sha256` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `admin_accounts` (
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `system_role` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `permissions_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('[]'),
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`user_id` ASC),
  KEY `admin_accounts_role_active` (`system_role` ASC, `is_active` ASC),
  KEY `fkidx_admin_accounts_created_by` (`created_by` ASC),
  CONSTRAINT `ck_admin_accounts_1` CHECK (system_role IN ('super_admin', 'admin', 'operator')),
  CONSTRAINT `ck_admin_accounts_2` CHECK (is_active IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `ai_configuration` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `is_enabled` BIGINT NOT NULL DEFAULT 0,
  `provider` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('openai_compatible'),
  `base_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `model` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `api_key` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `updated_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `fkidx_ai_configuration_updated_by` (`updated_by` ASC),
  CONSTRAINT `ck_ai_configuration_1` CHECK (is_enabled IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `app_equipment_items` (
  `id` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `is_custom` BIGINT NOT NULL DEFAULT 0,
  `name_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `name_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `categories_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('[]'),
  `image_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `youtube_key` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `details_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `details_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `kinesiology_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `kinesiology_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `pt_tip_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `pt_tip_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `ot_tip_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `ot_tip_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `care_tip_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `care_tip_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `sort_order` BIGINT NOT NULL DEFAULT 0,
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `tcm_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `tcm_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `tcm_enabled` BIGINT NULL,
  `gif_left_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `gif_right_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `video_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `video_url_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `video_url_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `video_localized` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id` ASC),
  KEY `app_equipment_items_active_sort` (`is_active` ASC, `sort_order` ASC),
  KEY `fkidx_app_equipment_items_created_by` (`created_by` ASC),
  CONSTRAINT `ck_app_equipment_items_1` CHECK (is_custom IN (0, 1)),
  CONSTRAINT `ck_app_equipment_items_2` CHECK (is_active IN (0, 1)),
  CONSTRAINT `ck_app_equipment_items_3` CHECK (tcm_enabled IN (0, 1)),
  CONSTRAINT `ck_app_equipment_items_4` CHECK (video_localized IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `app_sessions` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `started_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ended_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `app_version` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `platform` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `device_pseudonym` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `metadata_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (`id` ASC),
  KEY `app_sessions_user_started` (`user_id` ASC, `started_at` DESC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `content_items` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `page_key` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sort_order` BIGINT NOT NULL DEFAULT 0,
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `content_items_page` (`page_key` ASC, `is_active` ASC, `sort_order` ASC),
  KEY `fkidx_content_items_created_by` (`created_by` ASC),
  CONSTRAINT `ck_content_items_1` CHECK (content_type IN ('video', 'text', 'feature'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `conversations` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('direct'),
  `title` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`id` ASC),
  KEY `fkidx_conversations_created_by` (`created_by` ASC),
  CONSTRAINT `ck_conversations_1` CHECK (type IN ('direct', 'group', 'support'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `equipment_locations` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `equipment_id` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `region_zh` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `region_en` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `sort_order` BIGINT NOT NULL DEFAULT 0,
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `equipment_locations_equipment_active_sort` (`equipment_id` ASC, `is_active` ASC, `sort_order` ASC, `created_at` ASC),
  KEY `fkidx_equipment_locations_created_by` (`created_by` ASC),
  CONSTRAINT `ck_equipment_locations_1` CHECK (latitude >= -90 AND latitude <= 90),
  CONSTRAINT `ck_equipment_locations_2` CHECK (longitude >= -180 AND longitude <= 180),
  CONSTRAINT `ck_equipment_locations_3` CHECK (is_active IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `exercise_sessions` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `completed_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `duration_sec` BIGINT NOT NULL DEFAULT 0,
  `mode` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `emotion` BIGINT NULL,
  `rpe` BIGINT NULL,
  `journal` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `exercises_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('[]'),
  `types_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `exercise_sessions_user_date` (`user_id` ASC, `completed_at` DESC),
  CONSTRAINT `ck_exercise_sessions_1` CHECK (mode IN ('outdoor', 'home'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `facility_learning_progress` (
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `equipment_id` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `learning_date` VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
  `entry_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`user_id` ASC, `equipment_id` ASC, `learning_date` ASC),
  KEY `facility_learning_user_date` (`user_id` ASC, `learning_date` ASC),
  CONSTRAINT `ck_facility_learning_progress_1` CHECK (learning_date = '' OR (CHAR_LENGTH(learning_date) = 10 AND SUBSTRING(learning_date,5,1) = '-' AND SUBSTRING(learning_date,8,1) = '-' AND SUBSTRING(learning_date,1,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,2,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,3,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,4,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,6,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,7,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,9,1) IN ('0','1','2','3','4','5','6','7','8','9') AND SUBSTRING(learning_date,10,1) IN ('0','1','2','3','4','5','6','7','8','9')))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `facility_sources` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `primary_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `fallback_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `portal_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `sync_interval_hours` BIGINT NOT NULL DEFAULT 24,
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `last_attempt_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `last_success_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `last_error` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `last_record_count` BIGINT NOT NULL DEFAULT 0,
  `last_used_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `updated_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `fkidx_facility_sources_updated_by` (`updated_by` ASC),
  CONSTRAINT `ck_facility_sources_1` CHECK (is_active IN (0, 1))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `feedback` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submission_id` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_hash` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `submitter_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `email` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `subject` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `message` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `locale` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT 'new',
  `notes` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `feedback_created` (`created_at` DESC, `id` DESC),
  KEY `feedback_status_created` (`status` ASC, `created_at` DESC, `id` DESC),
  UNIQUE KEY `uq_feedback_submission_id` (`submission_id` ASC),
  KEY `fkidx_feedback_user_id` (`user_id` ASC),
  CONSTRAINT `ck_feedback_1` CHECK (submitter_type IN ('guest', 'registered')),
  CONSTRAINT `ck_feedback_2` CHECK (locale IN ('zh', 'en')),
  CONSTRAINT `ck_feedback_3` CHECK (status IN ('new', 'in_progress', 'resolved'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `media_files` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `mime_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `kind` VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size_bytes` BIGINT NULL,
  `category_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `storage_name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `sha256` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `archived` BIGINT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `folder_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `__url_sha256` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(`url` AS BINARY),256))) STORED NULL,
  PRIMARY KEY (`id` ASC),
  KEY `media_files_category_kind` (`category_id` ASC, `kind` ASC, `archived` ASC, `created_at` ASC),
  KEY `media_files_folder` (`folder_id` ASC, `deleted_at` ASC, `name` ASC),
  UNIQUE KEY `uq_media_files_url_sha256` (`__url_sha256` ASC),
  KEY `fkidx_media_files_created_by` (`created_by` ASC),
  CONSTRAINT `ck_media_files_1` CHECK (kind IN ('image', 'video', 'file')),
  CONSTRAINT `ck_media_files_2` CHECK (source IN ('upload', 'legacy', 'external', 'youtube'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `push_tokens` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expo_push_token` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (''),
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__expo_push_token_sha256` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(`expo_push_token` AS BINARY),256))) STORED NULL,
  PRIMARY KEY (`id` ASC),
  KEY `push_tokens_user` (`user_id` ASC, `updated_at` DESC),
  UNIQUE KEY `uq_push_tokens_expo_push_token_sha256` (`__expo_push_token_sha256` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `registration_codes` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `code_hash` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `code_hint` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `phone` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `profile_role` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `used_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `used_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `revoked_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `revoked_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `__active_phone` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS (CASE WHEN `used_at` IS NULL AND `revoked_at` IS NULL THEN `phone` ELSE NULL END) STORED NULL,
  PRIMARY KEY (`id` ASC),
  UNIQUE KEY `registration_codes_active_phone` (`__active_phone` ASC),
  KEY `registration_codes_created` (`created_at` DESC, `id` ASC),
  UNIQUE KEY `uq_registration_codes_code_hash` (`code_hash` ASC),
  KEY `fkidx_registration_codes_created_by` (`created_by` ASC),
  KEY `fkidx_registration_codes_revoked_by` (`revoked_by` ASC),
  KEY `fkidx_registration_codes_used_by` (`used_by` ASC),
  CONSTRAINT `ck_registration_codes_1` CHECK (profile_role IN ('participant', 'staff'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `research_consents` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `consent_version` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `consented_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `withdrawn_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`id` ASC),
  KEY `research_consents_user_time` (`user_id` ASC, `consented_at` DESC),
  CONSTRAINT `ck_research_consents_1` CHECK (status IN ('granted', 'withdrawn'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `research_events` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `participant_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `event_name` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `event_time` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `app_version` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `metadata_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (`id` ASC),
  KEY `research_events_participant_time` (`participant_id` ASC, `event_time` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `system_logs` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `actor_role` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `action` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `target_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `target_id` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ip_address` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `metadata_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (`id` ASC),
  KEY `system_logs_actor` (`actor_user_id` ASC, `created_at` DESC),
  KEY `system_logs_created` (`created_at` DESC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `volunteer_participants` (
  `volunteer_user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `participant_user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`volunteer_user_id` ASC, `participant_user_id` ASC),
  KEY `volunteer_participants_participant` (`participant_user_id` ASC, `created_at` DESC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `conversation_members` (
  `conversation_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `member_role` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('member'),
  `joined_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `last_read_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `left_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`conversation_id` ASC, `user_id` ASC),
  KEY `conversation_members_user` (`user_id` ASC, `joined_at` DESC),
  CONSTRAINT `ck_conversation_members_1` CHECK (member_role IN ('owner', 'moderator', 'member'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `exercise_session_revisions` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `session_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version_number` BIGINT NOT NULL,
  `snapshot_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `changed_fields_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('[]'),
  `changed_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id` ASC),
  KEY `exercise_session_revisions_session` (`session_id` ASC, `version_number` DESC),
  UNIQUE KEY `uq_exercise_session_revisions_session_id_version_number` (`session_id` ASC, `version_number` ASC),
  KEY `fkidx_exercise_session_revisions_user_id` (`user_id` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `facility_sync_runs` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `triggered_by` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `used_url` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `record_count` BIGINT NOT NULL DEFAULT 0,
  `error_message` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `details_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  `started_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `finished_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`id` ASC),
  KEY `facility_sync_runs_started` (`started_at` DESC),
  KEY `fkidx_facility_sync_runs_source_id` (`source_id` ASC),
  KEY `fkidx_facility_sync_runs_triggered_by` (`triggered_by` ASC),
  CONSTRAINT `ck_facility_sync_runs_1` CHECK (status IN ('running', 'success', 'failed'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `messages` (
  `id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `conversation_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sender_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_type` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('text'),
  `body` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `metadata_json` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ('{}'),
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `edited_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  `deleted_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (`id` ASC),
  KEY `messages_conversation_time` (`conversation_id` ASC, `created_at` DESC),
  KEY `fkidx_messages_sender_id` (`sender_id` ASC),
  CONSTRAINT `ck_messages_1` CHECK (message_type IN ('text', 'image', 'system'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `message_reactions` (
  `message_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `emoji` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`message_id` ASC, `user_id` ASC, `emoji` ASC),
  KEY `message_reactions_message` (`message_id` ASC),
  KEY `fkidx_message_reactions_user_id` (`user_id` ASC)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

ALTER TABLE `admin_accounts` ADD CONSTRAINT `fk_admin_accounts_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `admin_accounts` ADD CONSTRAINT `fk_admin_accounts_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `ai_configuration` ADD CONSTRAINT `fk_ai_configuration_updated_by_users` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `app_equipment_items` ADD CONSTRAINT `fk_app_equipment_items_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `app_sessions` ADD CONSTRAINT `fk_app_sessions_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `content_items` ADD CONSTRAINT `fk_content_items_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `conversations` ADD CONSTRAINT `fk_conversations_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `equipment_locations` ADD CONSTRAINT `fk_equipment_locations_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `exercise_sessions` ADD CONSTRAINT `fk_exercise_sessions_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `facility_learning_progress` ADD CONSTRAINT `fk_facility_learning_progress_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `facility_sources` ADD CONSTRAINT `fk_facility_sources_updated_by_users` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `media_files` ADD CONSTRAINT `fk_media_files_category_id_media_categories` FOREIGN KEY (`category_id`) REFERENCES `media_categories` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `media_files` ADD CONSTRAINT `fk_media_files_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `push_tokens` ADD CONSTRAINT `fk_push_tokens_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `registration_codes` ADD CONSTRAINT `fk_registration_codes_created_by_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `registration_codes` ADD CONSTRAINT `fk_registration_codes_revoked_by_users` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `registration_codes` ADD CONSTRAINT `fk_registration_codes_used_by_users` FOREIGN KEY (`used_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `research_consents` ADD CONSTRAINT `fk_research_consents_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `research_events` ADD CONSTRAINT `fk_research_events_participant_id_users` FOREIGN KEY (`participant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `system_logs` ADD CONSTRAINT `fk_system_logs_actor_user_id_users` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `volunteer_participants` ADD CONSTRAINT `fk_volunteer_participants_participant_user_id_users` FOREIGN KEY (`participant_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `volunteer_participants` ADD CONSTRAINT `fk_volunteer_participants_volunteer_user_id_users` FOREIGN KEY (`volunteer_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `conversation_members` ADD CONSTRAINT `fk_conversation_members_conversation_id_conversations` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `conversation_members` ADD CONSTRAINT `fk_conversation_members_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `exercise_session_revisions` ADD CONSTRAINT `fk_exercise_session_revisions_session_id_exercise_sessions` FOREIGN KEY (`session_id`) REFERENCES `exercise_sessions` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `exercise_session_revisions` ADD CONSTRAINT `fk_exercise_session_revisions_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `facility_sync_runs` ADD CONSTRAINT `fk_facility_sync_runs_source_id_facility_sources` FOREIGN KEY (`source_id`) REFERENCES `facility_sources` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `facility_sync_runs` ADD CONSTRAINT `fk_facility_sync_runs_triggered_by_users` FOREIGN KEY (`triggered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `messages` ADD CONSTRAINT `fk_messages_conversation_id_conversations` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `messages` ADD CONSTRAINT `fk_messages_sender_id_users` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `message_reactions` ADD CONSTRAINT `fk_message_reactions_message_id_messages` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `message_reactions` ADD CONSTRAINT `fk_message_reactions_user_id_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
