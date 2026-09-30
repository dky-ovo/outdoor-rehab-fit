import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useAuth } from "../../../contexts/AuthContext";
import { isValidEmail } from "../../../constants/auth";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { useKeyboardInset } from "../../../hooks/useKeyboardInset";
import { createFeedbackSubmissionId, submitContactFeedback } from "../../../utils/feedbackApi";

const FIELD_LIMITS = { name: 80, email: 254, subject: 160, message: 5000 };
const FIELD_ERRORS = { name: "contactInvalidName", email: "contactInvalidEmail", subject: "contactInvalidSubject", message: "contactInvalidMessage" };

export default function ContactUs() {
	const { user, isGuest, isLoading } = useAuth();
	const registered = Boolean(user && !isGuest && !user.isGuest && user.role !== "guest");
	// A new session owns a new form. Old requests cannot clear another account's
	// draft, including when users switch away and then return to the same account.
	const sessionKey = JSON.stringify([registered, user?.id, user?.token, user?.loginAt, user?.guestProfile?.serverId]);
	return <ContactForm key={sessionKey} user={user} registered={registered} authLoading={isLoading} />;
}

function ContactForm({ user, registered, authLoading }) {
	useAndroidBackTarget("/(tabs)/setting");
	const { i18n, locale: contextLocale } = useContext(LocaleContext);
	const locale = String(contextLocale || i18n.locale || "zh").startsWith("en") ? "en" : "zh";
	const headerHeight = useHeaderHeight();
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardInset();
	const isFocused = useIsFocused();
	const scrollRef = useRef(null);
	const inputRefs = useRef({});
	const focusedField = useRef(null);
	const focusTimers = useRef([]);
	const mounted = useRef(true);
	const currentScope = useRef({ locale, isFocused });
	currentScope.current = { locale, isFocused };
	const requestRef = useRef(null);
	const submissionRef = useRef(null);
	const [draft, setDraft] = useState(() => ({ name: registered ? user?.name || "" : "", email: registered ? user?.email || "" : "", subject: "", message: "" }));
	const draftRef = useRef(draft);
	const [sending, setSending] = useState(false);
	const [errors, setErrors] = useState({});
	const [failure, setFailure] = useState("");
	const [receipt, setReceipt] = useState(null);
	const cancelInputScroll = useCallback(() => {
		focusTimers.current.forEach(clearTimeout);
		focusTimers.current = [];
		focusedField.current = null;
	}, []);
	const returnToSettings = useCallback(() => {
		cancelInputScroll();
		requestRef.current = null;
		// Match the existing About screen's native back action and fallback.
		if (router.canGoBack()) router.back();
		else router.replace("/(tabs)/setting");
	}, [cancelInputScroll]);

	// Headers and keyboard tab-bar behavior are fixed at the navigator level.
	// Leaving this form only cancels delayed input scrolling; never resize the
	// parent navigator in the middle of its native transition.
	useFocusEffect(useCallback(() => cancelInputScroll, [cancelInputScroll]));

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; requestRef.current = null; focusTimers.current.forEach(clearTimeout); };
	}, []);
	useEffect(() => {
		requestRef.current = null;
		setSending(false);
		return () => { requestRef.current = null; };
	}, [locale, isFocused]);
	const revealFocusedInput = useCallback(() => {
		if (!mounted.current || !currentScope.current.isFocused) return;
		const input = inputRefs.current[focusedField.current];
		if (!input?.isFocused?.()) return;
		if (Platform.OS === "web") { input.scrollIntoView?.({ block: "nearest" }); return; }
		const handle = findNodeHandle(input);
		if (handle) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard?.(handle, 28, true);
	}, []);
	useEffect(() => {
		if (!isFocused || !keyboard.visible) return undefined;
		const timer = setTimeout(revealFocusedInput, 80);
		return () => clearTimeout(timer);
	}, [isFocused, keyboard.inset, keyboard.visible, revealFocusedInput]);
	const focusField = (field) => {
		if (!mounted.current || !currentScope.current.isFocused) return;
		focusedField.current = field;
		focusTimers.current.forEach(clearTimeout);
		focusTimers.current = [setTimeout(revealFocusedInput, 40), setTimeout(revealFocusedInput, 260)];
	};

	const updateField = (field, value) => {
		if (requestRef.current) return;
		if (draftRef.current[field] === value) return;
		draftRef.current = { ...draftRef.current, [field]: value };
		setDraft(draftRef.current);
		submissionRef.current = null;
		setErrors((current) => ({ ...current, [field]: undefined }));
		setFailure("");
	};

	const submit = async () => {
		if (!mounted.current || requestRef.current || !currentScope.current.isFocused || currentScope.current.locale !== locale || authLoading) return;
		const data = Object.fromEntries(Object.entries(draftRef.current).map(([key, value]) => [key, value.trim()]));
		const nextErrors = {};
		for (const field of Object.keys(FIELD_LIMITS)) {
			if ((field !== "subject" && !data[field]) || data[field].length > FIELD_LIMITS[field]) nextErrors[field] = FIELD_ERRORS[field];
		}
		if (!isValidEmail(data.email)) nextErrors.email = FIELD_ERRORS.email;
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length) {
			setFailure("contactCorrectFields");
			inputRefs.current[Object.keys(nextErrors)[0]]?.focus();
			return;
		}
		if (registered && !user?.token) {
			setFailure("contactSessionExpired");
			return;
		}

		const request = {};
		requestRef.current = request; // Synchronous lock also blocks same-frame taps.
		setSending(true);
		setFailure("");
		Keyboard.dismiss();
		const isCurrent = () => mounted.current && requestRef.current === request && currentScope.current.isFocused && currentScope.current.locale === locale;
		try {
			const payload = { ...data, locale };
			const fingerprint = JSON.stringify(payload);
			if (!submissionRef.current || submissionRef.current.fingerprint !== fingerprint) {
				submissionRef.current = { fingerprint, id: createFeedbackSubmissionId() };
			}
			const result = await submitContactFeedback({ ...payload, submissionId: submissionRef.current.id }, registered ? user.token : undefined);
			if (!isCurrent()) return;
			if (typeof result?.feedback?.id !== "string" || !result.feedback.id.trim()) throw new Error("invalidFeedbackResponse");
			submissionRef.current = null;
			draftRef.current = { ...draftRef.current, subject: "", message: "" };
			setDraft(draftRef.current);
			setReceipt(result.feedback.id);
			scrollRef.current?.scrollTo({ y: 0, animated: true });
		} catch (error) {
			if (!isCurrent()) return;
			if (error?.status === 401 || error?.code === "unauthorized") setFailure("contactSessionExpired");
			else if (error?.status === 429 || error?.code === "feedbackRateLimited") setFailure("contactRateLimited");
			else setFailure("contactSendFailed");
		} finally {
			if (isCurrent()) {
				requestRef.current = null;
				setSending(false);
			}
		}
	};

	const renderField = (field, labelKey, placeholderKey, extra = {}) => (
		<View style={styles.field} key={field}>
			<Text nativeID={`contact-${field}-label`} style={styles.label}>{i18n.t(labelKey)}{field !== "subject" ? " *" : ""}</Text>
			<TextInput
				ref={(node) => { inputRefs.current[field] = node; }}
				testID={`contact-${field}`}
				accessibilityLabel={`${i18n.t(labelKey)}${field !== "subject" ? " *" : ""}`}
				accessibilityLabelledBy={`contact-${field}-label`}
				accessibilityHint={errors[field] ? i18n.t(errors[field]) : undefined}
				style={[styles.input, field === "message" && styles.messageInput, errors[field] && styles.invalidInput]}
				placeholder={i18n.t(placeholderKey)}
				placeholderTextColor="#777"
				value={draft[field]}
				onChangeText={(value) => updateField(field, value)}
				onFocus={() => focusField(field)}
				maxLength={FIELD_LIMITS[field]}
				editable={!sending}
				{...extra}
			/>
			{errors[field] ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{i18n.t(errors[field])}</Text> : null}
		</View>
	);

	return (
		<KeyboardAvoidingView style={[styles.screen, Platform.OS === "android" && { paddingBottom: keyboard.inset }]} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
			<ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.page, { paddingBottom: Platform.OS === "android" && keyboard.visible ? 24 : 110 + insets.bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator>
				<View style={styles.content}>
					{receipt ? (
						<View testID="contact-receipt" style={styles.receipt} accessibilityLiveRegion="polite">
							<Ionicons name="checkmark-circle-outline" size={56} color="#840B1C" />
							<Text style={styles.title}>{i18n.t("contactReceived")}</Text>
							<Text style={styles.body}>{i18n.t("contactReceivedHint")}</Text>
							<Text style={styles.referenceLabel}>{i18n.t("contactReference")}</Text>
							<Text selectable style={styles.reference}>{receipt}</Text>
							<TouchableOpacity style={styles.sendButton} accessibilityRole="button" onPress={() => setReceipt(null)}><Text style={styles.sendText}>{i18n.t("contactSendAnother")}</Text></TouchableOpacity>
							<TouchableOpacity style={styles.backButton} accessibilityRole="button" onPress={returnToSettings}><Text style={styles.backText}>{i18n.t("contactBackToSettings")}</Text></TouchableOpacity>
						</View>
					) : (
						<>
							<View style={styles.introduction}><Ionicons name="mail-outline" size={30} color="#840B1C" /><Text style={styles.body}>{i18n.t("contactIntro")}</Text></View>
							<Text style={styles.requiredHint}>{i18n.t("contactRequiredHint")}</Text>
							{renderField("name", "contactName", "contactNamePlaceholder", { autoComplete: "name", textContentType: "name", autoCapitalize: "words", returnKeyType: "next", onSubmitEditing: () => inputRefs.current.email?.focus() })}
							{renderField("email", "contactEmail", "contactEmailPlaceholder", { keyboardType: "email-address", autoComplete: "email", textContentType: "emailAddress", autoCapitalize: "none", autoCorrect: false, returnKeyType: "next", onSubmitEditing: () => inputRefs.current.subject?.focus() })}
							{renderField("subject", "contactSubject", "contactSubjectPlaceholder", { returnKeyType: "next", onSubmitEditing: () => inputRefs.current.message?.focus() })}
							{renderField("message", "contactMessage", "contactMessagePlaceholder", { multiline: true, textAlignVertical: "top", scrollEnabled: false })}
							<Text style={styles.characterCount}>{draft.message.length} / 5,000</Text>
							<View style={styles.privacy}><Ionicons name="shield-checkmark-outline" size={23} color="#65565A" /><Text style={styles.privacyText}>{i18n.t("contactPrivacy")}</Text></View>
							{failure ? <Text testID="contact-error" style={styles.failure} accessibilityRole="alert" accessibilityLiveRegion="assertive">{i18n.t(failure)}</Text> : null}
							<TouchableOpacity testID="contact-submit" style={[styles.sendButton, (sending || authLoading) && styles.disabled]} accessibilityRole="button" accessibilityState={{ disabled: sending || Boolean(authLoading), busy: sending }} disabled={sending || authLoading} onPress={submit}>
								{sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send-outline" size={21} color="#fff" />}
								<Text style={styles.sendText}>{i18n.t(sending ? "contactSending" : "contactSend")}</Text>
							</TouchableOpacity>
						</>
					)}
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: "#fff" }, scroll: { flex: 1 },
	page: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24 }, content: { width: "100%", maxWidth: 640, alignSelf: "center" },
	introduction: { gap: 12, marginBottom: 16 }, body: { fontSize: 17, lineHeight: 26, color: "#4B4244", flexShrink: 1 },
	requiredHint: { color: "#715D62", fontSize: 15, lineHeight: 23, marginBottom: 6 },
	field: { marginTop: 18 }, label: { fontSize: 18, fontWeight: "700", color: "#332B2D", lineHeight: 27, marginBottom: 9 },
	input: { borderWidth: 1, borderColor: "#C7BDBF", borderRadius: 10, backgroundColor: "#FAF9F9", color: "#222", minHeight: 56, paddingHorizontal: 14, paddingVertical: 13, fontSize: 18 },
	messageInput: { minHeight: 180 }, invalidInput: { borderColor: "#B00020", borderWidth: 2 },
	fieldError: { color: "#A10F29", fontSize: 16, lineHeight: 24, marginTop: 7 }, characterCount: { fontSize: 14, color: "#756B6E", textAlign: "right", marginTop: 8 },
	privacy: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F7F1F2", borderRadius: 10, padding: 14, marginTop: 22 }, privacyText: { flex: 1, color: "#65565A", fontSize: 15, lineHeight: 24 },
	failure: { fontSize: 17, lineHeight: 26, color: "#A10F29", backgroundColor: "#FFF0F2", padding: 14, borderRadius: 10, marginTop: 20 },
	sendButton: { minHeight: 58, paddingVertical: 16, paddingHorizontal: 20, marginTop: 24, borderRadius: 12, backgroundColor: "#840B1C", flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", width: "100%" },
	sendText: { color: "#fff", fontSize: 19, lineHeight: 28, fontWeight: "700", textAlign: "center", flexShrink: 1 }, disabled: { opacity: 0.65 },
	receipt: { alignItems: "flex-start", paddingTop: 12 }, title: { fontSize: 24, lineHeight: 34, fontWeight: "800", color: "#332B2D", marginTop: 18, marginBottom: 12 },
	referenceLabel: { fontSize: 16, lineHeight: 24, color: "#65565A", marginTop: 24 }, reference: { fontSize: 18, lineHeight: 28, color: "#840B1C", fontWeight: "700", marginTop: 5 },
	backButton: { width: "100%", minHeight: 52, padding: 14, marginTop: 12, alignItems: "center", justifyContent: "center" }, backText: { color: "#840B1C", fontSize: 18, lineHeight: 27, fontWeight: "600", textAlign: "center" },
});
