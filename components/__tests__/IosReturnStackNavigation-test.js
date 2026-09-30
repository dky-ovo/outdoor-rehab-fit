import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform, TouchableOpacity } from "react-native";
import { Stack, router } from "expo-router";
import { StackActions, StackRouter, CommonActions } from "@react-navigation/routers";
import { getReturnStackOptions } from "../../utils/stackNavigationOptions";
import OutdoorLayout from "../../app/(tabs)/outdoor/_layout";
import GoalsLayout from "../../app/(tabs)/goals/_layout";
import ChatLayout from "../../app/(tabs)/chat/_layout";
import EquipmentMapLayout from "../../app/(tabs)/equipmentmap/_layout";
import LocationLayout from "../../app/(tabs)/location/_layout";
import ParticipantUsageLayout from "../../app/(tabs)/participant-usage/_layout";
import ResearchLayout from "../../app/(tabs)/research/_layout";
import RiskLayout from "../../app/(tabs)/risk/_layout";
import SessionLogLayout from "../../app/(tabs)/sessionlog/_layout";
import SettingLayout from "../../app/(tabs)/setting/_layout";
import StatsLayout from "../../app/(tabs)/stats/_layout";
import SessionLayout from "../../app/(tabs)/session/_layout";
import FavoriteLayout from "../../app/(tabs)/favorite/_layout";
import FavoriteDetailMotion from "../FavoriteDetailMotion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams = {};
jest.mock("expo-router", () => {
	const Stack = ({ children }) => children;
	Stack.Screen = () => null;
	return {
		Stack,
		router: { replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true },
		useLocalSearchParams: () => mockParams,
	};
});
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { t: (key) => key } }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));

const layouts = [
	["outdoor", OutdoorLayout], ["goals", GoalsLayout], ["chat", ChatLayout],
	["equipmentmap", EquipmentMapLayout], ["location", LocationLayout],
	["participant-usage", ParticipantUsageLayout], ["research", ResearchLayout],
	["risk", RiskLayout], ["sessionlog", SessionLogLayout], ["setting", SettingLayout], ["stats", StatsLayout],
	["favorite", FavoriteLayout],
];
const originalPlatform = Platform.OS;
let trees = [];
const mount = async (Component) => {
	let tree;
	await act(async () => { tree = renderer.create(<Component />); });
	trees.push(tree);
	return tree;
};
const screenOptions = (tree, name, params = {}) => {
	const stack = tree.root.findByType(Stack);
	const screen = tree.root.findAllByType(Stack.Screen).find((item) => item.props.name === name);
	const options = typeof screen.props.options === "function" ? screen.props.options({ route: { params } }) : screen.props.options;
	return { ...stack.props.screenOptions, ...options };
};
beforeEach(() => { Platform.OS = "ios"; mockParams = {}; jest.clearAllMocks(); });
afterEach(async () => {
	await act(async () => trees.forEach((tree) => tree.unmount()));
	trees = [];
	Platform.OS = originalPlatform;
});

test.each(layouts)("%s supplies iOS pop replacement without overriding native push/back animation", async (_name, Layout) => {
	const tree = await mount(Layout);
	const stack = tree.root.findByType(Stack);
	expect(stack.props.screenOptions.animationTypeForReplace).toBe("pop");
	expect(stack.props.screenOptions.animation).toBeUndefined();
	expect(stack.props.screenOptions.gestureDirection).toBeUndefined();
	expect(stack.props.screenLayout).toBeUndefined();
	for (const screen of tree.root.findAllByType(Stack.Screen)) {
		expect(screenOptions(tree, screen.props.name).animationTypeForReplace).toBe("pop");
	}
});

test.each(layouts)("%s keeps Android scale/fade scoped to Settings and Favorites", async (name, Layout) => {
	Platform.OS = "android";
	const tree = await mount(Layout);
	const options = tree.root.findByType(Stack).props.screenOptions;
	const scaled = ["setting", "favorite"].includes(name);
	expect(options.animationTypeForReplace).toBe(scaled ? "pop" : undefined);
	expect(options.animation).toBe(scaled ? "fade" : undefined);
	if (scaled) expect(tree.root.findByType(Stack).props.screenLayout).toEqual(expect.any(Function));
	else expect(tree.root.findByType(Stack).props.screenLayout).toBeUndefined();
});

