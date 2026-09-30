import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { getWeekStart } from "../dates";
import { getCurrentOwnerKey, getUserJson, setUserJson } from "../userStorage";
import { getSessions } from "../sessions";
import { DEFAULT_GOALS, addSmartGoal, getGoalState, getWeeklyProgress, setTarget, toggleSmartGoal, updateSmartGoal, removeSmartGoal } from "../goals";
import GoalProgressBars from "../../components/GoalProgressBars";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../userStorage", () => ({
	getUserJson: jest.fn(),
	setUserJson: jest.fn(),
	getCurrentOwnerKey: jest.fn(() => "participant-1"),
}));
jest.mock("../sessions", () => ({ getSessions: jest.fn() }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));

const currentGoalState = {
	targetUnitsVersion: 2,
	targets: { ...DEFAULT_GOALS },
	smartGoals: [],
};

const dateInCurrentWeek = (offset) => {
	const date = getWeekStart(new Date());
	date.setDate(date.getDate() + offset);
	date.setHours(12, 0, 0, 0);
	return date.toISOString();
};

beforeEach(() => {
	jest.clearAllMocks();
	getCurrentOwnerKey.mockReturnValue("participant-1");
	getUserJson.mockResolvedValue(currentGoalState);
	setUserJson.mockResolvedValue(undefined);
	getSessions.mockResolvedValue([]);
});

test("rapid changes to different targets and a goal completion are all persisted", async () => {
	let stored = { ...currentGoalState, targets: { ...DEFAULT_GOALS }, smartGoals: [{ id: "goal-1", done: false }] };
	getUserJson.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
	setUserJson.mockImplementation(async (_key, state) => { await Promise.resolve(); stored = JSON.parse(JSON.stringify(state)); });
	await Promise.all([setTarget("aerobic", 160), setTarget("balance", 4), toggleSmartGoal("goal-1")]);
	expect(stored.targets).toEqual({ aerobic: 160, balance: 4, muscle: 2 });
	expect(stored.smartGoals[0].done).toBe(true);
});

test("leaving the target screen immediately still reads the final queued target", async () => {
	let stored = JSON.parse(JSON.stringify(currentGoalState));
	getUserJson.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
	setUserJson.mockImplementation(async (_key, state) => { await Promise.resolve(); stored = state; });
	const saving = setTarget("balance", 6);
	const reopening = getGoalState();
	await saving;
	expect((await reopening).targets.balance).toBe(6);
});

test("editing a completed goal preserves identity, week and completion despite rapid unrelated changes", async () => {
	let stored = { ...currentGoalState, smartGoals: [{ id: "same-id", weekKey: "2026-09-07", done: true, text: "Walk", what: "Walk", frequency: "Daily", duration: "10 min", extra: "keep" }] };
	getUserJson.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
	setUserJson.mockImplementation(async (_key, state) => { stored = JSON.parse(JSON.stringify(state)); });
	await Promise.all([updateSmartGoal("same-id", { what: " Stretch ", frequency: "Twice weekly", duration: "15 min", id: "wrong", done: false }), setTarget("muscle", 4)]);
	expect(stored.smartGoals[0]).toEqual({ id: "same-id", weekKey: "2026-09-07", done: true, text: "Stretch · Twice weekly · 15 min", what: "Stretch", frequency: "Twice weekly", duration: "15 min", extra: "keep" });
	expect(stored.targets.muscle).toBe(4);
});

test("legacy goals can edit plain text and a deleted goal cannot be silently re-created", async () => {
	let stored = { ...currentGoalState, smartGoals: [{ id: "legacy", weekKey: "week", done: true, text: "Old text" }] };
	getUserJson.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
	setUserJson.mockImplementation(async (_key, state) => { stored = JSON.parse(JSON.stringify(state)); });
	await updateSmartGoal("legacy", " New text ");
	expect(stored.smartGoals[0]).toEqual({ id: "legacy", weekKey: "week", done: true, text: "New text" });
	await expect(updateSmartGoal("legacy", " ")).rejects.toThrow("required");
	await removeSmartGoal("legacy");
	await expect(updateSmartGoal("legacy", "Recreate")).rejects.toThrow("not found");
	expect(stored.smartGoals).toEqual([]);
});

