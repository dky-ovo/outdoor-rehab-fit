import React from "react";
import renderer, { act } from "react-test-renderer";
import { BackHandler, Platform, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { getVolunteerParticipantUsage, getVolunteerParticipants } from "../../utils/api";
import { AuthContext } from "../../contexts/AuthContext";
import ListScreen from "../../app/(tabs)/participant-usage/index";
import DatesScreen from "../../app/(tabs)/participant-usage/detail";
import DayScreen from "../../app/(tabs)/participant-usage/day";
import { useUsageBack } from "../../hooks/useUsageBack";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockSearchParams = { participantId: "participant-1", date: "2026-09-04", view: "exercise" };
jest.mock("expo-router", () => ({
	router: { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
	useLocalSearchParams: () => mockSearchParams,
	useFocusEffect: (callback) => require("react").useEffect(callback, [callback]),
	Stack: { Screen: () => null },
}));
jest.mock("../../utils/api", () => ({ getVolunteerParticipantUsage: jest.fn(), getVolunteerParticipants: jest.fn(), addVolunteerParticipant: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../components/CountrySelector", () => () => null);
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { token: "test" } }) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key } }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const days = [
	{ date: "2026-09-05", exerciseMinutes: 999, exerciseSessions: 1, appSessions: 4, researchEvents: 2, screenViews: 8 },
	{ date: "2026-09-04", exerciseMinutes: 17, outdoorSessions: 2, homeSessions: 1, exerciseSessions: 3, appSessions: 5, researchEvents: 3, screenViews: 9, audioPlays: 2 },
];
let tree;
beforeEach(() => {
	Platform.OS = "android";
	mockSearchParams = { participantId: "participant-1", date: "2026-09-04", view: "exercise" };
	jest.clearAllMocks();
	getVolunteerParticipantUsage.mockResolvedValue({ participant: { id: "participant-1", name: "User One", phone: "61234567" }, days });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("selecting a date opens that participant and day without showing all daily metrics", async () => {
	await act(async () => { tree = renderer.create(<DatesScreen />); });
	const dates = tree.root.findAllByType(TouchableOpacity);
	expect(dates).toHaveLength(2);
	await act(async () => dates[1].props.onPress());
	expect(router.push).toHaveBeenCalledWith({ pathname: "/participant-usage/day", params: { participantId: "participant-1", date: "2026-09-04", view: "exercise" } });
	expect(tree.root.findAllByType(Text).map((node) => node.props.children)).not.toContain("exerciseMinutes");
});

test("day details display only the selected date with usage cards", async () => {
	let hardwareBack;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { hardwareBack = callback; return { remove: jest.fn() }; });
	await act(async () => { tree = renderer.create(<DayScreen />); });
	const text = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(text).toContain(17);
	expect(text).not.toContain(999);
	expect(text).toContain("usageOutdoorSessions");
	expect(getVolunteerParticipantUsage).toHaveBeenCalledWith("test", "participant-1");
	expect(hardwareBack()).toBe(true);
	expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/participant-usage/detail", params: { participantId: "participant-1", view: "exercise" } });
});

test("usage entry excludes exercise metrics from its daily view", async () => {
	mockSearchParams = { participantId: "participant-1", date: "2026-09-04", view: "usage" };
	await act(async () => { tree = renderer.create(<DayScreen />); });
	const text = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(text).toContain("appStarts");
	expect(text).toContain("screenViews");
	expect(text).not.toContain("exerciseMinutes");
	expect(text).not.toContain("usageOutdoorSessions");
	const learning = tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === "participant-learning-day-entry");
	await act(async () => learning.props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/participant-usage/learning", params: { participantId: "participant-1", date: "2026-09-04", view: "usage" } });
});

test("usage dates include learning-only days and offer cumulative learning separately", async () => {
	mockSearchParams = { participantId: "participant-1", view: "usage" };
	getVolunteerParticipantUsage.mockResolvedValue({ participant: { id: "participant-1", name: "User One" }, days: [{ date: "2026-09-22", facilityLearningCount: 1 }, { date: "2026-09-21", exerciseSessions: 1 }] });
	await act(async () => { tree = renderer.create(<DatesScreen />); });
	const buttons = tree.root.findAllByType(TouchableOpacity);
	expect(buttons).toHaveLength(2);
	const learning = buttons.find(node => node.props.testID === "participant-learning-total-entry");
	await act(async () => learning.props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/participant-usage/learning", params: { participantId: "participant-1", view: "usage" } });
	await act(async () => buttons.find(node => !node.props.testID).props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/participant-usage/day", params: { participantId: "participant-1", date: "2026-09-22", view: "usage" } });
});

test.each([DatesScreen, DayScreen])("exercise views do not acquire Facility Guide entries", async Component => {
	await act(async () => { tree = renderer.create(<Component />); });
	expect(tree.root.findAllByType(TouchableOpacity).filter(node => String(node.props.testID).startsWith("participant-learning-"))).toHaveLength(0);
});

test("Android back returns to Other and removes the handler on leaving", async () => {
	const remove = jest.fn(); let hardwareBack;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { hardwareBack = callback; return { remove }; });
	function Root() { useUsageBack("/(tabs)/other"); return null; }
	await act(async () => { tree = renderer.create(<Root />); });
	expect(hardwareBack()).toBe(true);
	expect(router.replace).toHaveBeenCalledWith("/(tabs)/other");
	await act(async () => tree.unmount()); tree = null;
	expect(remove).toHaveBeenCalledTimes(1);
});

test("late participant-list responses cannot show the previous account's participants", async () => {
	let resolveFirst;
	getVolunteerParticipants.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
		.mockResolvedValueOnce({ participants: [{ id: "second", name: "New Account Participant", phone: "22222222" }] });
	const screen = (token) => <AuthContext.Provider value={{ user: { token, profileRole: "volunteer" } }}><ListScreen /></AuthContext.Provider>;
	await act(async () => { tree = renderer.create(screen("first-account")); });
	await act(async () => tree.update(screen("second-account")));
	await act(async () => resolveFirst({ participants: [{ id: "first", name: "Old Account Participant", phone: "11111111" }] }));
	const rendered = tree.root.findAllByType(Text).flatMap((node) => React.Children.toArray(node.props.children)).filter((value) => typeof value === "string").join(" ");
	expect(rendered).toContain("New Account Participant");
	expect(rendered).not.toContain("Old Account Participant");
});
