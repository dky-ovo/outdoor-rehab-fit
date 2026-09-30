import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import LoginScreen from "../../app/login";
import { navigateAfterAuth } from "../../utils/onboarding";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockAuth;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock("../../utils/onboarding", () => ({ navigateAfterAuth: jest.fn(async () => {}) }));
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { locale: "en", t: (key) => key } }) }));
jest.mock("../../components/CountrySelector", () => () => null);
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) } }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: () => 10, heightPercentageToDP: () => 10 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let tree;
beforeEach(() => {
	jest.clearAllMocks();
	mockFocused = true;
	mockAuth = { isGuest: false, isUser: false, isLoading: false, login: jest.fn(async () => ({ success: true })), loginAsGuest: jest.fn() };
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("a login screen behind Register does not hijack navigation when registration succeeds", async () => {
	mockFocused = false;
	mockAuth.isUser = true;
	await act(async () => { tree = renderer.create(<LoginScreen />); });
	expect(navigateAfterAuth).not.toHaveBeenCalled();
	mockFocused = true;
	await act(async () => tree.update(<LoginScreen />));
	expect(navigateAfterAuth).toHaveBeenCalledTimes(1);
});

test("two rapid login taps send one request and navigate once", async () => {
	let resolveLogin;
	mockAuth.login.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
	await act(async () => { tree = renderer.create(<LoginScreen />); });
	const inputs = tree.root.findAllByType(TextInput);
	await act(async () => { inputs[0].props.onChangeText("61234567"); inputs[1].props.onChangeText("password123"); });
	const loginButton = tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((text) => text.props.children === "loginButton"));
	let first; let second;
	await act(async () => { first = loginButton.props.onPress(); second = loginButton.props.onPress(); });
	expect(mockAuth.login).toHaveBeenCalledTimes(1);
	await act(async () => { resolveLogin({ success: true }); await Promise.all([first, second]); });
	expect(navigateAfterAuth).toHaveBeenCalledTimes(1);
});
