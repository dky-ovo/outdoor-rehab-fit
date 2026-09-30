import { useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";

/**
 * Gives a focused root screen a deterministic Android Back destination.
 * Nested screens do not inherit the handler because useFocusEffect removes it
 * as soon as their parent screen loses focus.
 */
export function useAndroidBackTarget(target, enabled = true) {
	useFocusEffect(
		useCallback(() => {
			if (!enabled || Platform.OS !== "android") return undefined;
			const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
				router.replace(target);
				return true;
			});
			return () => subscription.remove();
		}, [enabled, target])
	);
}
