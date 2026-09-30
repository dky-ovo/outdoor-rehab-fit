import React from "react";
import { act, create } from "react-test-renderer";
import { BackHandler, Platform } from "react-native";
import { StackActions, StackRouter, CommonActions } from "@react-navigation/routers";
import { router } from "expo-router";
import useFavoriteDetailBack from "../useFavoriteDetailBack";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockNavigation, mockFocused = true;
jest.mock("expo-router", () => ({
	router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
	useNavigation: () => mockNavigation,
	useFocusEffect: callback => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
const stackRouter = StackRouter({ initialRouteName: "index" });
const config = { routeNames: ["index", "detail"], routeParamList: {}, routeGetIdList: {} };
let tree, onBack, hardwareBack, remove, state;
const originalOS = Platform.OS;
function Probe() { onBack = useFavoriteDetailBack(); return null; }
beforeEach(() => {
	Platform.OS = "android"; mockFocused = true; jest.clearAllMocks();
	state = stackRouter.getInitialState(config);
	mockNavigation = { getState: () => state, goBack: jest.fn(() => { state = stackRouter.getStateForAction(state, CommonActions.goBack(), config); }) };
	remove = jest.fn(); hardwareBack = null;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { hardwareBack = callback; return { remove }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = originalOS; jest.restoreAllMocks(); });
const mount = async () => act(async () => { tree = create(<Probe />); });

test.each(["header", "hardware"])("%s pops to the existing Favorites list without replacing it or switching tabs", async source => {
	const indexKey = state.routes[0].key;
	state = stackRouter.getStateForAction(state, StackActions.push("detail", { id: "0" }), config);
	await mount();
	if (source === "header") onBack(); else expect(hardwareBack()).toBe(true);
	expect(state.routes.map(route => route.name)).toEqual(["index"]);
	expect(state.routes[0].key).toBe(indexKey);
	expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
	expect(router.back).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
});

test("a direct detail link with unrelated global history returns to /favorite instead of another tab", async () => {
	state = { ...state, index: 0, routes: [{ name: "detail", key: "direct-detail", params: { id: "0" } }] };
	await mount(); onBack();
	expect(router.replace).toHaveBeenCalledWith("/favorite"); expect(mockNavigation.goBack).not.toHaveBeenCalled();
});

test("Android hardware handler is removed while a map covers the detail, then restored on return", async () => {
	await mount();
	mockFocused = false; await act(async () => tree.update(<Probe />));
	expect(remove).toHaveBeenCalledTimes(1);
	mockFocused = true; await act(async () => tree.update(<Probe />));
	expect(BackHandler.addEventListener).toHaveBeenCalledTimes(2);
});

test.each(["ios", "web"])("%s leaves the native/browser back gesture untouched", async platform => {
	Platform.OS = platform; await mount();
	expect(BackHandler.addEventListener).not.toHaveBeenCalled();
});
