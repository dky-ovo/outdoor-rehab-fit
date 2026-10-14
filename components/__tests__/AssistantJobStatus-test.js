import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Text } from 'react-native';
import AssistantJobStatus from '../AssistantJobStatus';
jest.mock('../../utils/assistantJobs', () => ({ assistantJobStage: (task, now) => ['reconnecting', 'authentication_required', 'save_failed'].includes(task.stage) ? task.stage : now - task.createdAt >= 90000 ? 'waiting' : task.stage }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.useRealTimers(); });
test('a running request changes to a waiting card after 95 seconds without a network event', async () => {
  jest.useFakeTimers();
  await act(async () => { tree = renderer.create(<AssistantJobStatus task={{ stage: 'running', createdAt: Date.now() }} locale="zh" thinkingLabel="思考中" onRecheck={jest.fn()} />); });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(95000));
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map(node => node.props.children).join(' ')).toMatch(/等候時間較長/);
});
test('a connection failure shows a recovery action immediately', async () => {
  await act(async () => { tree = renderer.create(<AssistantJobStatus task={{ stage: 'reconnecting', createdAt: Date.now() }} locale="zh" thinkingLabel="思考中" onRecheck={jest.fn()} />); });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map(node => node.props.children).join(' ')).toMatch(/連線暫時中斷/);
  expect(tree.root.findAll(node => node.props.testID === 'assistant-job-recheck' && typeof node.props.onPress === 'function').length).toBeGreaterThan(0);
});
test('an old pending job exposes a check action instead of an endless spinner', async () => {
  const onRecheck = jest.fn(async () => {});
  await act(async () => { tree = renderer.create(<AssistantJobStatus task={{ stage: 'running', createdAt: Date.now() - 100000 }} locale="zh" thinkingLabel="思考中" onRecheck={onRecheck} />); });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map(node => node.props.children).join(' ')).toMatch(/等候時間較長/);
  await act(async () => tree.root.findAll(node => node.props.testID === 'assistant-job-recheck' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(onRecheck).toHaveBeenCalledTimes(1);
});
test('expired authentication offers sign in and never starts another question', async () => {
  const onRecheck = jest.fn(), onLogin = jest.fn();
  await act(async () => { tree = renderer.create(<AssistantJobStatus task={{ stage: 'authentication_required', createdAt: Date.now() }} locale="en" onRecheck={onRecheck} onLogin={onLogin} />); });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  await act(async () => tree.root.findAll(node => node.props.testID === 'assistant-job-recheck' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(onLogin).toHaveBeenCalledTimes(1); expect(onRecheck).not.toHaveBeenCalled();
});
