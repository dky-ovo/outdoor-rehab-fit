import React from "react";
import renderer, { act } from "react-test-renderer";
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { router, Stack } from "expo-router";
import ContactUs from "../../app/(tabs)/setting/contact";
import Setting from "../../app/(tabs)/setting/index";
import SettingLayout from "../../app/(tabs)/setting/_layout";
import { LocaleContext } from "../../contexts/LocaleContext";
import { createFeedbackSubmissionId, submitContactFeedback } from "../../utils/feedbackApi";
import { useAndroidBackTarget } from "../../hooks/useAndroidBackTarget";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockUser;
let mockIsGuest;
let mockFocused;
let mockLocale;
let mockId;
let mockKeyboard;
let tree;
const mockParent = { setOptions: jest.fn() };
const mockNavigation = { getParent: () => mockParent };
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, isGuest: mockIsGuest, isUser: !mockIsGuest, isAuthenticated: true, isLoading: false }) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext() }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused, useNavigation: () => mockNavigation }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 64 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, FontAwesome: () => null }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: () => 320, heightPercentageToDP: () => 100 }));
jest.mock("../../hooks/useAndroidBackTarget", () => ({ useAndroidBackTarget: jest.fn((...args) => jest.requireActual("../../hooks/useAndroidBackTarget").useAndroidBackTarget(...args)) }));
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => mockKeyboard }));
jest.mock("../../utils/feedbackApi", () => ({ createFeedbackSubmissionId: jest.fn(), submitContactFeedback: jest.fn() }));
jest.mock("expo-router", () => {
	const Stack = ({ children }) => children;
	Stack.Screen = () => null;
	return { Stack, router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(), dismissTo: jest.fn() }, useFocusEffect: (callback) => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) };
});

const view = (Component = ContactUs) => <LocaleContext.Provider value={{ locale: mockLocale, i18n: { locale: mockLocale, t: (key) => `${mockLocale}:${key}` } }}><Component /></LocaleContext.Provider>;
const input = (field) => tree.root.findAllByType(TextInput).find((item) => item.props.testID === `contact-${field}`);
const submit = () => tree.root.findAllByType(TouchableOpacity).find((item) => item.props.testID === "contact-submit");
const textValues = () => tree.root.findAllByType(Text).map((item) => item.props.children);
const button = (text) => tree.root.findAllByType(TouchableOpacity).find((item) => item.findAllByType(Text).some((node) => node.props.children === text));
const fill = async (values = { name: "Visitor", email: "visitor@example.org", subject: "App feedback", message: "Please add more facilities." }) => {
	await act(async () => { Object.entries(values).forEach(([key, value]) => input(key).props.onChangeText(value)); });
};
const defer = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
beforeEach(async () => {
	jest.clearAllMocks(); mockUser = { name: "guest", role: "guest", loginAt: "guest-session" }; mockIsGuest = true; mockFocused = true; mockLocale = "zh"; mockId = 0;
	router.canGoBack.mockReturnValue(true);
	mockKeyboard = { visible: true, inset: 180 };
	createFeedbackSubmissionId.mockImplementation(() => `submission-${++mockId}`);
	submitContactFeedback.mockResolvedValue({ feedback: { id: "FB-123", status: "new", createdAt: "2026-09-18T10:00:00Z" } });
	await act(async () => { tree = renderer.create(view()); });
});
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); tree = null; }); });

test("guests see an empty four-field form with large controls, limits, privacy copy and a settings return target", () => {
	expect(tree.root.findAllByType(TextInput)).toHaveLength(4);
	expect(input("name").props.value).toBe(""); expect(input("email").props.value).toBe("");
	expect(input("name").props.maxLength).toBe(80); expect(input("email").props.maxLength).toBe(254);
	expect(input("subject").props.maxLength).toBe(160); expect(input("message").props.maxLength).toBe(5000);
	expect(input("email").props.keyboardType).toBe("email-address"); expect(input("message").props.multiline).toBe(true);
	expect(textValues()).toContain("zh:contactPrivacy");
	expect(useAndroidBackTarget).toHaveBeenCalledWith("/(tabs)/setting");
	expect(mockParent.setOptions).not.toHaveBeenCalled();
});

test("empty, whitespace and malformed-email submissions do not send and mark their fields", async () => {
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback).not.toHaveBeenCalled(); expect(textValues()).toContain("zh:contactInvalidName"); expect(textValues()).toContain("zh:contactInvalidMessage");
	await fill({ name: "  ", email: "bad-email", message: "  " });
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback).not.toHaveBeenCalled(); expect(textValues()).toContain("zh:contactInvalidEmail");
});

