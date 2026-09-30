import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Outdoor from "../../app/(tabs)/outdoor";
import { LocaleContext } from "../../contexts/LocaleContext";
import { showAlert } from "../../utils/alert";
import { getEquipmentCategories } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useFocusEffect: (callback) => require("react").useEffect(callback, [callback]) }));
jest.mock("../../utils/api", () => ({ getEquipmentCategories: jest.fn().mockResolvedValue({ categories: [] }) }));
jest.mock("../../contexts/LocaleContext", () => ({
	LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key } }),
}));
jest.mock("../../components/CustomBackButton", () => () => null);
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" }));

let tree;
beforeEach(() => { jest.clearAllMocks(); getEquipmentCategories.mockResolvedValue({ categories: [] }); });
afterEach(async () => {
	if (tree) await act(async () => tree.unmount());
	tree = null;
});

test.each([["zh", "民間智慧"], ["en", "Local Tips"]])("local tips uses its own category rather than TCM in %s", async (locale, label) => {
	await act(async () => { tree = renderer.create(<LocaleContext.Provider value={{ locale, i18n: { t: (key) => key } }}><Outdoor /></LocaleContext.Provider>); });
	expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toContain(label);
	await act(async () => tree.root.findAllByType(TouchableOpacity)[10].props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/outdoor/list", params: { categoryName: label, categoryId: "alternative" } });
});

test("server-renamed and custom categories retain immutable ids and default built-in icons", async () => {
	getEquipmentCategories.mockResolvedValue({ categories: [{ id: "muscle", nameZh: "肌力訓練", nameEn: "Strength" }, { id: "category-test", nameZh: "新分類", nameEn: "Custom", showInGuide: true, sortOrder: 99 }] });
	await act(async () => { tree = renderer.create(<LocaleContext.Provider value={{ locale: "zh", i18n: { t: (key) => key } }}><Outdoor /></LocaleContext.Provider>); });
	const labels = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(labels).toContain("肌力訓練"); expect(labels).toContain("新分類");
	await act(async () => tree.root.findAllByType(TouchableOpacity).at(-1).props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/outdoor/list", params: { categoryName: "新分類", categoryId: "category-test" } });
});

test.each([
	["zh", "中風人士", "內容正在準備中，稍後開放。"],
	["en", "Chronic Stroke Survivor", "This content is being prepared and will be available later."],
])("facility category uses the requested %s label and keeps its locked behavior", async (locale, label, message) => {
	await act(async () => {
		tree = renderer.create(
			<LocaleContext.Provider value={{ locale, i18n: { t: (key) => key } }}>
				<Outdoor />
			</LocaleContext.Provider>
		);
	});
	const labels = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(labels).toContain(label);
	expect(labels).not.toContain("熱身建議");
	expect(labels).not.toContain("Warm-up Recommendations");
	const buttons = tree.root.findAllByType(TouchableOpacity);
	expect(buttons).toHaveLength(13);
	const renamedButton = buttons[12];
	expect(renamedButton.findByType("MaterialCommunityIcons").props.name).toBe("human-handsup");
	expect(renamedButton.findByType("Ionicons").props.name).toBe("lock-closed");
	await act(async () => renamedButton.props.onPress());
	expect(showAlert).toHaveBeenCalledWith("", message);
	expect(router.push).not.toHaveBeenCalled();
	await act(async () => buttons[0].props.onPress());
	expect(router.push).toHaveBeenCalledWith({
		pathname: "/outdoor/list",
		params: { categoryName: "all", categoryId: "all" },
	});
});
