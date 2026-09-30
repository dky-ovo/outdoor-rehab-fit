import React from "react";
import { act, create } from "react-test-renderer";
import { Keyboard, Platform } from "react-native";
import { Stack, router } from "expo-router";
import { CommonActions, StackActions, StackRouter } from "@react-navigation/routers";
import SettingLayout from "../../app/(tabs)/setting/_layout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-router", () => {
	const Stack = ({ children }) => children;
	Stack.Screen = () => null;
	return { Stack, router: { dismissTo: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() } };
});
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { t: key => key } }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
let tree;
const childScreens = ["contact", "profile", "about", "disclaimer", "privacy", "info"];
const routeNames = ["index", ...childScreens];
const originalPlatform = Platform.OS;
beforeEach(async () => {
	jest.resetAllMocks(); Platform.OS = "android";
	router.canGoBack.mockReturnValue(true);
	await act(async () => { tree = create(<SettingLayout />); });
});
afterEach(async () => { await act(async () => tree.unmount()); Platform.OS = originalPlatform; });

test.each(childScreens)("repeated %s visits use the same native back action and preserve Settings", async screenName => {
	const reducer = StackRouter({ initialRouteName: "index" });
	const config = { routeNames, routeParamList: {}, routeGetIdList: {} };
	let state = reducer.getInitialState(config);
	const indexKey = state.routes[0].key;
	router.back.mockImplementation(() => {
		state = reducer.getStateForAction(state, CommonActions.goBack(), config);
	});
	const screen = tree.root.findAllByType(Stack.Screen).find(item => item.props.name === screenName);
	for (let visit = 0; visit < 4; visit += 1) {
		state = reducer.getStateForAction(state, StackActions.push(screenName), config);
		expect(state.routes.map(route => route.name)).toEqual(["index", screenName]);
		await act(async () => screen.props.options.headerLeft().props.onPress());
		expect(state.routes.map(route => route.name)).toEqual(["index"]);
		expect(state.routes[0].key).toBe(indexKey);
	}
	expect(router.replace).not.toHaveBeenCalled();
	expect(router.dismissTo).not.toHaveBeenCalled();
});

test.each(childScreens)("deep-linked %s has the same Settings fallback without back history", async screenName => {
	const reducer = StackRouter({ initialRouteName: screenName });
	const config = { routeNames, routeParamList: {}, routeGetIdList: {} };
	let state = reducer.getInitialState(config);
	router.canGoBack.mockReturnValue(false);
	router.replace.mockImplementation(target => {
		expect(target).toBe("/(tabs)/setting");
		state = reducer.getStateForAction(state, StackActions.replace("index"), config);
	});
	const screen = tree.root.findAllByType(Stack.Screen).find(item => item.props.name === screenName);
	await act(async () => screen.props.options.headerLeft().props.onPress());
	expect(state.routes.map(route => route.name)).toEqual(["index"]);
	expect(router.back).not.toHaveBeenCalled(); expect(router.dismissTo).not.toHaveBeenCalled();
});

test("Contact inherits About's navigation options without a keyboard-dismiss step", async () => {
	const dismiss = jest.spyOn(Keyboard, "dismiss");
	try {
		const stack = tree.root.findByType(Stack);
		const contact = tree.root.findAllByType(Stack.Screen).find(screen => screen.props.name === "contact");
		const about = tree.root.findAllByType(Stack.Screen).find(screen => screen.props.name === "about");
		expect(stack.props.screenOptions.animation).toBe("fade");
		expect(stack.props.screenOptions.animationTypeForReplace).toBe("pop");
		expect(contact.props.options.animation).toBeUndefined();
		for (const key of ["animation", "animationTypeForReplace", "presentation", "gestureEnabled", "headerShown"]) {
			expect(contact.props.options[key]).toBe(about.props.options[key]);
		}
		await act(async () => contact.props.options.headerLeft().props.onPress());
		expect(dismiss).not.toHaveBeenCalled();
		expect(router.back).toHaveBeenCalledTimes(1); expect(router.dismissTo).not.toHaveBeenCalled();
	} finally { dismiss.mockRestore(); }
});

test("all Settings routes keep their header inside the same stack, including the index home return", async () => {
	const stack = tree.root.findByType(Stack);
	const screens = tree.root.findAllByType(Stack.Screen);
	expect(screens.map(screen => screen.props.name)).toEqual(routeNames);
	const titles = { index: "setting", contact: "contactUs", profile: "userProfile", about: "aboutApp", disclaimer: "settingDisclaimer", privacy: "privacyPolicy", info: "aboutTeam" };
	for (const screen of screens) {
		const options = { ...stack.props.screenOptions, ...screen.props.options };
		expect(options.headerShown).toBe(true);
		expect(options.title).toBe(titles[screen.props.name]);
		expect(options.headerLeft).toEqual(expect.any(Function));
		expect(options.animation).toBe("fade");
		expect(options.animationTypeForReplace).toBe("pop");
	}
	const index = screens.find(screen => screen.props.name === "index");
	await act(async () => index.props.options.headerLeft().props.onPress());
	expect(router.replace).toHaveBeenCalledWith("/(tabs)");
	expect(router.back).not.toHaveBeenCalled();
});

test("Android hardware-return replacement targets Settings with pop direction", () => {
	const reducer = StackRouter({ initialRouteName: "contact" });
	const config = { routeNames, routeParamList: {}, routeGetIdList: {} };
	const state = reducer.getStateForAction(reducer.getInitialState(config), StackActions.replace("index"), config);
	expect(state.routes.map(route => route.name)).toEqual(["index"]);
	const stack = tree.root.findByType(Stack);
	const index = tree.root.findAllByType(Stack.Screen).find(screen => screen.props.name === "index");
	expect({ ...stack.props.screenOptions, ...index.props.options }).toMatchObject({ animation: "fade", animationTypeForReplace: "pop", headerShown: true });
});
