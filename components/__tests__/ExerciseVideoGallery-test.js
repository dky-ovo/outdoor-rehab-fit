import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, Platform, StyleSheet } from 'react-native';
import Gallery from '../ExerciseVideoGallery';

let mockFocused = true, mockAppListeners = new Set();
jest.mock('react-native', () => ({
  View: 'view', Text: 'text', Image: 'image', Modal: 'modal', TouchableOpacity: 'touchable', StatusBar: 'statusbar',
  Platform: { OS: 'android' }, StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {}, flatten: value => Object.assign({}, ...(Array.isArray(value) ? value : [value])) },
  AppState: { currentState: 'active', addEventListener: (_name, cb) => { mockAppListeners.add(cb); return { remove: () => mockAppListeners.delete(cb) }; } },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
  FlatList: props => require('react').createElement('flat-list', props, props.data.map(item => require('react').createElement(require('react').Fragment, { key: item.id }, props.renderItem({ item })))),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-youtube-iframe', () => 'youtube-player');
jest.mock('../ExerciseVideoSurface', () => 'surface');
jest.mock('../../utils/api', () => ({ resolveApiAssetUrl: value => value }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const items = [1, 2, 3, 4].map(id => ({ id: `clip-${id}`, contentType: 'video', title: `影片 ${id}`, value: `https://host/original-${id}.mp4`, playbackValue: `https://cdn.example/optimized-${id}.mp4` }));
let tree, track, now, originalDocument;
beforeEach(() => { Platform.OS = 'android'; mockFocused = true; AppState.currentState = 'active'; track = jest.fn(); now = 1000; jest.spyOn(Date, 'now').mockImplementation(() => now); originalDocument = global.document; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; mockAppListeners.clear(); jest.restoreAllMocks(); global.document = originalDocument; });
const mount = async () => act(async () => { tree = renderer.create(<Gallery items={items} locale="zh" track={track} />); });
const open = async id => act(async () => tree.root.findByProps({ testID: `exercise-video-open-clip-${id}` }).props.onPress());
const close = async () => act(async () => tree.root.findByProps({ testID: 'exercise-video-close' }).props.onPress());
const previews = () => tree.root.findAllByType('surface').filter(item => item.props.preview);
const playback = () => tree.root.findAllByType('surface').find(item => !item.props.preview);

test('gallery uses uniform covers and activates previews only for visible cards while no movie is open', async () => {
  await mount();
  expect(previews().map(row => row.props.active)).toEqual([true, true, true, false]);
  for (const cover of tree.root.findAllByProps({ testID: 'exercise-video-cover' })) expect(StyleSheet.flatten(cover.props.style).aspectRatio).toBe(16 / 9);
  await act(async () => tree.root.findByType('flat-list').props.onViewableItemsChanged({ viewableItems: [{ item: items[3] }] }));
  expect(previews().map(row => row.props.active)).toEqual([false, false, false, true]);
  await open(4); expect(previews().every(row => row.props.active === false)).toBe(true);
  expect(tree.root.findAllByType('modal')).toHaveLength(1); expect(track).not.toHaveBeenCalled();
  await close(); expect(playback()).toBeUndefined(); expect(previews()[3].props.active).toBe(true);
});

test('only genuine playback is tracked under original identity; close settles the interval and rejects stale callbacks', async () => {
  Platform.OS = 'web'; await mount(); await open(1);
  const old = playback().props;
  expect(old.source).toBe(items[0].playbackValue);
  await act(async () => { old.onChangeState('playing', { positionMs: 500, durationMs: 10000 }); old.onChangeState('playing'); });
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenLastCalledWith('video.play', items[0], expect.objectContaining({ videoId: items[0].value }));
  now += 1200; await close();
  expect(track).toHaveBeenLastCalledWith('video.paused', items[0], expect.objectContaining({ videoId: items[0].value, watchedMs: 1200, completed: false }));
  await open(2); expect(playback().props.source).toBe(items[1].playbackValue);
  await act(async () => { old.onChangeState('playing'); old.onChangeState('ended'); }); expect(track).toHaveBeenCalledTimes(2);
  await act(async () => playback().props.onChangeState('playing')); now += 400;
  await act(async () => playback().props.onChangeState('ended'));
  expect(track).toHaveBeenLastCalledWith('video.completed', items[1], expect.objectContaining({ videoId: items[1].value, completed: true, watchedMs: 400 }));
  await close(); expect(track).toHaveBeenCalledTimes(4);
});

test('native back, background and focus loss remove playback and cannot falsely complete a video', async () => {
  await mount(); await open(1); expect(playback().props.source).toBe(items[0].value);
  const first = playback().props.onChangeState;
  await act(async () => first('playing')); now += 100;
  await act(async () => { for (const cb of mockAppListeners) cb('background'); first('ended'); });
  expect(playback()).toBeUndefined(); expect(track.mock.calls.map(row => row[0])).toEqual(['video.play', 'video.paused']);
  await act(async () => { for (const cb of mockAppListeners) cb('active'); }); await open(2);
  await act(async () => tree.root.findByType('modal').props.onRequestClose()); expect(playback()).toBeUndefined();
  await open(3); mockFocused = false;
  await act(async () => tree.update(<Gallery items={items} locale="zh" track={track} />));
  expect(playback()).toBeUndefined(); expect(previews().every(row => !row.props.active)).toBe(true);
});

test('browser fullscreen is requested in the press, refusal keeps the modal usable and late success is released after close', async () => {
  Platform.OS = 'web'; const listeners = {}, doc = { hidden: false, fullscreenElement: null, addEventListener: (name, cb) => { listeners[name] = cb; }, removeEventListener: jest.fn(), exitFullscreen: jest.fn(async () => { doc.fullscreenElement = null; }) };
  doc.documentElement = { requestFullscreen: jest.fn().mockRejectedValueOnce(new Error('denied')) }; global.document = doc;
  await mount(); await open(1); expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1); expect(playback()).toBeDefined();
  await close(); let resolve;
  doc.documentElement.requestFullscreen.mockImplementation(() => new Promise(done => { resolve = done; }));
  await open(2); await close(); doc.fullscreenElement = doc.documentElement;
  await act(async () => resolve()); expect(doc.exitFullscreen).toHaveBeenCalledTimes(1); expect(playback()).toBeUndefined();
});

test('a new card reuses pending browser fullscreen; late resolution belongs to that modal and closes exactly once', async () => {
  Platform.OS = 'web'; let resolve;
  const doc = { fullscreenElement: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), exitFullscreen: jest.fn(async () => { doc.fullscreenElement = null; }) };
  doc.documentElement = { requestFullscreen: jest.fn(() => new Promise(done => { resolve = done; })) }; global.document = doc;
  await mount(); await open(1); await close(); await open(2);
  expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1); expect(playback().props.source).toBe(items[1].playbackValue);
  doc.fullscreenElement = doc.documentElement; await act(async () => resolve());
  expect(doc.exitFullscreen).not.toHaveBeenCalled(); expect(playback()).toBeDefined();
  await close(); expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
});

test('embedded equipment videos use three previews per page without nesting a vertical virtualized list', async () => {
  await act(async () => { tree = renderer.create(<Gallery items={items} locale="en" track={track} embedded />); });
  expect(tree.root.findAllByType('flat-list')).toHaveLength(0);
  expect(previews()).toHaveLength(3);
  const next = tree.root.findAllByType('touchable').find(node => node.findAllByType('text').some(text => text.props.children === 'Next'));
  await act(async () => next.props.onPress());
  expect(previews()).toHaveLength(1); expect(previews()[0].props.source).toBe(items[3].value);
  await open(4); expect(playback().props.source).toBe(items[3].value);
  await close(); expect(previews()[0].props.active).toBe(true);
});
