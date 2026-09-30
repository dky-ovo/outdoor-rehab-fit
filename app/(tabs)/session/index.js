// App Upgrade #5: Session record - timer with Start/Resume/Pause + End session
import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackHandler, Modal, Platform, ScrollView, StyleSheet, View, Text, TextInput, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useFocusEffect, useIsFocused, usePreventRemove } from "@react-navigation/native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { formatDuration } from "../../../utils/dates";
import { showAlert } from "../../../utils/alert";
import { isRetiredCountupBlocked, sessionInitializationAction, sessionPathForMode } from "../../../utils/sessionRoutes";
import { useActiveSession } from "../../../contexts/ActiveSessionContext";
import SessionSummary from "./summary";

export const SessionRecord = ({ forcedRecordMode }) => {
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const {
		mode,
		recordMode,
		targetDurationSec,
		seconds,
		running,
		started,
		completed,
		hydrated,
		pendingSummary,
		chooseMode,
		setCountdownDuration,
		startCountdown,
		toggleRunning,
		resetSession,
		finishSession,
		clearPendingSummary,
	} = useActiveSession();
	const navigation = useNavigation();
	const isFocused = useIsFocused();
	const params = useLocalSearchParams();
	const allowLeaveRef = useRef(false);
	const timerScrollRef = useRef(null);
	const [focusVisit, setFocusVisit] = useState(0);
	const [endPromptVisible, setEndPromptVisible] = useState(false);
	const [summaryExitPromptVisible, setSummaryExitPromptVisible] = useState(false);
	const [summaryExitRequested, setSummaryExitRequested] = useState(false);
	const [countdownMinutes, setCountdownMinutes] = useState("30");
	const rawRecordMode = Array.isArray(params.recordMode) ? params.recordMode[0] : params.recordMode;
	const requestedRecordMode = forcedRecordMode === "countdown" || forcedRecordMode === "manual" || forcedRecordMode === "countup"
		? forcedRecordMode
		: rawRecordMode === "countdown" ? "countdown" : rawRecordMode === "manual" ? "manual" : "countup";
	const activeTimer = started && !completed;
	const showCountdownSetup = recordMode === "countdown" && !activeTimer;
	const conflictingActiveTimer = Boolean(activeTimer && recordMode !== requestedRecordMode);
	const retiredCountupBlocked = isRetiredCountupBlocked({ requestedRecordMode, recordMode, started, pendingSummary });
	const fromFloating = String(params.fromFloating || "") === "1";
	const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
	const normalizedReturnTo = typeof returnTo === "string" ? returnTo.replace(/^\/\(tabs\)/, "").split(/[?#]/)[0] : "";
	const safeReturnTo =
		typeof returnTo === "string" &&
		returnTo.startsWith("/") &&
		!returnTo.startsWith("//") &&
		normalizedReturnTo !== "/session" &&
		!normalizedReturnTo.startsWith("/session/");

	const exitSummary = useCallback(() => {
		allowLeaveRef.current = true;
		setSummaryExitPromptVisible(false);
		setSummaryExitRequested(true);
		clearPendingSummary();
	}, [clearPendingSummary]);

	const requestSummaryExit = useCallback(() => {
		if (!pendingSummary || allowLeaveRef.current || summaryExitRequested) return;
		setSummaryExitPromptVisible(true);
	}, [pendingSummary, summaryExitRequested]);

	// React Navigation's documented removal guard is required for native-stack
	// gestures. Android edge-back can bypass a plain beforeRemove listener on
	// some vendors, while usePreventRemove covers the native removal action.
	usePreventRemove(isFocused && !retiredCountupBlocked && Boolean(pendingSummary) && !summaryExitRequested, () => {
		requestSummaryExit();
	});

	const handleBack = useCallback(() => {
		if (pendingSummary) {
			requestSummaryExit();
			return;
		}
		// Before timing starts, Back returns from the timer controls to the
		// outdoor/home choice without leaving the session flow.
		if (!activeTimer && mode && requestedRecordMode === "manual") {
			resetSession();
			return;
		}
		if (!activeTimer && mode) {
			allowLeaveRef.current = true;
			resetSession();
			router.replace("/(tabs)");
			return;
		}

		allowLeaveRef.current = true;
		if (activeTimer && fromFloating && safeReturnTo) {
			// Use the page captured by the floating timer instead of the native
			// stack's previous route. The latter can be a stale summary screen.
			router.dismissTo(returnTo);
			return;
		}
		router.replace("/(tabs)");
	}, [activeTimer, fromFloating, mode, pendingSummary, requestSummaryExit, requestedRecordMode, resetSession, returnTo, safeReturnTo]);

	useLayoutEffect(() => {
		const screenTitle = pendingSummary
			? i18n.t("sessionSummary")
			: i18n.t(requestedRecordMode === "countdown" ? "countdownTimer" : requestedRecordMode === "manual" ? "manualSessionLog" : "countupTimer");
		navigation.setOptions({
			title: screenTitle,
			headerLeft: () => (
				<TouchableOpacity
					onPress={handleBack}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("back")}
					style={{ paddingHorizontal: 8, paddingVertical: 6 }}
				>
					<Ionicons name="chevron-back" size={RFValue(18)} color="#000" />
				</TouchableOpacity>
			),
		});
	}, [handleBack, i18n, locale, textRevision, navigation, pendingSummary, requestedRecordMode]);

	// Android's edge swipe is delivered as a hardware back event on devices
	// using gesture navigation. Register while this route is focused and consume
	// it so it cannot fall through to the tab/root navigator.
	useFocusEffect(
		useCallback(() => {
			// A cached route may be visited again after it previously completed a
			// discard/navigation action. A new focus starts a new flow, while state
			// changes during that same focus cannot unlock a route that is leaving.
			allowLeaveRef.current = false;
			// Native focus listeners can run after the render's initialisation
			// effect. Changing only a ref leaves a reopened timer blank forever;
			// publish the new visit so initialisation runs after the guard resets.
			setFocusVisit((visit) => visit + 1);
			setSummaryExitRequested(false);
			setSummaryExitPromptVisible(false);
			setEndPromptVisible(false);
			return () => {
				// Cached routes must not initialise shared state or navigate while a
				// different timer or tab is active.
				allowLeaveRef.current = true;
			};
		}, []),
	);

	useFocusEffect(
		useCallback(() => {
			if (Platform.OS !== "android") return undefined;
			const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
				handleBack();
				return true;
			});
			return () => subscription.remove();
		}, [handleBack]),
	);

	useEffect(() => {
		if (!isFocused || !allowLeaveRef.current || !summaryExitRequested || pendingSummary) return;
		// Wait for the summary guard to be removed before changing routes. This
		// avoids the confirm action being intercepted a second time.
		router.replace("/(tabs)");
	}, [isFocused, pendingSummary, summaryExitRequested]);

	useEffect(() => {
		if (recordMode !== "countdown" || !targetDurationSec) return;
		setCountdownMinutes(String(Math.max(1, Math.round(targetDurationSec / 60))));
	}, [recordMode, started, targetDurationSec]);

	useEffect(() => {
		const unsubscribe = navigation.addListener("beforeRemove", (event) => {
			if (!navigation.isFocused() || allowLeaveRef.current) return;
			event.preventDefault();
			handleBack();
		});
		return unsubscribe;
	}, [handleBack, navigation]);

	const handleStartPause = () => {
		if (recordMode === "countup" && !started) return;
		if (recordMode === "countdown" && (!started || completed)) {
			const minutes = Number(countdownMinutes);
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
				showAlert("", i18n.t("countdownDurationInvalid"));
				return;
			}
			setCountdownDuration(minutes * 60);
			startCountdown(minutes * 60);
			return;
		}
		toggleRunning();
	};

	const handleChooseMode = (nextMode) => {
		if (requestedRecordMode === "countup") return;
		// Hidden tab screens can stay mounted between visits. Reset all local
		// navigation flags whenever a genuinely new session begins.
		allowLeaveRef.current = false;
		setSummaryExitRequested(false);
		setSummaryExitPromptVisible(false);
		setEndPromptVisible(false);
		const minutes = Number(countdownMinutes);
		const countdownSeconds = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes * 60 : 1800;
		chooseMode(nextMode, requestedRecordMode, countdownSeconds);
	};

	useEffect(() => {
		if (!hydrated || !isFocused || !retiredCountupBlocked || allowLeaveRef.current) return;
		// Do not reset a different active timer or destroy a saved-summary draft.
		// This is a one-way exit, so a cached retired page cannot reinitialise it.
		allowLeaveRef.current = true;
		router.replace("/(tabs)");
	}, [focusVisit, hydrated, isFocused, retiredCountupBlocked]);

	useEffect(() => {
		// Native stack transitions can keep the previous timer screen mounted for
		// a short time. Only the focused route may initialise the shared session;
		// otherwise countdown and count-up screens can continuously overwrite each
		// other and cause flashing or a maximum-update-depth crash.
		const action = sessionInitializationAction({
			hydrated,
			isFocused,
			isLeaving: allowLeaveRef.current,
			pendingSummary,
			started,
			completed,
			mode,
			recordMode,
			requestedRecordMode,
		});
		if (action === "reset") resetSession();
		if (action === "choose") handleChooseMode("outdoor");
	}, [completed, focusVisit, hydrated, isFocused, mode, pendingSummary, recordMode, requestedRecordMode, resetSession, started]);

	useEffect(() => {
		// Expiry can arrive while the early-stop confirmation is open. Once the
		// clock has ended that dialog no longer has an active timer to stop.
		if (completed) {
			setEndPromptVisible(false);
			timerScrollRef.current?.scrollTo?.({ y: 0, animated: false });
		}
	}, [completed]);

	const selectCountdownMinutes = (minutes) => {
		const value = String(minutes);
		setCountdownMinutes(value);
		setCountdownDuration(minutes * 60);
	};

	const adjustCountdownMinutes = (difference) => {
		const current = Number(countdownMinutes) || 1;
		selectCountdownMinutes(Math.max(1, Math.min(1440, current + difference)));
	};

	const discardActiveTimerAndSwitch = () => {
		resetSession();
		allowLeaveRef.current = false;
		setSummaryExitRequested(false);
		if (requestedRecordMode !== "manual") {
			const minutes = Number(countdownMinutes);
			chooseMode("outdoor", requestedRecordMode, requestedRecordMode === "countdown" && Number.isInteger(minutes) ? minutes * 60 : 0);
		}
	};

	const handleEnd = () => {
		if (!activeTimer) {
			showAlert("", i18n.t("sessionNotStarted"));
			return;
		}
		setEndPromptVisible(true);
	};

	const confirmEndSession = () => {
		// A Tabs screen may be cached after the previous summary was discarded.
		// Reset those one-use guards before creating the next summary.
		allowLeaveRef.current = false;
		setSummaryExitRequested(false);
		setSummaryExitPromptVisible(false);
		setEndPromptVisible(false);
		finishSession();
	};

	const handleDiscard = () => {
		showAlert("", i18n.t("discardSessionConfirm"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{ text: i18n.t("discardSession"), style: "destructive", onPress: () => {
				allowLeaveRef.current = true;
				resetSession();
				router.replace("/(tabs)");
			} },
		]);
	};

	const returnToActiveTimer = () => {
		allowLeaveRef.current = true;
		router.replace(sessionPathForMode(recordMode));
	};

	// A cached route must not mount another editable copy of the shared summary.
	// Its draft is restored when this route becomes visible again.
	if (!isFocused || !hydrated || retiredCountupBlocked) return <View style={styles.container} />;

	// Summary is a phase of this same screen rather than a second route. This
	// removes the timer/summary race that previously left both native screens
	// visible and allowed an old summary route to reappear later.
	if (conflictingActiveTimer) {
		return (
			<View style={styles.conflictPage}>
				<View style={styles.conflictIcon}><MaterialCommunityIcons name="timer-alert-outline" size={RFValue(42)} color="#840B1C" /></View>
				<Text style={styles.conflictTitle}>{i18n.t("activeTimerConflictTitle")}</Text>
				<Text style={styles.conflictText}>{i18n.t("activeTimerConflictMessage")}</Text>
				<TouchableOpacity style={[styles.conflictButton, styles.primaryButton]} onPress={returnToActiveTimer} accessibilityRole="button">
					<Text style={styles.primaryButtonText}>{i18n.t("returnToActiveTimer")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={[styles.conflictButton, styles.secondaryButton]} onPress={discardActiveTimerAndSwitch} accessibilityRole="button">
					<Text style={styles.secondaryButtonText}>{i18n.t("discardAndSwitchTimer")}</Text>
				</TouchableOpacity>
			</View>
		);
	}
	const inactiveFlowMismatch = !activeTimer && !pendingSummary && (
		(requestedRecordMode === "manual" && Boolean(mode)) ||
		(requestedRecordMode !== "manual" && (!mode || recordMode !== requestedRecordMode))
	);
	if (inactiveFlowMismatch) return <View style={styles.container} />;

	if (pendingSummary) {
		return (
			<>
				<SessionSummary
					key={pendingSummary.id}
					embedded
					embeddedSummaryId={pendingSummary.id}
					onExit={exitSummary}
				/>
				<Modal
					visible={summaryExitPromptVisible}
					transparent
					animationType="fade"
					statusBarTranslucent
					onRequestClose={() => setSummaryExitPromptVisible(false)}
				>
					<View style={styles.confirmOverlay}>
						<View style={styles.confirmCard} accessibilityViewIsModal>
							<Text style={styles.confirmMessage}>{i18n.t("summaryUnsavedExitWarning")}</Text>
							<View style={styles.confirmActions}>
								<TouchableOpacity
									style={[styles.confirmButton, styles.secondaryButton]}
									onPress={exitSummary}
									accessibilityRole="button"
								>
									<Text style={styles.secondaryButtonText}>{i18n.t("exitWithoutSaving")}</Text>
								</TouchableOpacity>
								<TouchableOpacity
									style={[styles.confirmButton, styles.primaryButton]}
									onPress={() => setSummaryExitPromptVisible(false)}
									accessibilityRole="button"
								>
									<Text style={styles.primaryButtonText}>{i18n.t("continueEditingSummary")}</Text>
								</TouchableOpacity>
							</View>
						</View>
					</View>
				</Modal>
			</>
		);
	}

	// Step 1: choose where this session takes place (outdoor / home practical session)
	if (!mode && requestedRecordMode !== "manual") {
		return <View style={styles.container} />;
	}

	if (!mode) {
		return (
			<View style={styles.container}>
				<Text style={styles.modeTitle}>{i18n.t("sessionMode")}</Text>
				<TouchableOpacity style={[styles.modeBtn, { backgroundColor: "#2E8B57" }]} onPress={() => handleChooseMode("outdoor")}>
					<MaterialCommunityIcons name="tree" size={RFValue(36)} color="#fff" />
					<Text style={styles.modeBtnText}>{i18n.t("outdoorSession")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={[styles.modeBtn, { backgroundColor: "#007BFF" }]} onPress={() => handleChooseMode("home")}>
					<Ionicons name="home" size={RFValue(36)} color="#fff" />
					<Text style={styles.modeBtnText}>{i18n.t("homeSession")}</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return (
		<>
		<ScrollView ref={timerScrollRef} style={styles.timerPage} contentContainerStyle={styles.timerContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
			<View style={styles.timerHeading}>
				<View style={styles.timerHeadingIcon}><MaterialCommunityIcons name={recordMode === "countdown" ? "timer-sand" : "timer-outline"} size={RFValue(30)} color="#840B1C" /></View>
				<View style={{ flex: 1 }}>
					<Text style={styles.timerHeadingTitle}>{i18n.t(recordMode === "countdown" ? "countdownTimer" : "countupTimer")}</Text>
					<Text style={styles.timerHeadingHint}>{i18n.t(recordMode === "countdown" ? "countdownTimerHint" : "countupTimerHint")}</Text>
				</View>
			</View>
			{showCountdownSetup ? (
				<View style={styles.countdownSetup}>
					<Text style={styles.countdownTitle}>{i18n.t("countdownDuration")}</Text>
					<Text style={styles.countdownHint}>{i18n.t("countdownPresetHint")}</Text>
					<View style={styles.presetRow}>
						{[5, 10, 15, 30, 45, 60].map((minutes) => (
							<TouchableOpacity
								key={minutes}
								style={[styles.presetButton, countdownMinutes === String(minutes) && styles.presetButtonActive]}
								onPress={() => selectCountdownMinutes(minutes)}
							>
								<Text style={[styles.presetText, countdownMinutes === String(minutes) && styles.presetTextActive]}>{minutes}</Text>
								<Text style={[styles.presetUnit, countdownMinutes === String(minutes) && styles.presetTextActive]}>{i18n.t("minutes")}</Text>
							</TouchableOpacity>
						))}
					</View>
					<View style={styles.minutesInputRow}>
						<TouchableOpacity style={styles.minuteAdjustButton} onPress={() => adjustCountdownMinutes(-1)} accessibilityRole="button" accessibilityLabel={i18n.t("decreaseMinutes")}>
							<Ionicons name="remove" size={RFValue(26)} color="#840B1C" />
						</TouchableOpacity>
						<TextInput
							style={styles.minutesInput}
							value={countdownMinutes}
							onChangeText={(value) => setCountdownMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))}
							keyboardType="number-pad"
							placeholder="30"
							accessibilityLabel={i18n.t("countdownDuration")}
						/>
						<Text style={styles.minutesUnit}>{i18n.t("minutes")}</Text>
						<TouchableOpacity style={styles.minuteAdjustButton} onPress={() => adjustCountdownMinutes(1)} accessibilityRole="button" accessibilityLabel={i18n.t("increaseMinutes")}>
							<Ionicons name="add" size={RFValue(26)} color="#840B1C" />
						</TouchableOpacity>
					</View>
				</View>
			) : null}

			<View style={[styles.timerCard, running && styles.timerCardRunning]}>
				<Text style={styles.timerStatus}>{i18n.t(showCountdownSetup || !started ? "timerReady" : running ? "timerRunning" : "timerPaused")}</Text>
				<Text style={styles.timer}>{formatDuration(showCountdownSetup ? Math.max(0, Number(countdownMinutes) || 0) * 60 : seconds)}</Text>
			</View>

			<TouchableOpacity style={[styles.mainBtn, running ? styles.pauseBtn : styles.startBtn]} onPress={handleStartPause}>
				<Ionicons name={running ? "pause" : "play"} size={RFValue(30)} color="#fff" />
				<Text style={styles.mainBtnText}>{showCountdownSetup ? i18n.t("start") : running ? i18n.t("pause") : started ? i18n.t("resume") : i18n.t("start")}</Text>
			</TouchableOpacity>

			{activeTimer && <TouchableOpacity style={[styles.mainBtn, styles.endBtn]} onPress={handleEnd}>
				<Ionicons name="stop" size={RFValue(30)} color="#fff" />
				<Text style={styles.mainBtnText}>{i18n.t(recordMode === "countdown" ? "stopCountdown" : "endSession")}</Text>
			</TouchableOpacity>}

			<TouchableOpacity onPress={handleDiscard}>
				<Text style={styles.discardText}>{i18n.t("discardSession")}</Text>
			</TouchableOpacity>
		</ScrollView>
		<Modal
			visible={endPromptVisible}
			transparent
			animationType="fade"
			statusBarTranslucent
			onRequestClose={() => setEndPromptVisible(false)}
		>
			<View style={styles.confirmOverlay}>
				<View style={styles.confirmCard} accessibilityViewIsModal>
					<Text style={styles.confirmMessage}>{i18n.t(recordMode === "countdown" ? "stopCountdownConfirm" : "endSessionConfirm")}</Text>
					<View style={styles.confirmActions}>
						<TouchableOpacity
							style={[styles.confirmButton, styles.secondaryButton]}
							onPress={() => setEndPromptVisible(false)}
							accessibilityRole="button"
						>
							<Text style={styles.secondaryButtonText}>{i18n.t("cancel")}</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={[styles.confirmButton, styles.primaryButton]}
							onPress={confirmEndSession}
							accessibilityRole="button"
						>
							<Text style={styles.primaryButtonText}>{i18n.t(recordMode === "countdown" ? "stopCountdown" : "endSession")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		</Modal>
		</>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: wp("10%"),
	},
	timerPage: { flex: 1, backgroundColor: "#F7F3EF" },
	timerContent: { flexGrow: 1, alignItems: "center", paddingHorizontal: wp("6%"), paddingTop: hp("2.5%"), paddingBottom: hp("6%") },
	timerHeading: { width: "100%", maxWidth: 460, flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 18 },
	timerHeadingIcon: { width: RFValue(56), height: RFValue(56), borderRadius: RFValue(28), backgroundColor: "#F4E1E5", alignItems: "center", justifyContent: "center" },
	timerHeadingTitle: { fontSize: RFValue(20), lineHeight: RFValue(27), fontWeight: "900", color: "#242424" },
	timerHeadingHint: { marginTop: 3, fontSize: RFValue(11), lineHeight: RFValue(17), color: "#666" },
	conflictPage: { flex: 1, backgroundColor: "#F7F3EF", alignItems: "center", justifyContent: "center", paddingHorizontal: wp("8%") },
	conflictIcon: { width: RFValue(82), height: RFValue(82), borderRadius: RFValue(41), backgroundColor: "#F4E1E5", alignItems: "center", justifyContent: "center", marginBottom: 18 },
	conflictTitle: { fontSize: RFValue(20), fontWeight: "900", color: "#222", textAlign: "center" },
	conflictText: { fontSize: RFValue(13), lineHeight: RFValue(21), color: "#666", textAlign: "center", marginTop: 10, marginBottom: 22 },
	conflictButton: { width: "100%", maxWidth: 420, minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 11, paddingHorizontal: 14 },
	modeTitle: {
		fontSize: RFValue(20),
		fontWeight: "bold",
		color: "#333",
		marginBottom: hp("4%"),
	},
	modeBtn: {
		width: "100%",
		borderRadius: 16,
		paddingVertical: hp("4%"),
		alignItems: "center",
		marginBottom: hp("2.5%"),
	},
	modeBtnText: {
		color: "#fff",
		fontSize: RFValue(18),
		fontWeight: "bold",
		marginTop: 8,
	},
	modeTag: {
		fontSize: RFValue(16),
		color: "#666",
		fontWeight: "600",
		marginBottom: hp("2%"),
	},
	timer: {
		fontSize: RFValue(58),
		lineHeight: RFValue(70),
		fontWeight: "900",
		color: "#202020",
		fontVariant: ["tabular-nums"],
	},
	timerCard: { width: RFValue(260), minHeight: RFValue(148), borderRadius: RFValue(74), borderWidth: RFValue(10), borderColor: "#E9CDD3", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", marginTop: 20, marginBottom: 24, shadowColor: "#6A0012", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
	timerCardRunning: { borderColor: "#840B1C" },
	timerStatus: { fontSize: RFValue(11), fontWeight: "800", color: "#840B1C", letterSpacing: 0.4 },
	mainBtn: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		width: "100%",
		maxWidth: 430,
		minHeight: RFValue(58),
		borderRadius: 29,
		paddingVertical: 12,
		marginBottom: 13,
		gap: 10,
	},
	startBtn: {
		backgroundColor: "#840B1C",
	},
	pauseBtn: {
		backgroundColor: "#E9A23B",
	},
	endBtn: {
		backgroundColor: "#B00020",
	},
	mainBtnText: {
		color: "#fff",
		fontSize: RFValue(20),
		fontWeight: "bold",
		marginLeft: 8,
	},
	discardText: {
		marginTop: 8,
		color: "#999",
		fontSize: RFValue(14),
		textDecorationLine: "underline",
	},
	countdownSetup: {
		width: "100%",
		maxWidth: 460,
		alignItems: "center",
		backgroundColor: "#FFFFFF",
		borderRadius: 18,
		borderWidth: 1,
		borderColor: "#E9E0D8",
		padding: 16,
	},
	countdownTitle: {
		fontSize: RFValue(16),
		fontWeight: "700",
		color: "#333",
		marginBottom: 4,
	},
	countdownHint: { fontSize: RFValue(11), lineHeight: RFValue(17), color: "#707070", textAlign: "center", marginBottom: 13 },
	presetRow: {
		width: "100%",
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
		rowGap: 9,
	},
	presetButton: {
		width: "31.5%",
		minHeight: RFValue(58),
		paddingHorizontal: 10,
		borderRadius: 13,
		borderWidth: 1,
		borderColor: "#C8C8C8",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
	},
	presetButtonActive: {
		backgroundColor: "#840B1C",
		borderColor: "#840B1C",
	},
	presetText: { color: "#333", fontSize: RFValue(18), lineHeight: RFValue(22), fontWeight: "900" },
	presetUnit: { color: "#777", fontSize: RFValue(9), fontWeight: "700", marginTop: 1 },
	presetTextActive: { color: "#FFFFFF" },
	minutesInputRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 9,
		width: "100%",
		marginTop: 14,
	},
	minuteAdjustButton: { width: RFValue(48), height: RFValue(48), borderRadius: RFValue(24), borderWidth: 1, borderColor: "#D9B8BF", backgroundColor: "#F8ECEF", alignItems: "center", justifyContent: "center" },
	minutesInput: {
		width: RFValue(96),
		minHeight: RFValue(48),
		borderWidth: 1,
		borderColor: "#A8A8A8",
		borderRadius: 12,
		paddingHorizontal: 12,
		fontSize: RFValue(18),
		fontWeight: "700",
		textAlign: "center",
		color: "#222",
		backgroundColor: "#FFFFFF",
	},
	minutesUnit: { color: "#555", fontSize: RFValue(12), fontWeight: "700" },
	confirmOverlay: {
		flex: 1,
		backgroundColor: "rgba(0,0,0,0.48)",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: wp("8%"),
	},
	confirmCard: {
		width: "100%",
		maxWidth: 460,
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		paddingHorizontal: 22,
		paddingTop: 24,
		paddingBottom: 18,
	},
	confirmMessage: {
		fontSize: RFValue(16),
		lineHeight: RFValue(24),
		fontWeight: "600",
		color: "#222222",
		textAlign: "center",
		marginBottom: 22,
	},
	confirmActions: {
		flexDirection: "row",
		gap: 12,
	},
	confirmButton: {
		flex: 1,
		minHeight: 48,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 10,
	},
	secondaryButton: {
		backgroundColor: "#F1F1F1",
	},
	primaryButton: {
		backgroundColor: "#9D001B",
	},
	secondaryButtonText: {
		fontSize: RFValue(13),
		fontWeight: "700",
		color: "#333333",
		textAlign: "center",
	},
	primaryButtonText: {
		fontSize: RFValue(13),
		fontWeight: "700",
		color: "#FFFFFF",
		textAlign: "center",
	},
});

export default SessionRecord;
