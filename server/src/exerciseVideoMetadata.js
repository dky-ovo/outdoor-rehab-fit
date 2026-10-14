// Additive content metadata: old clients/rows keep their existing behaviour.
const CATEGORIES = new Set(['', 'indoor', 'outdoor']);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
export const isExerciseVideo = item =>
  (item.pageKey ?? item.page_key) === 'exercise_videos' && (item.contentType ?? item.content_type) === 'video';

function storedIds(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? [...new Set(parsed.filter(id => typeof id === 'string' && id && id.length <= 200))].sort() : [];
  } catch { return []; }
}

export function exerciseVideoMetadata(item) {
  const category = item?.videoCategory ?? item?.video_category ?? '';
  const videoCategory = isExerciseVideo(item || {}) && CATEGORIES.has(category) ? category : '';
  return { videoCategory, equipmentIds: videoCategory === 'indoor' ? storedIds(item.equipmentIds ?? item.equipmentIdsJson ?? item.equipment_ids_json) : [] };
}

export function publicContentMetadata(item) {
  const { equipmentIdsJson, equipment_ids_json, video_category, ...rest } = item;
  return { ...rest, ...exerciseVideoMetadata(item) };
}

// This validates shape independently of database availability. Callers check only
// newly added IDs, so an existing retired selection survives unrelated edits.
export function resolveExerciseVideoMetadata(body, item, current = null) {
  const categoryProvided = owns(body, 'videoCategory');
  const idsProvided = owns(body, 'equipmentIds');
  const previous = current ? exerciseVideoMetadata(current) : { videoCategory: '', equipmentIds: [] };
  if (!isExerciseVideo(item)) {
    return categoryProvided || idsProvided ? { error: 'invalidExerciseVideoMetadata' } : { value: { videoCategory: '', equipmentIds: [] }, addedIds: [] };
  }
  const videoCategory = categoryProvided ? body.videoCategory : previous.videoCategory;
  if (typeof videoCategory !== 'string' || !CATEGORIES.has(videoCategory)) return { error: 'invalidVideoCategory' };
  let equipmentIds = previous.equipmentIds;
  if (idsProvided) {
    if (!Array.isArray(body.equipmentIds) || body.equipmentIds.length > 100 || body.equipmentIds.some(id =>
      typeof id !== 'string' || !id || id.length > 200 || id.trim() !== id || /[\u0000-\u001f\u007f]/.test(id))) return { error: 'invalidVideoEquipmentIds' };
    equipmentIds = [...new Set(body.equipmentIds)].sort();
  }
  if (videoCategory !== 'indoor') {
    if (idsProvided && equipmentIds.length) return { error: 'invalidVideoEquipmentIds' };
    equipmentIds = [];
  }
  const value = { videoCategory, equipmentIds };
  return { value, addedIds: equipmentIds.filter(id => !previous.equipmentIds.includes(id)) };
}

export function sameExerciseVideoMetadata(item, metadata) {
  const previous = exerciseVideoMetadata(item);
  return previous.videoCategory === metadata.videoCategory && JSON.stringify(previous.equipmentIds) === JSON.stringify(metadata.equipmentIds);
}

export function initializeExerciseVideoMetadataSqlite(database) {
  database.transaction(() => {
    const columns = database.prepare('PRAGMA table_info(content_items)').all();
    if (!columns.some(column => column.name === 'video_category')) database.exec("ALTER TABLE content_items ADD COLUMN video_category TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'equipment_ids_json')) database.exec('ALTER TABLE content_items ADD COLUMN equipment_ids_json TEXT DEFAULT NULL');
  })();
}
