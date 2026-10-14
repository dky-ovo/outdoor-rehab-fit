// Categories never alter the identity or file URL of an existing video.
export const EXERCISE_VIDEO_CATEGORIES = Object.freeze([
  { id: 'indoor', zh: '室內運動篇', zhCN: '室内运动篇', en: 'Indoor Exercises' },
  { id: 'outdoor', zh: '室外健身器材', zhCN: '室外健身器材', en: 'Outdoor Fitness Equipment' },
]);
export function normalizeExerciseVideoCategory(value) {
  return value === 'indoor' || value === 'outdoor' ? value : '';
}
export function exerciseVideoCategoryLabel(category, locale = 'zh') {
  const language = String(locale).startsWith('en') ? 'en' : locale === 'zh-CN' ? 'zhCN' : 'zh';
  return EXERCISE_VIDEO_CATEGORIES.find(item => item.id === category)?.[language]
    || ({ zh: '未分類', zhCN: '未分类', en: 'Uncategorized' })[language];
}
export function normalizeExerciseVideoMetadata(item) {
  const videoCategory = normalizeExerciseVideoCategory(item?.videoCategory);
  const equipmentIds = videoCategory === 'indoor' && Array.isArray(item?.equipmentIds)
    ? [...new Set(item.equipmentIds.filter(id => typeof id === 'string' && id && id.length <= 200))] : [];
  return { videoCategory, equipmentIds };
}
// Editorial suggestions only. Admin reviews them before saving; public pages
// never infer links from a file name or title.
const INDOOR_SUGGESTIONS = [
  { titles: ['站立式低背伸展'], ids: ['6'] },
  { titles: ['坐式低背伸展'], ids: ['6'] },
  { titles: ['手臂關節活動', '手臂关节活动'], ids: ['0'] },
  { titles: ['前後腳站立伸展運動', '前后脚站立伸展运动'], ids: ['4', '10'] },
];
const titleKey = title => String(title || '').split(/[\\/]/).pop().replace(/\.(mp4|mov|m4v|webm)$/i, '').normalize('NFKC').replace(/\s+/g, '').trim();
export function suggestExerciseVideoEquipment(title) {
  const row = INDOOR_SUGGESTIONS.find(item => item.titles.some(value => titleKey(value) === titleKey(title)));
  return row ? [...row.ids] : [];
}
export function suggestExerciseVideoMetadata(title) {
  const equipmentIds = suggestExerciseVideoEquipment(title);
  return equipmentIds.length ? { videoCategory: 'indoor', equipmentIds } : null;
}
export function filterExerciseVideos(items, category = 'all', equipmentId) {
  return (Array.isArray(items) ? items : []).filter(item => {
    if (item?.contentType !== 'video' || item.isActive === false || item.isActive === 0) return false;
    const metadata = normalizeExerciseVideoMetadata(item);
    return (category === 'all' || metadata.videoCategory === category)
      && (equipmentId === undefined || metadata.videoCategory === 'indoor' && metadata.equipmentIds.includes(String(equipmentId)));
  });
}
