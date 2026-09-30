jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import SmartGoal from "../../app/(tabs)/goals/smart";
import GoalSetting from "../../app/(tabs)/goals";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getGoalState, updateSmartGoal } from "../../utils/goals";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({}), useFocusEffect: (callback) => require("react").useEffect(callback, [callback]) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext(null) }));
jest.mock("../../hooks/useUsageBack", () => ({ useUsageBack: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/goals", () => ({ DEFAULT_GOALS: { aerobic: 150, balance: 3, muscle: 2 }, getGoalState: jest.fn(), updateSmartGoal: jest.fn(), addSmartGoal: jest.fn(), toggleSmartGoal: jest.fn(), removeSmartGoal: jest.fn(), carryOverSmartGoals: jest.fn(), getCurrentWeekSmartGoals: (state) => state.smartGoals, getPastWeekSmartGoals: () => [], setTarget: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));

let tree;
let state;
const mount = async (Component, locale = "zh") => act(async () => { tree = renderer.create(<LocaleContext.Provider value={{ locale, i18n: { locale, t: (key) => key } }}><Component /></LocaleContext.Provider>); });
const button = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label));
beforeEach(() => {
	jest.clearAllMocks();
	state = { targets: { aerobic: 150, balance: 3, muscle: 2 }, smartGoals: [{ id: "one", done: true, what: "Walk", frequency: "Daily", duration: "20 min", text: "Walk · Daily · 20 min" }, { id: "old", text: "A legacy goal", done: false }] };
	getGoalState.mockImplementation(async () => state);
	updateSmartGoal.mockImplementation(async (id, fields) => { state = { ...state, smartGoals: state.smartGoals.map((goal) => goal.id === id ? { ...goal, ...(typeof fields === "string" ? { text: fields } : fields) } : goal) }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test.each([["zh", "查看推薦運動器材"], ["en", "View Recommended Exercise Equipment"]])("all preset cards open their matching equipment category in %s", async (locale, label) => {
	await mount(GoalSetting, locale);
	const buttons = tree.root.findAllByType(TouchableOpacity).filter((node) => node.findAllByType(Text).some((text) => text.props.children === label));
	expect(buttons).toHaveLength(3);
	for (const [index, categoryId] of ["aerobic", "balance", "muscle"].entries()) {
		await act(async () => buttons[index].props.onPress());
		expect(router.push).toHaveBeenLastCalledWith({ pathname: "/outdoor/list", params: { categoryId, categoryName: `${categoryId}Goal`, from: "goals" } });
	}
});

test("completed goals can edit inline without clearing completion, and redundant metadata is hidden", async () => {
	await mount(SmartGoal);
	expect(tree.root.findAllByType(Text).map((node) => node.props.children)).not.toContain("做什麼 · 頻率 · 時間");
	await act(async () => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.accessibilityLabel === "編輯目標").props.onPress());
	const input = tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === "做什麼？");
	await act(async () => input.props.onChangeText("Stretch"));
	await act(async () => button("儲存修改").props.onPress());
	expect(updateSmartGoal).toHaveBeenCalledWith("one", { id: "one", what: "Stretch", frequency: "Daily", duration: "20 min" });
	expect(state.smartGoals[0].done).toBe(true);
	expect(tree.root.findAllByType(Text).some((node) => node.props.children === "Stretch · Daily · 20 min")).toBe(true);
	expect(button("儲存修改")).toBeUndefined();
});

test("legacy text editing can cancel without saving and rejects empty content", async () => {
	await mount(SmartGoal, "en");
	const edit = () => tree.root.findAllByType(TouchableOpacity).filter((node) => node.props.accessibilityLabel === "Edit goal")[1];
	await act(async () => edit().props.onPress());
	await act(async () => button("cancel").props.onPress());
	expect(updateSmartGoal).not.toHaveBeenCalled();
	await act(async () => edit().props.onPress());
	await act(async () => tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === "Goal").props.onChangeText(" "));
	await act(async () => button("Save changes").props.onPress());
	expect(showAlert).toHaveBeenCalled(); expect(updateSmartGoal).not.toHaveBeenCalled();
	await act(async () => tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === "Goal").props.onChangeText("Updated legacy"));
	await act(async () => button("Save changes").props.onPress());
	expect(updateSmartGoal).toHaveBeenCalledWith("old", "Updated legacy");
});