test("Favorites scales only the incoming detail; its list keeps a fixed size and its own header", async () => {
	Platform.OS = "android";
	const tree = await mount(FavoriteLayout);
	const layout = tree.root.findByType(Stack).props.screenLayout;
	const child = <test-content />;
	expect(layout({ children: child, route: { name: "index" } })).toBe(child);
	expect(layout({ children: child, route: { name: "detail" } }).type).toBe(FavoriteDetailMotion);
	expect(screenOptions(tree, "index").headerShown).toBe(true);
	expect(screenOptions(tree, "detail").headerShown).toBe(true);
});

test("web does not acquire an iOS transition", () => {
	expect(getReturnStackOptions("web")).toEqual({});
});

test("timer mode replacements keep their intentional animation:none and gesture protection", async () => {
	const tree = await mount(SessionLayout);
	for (const name of ["index", "countdown", "countup", "manual", "summary"]) {
		const options = screenOptions(tree, name);
		expect(options.animation).toBe("none");
		expect(options.animationTypeForReplace).toBeUndefined();
	}
	expect(screenOptions(tree, "summary").gestureEnabled).toBe(false);
});

test.each(["home", "goals"])("personalized goal return preserves its %s parent and native action", async (from) => {
	mockParams = { from };
	const tree = await mount(GoalsLayout);
	const button = screenOptions(tree, "smart").headerLeft();
	let buttonTree;
	await act(async () => { buttonTree = renderer.create(button); });
	trees.push(buttonTree);
	await act(async () => buttonTree.root.findByType(TouchableOpacity).props.onPress());
	if (from === "home") {
		expect(router.replace).toHaveBeenCalledWith("/(tabs)");
		expect(router.dismissTo).not.toHaveBeenCalled();
	} else {
		expect(router.dismissTo).toHaveBeenCalledWith("/(tabs)/goals");
		expect(router.replace).not.toHaveBeenCalled();
	}
	expect(screenOptions(tree, "smart").gestureEnabled).toBe(false);
});

test("map replacement keeps source category and original AI/favorites return chain", async () => {
	const tree = await mount(EquipmentMapLayout);
	const options = screenOptions(tree, "index", { equipmentId: "0", locationSource: "detail", detailFrom: "ai", equipmentName: "Tai Chi Wheel", categoryId: "balance" });
	await act(async () => options.headerLeft().props.onPress());
	expect(router.replace).toHaveBeenCalledWith({ pathname: "/outdoor/detail", params: { id: "0", name: "Tai Chi Wheel", from: "ai", categoryId: "balance", categoryName: "" } });
	expect(options.gestureEnabled).toBe(false);
});

test("actual StackRouter preserves push, back, and dismissTo parent semantics with pop replacement options", async () => {
	const tree = await mount(OutdoorLayout);
	const reducer = StackRouter({ initialRouteName: "index" });
	const config = { routeNames: ["index", "list", "detail"], routeParamList: {}, routeGetIdList: {} };
	let state = reducer.getInitialState(config);
	const dispatch = (action) => { state = reducer.getStateForAction(state, action, config); };
	dispatch(StackActions.push("list", { categoryId: "balance" }));
	dispatch(StackActions.push("detail", { id: "0" }));
	expect(state.routes.map((route) => route.name)).toEqual(["index", "list", "detail"]);
	const listKey = state.routes[1].key;
	dispatch(CommonActions.goBack());
	expect(state.routes.map((route) => route.name)).toEqual(["index", "list"]);
	expect(state.routes[1].key).toBe(listKey);
	dispatch(StackActions.push("detail", { id: "1" }));
	dispatch(StackActions.popTo("list", { categoryId: "balance" }));
	expect(state.routes.map((route) => route.name)).toEqual(["index", "list"]);
	expect(state.routes[1].key).toBe(listKey);
	// Existing deterministic replace retains its exact parent rather than using
	// arbitrary history. The incoming screen now tells NativeStack to animate pop.
	dispatch(StackActions.replace("index"));
	expect(state.routes[state.index].name).toBe("index");
	expect(screenOptions(tree, state.routes[state.index].name).animationTypeForReplace).toBe("pop");
});
