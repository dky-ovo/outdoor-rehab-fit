import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router, usePathname, useSegments } from "expo-router";
import { useActiveSession } from "../contexts/ActiveSessionContext";
import { sessionTimerNotificationRoute, notificationPresentation } from "../utils/notificationPresentation";

if (Platform.OS !== "web") {
	Notifications.setNotificationHandler({
		handleNotification: async (notification) => notificationPresentation(notification, AppState.currentState),
	});
}

export default function CountdownNotificationObserver() {
	const active = useActiveSession();
	const pathname = usePathname();
	const segments = useSegments();
	// Let startup authentication/onboarding finish before opening a timer. Otherwise
	// its pending Home redirect can replace the notification's destination.
	const ready = active.hydrated && segments[0] === "(tabs)";
	const latest = useRef(null);
	latest.current = { active, pathname };
	const handled = useRef(new Set());

	useEffect(() => {
		if (Platform.OS === "web" || !ready) return undefined;
		let mounted = true;
		const open = async (response) => {
			const data = response?.notification?.request?.content?.data;
			const identifier = response?.notification?.request?.identifier;
			if (!mounted || !["countdown", "session-timer"].includes(data?.type) || !identifier) return;
			const responseKey = `${identifier}:${data.timerId}`;
			// Status notifications deliberately reuse one OS identifier. A different
			// timer, or a later user tap, must still be able to reopen the timer.
			if (data.type === "countdown" && handled.current.has(responseKey)) return;
			handled.current.add(responseKey);
			// Never restore an abandoned timer or a timer belonging to another login.
			const target = sessionTimerNotificationRoute(data, latest.current.active);
			if (target) {
				const currentPath = String(latest.current.pathname || "").replace(/^\/\(tabs\)/, "");
				if (currentPath !== target) router.navigate(target);
			}
			await Notifications.clearLastNotificationResponseAsync().catch(() => {});
		};
		const subscription = Notifications.addNotificationResponseReceivedListener((response) => { void open(response); });
		Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
		return () => { mounted = false; subscription.remove(); };
	}, [ready]);
	return null;
}
