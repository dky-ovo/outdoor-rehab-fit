import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Stack, router } from "expo-router";
import ActivityAdviceScreen from "../../app/(tabs)/activity-advice";
import ActivityAdviceLayout from "../../app/(tabs)/activity-advice/_layout";
import OtherScreen from "../../app/(tabs)/other";
import { physicalActivityAdvice } from "../../constants/PhysicalActivityAdvice";
import { menuTranslations } from "../../constants/Languages";
import { LocaleContext } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";
import { useAndroidBackTarget } from "../../hooks/useAndroidBackTarget";
import { normalizeAppTextOverrides, setAppTextOverrides } from "../../utils/appText";
import sourceFixture from "./fixtures/physical-activity-advice-20260923.json";
const { adviceParagraphs, verifyPhysicalActivityAdvice } = require("../../scripts/verify-physical-activity-advice-source.cjs");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => {
	const Stack = ({ children }) => children;
	Stack.Screen = () => null;
	return { Stack, router: { replace: jest.fn(), push: jest.fn() } };
});
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../utils/accessControl", () => ({ guardGuestAccess: (_feature, _guest, _i18n, open) => open() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, left: 0, bottom: 34 }) }));

const originalPlatform = Platform.OS;
let trees = [];
const localeValue = (language) => ({ locale: language, i18n: { locale: language, t: (key) => menuTranslations[language]?.[key] || key } });
const mount = async (Component, language = "zh", auth = { isGuest: true, user: null }) => {
	let tree;
	await act(async () => { tree = renderer.create(<LocaleContext.Provider value={localeValue(language)}>
		<AuthContext.Provider value={auth}><Component /></AuthContext.Provider>
	</LocaleContext.Provider>); });
	trees.push(tree);
	return tree;
};
beforeEach(() => { jest.clearAllMocks(); setAppTextOverrides({}); });
afterEach(async () => {
	await act(async () => trees.forEach((tree) => tree.unmount()));
	trees = [];
	Platform.OS = originalPlatform;
	jest.restoreAllMocks();
	setAppTextOverrides({});
});

test("every supplied Word paragraph and hyperlink matches exactly apart from paragraph-edge whitespace", () => {
	expect(verifyPhysicalActivityAdvice(physicalActivityAdvice, sourceFixture)).toMatchObject({
		sourceSha256: "BE143492CB8A25A50ED08B1BE6F195ED01E4454E4C4AA3764D9828107818E07B",
		extractedBlocks: 67, verifiedNonemptyParagraphs: 59, referenceLinks: 4, uniqueUrls: 2,
	});
});

test.each(["zh", "en"])("%s general advice, WHO reference, TCM advice and TCM reference follow Word order", async language => {
	const tree = await mount(ActivityAdviceScreen, language);
	const content = physicalActivityAdvice[language];
	const rendered = tree.root.findAllByType(Text).map(node => node.props.children);
	// URL strings are hidden behind buttons, so compare the exact order of the
	// remaining document text while excluding only the UI's source/link labels.
	const expected = adviceParagraphs(content).filter(text => text !== content.references[0].url);
	expected[expected.length - 1] = content.references[1].text;
	const labels = localeValue(language).i18n;
	const documentText = rendered.filter(text => text !== labels.t("physicalActivityAdviceSource") && !Array.isArray(text));
	expect(documentText).toEqual(expected);
	expect(rendered.indexOf(content.references[0].text)).toBeLessThan(rendered.indexOf(content.tcmTitle));
	expect(rendered.indexOf(content.references[1].text)).toBeGreaterThan(rendered.indexOf(content.tcmSections[2].paragraphs.at(-1)));
});

