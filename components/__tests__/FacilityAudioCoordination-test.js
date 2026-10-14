import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import AudioPlayer from '../AudioPlayer';
import TTSButton from '../TTSButton';
import { ensurePlaybackAudioMode } from '../../utils/audioMode';
import { showAlert } from '../../utils/alert';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockReleased = false;
let mockStatus;
const mockPlayer = { volume: 1, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() };
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => {
    // Expo's earlier hook releases its shared object before our own cleanup.
    require('react').useEffect(() => () => { mockReleased = true; }, []);
    return mockPlayer;
  },
  useAudioPlayerStatus: () => mockStatus,
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn() }));
jest.mock('../../utils/audioMode', () => ({ ensurePlaybackAudioMode: jest.fn() }));
jest.mock('../../utils/usage', () => ({ trackTtsPlay: jest.fn() }));
jest.mock('../../utils/alert', () => ({ showAlert: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', MaterialIcons: 'MaterialIcons' }));
jest.mock('react-native-responsive-fontsize', () => ({ RFValue: (value) => value }));

const i18n = { t: (key) => key };
let tree; let listeners; let deferrals;
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  deferrals.push(resolve);
  return { promise, resolve };
}
function fixture({ audio = true, tts = true, audioFile = 1, onPlayStart, onPlaybackSample, onSpokenRange, inline = true, text = 'Read this section.' } = {}) {
  return <>
    {audio && <AudioPlayer key="audio" audioFile={audioFile} onPlayStart={onPlayStart} onPlaybackSample={onPlaybackSample} />}
    {tts && <TTSButton key="tts" text={text} locale="en" i18n={i18n} inline={inline} onSpokenRange={onSpokenRange} />}
  </>;
}
const mount = async (props) => act(async () => { tree = renderer.create(fixture(props)); });
const update = async (props) => act(async () => { tree.update(fixture(props)); });
const audioPress = () => tree.root.findByType(AudioPlayer).findAllByType(TouchableOpacity)[0].props.onPress();
const ttsPress = () => tree.root.findByType(TTSButton).findByType(TouchableOpacity).props.onPress();
beforeEach(() => {
  jest.clearAllMocks(); deferrals = []; mockFocused = true; mockReleased = false;
  mockStatus = { playing: false, currentTime: 31, duration: 100, didJustFinish: false };
  mockPlayer.play.mockImplementation(() => { if (mockReleased) throw new Error('released'); });
  mockPlayer.pause.mockImplementation(() => { if (mockReleased) throw new Error('released'); });
  mockPlayer.seekTo.mockResolvedValue();
  Speech.stop.mockResolvedValue(); Speech.getAvailableVoicesAsync.mockResolvedValue([]);
  ensurePlaybackAudioMode.mockResolvedValue();
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; });
});
afterEach(async () => {
  await act(async () => { deferrals.forEach((resolve) => resolve([])); await flush(); if (tree) tree.unmount(); await flush(); });
  tree = null; jest.restoreAllMocks();
});

test('text reading pauses playing guidance immediately without seeking, and Play resumes the same position', async () => {
  await mount(); await act(async () => audioPress());
  mockStatus = { ...mockStatus, playing: true }; await update();
  const stop = deferred(); Speech.stop.mockImplementationOnce(() => stop.promise);
  let reading;
  await act(async () => { reading = ttsPress(); await flush(); });
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  expect(mockPlayer.seekTo).not.toHaveBeenCalled(); expect(Speech.speak).not.toHaveBeenCalled();
  await act(async () => { stop.resolve(); await reading; });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  await act(async () => audioPress());
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  expect(mockPlayer.seekTo).not.toHaveBeenCalled();
  expect(mockStatus.currentTime).toBe(31);
});

