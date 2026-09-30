import React, { useCallback, useContext, useRef, useState } from "react";
import {
	ActivityIndicator,
	ImageBackground,
	KeyboardAvoidingView,
	Platform,
	SafeAreaView,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../contexts/LocaleContext";
import { showAlert } from "../utils/alert";
import { requestSmsCode, resetPassword, verifySmsCode } from "../utils/api";
import CountrySelector from "../components/CountrySelector";
import { isValidInternationalPhone } from "../constants/countries";

const ERROR_MESSAGES = {
	accountNotFound: "accountNotFound",
	invalidPhone: "invalidPhone",
	invalidEmail: "invalidEmail",
	resetRequired: "resetRequired",
	passwordTooShort: "passwordTooShort",
	passwordMismatch: "passwordMismatch",
	invalidCode: "invalidCode",
	codeExpired: "codeExpired",
	smsDeliveryFailed: "smsDeliveryFailed",
	smsUnavailable: "smsUnavailable",
	smsRateLimited: "smsRateLimited",
	smsVerificationFailed: "smsVerificationFailed",
	invalidOrExpiredCode: "invalidCode",
	phoneNotVerified: "invalidCode",
	networkError: "networkError",
	serverError: "serverError",
};

export default function ForgotPasswordScreen() {
	const { i18n } = useContext(LocaleContext);
	const { from } = useLocalSearchParams();
	const [step, setStep] = useState(1);
	const [identifier, setIdentifier] = useState("");
	const [countryCode, setCountryCode] = useState("+852");
	const [code, setCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const focusedRef = useRef(false);
	const requestVersionRef = useRef(0);
	const normalizedFrom = Array.isArray(from) ? from[0] : from;
	useFocusEffect(useCallback(() => {
		focusedRef.current = true;
		submittingRef.current = false;
		setSubmitting(false);
		return () => { focusedRef.current = false; requestVersionRef.current += 1; };
	}, []));
	const isCurrentRequest = (version) => focusedRef.current && version === requestVersionRef.current;
	const backToLogin = () => {
		requestVersionRef.current += 1;
		router.dismissTo({ pathname: "/login", params: { from: normalizedFrom } });
	};

	const handleSendCode = async () => {
		if (submittingRef.current) return;
		if (!isValidInternationalPhone(identifier, countryCode)) {
			showAlert(i18n.t("warning"), i18n.t("invalidPhone"));
			return;
		}

		const version = ++requestVersionRef.current;
		submittingRef.current = true;
		setSubmitting(true);
		try {
			await requestSmsCode(identifier, "password_reset", countryCode);
			if (!isCurrentRequest(version)) return;
			setCode("");
			setStep(2);
			showAlert(i18n.t("codeSentTitle"), i18n.t("codeSentSimple"));
		} catch (error) {
			if (isCurrentRequest(version)) showAlert(i18n.t("warning"), i18n.t(ERROR_MESSAGES[error.code] || "serverError"));
		} finally {
			if (isCurrentRequest(version)) { submittingRef.current = false; setSubmitting(false); }
		}
	};

	const handleResetPassword = async () => {
		if (submittingRef.current) return;
		if (!/^\d{6}$/.test(code) || !newPassword || !confirmPassword) {
			showAlert(i18n.t("warning"), i18n.t("resetRequired"));
			return;
		}
		if (newPassword.length < 8) {
			showAlert(i18n.t("warning"), i18n.t("passwordTooShort"));
			return;
		}
		if (newPassword !== confirmPassword) {
			showAlert(i18n.t("warning"), i18n.t("passwordMismatch"));
			return;
		}
		const version = ++requestVersionRef.current;
		submittingRef.current = true;
		setSubmitting(true);
		try {
			const verified = await verifySmsCode(identifier, code, "password_reset", countryCode);
			if (!isCurrentRequest(version)) return;
			await resetPassword(identifier, newPassword, verified.verificationToken, countryCode);
			if (!isCurrentRequest(version)) return;
			showAlert("", i18n.t("resetSuccess"), [
				{
					text: "OK",
					onPress: () => { if (isCurrentRequest(version)) backToLogin(); },
				},
			]);
		} catch (error) {
			if (isCurrentRequest(version)) showAlert(i18n.t("warning"), i18n.t(ERROR_MESSAGES[error.code] || "serverError"));
		} finally {
			if (isCurrentRequest(version)) { submittingRef.current = false; setSubmitting(false); }
		}
	};

	return (
		<ImageBackground source={require("@/assets/images/background.png")} resizeMethod="cover" style={styles.background}>
			<SafeAreaView style={styles.safeArea}>
				<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
					<ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
						<View style={styles.header}>
							<Text style={styles.title}>{i18n.t("forgotPasswordTitle")}</Text>
							<Text style={styles.subtitle}>
								{step === 1 ? i18n.t("forgotPasswordSubtitle") : i18n.t("forgotPasswordStep2Subtitle")}
							</Text>
						</View>

						<View style={styles.formCard}>
							<View style={styles.demoBadge}>
								<Text style={styles.demoBadgeText}>{i18n.t("forgotPasswordLiveNote")}</Text>
							</View>

							{step === 1 ? (
								<>
									<Text style={styles.label}>{i18n.t("phone")}</Text>
									<View style={styles.phoneRow}>
										<CountrySelector
											i18n={i18n}
											value={countryCode}
											onChange={(value) => { if (!submittingRef.current) { setCountryCode(value); setIdentifier(""); } }}
										/>
										<TextInput
											style={[styles.input, styles.phoneInput]}
											value={identifier}
											onChangeText={setIdentifier}
											editable={!submitting}
											autoCapitalize="none"
											autoCorrect={false}
											keyboardType="phone-pad"
											placeholder={i18n.t("internationalPhonePlaceholder")}
											placeholderTextColor="#999"
										/>
									</View>

									<TouchableOpacity
										style={[styles.primaryButton, submitting && styles.buttonDisabled]}
										onPress={handleSendCode}
										disabled={submitting}
									>
										{submitting ? (
											<ActivityIndicator color="#fff" />
										) : (
											<Text style={styles.primaryButtonText}>{i18n.t("sendCodeButton")}</Text>
										)}
									</TouchableOpacity>
								</>
							) : (
								<>
									<Text style={styles.sentHint}>
										{i18n.t("passwordResetCodeSent")}
									</Text>

									<Text style={styles.label}>{i18n.t("verificationCode")}</Text>
									<TextInput
										style={styles.input}
										value={code}
										onChangeText={setCode}
										keyboardType="number-pad"
										autoCorrect={false}
										placeholder={i18n.t("verificationCodePlaceholder")}
										placeholderTextColor="#999"
										maxLength={6}
									/>

									<Text style={styles.label}>{i18n.t("newPassword")}</Text>
									<TextInput
										style={styles.input}
										value={newPassword}
										onChangeText={setNewPassword}
										secureTextEntry
										autoCapitalize="none"
										autoCorrect={false}
										placeholder={i18n.t("passwordPlaceholder")}
										placeholderTextColor="#999"
									/>

									<Text style={styles.label}>{i18n.t("confirmPassword")}</Text>
									<TextInput
										style={styles.input}
										value={confirmPassword}
										onChangeText={setConfirmPassword}
										secureTextEntry
										autoCapitalize="none"
										autoCorrect={false}
										placeholder={i18n.t("confirmPasswordPlaceholder")}
										placeholderTextColor="#999"
									/>

									<TouchableOpacity
										style={[styles.primaryButton, submitting && styles.buttonDisabled]}
										onPress={handleResetPassword}
										disabled={submitting}
									>
										{submitting ? (
											<ActivityIndicator color="#fff" />
										) : (
											<Text style={styles.primaryButtonText}>{i18n.t("resetPasswordButton")}</Text>
										)}
									</TouchableOpacity>

									<TouchableOpacity
										style={[styles.secondaryButton, submitting && styles.buttonDisabled]}
										onPress={handleSendCode}
										disabled={submitting}
									>
										<Text style={styles.secondaryButtonText}>{i18n.t("resendCodeButton")}</Text>
									</TouchableOpacity>
								</>
							)}

							<View style={styles.footerRow}>
								<TouchableOpacity onPress={backToLogin}>
									<Text style={styles.footerLink}>{i18n.t("backToLogin")}</Text>
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
		justifyContent: "center",
		paddingHorizontal: wp("8%"),
		paddingVertical: hp("4%"),
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
	demoBadge: {
		backgroundColor: "#FFF3CD",
		borderRadius: 8,
		padding: 10,
		marginBottom: hp("2%"),
	},
	demoBadgeText: {
		fontSize: RFValue(12),
		color: "#856404",
		lineHeight: RFValue(18),
		textAlign: "center",
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
		marginBottom: hp("2%"),
		backgroundColor: "#fff",
		color: "#333",
	},
	phoneRow: {
		flexDirection: "row",
		alignItems: "stretch",
		gap: 8,
		marginBottom: hp("2%"),
	},
	phoneInput: {
		flex: 1,
		minWidth: 0,
		marginBottom: 0,
	},
	sentHint: {
		fontSize: RFValue(13),
		color: "#555",
		marginBottom: hp("1%"),
		lineHeight: RFValue(18),
	},
	demoCodeText: {
		fontSize: RFValue(16),
		fontWeight: "bold",
		color: "#840B1C",
		marginBottom: hp("2%"),
		textAlign: "center",
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
	secondaryButton: {
		borderWidth: 1,
		borderColor: "#840B1C",
		borderRadius: 50,
		paddingVertical: hp("1.6%"),
		alignItems: "center",
		marginTop: hp("1.5%"),
		backgroundColor: "#fff",
	},
	secondaryButtonText: {
		color: "#840B1C",
		fontSize: RFValue(15),
		fontWeight: "600",
	},
	buttonDisabled: {
		opacity: 0.7,
	},
	footerRow: {
		flexDirection: "row",
		justifyContent: "center",
		marginTop: hp("2%"),
	},
	footerLink: {
		fontSize: RFValue(14),
		color: "#840B1C",
		fontWeight: "bold",
	},
});