test.each([["name", 81, "contactInvalidName"], ["email", 255, "contactInvalidEmail"], ["subject", 161, "contactInvalidSubject"], ["message", 5001, "contactInvalidMessage"]])("over-limit %s is rejected even if supplied programmatically", async (field, length, error) => {
	await fill(); await fill({ [field]: "x".repeat(length) });
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback).not.toHaveBeenCalled(); expect(textValues()).toContain(`zh:${error}`);
});

test("guest sends trimmed values without a token or phone and sees a real receipt number", async () => {
	await fill({ name: " Visitor ", email: " visitor@example.org ", subject: "", message: " Feedback " });
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback).toHaveBeenCalledWith({ name: "Visitor", email: "visitor@example.org", subject: "", message: "Feedback", locale: "zh", submissionId: "submission-1" }, undefined);
	expect(textValues()).toContain("zh:contactReceived"); expect(textValues()).toContain("FB-123");
	await act(async () => button("zh:contactSendAnother").props.onPress());
	expect(input("message").props.value).toBe(""); expect(input("name").props.value).toBe(" Visitor ");
	await fill({ message: "Another enquiry" }); await act(async () => submit().props.onPress());
	expect(submitContactFeedback.mock.calls[1][0].submissionId).toBe("submission-2");
});

test("registered user details are editable and sent with the current token, never a phone", async () => {
	mockUser = { id: "A", name: "Member", email: "member@example.org", phone: "61234567", token: "token-A", role: "user" }; mockIsGuest = false;
	await act(async () => tree.update(view()));
	expect(input("name").props.value).toBe("Member"); expect(input("email").props.value).toBe("member@example.org");
	await fill({ name: "Reply name", email: "reply@example.org", message: "Help with the app" }); await act(async () => submit().props.onPress());
	expect(submitContactFeedback).toHaveBeenCalledWith(expect.objectContaining({ name: "Reply name", email: "reply@example.org" }), "token-A");
	expect(submitContactFeedback.mock.calls[0][0]).not.toHaveProperty("phone");
});

test("rapid taps make one request and a failed retry reuses its submission ID while an edit creates a fresh ID", async () => {
	const pending = defer(); submitContactFeedback.mockReturnValueOnce(pending.promise);
	await fill(); const handler = submit().props.onPress; let operation;
	await act(async () => { operation = handler(); handler(); });
	expect(submitContactFeedback).toHaveBeenCalledTimes(1); expect(submit().props.disabled).toBe(true);
	await act(async () => { pending.reject({ code: "feedbackTimeout" }); await operation; });
	expect(input("message").props.value).toBe("Please add more facilities."); expect(textValues()).toContain("zh:contactSendFailed");
	submitContactFeedback.mockRejectedValueOnce({ code: "networkError" });
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback.mock.calls[1][0].submissionId).toBe("submission-1");
	await fill({ message: "Updated message" }); await act(async () => submit().props.onPress());
	expect(submitContactFeedback.mock.calls[2][0].submissionId).toBe("submission-2");
});

test.each([[{ status: 401, code: "unauthorized" }, "contactSessionExpired"], [{ status: 429, code: "feedbackRateLimited" }, "contactRateLimited"], [{ status: 400, code: "invalidFeedback" }, "contactSendFailed"], [{ code: "invalidFeedbackResponse" }, "contactSendFailed"]])("server failure %p keeps the form and never silently retries as a guest", async (error, translation) => {
	mockUser = { id: "A", name: "Member", email: "member@example.org", token: "expired", role: "user" }; mockIsGuest = false;
	await act(async () => tree.update(view())); await fill({ message: "Keep my draft" });
	submitContactFeedback.mockRejectedValueOnce(error); await act(async () => submit().props.onPress());
	expect(submitContactFeedback).toHaveBeenCalledTimes(1); expect(submitContactFeedback.mock.calls[0][1]).toBe("expired");
	expect(textValues()).toContain(`zh:${translation}`); expect(input("message").props.value).toBe("Keep my draft"); expect(submit().props.disabled).toBe(false);
});

test("registered session with a missing token cannot submit anonymously", async () => {
	mockUser = { id: "A", name: "Member", email: "member@example.org", role: "user" }; mockIsGuest = false;
	await act(async () => tree.update(view())); await fill({ message: "My draft" }); await act(async () => submit().props.onPress());
	expect(submitContactFeedback).not.toHaveBeenCalled(); expect(textValues()).toContain("zh:contactSessionExpired");
});

