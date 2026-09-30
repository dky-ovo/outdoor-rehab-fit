jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import HomeScreen from "../../app/(tabs)/index";
import { LocaleContext } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";
import { guardGuestAccess } from "../../utils/accessControl";
import { FEATURES } from "../../constants/permissions";
import { heightPercentageToDP as hp } from "react-native-responsive-screen";
import { getSessions } from "../../utils/sessions";
import { getWeekDates, toDateKey } from "../../utils/dates";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockHomeFocus;
let mockHomeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock("expo-router", () => ({
	router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
	useFocusEffect: (callback) => { mockHomeFocus = callback; require("react").useEffect(callback, [callback]); },
}));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext(null) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { token: "local-test", name: "Test" }, isGuest: false }) }));
jest.mock("../../components/ManagedContent", () => () => null);
jest.mock("../../components/GoalProgressBars", () => "GoalProgressBars");
jest.mock("../../utils/accessControl", () => ({ guardGuestAccess: jest.fn((_feature, guest, _i18n, onAllowed) => { if (!guest) onAllowed(); }) }));
jest.mock("../../utils/usage", () => ({ trackUsageDay: jest.fn() }));
jest.mock("../../utils/goals", () => ({
	getWeeklyProgress: () => Promise.resolve({ progress: {}, targets: {} }),
	getGoalState: () => Promise.resolve({}),
	getCurrentWeekSmartGoals: () => [],
}));
jest.mock("../../utils/sessions", () => ({ getSessions: jest.fn().mockResolvedValue([]) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockHomeInsets }));

let tree;
const localeValue = (locale) => ({ locale, i18n: { t: (key) => key } });
const button = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label));
const monthLabel = () => tree.root.findAllByType(Text).find((node) => StyleSheet.flatten(node.props.style)?.minWidth);
const monthArrows = () => tree.root.findAllByType(TouchableOpacity).filter((node) => StyleSheet.flatten(node.props.style)?.width === 36);
// React Native mocks can add a composite and a host View for one rendered
// branch. Compare the direct branches of the card rather than wrapper depth.
const childOf = (parent, node) => {
	let child = node;
	while (child && child.parent !== parent) child = child.parent;
	return child;
};
const mount = async (locale = "zh") => act(async () => { tree = renderer.create(<LocaleContext.Provider value={localeValue(locale)}><HomeScreen /></LocaleContext.Provider>); });
beforeEach(() => { jest.clearAllMocks(); Platform.OS = "android"; getSessions.mockResolvedValue([]); mockHomeInsets = { top: 0, right: 0, bottom: 0, left: 0 }; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each(["zh", "en"])("%s home keeps the ordinary AI entry without a microphone shortcut or voice route request", async locale => {
	await mount(locale);
	expect(tree.root.findAll(node => node.props.testID === "home-voice-assistant")).toHaveLength(0);
	expect(router.push).not.toHaveBeenCalled();
	const entry = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === "aiChat");
	await act(async () => entry.props.onPress());
	expect(router.push).toHaveBeenCalledTimes(1);
	expect(router.push).toHaveBeenCalledWith("/chat");
	expect(guardGuestAccess).toHaveBeenCalledWith(FEATURES.AI_CHAT, false, expect.any(Object), expect.any(Function));
});

test("guest ordinary AI entry retains the access guard without a voice shortcut", async () => {
	await act(async () => { tree = renderer.create(<AuthContext.Provider value={{ user: { name: "guest" }, isGuest: true }}><LocaleContext.Provider value={localeValue("zh")}><HomeScreen /></LocaleContext.Provider></AuthContext.Provider>); });
	const entry = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === "aiChat");
	await act(async () => entry.props.onPress());
	expect(guardGuestAccess).toHaveBeenCalledWith(FEATURES.AI_CHAT, true, expect.any(Object), expect.any(Function));
	expect(router.push).not.toHaveBeenCalled();
	expect(entry.findAllByType("Ionicons").map(icon => icon.props.name)).toContain("lock-closed");
	expect(tree.root.findAll(node => node.props.testID === "home-voice-assistant")).toHaveLength(0);
});

test.each([["android", 24], ["ios", 34]])("%s Home has no floating microphone or leftover extra shortcut padding", async (platform, bottom) => {
	Platform.OS = platform; mockHomeInsets.bottom = bottom; await mount();
	expect(tree.root.findAll(node => node.props.testID === "home-voice-assistant")).toHaveLength(0);
	expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(hp("12%"));
});

