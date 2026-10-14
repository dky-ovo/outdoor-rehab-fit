import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import GoalSetting from '../../app/(tabs)/goals';
import SmartGoal from '../../app/(tabs)/goals/smart';
import { LocaleContext } from '../../contexts/LocaleContext';
import { getGoalState } from '../../utils/goals';
import { showAlert } from '../../utils/alert';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocus, mockBlur;
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({}),
  useFocusEffect: callback => {
    mockFocus = callback;
    require('react').useEffect(() => { mockBlur = callback(); return mockBlur; }, [callback]);
  },
}));
jest.mock('../../contexts/LocaleContext', () => ({ LocaleContext: require('react').createContext(null) }));
jest.mock('../../hooks/useUsageBack', () => ({ useUsageBack: jest.fn() }));
jest.mock('../../hooks/useAccountDataRevision', () => ({ useAccountDataRevision: () => 0 }));
jest.mock('../../utils/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../../utils/goals', () => ({
  DEFAULT_GOALS: { aerobic: 150, balance: 3, muscle: 2 }, getGoalState: jest.fn(),
  setTarget: jest.fn(), addSmartGoal: jest.fn(), updateSmartGoal: jest.fn(), toggleSmartGoal: jest.fn(), removeSmartGoal: jest.fn(), carryOverSmartGoals: jest.fn(),
  getCurrentWeekSmartGoals: state => state.smartGoals, getPastWeekSmartGoals: () => [],
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }));
jest.mock('react-native-responsive-fontsize', () => ({ RFValue: value => value }));

let tree;
const state = (aerobic, text) => ({ targets: { aerobic, balance: 3, muscle: 2 }, smartGoals: [{ id: text, text, done: false }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const labels = () => JSON.stringify(tree.root.findAllByType(Text).map(node => node.props.children));
const mount = async Component => act(async () => { tree = renderer.create(<LocaleContext.Provider value={{ locale: 'en', i18n: { locale: 'en', t: key => key } }}><Component /></LocaleContext.Provider>); });
beforeEach(() => { jest.clearAllMocks(); mockFocus = mockBlur = null; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

describe.each([['weekly targets', GoalSetting, '260', '555'], ['personal goals', SmartGoal, 'New account goal', 'Old account goal']])('%s focus lifecycle', (_name, Component, latest, stale) => {
  test('an older focus response cannot overwrite the new account screen', async () => {
    const old = deferred(); getGoalState.mockReturnValueOnce(old.promise);
    await mount(Component);
    getGoalState.mockResolvedValueOnce(state(260, 'New account goal'));
    await act(async () => { mockBlur?.(); mockBlur = mockFocus(); });
    expect(labels()).toContain(latest);
    await act(async () => old.resolve(state(555, 'Old account goal')));
    expect(labels()).toContain(latest); expect(labels()).not.toContain(stale);
    expect(showAlert).not.toHaveBeenCalled();
  });

  test('an account-change rejection after leaving is handled without a stale alert', async () => {
    const old = deferred(); getGoalState.mockReturnValueOnce(old.promise);
    await mount(Component);
    await act(async () => tree.unmount()); tree = null;
    await act(async () => old.reject(new Error('Goal account changed')));
    expect(showAlert).not.toHaveBeenCalled();
  });

  test('a current load failure has an error message instead of an unhandled rejection', async () => {
    getGoalState.mockRejectedValueOnce(new Error('Local storage unavailable'));
    await mount(Component);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith('warning', 'serverError');
  });
});
