import { mediaCanSelect } from './adminMedia';
import { normalizeExerciseVideoMetadata, suggestExerciseVideoMetadata } from './exerciseVideoCategories';

export function exerciseVideoTitle(item) {
  const name = String(item?.originalName || item?.fileName || item?.name || '').split(/[\\/]/).pop().trim();
  return (name.replace(/\.(?:mp4|mov|webm|m4v)$/i, '').trim() || name || '运动影片').slice(0, 200);
}

export function videoImportRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // This is an idempotency identifier, not an authentication credential.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
    const random = Math.floor(Math.random() * 16);
    return (value === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

export function appendExerciseVideoDrafts(drafts, files, existing = [], makeId = videoImportRequestId, defaults = {}) {
  const next = [...drafts];
  const seen = new Set([...drafts.map(item => item.value), ...existing.filter(item => item.pageKey === 'exercise_videos').map(item => item.value)]);
  for (const item of files || []) {
    if (!mediaCanSelect(item, 'video') || !item.url.startsWith('/api/media/') || seen.has(item.url)) continue;
    seen.add(item.url);
    const title = exerciseVideoTitle(item), suggestion = suggestExerciseVideoMetadata(title);
    const videoCategory = defaults.videoCategory || suggestion?.videoCategory || '';
    const metadata = normalizeExerciseVideoMetadata({ videoCategory, equipmentIds: videoCategory === 'indoor' ? suggestion?.equipmentIds || [] : [] });
    next.push({ clientRequestId: makeId(), mediaId: item.id, name: item.name || '', title,
      ...metadata, metadataSuggested: Boolean(suggestion && videoCategory === 'indoor'), value: item.url, status: 'pending' });
  }
  return next;
}

export function applyExerciseVideoDraftCategory(drafts, videoCategory) {
  return drafts.map(item => item.payload ? item : { ...item,
    ...normalizeExerciseVideoMetadata({ ...item, videoCategory }), metadataSuggested: false });
}

export function exerciseVideoDraftReady(item) {
  return Boolean(item.payload || (String(item.title || '').trim() && ['indoor', 'outdoor'].includes(item.videoCategory)));
}

// Keep each attempted payload immutable. A response may be lost after the
// server commits it; retries must use its original ID and identical payload.
export async function publishExerciseVideoDrafts({ drafts, listContent, createContent, onChange, isCurrent = () => true }) {
  if (drafts.some(item => !['saved', 'skipped'].includes(item.status) && !exerciseVideoDraftReady(item))) throw new Error('CONTENT_VIDEO_CATEGORY_REQUIRED');
  let next = drafts.map(item => ({ ...item }));
  const response = await listContent();
  if (!isCurrent()) return next;
  if (!Array.isArray(response?.items)) throw new Error('CONTENT_LIST_INVALID');
  const existing = response.items.filter(item => item.pageKey === 'exercise_videos');
  let order = Math.max(0, ...existing.map(item => Number(item.sortOrder) || 0), ...next.map(item => Number(item.payload?.sortOrder) || 0)) + 1;
  const emit = () => { if (isCurrent()) onChange(next.map(item => ({ ...item }))); };
  for (let index = 0; index < next.length; index++) {
    if (!isCurrent()) break;
    const item = next[index];
    if (['saved', 'skipped'].includes(item.status)) continue;
    if (!item.payload && existing.some(value => value.value === item.value)) {
      next[index] = { ...item, status: 'skipped' }; emit(); continue;
    }
    const payload = item.payload || { pageKey: 'exercise_videos', contentType: 'video', title: item.title.trim(),
      ...normalizeExerciseVideoMetadata(item),
      value: item.value, sortOrder: order++, isActive: true, clientRequestId: item.clientRequestId };
    if (!payload.title) throw new Error('CONTENT_TITLE_REQUIRED');
    next[index] = { ...item, payload, status: 'saving', errorCode: undefined }; emit();
    try {
      const result = await createContent(payload);
      if (!isCurrent()) break;
      if (result?.id !== item.clientRequestId) throw Object.assign(new Error('CONTENT_SAVE_UNCONFIRMED'), { code: 'CONTENT_SAVE_UNCONFIRMED' });
      next[index] = { ...next[index], status: 'saved', id: result.id }; emit();
    } catch (error) {
      if (!isCurrent()) break;
      next[index] = { ...next[index], status: 'failed',
        errorCode: /^[A-Za-z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'CONTENT_SAVE_UNCONFIRMED' };
      emit(); break;
    }
  }
  return next;
}
