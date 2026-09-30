import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import useEquipmentLearning, { LearningReadContext, LearningReadContent } from "../../hooks/useEquipmentLearning";
import { getLearningProgress } from "../../utils/learning";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true; let mockOwner = "one";
jest.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: jest.fn() }, View: require("react").forwardRef((props, ref) => require("react").createElement("mock-view", { ...props, ref })) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../utils/userStorage", () => ({ getCurrentOwnerKey: () => mockOwner, userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
let tree; let geometry; let listeners;
const item = { id: 0, ptTip: "a".repeat(100), details: "b".repeat(300) };
function Probe({ open = [], blocked = false, bottomOcclusion = 0 }) {
	const learning = useEquipmentLearning({ item, locale: "en", enabled: true, blocked, identity: mockOwner, bottomOcclusion });
	return <LearningReadContext.Provider value={learning}><View testID="viewport" ref={learning.viewport}>{open.map((section) => <LearningReadContent key={section} section={section}>Text</LearningReadContent>)}</View></LearningReadContext.Provider>;
}
const mount = async (props) => act(async () => { tree = renderer.create(<Probe {...props} />, { createNodeMock: (element) => ({ measureInWindow: (callback) => callback(...(geometry[element.props.testID] || [0, 1000, 300, 300])) }) }); });
const tick = async (ms = 2000) => act(async () => { jest.advanceTimersByTime(ms); });
beforeEach(async () => {
	jest.useFakeTimers(); mockFocused = true; mockOwner = "one"; listeners = new Set(); geometry = { viewport: [0, 0, 300, 300], "learning-read-ptTip": [0, 0, 300, 300], "learning-read-details": [0, 0, 300, 300] };
	jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; });
	await AsyncStorage.clear();
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });
test("opening a page/collapsed sections and a first visible tick do not complete reading", async () => {
	await mount({ open: [] }); await tick(3000); expect(await getLearningProgress()).toEqual({});
	await act(async () => tree.update(<Probe open={["details"]} />)); await tick(1000); expect(await getLearningProgress()).toEqual({});
	await tick(1000); expect((await getLearningProgress())[0].read).toBe(true); // 300/400 characters = exactly 75%.
});
test("short section alone remains 25%; reopening restores unique coverage and reading other section completes", async () => {
	await mount({ open: ["ptTip"] }); await tick(); expect((await getLearningProgress())[0].read).toBe(false);
	await act(async () => tree.unmount()); tree = null; await mount({ open: ["ptTip"] }); await tick();
	expect((await getLearningProgress())[0].read).toBe(false);
	await act(async () => tree.update(<Probe open={["details"]} />)); await tick(); expect((await getLearningProgress())[0].read).toBe(true);
});
test("offscreen/quick-scroll/modal/background text cannot create coverage", async () => {
	geometry["learning-read-details"] = [0, 500, 300, 1000]; await mount({ open: ["details"] }); await tick(); expect(await getLearningProgress()).toEqual({});
	geometry["learning-read-details"] = [0, 0, 300, 1000]; await tick(1000);
	geometry["learning-read-details"] = [0, -300, 300, 1000]; await tick(1000);
	geometry["learning-read-details"] = [0, -700, 300, 1000]; await tick(1000); expect(await getLearningProgress()).toEqual({});
	await act(async () => tree.update(<Probe open={["details"]} blocked />)); await tick(); expect(await getLearningProgress()).toEqual({});
	await act(async () => tree.update(<Probe open={["details"]} />)); await act(async () => listeners.forEach((listener) => listener("background"))); await tick(); expect(await getLearningProgress()).toEqual({});
});
test("account change rejects the old visible page's callbacks", async () => {
	await mount({ open: ["details"] }); mockOwner = "two"; await tick(); expect(await getLearningProgress()).toEqual({});
	expect(await AsyncStorage.getItem("one/learningProgress")).toBeNull();
});
test("iOS bottom tab overlay is excluded from the read viewport", async () => {
	await mount({ open: ["details"], bottomOcclusion: 100 }); await tick();
	const data = (await getLearningProgress())[0]; expect(data.read).toBe(false);
	const group = Object.values(data.evidence.read)[0]; expect(group.ranges.details).toEqual([[0, 200]]);
});
