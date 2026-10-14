import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import ManagedContent from '../ManagedContent';
import { getPublicContent, sendResearchEvent } from '../../utils/api';
jest.mock('../../contexts/AuthContext', () => ({ AuthContext: require('react').createContext({ user: { token: 'local-fixture' } }) }));
jest.mock('../../contexts/LocaleContext', () => ({ LocaleContext: require('react').createContext({ locale: 'zh', i18n: { t: key => key } }) }));
jest.mock('../../utils/api', () => ({ getPublicContent: jest.fn(), sendResearchEvent: jest.fn(async () => ({})), resolveApiAssetUrl: value => value }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-youtube-iframe', () => 'mock-youtube');
jest.mock('../MediaVideo', () => 'mock-video');
jest.mock('../ExerciseVideoGallery', () => 'mock-exercise-gallery');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, originalOS;
const item = { id: 'content-one', contentType: 'video', title: 'Clip', value: '/api/media/original/original.mp4', playbackValue: '/api/media/original/hash.mp4' };
beforeEach(() => { originalOS = Platform.OS; Platform.OS = 'web'; jest.clearAllMocks(); getPublicContent.mockResolvedValue({ items: [item] }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; });
const mount = async () => act(async () => { tree = renderer.create(<ManagedContent pageKey="home" />); });
test('web chooses optimized content playback while research keeps the original video identity', async () => {
 await mount(); const video = tree.root.findByType('mock-video');
 expect(video.props.source).toBe(item.playbackValue);
 await act(async () => video.props.onChangeState('playing'));
 expect(sendResearchEvent).toHaveBeenCalledWith('local-fixture', 'video.play', expect.objectContaining({ contentId: item.id, videoId: item.value }));
});
test('native content playback keeps the original source', async () => {
 Platform.OS = 'android'; await mount(); expect(tree.root.findByType('mock-video').props.source).toBe(item.value);
});
test('old server responses continue to play their original source on web', async () => {
 getPublicContent.mockResolvedValue({ items: [{ ...item, playbackValue: undefined }] }); await mount();
 expect(tree.root.findByType('mock-video').props.source).toBe(item.value);
});

test('exercise videos alone use the full-screen gallery and preserve original tracking identity', async () => {
 getPublicContent.mockResolvedValue({ items: [item, { id: 'non-video', contentType: 'text', value: 'Other content' }] });
 await act(async () => { tree = renderer.create(<ManagedContent pageKey="exercise_videos" showStatus />); });
 const gallery = tree.root.findByType('mock-exercise-gallery');
 expect(gallery.props.items).toEqual([item]);
 expect(tree.root.findAllByType('mock-video')).toHaveLength(0);
 await act(async () => gallery.props.track('video.play', item, { videoId: item.value }));
 expect(sendResearchEvent).toHaveBeenCalledWith('local-fixture', 'video.play', expect.objectContaining({ screen: 'exercise_videos', contentId: item.id, videoId: item.value }));
});
