import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import RegisterScreen from "../../app/register";
import { navigateAfterAuth } from "../../utils/onboarding";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
const mockRegister = jest.fn();
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => ({ from: "settings" }) }));
jest.mock("../../utils/onboarding", () => ({ navigateAfterAuth: jest.fn(async () => {}) }));
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ register: mockRegister }) }));
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { locale: "en", t: (key) => key } }) }));
jest.mock("../../components/CountrySelector", () => () => null);
jest.mock("../../hooks/useKeyboardInset", () => ({ useKeyboardInset: () => ({ visible: false, inset: 0 }) }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: require("react-native").View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("react-native-responsive-fontsize", () => ({ RFValue: (value) => value }));
jest.mock("react-native-responsive-screen", () => ({ widthPercentageToDP: () => 10, heightPercentageToDP: () => 10 }));
let tree;
const submit = () => tree.root.findAllByType(TouchableOpacity).find((item) => item.props.onPress?.name === "handleRegister");
async function fill(code = "ABCDE-FGHJK-LMNPQ-RSTUV") {
  await act(async () => {
    tree.root.findAllByType(TextInput).forEach((input, index) => input.props.onChangeText(["New User", "61234567", code, "safe-password", "safe-password"][index]));
  });
}
beforeEach(async () => { jest.clearAllMocks(); mockFocused = true; mockRegister.mockResolvedValue({ success: true }); await act(async () => { tree = renderer.create(<RegisterScreen />); }); });
afterEach(async () => { await act(async () => tree.unmount()); });

test("registration displays nickname, phone, referral code and two secure password fields, with no role or SMS step", async () => {
  const inputs = tree.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(5);
  expect(inputs[2].props.testID).toBe("registration-code");
  expect(inputs[3].props.secureTextEntry).toBe(true); expect(inputs[4].props.secureTextEntry).toBe(true);
  const labels = tree.root.findAllByType(Text).map((item) => item.props.children);
  expect(labels).toContain("registrationNickname"); expect(labels).toContain("confirmPassword"); expect(labels).not.toContain("roleRequired");
  await fill(); await act(async () => submit().props.onPress());
  expect(mockRegister).toHaveBeenCalledWith({ name: "New User", phone: "61234567", countryCode: "+852", registrationCode: "ABCDE-FGHJK-LMNPQ-RSTUV", password: "safe-password", confirmPassword: "safe-password" });
  expect(navigateAfterAuth).not.toHaveBeenCalled();
  await act(async () => showAlert.mock.calls[0][2][0].onPress());
  expect(navigateAfterAuth).toHaveBeenCalledWith("settings");
});

test.each(["ABCD-23EF", "abcd23ef", "ABCDE-FGHJK-LMNPQ-RSTUV"])("registration submits %s without imposing a legacy-only length", async (code) => {
  await fill(code); await act(async () => submit().props.onPress());
  expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ registrationCode: code }));
  expect(showAlert.mock.calls[0][1]).toBe("registerSuccess");
});

test("rapid submission taps send one registration request", async () => {
  let finish;
  mockRegister.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await fill(); const handler = submit().props.onPress;
  let pending;
  await act(async () => { pending = handler(); handler(); });
  expect(mockRegister).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ success: true }); await pending; });
  expect(showAlert).toHaveBeenCalledTimes(1);
});

test.each([["passwordMismatch", "passwordMismatch"], ["invalidRegistrationCode", "invalidRegistrationCode"], ["registrationRateLimited", "registrationRateLimited"], ["networkError", "registrationNetworkError"]])("registration error %s uses the matching localized message and stays on the form", async (error, message) => {
  mockRegister.mockResolvedValueOnce({ success: false, error });
  await fill(); await act(async () => submit().props.onPress());
  expect(showAlert).toHaveBeenCalledWith("warning", message); expect(navigateAfterAuth).not.toHaveBeenCalled();
  expect(submit().props.disabled).toBe(false);
});

test("a registration response cannot open a success dialog behind another screen", async () => {
  let finish;
  mockRegister.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await fill(); let pending;
  await act(async () => { pending = submit().props.onPress(); });
  mockFocused = false; await act(async () => tree.update(<RegisterScreen />));
  await act(async () => { finish({ success: true }); await pending; });
  expect(showAlert).not.toHaveBeenCalled(); expect(navigateAfterAuth).not.toHaveBeenCalled();
});

test("unexpected registration rejection releases the submit button", async () => {
  mockRegister.mockRejectedValueOnce(new Error("failure"));
  await fill(); await act(async () => submit().props.onPress());
  expect(submit().props.disabled).toBe(false); expect(showAlert).toHaveBeenCalledWith("warning", "serverError");
});
