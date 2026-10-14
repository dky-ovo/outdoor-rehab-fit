import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import Surface from '../ExerciseVideoSurface';
jest.mock('react-native-webview', () => ({ WebView: 'mock-webview' }));
jest.mock('../../utils/api', () => ({ resolveApiAssetUrl: value => value }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const source = 'https://host/video.mp4';
const message = state => ({ nativeEvent: { data: JSON.stringify({ type: 'facility-video', state, positionMs: 2000, durationMs: 10000 }) } });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const mount = async props => act(async () => { tree = renderer.create(<Surface source={source} {...props} />); });

test('native previews cannot play full screen, navigate, or emit watching; inactive covers unmount the WebView', async () => {
  const change = jest.fn(); await mount({ preview: true, onChangeState: change });
  const p = tree.root.findByType('mock-webview').props;
  expect(p.mediaPlaybackRequiresUserAction).toBe(true); expect(p.allowsFullscreenVideo).toBe(false);
  expect(p.allowFileAccess).toBe(false); expect(p.mixedContentMode).toBe('never');
  expect(p.onShouldStartLoadWithRequest({ url: 'https://evil.example', isTopFrame: true })).toBe(false);
  await act(async () => { p.onMessage(message('playing')); p.onMessage(message('ended')); });
  expect(change).not.toHaveBeenCalled();
  await act(async () => tree.update(<Surface source={source} preview active={false} onChangeState={change} />));
  expect(tree.root.findAllByType('mock-webview')).toHaveLength(0);
});

test('native playback forwards real state, retries errors and rejects callbacks from the replaced generation', async () => {
  const change = jest.fn(); await mount({ onChangeState: change });
  const old = tree.root.findByType('mock-webview').props;
  expect(old.mediaPlaybackRequiresUserAction).toBe(false); expect(old.allowsFullscreenVideo).toBe(true);
  await act(async () => { old.onMessage(message('playing')); old.onMessage(message('error')); });
  expect(tree.root.findAllByType('mock-webview')).toHaveLength(0);
  await act(async () => tree.root.findByType(TouchableOpacity).props.onPress());
  const fresh = tree.root.findByType('mock-webview').props;
  await act(async () => { old.onMessage(message('ended')); fresh.onMessage(message('playing')); });
  expect(change.mock.calls.map(([state]) => state)).toEqual(['playing', 'error', 'playing']);
  await act(async () => tree.unmount()); tree = null;
  fresh.onMessage(message('ended')); expect(change).toHaveBeenCalledTimes(3);
});
