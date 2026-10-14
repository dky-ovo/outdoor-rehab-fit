import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState, StyleSheet, Text } from "react-native";
import { Image } from "expo-image";
import Detail from "../../app/(tabs)/outdoor/detail";
import FavoriteDetail from "../../app/(tabs)/favorite/detail";
import { router } from "expo-router";
import ManagedContent from "../ManagedContent";
import MediaVideo from "../MediaVideo";
import WebMediaVideo from "../MediaVideo.web";
import { getCachedEquipmentCatalog, loadCachedEquipmentCatalog, getEquipmentCatalog, getPublicContent, sendResearchEvent } from "../../utils/api";
import { recordLearningCoverage } from "../../utils/learning";
import { LocaleContext } from "../../contexts/LocaleContext";
import EquipmentImage from "../EquipmentImage";
import AudioPlayer from "../AudioPlayer";
import { enSoundFiles, gifFiles1, gifFiles2 } from "../../constants/Equipments";
import { useAndroidBackTarget } from "../../hooks/useAndroidBackTarget";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockSecondaryContentReady = true;
let mockRoute = { id: "0", from: "ai" };
const mockNavigation = { setOptions: jest.fn(), getState: () => ({ type: "stack", index: 1 }), goBack: jest.fn() };
const mockInject = jest.fn();
const mockCatalog = [
	{ id: 0, name: "Tai Chi", icon: 42, horizontalPic: 44, youtubeKey: "-vFxR4gdfPY", categories: [] },
	{ id: 1, name: "Stretch", youtubeKey: "abc12345ABC", categories: [] },
];
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockRoute, useNavigation: () => mockNavigation, useFocusEffect: callback => require("react").useEffect(callback, [callback]), router: { push: jest.fn(), replace: jest.fn(), canGoBack: () => false } }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@react-navigation/bottom-tabs", () => ({ BottomTabBarHeightContext: require("react").createContext(undefined) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ locale: "en", i18n: { t: (key) => key === "equipmentList" ? mockCatalog : key } }) }));
jest.mock("../../contexts/AuthContext", () => ({ AuthContext: require("react").createContext({ user: { id: "participant", token: "participant-token" }, isGuest: false, canAccessEquipment: () => true }) }));
jest.mock("../../constants/Equipments", () => ({ enSoundFiles: {}, zhSoundFiles: {}, gifFiles1: {}, gifFiles2: {} }));
jest.mock("../../utils/api", () => ({ getCachedEquipmentCatalog: jest.fn(), loadCachedEquipmentCatalog: jest.fn(), getEquipmentCatalog: jest.fn(), getPublicContent: jest.fn(), sendResearchEvent: jest.fn(), resolveApiAssetUrl: (value) => value?.startsWith("/") ? `https://app.example${value}` : value }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../utils/userStorage", () => ({ getCurrentOwnerKey: () => "participant", userDataKey: (leaf, owner) => `${owner}/${leaf}` }));
jest.mock("../../utils/learning", () => ({ ...jest.requireActual("../../utils/learning"), recordLearningCoverage: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/usage", () => ({ trackIntroLoad: jest.fn(), trackAudioPlay: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn() }));
jest.mock("../../hooks/useDeferredDetailContent", () => () => mockSecondaryContentReady);
jest.mock("../../components/AudioPlayer", () => () => null);
jest.mock("../../components/TTSButton", () => () => null);
jest.mock("../../components/Collapsible", () => ({ Collapsible: ({ children }) => children }));
jest.mock("../../components/ThemedText", () => ({ ThemedText: require("react-native").Text }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ heightPercentageToDP: () => 220, widthPercentageToDP: () => 320 }));
jest.mock("react-native-youtube-iframe", () => "mock-youtube");
jest.mock("react-native-webview", () => {
	const React = require("react");
	return { WebView: React.forwardRef((props, ref) => { React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject })); return <mock-video-webview {...props} />; }) };
});

let tree;
let appStateListeners;
let now;
const nativeMessage = (player, state, metadata = {}) => player.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "facility-video", state, ...metadata }) } });
const localizedDetail = (locale) => <LocaleContext.Provider value={{ locale, i18n: { t: (key) => key === "equipmentList" ? mockCatalog : key } }}><Detail /></LocaleContext.Provider>;
const mount = async (element) => { await act(async () => { tree = renderer.create(element); }); };
beforeEach(() => {
	jest.clearAllMocks(); mockFocused = true; mockSecondaryContentReady = true; mockRoute = { id: "0", from: "ai" }; now = 1000; appStateListeners = new Set();
	delete enSoundFiles[0]; delete gifFiles1[0]; delete gifFiles2[0];
	jest.spyOn(Date, "now").mockImplementation(() => now);
	jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => { appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) }; });
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: "0", videoUrl: "/api/media/first/first.mp4", isActive: true }] });
	getCachedEquipmentCatalog.mockReturnValue(null); loadCachedEquipmentCatalog.mockResolvedValue(null);
	getPublicContent.mockResolvedValue({ items: [] }); sendResearchEvent.mockResolvedValue({});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("detail paints its image/text without waiting for catalog HTTP, and reserves deferred media space", async () => {
	mockSecondaryContentReady = false;
	enSoundFiles[0] = 99; gifFiles1[0] = 101; gifFiles2[0] = 102;
	getCachedEquipmentCatalog.mockReturnValue({ items: [{ id: "0", isActive: true, videoUrl: "/api/media/current/video.mp4" }] });
	getEquipmentCatalog.mockReturnValue(new Promise(() => {}));
	await mount(<Detail />);
	expect(tree.root.findAllByType(EquipmentImage).some(node => node.props.testID === "equipment-detail-image")).toBe(true);
	expect(tree.root.findAllByType(Text).some(node => node.props.children === "introduction")).toBe(true);
	expect(tree.root.findAllByType("mock-video-webview")).toHaveLength(0);
	expect(tree.root.findAllByType(AudioPlayer)).toHaveLength(0);
	expect(tree.root.findAllByType(EquipmentImage).some(node => node.props.imageKey === "0:left")).toBe(false);
	expect(getPublicContent).not.toHaveBeenCalled();
	const gifStyle = StyleSheet.flatten(tree.root.findByProps({ testID: "equipment-left-gif-placeholder" }).props.style);
	expect(gifStyle.height).toBe(220);
	expect(tree.root.findByProps({ testID: "equipment-audio-placeholder" }).props.style.height).toBe(180);
	expect(tree.root.findByProps({ testID: "equipment-video-placeholder" }).props.style.aspectRatio).toBe(16 / 9);
	mockSecondaryContentReady = true;
	await act(async () => tree.update(<Detail />));
	expect(tree.root.findAllByType("mock-video-webview")).toHaveLength(1);
	expect(tree.root.findAllByType(AudioPlayer)).toHaveLength(1);
	expect(StyleSheet.flatten(tree.root.findAllByType(EquipmentImage).find(node => node.props.imageKey === "0:left").props.style)).toEqual(gifStyle);
	expect(getPublicContent).toHaveBeenCalledWith("outdoor.detail", { signal: expect.any(Object) });
});

