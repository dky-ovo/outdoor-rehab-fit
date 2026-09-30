import { appText } from "../utils/appText";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import {
	ActivityIndicator,
	findNodeHandle,
	ImageBackground,
	KeyboardAvoidingView,
	Modal,
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

const REMEMBERED_LOGIN_KEY = "@outdoor_fit_remembered_phone_v1";

const ERROR_MESSAGES = {
	loginRequired: "loginRequired",
	invalidCredentials: "invalidCredentials",
	invalidPhone: "invalidPhone",
	invalidEmail: "invalidEmail",
	emailNotRegistered: "emailNotRegistered",
};

export default function LoginScreen() {
	const { i18n } = useContext(LocaleContext);
	const { isGuest, isUser, isLoading, login, loginAsGuest } = useAuth();
	const { from } = useLocalSearchParams();
	const normalizedFrom = Array.isArray(from) ? from[0] : from;
	const isFromSettings = normalizedFrom === "settings";
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [countryCode, setCountryCode] = useState("+852");
	const [rememberPhone, setRememberPhone] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [guestFormVisible, setGuestFormVisible] = useState(false);
	const [guestAge, setGuestAge] = useState("");
	const [guestGender, setGuestGender] = useState("");
	const [guestPurpose, setGuestPurpose] = useState("");
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardInset();
	const scrollRef = useRef(null);
	const passwordRef = useRef(null);
	const passwordFocused = useRef(false);
	const navigationHandledRef = useRef(false);
	const submittingRef = useRef(false);
	const isFocused = useIsFocused();
	const focusedRef = useRef(isFocused);
	focusedRef.current = isFocused;
	const navigateOnce = useCallback(async () => {
		if (navigationHandledRef.current || !focusedRef.current) return;
		navigationHandledRef.current = true;
		await navigateAfterAuth(normalizedFrom);
	}, [normalizedFrom]);
	const scrollToPassword = () => {
		if (!passwordRef.current?.isFocused()) return;
		if (Platform.OS === "web") {
			passwordRef.current?.scrollIntoView?.({ block: "nearest" });
			return;
		}
		const inputHandle = findNodeHandle(passwordRef.current);
		if (inputHandle) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard?.(inputHandle, 28, true);
	};
	useEffect(() => {
		if (!keyboard.visible || !passwordFocused.current) return;
		const first = setTimeout(scrollToPassword, 40);
		const settled = setTimeout(scrollToPassword, 260);
		return () => { clearTimeout(first); clearTimeout(settled); };
	}, [keyboard.inset, keyboard.visible]);

	useEffect(() => {
		let active = true;
		AsyncStorage.getItem(REMEMBERED_LOGIN_KEY)
			.then((stored) => {
				if (!active || !stored) return;
				const remembered = JSON.parse(stored);
				if (!remembered?.phone) return;
				setIdentifier(String(remembered.phone));
				setCountryCode(String(remembered.countryCode || "+852"));
				setRememberPhone(true);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (isFocused && !isLoading && isUser && !isFromSettings) {
			void navigateOnce();
		}
	}, [isFocused, isLoading, isUser, isFromSettings, navigateOnce]);

	const handleLogin = async () => {
		if (submittingRef.current) return;
		if (!identifier.trim() || !password) {
			showAlert(i18n.t("warning"), i18n.t("loginRequired"));
			return;
		}

		submittingRef.current = true;
		setSubmitting(true);
		const result = await login(identifier, password, countryCode);
		submittingRef.current = false;
		setSubmitting(false);

		if (!result.success) {
			if (!focusedRef.current || result.error === "sessionChanged") return;
			const messageKey = ERROR_MESSAGES[result.error] || "invalidCredentials";
			showAlert(i18n.t("warning"), i18n.t(messageKey));
			return;
		}

		if (rememberPhone) {
			await AsyncStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify({
				phone: identifier.trim(),
				countryCode,
			}));
		} else {
			await AsyncStorage.removeItem(REMEMBERED_LOGIN_KEY);
		}

		await navigateOnce();
	};

	const toggleRememberPhone = async () => {
		const next = !rememberPhone;
		setRememberPhone(next);
		if (!next) await AsyncStorage.removeItem(REMEMBERED_LOGIN_KEY);
	};

	const handleGuestLogin = () => {
		setGuestFormVisible(true);
	};

	const continueAsGuest = async () => {
		if (submittingRef.current) return;
		const age = Number(guestAge);
		if (!Number.isInteger(age) || age < 18 || age > 120 || !guestGender || !guestPurpose) {
			showAlert(i18n.t("warning"), appText(i18n.locale, "inline.loginGuest.enterAValidAgeAndSelectYourGender", {"zh":"請填寫有效年齡，並選擇性別及使用目的。","en":"Enter a valid age and select your gender and purpose."}));
			return;
		}
		submittingRef.current = true;
		setSubmitting(true);
		const result = await loginAsGuest({ age, gender: guestGender, purpose: guestPurpose });
		submittingRef.current = false;
		setSubmitting(false);
		if (!result.success) {
			if (!focusedRef.current || result.error === "sessionChanged") return;
			showAlert(i18n.t("warning"), appText(i18n.locale, "inline.loginGuest.theGuestInformationIsInvalidPleaseCheckIt", {"zh":"訪客資料格式不正確，請重新填寫。","en":"The guest information is invalid. Please check it and try again."}));
			return;
		}
		setGuestFormVisible(false);
		await navigateOnce();
	};

	if (isLoading) {
		return (
			<View style={styles.loadingContainer}>
				<ActivityIndicator size="large" color="#840B1C" />
			</View>
		);
	}

	if (isUser && !isFromSettings) {
		return (
			<View style={styles.loadingContainer}>
				<ActivityIndicator size="large" color="#840B1C" />
			</View>
		);
	}

	return (
		<ImageBackground source={require("@/assets/images/background.png")} resizeMode="cover" style={styles.background}>
			<SafeAreaView style={styles.safeArea}>
				<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0} style={styles.flex}>
					<ScrollView ref={scrollRef} contentContainerStyle={[styles.scrollContent, keyboard.inset > 0 && { paddingBottom: keyboard.inset + 32 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
						<View style={styles.header}>
							<Text style={styles.title}>{i18n.t("loginTitle")}</Text>
							<Text style={styles.subtitle}>
								{isFromSettings && isGuest ? i18n.t("loginNowHint") : i18n.t("loginSubtitle")}
							</Text>
						</View>

						<View style={styles.formCard}>
							<Text style={styles.label}>{i18n.t("loginIdentifier")}</Text>
							<View style={styles.identifierRow}>
								<CountrySelector i18n={i18n} value={countryCode} onChange={setCountryCode} />
								<TextInput
								style={[styles.input, styles.identifierInput]}
								value={identifier}
								onChangeText={setIdentifier}
								autoCapitalize="none"
								autoCorrect={false}
								keyboardType="phone-pad"
								placeholder={i18n.t("loginIdentifierPlaceholder")}
								placeholderTextColor="#999"
								/>
							</View>
							<Text style={styles.hint}>{i18n.t("loginIdentifierHint")}</Text>
							<TouchableOpacity
								style={styles.rememberRow}
								onPress={toggleRememberPhone}
								accessibilityRole="checkbox"
								accessibilityState={{ checked: rememberPhone }}
							>
								<View style={[styles.checkbox, rememberPhone && styles.checkboxChecked]}>
									{rememberPhone && <Ionicons name="checkmark" size={17} color="#FFF" />}
								</View>
								<View style={styles.rememberTextWrap}>
									<Text style={styles.rememberLabel}>{i18n.t("rememberPhone")}</Text>
									<Text style={styles.rememberHint}>{i18n.t("rememberPhoneHint")}</Text>
								</View>
							</TouchableOpacity>

							<Text style={styles.label}>{i18n.t("password")}</Text>
							<TextInput
								style={styles.input}
								value={password}
								onChangeText={setPassword}
								secureTextEntry
								ref={passwordRef}
								onFocus={() => { passwordFocused.current = true; setTimeout(scrollToPassword, 60); }}
								onBlur={() => { passwordFocused.current = false; }}
								returnKeyType="done"
								onSubmitEditing={() => { if (!submitting) handleLogin(); }}
								autoCapitalize="none"
								autoCorrect={false}
								placeholder={i18n.t("passwordPlaceholder")}
								placeholderTextColor="#999"
							/>

							<TouchableOpacity
								style={styles.forgotPasswordButton}
								onPress={() => router.push({ pathname: "/forgot-password", params: { from: normalizedFrom } })}
							>
								<Text style={styles.forgotPasswordText}>{i18n.t("forgotPassword")}</Text>
							</TouchableOpacity>

							<TouchableOpacity
								style={[styles.primaryButton, submitting && styles.buttonDisabled]}
								onPress={handleLogin}
								disabled={submitting}
							>
								{submitting ? (
									<ActivityIndicator color="#fff" />
								) : (
									<Text style={styles.primaryButtonText}>{i18n.t("loginButton")}</Text>
								)}
							</TouchableOpacity>

							{!isFromSettings && (
								<TouchableOpacity
									style={[styles.secondaryButton, submitting && styles.buttonDisabled]}
									onPress={handleGuestLogin}
									disabled={submitting}
								>
									<Text style={styles.secondaryButtonText}>{i18n.t("guestButton")}</Text>
								</TouchableOpacity>
							)}

							<View style={styles.footerRow}>
								<Text style={styles.footerText}>{i18n.t("noAccount")} </Text>
								<TouchableOpacity onPress={() => router.push({ pathname: "/register", params: { from: normalizedFrom } })}>
									<Text style={styles.footerLink}>{i18n.t("goToRegister")}</Text>
								</TouchableOpacity>
							</View>
						</View>
					</ScrollView>
				</KeyboardAvoidingView>
			</SafeAreaView>
			<Modal visible={guestFormVisible} transparent animationType="fade" onRequestClose={() => { if (!submittingRef.current) setGuestFormVisible(false); }}>
				<KeyboardAvoidingView style={styles.guestOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
					<ScrollView contentContainerStyle={styles.guestScroll} keyboardShouldPersistTaps="handled">
						<View style={styles.guestCard}>
							<View style={styles.guestHeader}><Ionicons name="person-circle-outline" size={34} color="#840B1C" /><Text style={styles.guestTitle}>{appText(i18n.locale, "inline.loginGuest.guestInformation", {"zh":"訪客基本資料","en":"Guest Information"})}</Text></View>
							<Text style={styles.guestResearchNote}>{appText(i18n.locale, "inline.loginGuest.thisAppIsDevelopedByAUniversityResearch", {"zh":"此應用程式由大學研究團隊開發，資助期結束後可能停止提供。收集匿名人口資料及使用目的，是為了了解使用者需要並規劃日後面向香港市民的服務。","en":"This app is developed by a university research team and may cease after the funding period. Anonymous demographic and purpose data help us understand users and plan a future service for Hong Kong residents."})}</Text>
							<Text style={styles.label}>{appText(i18n.locale, "inline.loginGuest.age", {"zh":"年齡","en":"Age"})}</Text>
							<TextInput style={styles.input} value={guestAge} onChangeText={setGuestAge} keyboardType="number-pad" maxLength={3} placeholder={appText(i18n.locale, "inline.loginGuest.enterAge", {"zh":"請輸入年齡","en":"Enter age"})} />
							<Text style={styles.label}>{appText(i18n.locale, "inline.loginGuest.gender", {"zh":"性別","en":"Gender"})}</Text>
							<View style={styles.optionRow}>{[["female", appText(i18n.locale, "inline.loginGuest.female", { zh: "女", en: "Female" })], ["male", appText(i18n.locale, "inline.loginGuest.male", { zh: "男", en: "Male" })], ["other", appText(i18n.locale, "inline.loginGuest.otherGender", { zh: "其他／不透露", en: "Other / Prefer not to say" })]].map(([key, label]) => <TouchableOpacity key={key} style={[styles.optionChip, guestGender === key && styles.optionChipActive]} onPress={() => setGuestGender(key)}><Text style={[styles.optionText, guestGender === key && styles.optionTextActive]}>{label}</Text></TouchableOpacity>)}</View>
							<Text style={styles.label}>{appText(i18n.locale, "inline.loginGuest.purposeOfUse", {"zh":"使用目的","en":"Purpose of Use"})}</Text>
							{[["personal", appText(i18n.locale, "inline.loginGuest.personalUse", { zh: "個人使用", en: "Personal use" })], ["family", appText(i18n.locale, "inline.loginGuest.familyCaregiver", { zh: "我是家庭照顧者", en: "I am a family caregiver" })], ["industry", appText(i18n.locale, "inline.loginGuest.healthWellness", { zh: "我在健康與保健行業工作", en: "I work in health and wellness" })]].map(([key, label]) => <TouchableOpacity key={key} style={[styles.purposeOption, guestPurpose === key && styles.purposeOptionActive]} onPress={() => setGuestPurpose(key)}><Ionicons name={guestPurpose === key ? "radio-button-on" : "radio-button-off"} size={21} color="#840B1C" /><Text style={styles.purposeText}>{label}</Text></TouchableOpacity>)}
							<View style={styles.guestActions}><TouchableOpacity style={styles.guestCancel} onPress={() => { if (!submittingRef.current) setGuestFormVisible(false); }} disabled={submitting}><Text style={styles.guestCancelText}>{i18n.t("cancel")}</Text></TouchableOpacity><TouchableOpacity style={styles.guestContinue} onPress={continueAsGuest} disabled={submitting}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.guestContinueText}>{i18n.t("stayGuest")}</Text>}</TouchableOpacity></View>
						</View>
					</ScrollView>
				</KeyboardAvoidingView>
			</Modal>
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
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#fff",
	},
	scrollContent: {
		flexGrow: 1,
		justifyContent: "center",
		paddingHorizontal: wp("8%"),
		paddingVertical: hp("4%"),
	},
	header: {
		marginBottom: hp("3%"),
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
	hint: {
		fontSize: RFValue(11),
		color: "#777",
		lineHeight: RFValue(16),
		marginTop: -hp("1%"),
		marginBottom: hp("1.5%"),
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
	rememberRow: {
		flexDirection: "row",
		alignItems: "center",
		marginTop: -hp("0.5%"),
		marginBottom: hp("1.8%"),
		paddingVertical: 4,
	},
	checkbox: {
		width: 24,
		height: 24,
		borderRadius: 6,
		borderWidth: 2,
		borderColor: "#840B1C",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFF",
	},
	checkboxChecked: {
		backgroundColor: "#840B1C",
	},
	rememberTextWrap: {
		flex: 1,
		marginLeft: 10,
	},
	rememberLabel: {
		fontSize: RFValue(13),
		fontWeight: "600",
		color: "#333",
	},
	rememberHint: {
		marginTop: 2,
		fontSize: RFValue(10),
		lineHeight: RFValue(14),
		color: "#777",
	},
	identifierRow: {
		flexDirection: "row",
		alignItems: "stretch",
		gap: 8,
		marginBottom: hp("2%"),
	},
	identifierInput: {
		flex: 1,
		minWidth: 0,
		marginBottom: 0,
	},
	forgotPasswordButton: {
		alignSelf: "flex-end",
		marginTop: -hp("1%"),
		marginBottom: hp("1.5%"),
	},
	forgotPasswordText: {
		fontSize: RFValue(13),
		color: "#840B1C",
		fontWeight: "600",
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
	footerText: {
		fontSize: RFValue(14),
		color: "#666",
	},
	footerLink: {
		fontSize: RFValue(14),
		color: "#840B1C",
		fontWeight: "bold",
	},
	guestOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)" },
	guestScroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
	guestCard: { width: "100%", maxWidth: 520, alignSelf: "center", borderRadius: 18, backgroundColor: "#fff", padding: 20 },
	guestHeader: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 10 },
	guestTitle: { flex: 1, fontSize: RFValue(19), fontWeight: "900", color: "#222" },
	guestResearchNote: { fontSize: RFValue(11), lineHeight: RFValue(17), color: "#666", backgroundColor: "#FFF5E6", borderRadius: 10, padding: 12, marginBottom: 8 },
	optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
	optionChip: { borderWidth: 1, borderColor: "#CFCFCF", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
	optionChipActive: { backgroundColor: "#840B1C", borderColor: "#840B1C" },
	optionText: { fontSize: RFValue(11), color: "#333" },
	optionTextActive: { color: "#fff", fontWeight: "700" },
	purposeOption: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: "#EEE", paddingVertical: 9 },
	purposeOptionActive: { backgroundColor: "#FFF6F7" },
	purposeText: { flex: 1, fontSize: RFValue(12), color: "#333" },
	guestActions: { flexDirection: "row", gap: 10, marginTop: 20 },
	guestCancel: { flex: 1, minHeight: 48, borderRadius: 10, backgroundColor: "#EEE", alignItems: "center", justifyContent: "center" },
	guestCancelText: { color: "#444", fontWeight: "700" },
	guestContinue: { flex: 1.4, minHeight: 48, borderRadius: 10, backgroundColor: "#840B1C", alignItems: "center", justifyContent: "center" },
	guestContinueText: { color: "#fff", fontWeight: "800" },
});
