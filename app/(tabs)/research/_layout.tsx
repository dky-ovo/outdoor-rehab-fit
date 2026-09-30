import React, { useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { TouchableOpacity } from "react-native";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

export default function ResearchLayout() {
	const { i18n } = useContext(LocaleContext);

	const renderBackButton = () => (
		<TouchableOpacity onPress={() => router.replace("/(tabs)/other" as never)}>
			<Ionicons name="chevron-back" size={24} color={"#000"} />
		</TouchableOpacity>
	);

	return (
		<Stack
			screenOptions={{
				...getReturnStackOptions(),
				headerShown: true,
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: i18n.t("research"),
					headerLeft: renderBackButton,
				}}
			/>
		</Stack>
	);
}
