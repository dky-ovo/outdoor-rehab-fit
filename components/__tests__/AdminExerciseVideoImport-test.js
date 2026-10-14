import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput, TouchableOpacity } from 'react-native';
import AdminExerciseVideoImport from '../AdminExerciseVideoImport';
import { createAdminContent, getAdminContent, getEquipmentCatalog } from '../../utils/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../AdminMediaLibrary', () => props => require('react').createElement('mock-media-picker', props));
jest.mock('../../utils/api', () => ({ createAdminContent: jest.fn(), getAdminContent: jest.fn(), getEquipmentCatalog: jest.fn() }));
const files = ['a', 'b'].map(id => ({ id, name: `影片${id}.mp4`, kind: 'video', url: `/api/media/${id}/video.mp4` }));
let tree;
const button = id => tree.root.findAllByType(TouchableOpacity).find(x => x.props.testID === id);
const press = id => act(async () => button(id).props.onPress());
beforeEach(() => { jest.clearAllMocks(); getAdminContent.mockResolvedValue({ items: [] }); createAdminContent.mockImplementation(async (_token, data) => ({ id: data.clientRequestId })); getEquipmentCatalog.mockResolvedValue({ items: ['0', '4', '6', '10'].map(id => ({ id, nameZh: `器材${id}`, isActive: true })) }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test('picker accepts multiple stored videos, permits title editing and keeps partial results for exact retry', async () => {
  const saved = jest.fn();
  await act(async () => { tree = renderer.create(<AdminExerciseVideoImport visible token="auth" permissions={[]} onClose={jest.fn()} onSaved={saved} />); });
  const picker = tree.root.findByType('mock-media-picker'); expect(picker.props.multiple).toBe(true);
  await act(async () => picker.props.onSelect(files));
  const title = tree.root.findAllByType(TextInput).find(x => x.props.testID === 'exercise-video-title-a');
  expect(title.props.value).toBe('影片a');
  await act(async () => title.props.onChangeText('自订标题'));
  expect(button('exercise-video-import-save').props.disabled).toBe(true);
  await press('exercise-video-batch-category-outdoor');
  createAdminContent.mockImplementationOnce(async (_token, payload) => ({ id: payload.clientRequestId })).mockRejectedValueOnce({ code: 'networkError' });
  await press('exercise-video-import-save');
  expect(createAdminContent.mock.calls[0][1].title).toBe('自订标题'); expect(saved).toHaveBeenCalledTimes(1);
  const failed = createAdminContent.mock.calls[1][1];
  expect(tree.root.findAllByType(TextInput).every(x => x.props.editable === false)).toBe(true);
  createAdminContent.mockImplementation(async (_token, payload) => ({ id: payload.clientRequestId, replayed: true }));
  await press('exercise-video-import-save');
  expect(createAdminContent).toHaveBeenCalledTimes(3); expect(createAdminContent.mock.calls[2][1]).toEqual(failed);
  expect(button('exercise-video-import-save').props.disabled).toBe(true);
});

test('filename suggestions are visible and editable per video after selecting a uniform category', async () => {
  await act(async () => { tree = renderer.create(<AdminExerciseVideoImport visible token="auth" permissions={[]} onClose={jest.fn()} />); });
  await act(async () => tree.root.findByType('mock-media-picker').props.onSelect([{ ...files[0], name: '手臂關節活動.mp4' }, files[1]]));
  expect(button('exercise-video-a-equipment-0').props.accessibilityState.checked).toBe(true);
  expect(button('exercise-video-import-save').props.disabled).toBe(true);
  await press('exercise-video-batch-category-indoor');
  await press('exercise-video-a-equipment-6');
  await press('exercise-video-b-category-outdoor');
  await press('exercise-video-import-save');
  expect(createAdminContent.mock.calls[0][1]).toMatchObject({ videoCategory: 'indoor', equipmentIds: ['0', '6'] });
  expect(createAdminContent.mock.calls[1][1]).toMatchObject({ videoCategory: 'outdoor', equipmentIds: [] });
  expect(getEquipmentCatalog).toHaveBeenCalledWith({ forceRefresh: true });
});

test('unavailable suggested equipment blocks publication until association is removed or catalog is retried', async () => {
  getEquipmentCatalog.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { tree = renderer.create(<AdminExerciseVideoImport visible token="auth" permissions={[]} onClose={jest.fn()} />); });
  await act(async () => tree.root.findByType('mock-media-picker').props.onSelect([{ ...files[0], name: '坐式低背伸展.mp4' }]));
  expect(button('exercise-video-import-save').props.disabled).toBe(true);
  await press('exercise-video-a-retry');
  expect(button('exercise-video-a-equipment-6').props.accessibilityState.checked).toBe(true);
  expect(button('exercise-video-import-save').props.disabled).toBe(false);
});

test('reselecting files does not duplicate drafts or replace edited titles', async () => {
  await act(async () => { tree = renderer.create(<AdminExerciseVideoImport visible token="auth" permissions={[]} onClose={jest.fn()} />); });
  await act(async () => tree.root.findByType('mock-media-picker').props.onSelect([files[0]]));
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('保留这个标题'));
  await press('exercise-video-import-add');
  await act(async () => tree.root.findByType('mock-media-picker').props.onSelect(files));
  const inputs = tree.root.findAllByType(TextInput); expect(inputs).toHaveLength(2); expect(inputs[0].props.value).toBe('保留这个标题');
  expect(createAdminContent).not.toHaveBeenCalled();
});
