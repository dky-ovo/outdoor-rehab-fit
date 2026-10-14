import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Surface from '../ExerciseVideoSurface.web';
jest.mock('../../utils/api', () => ({ resolveApiAssetUrl: value => value }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const source = 'https://host/video.mp4';
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const player = () => tree.root.findByType('video');
async function mount(props = {}, node = {}) {
  const element = { currentTime: 0, duration: 2, readyState: 0, ended: false, paused: true, play: jest.fn(() => Promise.resolve()), pause: jest.fn(), ...node };
  await act(async () => { tree = renderer.create(<Surface source={source} {...props} />, { createNodeMock: el => el.type === 'video' ? element : null }); });
  return element;
}

test('web covers seek a short clip without playing or emitting research and honor visibility', async () => {
  const change = jest.fn(), node = await mount({ preview: true, onChangeState: change });
  const p = player().props;
  expect(p.muted).toBe(true); expect(p.controls).toBe(false); expect(p.autoPlay).toBe(false); expect(p.tabIndex).toBe(-1);
  expect(p.style.objectFit).toBe('cover'); expect(node.play).not.toHaveBeenCalled();
  await act(async () => p.onLoadedMetadata({ currentTarget: node })); expect(node.currentTime).toBe(.5);
  node.readyState = 2; await act(async () => p.onSeeked({ currentTarget: node }));
  expect(JSON.stringify(tree.toJSON())).not.toContain('載入預覽');
  await act(async () => { p.onPlay({ currentTarget: node }); p.onPlaying({ currentTarget: node }); p.onEnded({ currentTarget: node }); });
  expect(node.pause).toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  await act(async () => tree.update(<Surface source={source} preview active={false} onChangeState={change} />));
  expect(tree.root.findAllByType('video')).toHaveLength(0);
});

test('web rejected autoplay offers explicit playback; errors can retry without accepting late old events', async () => {
  const change = jest.fn(), node = await mount({ onChangeState: change }, { play: jest.fn().mockRejectedValueOnce(new Error('NotAllowed')).mockResolvedValue(undefined) });
  expect(tree.root.findByType('button').props.children).toBe('播放影片');
  await act(async () => tree.root.findByType('button').props.onClick()); expect(node.play).toHaveBeenCalledTimes(2);
  const old = player().props;
  await act(async () => old.onPlaying({ currentTarget: node })); expect(tree.root.findAllByType('button')).toHaveLength(0);
  await act(async () => old.onError({ currentTarget: node })); expect(tree.root.findAllByType('video')).toHaveLength(0);
  expect(tree.root.findByType('button').props.children).toBe('重試');
  await act(async () => tree.root.findByType('button').props.onClick());
  const fresh = player().props;
  await act(async () => { old.onPlaying({ currentTarget: node }); old.onEnded({ currentTarget: node }); fresh.onPlaying({ currentTarget: node }); });
  expect(change.mock.calls.map(([state]) => state)).toEqual(['playing', 'error', 'playing']);
  expect(fresh.style.objectFit).toBe('contain');
});

test('web preview failure remains a quiet poster fallback without a misleading watched event', async () => {
  const change = jest.fn(), node = await mount({ preview: true, onChangeState: change });
  await act(async () => player().props.onError({ currentTarget: node }));
  expect(JSON.stringify(tree.toJSON())).toContain('暫無預覽'); expect(change).not.toHaveBeenCalled();
});

test('returning preview cannot reuse readiness from a previous visibility generation', async () => {
  const node = await mount({ preview: true }); const old = player().props;
  await act(async () => old.onLoadedMetadata({ currentTarget: node })); node.readyState = 2;
  await act(async () => old.onSeeked({ currentTarget: node })); expect(JSON.stringify(tree.toJSON())).not.toContain('載入預覽');
  await act(async () => tree.update(<Surface source={source} preview active={false} />));
  await act(async () => tree.update(<Surface source={source} preview active />));
  expect(JSON.stringify(tree.toJSON())).toContain('載入預覽');
  await act(async () => old.onSeeked({ currentTarget: node })); expect(JSON.stringify(tree.toJSON())).toContain('載入預覽');
  await act(async () => player().props.onLoadedMetadata({ currentTarget: node })); expect(JSON.stringify(tree.toJSON())).not.toContain('載入預覽');
});
