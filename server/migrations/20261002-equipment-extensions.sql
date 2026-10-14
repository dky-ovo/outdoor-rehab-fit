-- Additive post-v11 migration. Apply after backup, before starting the v12 API.
-- Existing frozen schema/import contracts are intentionally unchanged.
ALTER TABLE app_equipment_items
  ADD COLUMN additional_videos_json JSON NULL,
  ADD COLUMN teaching_sections_json JSON NULL;