test("Favorites reuses the same detail, pops its own stack and preserves its source for map return", async () => {
	mockSecondaryContentReady = false;
	mockRoute = { id: "0", name: "Tai Chi" }; // Direct Favorite URL need not include from.
	await mount(<FavoriteDetail />);
	expect(tree.root.findAllByType(Detail)).toHaveLength(1);
	const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
	expect(options.gestureEnabled).toBe(true);
	options.headerLeft().props.onPress(); expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
	expect(router.replace).not.toHaveBeenCalled();
	expect(useAndroidBackTarget).toHaveBeenLastCalledWith("/favorite", false);
	options.headerRight().props.onPress();
	expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/equipmentmap", params: expect.objectContaining({ equipmentId: "0", locationSource: "detail", detailFrom: "favorite" }) }));
});

test("the original AI detail keeps its explicit Chat return, independent of Favorites stack history", async () => {
	await mount(<Detail />);
	const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
	expect(options.gestureEnabled).toBe(false);
	options.headerLeft().props.onPress(); expect(router.replace).toHaveBeenCalledWith("/chat");
	expect(mockNavigation.goBack).not.toHaveBeenCalled();
});

test("database equipment video override reaches the rendered direct player and background pause records watch time", async () => {
	await mount(<Detail />);
	expect(getEquipmentCatalog).toHaveBeenCalled();
	expect(tree.root.findAllByType("mock-youtube")).toHaveLength(0);
	expect(tree.root.findByType(MediaVideo).props.source).toBe("/api/media/first/first.mp4");
	const player = tree.root.findByType("mock-video-webview");
	expect(player.props.source.html).toContain('src="https://app.example/api/media/first/first.mp4"');
	await act(async () => { nativeMessage(player, "playing"); nativeMessage(player, "playing"); });
	now = 3500;
	await act(async () => { for (const listener of appStateListeners) listener("background"); });
	expect(mockInject).toHaveBeenCalledWith(expect.stringContaining("pause()"));
	expect(recordLearningCoverage).not.toHaveBeenCalled();
	expect(sendResearchEvent.mock.calls).toEqual([
		["participant-token", "video.play", { screen: "outdoor.detail", contentId: 0, videoId: "/api/media/first/first.mp4" }],
		["participant-token", "video.paused", { screen: "outdoor.detail", contentId: 0, videoId: "/api/media/first/first.mp4", watchedMs: 2500, completed: false }],
	]);
	await act(async () => tree.unmount()); tree = null;
	expect(sendResearchEvent).toHaveBeenCalledTimes(2);
});

