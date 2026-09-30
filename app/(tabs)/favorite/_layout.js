import React, { useContext } from "react";
import { Platform, TouchableOpacity } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";
import FavoriteDetailMotion from "../../../components/FavoriteDetailMotion";

export const unstable_settings = { initialRouteName: "index" };

const renderFavoriteScreen = ({ children, route }) => route.name === "detail"
	? <FavoriteDetailMotion>{children}</FavoriteDetailMotion>
	: children;
const renderHomeBackButton = () => (
	<TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ paddingHorizontal: 8 }}>
		<Ionicons name="chevron-back" size={RFValue(18)} color="#11181C" />
	</TouchableOpacity>
);

export default function FavoriteLayout() {
	const { i18n } = useContext(LocaleContext);
	return (
		<Stack
			screenLayout={Platform.OS === "android" ? renderFavoriteScreen : undefined}
			screenOptions={{
				...getReturnStackOptions(),
				// This is a native-stack push within Favorites, not a switch to the
				// hidden Outdoor tab. Android uses scale + fade without lateral motion.
				...(Platform.OS === "android" ? { animation: "fade", animationTypeForReplace: "pop" } : {}),
				headerShown: true,
				headerStyle: { backgroundColor: "#FFFFFF" },
				headerTintColor: "#11181C",
				contentStyle: { backgroundColor: "#FFFFFF" },
			}}
		>
			<Stack.Screen name="index" options={{ title: i18n.t("favorite"), headerLeft: renderHomeBackButton }} />
			<Stack.Screen name="detail" options={({ route }) => ({ title: String(route.params?.name || "") })} />
		</Stack>
	);
}
