import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Library from '../ExerciseVideoLibrary';
jest.mock('react-native', () => ({ View: 'view', Text: 'text', TouchableOpacity: 'button', StyleSheet: { create: value => value } }));
jest.mock('../ExerciseVideoGallery', () => 'gallery');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
afterEach(async () => { await act(async () => tree?.unmount()); tree = null; });
const items = [
  { id: 'old', contentType: 'video' },
  { id: 'in', contentType: 'video', videoCategory: 'indoor' },
  { id: 'out', contentType: 'video', videoCategory: 'outdoor' },
];
test('categories preserve server ordering and legacy access, and replace the player on category change', async () => {
  await act(async () => { tree = renderer.create(<Library items={items} locale="zh" />); });
  const initial = tree.root.findByType('gallery');
  expect(initial.props.items).toEqual(items);
  await act(async () => tree.root.findByProps({ testID: 'exercise-video-category-indoor' }).props.onPress());
  expect(tree.root.findByType('gallery')).not.toBe(initial);
  expect(tree.root.findByType('gallery').props.items).toEqual([items[1]]);
  expect(tree.root.findByProps({ testID: 'exercise-video-category-indoor' }).props.accessibilityState.selected).toBe(true);
  expect(tree.root.findByProps({ testID: 'exercise-video-category-indoor' }).props['aria-selected']).toBe(true);
  await act(async () => tree.root.findByProps({ testID: 'exercise-video-category-outdoor' }).props.onPress());
  expect(tree.root.findByType('gallery').props.items).toEqual([items[2]]);
});
test('load failures offer retry rather than showing a false empty category', async () => {
  const retry = jest.fn();
  await act(async () => { tree = renderer.create(<Library items={[]} locale="en" status="error" onRetry={retry} />); });
  expect(JSON.stringify(tree.toJSON())).toContain('Unable to load videos.');
  await act(async () => tree.root.findAllByType('button').find(node => node.props.onPress === retry).props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<Library items={[]} locale="en" status="ready" />));
  expect(JSON.stringify(tree.toJSON())).toContain('No videos published yet.');
});
