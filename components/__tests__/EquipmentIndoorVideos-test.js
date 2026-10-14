import React from 'react';
import renderer, { act } from 'react-test-renderer';
import IndoorVideos from '../EquipmentIndoorVideos';
import { getPublicContent, sendResearchEvent } from '../../utils/api';
jest.mock('react-native', () => ({ View: 'view', Text: 'text', TouchableOpacity: 'button' }));
jest.mock('../Collapsible', () => ({ Collapsible: props => require('react').createElement('section', props, props.children) }));
jest.mock('../ExerciseVideoGallery', () => 'gallery');
jest.mock('../../utils/api', () => ({ getPublicContent: jest.fn(), sendResearchEvent: jest.fn(async () => ({})) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const user = { token: 'local-test-token' };
const linked = { id: 'inside', contentType: 'video', videoCategory: 'indoor', equipmentIds: ['6'], value: '/api/media/example.mp4' };
beforeEach(() => { jest.clearAllMocks(); getPublicContent.mockResolvedValue({ items: [linked, { id: 'unlinked', title: '站立式低背伸展', contentType: 'video' }] }); });
afterEach(async () => { await act(async () => tree?.unmount()); tree = null; });
test('only linked indoor videos appear and keep content identity without completing the main equipment lesson', async () => {
  await act(async () => { tree = renderer.create(<IndoorVideos equipmentId="6" locale="zh" user={user} />); });
  const gallery = tree.root.findByType('gallery');
  expect(gallery.props.items).toEqual([linked]); expect(gallery.props.embedded).toBe(true);
  await act(async () => gallery.props.track('video.completed', linked, { videoId: linked.value, watchedMs: 5000 }));
  expect(sendResearchEvent).toHaveBeenCalledWith(user.token, 'video.completed', expect.objectContaining({ equipmentId: '6', contentId: linked.id, videoCategory: 'indoor', videoId: linked.value }));
});
test('disabled detail does not fetch; equipment with no association has no empty area', async () => {
  await act(async () => { tree = renderer.create(<IndoorVideos equipmentId="6" locale="zh" user={user} enabled={false} />); });
  expect(getPublicContent).not.toHaveBeenCalled(); expect(tree.toJSON()).toBeNull();
  await act(async () => tree.update(<IndoorVideos equipmentId="10" locale="zh" user={user} />));
  expect(tree.toJSON()).toBeNull();
});
test('late responses cannot leak the previous equipment videos into another detail', async () => {
  let resolve;
  getPublicContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = renderer.create(<IndoorVideos equipmentId="6" locale="zh" user={user} />); });
  await act(async () => tree.update(<IndoorVideos equipmentId="10" locale="zh" user={user} />));
  await act(async () => resolve({ items: [linked] }));
  expect(tree.toJSON()).toBeNull();
});
test('failed loading can retry without changing any saved associations', async () => {
  getPublicContent.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { tree = renderer.create(<IndoorVideos equipmentId="6" locale="zh" user={user} />); });
  expect(JSON.stringify(tree.toJSON())).toContain('重試');
  await act(async () => tree.root.findByType('button').props.onPress());
  expect(tree.root.findByType('gallery').props.items).toEqual([linked]);
});
