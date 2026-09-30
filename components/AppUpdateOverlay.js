import { Ionicons } from "@expo/vector-icons";
import * as Updates from "expo-updates";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	AppState,
	Easing,
	Modal,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
} from "react-native";

import { LocaleContext } from "@/contexts/LocaleContext";
import { appText } from "../utils/appText";

const BACKGROUND_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const copy = locale => ({
	downloadingTitle: appText(locale, "inline.appUpdate.downloadingTitle", { zh: "正在更新應用程式", en: "Updating the app" }),
	downloadingBody: appText(locale, "inline.appUpdate.downloadingBody", { zh: "正在下載最新內容，請保持網絡連線並暫時不要關閉應用程式。", en: "Downloading the latest content. Keep the app open and stay connected." }),
	readyTitle: appText(locale, "inline.appUpdate.readyTitle", { zh: "更新完成", en: "Update complete" }),
	readyBody: appText(locale, "inline.appUpdate.readyBody", { zh: "最新內容已準備好。重新啟動應用程式後即可使用新版本。", en: "The latest content is ready. Restart the app to use the new version." }),
	restartingTitle: appText(locale, "inline.appUpdate.restartingTitle", { zh: "正在重新啟動…", en: "Restarting…" }),
	restartingBody: appText(locale, "inline.appUpdate.restartingBody", { zh: "正在套用新版本，請稍候。", en: "Applying the new version. Please wait." }),
	errorTitle: appText(locale, "inline.appUpdate.errorTitle", { zh: "更新未完成", en: "Update not completed" }),
	errorBody: appText(locale, "inline.appUpdate.errorBody", { zh: "暫時無法下載更新，請檢查網絡後再試。", en: "The update could not be downloaded. Check your connection and try again." }),
	restart: appText(locale, "inline.appUpdate.restart", { zh: "重新啟動應用程式", en: "Restart app" }),
	later: appText(locale, "inline.appUpdate.later", { zh: "稍後", en: "Later" }),
	retry: appText(locale, "inline.appUpdate.retry", { zh: "重新嘗試", en: "Try again" }),
	progress: appText(locale, "inline.appUpdate.progress", { zh: "已下載", en: "Downloaded" }),
});

/**
 * Displays a release-build-only update experience on top of every screen.
 * Checks are silent. The overlay opens only after a new update starts downloading,
 * or when a downloaded update is waiting for the user to restart the app.
 */