test('starting guidance stops TTS before playing and ignores old speech completion credit', async () => {
  const range = jest.fn(); await mount({ onSpokenRange: range }); await act(async () => ttsPress());
  const speech = Speech.speak.mock.calls[0][1]; await act(async () => speech.onStart());
  const stop = deferred(); Speech.stop.mockImplementationOnce(() => stop.promise); let play;
  await act(async () => { play = audioPress(); await flush(); });
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await act(async () => { speech.onDone(); stop.resolve(); await play; });
  expect(range).not.toHaveBeenCalled(); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

test('pending guidance is cancelled by TTS and does not resurrect after audio mode resolves', async () => {
  const mode = deferred(); ensurePlaybackAudioMode.mockImplementationOnce(() => mode.promise);
  const started = jest.fn(); await mount({ onPlayStart: started }); let play;
  await act(async () => { play = audioPress(); await flush(); });
  await act(async () => ttsPress());
  await act(async () => { mode.resolve(); await play; });
  expect(Speech.speak).toHaveBeenCalledTimes(1); expect(mockPlayer.play).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
});

test('a second tap cancels pending guidance instead of starting another request', async () => {
  const mode = deferred(); ensurePlaybackAudioMode.mockImplementationOnce(() => mode.promise);
  const started = jest.fn(); await mount({ onPlayStart: started }); let play;
  await act(async () => { play = audioPress(); await flush(); });
  await act(async () => audioPress());
  await act(async () => { mode.resolve(); await play; });
  expect(mockPlayer.play).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
  expect(ensurePlaybackAudioMode).toHaveBeenCalledTimes(1);
});

test('a second tap before the native playing event pauses the accepted play without restarting', async () => {
  await mount(); await act(async () => audioPress()); await act(async () => audioPress());
  expect(mockPlayer.play).toHaveBeenCalledTimes(1); expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
});

test('cancelled voice lookup cannot speak after guidance takes ownership', async () => {
  const voices = deferred(); Speech.getAvailableVoicesAsync.mockImplementationOnce(() => voices.promise);
  await mount(); let reading;
  await act(async () => { reading = ttsPress(); await flush(); });
  await act(async () => audioPress());
  await act(async () => { voices.resolve([]); await reading; });
  expect(Speech.speak).not.toHaveBeenCalled(); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

test('older asynchronous Speech.stop completes before the newest utterance, with only the last request playing', async () => {
  const stop = deferred(); Speech.stop.mockImplementationOnce(() => stop.promise);
  await mount(); let first; let middle; let last;
  await act(async () => { first = ttsPress(); await flush(); middle = audioPress(); last = ttsPress(); await flush(); });
  expect(Speech.stop).toHaveBeenCalledTimes(1); expect(Speech.speak).not.toHaveBeenCalled();
  await act(async () => { stop.resolve(); await Promise.all([first, middle, last]); });
  expect(Speech.speak).toHaveBeenCalledTimes(1); expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(Speech.stop.mock.invocationCallOrder.at(-1)).toBeLessThan(Speech.speak.mock.invocationCallOrder[0]);
});

test('changing the source with the same player cancels pending play and keeps learning callbacks scoped', async () => {
  const mode = deferred(); ensurePlaybackAudioMode.mockImplementationOnce(() => mode.promise);
  const oldStart = jest.fn(); const newStart = jest.fn(); const oldSample = jest.fn(); const newSample = jest.fn();
  await mount({ onPlayStart: oldStart, onPlaybackSample: oldSample }); let play;
  await act(async () => { play = audioPress(); await flush(); });
  await update({ audioFile: 2, onPlayStart: newStart, onPlaybackSample: newSample });
  await act(async () => { mode.resolve(); await play; });
  expect(mockPlayer.play).not.toHaveBeenCalled(); expect(oldStart).not.toHaveBeenCalled();
  expect(newSample.mock.calls.every(([state]) => state === 'inactive')).toBe(true);
  await act(async () => audioPress()); expect(newStart).toHaveBeenCalledTimes(1); expect(oldStart).not.toHaveBeenCalled();
});

test('unmount after native release is safe and cannot stop a newer TTS owner', async () => {
  await mount(); await act(async () => audioPress()); await act(async () => ttsPress());
  const stopped = Speech.stop.mock.calls.length;
  await update({ audio: false });
  expect(mockReleased).toBe(true); expect(Speech.stop).toHaveBeenCalledTimes(stopped);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
});

test('background cancels a pending play and requires a new user request', async () => {
  const mode = deferred(); ensurePlaybackAudioMode.mockImplementationOnce(() => mode.promise);
  await mount(); let play;
  await act(async () => { play = audioPress(); await flush(); listeners.forEach((callback) => callback('background')); });
  await act(async () => { mode.resolve(); await play; listeners.forEach((callback) => callback('active')); });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

test('a stale confirmation from an unmounted passage cannot interrupt newer audio', async () => {
  await mount({ inline: false });
  await act(async () => tree.root.findAll((node) => typeof node.props?.onAccessibilityTap === 'function')[0].props.onAccessibilityTap());
  const confirm = showAlert.mock.calls[0][2][1].onPress;
  await update({ tts: false }); await act(async () => audioPress());
  const paused = mockPlayer.pause.mock.calls.length; const stopped = Speech.stop.mock.calls.length;
  await act(async () => confirm());
  expect(mockPlayer.pause).toHaveBeenCalledTimes(paused); expect(Speech.stop).toHaveBeenCalledTimes(stopped); expect(Speech.speak).not.toHaveBeenCalled();
});

test('finished guidance still replays from the beginning on an explicit play', async () => {
  await mount(); await act(async () => audioPress());
  mockStatus = { ...mockStatus, currentTime: 100, playing: false, didJustFinish: true }; await update();
  await act(async () => audioPress());
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(0); expect(mockPlayer.play).toHaveBeenCalledTimes(2);
});

test('unmount of the active owner tolerates Expo releasing the player before cleanup', async () => {
  await mount(); await act(async () => audioPress());
  await update({ audio: false });
  expect(mockReleased).toBe(true);
  await act(async () => ttsPress()); expect(Speech.speak).toHaveBeenCalledTimes(1);
});

test('a pending replay seek cannot start audio after TTS takes over', async () => {
  mockStatus = { ...mockStatus, currentTime: 100, didJustFinish: true };
  const seek = deferred(); mockPlayer.seekTo.mockImplementationOnce(() => seek.promise);
  await mount(); let play;
  await act(async () => { play = audioPress(); await flush(); });
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
  await act(async () => ttsPress());
  await act(async () => { seek.resolve(); await play; });
  expect(mockPlayer.play).not.toHaveBeenCalled(); expect(Speech.speak).toHaveBeenCalledTimes(1);
});

test('native stop failure prevents overlapping play and a later explicit retry can recover', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  Speech.stop.mockRejectedValueOnce(new Error('native stop failed'));
  await mount(); await act(async () => audioPress());
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await act(async () => ttsPress()); expect(Speech.speak).toHaveBeenCalledTimes(1);
});

test('replacing TTS text cancels its late voice lookup and resets the reading control', async () => {
  const voices = deferred(); Speech.getAvailableVoicesAsync.mockImplementationOnce(() => voices.promise);
  await mount(); let reading;
  await act(async () => { reading = ttsPress(); await flush(); });
  await update({ text: 'Different section.' });
  await act(async () => { voices.resolve([]); await reading; });
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(tree.root.findByType(TTSButton).findByType(TouchableOpacity).props.accessibilityLabel).toBe('readAloud');
  await act(async () => ttsPress()); expect(Speech.speak.mock.calls[0][0]).toBe('Different section.');
});
