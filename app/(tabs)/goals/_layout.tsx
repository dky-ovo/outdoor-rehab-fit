import React, { useContext } from "react";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

const renderBackButton = () => (
	<TouchableOpacity onPress={() => router.replace("/(tabs)")}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

const GoalBackButton = () => {
	const { from } = useLocalSearchParams();
	const cameFromHome = (Array.isArray(from) ? from[0] : from) === "home";
	return <TouchableOpacity onPress={() => cameFromHome ? router.replace("/(tabs)") : router.dismissTo("/(tabs)/goals")}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>;
};

export default function GoalsLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={getReturnStackOptions()}>
			<Stack.Screen name="index" options={{ headerShown: true, title: i18n.t("goalSetting"), headerLeft: renderBackButton, gestureEnabled: false }} />
			<Stack.Screen name="smart" options={{ headerShown: true, title: i18n.t("smartGoal"), headerLeft: () => <GoalBackButton />, gestureEnabled: false }} />
		</Stack>
	);
}
