import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ModalSafeAreaView from '../ModalSafeAreaView';

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => {
  const React = require('react'), Context = React.createContext(null);
  return {
    SafeAreaInsetsContext: Context,
    SafeAreaProvider: ({ children }) => <Context.Provider value={mockInsets}>{children}</Context.Provider>,
    SafeAreaView: require('react-native').View,
    useSafeAreaInsets: () => { throw new Error('Modal padding must not wait for a JS inset consumer'); },
  };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, mounts = 0;
function Content() { React.useEffect(() => { mounts += 1; }, []); return <View testID="persistent-content" />; }
const screen = () => <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
  <ModalSafeAreaView testID="modal-page" accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#000' }}><Content /></ModalSafeAreaView>
</SafeAreaInsetsContext.Provider>;
beforeEach(() => { mounts = 0; mockInsets = { top: 59, bottom: 34, left: 0, right: 0 }; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test('modal delegates all four edges to native safe-area padding inside its own provider, without remounting playback', async () => {
  await act(async () => { tree = renderer.create(screen()); });
  expect(tree.root.findAllByType(SafeAreaProvider)).toHaveLength(1);
  const page = () => tree.root.findAllByType(SafeAreaView).find(node => node.props.testID === 'modal-page');
  expect(StyleSheet.flatten(page().props.style)).toEqual({ flex: 1, backgroundColor: '#000' });
  expect(page().props.edges).toEqual(['top', 'right', 'bottom', 'left']);
  expect(tree.root.findByType(SafeAreaProvider).props.initialMetrics).toBeUndefined();
  expect(page().props.accessibilityViewIsModal).toBe(true);
  const child = tree.root.findByProps({ testID: 'persistent-content' });
  mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
  await act(async () => tree.update(screen()));
  expect(page().props.edges).toEqual(['top', 'right', 'bottom', 'left']);
  expect(StyleSheet.flatten(page().props.style).paddingTop).toBeUndefined();
  expect(tree.root.findByProps({ testID: 'persistent-content' })).toBe(child);
  expect(mounts).toBe(1);
});