test("equipment without uploaded replacement keeps existing YouTube player and progress events", async () => {
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: "0", videoUrl: "", isActive: true }] });
	await mount(<Detail />);
	expect(tree.root.findAllByType(MediaVideo)).toHaveLength(0);
	const player = tree.root.findByType("mock-youtube");
	expect(player.props.videoId).toBe("-vFxR4gdfPY");
	await act(async () => player.props.onChangeState("playing")); now = 2000;
	await act(async () => player.props.onChangeState("ended"));
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.completed", expect.objectContaining({ contentId: 0, videoId: "-vFxR4gdfPY", watchedMs: 1000, completed: true }));
});

test("home content chooses direct files versus legacy YouTube and records play and completed duration", async () => {
	getPublicContent.mockResolvedValue({ items: [
		{ id: "new-file", title: "Uploaded", contentType: "video", value: "/api/media/home/home.mp4" },
		{ id: "legacy", title: "Legacy", contentType: "video", value: "https://youtu.be/-vFxR4gdfPY" },
	] });
	await mount(<ManagedContent pageKey="home" />);
	expect(tree.root.findByType(MediaVideo).props.source).toBe("/api/media/home/home.mp4");
	expect(tree.root.findByType("mock-youtube").props.videoId).toBe("-vFxR4gdfPY");
	const player = tree.root.findByType("mock-video-webview");
	await act(async () => nativeMessage(player, "playing")); now = 6100;
	await act(async () => nativeMessage(player, "ended"));
	expect(sendResearchEvent).toHaveBeenNthCalledWith(1, "participant-token", "video.play", expect.objectContaining({ screen: "home", contentId: "new-file", videoId: "https://app.example/api/media/home/home.mp4" }));
	expect(sendResearchEvent).toHaveBeenNthCalledWith(2, "participant-token", "video.completed", expect.objectContaining({ contentId: "new-file", watchedMs: 5100, completed: true }));
});