test("an old account response cannot replace or clear the new account's draft or release its request lock", async () => {
	const first = defer(); const second = defer(); submitContactFeedback.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
	await fill(); let oldOperation; await act(async () => { oldOperation = submit().props.onPress(); });
	mockUser = { id: "B", name: "New Member", email: "new@example.org", token: "token-B", role: "user" }; mockIsGuest = false;
	await act(async () => tree.update(view())); await fill({ message: "New member draft" });
	let newOperation; await act(async () => { newOperation = submit().props.onPress(); });
	await act(async () => { first.resolve({ feedback: { id: "OLD-RECEIPT" } }); await oldOperation; });
	expect(textValues()).not.toContain("OLD-RECEIPT"); expect(input("message").props.value).toBe("New member draft"); expect(submit().props.disabled).toBe(true);
	await act(async () => { second.reject({ code: "networkError" }); await newOperation; });
	expect(input("message").props.value).toBe("New member draft"); expect(submit().props.disabled).toBe(false);
});

test("language change preserves the draft, ignores old results and sends the new locale with a fresh ID", async () => {
	const pending = defer(); submitContactFeedback.mockReturnValueOnce(pending.promise);
	await fill(); let operation; await act(async () => { operation = submit().props.onPress(); });
	mockLocale = "en"; await act(async () => tree.update(view()));
	await act(async () => { pending.resolve({ feedback: { id: "OLD-LANGUAGE" } }); await operation; });
	expect(input("message").props.value).toBe("Please add more facilities."); expect(textValues()).not.toContain("OLD-LANGUAGE");
	await act(async () => submit().props.onPress());
	expect(submitContactFeedback.mock.calls[1][0]).toEqual(expect.objectContaining({ locale: "en", submissionId: "submission-2" }));
	expect(textValues()).toContain("en:contactReceived");
});

test("leaving and returning ignores the old response and lets the same draft retry idempotently", async () => {
	const pending = defer(); submitContactFeedback.mockReturnValueOnce(pending.promise);
	await fill(); let operation; await act(async () => { operation = submit().props.onPress(); });
	mockFocused = false; await act(async () => tree.update(view()));
	mockFocused = true; await act(async () => tree.update(view()));
	await act(async () => { pending.resolve({ feedback: { id: "OLD-SCREEN" } }); await operation; });
	expect(textValues()).not.toContain("OLD-SCREEN"); expect(input("message").props.value).toBe("Please add more facilities.");
	await act(async () => submit().props.onPress()); expect(submitContactFeedback.mock.calls[1][0].submissionId).toBe("submission-1");
});

test("unmount ignores pending results without changing the parent layout", async () => {
	const pending = defer(); submitContactFeedback.mockReturnValueOnce(pending.promise);
	await fill(); let operation; await act(async () => { operation = submit().props.onPress(); });
	await act(async () => { tree.unmount(); tree = null; });
	expect(mockParent.setOptions).not.toHaveBeenCalled();
	await act(async () => { pending.resolve({ feedback: { id: "UNMOUNTED" } }); await operation; });
	expect(router.replace).not.toHaveBeenCalled();
});

test("settings links to Contact us and its header uses About's native back behavior", async () => {
	await act(async () => tree.update(view(Setting)));
	await act(async () => button("zh:contactUs").props.onPress()); expect(router.push).toHaveBeenCalledWith("/setting/contact");
	const priorPlatform = Platform.OS; Platform.OS = "ios";
	try {
		await act(async () => tree.update(view(SettingLayout)));
		expect(tree.root.findByType(Stack).props.screenOptions.animationTypeForReplace).toBe("pop");
		const contact = tree.root.findAllByType(Stack.Screen).find((node) => node.props.name === "contact");
		expect(contact.props.options.gestureEnabled).toBeUndefined(); expect(contact.props.options.headerShown).toBe(true);
		await act(async () => contact.props.options.headerLeft().props.onPress()); expect(router.back).toHaveBeenCalledTimes(1);
		expect(router.dismissTo).not.toHaveBeenCalled();
		expect(router.replace).not.toHaveBeenCalled();
	} finally { Platform.OS = priorPlatform; }
});

