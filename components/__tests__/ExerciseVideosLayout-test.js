import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet, View } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import ExerciseVideos from '../../app/(tabs)/exercise-videos';

jest.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBarHeightContext: require('react').createContext(undefined) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaInsetsContext: require('react').createContext(null) }));
jest.mock('../../contexts/LocaleContext', () => ({ LocaleContext: require('react').createContext({ i18n: { t: () => '運動影片' } }) }));
jest.mock('../ManagedContent', () => 'video-library');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const originalPlatform = Platform.OS;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalPlatform; });
const page = () => tree.root.findAllByType(View).find(node => node.props.testID === 'exercise-videos-page');
test.each([['ios',112,34,112],['ios',78,0,78],['ios',150,34,150],['ios',undefined,34,112],['android',112,34,0],['web',112,34,0]])(
  '%s video library clears overlay height %s without adding a second safe inset', async (platform, height, bottom, expected) => {
    Platform.OS = platform;
    await act(async () => { tree = renderer.create(<SafeAreaInsetsContext.Provider value={{ top: 59, bottom, left: 0, right: 0 }}>
      <BottomTabBarHeightContext.Provider value={height}><ExerciseVideos /></BottomTabBarHeightContext.Provider>
    </SafeAreaInsetsContext.Provider>); });
    expect(StyleSheet.flatten(page().props.style).paddingBottom).toBe(expected);
    expect(StyleSheet.flatten(page().props.style).flex).toBe(1);
    expect(tree.root.findByType('video-library').props.pageKey).toBe('exercise_videos');
  },
);
