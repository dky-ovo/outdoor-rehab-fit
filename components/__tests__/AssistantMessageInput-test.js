import React from "react";
import { act, create } from "react-test-renderer";
import { Platform, StyleSheet, TextInput } from "react-native";
import AssistantMessageInput from "../AssistantMessageInput";

let mockInputElement = null;
jest.mock('react-native', () => {
  const React = require('react');
  const native = jest.requireActual('react-native');
  return { Platform: native.Platform, StyleSheet: native.StyleSheet,
    TextInput: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => mockInputElement);
      return React.createElement('mock-text-input', props);
    }),
  };
});
jest.mock('react-native-responsive-fontsize', () => ({ RFValue: value => value }));
afterEach(() => { mockInputElement = null; });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("composer grows and shrinks, scrolls only at its cap, and uses native empty-content size after send", async () => {
	let tree;
	await act(async () => { tree = create(<AssistantMessageInput value="first line" onChangeText={() => {}} />); });
	const input = () => tree.root.findByType(TextInput);
	const resize = async height => act(async () => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height } } }));
	expect(StyleSheet.flatten(input().props.style).height).toBe(48); expect(input().props.scrollEnabled).toBe(false);
	await resize(90); expect(StyleSheet.flatten(input().props.style).height).toBe(90); expect(input().props.scrollEnabled).toBe(false);
	await resize(180); expect(StyleSheet.flatten(input().props.style).height).toBe(128); expect(input().props.scrollEnabled).toBe(true);
	await resize(70); expect(StyleSheet.flatten(input().props.style).height).toBe(70); expect(input().props.scrollEnabled).toBe(false);
	await act(async () => tree.update(<AssistantMessageInput value="" onChangeText={() => {}} />));
	await resize(32);
	expect(StyleSheet.flatten(input().props.style).height).toBe(48);
	await act(async () => tree.unmount());
});

test('iOS clearing a draft does not overwrite an already delivered wrapped-placeholder measurement', async () => {
  const os = Platform.OS; Platform.OS = 'ios'; let tree;
  try {
    await act(async () => { tree = create(<AssistantMessageInput value="several lines" placeholder="A long placeholder" />); });
    const input = () => tree.root.findByType(TextInput);
    await act(async () => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 180 } } }));
    expect(StyleSheet.flatten(input().props.style).height).toBe(128);
    // Native can report the empty text size before the controlled value's
    // effect commits; it includes the placeholder, not just the typed text.
    await act(async () => {
      input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 72 } } });
      tree.update(<AssistantMessageInput value="" placeholder="A long placeholder" />);
    });
    expect(StyleSheet.flatten(input().props.style).height).toBe(72);
    expect(input().props.scrollEnabled).toBe(false);
  } finally { if (tree) await act(async () => tree.unmount()); Platform.OS = os; }
});

test('web measures an empty placeholder on mount, after clearing, and when its width or text changes', async () => {
  const os = Platform.OS; Platform.OS = 'web'; let tree;
  const element = { style: { height: '48px' }, scrollHeight: 70 };
  mockInputElement = element;
  const onLayout = jest.fn();
  try {
    const render = (value, placeholder = 'A long placeholder') => <AssistantMessageInput value={value} placeholder={placeholder} onLayout={onLayout} />;
    await act(async () => { tree = create(render('')); });
    const input = () => tree.root.findByType(TextInput);
    const height = () => StyleSheet.flatten(input().props.style).height;
    expect(height()).toBe(72);
    element.scrollHeight = 180;
    await act(async () => tree.update(render('several lines')));
    expect(height()).toBe(128); expect(input().props.scrollEnabled).toBe(true);
    element.scrollHeight = 70;
    await act(async () => tree.update(render('')));
    expect(height()).toBe(72); expect(input().props.scrollEnabled).toBe(false);
    element.scrollHeight = 94;
    const layoutEvent = { nativeEvent: { layout: { width: 220, height: 72 } } };
    await act(async () => input().props.onLayout(layoutEvent));
    expect(height()).toBe(96); expect(onLayout).toHaveBeenCalledWith(layoutEvent);
    element.scrollHeight = 30;
    await act(async () => tree.update(render('', 'Short')));
    expect(height()).toBe(48); expect(element.style.height).toBe('48px');
  } finally { if (tree) await act(async () => tree.unmount()); Platform.OS = os; }
});
test('web textarea grows and shrinks from DOM content changes without native content-size events', async () => {
  const os = Platform.OS; Platform.OS = 'web'; let tree;
  try {
    const onChange = jest.fn();
    await act(async () => { tree = create(<AssistantMessageInput value="lines" onChange={onChange} onChangeText={() => {}} />); });
    const input = () => tree.root.findByType(TextInput);
    const element = { style: { height: '48px' }, scrollHeight: 90 };
    await act(async () => input().props.onChange({ currentTarget: element }));
    expect(StyleSheet.flatten(input().props.style).height).toBe(92); expect(element.style.height).toBe('48px');
    element.scrollHeight = 190;
    await act(async () => input().props.onChange({ currentTarget: element }));
    expect(StyleSheet.flatten(input().props.style).height).toBe(128); expect(input().props.scrollEnabled).toBe(true);
    element.scrollHeight = 52;
    await act(async () => input().props.onChange({ currentTarget: element }));
    expect(StyleSheet.flatten(input().props.style).height).toBe(54); expect(input().props.scrollEnabled).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(3);
  } finally { if (tree) await act(async () => tree.unmount()); Platform.OS = os; }
});
