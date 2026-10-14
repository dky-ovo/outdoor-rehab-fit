import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getEquipmentCatalog } from '../utils/api';
import { EXERCISE_VIDEO_CATEGORIES, exerciseVideoCategoryLabel, normalizeExerciseVideoMetadata, suggestExerciseVideoMetadata } from '../utils/exerciseVideoCategories';

const COPY = {
  'zh-CN': { category: '影片分类', required: '新影片请选择分类。', all: '全部', associated: '关联设施教学（可多选）', optional: '可选；影片会显示在所选器材的设施教学页中。', loading: '正在读取可选器材…', failed: '器材列表暂时无法载入；已有选择保留。', retry: '重试', empty: '暂无可选器材。', unavailable: '暂不可用的器材', suggested: '按标题建议关联', suggestion: '请核对建议的器材，可在下方调整。', none: '暂不关联器材' },
  'zh-HK': { category: '影片分類', required: '新影片請選擇分類。', all: '全部', associated: '關聯設施教學（可多選）', optional: '可選；影片會顯示在所選器材的設施教學頁中。', loading: '正在讀取可選器材…', failed: '器材列表暫時無法載入；已有選擇保留。', retry: '重試', empty: '暫無可選器材。', unavailable: '暫不可用的器材', suggested: '按標題建議關聯', suggestion: '請核對建議的器材，可在下方調整。', none: '暫不關聯器材' },
  en: { category: 'Video category', required: 'Choose a category for each new video.', all: 'All', associated: 'Related facility guides (select any)', optional: 'Optional: this video will appear in the selected facility guides.', loading: 'Loading available equipment…', failed: 'Equipment could not be loaded. Existing selections are kept.', retry: 'Retry', empty: 'No equipment is available.', unavailable: 'Currently unavailable equipment', suggested: 'Suggest links from title', suggestion: 'Check the suggested equipment and adjust below.', none: 'No linked equipment' },
};

