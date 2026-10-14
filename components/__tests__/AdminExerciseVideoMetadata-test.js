import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import AdminExerciseVideoMetadata, { useExerciseVideoCatalog } from '../AdminExerciseVideoMetadata';
import { getEquipmentCatalog } from '../../utils/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../../utils/api', () => ({ getEquipmentCatalog: jest.fn() }));
const equipment = ['0', '4', '6', '10'].map(id => ({ id, nameZh: `器材 ${id}`, isActive: true }));
let tree, latest;
function Editor({ initial, disabled = false, allowUncategorized = true, enabled = true }) {
  const [value, setValue] = useState(initial), catalog = useExerciseVideoCatalog(enabled);
  latest = value;
  return <AdminExerciseVideoMetadata value={value} onChange={setValue} catalog={catalog} disabled={disabled} allowUncategorized={allowUncategorized} />;
}
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === `exercise-video-metadata-${id}`);
const press = id => act(async () => button(id).props.onPress());
beforeEach(() => { jest.clearAllMocks(); getEquipmentCatalog.mockResolvedValue({ items: equipment }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test('an old empty record stays unclassified until its visible title suggestion is accepted', async () => {
  const initial = { id: 'old', title: '站立式低背伸展', value: '/api/media/old/video.mp4' };
  await act(async () => { tree = renderer.create(<Editor initial={initial} />); });
  expect(latest).toBe(initial);
  expect(button('category-uncategorized').props.accessibilityState.checked).toBe(true);
  await press('suggest');
  expect(latest).toMatchObject({ videoCategory: 'indoor', equipmentIds: ['6'] });
  expect(initial.videoCategory).toBeUndefined();
  await press('equipment-0');
  expect(latest.equipmentIds).toEqual(['6', '0']);
  await press('category-outdoor');
  expect(latest).toMatchObject({ videoCategory: 'outdoor', equipmentIds: [] });
});

test('unavailable legacy links are displayed and removable, never silently erased when catalog loads', async () => {
  await act(async () => { tree = renderer.create(<Editor initial={{ id: 'old', title: '旧片', videoCategory: 'indoor', equipmentIds: ['retired'] }} />); });
  expect(latest.equipmentIds).toEqual(['retired']);
  expect(button('missing-retired')).toBeDefined();
  await press('missing-retired');
  expect(latest.equipmentIds).toEqual([]);
});

test('legacy suggestion offers a catalog retry without forcing category or reintroducing inactive equipment', async () => {
  getEquipmentCatalog.mockRejectedValueOnce(new Error('offline'));
  const initial = { id: 'old', title: '坐式低背伸展' };
  await act(async () => { tree = renderer.create(<Editor initial={initial} />); });
  expect(button('suggest').props.disabled).toBe(true);
  getEquipmentCatalog.mockResolvedValueOnce({ items: [...equipment, { id: 'inactive', isActive: 0 }, { id: 'deleted', deletedAt: 123 }] });
  await press('retry');
  expect(latest).toBe(initial);
  await press('suggest');
  expect(latest.equipmentIds).toEqual(['6']);
  expect(button('equipment-inactive')).toBeUndefined(); expect(button('equipment-deleted')).toBeUndefined();
});

test('disabled uncertain batch payload cannot change category, links or apply a suggestion', async () => {
  const initial = { title: '坐式低背伸展', videoCategory: 'indoor', equipmentIds: ['6'] };
  await act(async () => { tree = renderer.create(<Editor initial={initial} disabled />); });
  await press('category-outdoor'); await press('equipment-0'); await press('suggest');
  expect(latest).toBe(initial);
});

test('retry replaces stale availability without resetting selected IDs and ignores a late disabled request', async () => {
  let resolveOld;
  getEquipmentCatalog.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const initial = { title: '旧片', videoCategory: 'indoor', equipmentIds: ['6'] };
  await act(async () => { tree = renderer.create(<Editor initial={initial} />); });
  await act(async () => { tree.update(<Editor initial={initial} enabled={false} />); });
  await act(async () => resolveOld({ items: [{ id: 'wrong' }] }));
  expect(button('equipment-wrong')).toBeUndefined();
  expect(latest.equipmentIds).toEqual(['6']);
});