test("leaving a playing home file closes its watch interval exactly once", async () => {
	getPublicContent.mockResolvedValue({ items: [{ id: "home", title: "Home video", contentType: "video", value: "/api/media/home/home.mp4" }] });
	await mount(<ManagedContent pageKey="home" />);
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing")); now = 4500;
	await act(async () => tree.unmount()); tree = null;
	expect(sendResearchEvent.mock.calls.filter((call) => call[1] === "video.paused")).toHaveLength(1);
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.paused", expect.objectContaining({ contentId: "home", watchedMs: 3500 }));
});

test("changing facility closes old video against old equipment before counting the new video", async () => {
	getEquipmentCatalog.mockResolvedValue({ items: [
		{ id: "0", videoUrl: "/api/media/first/first.mp4", isActive: true },
		{ id: "1", videoUrl: "/api/media/second/second.mp4", isActive: true },
	] });
	await mount(<Detail />);
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing")); now = 2200;
	mockRoute = { id: "1", from: "ai" }; await act(async () => tree.update(<Detail />));
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.paused", expect.objectContaining({ contentId: 0, videoId: "/api/media/first/first.mp4", watchedMs: 1200 }));
	expect(tree.root.findByType(MediaVideo).props.source).toBe("/api/media/second/second.mp4");
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing"));
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.play", expect.objectContaining({ contentId: 1, videoId: "/api/media/second/second.mp4" }));
});

test("detail starts with a neutral photo, restores cached replacement, and never falls back to a retired local photo", async () => {
	let restore, refresh;
	loadCachedEquipmentCatalog.mockReturnValue(new Promise(resolve => { restore = resolve; }));
	getEquipmentCatalog.mockReturnValue(new Promise(resolve => { refresh = resolve; }));
	await mount(<Detail />);
	const header = () => tree.root.findAllByType(Image).find(node => node.props.testID === "equipment-detail-image");
	const placeholder = require("../../assets/icons/outdoor.png");
	expect(header().props.source).toBe(placeholder);
	await act(async () => restore({ items: [{ id: "0", imageUrl: "/cached.jpg", isActive: true }] }));
	expect(header().props.source).toEqual({ uri: "https://app.example/cached.jpg" });
	const oldError = header().props.onError;
	await act(async () => oldError());
	expect(header().props.source).toBe(placeholder);
	await act(async () => refresh({ items: [{ id: "0", imageUrl: "/fresh.jpg", isActive: true }] }));
	expect(header().props.source).toEqual({ uri: "https://app.example/fresh.jpg" });
	await act(async () => oldError());
	expect(header().props.source).toEqual({ uri: "https://app.example/fresh.jpg" });
});

test("a late disk directory cannot overwrite the detail's fresh network photo", async () => {
	let restore;
	loadCachedEquipmentCatalog.mockReturnValue(new Promise(resolve => { restore = resolve; }));
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: "0", imageUrl: "/fresh.jpg", isActive: true }] });
	await mount(<Detail />);
	await act(async () => restore({ items: [{ id: "0", imageUrl: "/retired.jpg", isActive: true }] }));
	const header = tree.root.findAllByType(Image).find(node => node.props.testID === "equipment-detail-image");
	expect(header.props.source).toEqual({ uri: "https://app.example/fresh.jpg" });
});

test("a slow initial catalog does not expose the replaced legacy video before selecting the uploaded file", async () => {
	let resolveCatalog;
	getEquipmentCatalog.mockReturnValue(new Promise((resolve) => { resolveCatalog = resolve; }));
	await mount(<Detail />);
	expect(tree.root.findAllByType("mock-youtube")).toHaveLength(0);
	expect(tree.root.findAllByType(MediaVideo)).toHaveLength(0);
	expect(sendResearchEvent).not.toHaveBeenCalled();
	now = 5000;
	await act(async () => resolveCatalog({ items: [{ id: "0", videoUrl: "/api/media/first/first.mp4", isActive: true }] }));
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing"));
	now = 7000;
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "paused"));
	expect(sendResearchEvent.mock.calls).toEqual([
		["participant-token", "video.play", expect.objectContaining({ videoId: "/api/media/first/first.mp4" })],
		["participant-token", "video.paused", expect.objectContaining({ videoId: "/api/media/first/first.mp4", watchedMs: 2000 })],
	]);
});

