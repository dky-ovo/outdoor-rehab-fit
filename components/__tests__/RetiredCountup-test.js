import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import CountupSession from "../../app/(tabs)/session/countup";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession;
let mockFocused = true;
const mockNavigation = { setOptions: jest.fn(), addListener: jest.fn(() => () => {}), isFocused: () => mockFocused };
jest.mock("expo-router", () => ({ router: { replace: jest.fn(), dismissTo: jest.fn() }, useNavigation: () => mockNavigation, useLocalSearchParams: () => ({}) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused, useFocusEffect: (callback) => require("react").useEffect(callback, [callback]), usePreventRemove: jest.fn() }));
jest.mock("../../contexts/ActiveSessionContext", () => ({ useActiveSession: () => mockSession }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key } }) }));
jest.mock("../../app/(tabs)/session/summary", () => "SessionSummary");
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
let tree;
const button = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label));
const mount = async () => act(async () => { tree = renderer.create(<CountupSession />); });
beforeEach(() => {
	jest.clearAllMocks(); mockFocused = true;
	mockSession = { mode: null, recordMode: "countup", hydrated: true, started: false, running: false, seconds: 0, pendingSummary: null, chooseMode: jest.fn(), setCountdownDuration: jest.fn(), startCountdown: jest.fn(), toggleRunning: jest.fn(), resetSession: jest.fn(), finishSession: jest.fn(), clearPendingSummary: jest.fn() };
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("direct visits leave once without starting any timer or exposing start controls", async () => {
	await mount();
	expect(router.replace).toHaveBeenCalledTimes(1);
	expect(router.replace).toHaveBeenCalledWith("/(tabs)");
	expect(mockSession.chooseMode).not.toHaveBeenCalled(); expect(mockSession.resetSession).not.toHaveBeenCalled();
	expect(button("start")).toBeUndefined();
});

test("an old paused timer resumes, can finish, and a discarded timer cannot be restarted", async () => {
	mockSession = { ...mockSession, mode: "outdoor", started: true, seconds: 130 };
	await mount();
	expect(router.replace).not.toHaveBeenCalled();
	await act(async () => button("resume").props.onPress());
	expect(mockSession.toggleRunning).toHaveBeenCalledTimes(1);
	await act(async () => button("discardSession").props.onPress());
	await act(async () => showAlert.mock.calls.at(-1)[2].find((action) => action.style === "destructive").onPress());
	expect(mockSession.resetSession).toHaveBeenCalledTimes(1);
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)");
	mockSession = { ...mockSession, mode: null, started: false };
	await act(async () => tree.update(<CountupSession />));
	expect(button("start")).toBeUndefined(); expect(mockSession.chooseMode).not.toHaveBeenCalled();
});

test("legacy summary remains saveable and another active timer is never reset by a retired deep link", async () => {
	mockSession = { ...mockSession, mode: "outdoor", pendingSummary: { id: "old" } };
	await mount();
	expect(tree.root.findByType("SessionSummary").props.embeddedSummaryId).toBe("old");
	expect(router.replace).not.toHaveBeenCalled();
	await act(async () => tree.unmount()); tree = null;
	mockSession = { ...mockSession, recordMode: "countdown", started: true, pendingSummary: null };
	await mount();
	expect(router.replace).toHaveBeenLastCalledWith("/(tabs)");
	expect(mockSession.resetSession).not.toHaveBeenCalled(); expect(mockSession.chooseMode).not.toHaveBeenCalled();
});

test("a pending manual draft is not mistaken for count-up after context resets to its empty mode", async () => {
	mockSession = { ...mockSession, pendingSummary: { id: "manual-draft", recordMode: "manual" } };
	await mount();
	expect(tree.root.findAllByType("SessionSummary")).toHaveLength(0);
	expect(router.replace).toHaveBeenCalledTimes(1);
	expect(mockSession.clearPendingSummary).not.toHaveBeenCalled(); expect(mockSession.resetSession).not.toHaveBeenCalled();
});
