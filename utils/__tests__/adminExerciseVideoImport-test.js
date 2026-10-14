import { appendExerciseVideoDrafts, applyExerciseVideoDraftCategory, exerciseVideoTitle, publishExerciseVideoDrafts } from '../adminExerciseVideoImport';

const video = (id, name = id + '.mp4') => ({ id, name, kind: 'video', url: `/api/media/${id}/video.mp4`, mimeType: 'video/mp4' });
const build = (...files) => { let n = 0; return appendExerciseVideoDrafts([], files, [], () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, { videoCategory: 'outdoor' }); };

test('titles use readable filenames, preserve internal dots and prefer original filenames when available', () => {
  expect(exerciseVideoTitle(video('one', ' 膝部.教学.MP4 '))).toBe('膝部.教学');
  expect(exerciseVideoTitle({ ...video('two', '存储改名.mp4'), originalName: '原始影片.mov' })).toBe('原始影片');
  expect(exerciseVideoTitle(video('three', '没有扩展名'))).toBe('没有扩展名');
});
test('selection order is stable and duplicate, existing, archived and non-video media do not create drafts', () => {
  let n = 0; const id = () => 'request-' + ++n;
  const before = appendExerciseVideoDrafts([], [video('two'), video('one')], [], id);
  before[0].title = '自订标题';
  const next = appendExerciseVideoDrafts(before, [video('one'), video('three'), video('three'), video('existing'),
    { ...video('bad'), archived: true }, { ...video('image'), kind: 'image' }], [{ pageKey: 'exercise_videos', value: video('existing').url }], id);
  expect(next.map(x => x.mediaId)).toEqual(['two', 'one', 'three']); expect(next[0].title).toBe('自订标题'); expect(n).toBe(3);
});
test('partial save retains exact IDs and payloads, skips acknowledged success and retries only unfinished entries', async () => {
  const drafts = build(video('a'), video('b'), video('c')); let latest;
  const request = jest.fn().mockImplementationOnce(async data => ({ id: data.clientRequestId }))
    .mockRejectedValueOnce({ code: 'networkError' });
  await publishExerciseVideoDrafts({ drafts, listContent: async () => ({ items: [{ pageKey: 'exercise_videos', sortOrder: 9, value: '/api/media/old/x.mp4' }] }),
    createContent: request, onChange: value => { latest = value; } });
  expect(latest.map(x => x.status)).toEqual(['saved', 'failed', 'pending']);
  expect(request.mock.calls.map(([x]) => x.sortOrder)).toEqual([10, 11]);
  const uncertain = request.mock.calls[1][0];
  const retry = jest.fn(async data => ({ id: data.clientRequestId, replayed: data.value === video('b').url }));
  const result = await publishExerciseVideoDrafts({ drafts: latest,
    listContent: async () => ({ items: [{ ...uncertain, pageKey: 'exercise_videos', id: uncertain.clientRequestId }] }),
    createContent: retry, onChange: value => { latest = value; } });
  expect(retry.mock.calls).toHaveLength(2); expect(retry.mock.calls[0][0]).toEqual(uncertain);
  expect(retry.mock.calls[1][0].sortOrder).toBe(12); expect(result.every(x => x.status === 'saved')).toBe(true);
});
test('fresh server list suppresses already added files without changing existing titles', async () => {
  const create = jest.fn(async data => ({ id: data.clientRequestId }));
  const result = await publishExerciseVideoDrafts({ drafts: build(video('a'), video('b')), listContent: async () => ({ items: [
    { id: 'old-a', pageKey: 'exercise_videos', title: '已编辑标题', value: video('a').url, sortOrder: 8 }] }), createContent: create, onChange: () => {} });
  expect(result[0].status).toBe('skipped'); expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toMatchObject({ value: video('b').url, sortOrder: 9 });
});
test('account switch stops the batch and late responses do not update another account', async () => {
  let current = true; const changes = [];
  const create = jest.fn(async data => { current = false; return { id: data.clientRequestId }; });
  await publishExerciseVideoDrafts({ drafts: build(video('a'), video('b')), listContent: async () => ({ items: [] }),
    createContent: create, onChange: value => changes.push(value), isCurrent: () => current });
  expect(create).toHaveBeenCalledTimes(1); expect(changes).toHaveLength(1); expect(changes[0][0].status).toBe('saving');
});

test('only exact known filenames suggest indoor links; ordinary files remain unclassified until chosen', () => {
  const drafts = appendExerciseVideoDrafts([], [video('a', '站立式低背伸展.mp4'), video('b', '前後腳站立伸展運動.mov'), video('c', '其他影片.mp4')]);
  expect(drafts.map(({ videoCategory, equipmentIds }) => ({ videoCategory, equipmentIds }))).toEqual([
    { videoCategory: 'indoor', equipmentIds: ['6'] }, { videoCategory: 'indoor', equipmentIds: ['4', '10'] }, { videoCategory: '', equipmentIds: [] },
  ]);
  expect(appendExerciseVideoDrafts([], [video('a', '站立式低背伸展.mp4')], [], undefined, { videoCategory: 'outdoor' })[0]).toMatchObject({ videoCategory: 'outdoor', equipmentIds: [] });
});

test('unclassified new video is rejected before any API operation', async () => {
  const listContent = jest.fn(), createContent = jest.fn();
  await expect(publishExerciseVideoDrafts({ drafts: appendExerciseVideoDrafts([], [video('a')]), listContent, createContent, onChange: jest.fn() })).rejects.toThrow('CONTENT_VIDEO_CATEGORY_REQUIRED');
  expect(listContent).not.toHaveBeenCalled(); expect(createContent).not.toHaveBeenCalled();
});

test('uniform edits do not change an uncertain request and metadata arrays are copied into the retry snapshot', async () => {
  const drafts = appendExerciseVideoDrafts([], [video('a', '前後腳站立伸展運動.mp4'), video('b', '坐式低背伸展.mp4')]);
  let latest;
  const create = jest.fn().mockRejectedValue({ code: 'networkError' });
  await publishExerciseVideoDrafts({ drafts, listContent: async () => ({ items: [] }), createContent: create, onChange: value => { latest = value; } });
  const original = create.mock.calls[0][0];
  drafts[0].equipmentIds.push('0');
  expect(original.equipmentIds).toEqual(['4', '10']);
  latest = applyExerciseVideoDraftCategory(latest, 'outdoor');
  expect(latest[0].payload).toBe(original);
  expect(latest[1]).toMatchObject({ videoCategory: 'outdoor', equipmentIds: [] });
  create.mockImplementation(async payload => ({ id: payload.clientRequestId }));
  await publishExerciseVideoDrafts({ drafts: latest, listContent: async () => ({ items: [] }), createContent: create, onChange: () => {} });
  expect(create.mock.calls[1][0]).toBe(original);
  expect(create.mock.calls[2][0]).toMatchObject({ videoCategory: 'outdoor', equipmentIds: [] });
});