test.each([[320, 20], [375, 44], [390, 47], [393, 59], [430, 59], [600, 24], [800, 24], [1280, 24], [1600, 24]])(
	"greeting photo uses measured bounds without percentage transforms at width %i and safe top %i",
	async (width, top) => {
		mockHomeInsets = { top, right: 0, bottom: 0, left: 0 };
		await mount();
		const hero = tree.root.findAllByType(View).find((node) => node.props.testID === "home-greeting-hero");
		const heroStyle = StyleSheet.flatten(hero.props.style);
		expect(heroStyle.overflow).toBe("hidden");
		expect(heroStyle.paddingTop).toBeGreaterThanOrEqual(top + 12);
		await act(async () => hero.props.onLayout({ nativeEvent: { layout: { width, height: heroStyle.height } } }));
		const photo = tree.root.findAllByType(Image).find((node) => node.props.testID === "home-greeting-photo");
		const frame = StyleSheet.flatten(photo.props.style);
		expect(photo.props.resizeMode).toBe("cover");
		expect(photo.props.resizeMethod).toBe("resize");
		expect(frame.transform).toBeUndefined();
		expect(frame.position).toBe("absolute");
		expect(typeof frame.width).toBe("number");
		expect(typeof frame.height).toBe("number");
		expect(frame.left).toBeLessThanOrEqual(0);
		expect(frame.top).toBeLessThanOrEqual(0);
		expect(frame.left + frame.width).toBeGreaterThanOrEqual(width);
		expect(frame.top + frame.height).toBeGreaterThanOrEqual(heroStyle.height);
		const before = { ...frame };
		await act(async () => hero.props.onLayout({ nativeEvent: { layout: { width: 0, height: 0 } } }));
		expect(StyleSheet.flatten(photo.props.style)).toEqual(before);
	},
);

test("greeting photo recalculates for a narrower actual container after rotation without changing the image", async () => {
	await mount();
	const hero = tree.root.findAllByType(View).find((node) => node.props.testID === "home-greeting-hero");
	const photo = tree.root.findAllByType(Image).find((node) => node.props.testID === "home-greeting-photo");
	const source = photo.props.source;
	await act(async () => hero.props.onLayout({ nativeEvent: { layout: { width: 844, height: 198 } } }));
	const wide = StyleSheet.flatten(photo.props.style);
	await act(async () => hero.props.onLayout({ nativeEvent: { layout: { width: 320, height: 186 } } }));
	const narrow = StyleSheet.flatten(photo.props.style);
	// Equal horizontal/vertical scale preserves the bundled bitmap's ratio.
	const metadata = Image.resolveAssetSource(source);
	const ratio = (metadata?.width || 5378) / (metadata?.height || 3586);
	expect(wide.width / wide.height).toBeCloseTo(ratio, 8);
	expect(narrow.width / narrow.height).toBeCloseTo(ratio, 8);
	expect(narrow.width).toBeLessThan(wide.width);
	expect(photo.props.source).toBe(source);
	expect(photo.props.resizeMethod).toBe("resize");
	expect(button("新增運動記錄")).toBeTruthy();
});

test.each(["android", "ios", "web"])("%s keeps the same decorative image and layout while requesting safe native decoding", async platform => {
	Platform.OS = platform; await mount();
	const hero = tree.root.findAllByType(View).find(node => node.props.testID === "home-greeting-hero");
	const photo = tree.root.findAllByType(Image).find(node => node.props.testID === "home-greeting-photo");
	const source = photo.props.source;
	for (const [width, height] of [[800, 290], [1280, 290], [600, 260]]) {
		await act(async () => hero.props.onLayout({ nativeEvent: { layout: { width, height } } }));
		const frame = StyleSheet.flatten(photo.props.style);
		expect(photo.props).toMatchObject({ source, resizeMode: "cover", resizeMethod: "resize", accessible: false });
		expect(Object.values(frame).filter(value => typeof value === "number").every(Number.isFinite)).toBe(true);
		expect(frame.width / frame.height).toBeCloseTo(5378 / 3586, 8);
		expect(frame.left + frame.width).toBeGreaterThanOrEqual(width);
		expect(frame.top + frame.height).toBeGreaterThanOrEqual(height);
	}
});

