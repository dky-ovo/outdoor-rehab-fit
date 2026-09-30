import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import AboutApp from '../../app/(tabs)/setting/about';
import AboutTeam from '../../app/(tabs)/setting/info';
import Setting from '../../app/(tabs)/setting';
import SettingLayout from '../../app/(tabs)/setting/_layout';
import { LocaleContext } from '../../contexts/LocaleContext';
import { ourTeam } from '../../constants/OurTeam';
import { translations } from '../../constants/Languages';
import catalog from '../../constants/AppTextCatalog.json';
import { applyAppTextOverrides, normalizeAppTextOverrides, setAppTextOverrides } from '../../utils/appText';
import { useAndroidBackTarget } from '../../hooks/useAndroidBackTarget';
import source from './fixtures/team-about-20260924.json';
const { verifyTeam } = require('../../scripts/verify-team-about-source.cjs');

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
const context = language => {
  const dictionary = applyAppTextOverrides('copy', translations[language], language);
  return { locale: language, i18n: { locale: language, t: key => dictionary[key] || key } };
};
const view = (Component, language) => <LocaleContext.Provider value={context(language)}><Component /></LocaleContext.Provider>;
async function mount(Component = AboutTeam, language = 'zh') {
  let tree; await act(async () => { tree = renderer.create(view(Component, language)); }); trees.push(tree); return tree;
}
const texts = tree => tree.root.findAllByType(Text).map(node => node.props.children);
const fields = ['role', 'responsibility', 'name', 'position', 'affiliation'];
beforeEach(() => { jest.clearAllMocks(); mockIsGuest = true; setAppTextOverrides({}); });
afterEach(async () => { await act(async () => trees.splice(0).forEach(tree => tree.unmount())); setAppTextOverrides({}); });

test('both language rosters preserve every source table, 4 groups and 16 members in Word order', () => {
  expect(verifyTeam(ourTeam, source)).toMatchObject({ languages: 2, sectionsPerLanguage: 4, membersPerLanguage: 16 });
});

test('source verification rejects omitted members, swapped names and swapped affiliations', () => {
  const omitted = JSON.parse(JSON.stringify(ourTeam));
  omitted.zh.sections[1].members.pop();
  expect(() => verifyTeam(omitted, source)).toThrow();
  for (const field of ['name', 'affiliation']) {
    const swapped = JSON.parse(JSON.stringify(ourTeam));
    const members = swapped.en.sections[1].members;
    [members[0][field], members[1][field]] = [members[1][field], members[0][field]];
    expect(() => verifyTeam(swapped, source)).toThrow(/roster differs/);
  }
});

test.each(['zh', 'en'])('%s team displays all source text in full with selectable wrapping and safe bottom padding', async language => {
  const tree = await mount(AboutTeam, language);
  const team = ourTeam[language];
  expect(texts(tree)).toEqual([team.title, ...team.sections.flatMap(section => [section.title, ...section.members.flatMap(member => fields.map(key => member[key]).filter(Boolean))])]);
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.testID).toBe('about-team-scroll');
  expect(StyleSheet.flatten(scroll.props.style).flex).toBe(1);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(144);
  for (const node of tree.root.findAllByType(Text)) {
    expect(node.props.selectable).toBe(true);
    expect(node.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(node.props.style).height).toBeUndefined();
  }
  expect(useAndroidBackTarget).toHaveBeenCalledWith('/(tabs)/setting');
  expect(mockParent.setOptions).not.toHaveBeenCalled();
});

test.each(['zh', 'en'])('%s about app shows the complete existing introduction, not the old team biography', async language => {
  const tree = await mount(AboutApp, language);
  expect(texts(tree)).toEqual([translations[language].intro]);
  expect(texts(tree)).not.toContain(translations[language].team);
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.testID).toBe('about-app-scroll');
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(134);
  const article = tree.root.findByType(Text);
  expect(article.props.selectable).toBe(true);
  expect(article.props.numberOfLines).toBeUndefined();
  expect(useAndroidBackTarget).toHaveBeenCalledWith('/(tabs)/setting');
});

test.each([['app', AboutApp], ['team', AboutTeam]])('entering and leaving %s never changes the parent header', async (_name, Component) => {
  const tree = await mount(Component);
  expect(mockParent.setOptions).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  expect(mockParent.setOptions).not.toHaveBeenCalled();
});

test.each([true, false])('guest=%s can use both independent about entries and each opens its matching route', async guest => {
  mockIsGuest = guest;
  const tree = await mount(Setting);
  for (const [testID, route] of [['settings-about-app', '/setting/about'], ['settings-about-team', '/setting/info']]) {
    const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === testID);
    expect(button).toBeDefined();
    expect(button.props.accessibilityRole).toBe('button');
    await act(async () => button.props.onPress());
    expect(router.push).toHaveBeenLastCalledWith(route);
  }
  expect(router.push).toHaveBeenCalledTimes(2);
});