test("Android typing removes the tab reserve but still handles only unresized keyboard overlap", async () => {
	const priorPlatform = Platform.OS;
	try {
		Platform.OS = "android"; await act(async () => tree.update(view()));
		const keyboardView = tree.root.findByType(KeyboardAvoidingView);
		expect(keyboardView.props.behavior).toBeUndefined(); expect(keyboardView.props.style[1].paddingBottom).toBe(180);
		const scroll = tree.root.findByType(ScrollView);
		expect(scroll.props.keyboardShouldPersistTaps).toBe("handled"); expect(scroll.props.contentContainerStyle[1].paddingBottom).toBe(24);
		mockKeyboard = { visible: true, inset: 0 }; await act(async () => tree.update(view()));
		expect(StyleSheet.flatten(tree.root.findByType(KeyboardAvoidingView).props.style).paddingBottom).toBe(0);
		expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(24);
		Platform.OS = "ios"; await act(async () => tree.update(view()));
		expect(tree.root.findByType(KeyboardAvoidingView).props.behavior).toBe("padding"); expect(tree.root.findByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(64);
		expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(144);
	} finally { Platform.OS = priorPlatform; }
});

test("reopening Android keyboard repeatedly keeps the draft and restores the original closed layout", async () => {
	const priorPlatform = Platform.OS;
	try {
		Platform.OS = "android";
		await act(async () => { tree.unmount(); tree = renderer.create(view()); });
		expect(mockParent.setOptions).not.toHaveBeenCalled();
		await fill({ message: "Keep my feedback while typing" });
		for (let cycle = 0; cycle < 3; cycle++) {
			mockKeyboard = { visible: false, inset: 0 }; await act(async () => tree.update(view()));
			expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(144);
			mockKeyboard = { visible: true, inset: 0 }; await act(async () => tree.update(view()));
			expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(24);
			expect(input("message").props.value).toBe("Keep my feedback while typing");
		}
		await act(async () => { tree.unmount(); tree = null; });
		expect(mockParent.setOptions).not.toHaveBeenCalled();
	} finally { Platform.OS = priorPlatform; }
});

test("the Android system back handler returns to Settings and is removed on unmount", async () => {
	const priorPlatform = Platform.OS; Platform.OS = "android";
	const remove = jest.fn(); let back;
	const listener = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { back = callback; return { remove }; });
	try {
		mockKeyboard = { visible: false, inset: 0 };
		await act(async () => { tree.unmount(); tree = renderer.create(view()); });
		expect(back()).toBe(true); expect(router.replace).toHaveBeenCalledWith("/(tabs)/setting");
		expect(router.dismissTo).not.toHaveBeenCalled();
		await act(async () => { tree.unmount(); tree = null; }); expect(remove).toHaveBeenCalled();
	} finally { listener.mockRestore(); Platform.OS = priorPlatform; }
});

test("Android Contact uses the same shared hardware-return hook as About, without a private keyboard branch", async () => {
	const priorPlatform = Platform.OS; Platform.OS = "android";
	let back;
	const listener = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, callback) => { back = callback; return { remove: jest.fn() }; });
	const dismiss = jest.spyOn(Keyboard, "dismiss");
	try {
		await act(async () => { tree.unmount(); tree = renderer.create(view()); });
		expect(back()).toBe(true); expect(dismiss).not.toHaveBeenCalled();
		expect(useAndroidBackTarget).toHaveBeenCalledWith("/(tabs)/setting");
		expect(router.replace).toHaveBeenCalledWith("/(tabs)/setting");
		expect(router.dismissTo).not.toHaveBeenCalled();
	} finally { listener.mockRestore(); dismiss.mockRestore(); Platform.OS = priorPlatform; }
});

test.each([true, false])("receipt return follows About's back/fallback behavior when history exists: %s", async canGoBack => {
	await fill(); await act(async () => submit().props.onPress());
	router.canGoBack.mockReturnValue(canGoBack);
	await act(async () => button("zh:contactBackToSettings").props.onPress());
	if (canGoBack) { expect(router.back).toHaveBeenCalledTimes(1); expect(router.replace).not.toHaveBeenCalled(); }
	else { expect(router.replace).toHaveBeenCalledWith("/(tabs)/setting"); expect(router.back).not.toHaveBeenCalled(); }
	expect(router.dismissTo).not.toHaveBeenCalled();
});

test("leaving Contact cancels input scrolling and ignores delayed focus callbacks", async () => {
	await act(async () => { tree.unmount(); tree = null; });
	jest.useFakeTimers();
	const scheduled = jest.spyOn(global, "setTimeout");
	const cancelled = jest.spyOn(global, "clearTimeout");
	try {
		await act(async () => { tree = renderer.create(view()); });
		const focus = input("message").props.onFocus;
		await act(async () => focus());
		const scrollTimers = () => scheduled.mock.calls.flatMap((args, index) => [40, 80, 260].includes(args[1]) ? [scheduled.mock.results[index].value] : []);
		const pendingScroll = scrollTimers();
		expect(pendingScroll).toHaveLength(3);
		mockFocused = false; await act(async () => tree.update(view()));
		for (const timer of pendingScroll) expect(cancelled.mock.calls.map(args => args[0])).toContain(timer);
		await act(async () => { focus(); jest.advanceTimersByTime(1000); });
		expect(scrollTimers()).toEqual(pendingScroll);
		expect(input("message").props.value).toBe("");
		expect(mockParent.setOptions).not.toHaveBeenCalled();
	} finally {
		await act(async () => { tree?.unmount(); tree = null; });
		scheduled.mockRestore(); cancelled.mockRestore();
		jest.useRealTimers();
	}
});
