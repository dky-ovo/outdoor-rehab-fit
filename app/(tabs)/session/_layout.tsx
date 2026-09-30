import React, { useContext } from "react";
import { Stack } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";

export const unstable_settings = {
	initialRouteName: "index",
};

export default function SessionLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={{ contentStyle: { backgroundColor: "#FFFFFF" } }}>
			<Stack.Screen name="index" options={{ headerShown: true, title: i18n.t("sessionRecord"), headerLeft: () => null, animation: "none" }} />
			<Stack.Screen name="countdown" options={{ headerShown: true, title: i18n.t("countdownTimer"), headerLeft: () => null, animation: "none" }} />
			<Stack.Screen name="countup" options={{ headerShown: true, title: i18n.t("countupTimer"), headerLeft: () => null, animation: "none" }} />
			<Stack.Screen name="manual" options={{ headerShown: true, title: i18n.t("manualSessionRecord"), headerLeft: () => null, animation: "none" }} />
			<Stack.Screen name="summary" options={{ headerShown: true, title: i18n.t("sessionSummary"), headerLeft: () => null, headerBackVisible: false, gestureEnabled: false, animation: "none" }} />
		</Stack>
	);
}
