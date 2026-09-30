import React from "react";
import { Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

// Always provide a back button, even when the screen is opened directly
// (e.g. jumping to detail from the Favorites tab) and the nested stack has no history.
const renderBackButton = (color: string) => (
	<TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.navigate("/(tabs)"))}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={color} />
	</TouchableOpacity>
);

export default function OutdoorLayout() {
	const backgroundColor = "#FFFFFF";
	const foregroundColor = "#11181C";
	return (
		<Stack
			screenOptions={{
				...getReturnStackOptions(),
				headerShown: false,
				headerStyle: { backgroundColor },
				headerTintColor: foregroundColor,
				contentStyle: { backgroundColor },
			}}
		>
			{/* Optionally configure static options outside the route.*/}
			<Stack.Screen name="index" options={{ title: "Categories" }} />
			<Stack.Screen name="list" options={{ headerShown: true, title: "Equipment", headerLeft: () => renderBackButton(foregroundColor) }} />
			<Stack.Screen name="detail" options={{ headerShown: true, title: "Details", headerLeft: () => renderBackButton(foregroundColor) }} />
		</Stack>
	);
}