test.each([['zh', true], ['zh', false], ['en', true], ['en', false]])('%s headers preserve correct titles and return paths with history=%s', async (language, history) => {
  router.canGoBack.mockReturnValue(history);
  const tree = await mount(SettingLayout, language);
  for (const [name, title] of [['about', 'aboutApp'], ['info', 'aboutTeam']]) {
    const screen = tree.root.findAllByType(Stack.Screen).find(node => node.props.name === name);
    expect(screen.props.options.title).toBe(translations[language][title]);
    expect(screen.props.options.headerShown).toBe(true);
    screen.props.options.headerLeft().props.onPress();
  }
  if (history) { expect(router.back).toHaveBeenCalledTimes(2); expect(router.replace).not.toHaveBeenCalled(); }
  else { expect(router.replace).toHaveBeenCalledTimes(2); expect(router.replace).toHaveBeenLastCalledWith('/(tabs)/setting'); expect(router.back).not.toHaveBeenCalled(); }
});

test.each([['app', AboutApp], ['team', AboutTeam]])('switching language on the mounted %s page replaces its complete content', async (name, Component) => {
  const tree = await mount(Component);
  await act(async () => tree.update(view(Component, 'en')));
  if (name === 'app') expect(texts(tree)).toEqual([translations.en.intro]);
  else {
    expect(texts(tree)).toContain(ourTeam.en.title);
    expect(texts(tree)).toContain(ourTeam.en.sections[3].members[1].name);
    expect(texts(tree)).not.toContain(ourTeam.zh.title);
    expect(texts(tree)).not.toContain(ourTeam.zh.sections[3].members[1].name);
  }
});

test.each(['zh', 'en'])('%s existing intro override follows the content to about app and legacy team override cannot replace new roster', async language => {
  setAppTextOverrides(normalizeAppTextOverrides({ version: 1, overrides: {
    'copy.intro': { [language]: 'Customized existing introduction' },
    'copy.team': { [language]: 'Obsolete team override' },
  } }));
  const app = await mount(AboutApp, language);
  expect(texts(app)).toEqual(['Customized existing introduction']);
  const team = await mount(AboutTeam, language);
  expect(texts(team)).not.toContain('Obsolete team override');
  expect(texts(team)).not.toContain('Customized existing introduction');
  expect(texts(team)).toContain(ourTeam[language].sections[3].members[1].name);
  const otherApp = await mount(AboutApp, language === 'zh' ? 'en' : 'zh');
  expect(texts(otherApp)).toEqual([translations[language === 'zh' ? 'en' : 'zh'].intro]);
});

test.each(['zh', 'en'])('%s backend roster overrides render separately and can reset without mutating defaults', async language => {
  const original = JSON.stringify(ourTeam);
  setAppTextOverrides(normalizeAppTextOverrides({ version: 1, overrides: {
    'teamInfo.title': { [language]: 'Updated team heading' },
    'teamInfo.sections.0.members.0.name': { [language]: 'Updated member name' },
    'teamInfo.sections.0.members.0.affiliation': { [language]: 'Updated affiliation' },
  } }));
  const tree = await mount(AboutTeam, language);
  expect(texts(tree)).toEqual(expect.arrayContaining(['Updated team heading', 'Updated member name', 'Updated affiliation']));
  expect(JSON.stringify(ourTeam)).toBe(original);
  const other = await mount(AboutTeam, language === 'zh' ? 'en' : 'zh');
  expect(texts(other)).not.toContain('Updated member name');
  setAppTextOverrides({});
  await act(async () => tree.update(view(AboutTeam, language)));
  expect(texts(tree)).toContain(ourTeam[language].title);
  expect(texts(tree)).not.toContain('Updated member name');
});

test('all headings, names, responsibilities and affiliations have bilingual admin-editable fields', () => {
  const entries = new Map(catalog.items.map(item => [item.key, item]));
  for (const language of ['zh', 'en']) {
    expect(entries.get('teamInfo.title')[language]).toBe(ourTeam[language].title);
    ourTeam[language].sections.forEach((section, i) => {
      expect(entries.get(`teamInfo.sections.${i}.title`)[language]).toBe(section.title);
      section.members.forEach((member, j) => {
        for (const [key, value] of Object.entries(member)) expect(entries.get(`teamInfo.sections.${i}.members.${j}.${key}`)[language]).toBe(value);
      });
    });
    expect(entries.get('copy.intro')[language]).toBe(translations[language].intro);
  }
  const items = catalog.items.filter(item => item.key.startsWith('teamInfo.'));
  expect(items).toHaveLength(43);
  expect(items.every(item => item.zh && item.en && item.group === '关于我们（团队）')).toBe(true);
});
