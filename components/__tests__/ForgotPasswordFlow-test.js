import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import ForgotPasswordScreen from "../../app/forgot-password";
import { requestSmsCode, resetPassword, verifySmsCode } from "../../utils/api";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
jest.mock("expo-router", () => ({
	router: { dismissTo: jest.fn() },
	useLocalSearchParams: () => ({ from: "settings" }),
	useFocusEffect: (callback) => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
jest.mock("../../utils/api", () => ({ requestSmsCode: jest.fn(), resetPassword: jest.fn(), verifySmsCode: jest.fn() }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { locale: "en", t: (key) => key } }) }));
jest.mock("../../components/CountrySelector", () => () => null);
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: () => 10, heightPercentageToDP: () => 10 }));

let tree;
function button(label) { return tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === label)); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(async () => {
	jest.clearAllMocks(); mockFocused = true;
	requestSmsCode.mockResolvedValue({});
	resetPassword.mockResolvedValue({});
	verifySmsCode.mockResolvedValue({ verificationToken: "test-verification" });
	await act(async () => { tree = renderer.create(<ForgotPasswordScreen />); });
	await act(async () => tree.root.findByType(TextInput).props.onChangeText("61234567"));
});
afterEach(async () => { await act(async () => tree.unmount()); });

test("rapid send-code taps issue one request, and returning to login suppresses its late alert", async () => {
	const request = deferred(); requestSmsCode.mockReturnValue(request.promise);
	const send = button("sendCodeButton"); let first; let second;
	await act(async () => { first = send.props.onPress(); second = send.props.onPress(); });
	expect(requestSmsCode).toHaveBeenCalledTimes(1);
	await act(async () => button("backToLogin").props.onPress());
	await act(async () => { request.resolve({}); await Promise.all([first, second]); });
	expect(showAlert).not.toHaveBeenCalled();
	expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/login", params: { from: "settings" } });
});

test("leaving during code verification does not continue into a password-reset request", async () => {
	await act(async () => button("sendCodeButton").props.onPress());
	showAlert.mockClear();
	const inputs = tree.root.findAllByType(TextInput);
	await act(async () => { inputs[0].props.onChangeText("123456"); inputs[1].props.onChangeText("password123"); inputs[2].props.onChangeText("password123"); });
	const verifying = deferred(); verifySmsCode.mockReturnValue(verifying.promise);
	let resetting;
	await act(async () => { resetting = button("resetPasswordButton").props.onPress(); });
	mockFocused = false;
	await act(async () => tree.update(<ForgotPasswordScreen />));
	await act(async () => { verifying.resolve({ verificationToken: "test-verification" }); await resetting; });
	expect(resetPassword).not.toHaveBeenCalled();
	expect(showAlert).not.toHaveBeenCalled();
});

test("a completed password reset returns to the existing login page after acknowledgement", async () => {
	await act(async () => button("sendCodeButton").props.onPress());
	showAlert.mockClear();
	const inputs = tree.root.findAllByType(TextInput);
	await act(async () => { inputs[0].props.onChangeText("123456"); inputs[1].props.onChangeText("password123"); inputs[2].props.onChangeText("password123"); });
	await act(async () => button("resetPasswordButton").props.onPress());
	expect(resetPassword).toHaveBeenCalledWith("61234567", "password123", "test-verification", "+852");
	expect(router.dismissTo).not.toHaveBeenCalled();
	await act(async () => showAlert.mock.calls[0][2][0].onPress());
	expect(router.dismissTo).toHaveBeenCalledWith({ pathname: "/login", params: { from: "settings" } });
});