test.each(["zh", "en"])("a bilingual %s replacement renders its matching source and reports watched progress on completion", async (locale) => {
	getEquipmentCatalog.mockResolvedValue({ items: [{ id: "0", videoUrlZh: "/api/media/chinese/chinese.mp4", videoUrlEn: "/api/media/english/english.mp4", videoLocalesEnabled: true, youtubeKey: "-vFxR4gdfPY", isActive: true }] });
	await mount(localizedDetail(locale));
	const source = locale === "en" ? "/api/media/english/english.mp4" : "/api/media/chinese/chinese.mp4";
	expect(tree.root.findByType(MediaVideo).props.source).toBe(source);
	expect(tree.root.findAllByType("mock-youtube")).toHaveLength(0);
	const player = tree.root.findByType("mock-video-webview");
	expect(player.props.source.html).toContain(`src="https://app.example${source}"`);
	await act(async () => nativeMessage(player, "playing", { positionMs: 0, durationMs: 10000 }));
	now = 11000;
	await act(async () => nativeMessage(player, "ended", { positionMs: 10000, durationMs: 10000 }));
	expect(recordLearningCoverage).not.toHaveBeenCalled();
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.completed", expect.objectContaining({ contentId: 0, videoId: source, watchedMs: 10000, positionMs: 10000, durationMs: 10000, progressPercent: 100, completed: true }));
});

test("waiting and seeking stop the watch clock and progress-only updates do not generate API calls", async () => {
	await mount(<Detail />);
	const player = tree.root.findByType("mock-video-webview");
	await act(async () => nativeMessage(player, "playing", { positionMs: 0, durationMs: 20000 }));
	now = 2000; await act(async () => nativeMessage(player, "progress", { positionMs: 1000, durationMs: 20000 }));
	expect(sendResearchEvent).toHaveBeenCalledTimes(1);
	now = 3000; await act(async () => nativeMessage(player, "buffering", { positionMs: 2000, durationMs: 20000 }));
	now = 12000; await act(async () => nativeMessage(player, "playing", { positionMs: 2000, durationMs: 20000 }));
	now = 14000; await act(async () => nativeMessage(player, "seeking", { positionMs: 15000, durationMs: 20000 }));
	now = 22000; await act(async () => nativeMessage(player, "playing", { positionMs: 15000, durationMs: 20000 }));
	now = 27000; await act(async () => nativeMessage(player, "ended", { positionMs: 20000, durationMs: 20000 }));
	const stopped = sendResearchEvent.mock.calls.filter(([,name]) => name !== "video.play");
	expect(stopped.map(([, , metadata]) => metadata.watchedMs)).toEqual([2000, 2000, 5000]);
	expect(stopped.map(([ ,name]) => name)).toEqual(["video.paused", "video.paused", "video.completed"]);
	expect(stopped.reduce((total,[,,metadata]) => total + metadata.watchedMs, 0)).toBe(9000);
});

test("loading, errors and a late ended message cannot create fake completion", async () => {
	await mount(<Detail />); const player = { props: tree.root.findByType("mock-video-webview").props };
	await act(async () => { nativeMessage(player, "loading"); nativeMessage(player, "ended"); });
	expect(sendResearchEvent).not.toHaveBeenCalled(); expect(recordLearningCoverage).not.toHaveBeenCalled();
	await act(async () => nativeMessage(player, "playing")); now = 2400;
	await act(async () => nativeMessage(player, "error"));
	await act(async () => { nativeMessage(player, "playing"); nativeMessage(player, "ended"); });
	expect(sendResearchEvent.mock.calls.map(([,name]) => name)).toEqual(["video.play", "video.paused"]);
});

