import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import Diagnostics, { voiceDiagnosticText } from '../AssistantVoiceDiagnostics';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);

test('diagnostics can open without attempting recording or reading an answer', () => {
  const readDiagnostics = jest.fn(() => ({ previousStage: 'recording', selectedVoice: 'yue-hk-x-test-local' }));
  act(() => { tree = renderer.create(<Diagnostics locale="zh" diagnostics={{ installedVersion: '1.2.1', installedBuild: '15' }} readDiagnostics={readDiagnostics} />); });
  expect(readDiagnostics).not.toHaveBeenCalled();
  act(() => button('assistant-voice-health').props.onPress());
  expect(readDiagnostics).toHaveBeenCalledTimes(1);
  const text = tree.root.findAllByType(Text).find(node => node.props.testID === 'assistant-voice-health-text');
  expect(text.props.selectable).toBe(true);
  expect(text.props.children).toContain('安裝版本: 1.2.1');
  expect(text.props.children).toContain('上次階段: recording');
  act(() => button('assistant-voice-health-refresh').props.onPress());
  expect(readDiagnostics).toHaveBeenCalledTimes(2);
  act(() => button('assistant-voice-health').props.onPress());
  expect(button('assistant-voice-health').props.accessibilityState.expanded).toBe(false);
});

test('only whitelisted simple diagnostic values are shown; never serialize question/audio/credentials', () => {
  const text = voiceDiagnosticText({ installedVersion: '1.2.1', selectedVoice: { secret: 'never' },
    token: 'super-secret', question: 'private-question', audioUri: 'private-file', voiceConfirmed: false }, 'en');
  expect(text).toContain('Voice confirmed: false');
  expect(text).not.toMatch(/super-secret|private-question|private-file|never/);
});

test('old binaries without the diagnostic API remain usable', () => {
  act(() => { tree = renderer.create(<Diagnostics locale="en" diagnostics={{ installedVersion: '1.2.0' }} />); });
  act(() => button('assistant-voice-health').props.onPress());
  expect(JSON.stringify(tree.toJSON())).toContain('Voice revision: —');
});
