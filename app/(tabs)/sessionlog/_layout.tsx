import React, { useContext } from "react";
import { Stack, router } from "expo-router";
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

export const unstable_settings = { initialRouteName: "index" };

export default function SessionLogLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={getReturnStackOptions()}>
			<Stack.Screen name="index" options={{ headerShown: true, title: i18n.t("sessionLog"), headerLeft: renderBackButton }} />
			<Stack.Screen name="detail" options={{ headerShown: true, title: i18n.t("sessionSummary") }} />
			<Stack.Screen name="edit" options={{ headerShown: true, title: i18n.t("editSession"), gestureEnabled: false, headerBackVisible: false }} />
		</Stack>
	);
}