export function useExerciseVideoCatalog(enabled) {
  const [state, setState] = useState({ items: [], status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    setState(previous => ({ ...previous, status: 'loading' }));
    // This is the public catalog; managing home content does not grant access
    // to the equipment maintenance API.
    Promise.resolve().then(() => getEquipmentCatalog({ forceRefresh: true })).then(result => {
      if (!Array.isArray(result?.items)) throw new Error('INVALID_CATALOG');
      if (current) setState({ items: result.items.filter(item => item && item.id != null && item.isActive !== false && item.isActive !== 0 && !item.deletedAt), status: 'ready' });
    }).catch(() => { if (current) setState(previous => ({ ...previous, status: 'error' })); });
    return () => { current = false; };
  }, [enabled, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}

export function ExerciseVideoCategoryChoices({ value, onChange, locale = 'zh-CN', disabled = false, allowUncategorized = false, includeAll = false, testID = 'exercise-video-category' }) {
  const copy = COPY[locale] || COPY['zh-CN'];
  const options = [...(includeAll ? [{ id: 'all', label: copy.all }] : []),
    ...EXERCISE_VIDEO_CATEGORIES.map(item => ({ id: item.id, label: exerciseVideoCategoryLabel(item.id, locale) })),
    ...(allowUncategorized ? [{ id: '', label: exerciseVideoCategoryLabel('', locale) }] : [])];
  return <View style={styles.options}>{options.map(option => <TouchableOpacity key={option.id} testID={`${testID}-${option.id || 'uncategorized'}`}
    accessibilityRole="radio" aria-checked={value === option.id} aria-disabled={disabled} accessibilityState={{ checked: value === option.id, disabled }} disabled={disabled}
    style={[styles.option, value === option.id && styles.selected, disabled && styles.disabled]}
    onPress={() => { if (!disabled) onChange(option.id); }}><Text style={value === option.id ? styles.selectedText : styles.text}>{option.label}</Text></TouchableOpacity>)}</View>;
}

export function exerciseVideoEquipmentLabel(item, locale = 'zh-CN') {
  return (locale === 'en' ? item?.nameEn : item?.nameZh) || item?.nameZh || item?.nameEn || String(item?.id ?? '');
}

export default function AdminExerciseVideoMetadata({ value, onChange, catalog = { items: [], status: 'idle' }, locale = 'zh-CN', disabled = false, allowUncategorized = false, testID = 'exercise-video-metadata' }) {
  const copy = COPY[locale] || COPY['zh-CN'];
  const metadata = normalizeExerciseVideoMetadata(value);
  const items = catalog.items || [];
  const byId = new Map(items.map(item => [String(item.id), item]));
  const missing = metadata.equipmentIds.filter(id => !byId.has(id));
  const suggestion = suggestExerciseVideoMetadata(value?.title);
  const patch = data => { if (!disabled) onChange({ ...value, ...data }); };
  const toggle = id => patch({ equipmentIds: metadata.equipmentIds.includes(id) ? metadata.equipmentIds.filter(value => value !== id) : [...metadata.equipmentIds, id] });
  return <View testID={testID} style={styles.container}>
    <Text style={styles.heading}>{copy.category}</Text>
    <ExerciseVideoCategoryChoices value={metadata.videoCategory} onChange={videoCategory => patch({ videoCategory, equipmentIds: videoCategory === 'indoor' ? metadata.equipmentIds : [] })}
      locale={locale} disabled={disabled} allowUncategorized={allowUncategorized} testID={`${testID}-category`} />
    {!allowUncategorized && !metadata.videoCategory && <Text style={styles.note}>{copy.required}</Text>}
    {suggestion && <><TouchableOpacity disabled={disabled || catalog.status !== 'ready' || suggestion.equipmentIds.some(id => !byId.has(id))}
      testID={`${testID}-suggest`} style={styles.option} onPress={() => { if (catalog.status === 'ready' && suggestion.equipmentIds.every(id => byId.has(id))) patch({ ...suggestion, equipmentIds: [...suggestion.equipmentIds] }); }}>
      <Text style={styles.text}>{copy.suggested}: {suggestion.equipmentIds.map(id => byId.has(id) ? exerciseVideoEquipmentLabel(byId.get(id), locale) : `#${id}`).join('、')}</Text></TouchableOpacity>
      <Text style={styles.note}>{copy.suggestion}</Text></>}
    {(metadata.videoCategory === 'indoor' || suggestion) && catalog.status === 'loading' && <View style={styles.options}><ActivityIndicator /><Text style={styles.note}>{copy.loading}</Text></View>}
    {(metadata.videoCategory === 'indoor' || suggestion) && catalog.status === 'error' && <View><Text style={styles.note}>{copy.failed}</Text><TouchableOpacity testID={`${testID}-retry`} style={styles.option} disabled={disabled} onPress={catalog.retry}><Text>{copy.retry}</Text></TouchableOpacity></View>}
    {metadata.videoCategory === 'indoor' && <>
      <Text style={styles.heading}>{copy.associated}</Text><Text style={styles.note}>{copy.optional}</Text>
      {catalog.status === 'ready' && !items.length && <Text style={styles.note}>{copy.empty}</Text>}
      <View style={styles.options}>{items.map(item => {
        const id = String(item.id), checked = metadata.equipmentIds.includes(id);
        return <TouchableOpacity key={id} testID={`${testID}-equipment-${id}`} accessibilityRole="checkbox" aria-checked={checked} aria-disabled={disabled || catalog.status !== 'ready'} accessibilityState={{ checked, disabled: disabled || catalog.status !== 'ready' }}
          style={[styles.option, checked && styles.selected]} disabled={disabled || catalog.status !== 'ready'} onPress={() => { if (!disabled && catalog.status === 'ready') toggle(id); }}>
          <Text style={checked ? styles.selectedText : styles.text}>{checked ? '✓ ' : ''}{exerciseVideoEquipmentLabel(item, locale)}</Text></TouchableOpacity>;
      })}</View>
      {missing.map(id => <TouchableOpacity key={id} testID={`${testID}-missing-${id}`} disabled={disabled} style={styles.option} onPress={() => toggle(id)}><Text>{copy.unavailable}: #{id} · ×</Text></TouchableOpacity>)}
      {!metadata.equipmentIds.length && <Text style={styles.note}>{copy.none}</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({ container: { gap: 8, marginVertical: 8 }, heading: { fontWeight: '700', color: '#333', fontSize: 15 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, option: { padding: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, alignSelf: 'flex-start' },
  selected: { backgroundColor: '#840B1C', borderColor: '#840B1C' }, selectedText: { color: '#fff' }, text: { color: '#333' }, note: { color: '#666', fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.6 } });
