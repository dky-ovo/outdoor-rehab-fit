import AssistantJobSync from "../components/AssistantJobSync";
import AccountDataSync from '../components/AccountDataSync';
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useContext, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import "react-native-reanimated";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { AuthProvider, AuthContext } from "@/contexts/AuthContext";
import { ensurePlaybackAudioMode } from "@/utils/audioMode";
import ResearchInteractionTracker from "@/components/ResearchInteractionTracker";
import AppUpdateOverlay from "@/components/AppUpdateOverlay";
import { ActiveSessionProvider } from "@/contexts/ActiveSessionContext";
import FloatingSessionTimer from "@/components/FloatingSessionTimer";
import AppAlertHost from "@/components/AppAlertHost";
import CountdownNotificationObserver from "@/components/CountdownNotificationObserver";
import LearningProgressSync from "@/components/LearningProgressSync";
import EquipmentOfflineSync from "@/components/EquipmentOfflineSync";
import { APP_ICON_FONTS } from "@/utils/appIconFonts";

// Only direct interaction renews the 90-minute idle window. Network responses,
// animation, timer ticks and programmatic scrolling must not keep a login alive.
function ActivityTracker({ children }) {
	const { recordActivity } = useContext(AuthContext);
	useEffect(() => {
		if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
		const activity = event => {
			if (!event.isTrusted || document.visibilityState === "hidden") return;
			if (event.type === "pointermove" && !event.buttons) return;
			recordActivity();
		};
		const events = ["pointerdown", "pointermove", "keydown", "input", "wheel"];
		for (const name of events) document.addEventListener(name, activity, { capture: true, passive: true });
		return () => { for (const name of events) document.removeEventListener(name, activity, true); };
	}, [recordActivity]);
	return <ResearchInteractionTracker>{(trackResearchTap) => (
		<View
			style={{ flex: 1 }}
			{...(Platform.OS === "web" ? {} : {
				// TextInput events bubble through native views, including software
				// keyboard editing while no new touch reaches the app's content area.
				onChangeCapture: recordActivity,
				onKeyPressCapture: recordActivity,
				onTouchMoveCapture: recordActivity,
			})}
			onStartShouldSetResponderCapture={(event) => {
				recordActivity();
				return trackResearchTap(event);
			}}
		>
			{children}
		</View>
	)}</ResearchInteractionTracker>;
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
// Optional platform setup must not reject outside the startup boundary. A missing
// native service can throw synchronously as well as reject its returned promise.
function runStartupTask(label, task) {
	try { Promise.resolve(task()).catch((error) => console.warn(label, error)); }
	catch (error) { console.warn(label, error); }
}
runStartupTask("Unable to hold splash screen", () => SplashScreen.preventAutoHideAsync());

export default function RootLayout() {
	// Register the actual icon families before native screens mount. Otherwise
	// each icon starts loading its font only after the first screen is visible.
	// Web has its own non-blocking font readiness/fallback implementation.
	const web = Platform.OS === "web";
	const [iconsLoaded, iconError] = useFonts(web ? {} : APP_ICON_FONTS);
	const [, fontError] = useFonts(web ? {} : {
		SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
	});
	const [fontWaitExpired, setFontWaitExpired] = useState(false);
	const ready = web || iconsLoaded || !!iconError || fontWaitExpired;
	useEffect(() => {
		if (web || iconsLoaded || iconError) return;
		// A missing asset or stalled font service must never trap the user on
		// the splash. Expo's native icon component stays empty until loaded;
		// let late fonts finish without remounting screens or hiding them again.
		const timer = setTimeout(() => setFontWaitExpired(true), 1500);
		return () => clearTimeout(timer);
	}, [web, iconsLoaded, iconError]);

	useEffect(() => {
		runStartupTask("Unable to set system background", () => SystemUI.setBackgroundColorAsync("#FFFFFF"));
		if (ready) {
			runStartupTask("Unable to hide splash screen", () => SplashScreen.hideAsync());
			runStartupTask("Unable to initialize playback mode", () => ensurePlaybackAudioMode());
		}
	}, [ready]);
	useEffect(() => {
		if (fontError) console.warn("Unable to load optional display font; using system fallback", fontError);
	}, [fontError]);
	useEffect(() => {
		if (iconError) console.warn("Unable to preload icon fonts; continuing startup", iconError);
	}, [iconError]);

	if (!ready) {
		return null;
	}

	return (
		<LocaleProvider>
			<AuthProvider>
				<ActiveSessionProvider>
				<ThemeProvider value={DefaultTheme}>
					<ActivityTracker>
						<Stack>
							<Stack.Screen name="index" options={{ headerShown: false, headerTitle: "Home" }} />
							<Stack.Screen name="timer-notification" options={{ headerShown: false, gestureEnabled: false }} />
							{/* gestureEnabled: false prevents the iOS swipe-back gesture from
							    returning to the onboarding / Start screens */}
							<Stack.Screen name="(tabs)" options={{ headerShown: false, headerTitle: "Home", gestureEnabled: false }} />
							<Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
							<Stack.Screen name="register" options={{ headerShown: false }} />
							<Stack.Screen name="forgot-password" options={{ headerShown: false }} />
							<Stack.Screen name="admin" options={{ headerShown: false }} />
							<Stack.Screen name="firstdisclaimer" options={{ headerShown: false, gestureEnabled: false }} />
							<Stack.Screen name="firstsafety" options={{ headerShown: false, gestureEnabled: false }} />
							<Stack.Screen name="firstquestionnaire" options={{ title: "PAR-Q", gestureEnabled: false, headerBackVisible: false }} />
							<Stack.Screen name="+not-found" />
						</Stack>
					<AppUpdateOverlay />
					<FloatingSessionTimer />
					<AppAlertHost />
					<CountdownNotificationObserver />
					<LearningProgressSync />
					<AssistantJobSync />
					<AccountDataSync />
					<EquipmentOfflineSync />
					<StatusBar style="dark" backgroundColor="#FFFFFF" />
					</ActivityTracker>
				</ThemeProvider>
				</ActiveSessionProvider>
			</AuthProvider>
		</LocaleProvider>
	);
}
