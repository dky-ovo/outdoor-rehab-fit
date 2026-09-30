import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform, Vibration } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { AuthContext } from "./AuthContext";
import { getChatNotifications, registerPushToken } from "../utils/api";
import { notificationPresentation } from "../utils/notificationPresentation";

export const ChatNotificationContext = createContext({ unreadCount: 0, refreshUnread: async () => {} });

if (Platform.OS !== "web") {
	Notifications.setNotificationHandler({
		handleNotification: async (notification) => notificationPresentation(notification, AppState.currentState),
	});
}

export function ChatNotificationProvider({ children }) {
	const { user } = useContext(AuthContext);
	const [unreadCount, setUnreadCount] = useState(0);
	const previousCount = useRef(0);
	const initialized = useRef(false);
	const openingNotification = useRef(false);

	const openChatNotification = useCallback(async (response) => {
		if (response?.notification?.request?.content?.data?.type !== "chat" || openingNotification.current) return;
		openingNotification.current = true;
		try {
			router.push("/chat");
			await Notifications.clearLastNotificationResponseAsync();
		} finally {
			setTimeout(() => { openingNotification.current = false; }, 600);
		}
	}, []);

	const refreshUnread = useCallback(async () => {
		if (!user?.token) { setUnreadCount(0); previousCount.current = 0; return 0; }
		try {
			const result = await getChatNotifications(user.token);
			const next = Number(result.unreadCount ?? result.notifications?.length ?? 0);
			if (initialized.current && next > previousCount.current && AppState.currentState === "active" && Platform.OS !== "web") {
				Vibration.vibrate([0, 250, 120, 250]);
			}
			initialized.current = true;
			previousCount.current = next;
			setUnreadCount(next);
			if (Platform.OS !== "web") Notifications.setBadgeCountAsync(next).catch(() => {});
			return next;
		} catch { return previousCount.current; }
	}, [user?.token]);

	useEffect(() => {
		if (!user?.token) { initialized.current = false; setUnreadCount(0); return undefined; }
		refreshUnread();
		const timer = setInterval(refreshUnread, 5000);
		const appStateSubscription = AppState.addEventListener("change", (state) => {
			if (state === "active") refreshUnread();
		});
		return () => { clearInterval(timer); appStateSubscription.remove(); };
	}, [user?.token, refreshUnread]);

	useEffect(() => {
		if (!user?.token || Platform.OS === "web" || !Device.isDevice) return undefined;
		let active = true;
		let tokenSubscription;
		(async () => {
			if (Platform.OS === "android") {
				await Notifications.setNotificationChannelAsync("chat-messages", {
					name: "聊天消息",
					description: "在桌面横幅和通知栏显示新的聊天消息",
					importance: Notifications.AndroidImportance.MAX,
					sound: "default",
					enableVibrate: true,
					vibrationPattern: [0, 250, 120, 250],
					showBadge: true,
					lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
				});
			}
			let permission = await Notifications.getPermissionsAsync();
			if (permission.status !== "granted") {
				permission = await Notifications.requestPermissionsAsync({
					ios: { allowAlert: true, allowBadge: true, allowSound: true },
				});
			}
			if (permission.status !== "granted" || !active) return;
			const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
			const registerCurrentToken = async () => {
				const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
				if (active) await registerPushToken(user.token, pushToken, Platform.OS);
			};
			await registerCurrentToken();
			if (!active) return;
			tokenSubscription = Notifications.addPushTokenListener(() => {
				registerCurrentToken().catch((error) => console.warn("Push token refresh failed", error));
			});
			const lastResponse = await Notifications.getLastNotificationResponseAsync();
			if (active && lastResponse) await openChatNotification(lastResponse);
		})().catch((error) => console.warn("Push registration failed", error));
		const received = Notifications.addNotificationReceivedListener(refreshUnread);
		const opened = Notifications.addNotificationResponseReceivedListener(async (response) => {
			await openChatNotification(response);
			refreshUnread();
		});
		return () => { active = false; tokenSubscription?.remove(); received.remove(); opened.remove(); };
	}, [user?.token, refreshUnread, openChatNotification]);

	return <ChatNotificationContext.Provider value={{ unreadCount, refreshUnread }}>{children}</ChatNotificationContext.Provider>;
}

export const useChatNotifications = () => useContext(ChatNotificationContext);
