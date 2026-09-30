import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import EquipmentList from "../../app/(tabs)/outdoor/list";
import { AuthContext } from "../../contexts/AuthContext";
import { getEquipmentCatalog } from "../../utils/api";
import { showGuestRestrictionAlert } from "../../utils/accessControl";
import { useAndroidBackTarget } from "../../hooks/useAndroidBackTarget";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams;
const mockNavigation = { setOptions: jest.fn() };
const mockItems = [
	{ id: 0, name: "Aerobic facility", categories: ["aerobic"], icon: null },
	{ id: 1, name: "Balance facility", categories: ["balance"], icon: null },
	{ id: 2, name: "Muscle facility", categories: ["muscle"], icon: null },
];
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useNavigation: () => mockNavigation, useLocalSearchParams: () => mockParams, useFocusEffect: (callback) => require("react").useEffect(callback, [callback]) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? mockItems : key } }) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ isGuest: false, canAccessEquipment: () => true, user: { id: "user" } }) }));
jest.mock("../../components/SearchBar", () => () => null);
jest.mock("../../utils/api", () => ({ getCachedEquipmentCatalog: () => null, loadCachedEquipmentCatalog: async () => null, getEquipmentCatalog: jest.fn() }));
jest.mock("../../utils/bookmarks", () => ({ getBookmarks: async () => ({}), saveBookmarks: jest.fn() }));
jest.mock("../../utils/sessions", () => ({ getSessions: async () => [] }));
jest.mock("../../utils/accessControl", () => ({ showGuestRestrictionAlert: jest.fn() }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
let tree;
const mount = async (guest = false) => act(async () => { tree = renderer.create(<AuthContext.Provider value={{ isGuest: guest, canAccessEquipment: () => !guest, user: { id: "user" } }}><EquipmentList /></AuthContext.Provider>); });
const textButton = (name) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === name));
beforeEach(() => { jest.clearAllMocks(); mockParams = { categoryId: "aerobic", categoryName: "Aerobic", from: "goals" }; getEquipmentCatalog.mockResolvedValue({ items: [], categories: [] }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each(["aerobic", "balance", "muscle"])("%s recommendation filters correctly and visible/hardware back target is goals", async (categoryId) => {
	mockParams = { ...mockParams, categoryId };
	await mount();
	const expected = mockItems.find((item) => item.categories.includes(categoryId));
	const names = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(names).toContain(expected.name);
	for (const item of mockItems.filter((item) => item !== expected)) expect(names).not.toContain(item.name);
	expect(useAndroidBackTarget).toHaveBeenLastCalledWith("/(tabs)/goals");
	const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
	expect(options.gestureEnabled).toBe(false);
	await act(async () => options.headerLeft().props.onPress());
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)/goals");
	await act(async () => textButton(expected.name).props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/outdoor/detail", params: { id: String(expected.id), name: expected.name, from: "list", categoryId, categoryName: "Aerobic", listFrom: "goals" } });
	await act(async () => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.accessibilityLabel === "View facility locations").props.onPress());
	expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/equipmentmap", params: expect.objectContaining({ listFrom: "goals", categoryId, locationSource: "list" }) }));
});

test("guest recommendation keeps locked items locked rather than bypassing the guide", async () => {
	await mount(true);
	await act(async () => textButton("Aerobic facility").props.onPress());
	expect(showGuestRestrictionAlert).toHaveBeenCalledTimes(1);
	expect(router.push).not.toHaveBeenCalled();
});

test("renamed server category changes the title without changing its filter id", async () => {
	getEquipmentCatalog.mockResolvedValue({ items: [], categories: [{ id: "aerobic", nameEn: "Cardio" }] });
	await mount();
	expect(mockNavigation.setOptions.mock.calls.at(-1)[0].headerTitle).toBe("Cardio");
	expect(textButton("Aerobic facility")).toBeTruthy();
});
