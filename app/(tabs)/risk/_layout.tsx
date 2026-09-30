import React, { useContext } from "react";
import { Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

export default function RiskLayout() {
	const { i18n } = useContext(LocaleContext);

	const renderBackButton = () => (
		<TouchableOpacity onPress={() => router.replace("/(tabs)/other" as never)}>
			<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
		</TouchableOpacity>
	);
	const renderRiskBackButton = () => (
		<TouchableOpacity onPress={() => router.dismissTo("/(tabs)/risk")}>
			<Ionicons name="chevron-back" size={RFValue(18)} color="#000" />
		</TouchableOpacity>
	);

	return (
		<Stack
			screenOptions={{
				...getReturnStackOptions(),
				headerShown: false,
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					headerShown: true,
					title: i18n.t("risk"),
					headerLeft: renderBackButton,
				}}
			/>
			<Stack.Screen
				name="questionnaire"
				options={{
					title: i18n.t("parq"),
					headerShown: true,
					headerLeft: renderRiskBackButton,
				}}
			/>
			<Stack.Screen
				name="safety"
				options={{
					title: i18n.t("sprm"),
					headerShown: true,
					headerLeft: renderRiskBackButton,
				}}
			/>
		</Stack>
	);
}
