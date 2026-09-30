jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from "react";
import renderer, { act } from "react-test-renderer";
import { SectionList, Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import SessionDetail from "../../app/(tabs)/sessionlog/detail";
import EditSession from "../../app/(tabs)/sessionlog/edit";
import SessionLog from "../../app/(tabs)/sessionlog/index";
import { getSessionById, getSessions, saveSession, deleteSession } from "../../utils/sessions";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams = { id: "session-1" };
let mockFocused = true;
const mockNavigation = { setOptions: jest.fn(), isFocused: () => mockFocused, addListener: jest.fn() };
let mockBeforeRemove;
let tree;
jest.mock("expo-router", () => ({
	router: { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn() },
	useLocalSearchParams: () => mockParams,
	useNavigation: () => mockNavigation,
	useFocusEffect: (callback) => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { token: "test-token" } }) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? [] : key } }) }));
jest.mock("../../utils/sessions", () => ({ getSessionById: jest.fn(), getSessions: jest.fn(), saveSession: jest.fn(), deleteSession: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../utils/share", () => ({ shareSession: jest.fn() }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));

const record = { id: "session-1", date: "2026-08-01T01:00:00Z", durationSec: 61, mode: "home", journal: "original journal", exercises: [], types: {} };
beforeEach(() => {
	mockParams = { id: "session-1" };
	mockFocused = true;
	jest.clearAllMocks();
	getSessionById.mockResolvedValue(record);
	getSessions.mockResolvedValue([record]);
	saveSession.mockResolvedValue([]);
	deleteSession.mockResolvedValue([]);
	mockNavigation.addListener.mockImplementation((_event, callback) => { mockBeforeRemove = callback; return jest.fn(); });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

const press = (label) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label)).props.onPress();

test("a late detail fetch cannot overwrite the subsequently selected record", async () => {
	let resolveOld;
	getSessionById.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
	await act(async () => { tree = renderer.create(<SessionDetail />); });
	mockParams = { id: "session-2" };
	getSessionById.mockResolvedValueOnce({ ...record, id: "session-2", journal: "second journal" });
	await act(async () => tree.update(<SessionDetail />));
	await act(async () => resolveOld(record));
	const text = tree.root.findAllByType(Text).map((node) => node.props.children);
	expect(text).toContain("second journal");
	expect(text).not.toContain("original journal");
});

test("a missing detail returns to the existing log instead of showing a dead-end blank screen", async () => {
	getSessionById.mockResolvedValueOnce(undefined);
	await act(async () => { tree = renderer.create(<SessionDetail />); });
	expect(router.dismissTo).toHaveBeenCalledWith("/sessionlog");
});

test("cancelling or saving an editor returns to the existing detail without duplicating it", async () => {
	await act(async () => { tree = renderer.create(<EditSession />); });
	await act(async () => press("cancel"));
	expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/sessionlog/detail", params: { id: "session-1" } });
	router.dismissTo.mockClear();
	await act(async () => press("saveSessionChanges"));
	expect(saveSession.mock.calls[0][0].durationSec).toBe(61);
	await act(async () => showAlert.mock.calls.at(-1)[2][0].onPress());
	expect(router.dismissTo).toHaveBeenCalledTimes(1);
	expect(router.replace).not.toHaveBeenCalled();
});

test("leaving a changed editor asks once, and its inactive return handler cannot intercept another page", async () => {
	await act(async () => { tree = renderer.create(<EditSession />); });
	const journal = tree.root.findAllByType(TextInput).find((node) => node.props.multiline);
	await act(async () => journal.props.onChangeText("changed journal"));
	const event = { preventDefault: jest.fn() };
	await act(async () => mockBeforeRemove(event));
	expect(event.preventDefault).toHaveBeenCalledTimes(1);
	expect(showAlert.mock.calls.at(-1)[1]).toBe("discardSessionChanges");
	const inactiveHandler = mockBeforeRemove;
	mockFocused = false;
	await act(async () => tree.update(<EditSession />));
	event.preventDefault.mockClear();
	inactiveHandler(event);
	expect(event.preventDefault).not.toHaveBeenCalled();
});

test("a failed log deletion reports the error and retains the record for a retry", async () => {
	deleteSession.mockRejectedValueOnce(new Error("offline"));
	await act(async () => { tree = renderer.create(<SessionLog />); });
	const deleteButton = tree.root.findAllByType(TouchableOpacity).find((node) => node.props.accessibilityLabel === "delete");
	await act(async () => deleteButton.props.onPress({ stopPropagation: jest.fn() }));
	await act(async () => showAlert.mock.calls.at(-1)[2].find((button) => button.style === "destructive").onPress());
	expect(showAlert.mock.calls.at(-1)[1]).toBe("serverError");
	expect(tree.root.findByType(SectionList).props.sections[0].data).toEqual([record]);
});
