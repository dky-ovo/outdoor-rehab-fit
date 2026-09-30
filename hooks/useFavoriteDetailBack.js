import { useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { router, useFocusEffect, useNavigation } from "expo-router";

export default function useFavoriteDetailBack() {
	const navigation = useNavigation();
	const onBack = useCallback(() => {
		const state = navigation.getState();
		// Only pop our own stack. Global canGoBack may refer to a different tab
		// when a detail URL was opened directly, or returned from the map.
		if (state.type === "stack" && state.index > 0) navigation.goBack();
		else router.replace("/favorite");
	}, [navigation]);
	useFocusEffect(useCallback(() => {
		if (Platform.OS !== "android") return undefined;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			onBack();
			return true;
		});
		return () => subscription.remove();
	}, [onBack]));
	return onBack;
}
