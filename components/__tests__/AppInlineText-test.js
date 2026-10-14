import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import AssistantReplyDetails from '../AssistantReplyDetails';
import AssistantReplySpeechControls, { AssistantReplyReadButton } from '../AssistantReplySpeechControls';
import { participantLearningCopy } from '../ParticipantLearningProgress';
import { appText, setAppTextOverrides } from '../../utils/appText';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-responsive-fontsize', () => ({ RFValue: value => value }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }) => children, SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 20, bottom: 12 }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// These are actual rendered pages/components, not retired microphone/photo UI.
const sourceFiles = [
  'app/(tabs)/index.js', 'app/login.js', 'app/(tabs)/goals/index.js', 'app/(tabs)/goals/smart.js',
  'app/(tabs)/location/index.js', 'app/(tabs)/equipmentmap/index.js', 'app/(tabs)/participant-usage/index.js',
  'app/(tabs)/participant-usage/day.js', 'app/(tabs)/participant-usage/learning.js',
  'app/(tabs)/participant-usage/learning-detail.js', 'app/(tabs)/participant-usage/_layout.tsx',
  'app/(tabs)/chat/index.js', 'app/(tabs)/outdoor/index.js', 'app/(tabs)/outdoor/list.js', 'app/(tabs)/outdoor/detail.js',
  'components/AssistantReplyDetails.js', 'components/AssistantConversationHistory.js',
  'components/AssistantReplySpeechControls.js', 'components/AssistantVoiceDiagnostics.js',
  'components/ParticipantLearningProgress.js', 'components/MediaVideo.js', 'components/MediaVideo.web.js',
  'components/AppUpdateOverlay.js', 'components/FacilityLocationHeaderButton.js',
];

function sourceEntries() {
  const entries = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'appText') {
      const [, key, defaults] = node.arguments;
      expect(key.type).toBe('StringLiteral');
      expect(defaults.type).toBe('ObjectExpression');
      const values = Object.fromEntries(defaults.properties.map(property => {
        expect(property.type).toBe('ObjectProperty');
        expect(property.value.type).toBe('StringLiteral');
        return [property.key.name || property.key.value, property.value.value];
      }));
      expect(typeof values.zh).toBe('string');
      expect(typeof values.en).toBe('string');
      expect(key.value).toMatch(/^inline\.[a-zA-Z][a-zA-Z0-9.]*$/);
      entries.push({ key: key.value, values });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  for (const file of sourceFiles) visit(parse(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] }));
  return entries;
}

let tree;
beforeEach(() => setAppTextOverrides({}));
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; setAppTextOverrides({}); });

test('active inline copy is statically discoverable, bilingual and consistent across shared native/Web keys', () => {
  const entries = sourceEntries();
  expect(entries.length).toBeGreaterThan(200);
  const unique = new Map();
  for (const entry of entries) {
    if (unique.has(entry.key)) expect(entry.values).toEqual(unique.get(entry.key));
    else unique.set(entry.key, entry.values);
    const placeholders = text => (text.match(/%\{[^}]+\}/g) || []).sort();
    expect(placeholders(entry.values.zh)).toEqual(placeholders(entry.values.en));
    for (const locale of ['zh', 'en']) expect(appText(locale, entry.key, entry.values)).toBe(entry.values[locale]);
  }
});

test.each(['zh', 'en'])('%s details uses updated UI labels but leaves the actual answer and close action unchanged', locale => {
  const onClose = jest.fn();
  const detail = { messageId: 'local-test-answer', text: '這是原有的器材使用說明。Original equipment instructions.' };
  act(() => { tree = renderer.create(<AssistantReplyDetails detail={detail} locale={locale} onClose={onClose} />); });
  setAppTextOverrides({
    'inline.assistantDetails.backToChat': { zh: '返回詢問', en: 'Return to your question' },
    'inline.assistantDetails.detailedExplanation': { zh: '器材說明', en: 'Equipment explanation' },
  });
  act(() => tree.update(<AssistantReplyDetails detail={detail} locale={locale} onClose={onClose} />));
  const texts = tree.root.findAllByType(Text);
  expect(texts.some(node => node.props.children === (locale === 'zh' ? '器材說明' : 'Equipment explanation'))).toBe(true);
  expect(texts.find(node => node.props.testID === 'assistant-reply-details-text').props.children).toBe(detail.text);
  const close = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === 'assistant-reply-details-close');
  expect(close.props.accessibilityLabel).toBe(locale === 'zh' ? '返回詢問' : 'Return to your question');
  act(() => close.props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('speech labels are editable while the selected reply sent to speech remains unmodified', () => {
  const onRead = jest.fn();
  const speech = { status: 'idle', activeMessageId: null };
  setAppTextOverrides({ 'inline.assistantSpeech.read': { zh: '聆聽這段內容', en: 'Listen to this answer' } });
  act(() => { tree = renderer.create(<AssistantReplyReadButton locale="zh" messageId="reply-7" text="只朗讀這段原有回覆" speech={speech} onRead={onRead} />); });
  const button = tree.root.findByType(TouchableOpacity);
  expect(button.props.accessibilityLabel).toBe('聆聽這段內容');
  act(() => button.props.onPress());
  expect(onRead).toHaveBeenCalledWith('reply-7', '只朗讀這段原有回覆');
});

test('updated automatic-reading label still invokes the same switch action', () => {
  const speech = { status: 'idle', autoRead: true, errorCode: null, setAutoRead: jest.fn() };
  setAppTextOverrides({ 'inline.assistantSpeech.auto': { zh: '自動讀出回答' } });
  act(() => { tree = renderer.create(<AssistantReplySpeechControls locale="zh" speech={speech} />); });
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === 'assistant-auto-read');
  expect(button.props.accessibilityLabel).toBe('自動讀出回答');
  act(() => button.props.onPress());
  expect(speech.setAutoRead).toHaveBeenCalledWith(false);
});

test('learning display copy accepts a published label without changing language-specific default explanations', () => {
  setAppTextOverrides({ 'inline.participantLearningProgress.title': { zh: '參與者教學進度' } });
  expect(participantLearningCopy('zh').title).toBe('參與者教學進度');
  expect(participantLearningCopy('en').title).toBe('Facility Guide progress');
  expect(participantLearningCopy('zh').contentHint).toContain('75%');
  expect(participantLearningCopy('en').contentHint).toContain('75%');
});

test('editable templates interpolate data rather than registering session data as global copy', () => {
  const defaults = { zh: '第 %{number} 節運動', en: 'Session %{number}' };
  setAppTextOverrides({ 'inline.participantDay.sessionNumber': { zh: '運動記錄 %{number}' } });
  expect(appText('zh', 'inline.participantDay.sessionNumber', defaults, { number: 3 })).toBe('運動記錄 3');
  expect(appText('en', 'inline.participantDay.sessionNumber', defaults, { number: 3 })).toBe('Session 3');
});
