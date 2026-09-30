import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import PrivacyPolicyScreen from '../../app/(tabs)/setting/privacy';
import Setting from '../../app/(tabs)/setting';
import SettingLayout from '../../app/(tabs)/setting/_layout';
import { LocaleContext } from '../../contexts/LocaleContext';
import { privacyPolicy } from '../../constants/PrivacyPolicy';
import { menuTranslations } from '../../constants/Languages';
import catalog from '../../constants/AppTextCatalog.json';
import { normalizeAppTextOverrides, setAppTextOverrides } from '../../utils/appText';
import { useAndroidBackTarget } from '../../hooks/useAndroidBackTarget';
import source from './fixtures/privacy-policy-20260924.json';
const { verifyPrivacyPolicy } = require('../../scripts/verify-privacy-policy-source.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockIsGuest = true;
const mockParent = { setOptions: jest.fn() };
const mockNavigation = { getParent: () => mockParent };
jest.mock('../../contexts/LocaleContext', () => ({ LocaleContext: require('react').createContext() }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: mockIsGuest ? 'guest' : 'Reader' }, isGuest: mockIsGuest, isUser: !mockIsGuest, isAuthenticated: true }) }));
jest.mock('../../hooks/useAndroidBackTarget', () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, FontAwesome: () => null }));
jest.mock('react-native-responsive-fontsize', () => ({ RFValue: value => value }));
jest.mock('react-native-responsive-screen', () => ({ widthPercentageToDP: () => 320, heightPercentageToDP: () => 100 }));
jest.mock('expo-router', () => {
  const Stack = ({ children }) => children;
  Stack.Screen = () => null;
  return { Stack, router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() }, useFocusEffect: callback => require('react').useEffect(callback, [callback]) };
});
const trees = [];
const context = language => ({ locale: language, i18n: { locale: language, t: key => menuTranslations[language]?.[key] || key } });
const view = (Component, language) => <LocaleContext.Provider value={context(language)}><Component /></LocaleContext.Provider>;
async function mount(Component = PrivacyPolicyScreen, language = 'zh') {
  let tree; await act(async () => { tree = renderer.create(view(Component, language)); }); trees.push(tree); return tree;
}
const texts = tree => tree.root.findAllByType(Text).map(node => node.props.children);
beforeEach(() => { jest.clearAllMocks(); mockIsGuest = true; setAppTextOverrides({}); });
afterEach(async () => { await act(async () => trees.splice(0).forEach(tree => tree.unmount())); setAppTextOverrides({}); });

