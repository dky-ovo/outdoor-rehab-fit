import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Image, Modal, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import ModalSafeAreaView from './ModalSafeAreaView';
import YoutubePlayer from 'react-native-youtube-iframe';
import ExerciseVideoSurface from './ExerciseVideoSurface';
import { directVideoUri, youtubeVideoId } from '../utils/contentVideo';
import { EXERCISE_VIDEO_RATIO } from '../utils/exerciseVideoPresentation';
import { YOUTUBE_PLAYER_PLATFORM_PROPS } from '../utils/youtubePlayerConfig';
import useVideoPlaybackEvents from '../hooks/useVideoPlaybackEvents';

function Playback({ item, locale, track, allowed }) {
  const started = useRef(null);
  const identity = directVideoUri(item.value) || youtubeVideoId(item.value);
  const source = Platform.OS === 'web' ? item.playbackValue || item.value : item.value;
  const { width, height } = useWindowDimensions();
  const onState = useVideoPlaybackEvents(JSON.stringify([item.id, source, locale]), (state, metadata = {}) => {
    if (state === 'playing' && started.current === null) { started.current = Date.now(); track('video.play', item, { videoId: identity, ...metadata }); }
    if (['paused', 'ended'].includes(state) && started.current !== null) {
      track(state === 'ended' ? 'video.completed' : 'video.paused', item, { videoId: identity, watchedMs: Math.max(0, Date.now() - started.current), completed: state === 'ended', ...metadata });
      started.current = null;
    }
  });
  const state = (value, metadata) => { if (['playing', 'ended'].includes(value) && !allowed.current) return; onState(value, metadata); };
  const youtube = youtubeVideoId(source);
  return youtube ? <View style={{ width: '100%', maxWidth: Math.max(1, height - 100) * EXERCISE_VIDEO_RATIO, alignSelf: 'center' }}><YoutubePlayer {...YOUTUBE_PLAYER_PLATFORM_PROPS} height={Math.min(width / EXERCISE_VIDEO_RATIO, Math.max(1, height - 100))} videoId={youtube} play onChangeState={state} /></View>
    : <ExerciseVideoSurface source={source} title={item.title} locale={locale} onChangeState={state} />;
}

