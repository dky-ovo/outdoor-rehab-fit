import React, { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useActiveSession } from "../contexts/ActiveSessionContext";
import { sessionTimerNotificationRoute } from "../utils/notificationPresentation";

// Native Android notifications enter through this guard, never directly into a
// session page. Stale notices therefore cannot initialise a new/other timer.
export default function TimerNotificationRoute() {
	const active = useActiveSession();
	const { timerId, recordMode } = useLocalSearchParams();
	const handled = useRef(null);
	useEffect(() => {
		if (!active.hydrated) return;
		const key = JSON.stringify([timerId, recordMode]);
		if (handled.current === key) return;
		handled.current = key;
		const target = sessionTimerNotificationRoute({ type: "session-timer", timerId, recordMode }, active);
		router.replace(target ? `/(tabs)${target}` : "/");
	}, [active, timerId, recordMode]);
	return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
		<ActivityIndicator color="#840B1C" />
	</View>;
}
