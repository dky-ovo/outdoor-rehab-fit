import React, { useContext } from "react";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

export default function ActivityAdviceLayout() {
	const { i18n } = useContext(LocaleContext);
	return <Stack screenOptions={{ ...getReturnStackOptions(), headerShown: true }}>
		<Stack.Screen name="index" options={{
			title: i18n.t("physicalActivityAdvice"),
			headerLeft: () => <TouchableOpacity
				onPress={() => router.replace("/(tabs)/other" as never)}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("backToOther")}
				style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
			>
				<Ionicons name="chevron-back" size={24} color="#000" />
			</TouchableOpacity>,
		}} />
	</Stack>;
}