test.each([["zh", "新增運動記錄", "倒數計時器"], ["en", "Add Exercise Record", "Countdown Timer"]])("home keeps manual logging at the top, countdown in the circular grid and no count-up entry in %s", async (locale, manual, countdown) => {
	await mount(locale);
	const manualButton = button(manual);
	expect(StyleSheet.flatten(manualButton.props.style).backgroundColor).toBe("#840B1C");
	await act(async () => manualButton.props.onPress());
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)/session/manual");
	const countdownButton = tree.root.findAllByType(TouchableOpacity).find((node) => node.props.accessibilityLabel === countdown);
	expect(StyleSheet.flatten(countdownButton.props.style).width).toBe(StyleSheet.flatten(countdownButton.props.style).height);
	await act(async () => countdownButton.props.onPress());
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)/session/countdown");
	const labels = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(labels).not.toContain("正數計時器"); expect(labels).not.toContain("Count-up Timer");
});

test("saved-day ticks refresh on returning Home after editing a log date or deleting it", async () => {
	const days = getWeekDates();
	const first = toDateKey(days[0]), next = toDateKey(days[1]);
	getSessions.mockResolvedValue([{ id: "one", date: `${first}T12:00:00` }]);
	await mount();
	const status = (date) => tree.root.findAllByType("Ionicons").find((node) => node.props.testID === `saved-exercise-${date}`).props;
	expect(status(first)).toMatchObject({ name: "checkmark-circle", color: "#2E8B57" });
	expect(status(next).name).toBe("ellipse-outline");
	getSessions.mockResolvedValue([{ id: "one", date: `${next}T12:00:00` }]);
	await act(async () => { mockHomeFocus(); });
	expect(status(first).name).toBe("ellipse-outline"); expect(status(next).name).toBe("checkmark-circle");
	getSessions.mockResolvedValue([]);
	await act(async () => { mockHomeFocus(); });
	expect(status(next).name).toBe("ellipse-outline");
	const row = tree.root.findAll((node) => node.props.testID === "saved-exercise-week")[0];
	expect(row.findAllByType("Ionicons")).toHaveLength(7);
});

test.each([
	["zh", "本週目標進度"],
	["en", "This Week's Goal Progress"],
])("weekly progress heading stays centered with a clear gap above the buttons in %s", async (locale, title) => {
	await mount(locale);
	const heading = tree.root.findAllByType(Text).find((node) => node.props.children === title);
	expect(StyleSheet.flatten(heading.props.style).textAlign).toBe("center");
	expect(StyleSheet.flatten(heading.props.style).marginBottom).toBe(12);
});

test.each([
	["zh", "本週目標進度", "每月運動概覽"],
	["en", "This Week's Goal Progress", "Monthly Exercise Overview"],
])("overview and log buttons sit directly below the heading and above the progress bars in the same card in %s", async (locale, title, overviewLabel) => {
	await mount(locale);
	const heading = tree.root.findAllByType(Text).find((node) => node.props.children === title);
	const overview = button(overviewLabel);
	const log = button("sessionLog");
	const progress = tree.root.findByType("GoalProgressBars");
	const card = heading.parent;
	const buttonRow = overview.parent;
	const renderedButtonRow = childOf(card, buttonRow);
	const renderedProgressRow = childOf(card, progress);

	expect(log.parent === buttonRow).toBe(true);
	expect(Boolean(renderedButtonRow)).toBe(true);
	expect(Boolean(renderedProgressRow)).toBe(true);
	const headingIndex = card.children.indexOf(heading);
	expect(card.children[headingIndex + 1] === renderedButtonRow).toBe(true);
	expect(card.children[headingIndex + 2] === renderedProgressRow).toBe(true);
});

test.each([
	["zh", "本週目標進度", "每月運動概覽"],
	["en", "This Week's Goal Progress", "Monthly Exercise Overview"],
])("expanded calendar stays directly under the action buttons and above progress bars in %s", async (locale, title, overviewLabel) => {
	await mount(locale);
	await act(async () => button(overviewLabel).props.onPress());
	const heading = tree.root.findAllByType(Text).find((node) => node.props.children === title);
	const card = heading.parent;
	const buttonRow = childOf(card, button(overviewLabel));
	const toolbar = childOf(card, monthLabel());
	const firstDay = button(1);
	const calendar = childOf(card, firstDay);
	const progress = childOf(card, tree.root.findByType("GoalProgressBars"));
	const headingIndex = card.children.indexOf(heading);
	expect(buttonRow).toBeTruthy();
	expect(toolbar).toBeTruthy();
	expect(calendar).toBeTruthy();
	expect(progress).toBeTruthy();
	expect(card.children.slice(headingIndex + 1, headingIndex + 5)).toEqual([buttonRow, toolbar, calendar, progress]);
});

