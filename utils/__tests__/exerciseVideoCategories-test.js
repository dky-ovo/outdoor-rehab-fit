import { filterExerciseVideos, normalizeExerciseVideoMetadata, suggestExerciseVideoMetadata, exerciseVideoCategoryLabel } from '../exerciseVideoCategories';

const rows = [
  { id: 'legacy', contentType: 'video', title: '站立式低背伸展' },
  { id: 'inside', contentType: 'video', videoCategory: 'indoor', equipmentIds: ['0', '6'] },
  { id: 'outside', contentType: 'video', videoCategory: 'outdoor', equipmentIds: ['6'] },
  { id: 'disabled', contentType: 'video', videoCategory: 'indoor', equipmentIds: ['6'], isActive: false },
  { id: 'text', contentType: 'text' },
];
test('all retains legacy videos; equipment pages use saved indoor associations, never inferred titles', () => {
  expect(filterExerciseVideos(rows).map(item => item.id)).toEqual(['legacy', 'inside', 'outside']);
  expect(filterExerciseVideos(rows, 'indoor').map(item => item.id)).toEqual(['inside']);
  expect(filterExerciseVideos(rows, 'outdoor').map(item => item.id)).toEqual(['outside']);
  expect(filterExerciseVideos(rows, 'all', '6').map(item => item.id)).toEqual(['inside']);
  expect(filterExerciseVideos(rows, 'indoor', 0).map(item => item.id)).toEqual(['inside']);
  expect(filterExerciseVideos(rows, 'indoor', '10')).toEqual([]);
});
test.each([
  ['站立式低背伸展.mp4', ['6']], ['坐式低背伸展.MP4', ['6']],
  ['手臂關節活動', ['0']], ['前後腳站立伸展運動', ['4', '10']],
])('exact editorial title %s produces reviewable suggestions', (title, ids) => {
  expect(suggestExerciseVideoMetadata(title)).toEqual({ videoCategory: 'indoor', equipmentIds: ids });
});
test('similar or unknown titles do not silently select equipment; metadata retains valid custom IDs', () => {
  expect(suggestExerciseVideoMetadata('站立式低背伸展的其他影片')).toBeNull();
  expect(suggestExerciseVideoMetadata('other.mp4')).toBeNull();
  expect(normalizeExerciseVideoMetadata({ videoCategory: 'indoor', equipmentIds: ['custom:器材', '0', '0', null] })).toEqual({ videoCategory: 'indoor', equipmentIds: ['custom:器材', '0'] });
  expect(normalizeExerciseVideoMetadata({ videoCategory: 'outdoor', equipmentIds: ['6'] }).equipmentIds).toEqual([]);
  expect(exerciseVideoCategoryLabel('indoor', 'en')).toBe('Indoor Exercises');
});