test("source validation rejects a changed clinical sentence, a missing English section and swapped citations", () => {
	const edited = JSON.parse(JSON.stringify(physicalActivityAdvice));
	edited.zh.sections[0].paragraphs[0] += " 新增句子";
	expect(() => verifyPhysicalActivityAdvice(edited, sourceFixture)).toThrow(/differs at Word block/);
	const missing = JSON.parse(JSON.stringify(physicalActivityAdvice));
	missing.en.sections.pop();
	expect(() => verifyPhysicalActivityAdvice(missing, sourceFixture)).toThrow(/four activity sections/);
	const swapped = JSON.parse(JSON.stringify(physicalActivityAdvice));
	swapped.zh.references.reverse();
	expect(() => verifyPhysicalActivityAdvice(swapped, sourceFixture)).toThrow(/differs at Word block/);
});

test.each(["zh", "en"])("%s displays all supplied advice, TCM paragraphs and references without truncation", async (language) => {
	const tree = await mount(ActivityAdviceScreen, language);
	const content = physicalActivityAdvice[language];
	const textNodes = tree.root.findAllByType(Text);
	const paragraphs = [...content.introduction, ...content.sections.flatMap((section) => section.paragraphs), ...content.tcmSections.flatMap((section) => section.paragraphs), ...content.references.map((reference) => reference.text)];
	for (const paragraph of paragraphs) expect(textNodes.some((node) => node.props.children === paragraph)).toBe(true);
	for (const node of textNodes) expect(node.props.numberOfLines).toBeUndefined();
	expect(textNodes.some((node) => node.props.children === content.tcmTitle)).toBe(true);
	expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(144);
	expect(useAndroidBackTarget).toHaveBeenCalledWith("/(tabs)/other");
});

test("source-specific English Good Practice statements are all retained; no invented Chinese translation is added", () => {
	const practice = physicalActivityAdvice.en.sections.find((section) => section.title === "Good Practice statement:");
	expect(practice.paragraphs).toHaveLength(4);
	expect(practice.paragraphs[0]).toBe("Doing some physical activity is better than doing none.");
	expect(physicalActivityAdvice.zh.sections).toHaveLength(3);
	expect(physicalActivityAdvice.zh.tcmSections).toHaveLength(3);
	expect(physicalActivityAdvice.en.tcmSections).toHaveLength(3);
	expect(physicalActivityAdvice.en.references[0].url).toBe("https://www.who.int/publications/i/item/9789240015128");
	expect(physicalActivityAdvice.zh.references).toHaveLength(2);
	expect(physicalActivityAdvice.zh.references[0].text).toContain("世界衛生組織. (2021).");
	expect(physicalActivityAdvice.en.references[0].text).toContain("World Health Organization. (2020).");
	expect(physicalActivityAdvice.zh.references[0].url).toBe(physicalActivityAdvice.en.references[0].url);
});

test.each(["zh", "en"])("%s reference URLs are clickable without rendering long URL strings in the page", async language => {
	const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
	const tree = await mount(ActivityAdviceScreen, language);
	const links = tree.root.findAllByType(TouchableOpacity).filter((node) => node.props.accessibilityRole === "link");
	expect(links).toHaveLength(2);
	for (let index = 0; index < links.length; index += 1) {
		await act(async () => links[index].props.onPress());
		expect(open).toHaveBeenNthCalledWith(index + 1, physicalActivityAdvice[language].references[index].url);
	}
	expect(tree.root.findAllByType(Text).some((node) => String(node.props.children).includes("https://"))).toBe(false);
});

