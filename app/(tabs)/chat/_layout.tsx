import React, { useContext } from "react";
import { Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

const renderBackButton = (label: string) => (
	<TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} onPress={() => router.replace("/(tabs)")}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

export default function ChatLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={getReturnStackOptions()}>
			<Stack.Screen name="index" options={{ headerShown: true, title: i18n.t("aiChat"), headerLeft: () => renderBackButton(i18n.t("back")) }} />
		</Stack>
	);
}
