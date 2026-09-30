import React from "react";
import renderer, { act } from "react-test-renderer";
import { BackHandler, Platform, Text } from "react-native";
import { router, Stack } from "expo-router";
import EquipmentMap from "../../app/(tabs)/equipmentmap";
import EquipmentMapLayout from "../../app/(tabs)/equipmentmap/_layout";
import { equipmentDetailBackTarget } from "../../utils/equipmentLocationRoutes";
import { LocaleContext } from "../../contexts/LocaleContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams = {};
jest.mock("expo-router", () => {
	const Stack = ({ children }) => children;
	Stack.Screen = () => null;
	return {
		Stack,
		router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
		useLocalSearchParams: () => mockParams,
		useFocusEffect: (callback) => require("react").useEffect(callback, [callback]),
	};
});
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key } }) }));
jest.mock("../../utils/api", () => ({ getEquipmentLocations: () => Promise.resolve({ locations: [] }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));

let trees = [];
afterEach(async () => {
	await act(async () => trees.forEach((tree) => tree.unmount()));
	trees = [];
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

test.each([
	[
		{ equipmentId: "0", equipmentName: "Tai Chi Wheel", locationSource: "detail", detailFrom: "favorite" },
		{ pathname: "/favorite/detail", params: { id: "0", name: "Tai Chi Wheel", from: "favorite", categoryId: "", categoryName: "" } },
	],
	[
		{ equipmentId: "0", equipmentName: "Tai Chi Wheel", locationSource: "detail", detailFrom: "ai" },
		{ pathname: "/outdoor/detail", params: { id: "0", name: "Tai Chi Wheel", from: "ai", categoryId: "", categoryName: "" } },
	],
	[
		{ equipmentId: "0", equipmentName: "Tai Chi Wheel", locationSource: "list", categoryId: "muscle", categoryName: "Muscle Strengthening" },
		{ pathname: "/outdoor/list", params: { categoryId: "muscle", categoryName: "Muscle Strengthening" } },
	],
])("map header and Android back return to the precise source despite unrelated tab history: %j", async (params, expected) => {
	mockParams = params;
	Platform.OS = "android";
	let onAndroidBack;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { onAndroidBack = callback; return { remove: jest.fn() }; });
	await act(async () => { trees.push(renderer.create(<EquipmentMap />)); trees.push(renderer.create(<EquipmentMapLayout />)); });
	const options = trees[1].root.findByType(Stack.Screen).props.options({ route: { params } });
	options.headerLeft().props.onPress();
	expect(router.replace).toHaveBeenLastCalledWith(expected);
	expect(onAndroidBack()).toBe(true);
	expect(router.replace).toHaveBeenLastCalledWith(expected);
	expect(router.back).not.toHaveBeenCalled();
	if (expected.pathname === "/outdoor/detail") expect(equipmentDetailBackTarget(expected.params)).toBe("/chat");
});

test("returning through a detail keeps the original facility category", () => {
	expect(equipmentDetailBackTarget({ from: "list", categoryId: "balance", categoryName: "Balance" })).toEqual({ pathname: "/outdoor/list", params: { categoryId: "balance", categoryName: "Balance" } });
});

test("a cached location screen translates its facility name when APP language changes", async () => {
	mockParams = { equipmentId: "0", equipmentName: "太極揉推器", locationSource: "detail", detailFrom: "ai" };
	const localeValue = (locale) => ({ locale, i18n: { t: (key) => key === "equipmentList" ? [{ id: 0, name: locale === "en" ? "Tai Chi Wheel" : "太極揉推器" }] : key } });
	await act(async () => { trees.push(renderer.create(<LocaleContext.Provider value={localeValue("zh")}><EquipmentMap /></LocaleContext.Provider>)); });
	expect(trees[0].root.findAllByType(Text).map((item) => item.props.children)).toContain("太極揉推器");
	await act(async () => trees[0].update(<LocaleContext.Provider value={localeValue("en")}><EquipmentMap /></LocaleContext.Provider>));
	const visibleText = trees[0].root.findAllByType(Text).map((item) => item.props.children);
	expect(visibleText).toContain("Tai Chi Wheel");
	expect(visibleText).not.toContain("太極揉推器");
});
