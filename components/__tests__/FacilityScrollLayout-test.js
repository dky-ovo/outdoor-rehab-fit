import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { router } from "expo-router";
import useFacilityScrollInsets from "../../hooks/useFacilityScrollInsets";
import FacilityLocationHeaderButton from "../FacilityLocationHeaderButton";
import Outdoor from "../../app/(tabs)/outdoor";
import EquipmentList from "../../app/(tabs)/outdoor/list";
import Detail from "../../app/(tabs)/outdoor/detail";
import { getEquipmentCatalog, getEquipmentCategories } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoute = {};
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
const mockNavigation = { setOptions: jest.fn() };
const mockItems = [{ id: 0, name: "Tai Chi Wheel / Taiji Pushing / Push Hands", categories: ["mobility"], details: Array.from({ length: 45 }, (_, i) => `Step ${i + 1}: use the handles steadily.`).join("\n"), ptTip: "Long explanation. ".repeat(180) }];
jest.mock("@react-navigation/bottom-tabs", () => ({ BottomTabBarHeightContext: require("react").createContext(undefined) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: require("react-native").View, SafeAreaInsetsContext: require("react").createContext(null) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), canGoBack: () => false }, useLocalSearchParams: () => mockRoute, useNavigation: () => mockNavigation, useFocusEffect: (callback) => require("react").useEffect(callback, [callback]) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? mockItems : key } }) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { id: "participant", token: "test" }, isGuest: false, canAccessEquipment: () => true }) }));
jest.mock("../../utils/api", () => ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), getEquipmentCategories: jest.fn(), resolveApiAssetUrl: (value) => value, sendResearchEvent: jest.fn() }));
jest.mock("../../utils/bookmarks", () => ({ getBookmarks: async () => ({}), saveBookmarks: jest.fn() }));
jest.mock("../../utils/sessions", () => ({ getSessions: async () => [] }));
jest.mock("../../utils/usage", () => ({ trackIntroLoad: jest.fn(), trackAudioPlay: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../utils/userStorage", () => ({ getCurrentOwnerKey: () => "participant", userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
jest.mock("../../utils/learning", () => ({ ...jest.requireActual("../../utils/learning"), recordLearningCoverage: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/accessControl", () => ({ showGuestRestrictionAlert: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useDeferredDetailContent", () => () => true);
jest.mock("../../hooks/useVideoPlaybackEvents", () => () => jest.fn());
jest.mock("../../components/CustomBackButton", () => () => null);
jest.mock("../../components/SearchBar", () => () => null);
jest.mock("../../components/TTSButton", () => () => null);
jest.mock("../../components/AudioPlayer", () => () => null);
jest.mock("../../components/EquipmentIndoorVideos", () => () => null);
jest.mock("../../components/ManagedContent", () => { const { Text } = require("react-native"); return () => <Text testID="facility-last-content">Last uploaded information</Text>; });
jest.mock("../../components/MediaVideo", () => { const { Text } = require("react-native"); return () => <Text testID="facility-portrait-video">Portrait video</Text>; });
jest.mock("../../components/ThemedText", () => ({ ThemedText: require("react-native").Text }));
jest.mock("../../components/ThemedView", () => ({ ThemedView: require("react-native").View }));
jest.mock("../../components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("../../constants/Equipments", () => ({ enSoundFiles: {}, zhSoundFiles: {}, gifFiles1: { 0: { uri: "https://example.test/left.gif" } }, gifFiles2: { 0: { uri: "https://example.test/right.gif" } } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" }));
jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: (value) => parseFloat(value) * 3.2, heightPercentageToDP: (value) => parseFloat(value) * 5.68 }));
jest.mock("react-native-youtube-iframe", () => "mock-youtube");

let tree;
const originalOS = Platform.OS;
function providers(element, height = 112, bottom = 34) {
	return <SafeAreaInsetsContext.Provider value={{ top: 20, left: 0, right: 0, bottom }}><BottomTabBarHeightContext.Provider value={height}>{element}</BottomTabBarHeightContext.Provider></SafeAreaInsetsContext.Provider>;
}
const mount = async (element, height = 112, bottom = 34) => act(async () => { tree = renderer.create(providers(element, height, bottom)); });
const contentStyle = (node) => StyleSheet.flatten(node.props.contentContainerStyle);
beforeEach(() => {
	jest.clearAllMocks(); Platform.OS = "ios"; mockRoute = { id: "0", from: "list", categoryId: "all", categoryName: "All" };
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: 0, isActive: true, videoUrl: "https://example.test/portrait.mp4" }] });
	getEquipmentCategories.mockResolvedValue({ categories: [] });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; });