test.each([
	["zh", "每月運動概覽"],
	["en", "Monthly Exercise Overview"],
])("monthly overview expands, queries a previous date, switches months and collapses without changing log navigation in %s", async (locale, overviewLabel) => {
	await mount(locale);
	const overview = button(overviewLabel);
	const now = new Date();
	const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const formatMonth = (date) => date.toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "long" });
	expect(monthLabel()).toBeUndefined();
	await act(async () => overview.props.onPress());
	expect(monthLabel().props.children).toBe(formatMonth(now));
	const arrows = monthArrows();
	expect(arrows).toHaveLength(2);
	expect(arrows[1].props.disabled).toBe(true);
	await act(async () => arrows[0].props.onPress());
	expect(monthLabel().props.children).toBe(formatMonth(previousMonth));
	expect(monthArrows()[1].props.disabled).toBe(false);
	const previousDate = button(17);
	expect(previousDate.props.disabled).toBe(false);
	await act(async () => previousDate.props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({
		pathname: "/sessionlog",
		params: { date: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}-17` },
	});
	await act(async () => monthArrows()[1].props.onPress());
	expect(monthLabel().props.children).toBe(formatMonth(now));
	expect(monthArrows()[1].props.disabled).toBe(true);
	// Closing a historical month still resets the next expansion to this month.
	await act(async () => monthArrows()[0].props.onPress());
	await act(async () => overview.props.onPress());
	expect(monthLabel()).toBeUndefined();
	await act(async () => overview.props.onPress());
	expect(monthLabel().props.children).toBe(formatMonth(now));
	await act(async () => overview.props.onPress());
	await act(async () => button("sessionLog").props.onPress());
	expect(router.push).toHaveBeenLastCalledWith("/sessionlog");
});

test.each([
	["zh", "每月運動概覽"],
	["en", "Monthly Exercise Overview"],
])("overview and log icons use equal fixed sizes and both buttons retain the same touch height in %s", async (locale, overviewLabel) => {
	await mount(locale);
	const overview = button(overviewLabel);
	const log = button("sessionLog");
	const overviewText = overview.findAllByType(Text).find((node) => node.props.children === overviewLabel);
	// Narrow phones must show the complete translated label instead of
	// truncating it at a fixed two-line limit.
	expect(overviewText.props.numberOfLines).toBeUndefined();
	const logText = log.findAllByType(Text).find((node) => node.props.children === "sessionLog");
	expect(logText.props.numberOfLines).toBeUndefined();
	expect(StyleSheet.flatten(logText.props.style).flexShrink).toBe(1);
	const mainIcons = [overview, log].map((action) => action.findByType("MaterialCommunityIcons"));
	const arrows = [overview, log].map((action) => action.findByType("Ionicons"));
	expect(mainIcons.map((icon) => icon.props.name)).toEqual(["calendar-month-outline", "clipboard-text-clock"]);
	for (const icon of mainIcons) {
		expect(icon.props.size).toBe(18);
		expect(icon.props.allowFontScaling).toBe(false);
		expect(StyleSheet.flatten(icon.props.style)).toMatchObject({ width: 20, height: 20, flexShrink: 0 });
	}
	for (const arrow of arrows) {
		expect(arrow.props.size).toBe(16);
		expect(arrow.props.allowFontScaling).toBe(false);
		expect(StyleSheet.flatten(arrow.props.style)).toMatchObject({ width: 16, height: 18, flexShrink: 0 });
	}
	for (const action of [overview, log]) expect(StyleSheet.flatten(action.props.style).minHeight).toBe(48);
	expect(arrows.map((icon) => icon.props.name)).toEqual(["chevron-down", "chevron-forward"]);
	await act(async () => overview.props.onPress());
	const expandedArrow = button(overviewLabel).findByType("Ionicons");
	expect(expandedArrow.props.name).toBe("chevron-up");
	expect(expandedArrow.props.size).toBe(16);
	expect(StyleSheet.flatten(expandedArrow.props.style)).toMatchObject({ width: 16, height: 18, flexShrink: 0 });
});
