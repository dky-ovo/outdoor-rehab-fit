import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import SessionSummary from "../../app/(tabs)/session/summary";
import { saveSession } from "../../utils/sessions";
import { getWeeklyProgress } from "../../utils/goals";
import { trackSessionCompleted, trackGoalAchieved } from "../../utils/usage";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockSummary = { id: "ended-during-lock", durationSec: 60, completedAt: "2026-09-08T08:00:00Z", mode: "outdoor", recordMode: "countdown" };
const mockClear = jest.fn();
const mockDraft = jest.fn();
const mockExit = jest.fn();
let tree;
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ summaryId: "ended-during-lock" }), useNavigation: () => ({}), router: {} }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? [] : key } }) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { id: "participant", token: "token" } }) }));
jest.mock("../../contexts/ActiveSessionContext", () => ({ useActiveSession: () => ({ pendingSummary: mockSummary, pendingSummaryDraft: null, getPendingSummary: () => mockSummary, clearPendingSummary: mockClear, updatePendingSummaryDraft: mockDraft }) }));
jest.mock("../../utils/sessions", () => ({ getSessions: jest.fn(async () => []), saveSession: jest.fn() }));
jest.mock("../../utils/goals", () => ({ getWeeklyProgress: jest.fn() }));
jest.mock("../../utils/usage", () => ({ trackSessionCompleted: jest.fn(), trackGoalAchieved: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: () => 20, heightPercentageToDP: () => 20 }));

const saveButton = () => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === "saveAndContinue"));
beforeEach(async () => {
	jest.clearAllMocks();
	mockSummary.durationSec = 60;
	mockSummary.editableTiming = false;
	saveSession.mockResolvedValue([mockSummary]);
	getWeeklyProgress.mockResolvedValue({ targets: { aerobic: 150, balance: 3, muscle: 2 }, progress: {} });
	trackSessionCompleted.mockResolvedValue({});
	trackGoalAchieved.mockResolvedValue({});
	await act(async () => { tree = renderer.create(<SessionSummary embedded embeddedSummaryId={mockSummary.id} onExit={mockExit} />); });
});
afterEach(async () => { await act(async () => tree.unmount()); });

test("a completed locked-screen countdown saves without waiting for network progress or upload", async () => {
	getWeeklyProgress.mockImplementation((token) => token ? new Promise(() => {}) : Promise.resolve({ targets: {}, progress: {} }));
	await act(async () => saveButton().props.onPress());
	expect(getWeeklyProgress.mock.calls).toEqual([[], []]);
	expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ id: mockSummary.id, durationSec: 60, date: mockSummary.completedAt }), "token", { waitForSync: false });
	expect(showAlert).toHaveBeenLastCalledWith("", "sessionSaved", expect.any(Array));
	expect(mockExit).not.toHaveBeenCalled();
	await act(async () => showAlert.mock.calls.at(-1)[2][0].onPress());
	expect(mockExit).toHaveBeenCalledTimes(1);
});

test("optional statistics failing cannot misreport a successfully saved record as failed", async () => {
	trackSessionCompleted.mockRejectedValueOnce(new Error("statistics unavailable"));
	getWeeklyProgress.mockRejectedValueOnce(new Error("goals unavailable"));
	await act(async () => saveButton().props.onPress());
	expect(saveSession).toHaveBeenCalledTimes(1);
	expect(showAlert).toHaveBeenLastCalledWith("", "sessionSaved", expect.any(Array));
});

test("failed achievement tracking still shows the correct saved result", async () => {
	getWeeklyProgress.mockResolvedValueOnce({ targets: { balance: 1 }, progress: { balance: 0 } });
	getWeeklyProgress.mockResolvedValueOnce({ targets: { balance: 1 }, progress: { balance: 1 } });
	trackGoalAchieved.mockRejectedValueOnce(new Error("statistics unavailable"));
	await act(async () => saveButton().props.onPress());
	expect(showAlert).toHaveBeenLastCalledWith("", "sessionSaved\ngoalAchievedMsg", expect.any(Array));
});

test("local write failure retains the draft and re-enables retry instead of navigating away", async () => {
	saveSession.mockRejectedValueOnce(new Error("device storage full"));
	await act(async () => saveButton().props.onPress());
	expect(showAlert).toHaveBeenLastCalledWith("", "serverError");
	expect(saveButton().props.disabled).toBe(false);
	expect(mockClear).not.toHaveBeenCalled();
	expect(mockExit).not.toHaveBeenCalled();
	await act(async () => saveButton().props.onPress());
	expect(showAlert).toHaveBeenLastCalledWith("", "sessionSaved", expect.any(Array));
});

test("rapid repeated save taps create one record and one completion event", async () => {
	await act(async () => {
		const press = saveButton().props.onPress;
		await Promise.all([press(), press(), press()]);
	});
	expect(saveSession).toHaveBeenCalledTimes(1);
	expect(trackSessionCompleted).toHaveBeenCalledTimes(1);
});

test("manual duration starts blank without a 30-minute hint and keeps the minutes unit", async () => {
	mockSummary.durationSec = 0;
	mockSummary.editableTiming = true;
	await act(async () => tree.update(<SessionSummary key="manual-empty" embedded embeddedSummaryId={mockSummary.id} onExit={mockExit} />));
	const input = tree.root.findAllByType(TextInput).find(node => node.props.keyboardType === "number-pad" && node.props.maxLength === 4);
	expect(input.props.value).toBe("");
	expect(input.props.placeholder).toBeUndefined();
	expect(tree.root.findAllByType(Text).some(node => node.props.children === "minutes")).toBe(true);
	await act(async () => input.props.onChangeText("45"));
	await act(async () => saveButton().props.onPress());
	expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 2700 }), "token", { waitForSync: false });
});

test("removing the duration hint does not remove an actual existing 30-minute value", async () => {
	mockSummary.durationSec = 1800;
	mockSummary.editableTiming = true;
	await act(async () => tree.update(<SessionSummary key="manual-existing" embedded embeddedSummaryId={mockSummary.id} onExit={mockExit} />));
	const input = tree.root.findAllByType(TextInput).find(node => node.props.keyboardType === "number-pad" && node.props.maxLength === 4);
	expect(input.props.value).toBe("30");
	expect(input.props.placeholder).toBeUndefined();
});