function Probe() { return <ScrollView {...useFacilityScrollInsets(85.2)} />; }
test.each([[112, 34, 128], [78, 0, 94], [150, 34, 166], [null, 34, 128], [0, 0, 16]])("iOS uses actual tab height %s instead of a percentage-sized or double safe inset", async (height, bottom, expected) => {
	await mount(<Probe />, height, bottom);
	const scroll = tree.root.findByType(ScrollView);
	expect(contentStyle(scroll).paddingBottom).toBe(expected);
	expect(scroll.props.scrollIndicatorInsets.bottom).toBe(expected - 16);
	expect(scroll.props.contentInsetAdjustmentBehavior).toBe("never");
	expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
});

test("Android retains existing spacing without adding its already-occupied tab bar", async () => {
	Platform.OS = "android"; await mount(<Probe />);
	expect(contentStyle(tree.root.findByType(ScrollView)).paddingBottom).toBe(85.2);
	expect(tree.root.findByType(ScrollView).props.scrollIndicatorInsets.bottom).toBe(0);
});

test.each([["zh", 76, "位置"], ["en", 104, "Location"]])("%s native header location action has bounded width, a full 44pt target and separated text", async (locale, width, label) => {
	const onPress = jest.fn(); await mount(<FacilityLocationHeaderButton locale={locale} onPress={onPress} />);
	const button = tree.root.findByType(TouchableOpacity);
	const style = StyleSheet.flatten(button.props.style);
	expect(style).toMatchObject({ width, height: 44, minHeight: 44, flexGrow: 0, flexShrink: 0 });
	const icon = tree.root.findByType("Ionicons");
	expect(icon.props.size).toBe(20); expect(StyleSheet.flatten(icon.props.style)).toMatchObject({ width: 20, marginRight: 4, flexShrink: 0 });
	const text = tree.root.findByType(Text);
	expect(text.props.children).toBe(label); expect(text.props.numberOfLines).toBe(1); expect(text.props.maxFontSizeMultiplier).toBe(1.2);
	await act(async () => button.props.onPress()); expect(onPress).toHaveBeenCalledTimes(1);
});

test("categories and facility list both reserve scrollable clearance below their final row", async () => {
	await mount(<Outdoor />);
	let scroll = tree.root.findByType(ScrollView);
	expect(contentStyle(scroll)).toMatchObject({ flexGrow: 1, paddingBottom: 128 });
	expect(contentStyle(scroll).height).toBeUndefined();
	await act(async () => tree.update(providers(<EquipmentList />)));
	const list = tree.root.findByType(FlatList);
	expect(contentStyle(list)).toMatchObject({ paddingBottom: 128 });
	expect(list.props.data).toHaveLength(1);
	expect(contentStyle(list).height).toBeUndefined();
});

test("expanded long instructions, both GIFs, video and final managed content remain in the unbounded detail scroll", async () => {
	await mount(<Detail />);
	const scroll = tree.root.findByType(ScrollView);
	expect(contentStyle(scroll)).toMatchObject({ flexGrow: 1, paddingBottom: 128 });
	expect(contentStyle(scroll).height).toBeUndefined(); expect(contentStyle(scroll).maxHeight).toBeUndefined();
	expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flex: 1 });
	for (const label of ["tip2", "useTips"]) {
		const button = tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label));
		await act(async () => button.props.onPress());
	}
	expect(scroll.findAllByType(Text).some((node) => node.props.children === "Step 45: use the handles steadily.")).toBe(true);
	expect(scroll.findAllByType(Text).some((node) => node.props.children === mockItems[0].ptTip)).toBe(true);
	expect(scroll.findAllByType(Image).map((node) => node.props.source?.uri).filter((uri) => uri?.endsWith(".gif"))).toEqual(["https://example.test/left.gif", "https://example.test/right.gif"]);
	expect(scroll.findByProps({ testID: "facility-portrait-video" })).toBeTruthy();
	expect(scroll.findByProps({ testID: "facility-last-content" })).toBeTruthy();
	const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
	expect(options.headerRight().type).toBe(FacilityLocationHeaderButton);
	await act(async () => options.headerRight().props.onPress());
	expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/equipmentmap", params: expect.objectContaining({ equipmentId: "0", locationSource: "detail", detailFrom: "list" }) }));
});

test("safe padding responds to the tab navigator height changing after layout", async () => {
	await mount(<Detail />, 78, 0);
	expect(contentStyle(tree.root.findByType(ScrollView)).paddingBottom).toBe(94);
	await act(async () => tree.update(providers(<Detail />, 112, 34)));
	expect(contentStyle(tree.root.findByType(ScrollView)).paddingBottom).toBe(128);
});
