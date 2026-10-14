import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ExerciseVideoGallery from './ExerciseVideoGallery';
import { EXERCISE_VIDEO_CATEGORIES, exerciseVideoCategoryLabel, filterExerciseVideos } from '../utils/exerciseVideoCategories';

export default function ExerciseVideoLibrary({ items, locale, track, status = 'ready', onRetry }) {
  const [category, setCategory] = useState('all');
  const en = String(locale).startsWith('en');
  const visible = filterExerciseVideos(items, category);
  return <View style={styles.root}>
    <View accessibilityRole="tablist" style={styles.filters}>
      {['all', ...EXERCISE_VIDEO_CATEGORIES.map(item => item.id)].map(id => <TouchableOpacity
        key={id} testID={`exercise-video-category-${id}`} accessibilityRole="tab" aria-selected={category === id} accessibilityState={{ selected: category === id }}
        onPress={() => setCategory(id)} style={[styles.filter, category === id && styles.active]}>
        <Text style={[styles.label, category === id && styles.activeLabel]}>{id === 'all' ? (en ? 'All' : '全部') : exerciseVideoCategoryLabel(id, locale)}</Text>
      </TouchableOpacity>)}
    </View>
    {visible.length ? <ExerciseVideoGallery key={category} items={visible} locale={locale} track={track} />
      : <View style={styles.status}><Text style={styles.message}>{status === 'loading' ? (en ? 'Loading videos…' : '載入影片中…')
        : status === 'error' ? (en ? 'Unable to load videos.' : '暫時無法載入影片。')
          : category === 'all' ? (en ? 'No videos published yet.' : '暫未有已發布的影片。') : (en ? 'No videos in this category yet.' : '此分類暫未有影片。')}</Text>
        {status === 'error' && <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.activeLabel}>{en ? 'Retry' : '重試'}</Text></TouchableOpacity>}
      </View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  filter: { flexGrow: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#B8C6BE', borderRadius: 12 },
  active: { backgroundColor: '#840B1C', borderColor: '#840B1C' }, label: { color: '#25382D', fontSize: 18, fontWeight: '700', textAlign: 'center' }, activeLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
  status: { padding: 22, alignItems: 'center', gap: 14 }, message: { color: '#444', fontSize: 18, lineHeight: 27 }, retry: { backgroundColor: '#840B1C', padding: 14, borderRadius: 10 },
});