test("actual foreground video segments reach learning evidence, but seeking and background callbacks do not", async () => {
	await mount(<Detail />);
	const player = tree.root.findByType("mock-video-webview");
	await act(async () => nativeMessage(player, "playing", { positionMs: 0, durationMs: 100000 }));
	expect(recordLearningCoverage).not.toHaveBeenCalled();
	for (let second = 1; second <= 4; second += 1) {
		now = 1000 + second * 1000;
		await act(async () => nativeMessage(player, "progress", { positionMs: second * 1000, durationMs: 100000 }));
	}
	expect(recordLearningCoverage).toHaveBeenCalledTimes(4);
	expect(recordLearningCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ field: "watched", start: 3000, end: 4000, owner: "participant", parts: [{ key: "media", total: 100000 }] }));
	await act(async () => nativeMessage(player, "seeking", { positionMs: 99000, durationMs: 100000 }));
	now += 1000;
	await act(async () => nativeMessage(player, "progress", { positionMs: 100000, durationMs: 100000 }));
	expect(recordLearningCoverage).toHaveBeenCalledTimes(4);
	await act(async () => { for (const listener of appStateListeners) listener("background"); });
	await act(async () => nativeMessage(player, "ended", { positionMs: 100000, durationMs: 100000 }));
	expect(recordLearningCoverage).toHaveBeenCalledTimes(4);
});

test("changing language immediately uses cached matching video while refresh is slow, and rejects the old callback", async () => {
	const bilingual = { id: "0", videoUrlZh: "/api/media/chinese/chinese.mp4", videoUrlEn: "/api/media/english/english.mp4", videoLocalesEnabled: true, isActive: true };
	getEquipmentCatalog.mockResolvedValueOnce({ items: [bilingual] }).mockReturnValueOnce(new Promise(() => {}));
	await mount(localizedDetail("zh"));
	const oldPlayer = { props: tree.root.findByType("mock-video-webview").props };
	await act(async () => nativeMessage(oldPlayer, "playing")); now = 4000;
	await act(async () => tree.update(localizedDetail("en")));
	expect(tree.root.findByType(MediaVideo).props.source).toBe("/api/media/english/english.mp4");
	expect(tree.root.findAllByType("mock-youtube")).toHaveLength(0);
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.paused", expect.objectContaining({ videoId: "/api/media/chinese/chinese.mp4", watchedMs: 3000 }));
	await act(async () => { nativeMessage(oldPlayer, "playing"); nativeMessage(oldPlayer, "ended"); });
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing"));
	expect(sendResearchEvent.mock.calls.map(([,name]) => name)).toEqual(["video.play", "video.paused", "video.play"]);
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.play", expect.objectContaining({ videoId: "/api/media/english/english.mp4" }));
});

test("a missing language never plays the other language or resurrects bundled YouTube, even while refreshing", async () => {
	getEquipmentCatalog.mockResolvedValueOnce({ items: [{ id: "0", videoUrlZh: "/api/media/chinese/chinese.mp4", videoUrlEn: "", videoLocalesEnabled: true, videoUrl: "/api/media/old/old.mp4", youtubeKey: "-vFxR4gdfPY", isActive: true }] }).mockReturnValueOnce(new Promise(() => {}));
	await mount(localizedDetail("zh"));
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing")); now = 2200;
	await act(async () => tree.update(localizedDetail("en")));
	expect(tree.root.findAllByType(MediaVideo)).toHaveLength(0); expect(tree.root.findAllByType("mock-youtube")).toHaveLength(0);
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.paused", expect.objectContaining({ videoId: "/api/media/chinese/chinese.mp4", watchedMs: 1200 }));
});

