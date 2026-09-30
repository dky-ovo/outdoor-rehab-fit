import React, { useContext, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	findNodeHandle,
	ImageBackground,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../contexts/LocaleContext";
import { showAlert } from "../utils/alert";
import { useAuth } from "../contexts/AuthContext";
import { navigateAfterAuth } from "../utils/onboarding";
import CountrySelector from "../components/CountrySelector";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardInset } from "../hooks/useKeyboardInset";

const ERROR_MESSAGES = {
	registerRequired: "registerRequired",
	passwordTooShort: "passwordTooShort",
	passwordMismatch: "passwordMismatch",
	invalidPhone: "invalidPhone",
	invalidEmail: "invalidEmail",
	phoneExists: "phoneExists",
	emailExists: "emailExists",
	nameRequired: "nameRequired",
	roleRequired: "roleRequired",
	networkError: "registrationNetworkError",
	serverError: "serverError",
	registrationCodeRequired: "registrationCodeRequired",
	invalidRegistrationCode: "invalidRegistrationCode",
	registrationRateLimited: "registrationRateLimited",
	passwordTooLong: "passwordTooLong",
	invalidRegistration: "registerRequired",
};

export default function RegisterScreen() {
	const { i18n } = useContext(LocaleContext);
	const { register } = useAuth();
	const { from } = useLocalSearchParams();
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [countryCode, setCountryCode] = useState("+852");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [registrationCode, setRegistrationCode] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const isFocused = useIsFocused();
	const focusedRef = useRef(isFocused);
	focusedRef.current = isFocused;
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardInset();
	const scrollRef = useRef(null);
	const currentInputRef = useRef(null);
	const focusTimers = useRef([]);
	const passwordRef = useRef(null);
	const confirmationRef = useRef(null);
	const codeRef = useRef(null);
	const revealInput = () => {
		const input = currentInputRef.current;
		if (!input?.isFocused?.()) return;
		if (Platform.OS === "web") { input.scrollIntoView?.({ block: "nearest" }); return; }
		const handle = findNodeHandle(input);
		if (handle) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard?.(handle, 28, true);
	};
	const focusInput = (ref) => {
		currentInputRef.current = ref.current;
		focusTimers.current.forEach(clearTimeout);
		focusTimers.current = [setTimeout(revealInput, 40), setTimeout(revealInput, 260)];
	};
	useEffect(() => {
		if (!keyboard.visible) return;
		const timer = setTimeout(revealInput, 80);
		return () => clearTimeout(timer);
	}, [keyboard.inset, keyboard.visible]);
	useEffect(() => () => { focusTimers.current.forEach(clearTimeout); }, []);

	const handleRegister = async () => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		let result;
		try {
			result = await register({ name, phone, countryCode, registrationCode, password, confirmPassword });
		} catch {
			result = { success: false, error: "serverError" };
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
		if (!focusedRef.current || result.error === "sessionChanged") return;

		if (!result.success) {
			const messageKey = ERROR_MESSAGES[result.error] || "registerRequired";
			showAlert(i18n.t("warning"), i18n.t(messageKey));
			return;
		}

		showAlert("", i18n.t("registerSuccess"), [
			{
				text: "OK",
				onPress: () => navigateAfterAuth(Array.isArray(from) ? from[0] : from),
			},
		]);
	};

	const handleCountryChange = (value) => {
		setCountryCode(value);
		setPhone("");
	};

	return (
		<ImageBackground source={require("@/assets/images/background.png")} resizeMode="cover" style={styles.background}>
			<SafeAreaView style={styles.safeArea}>
				<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0} style={styles.flex}>
					<ScrollView ref={scrollRef} contentContainerStyle={[styles.scrollContent, keyboard.inset > 0 && { paddingBottom: keyboard.inset + 32 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
						<View style={styles.header}>
							<Text style={styles.title}>{i18n.t("registerTitle")}</Text>
							<Text style={styles.subtitle}>{i18n.t("registerSubtitle")}</Text>
						</View>

						<View style={styles.formCard}>
							<Text style={styles.label}>{i18n.t("registrationNickname")}</Text>
							<TextInput
								style={styles.input}
								value={name}
								onChangeText={setName}
								autoCapitalize="words"
								autoCorrect={false}
								maxLength={50}
								placeholder={i18n.t("usernamePlaceholder")}
								placeholderTextColor="#999"
							/>

							<Text style={styles.label}>{i18n.t("phone")}</Text>
							<View style={styles.phoneRow}>
								<CountrySelector i18n={i18n} value={countryCode} onChange={handleCountryChange} />
								<TextInput
									style={[styles.input, styles.phoneInput]}
									value={phone}
									onChangeText={setPhone}
									keyboardType="phone-pad"
									autoCorrect={false}
									placeholder={i18n.t("internationalPhonePlaceholder")}
									placeholderTextColor="#999"
								/>
							</View>

							<Text style={styles.label}>{i18n.t("registrationCode")}</Text>
							<TextInput testID="registration-code" style={styles.input} ref={codeRef} onFocus={() => focusInput(codeRef)}
								value={registrationCode} onChangeText={setRegistrationCode}
								autoCapitalize="characters" autoCorrect={false} maxLength={40}
								placeholder={i18n.t("registrationCodePlaceholder")} placeholderTextColor="#999" />
							<Text style={styles.label}>{i18n.t("password")}</Text>
							<TextInput
								style={styles.input}
								value={password}
								ref={passwordRef}
								onFocus={() => focusInput(passwordRef)}
								maxLength={256}
								onChangeText={setPassword}
								secureTextEntry
								autoCapitalize="none"
								autoCorrect={false}
								placeholder={i18n.t("passwordPlaceholder")}
								placeholderTextColor="#999"
							/>
							<Text style={styles.label}>{i18n.t("confirmPassword")}</Text>
							<TextInput testID="registration-confirm-password" style={styles.input} ref={confirmationRef} onFocus={() => focusInput(confirmationRef)}
								value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry
								autoCapitalize="none" autoCorrect={false} maxLength={256}
								placeholder={i18n.t("confirmPasswordPlaceholder")} placeholderTextColor="#999" />

							<TouchableOpacity
								style={[styles.primaryButton, submitting && styles.buttonDisabled]}
								onPress={handleRegister}
								disabled={submitting}
							>
								{submitting ? (
									<ActivityIndicator color="#fff" />
								) : (
									<Text style={styles.primaryButtonText}>{i18n.t("registerButton")}</Text>
								)}
							</TouchableOpacity>

							<View style={styles.footerRow}>
								<Text style={styles.footerText}>{i18n.t("hasAccount")} </Text>
								<TouchableOpacity onPress={() => router.replace({ pathname: "/login", params: { from } })}>
									<Text style={styles.footerLink}>{i18n.t("goToLogin")}</Text>
								</TouchableOpacity>
							</View>
						</View>
					</ScrollView>
				</KeyboardAvoidingView>
			</SafeAreaView>
		</ImageBackground>
	);
}

const styles = StyleSheet.create({
	background: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	flex: {
		flex: 1,
	},
	scrollContent: {
		flexGrow: 1,
		paddingHorizontal: wp("8%"),
		paddingVertical: hp("3%"),
	},
	header: {
		marginBottom: hp("2%"),
	},
	title: {
		fontSize: RFValue(24),
		fontWeight: "bold",
		color: "#840B1C",
		textAlign: "center",
	},
	subtitle: {
		marginTop: hp("1%"),
		fontSize: RFValue(14),
		color: "#555",
		textAlign: "center",
		lineHeight: RFValue(20),
	},
	formCard: {
		backgroundColor: "rgba(255, 255, 255, 0.95)",
		borderRadius: 16,
		padding: wp("6%"),
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 4,
	},
	label: {
		fontSize: RFValue(14),
		fontWeight: "600",
		color: "#333",
		marginBottom: hp("0.8%"),
	},
	input: {
		borderWidth: 1,
		borderColor: "#ddd",
		borderRadius: 10,
		paddingHorizontal: wp("4%"),
		paddingVertical: hp("1.4%"),
		fontSize: RFValue(14),
		marginBottom: hp("1.8%"),
		backgroundColor: "#fff",
		color: "#333",
	},
	phoneRow: {
		flexDirection: "row",
		alignItems: "stretch",
		gap: 8,
		marginBottom: hp("1.8%"),
	},
	phoneInput: {
		flex: 1,
		minWidth: 0,
		marginBottom: 0,
	},
	roleContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		marginBottom: hp("1.8%"),
	},
	roleOption: {
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 20,
		paddingHorizontal: 14,
		paddingVertical: 8,
		backgroundColor: "#fff",
	},
	roleOptionSelected: {
		borderColor: "#840B1C",
		backgroundColor: "#840B1C",
	},
	roleOptionText: {
		fontSize: RFValue(12),
		color: "#333",
	},
	roleOptionTextSelected: {
		color: "#fff",
		fontWeight: "bold",
	},
	primaryButton: {
		backgroundColor: "#840B1C",
		borderRadius: 50,
		paddingVertical: hp("1.8%"),
		alignItems: "center",
		marginTop: hp("1%"),
	},
	primaryButtonText: {
		color: "#fff",
		fontSize: RFValue(16),
		fontWeight: "bold",
	},
	buttonDisabled: {
		opacity: 0.7,
	},
	codeButton: {
		borderWidth: 1,
		borderColor: "#840B1C",
		borderRadius: 10,
		paddingVertical: hp("1.3%"),
		alignItems: "center",
		marginTop: -hp("0.8%"),
		marginBottom: hp("1.8%"),
		backgroundColor: "#fff",
	},
	codeButtonText: {
		color: "#840B1C",
		fontSize: RFValue(14),
		fontWeight: "bold",
	},
	verifiedText: {
		color: "#177245",
		fontWeight: "bold",
		marginTop: -hp("0.8%"),
		marginBottom: hp("1.8%"),
	},
	footerRow: {
		flexDirection: "row",
		justifyContent: "center",
		marginTop: hp("2%"),
	},
	footerText: {
		fontSize: RFValue(14),
		color: "#666",
	},
	footerLink: {
		fontSize: RFValue(14),
		color: "#840B1C",
		fontWeight: "bold",
	},
});
