import React from "react";
import renderer, { act } from "react-test-renderer";
import { BackHandler, FlatList, Platform, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { AuthContext } from "../../contexts/AuthContext";
import { LocaleContext } from "../../contexts/LocaleContext";
import { getEquipmentCatalog, getVolunteerParticipantLearning } from "../../utils/api";
import { getLearningProgress, learningContentKey } from "../../utils/learning";
import { learningTextSections } from "../../utils/learningCoverage";
import ListScreen from "../../app/(tabs)/participant-usage/learning";
import DetailScreen from "../../app/(tabs)/participant-usage/learning-detail";
import { ParticipantLearningMetrics } from "../ParticipantLearningProgress";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockParams, mockFocused = true;
jest.mock("react-native", () => {
	const React = require("react"), native = jest.requireActual("react-native");
	function List(props) { return React.createElement("learning-list", null, props.ListHeaderComponent, ...(props.data || []).map((item, index) => React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))), !props.data?.length && props.ListEmptyComponent, props.ListFooterComponent); }
	return Object.defineProperty(Object.create(native), "FlatList", { value: List, enumerable: true });
});
jest.mock("expo-router", () => ({
	router: { push: jest.fn(), dismissTo: jest.fn(), replace: jest.fn() },
	useLocalSearchParams: () => mockParams,
	useFocusEffect: callback => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
	Stack: { Screen: ({ options }) => options.headerLeft?.() || null },
}));
jest.mock("../../utils/api", () => ({ getEquipmentCatalog: jest.fn(), getVolunteerParticipantLearning: jest.fn(), resolveApiAssetUrl: value => value }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("../../utils/learning", () => ({ ...jest.requireActual("../../utils/learning"), getLearningProgress: jest.fn(() => { throw new Error("Must not use the viewer's local progress"); }) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({}) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({}) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: value => value }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

const equipment = { id: 0, name: "太極揉推器", details: "本器材使用教學", videoUrl: "https://example.test/guide.mp4", icon: "https://example.test/guide.jpg" };
const secondEquipment = { ...equipment, id: 1, name: "小腿伸展" };
const group = ratio => ({ parts: [{ key: "one", total: 1000 }], ranges: { one: [[0, ratio * 1000]] } });
const entry = (ratios = [0.75, 0.5, 0.9], locale = "zh", item = equipment) => {
	const textKey = `${locale}:text:${learningContentKey(JSON.stringify(learningTextSections(item)))}`;
	return { version: 2, evidence: { read: { [textKey]: group(ratios[0]) }, watched: { [`${locale}:${learningContentKey(item.videoUrl)}:video`]: group(ratios[1]) }, listened: { [textKey]: group(ratios[2]) } } };
};
const result = (items = [{ equipmentId: "0", entry: entry(), updatedAt: "2026-09-22T01:00:00Z" }], extra = {}) => ({ participant: { id: "participant-1", name: "Participant One" }, items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let tree, auth, localeValue, Screen;
const makeLocale = locale => ({ locale, i18n: { t: key => key === "equipmentList" ? [equipment, secondEquipment] : key } });
const screen = () => <AuthContext.Provider value={auth}><LocaleContext.Provider value={localeValue}><Screen /></LocaleContext.Provider></AuthContext.Provider>;
const render = async () => act(async () => { if (tree) tree.update(screen()); else tree = renderer.create(screen()); });
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const text = () => tree.root.findAllByType(Text).flatMap(node => React.Children.toArray(node.props.children)).filter(value => typeof value === "string").join(" ");
const percent = field => tree.root.findAllByType(Text).find(node => node.props.testID === `participant-learning-percent-${field}`)?.props.children;
beforeEach(() => {
	jest.clearAllMocks(); Platform.OS = "android"; mockFocused = true;
	mockParams = { participantId: "participant-1", view: "usage" };
	auth = { user: { token: "viewer-one", profileRole: "volunteer" } }; localeValue = makeLocale("zh"); Screen = ListScreen;
	getEquipmentCatalog.mockReset().mockResolvedValue({ items: [] });
	getVolunteerParticipantLearning.mockReset().mockResolvedValue(result());
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("cumulative records come only from the authorized server, not viewer favorites or local learning", async () => {
	await render();
	expect(getVolunteerParticipantLearning).toHaveBeenCalledWith("viewer-one", "participant-1", { page: 1, pageSize: 20 });
	expect(getEquipmentCatalog).toHaveBeenCalledTimes(1);
	expect(getLearningProgress).not.toHaveBeenCalled();
	expect(button("participant-learning-equipment-0")).toBeTruthy();
	expect(percent("read")).toBe("75%"); expect(percent("watched")).toBe("50%"); expect(percent("listened")).toBe("90%");
	expect(text()).toContain("舊有未註明日期");
	expect(tree.root.findAllByType("Ionicons").some(node => /heart/.test(node.props.name))).toBe(false);
	await act(async () => button("participant-learning-equipment-0").props.onPress());
	expect(router.push).toHaveBeenCalledWith({ pathname: "/participant-usage/learning-detail", params: { participantId: "participant-1", view: "usage", page: "1", equipmentId: "0" } });
	expect(router.push.mock.calls[0][0].pathname).not.toContain("outdoor");
});

test.each([0, 0.7499, 0.75, 1])("exact completion threshold at %s uses the same coverage as Favorites", async ratio => {
	await act(async () => { tree = renderer.create(<ParticipantLearningMetrics entry={entry([ratio, ratio, ratio])} item={equipment} locale="zh" detailed />); });
	for (const field of ["read", "watched", "listened"]) {
		const icon = tree.root.findAllByType("Ionicons").find(node => node.props.testID === `participant-learning-icon-${field}`);
		expect(icon.props.color).toBe(ratio >= 0.75 ? "#2E8B57" : "#989898");
		expect(percent(field)).toBe(`${Math.floor(ratio * 100)}%`);
	}
});

test("old booleans and another language/content revision cannot falsely highlight current progress", async () => {
	getVolunteerParticipantLearning.mockResolvedValueOnce(result([{ equipmentId: "0", entry: { read: true, watched: true, listened: true } }]));
	await render(); expect(percent("read")).toBe("0%");
	localeValue = makeLocale("en"); await render();
	expect(percent("read")).toBe("0%"); expect(percent("watched")).toBe("0%"); expect(percent("listened")).toBe("0%");
	expect(text()).toContain("current English content");
});

test("an updated current text revision does not reuse the retired reading or speech coverage", async () => {
	getEquipmentCatalog.mockResolvedValueOnce({ items: [{ id: 0, detailsZh: "新的教學版本", videoUrl: equipment.videoUrl }] });
	await render();
	expect(percent("read")).toBe("0%"); expect(percent("listened")).toBe("0%");
	expect(percent("watched")).toBe("50%");
});

test("cumulative header and Android back return to participant dates without inventing a date", async () => {
	let hardwareBack;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { hardwareBack = callback; return { remove: jest.fn() }; });
	await render();
	await act(async () => button("participant-learning-back").props.onPress());
	const expected = { pathname: "/participant-usage/detail", params: { participantId: "participant-1", view: "usage" } };
	expect(router.dismissTo).toHaveBeenLastCalledWith(expected);
	expect(hardwareBack()).toBe(true); expect(router.dismissTo).toHaveBeenLastCalledWith(expected);
});

test("the selected Hong Kong date is isolated from cumulative records", async () => {
	await render(); expect(percent("read")).toBe("75%");
	getVolunteerParticipantLearning.mockResolvedValueOnce(result([{ equipmentId: "0", entry: entry([0.2, 0.1, 0]) }], { date: "2026-09-22" }));
	mockParams = { ...mockParams, date: "2026-09-22" }; await render();
	expect(getVolunteerParticipantLearning).toHaveBeenLastCalledWith("viewer-one", "participant-1", { date: "2026-09-22", page: 1, pageSize: 20 });
	expect(percent("read")).toBe("20%"); expect(text()).toContain("當日進度（香港時間）");
	await act(async () => button("participant-learning-equipment-0").props.onPress());
	expect(router.push).toHaveBeenLastCalledWith({ pathname: "/participant-usage/learning-detail", params: { participantId: "participant-1", date: "2026-09-22", view: "usage", page: "1", equipmentId: "0" } });
	await act(async () => button("participant-learning-back").props.onPress());
	expect(router.dismissTo).toHaveBeenLastCalledWith({ pathname: "/participant-usage/day", params: { participantId: "participant-1", date: "2026-09-22", view: "usage" } });
});

test("server pagination replaces rows, preserves the selected page into details and disables boundary buttons", async () => {
	getVolunteerParticipantLearning.mockResolvedValueOnce(result(undefined, { total: 21, totalPages: 2 }));
	await render(); expect(button("participant-learning-previous").props.disabled).toBe(true); expect(button("participant-learning-next").props.disabled).toBe(false);
	getVolunteerParticipantLearning.mockResolvedValueOnce(result([{ equipmentId: "1", entry: entry([0.1, 0.2, 0.3], "zh", secondEquipment) }], { page: 2, total: 21, totalPages: 2 }));
	await act(async () => button("participant-learning-next").props.onPress());
	expect(getVolunteerParticipantLearning).toHaveBeenLastCalledWith("viewer-one", "participant-1", { page: 2, pageSize: 20 });
	expect(button("participant-learning-equipment-0")).toBeUndefined(); expect(button("participant-learning-equipment-1")).toBeTruthy();
	expect(button("participant-learning-next").props.disabled).toBe(true);
	await act(async () => button("participant-learning-equipment-1").props.onPress());
	expect(router.push.mock.calls.at(-1)[0].params.page).toBe("2");
});

test.each(["account", "participant", "date"])("late %s requests cannot reveal the previous participant or range", async change => {
	const first = deferred(), second = deferred();
	getVolunteerParticipantLearning.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
	await render();
	if (change === "account") auth = { user: { token: "viewer-two" } };
	if (change === "participant") mockParams = { ...mockParams, participantId: "participant-2" };
	if (change === "date") mockParams = { ...mockParams, date: "2026-09-22" };
	await render();
	await act(async () => first.resolve(result(undefined, { participant: { name: "PRIVATE OLD DATA" } })));
	expect(text()).not.toContain("PRIVATE OLD DATA"); expect(button("participant-learning-equipment-0")).toBeUndefined();
	await act(async () => second.resolve(result([], { participant: { name: "Current Participant" } })));
	expect(text()).toContain("Current Participant"); expect(text()).not.toContain("PRIVATE OLD DATA");
});

test.each([404, 403, 500])("a failed refresh (%s) clears prior progress and never falls back to local data", async status => {
	await render(); expect(button("participant-learning-equipment-0")).toBeTruthy();
	getVolunteerParticipantLearning.mockRejectedValueOnce({ status });
	mockFocused = false; await render(); mockFocused = true; await render();
	expect(button("participant-learning-equipment-0")).toBeUndefined(); expect(text()).not.toContain("Participant One");
	expect(text()).toContain(status === 404 ? "伺服器可能需要更新" : status === 403 ? "有權查看" : "無法載入");
	expect(getLearningProgress).not.toHaveBeenCalled();
	await act(async () => button("participant-learning-retry").props.onPress());
	expect(button("participant-learning-equipment-0")).toBeTruthy();
});

test("no token performs no participant or catalog request and displays no cached record", async () => {
	auth = { user: null }; await render();
	expect(getVolunteerParticipantLearning).not.toHaveBeenCalled(); expect(getEquipmentCatalog).not.toHaveBeenCalled();
	expect(text()).toContain("帳戶登入"); expect(getLearningProgress).not.toHaveBeenCalled();
});

test("unmount discards a pending request", async () => {
	const pending = deferred(); getVolunteerParticipantLearning.mockReturnValueOnce(pending.promise);
	await render(); await act(async () => tree.unmount()); tree = null;
	await act(async () => pending.resolve(result()));
	expect(router.push).not.toHaveBeenCalled();
});

test("detail immediately clears previous-account content and rejects late results after account switch", async () => {
	Screen = DetailScreen; mockParams = { ...mockParams, equipmentId: "0" };
	await render(); expect(text()).toContain("Participant One");
	const next = deferred(); getVolunteerParticipantLearning.mockReturnValueOnce(next.promise);
	auth = { user: { token: "viewer-two" } }; await render();
	expect(text()).not.toContain("Participant One"); expect(percent("read")).toBeUndefined();
	await act(async () => next.reject({ status: 403 }));
	expect(text()).toContain("有權查看"); expect(percent("read")).toBeUndefined();
});

test("invalid server responses produce a recoverable error, not false zero-percent participant data", async () => {
	getVolunteerParticipantLearning.mockResolvedValueOnce({ participant: { name: "Bad Response" }, items: "not-an-array" });
	await render();
	expect(text()).toContain("無法載入"); expect(text()).not.toContain("Bad Response");
	expect(button("participant-learning-retry")).toBeTruthy(); expect(getLearningProgress).not.toHaveBeenCalled();
});

test.each([undefined, "2026-09-22"])("detail rechecks server authorization and header/hardware back retain scope %s", async date => {
	let hardwareBack;
	jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { hardwareBack = callback; return { remove: jest.fn() }; });
	Screen = DetailScreen; mockParams = { participantId: "participant-1", equipmentId: "0", view: "usage", page: "2", ...(date ? { date } : {}) };
	await render();
	expect(getVolunteerParticipantLearning).toHaveBeenCalledWith("viewer-one", "participant-1", { page: 1, pageSize: 20, equipmentId: "0", ...(date ? { date } : {}) });
	expect(percent("read")).toBe("75%");
	const expected = { pathname: "/participant-usage/learning", params: { participantId: "participant-1", view: "usage", page: "2", ...(date ? { date } : {}) } };
	await act(async () => button("participant-learning-detail-back").props.onPress()); expect(router.dismissTo).toHaveBeenLastCalledWith(expected);
	expect(hardwareBack()).toBe(true); expect(router.dismissTo).toHaveBeenLastCalledWith(expected);
	expect(router.push).not.toHaveBeenCalled(); expect(getLearningProgress).not.toHaveBeenCalled();
});

test("missing current catalog content is unknown, not borrowed from another equipment or viewer", async () => {
	getVolunteerParticipantLearning.mockResolvedValueOnce(result([{ equipmentId: "999", entry: entry([1, 1, 1]) }]));
	await render();
	expect(button("participant-learning-equipment-999")).toBeTruthy(); expect(percent("read")).toBe("—");
	expect(text()).toContain("未能計算進度");
});

test("server-clamped page is displayed and carried into the detail return route", async () => {
	mockParams = { ...mockParams, page: "99" };
	getVolunteerParticipantLearning.mockResolvedValueOnce(result(undefined, { page: 2, totalPages: 2, total: 21 }));
	await render();
	expect(getVolunteerParticipantLearning.mock.calls[0][2].page).toBe(99);
	expect(button("participant-learning-next").props.disabled).toBe(true);
	const pageLabel = tree.root.findAllByType(Text).find(node => node.props.testID === "participant-learning-page");
	expect(React.Children.toArray(pageLabel.props.children).join("")).toBe("2 / 2");
	await act(async () => button("participant-learning-equipment-0").props.onPress());
	expect(router.push.mock.calls.at(-1)[0].params.page).toBe("2");
});

test("detail queries a stable equipment ID even if learning updates have reordered its original page", async () => {
	Screen = DetailScreen; mockParams = { ...mockParams, page: "5", equipmentId: "1" };
	getVolunteerParticipantLearning.mockResolvedValueOnce(result([{ equipmentId: "1", entry: entry([0.8, 0.9, 1], "zh", secondEquipment) }]));
	await render();
	expect(getVolunteerParticipantLearning).toHaveBeenCalledWith("viewer-one", "participant-1", { page: 1, pageSize: 20, equipmentId: "1" });
	expect(text()).toContain("小腿伸展"); expect(percent("read")).toBe("80%");
	await act(async () => button("participant-learning-detail-back").props.onPress());
	expect(router.dismissTo.mock.calls.at(-1)[0].params.page).toBe("5");
});