test('all bilingual policy text and bullet order match the approved Word; reviewer comments are excluded', () => {
  expect(verifyPrivacyPolicy(privacyPolicy, source)).toMatchObject({ languages: 2, sections: 14, excludedReviewerComments: 2 });
  expect(JSON.stringify(privacyPolicy)).not.toMatch(/does this mean our workshop|prior to using this Application|If change, need to/);
});
test('source check rejects a changed policy paragraph or omitted rights clause', () => {
  const edited = JSON.parse(JSON.stringify(privacyPolicy));
  edited.en.sections[1].blocks[0].text += ' Changed policy.';
  expect(() => verifyPrivacyPolicy(edited, source)).toThrow(/policy text differs/);
  const missing = JSON.parse(JSON.stringify(privacyPolicy));
  missing.zh.sections[4].blocks.splice(2, 1);
  expect(() => verifyPrivacyPolicy(missing, source)).toThrow(/policy text differs/);
});
test.each(['zh', 'en'])('%s displays the complete policy with readable wrapping, selectable text and safe bottom spacing', async language => {
  const tree = await mount(PrivacyPolicyScreen, language);
  const document = privacyPolicy[language];
  expect(texts(tree).filter(value => value !== '•')).toEqual([document.title, ...document.sections.flatMap(section => [section.title, ...section.blocks.map(block => block.text)])]);
  const scroll = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style).flex).toBe(1);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(144);
  for (const node of tree.root.findAllByType(Text)) {
    expect(node.props.numberOfLines).toBeUndefined();
    if (node.props.children !== '•') expect(node.props.selectable).toBe(true);
  }
  expect(useAndroidBackTarget).toHaveBeenCalledWith('/(tabs)/setting');
  expect(mockParent.setOptions).not.toHaveBeenCalled();
});
test('entering and leaving the page never changes the parent header', async () => {
  const tree = await mount();
  expect(mockParent.setOptions).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  expect(mockParent.setOptions).not.toHaveBeenCalled();
});
test.each([true, false])('settings entry is accessible with guest=%s and opens only the privacy page', async guest => {
  mockIsGuest = guest;
  const tree = await mount(Setting);
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === 'settings-privacy-policy');
  expect(button).toBeDefined();
  expect(button.props.accessibilityRole).toBe('button');
  await act(async () => button.props.onPress());
  expect(router.push).toHaveBeenCalledWith('/setting/privacy');
});
test.each([true, false])('header returns with stack history=%s and no-history fallback to settings', async history => {
  router.canGoBack.mockReturnValue(history);
  const tree = await mount(SettingLayout, 'en');
  const screen = tree.root.findAllByType(Stack.Screen).find(node => node.props.name === 'privacy');
  expect(screen.props.options.title).toBe('Privacy Policy');
  expect(screen.props.options.headerShown).toBe(true);
  const back = screen.props.options.headerLeft();
  expect(back.props.accessibilityLabel).toBe('Back to Settings');
  back.props.onPress();
  if (history) { expect(router.back).toHaveBeenCalledTimes(1); expect(router.replace).not.toHaveBeenCalled(); }
  else expect(router.replace).toHaveBeenCalledWith('/(tabs)/setting');
});
test('switching language on the mounted page replaces the whole policy', async () => {
  const tree = await mount();
  await act(async () => tree.update(view(PrivacyPolicyScreen, 'en')));
  expect(texts(tree)).toContain('Privacy Policy');
  expect(texts(tree)).not.toContain('資料收集');
  expect(texts(tree)).toContain(privacyPolicy.en.sections[6].blocks[0].text);
});
test.each(['zh', 'en'])('%s backend title and paragraph overrides render without mutating defaults or the other language', async language => {
  const original = JSON.stringify(privacyPolicy);
  setAppTextOverrides(normalizeAppTextOverrides({ version: 1, overrides: {
    'privacy.title': { [language]: 'Updated policy heading' },
    'privacy.sections.0.blocks.0.text': { [language]: 'Updated policy paragraph' },
  } }));
  const tree = await mount(PrivacyPolicyScreen, language);
  expect(texts(tree)).toContain('Updated policy heading');
  expect(texts(tree)).toContain('Updated policy paragraph');
  expect(JSON.stringify(privacyPolicy)).toBe(original);
  const other = await mount(PrivacyPolicyScreen, language === 'en' ? 'zh' : 'en');
  expect(texts(other)).not.toContain('Updated policy paragraph');
  setAppTextOverrides({});
  await act(async () => tree.update(view(PrivacyPolicyScreen, language)));
  expect(texts(tree)).toContain(privacyPolicy[language].title);
});
test('every policy heading and paragraph has a corresponding bilingual admin-editable field', () => {
  const entries = new Map(catalog.items.map(item => [item.key, item]));
  for (const language of ['zh', 'en']) {
    expect(entries.get('privacy.title')[language]).toBe(privacyPolicy[language].title);
    privacyPolicy[language].sections.forEach((section, i) => {
      expect(entries.get(`privacy.sections.${i}.title`)[language]).toBe(section.title);
      section.blocks.forEach((block, j) => expect(entries.get(`privacy.sections.${i}.blocks.${j}.text`)[language]).toBe(block.text));
    });
  }
  const items = catalog.items.filter(item => item.key.startsWith('privacy.'));
  expect(items.every(item => item.zh && item.en && item.group === '隐私政策声明')).toBe(true);
  expect(items.some(item => item.key.endsWith('.bullet'))).toBe(false);
});
