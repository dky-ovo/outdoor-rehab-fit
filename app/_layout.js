import AssistantJobSync from "../components/AssistantJobSync";
import AccountDataSync from '../components/AccountDataSync';
import BookmarkSync from "../components/BookmarkSync";
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useContext, useEffect } from "react";
import { View } from "react-native";
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

// Captures touches for usage activity; idle time no longer signs users out.
function ActivityTracker({ children }) {
	const { recordActivity } = useContext(AuthContext);
	return <ResearchInteractionTracker>{(trackResearchTap) => (
		<View
			style={{ flex: 1 }}
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
	const [loaded, fontError] = useFonts({
		SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
	});
	const ready = loaded || !!fontError;

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
					</ActivityTracker>
					<AppUpdateOverlay />
					<FloatingSessionTimer />
					<AppAlertHost />
					<CountdownNotificationObserver />
					<LearningProgressSync />
					<AssistantJobSync />
					<AccountDataSync />
					<BookmarkSync />
					<EquipmentOfflineSync />
					<StatusBar style="dark" backgroundColor="#FFFFFF" />
				</ThemeProvider>
				</ActiveSessionProvider>
			</AuthProvider>
		</LocaleProvider>
	);
}
