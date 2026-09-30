import React, { useContext } from "react";
import { Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

const renderBackButton = () => (
	<TouchableOpacity onPress={() => router.replace("/(tabs)/other" as never)}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

export default function StatsLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={getReturnStackOptions()}>
			<Stack.Screen name="index" options={{ headerShown: true, title: i18n.t("usageData"), headerLeft: renderBackButton }} />
		</Stack>
	);
}