export default function AppUpdateOverlay() {
	const { locale } = useContext(LocaleContext);
	const labels = copy(locale);
	const updateState = Updates.useUpdates();
	const [manualPhase, setManualPhase] = useState("idle");
	const [dismissedReady, setDismissedReady] = useState(false);
	const checkingRef = useRef(false);
	const forceCheckRef = useRef(false);
	const lastCheckRef = useRef(0);
	const appStateRef = useRef(AppState.currentState);
	const rotation = useRef(new Animated.Value(0)).current;
	const readyScale = useRef(new Animated.Value(0.65)).current;

	const canUseUpdates = Platform.OS !== "web" && !__DEV__ && Updates.isEnabled;

	const runUpdateCheck = useCallback(async () => {
		const lastNativeCheck = updateState.lastCheckForUpdateTimeSinceRestart?.getTime?.() || 0;
		const checkedRecently =
			Date.now() - Math.max(lastCheckRef.current, lastNativeCheck) < 60 * 1000;
		if (
			!canUseUpdates ||
			checkingRef.current ||
			updateState.isChecking ||
			updateState.isDownloading ||
			updateState.isUpdatePending ||
			manualPhase !== "idle" ||
			(checkedRecently && !forceCheckRef.current)
		) {
			return;
		}

		forceCheckRef.current = false;
		checkingRef.current = true;
		lastCheckRef.current = Date.now();
		let updateStarted = false;
		try {
			const result = await Updates.checkForUpdateAsync();
			if (!result.isAvailable) return;

			updateStarted = true;
			setDismissedReady(false);
			setManualPhase("downloading");
			await Updates.fetchUpdateAsync();
			setManualPhase("ready");
		} catch (error) {
			console.warn("App update check/download failed", error);
			if (updateStarted) setManualPhase("error");
		} finally {
			checkingRef.current = false;
		}
	}, [
		canUseUpdates,
		manualPhase,
		updateState.isChecking,
		updateState.isDownloading,
		updateState.isUpdatePending,
		updateState.lastCheckForUpdateTimeSinceRestart,
	]);

	useEffect(() => {
		runUpdateCheck();
	}, [runUpdateCheck]);

	useEffect(() => {
		if (!canUseUpdates) return undefined;

		const subscription = AppState.addEventListener("change", (nextState) => {
			const returnedToForeground =
				(appStateRef.current === "inactive" || appStateRef.current === "background") && nextState === "active";
			appStateRef.current = nextState;

			if (
				returnedToForeground &&
				Date.now() - lastCheckRef.current >= 60 * 1000
			) {
				runUpdateCheck();
			}
		});

		const timer = setInterval(() => {
			if (AppState.currentState === "active") runUpdateCheck();
		}, BACKGROUND_CHECK_INTERVAL_MS);

		return () => {
			subscription.remove();
			clearInterval(timer);
		};
	}, [canUseUpdates, runUpdateCheck]);

	useEffect(() => {
		if (updateState.isDownloading) {
			setDismissedReady(false);
			setManualPhase("downloading");
		} else if (updateState.isUpdatePending) {
			setManualPhase("ready");
		}
	}, [updateState.isDownloading, updateState.isUpdatePending]);

	const phase = useMemo(() => {
		if (manualPhase === "restarting") return "restarting";
		if (manualPhase === "error") return "error";
		if ((manualPhase === "ready" || updateState.isUpdatePending) && !dismissedReady) return "ready";
		if (manualPhase === "downloading" || updateState.isDownloading) return "downloading";
		return "idle";
	}, [dismissedReady, manualPhase, updateState.isDownloading, updateState.isUpdatePending]);

	useEffect(() => {
		if (phase === "downloading" || phase === "restarting") {
			const animation = Animated.loop(
				Animated.timing(rotation, {
					toValue: 1,
					duration: 1100,
					easing: Easing.linear,
					useNativeDriver: true,
				}),
			);
			animation.start();
			return () => {
				animation.stop();
				rotation.setValue(0);
			};
		}

		if (phase === "ready") {
			readyScale.setValue(0.65);
			Animated.spring(readyScale, {
				toValue: 1,
				friction: 5,
				tension: 95,
				useNativeDriver: true,
			}).start();
		}

		return undefined;
	}, [phase, readyScale, rotation]);

	const restartApp = async () => {
		setManualPhase("restarting");
		try {
			await Updates.reloadAsync();
		} catch (error) {
			console.warn("App update restart failed", error);
			setManualPhase("error");
		}
	};

	const retryUpdate = () => {
		forceCheckRef.current = true;
		setManualPhase("idle");
		lastCheckRef.current = 0;
	};

	if (!canUseUpdates || phase === "idle") return null;

	const isBusy = phase === "downloading" || phase === "restarting";
	const progress = Math.max(0, Math.min(1, updateState.downloadProgress || 0));
	const progressPercent = Math.round(progress * 100);
	const title = labels[`${phase}Title`];
	const body = labels[`${phase}Body`];
	const spin = rotation.interpolate({
		inputRange: [0, 1],
		outputRange: ["0deg", "360deg"],
	});

	return (
		<Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
			<View style={styles.backdrop} accessibilityViewIsModal>
				<View style={styles.card}>
					<View style={styles.brandRow}>
						<View style={styles.brandMark}>
							<Ionicons name="leaf" size={18} color="#FFFFFF" />
						</View>
						<Text style={styles.brand}>OUTDOOR-FIT</Text>
					</View>

					<View style={styles.visualWrap}>
						{isBusy ? (
							<Animated.View style={[styles.spinnerRing, { transform: [{ rotate: spin }] }]}> 
								<View style={styles.spinnerGap} />
							</Animated.View>
						) : (
							<Animated.View
								style={[
									styles.statusCircle,
									phase === "error" && styles.errorCircle,
									{ transform: [{ scale: readyScale }] },
								]}
							>
								<Ionicons
									name={phase === "error" ? "cloud-offline-outline" : "checkmark"}
									size={44}
									color="#FFFFFF"
								/>
							</Animated.View>
						)}
					</View>

					<Text style={styles.title}>{title}</Text>
					<Text style={styles.body}>{body}</Text>

					{phase === "downloading" && (
						<View style={styles.progressSection}>
							<View style={styles.progressTrack}>
								<View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
							</View>
							<Text style={styles.progressText}>
								{labels.progress} {progressPercent}%
							</Text>
						</View>
					)}

					{phase === "ready" && (
						<View style={styles.actions}>
							<Pressable
								accessibilityRole="button"
								style={({ pressed }) => [
									styles.primaryButton,
									styles.readyPrimaryButton,
									pressed && styles.buttonPressed,
								]}
								onPress={restartApp}
							>
								<Ionicons name="refresh" size={20} color="#FFFFFF" />
								<Text style={styles.primaryButtonText}>{labels.restart}</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
								onPress={() => setDismissedReady(true)}
							>
								<Text style={styles.secondaryButtonText}>{labels.later}</Text>
							</Pressable>
						</View>
					)}

					{phase === "error" && (
						<Pressable
							accessibilityRole="button"
							style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
							onPress={retryUpdate}
						>
							<Text style={styles.primaryButtonText}>{labels.retry}</Text>
						</Pressable>
					)}
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		backgroundColor: "rgba(13, 18, 16, 0.72)",
	},
	card: {
		width: "100%",
		maxWidth: 420,
		paddingHorizontal: 26,
		paddingTop: 22,
		paddingBottom: 24,
		borderRadius: 28,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000000",
		shadowOpacity: 0.2,
		shadowRadius: 24,
		shadowOffset: { width: 0, height: 12 },
		elevation: 14,
	},
	brandRow: {
		flexDirection: "row",
		alignItems: "center",
	},
	brandMark: {
		width: 32,
		height: 32,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#9D001B",
	},
	brand: {
		marginLeft: 10,
		color: "#222222",
		fontSize: 15,
		fontWeight: "800",
		letterSpacing: 0.6,
	},
	visualWrap: {
		height: 120,
		alignItems: "center",
		justifyContent: "center",
	},
	spinnerRing: {
		width: 78,
		height: 78,
		borderWidth: 8,
		borderColor: "#E9D6DA",
		borderTopColor: "#9D001B",
		borderRightColor: "#9D001B",
		borderRadius: 39,
	},
	spinnerGap: {
		position: "absolute",
		width: 18,
		height: 10,
		top: -9,
		left: 6,
		backgroundColor: "#FFFFFF",
	},
	statusCircle: {
		width: 78,
		height: 78,
		borderRadius: 39,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#268D57",
	},
	errorCircle: {
		backgroundColor: "#B04A3A",
	},
	title: {
		color: "#1E1E1E",
		fontSize: 24,
		fontWeight: "800",
		textAlign: "center",
	},
	body: {
		marginTop: 10,
		color: "#626262",
		fontSize: 16,
		lineHeight: 24,
		textAlign: "center",
	},
	progressSection: {
		marginTop: 24,
	},
	progressTrack: {
		height: 10,
		overflow: "hidden",
		borderRadius: 5,
		backgroundColor: "#F0E7E9",
	},
	progressFill: {
		height: "100%",
		borderRadius: 5,
		backgroundColor: "#9D001B",
	},
	progressText: {
		marginTop: 8,
		color: "#777777",
		fontSize: 13,
		fontWeight: "600",
		textAlign: "right",
	},
	actions: {
		marginTop: 24,
		gap: 10,
	},
	primaryButton: {
		minHeight: 52,
		marginTop: 24,
		borderRadius: 16,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		backgroundColor: "#9D001B",
	},
	readyPrimaryButton: {
		marginTop: 0,
	},
	primaryButtonText: {
		color: "#FFFFFF",
		fontSize: 17,
		fontWeight: "800",
	},
	secondaryButton: {
		minHeight: 46,
		alignItems: "center",
		justifyContent: "center",
	},
	secondaryButtonText: {
		color: "#6A6A6A",
		fontSize: 15,
		fontWeight: "700",
	},
	buttonPressed: {
		opacity: 0.72,
	},
});
