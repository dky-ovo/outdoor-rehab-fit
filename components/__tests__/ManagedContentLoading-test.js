import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import ManagedContent from '../ManagedContent';
import { LocaleContext } from '../../contexts/LocaleContext';
import { PUBLIC_CONTENT_REQUEST_TIMEOUT_MS } from '../../utils/api';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../contexts/AuthContext', () => ({ AuthContext: require('react').createContext({ user: null }) }));
jest.mock('../../contexts/LocaleContext', () => ({ LocaleContext: require('react').createContext({ locale: 'zh', i18n: { t: key => key } }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-youtube-iframe', () => 'mock-youtube');
jest.mock('../MediaVideo', () => 'mock-video');
jest.mock('../ExerciseVideoGallery', () => 'mock-exercise-gallery');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = global.fetch;
const response = items => ({ ok: true, status: 200, json: async () => ({ items }) });
const item = id => ({ id, contentType: 'video', title: id, value: `/api/media/${id}/video.mp4` });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
let tree;
const labels = () => tree.root.findAllByType(Text).map(node => node.props.children);
const mount = async element => act(async () => { tree = renderer.create(element || <ManagedContent pageKey="exercise_videos" showStatus />); });
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(async () => {
  if (tree) await act(async () => tree.unmount()); tree = null;
  jest.useRealTimers(); global.fetch = originalFetch;
});

test.each(['fetch', 'body'])('a stalled %s changes loading to retryable error, and a late old result cannot replace a retry', async stage => {
  const old = deferred();
  global.fetch.mockImplementationOnce(stage === 'fetch' ? () => old.promise : async () => ({ ok: true, status: 200, json: () => old.promise }));
  await mount();
  expect(labels()).toContain('載入影片中…');
  await act(async () => { await jest.advanceTimersByTimeAsync(PUBLIC_CONTENT_REQUEST_TIMEOUT_MS); });
  expect(labels()).toContain('暫時無法載入影片。');
  expect(labels()).not.toContain('載入影片中…');
  global.fetch.mockResolvedValueOnce(response([item('fresh')]));
  const retry = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === '重試'));
  await act(async () => retry.props.onPress());
  expect(tree.root.findByType('mock-exercise-gallery').props.items.map(value => value.id)).toEqual(['fresh']);
  await act(async () => old.resolve(stage === 'fetch' ? response([item('stale')]) : { items: [item('stale')] }));
  expect(tree.root.findByType('mock-exercise-gallery').props.items.map(value => value.id)).toEqual(['fresh']);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('unmount aborts an unfinished content request immediately and removes its timer', async () => {
  const timeout = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  const pending = deferred(); global.fetch.mockReturnValue(pending.promise);
  await mount();
  const signal = global.fetch.mock.calls[0][1].signal;
  const deadlineIndex = timeout.mock.calls.findIndex(call => call[1] === PUBLIC_CONTENT_REQUEST_TIMEOUT_MS);
  expect(deadlineIndex).toBeGreaterThanOrEqual(0);
  const deadline = timeout.mock.results[deadlineIndex].value;
  expect(signal.aborted).toBe(false);
  await act(async () => tree.unmount()); tree = null;
  expect(signal.aborted).toBe(true);
  expect(clear).toHaveBeenCalledWith(deadline);
  await act(async () => pending.resolve(response([item('old-page')])));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  timeout.mockRestore(); clear.mockRestore();
});

test('changing locale cancels the previous instance and displays only the latest load', async () => {
  const old = deferred(); global.fetch.mockReturnValueOnce(old.promise);
  const screen = locale => <LocaleContext.Provider value={{ locale, i18n: { t: key => key } }}><ManagedContent pageKey="exercise_videos" showStatus /></LocaleContext.Provider>;
  await mount(screen('zh'));
  const oldSignal = global.fetch.mock.calls[0][1].signal;
  global.fetch.mockResolvedValueOnce(response([item('english')]));
  await act(async () => tree.update(screen('en')));
  expect(oldSignal.aborted).toBe(true);
  expect(tree.root.findByType('mock-exercise-gallery').props.locale).toBe('en');
  await act(async () => old.resolve(response([item('stale-zh')])));
  expect(tree.root.findByType('mock-exercise-gallery').props.items.map(value => value.id)).toEqual(['english']);
});