test("a stale first catalog response cannot replace the newer language selection", async () => {
	let resolveOld;
	getEquipmentCatalog.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce({ items: [{ id: "0", videoLocalesEnabled: true, videoUrlEn: "/api/media/english/english.mp4", isActive: true }] });
	await mount(localizedDetail("zh"));
	await act(async () => tree.update(localizedDetail("en")));
	await act(async () => resolveOld({ items: [{ id: "0", videoUrl: "/api/media/obsolete/obsolete.mp4", isActive: true }] }));
	expect(tree.root.findByType(MediaVideo).props.source).toBe("/api/media/english/english.mp4");
});

test("changing managed-content page stops old tracking, hides old items, and never attributes old messages to the new page", async () => {
	getPublicContent.mockResolvedValueOnce({ items: [{ id: "old", title: "Old page", contentType: "video", value: "/api/media/home/home.mp4" }] }).mockReturnValueOnce(new Promise(() => {}));
	await mount(<ManagedContent pageKey="home" />);
	const oldPlayer = { props: tree.root.findByType("mock-video-webview").props };
	await act(async () => nativeMessage(oldPlayer, "playing")); now = 2200;
	await act(async () => tree.update(<ManagedContent pageKey="other" />));
	expect(tree.root.findAllByType(MediaVideo)).toHaveLength(0);
	await act(async () => nativeMessage(oldPlayer, "ended"));
	expect(sendResearchEvent.mock.calls.map(([,name]) => name)).toEqual(["video.play", "video.paused"]);
	expect(sendResearchEvent).toHaveBeenLastCalledWith("participant-token", "video.paused", expect.objectContaining({ screen: "home", contentId: "old", watchedMs: 1200 }));
});

test("browser visibility pause and focus loss do not double-count one watch segment", async () => {
	const onChangeState = jest.fn(); const pause = jest.fn(); let visibility;
	const previousDocument = global.document;
	global.document = { hidden: false, addEventListener: (_name, callback) => { visibility = callback; }, removeEventListener: jest.fn() };
	try {
		await act(async () => { tree = renderer.create(<WebMediaVideo source="/api/media/web/web.mp4" onChangeState={onChangeState} />, { createNodeMock: () => ({ pause }) }); });
		await act(async () => tree.root.findByType("video").props.onPlaying());
		global.document.hidden = true; await act(async () => visibility());
		mockFocused = false; await act(async () => tree.update(<WebMediaVideo source="/api/media/web/web.mp4" onChangeState={onChangeState} />));
		expect(pause).toHaveBeenCalled();
		expect(onChangeState.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
		await act(async () => tree.unmount()); tree = null;
	} finally { global.document = previousDocument; }
});

test("late native messages from a replaced file cannot reopen old tracking or suppress the new video", async () => {
	const first = jest.fn(); const second = jest.fn();
	await mount(<MediaVideo source="/api/media/first/first.mp4" onChangeState={first} />);
	const oldMessage = tree.root.findByType("mock-video-webview").props.onMessage;
	await act(async () => oldMessage({ nativeEvent: { data: '{"type":"facility-video","state":"playing"}' } }));
	await act(async () => tree.update(<MediaVideo source="/api/media/second/second.mp4" onChangeState={second} />));
	await act(async () => oldMessage({ nativeEvent: { data: '{"type":"facility-video","state":"playing"}' } }));
	await act(async () => nativeMessage(tree.root.findByType("mock-video-webview"), "playing"));
	expect(first.mock.calls.map(([state]) => state)).toEqual(["playing", "paused"]);
	expect(second.mock.calls.map(([state]) => state)).toEqual(["playing"]);
});

test("an error arriving from a replaced native player cannot hide its replacement", async () => {
	await mount(<MediaVideo source="/api/media/first/first.mp4" />);
	const oldError = tree.root.findByType("mock-video-webview").props.onError;
	await act(async () => tree.update(<MediaVideo source="/api/media/second/second.mp4" />));
	await act(async () => oldError());
	expect(tree.root.findAllByType("mock-video-webview")).toHaveLength(1);
	expect(tree.root.findByType("mock-video-webview").props.source.html).toContain("/api/media/second/second.mp4");
});
