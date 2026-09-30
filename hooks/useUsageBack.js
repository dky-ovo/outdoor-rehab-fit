import { useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";

export function useUsageBack(target, withinStack = false) {
	// Nested returns must remove the child, not replace it with another copy of
	// its parent (which makes the next native back gesture reopen old details).
	const back = useCallback(() => withinStack ? router.dismissTo(target) : router.replace(target), [target, withinStack]);
	useFocusEffect(useCallback(() => {
		if (Platform.OS !== "android") return;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
		return () => subscription.remove();
	}, [back]));
	return back;
}