test.each(["zh", "en"])("%s published overrides can edit the new heading, existing paragraph and both reference URLs without changing reference indexes", async language => {
	const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
	const defaults = JSON.stringify(physicalActivityAdvice);
	const text = language === "zh" ? { heading: "活動建議文獻", paragraph: "後台已更新的活動建議文字。" } : { heading: "Activity references", paragraph: "Updated activity advice from administration." };
	const overrides = normalizeAppTextOverrides({ version: 1, overrides: {
		'activity.activityReferencesTitle': { [language]: text.heading },
		'activity.sections.0.paragraphs.0': { [language]: text.paragraph },
		'activity.references.0.url': { [language]: 'https://example.invalid/updated-who-reference' },
		'activity.references.1.url': { [language]: 'https://example.invalid/updated-tcm-reference' },
	} });
	expect(overrides['activity.activityReferencesTitle']?.[language]).toBe(text.heading);
	setAppTextOverrides(overrides);
	const tree = await mount(ActivityAdviceScreen, language);
	const values = tree.root.findAllByType(Text).map(node => node.props.children);
	expect(values).toContain(text.heading);
	expect(values).toContain(text.paragraph);
	expect(values).not.toContain(physicalActivityAdvice[language].sections[0].paragraphs[0]);
	expect(values.indexOf(text.heading)).toBeLessThan(values.indexOf(physicalActivityAdvice[language].tcmTitle));
	const links = tree.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityRole === 'link');
	expect(links.map(node => node.props.accessibilityLabel)).toEqual([`${menuTranslations[language].physicalActivityAdviceReference} 1`, `${menuTranslations[language].physicalActivityAdviceReference} 2`]);
	for (const link of links) await act(async () => link.props.onPress());
	expect(open.mock.calls).toEqual([['https://example.invalid/updated-who-reference'], ['https://example.invalid/updated-tcm-reference']]);
	expect(JSON.stringify(physicalActivityAdvice)).toBe(defaults);
	const other = await mount(ActivityAdviceScreen, language === 'zh' ? 'en' : 'zh');
	expect(other.root.findAllByType(Text).map(node => node.props.children)).not.toContain(text.heading);
});

test.each(["zh", "en"])("%s repeated reference URLs retain two separate clickable bibliography entries", async language => {
	const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
	const sharedUrl = 'https://example.invalid/shared-reference';
	setAppTextOverrides(normalizeAppTextOverrides({ version: 1, overrides: {
		'activity.references.0.url': { [language]: sharedUrl },
		'activity.references.1.url': { [language]: sharedUrl },
	} }));
	const tree = await mount(ActivityAdviceScreen, language);
	const values = tree.root.findAllByType(Text).map(node => node.props.children);
	for (const reference of physicalActivityAdvice[language].references) expect(values.filter(text => text === reference.text)).toHaveLength(1);
	const links = tree.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityRole === 'link');
	expect(links).toHaveLength(2);
	expect(new Set(links.map(node => node.props.accessibilityLabel)).size).toBe(2);
	for (const link of links) await act(async () => link.props.onPress());
	expect(open.mock.calls).toEqual([[sharedUrl], [sharedUrl]]);
});

test("a failed external reference opens a friendly message rather than an unhandled rejection", async () => {
	jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("offline"));
	const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
	const tree = await mount(ActivityAdviceScreen);
	await act(async () => tree.root.findAllByType(TouchableOpacity)[0].props.onPress());
	expect(alert).toHaveBeenCalledWith(menuTranslations.zh.physicalActivityAdviceReference, menuTranslations.zh.physicalActivityAdviceLinkError);
});

test.each([true, false])("Other positions the new entry after research, before usage; guest=%s can open it", async (isGuest) => {
	const tree = await mount(OtherScreen, "zh", { isGuest, user: { profileRole: "participant" } });
	const buttons = tree.root.findAllByType(TouchableOpacity);
	expect(buttons.slice(0, 4).map((button) => button.props.accessibilityLabel)).toEqual(["風險管理", "大學研究", "體能活動建議", "statistics"]);
	await act(async () => buttons[2].props.onPress());
	expect(router.push).toHaveBeenCalledWith("/activity-advice");
});

test("iOS header back returns to Other with the existing reverse transition option", async () => {
	Platform.OS = "ios";
	const tree = await mount(ActivityAdviceLayout);
	expect(tree.root.findByType(Stack).props.screenOptions.animationTypeForReplace).toBe("pop");
	const options = tree.root.findByType(Stack.Screen).props.options;
	expect(options.title).toBe("體能活動建議");
	await act(async () => options.headerLeft().props.onPress());
	expect(router.replace).toHaveBeenCalledWith("/(tabs)/other");
});
