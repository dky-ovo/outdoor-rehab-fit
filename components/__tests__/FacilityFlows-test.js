import React from "react";
import renderer, { act } from "react-test-renderer";
import { FlatList, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Favourite from "../../app/(tabs)/favorite";
import OfficialFacilityLocations from "../../app/(tabs)/location";
import { getEquipmentCatalog, getFacilities } from "../../utils/api";
import { getBookmarks, saveBookmarks } from "../../utils/bookmarks";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({
	router: { push: jest.fn(), replace: jest.fn() },
	useFocusEffect: (callback) => require("react").useEffect(callback, [callback]),
}));
jest.mock("../../contexts/LocaleContext", () => ({
	LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? [{ id: 0, name: "Tai Chi Wheel", categories: ["upper"] }] : key } }),
}));
jest.mock("../../contexts/AuthContext", () => {
	const auth = { user: { id: "one", token: "test" }, isGuest: false, canAccessEquipment: () => true };
	return { useAuth: () => auth };
});
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../utils/api", () => ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn(), getFacilities: jest.fn(), resolveApiAssetUrl: (value) => value }));
jest.mock("../../utils/bookmarks", () => ({ getBookmarks: jest.fn(), saveBookmarks: jest.fn() }));
jest.mock("../../utils/userStorage", () => ({ getCurrentOwnerKey: () => "one" }));
jest.mock("../../utils/learning", () => ({ getLearningProgress: () => Promise.resolve({}), equipmentLearningFlags: () => ({ read: false, watched: false, listened: false }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-vector-icons/Ionicons", () => "Icon");
jest.mock("expo-image", () => ({ Image: "CachedImage" }));

let tree;
beforeEach(() => {
	jest.clearAllMocks();
	getBookmarks.mockResolvedValue({ custom: true, 0: true });
	saveBookmarks.mockResolvedValue();
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: "custom", isCustom: true, isActive: true, nameEn: "New Facility", categories: ["mobility"], imageUrl: "https://example.test/image.jpg" }] });
});
afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
	jest.useRealTimers();
});

test("bookmarked custom facilities remain visible and return to Favorites after opening", async () => {
	await act(async () => { tree = renderer.create(<Favourite />); });
	const list = tree.root.findByType(FlatList);
	expect(list.props.data.map((item) => item.id)).toEqual([0, "custom"]);
	const custom = list.props.data.find((item) => item.id === "custom");
	const card = list.props.renderItem({ item: custom });
	card.props.onPress();
	expect(router.push).toHaveBeenCalledWith({ pathname: "/favorite/detail", params: { id: "custom", name: "New Facility", from: "favorite" } });
});

test("removing a favorite does not also open its detail and keeps other bookmarks", async () => {
	await act(async () => { tree = renderer.create(<Favourite />); });
	const list = tree.root.findByType(FlatList);
	const card = list.props.renderItem({ item: list.props.data[0] });
	const remove = React.Children.toArray(card.props.children).find((child) => child.type === TouchableOpacity);
	const stopPropagation = jest.fn();
	await act(async () => remove.props.onPress({ stopPropagation }));
	expect(stopPropagation).toHaveBeenCalledTimes(1);
	expect(router.push).not.toHaveBeenCalled();
	expect(saveBookmarks).toHaveBeenCalledWith({ custom: true }, { changedIds: [0] });
	expect(tree.root.findByType(FlatList).props.data.map((item) => item.id)).toEqual(["custom"]);
});

test("a slow previous map search cannot replace the current search results", async () => {
	jest.useFakeTimers();
	let resolveFirst; let resolveSecond;
	getFacilities.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
		.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
	await act(async () => { tree = renderer.create(<OfficialFacilityLocations />); });
	await act(async () => jest.advanceTimersByTime(250));
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("Kowloon"));
	await act(async () => jest.advanceTimersByTime(250));
	await act(async () => resolveSecond({ facilities: [{ id: "new", nameEn: "Kowloon Park" }], districts: [] }));
	expect(tree.root.findByType(FlatList).props.data[0].id).toBe("new");
	await act(async () => resolveFirst({ facilities: [{ id: "old", nameEn: "Old Park" }], districts: [] }));
	expect(tree.root.findByType(FlatList).props.data[0].id).toBe("new");
});
