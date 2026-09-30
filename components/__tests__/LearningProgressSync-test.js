import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import LearningProgressSync from "../LearningProgressSync";
import { createLearningSync } from "../../utils/learningSync";
import { subscribeLearningChanges } from "../../utils/learning";
let mockAuth;
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../utils/userStorage", () => ({ getOwnerKey: user => user.owner }));
jest.mock("../../utils/learning", () => ({ subscribeLearningChanges: jest.fn() }));
jest.mock("../../utils/learningSync", () => ({ createLearningSync: jest.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, worker, changed, stateChanged, unsubscribe, remove;
beforeEach(() => {
	jest.useFakeTimers(); jest.clearAllMocks();
	AppState.currentState = "active";
	mockAuth = { user: { owner: "phone:1", token: "one" }, isGuest: false, isLoading: false };
	worker = { flush: jest.fn().mockResolvedValue(undefined), dispose: jest.fn() }; createLearningSync.mockReturnValue(worker);
	unsubscribe = jest.fn(); remove = jest.fn();
	subscribeLearningChanges.mockImplementation(callback => { changed = callback; return unsubscribe; });
	jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => { stateChanged = callback; return { remove }; });
});
const mount = async () => { await act(async () => { tree = renderer.create(<LearningProgressSync />); }); };
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.useRealTimers(); jest.restoreAllMocks(); });
test("login starts sync and continuous callbacks are throttled, not indefinitely debounced", async () => {
	await mount(); expect(worker.flush).toHaveBeenCalledTimes(1);
	await act(async () => { changed("phone:1"); jest.advanceTimersByTime(10000); changed("phone:1"); jest.advanceTimersByTime(5000); });
	expect(worker.flush).toHaveBeenCalledTimes(2);
});
test("background suspends retries and foreground retries immediately", async () => {
	await mount(); await act(async () => { stateChanged("background"); jest.advanceTimersByTime(120000); });
	expect(worker.flush).toHaveBeenCalledTimes(1);
	await act(async () => stateChanged("active")); expect(worker.flush).toHaveBeenCalledTimes(2);
});
test("logout disposes worker and immediately invalidates captured identity", async () => {
	await mount(); const identity = createLearningSync.mock.calls[0][0]; expect(identity.isCurrent()).toBe(true);
	mockAuth = { user: null, isGuest: false, isLoading: false }; await act(async () => tree.update(<LearningProgressSync />));
	expect(identity.isCurrent()).toBe(false); expect(worker.dispose).toHaveBeenCalled(); expect(remove).toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalled();
});
test.each([{ isGuest: true }, { isLoading: true }])("guest or loading session never starts a worker: %p", async extra => {
	mockAuth = { ...mockAuth, ...extra }; await mount(); expect(createLearningSync).not.toHaveBeenCalled();
});