export default function ExerciseVideoGallery({ items, locale, track, embedded = false }) {
  const [selected, setSelected] = useState(null);
  const [embeddedPage, setEmbeddedPage] = useState(0);
  const [visible, setVisible] = useState(() => new Set(items.slice(0, 3).map(item => item.id)));
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const focused = useIsFocused();
  const allowed = useRef(true), fullscreen = useRef(null);
  allowed.current = focused && foreground;
  const releaseFullscreen = useCallback(() => {
    const attempt = fullscreen.current;
    if (!attempt) return;
    attempt.active = false;
    if (attempt.owns && typeof document !== 'undefined' && document.fullscreenElement === attempt.element) {
      try { Promise.resolve(document.exitFullscreen?.()).catch(() => {}); } catch {}
    }
  }, []);
  const close = useCallback(() => { releaseFullscreen(); setSelected(null); }, [releaseFullscreen]);
  useEffect(() => {
    if (!focused) close();
    const subscription = AppState.addEventListener('change', state => {
      allowed.current = focused && state === 'active'; setForeground(state === 'active'); if (state !== 'active') close();
    });
    return () => subscription.remove();
  }, [focused, close]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return releaseFullscreen;
    const hidden = () => { if (document.hidden) { allowed.current = false; close(); } else allowed.current = focused; };
    const changed = () => { if (fullscreen.current?.active && fullscreen.current.owns && !document.fullscreenElement) close(); };
    document.addEventListener('visibilitychange', hidden); document.addEventListener('fullscreenchange', changed);
    return () => { document.removeEventListener('visibilitychange', hidden); document.removeEventListener('fullscreenchange', changed); releaseFullscreen(); };
  }, [close, focused, releaseFullscreen]);
  const open = item => {
    if (!allowed.current) return;
    // Request browser fullscreen synchronously in the user's gesture. The
    // full-window Modal still opens immediately when the browser refuses it.
    if (Platform.OS === 'web' && typeof document !== 'undefined' && fullscreen.current &&
        (fullscreen.current.pending || fullscreen.current.owns && document.fullscreenElement === fullscreen.current.element)) {
      // Reuse an in-flight gesture request if another card is opened before
      // its promise settles. There must never be two owners of the same page.
      fullscreen.current.active = true;
    } else if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      const attempt = { active: true, owns: false, pending: true, element: document.documentElement }; fullscreen.current = attempt;
      try {
        Promise.resolve(attempt.element.requestFullscreen()).then(() => {
          if (fullscreen.current !== attempt) return;
          attempt.pending = false;
          attempt.owns = document.fullscreenElement === attempt.element;
          if (!attempt.active) releaseFullscreen();
        }).catch(() => { attempt.pending = false; });
      } catch { attempt.pending = false; }
    }
    setSelected(item);
  };
  const viewable = useRef(({ viewableItems }) => setVisible(new Set(viewableItems.map(value => value.item.id)))).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
  const totalPages = Math.max(1, Math.ceil(items.length / 3));
  const page = Math.min(embeddedPage, totalPages - 1);
  const renderCard = ({ item }) => {
        const source = Platform.OS === 'web' ? item.playbackValue || item.value : item.value;
        const youtube = youtubeVideoId(source);
        return <TouchableOpacity testID={`exercise-video-open-${item.id}`} accessibilityRole="button" accessibilityLabel={locale === 'en' ? `Play ${item.title} full screen` : `全螢幕播放：${item.title}`} onPress={() => open(item)} style={styles.card} activeOpacity={.85}>
          <View testID="exercise-video-cover" style={styles.cover}>
            {youtube ? <Image accessible={false} source={{ uri: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              : <ExerciseVideoSurface source={source} title={item.title} locale={locale} preview active={focused && foreground && !selected && (embedded || visible.has(item.id))} />}
            <View pointerEvents="none" style={styles.playOverlay}><View style={styles.play}><Text accessible={false} style={styles.playIcon}>▶</Text><Text style={styles.playText}>{locale === 'en' ? 'Play' : '播放'}</Text></View></View>
          </View>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        </TouchableOpacity>;
      };
  return <View style={embedded ? styles.embedded : styles.root}>
    {embedded ? <View testID="exercise-video-embedded">
      {items.slice(page * 3, page * 3 + 3).map(item => <React.Fragment key={item.id}>{renderCard({ item })}</React.Fragment>)}
      {totalPages > 1 && <View style={styles.pages}>
        <TouchableOpacity accessibilityRole="button" disabled={page === 0} onPress={() => setEmbeddedPage(page - 1)} style={styles.pageButton}><Text>{locale === 'en' ? 'Previous' : '上一頁'}</Text></TouchableOpacity>
        <Text>{page + 1} / {totalPages}</Text>
        <TouchableOpacity accessibilityRole="button" disabled={page === totalPages - 1} onPress={() => setEmbeddedPage(page + 1)} style={styles.pageButton}><Text>{locale === 'en' ? 'Next' : '下一頁'}</Text></TouchableOpacity>
      </View>}
    </View> : <FlatList testID="exercise-video-gallery" data={items} keyExtractor={item => item.id} extraData={[visible, selected, foreground, focused]}
      contentContainerStyle={styles.list} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={3} removeClippedSubviews={false}
      onViewableItemsChanged={viewable} viewabilityConfig={viewabilityConfig} renderItem={renderCard} />}
    {selected && <Modal visible animationType="none" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait', 'landscape']} onRequestClose={close}>
      <StatusBar hidden />
      <ModalSafeAreaView testID="exercise-video-fullscreen" style={styles.fullscreen}>
        <View style={styles.toolbar}><Text style={styles.playerTitle} numberOfLines={2}>{selected.title}</Text><TouchableOpacity testID="exercise-video-close" accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Close video' : '關閉影片'} onPress={close} style={styles.close}><Text style={styles.closeText}>{locale === 'en' ? 'Close ✕' : '關閉 ✕'}</Text></TouchableOpacity></View>
        <View style={styles.player}><Playback key={JSON.stringify([selected.id, selected.value, selected.playbackValue])} item={selected} locale={locale} track={track} allowed={allowed} /></View>
      </ModalSafeAreaView>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, list: { paddingHorizontal: 16, paddingBottom: 30 },
  embedded: { width: '100%', paddingBottom: 14 }, pages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 12 },
  pageButton: { minHeight: 48, padding: 14, justifyContent: 'center', borderWidth: 1, borderColor: '#D0D9D3', borderRadius: 8 },
  card: { width: '100%', maxWidth: 720, alignSelf: 'center', marginTop: 16, borderRadius: 14, backgroundColor: '#fff', overflow: 'hidden', borderWidth: 1, borderColor: '#E1E7E2' },
  cover: { width: '100%', aspectRatio: EXERCISE_VIDEO_RATIO, backgroundColor: '#152019', overflow: 'hidden' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  play: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 40, backgroundColor: 'rgba(0,0,0,.65)', borderWidth: 2, borderColor: '#fff' },
  playIcon: { color: '#fff', fontSize: 26 }, playText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  title: { padding: 16, minHeight: 82, fontSize: 19, lineHeight: 25, fontWeight: '700', color: '#25382D' },
  fullscreen: { flex: 1, backgroundColor: '#000' }, toolbar: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  playerTitle: { flex: 1, color: '#fff', fontSize: 18 }, close: { padding: 14, borderWidth: 1, borderColor: '#fff', borderRadius: 10 }, closeText: { color: '#fff', fontWeight: '700', fontSize: 19 },
  player: { flex: 1, justifyContent: 'center' },
});