test("migrates legacy aerobic days and minutes into one weekly-minute target", async () => {
	getUserJson.mockResolvedValue({
		targets: { aerobic: 5, balance: 3, muscle: 2 },
		minutes: { aerobic: 30, balance: 15, muscle: 15 },
		smartGoals: [{ id: "goal-1", text: "Walk", weekKey: "past", done: false }],
	});

	const state = await getGoalState();

	expect(state.targets).toEqual({ aerobic: 150, balance: 3, muscle: 2 });
	expect(state).not.toHaveProperty("minutes");
	expect(state.targetUnitsVersion).toBe(2);
	expect(setUserJson).toHaveBeenCalledWith("goalSettings", state);
});

test("normalizes target values to the required limits and increments", async () => {
	const aerobic = await setTarget("aerobic", 1264);
	expect(aerobic.targets.aerobic).toBe(1260);

	getUserJson.mockResolvedValue(currentGoalState);
	const balance = await setTarget("balance", 8);
	expect(balance.targets.balance).toBe(7);
});

test("stores structured personalised goals while retaining legacy display text", async () => {
	getUserJson.mockResolvedValue({ ...currentGoalState, targets: { ...DEFAULT_GOALS }, smartGoals: [] });

	const state = await addSmartGoal({ what: " Walk ", frequency: "3 times a week", duration: "20 minutes" });

	expect(state.smartGoals[0]).toEqual(expect.objectContaining({
		what: "Walk",
		frequency: "3 times a week",
		duration: "20 minutes",
		text: "Walk · 3 times a week · 20 minutes",
		done: false,
	}));

	getUserJson.mockResolvedValue({ ...currentGoalState, targets: { ...DEFAULT_GOALS }, smartGoals: [] });
	const legacy = await addSmartGoal("Walk on Monday");
	expect(legacy.smartGoals[0].text).toBe("Walk on Monday");
	expect(legacy.smartGoals[0]).not.toHaveProperty("what");
});

test("uses aerobic duration minutes and unique dates for the other weekly progress", async () => {
	const previousWeek = new Date(getWeekStart(new Date()));
	previousWeek.setDate(previousWeek.getDate() - 1);
	getSessions.mockResolvedValue([
		{ date: dateInCurrentWeek(0), durationSec: 1800, types: { aerobic: true, balance: true } },
		{ date: dateInCurrentWeek(0), durationSec: 900, types: { aerobic: true, balance: true, muscle: true } },
		{ date: dateInCurrentWeek(1), durationSec: 330, types: { aerobic: true, muscle: true } },
		{ date: previousWeek.toISOString(), durationSec: 3600, types: { aerobic: true, balance: true, muscle: true } },
	]);

	const weekly = await getWeeklyProgress();

	expect(weekly.progress).toEqual({ aerobic: 50, balance: 1, muscle: 2 });
	expect(weekly).not.toHaveProperty("minutes");
});

test("hides zero targets and displays the correct unit for each visible goal", async () => {
	const i18n = {
		locale: "en",
		has: (key) => ["minutes", "days"].includes(key),
		t: (key) => ({ aerobicGoal: "Aerobic", balanceGoal: "Balance", muscleGoal: "Muscle", minutes: "minutes", days: "days" }[key] || key),
	};
	let tree;
	await act(async () => {
		tree = renderer.create(
			<GoalProgressBars
				i18n={i18n}
				progress={{ aerobic: 45, balance: 2, muscle: 1 }}
				targets={{ aerobic: 150, balance: 0, muscle: 2 }}
			/>
		);
	});
	const text = tree.root.findAllByType(Text).map((node) => React.Children.toArray(node.props.children).join(""));
	expect(text).toContain("45 / 150 minutes ");
	expect(text).toContain("1 / 2 days ");
	expect(text).not.toContain("Balance");
	await act(async () => tree.unmount());

	await act(async () => {
		tree = renderer.create(
			<GoalProgressBars
				i18n={i18n}
				progress={{ aerobic: 0, balance: 0, muscle: 0 }}
				targets={{ aerobic: 0, balance: 0, muscle: 0 }}
			/>
		);
	});
	expect(tree.toJSON()).toBeNull();
	await act(async () => tree.unmount());
});
