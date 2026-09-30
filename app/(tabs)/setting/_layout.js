import React, { useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { Platform, TouchableOpacity } from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";
import SettingsScreenMotion from "../../../components/SettingsScreenMotion";

const renderSettingsScreen = ({ children }) => <SettingsScreenMotion>{children}</SettingsScreenMotion>;

const renderBackButton = () => (
	<TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/setting"))} style={{ paddingHorizontal: 8 }}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

const renderHomeBackButton = () => (
	<TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ paddingHorizontal: 8 }}>
		<Ionicons name="chevron-back" size={RFValue(18)} color="#000" />
	</TouchableOpacity>
);

export default function SettingLayout() {
	const { i18n } = useContext(LocaleContext);

	return (
		<Stack
			screenLayout={Platform.OS === "android" ? renderSettingsScreen : undefined}
			screenOptions={{
				...getReturnStackOptions(),
				// Android defaults differ by OS version. Fade plus our native-driven
				// scale is explicitly free of side-to-side movement on every version.
				...(Platform.OS === "android" ? { animation: "fade", animationTypeForReplace: "pop" } : {}),
				headerShown: true,
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: i18n.t("setting"),
					headerShown: true,
					headerLeft: renderHomeBackButton,
				}}
			/>
			<Stack.Screen
				name="contact"
				options={{
					title: i18n.t("contactUs"),
					headerShown: true,
					headerLeft: () => (
						<TouchableOpacity
							accessibilityRole="button"
							accessibilityLabel={i18n.t("contactBackToSettings")}
							onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/setting")}
							style={{ minWidth: 48, minHeight: 48, justifyContent: "center", paddingHorizontal: 8 }}
						>
							<Ionicons name="chevron-back" size={RFValue(20)} color="#000" />
						</TouchableOpacity>
					),
				}}
			/>
			<Stack.Screen
				name="profile"
				options={{
					title: i18n.t("userProfile"),
					headerShown: true,
					headerLeft: renderBackButton,
				}}
			/>
			<Stack.Screen
				name="about"
				options={{
					title: i18n.t("aboutApp"),
					headerShown: true,
					headerLeft: renderBackButton,
				}}
			/>
			<Stack.Screen
				name="disclaimer"
				options={{
					title: i18n.t("settingDisclaimer"),
					headerShown: true,
					headerLeft: renderBackButton,
				}}
			/>
			<Stack.Screen
				name="privacy"
				options={{
					title: i18n.t("privacyPolicy"),
					headerShown: true,
					headerLeft: () => (
						<TouchableOpacity
							accessibilityRole="button"
							accessibilityLabel={i18n.t("privacyBackToSettings")}
							onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/setting")}
							style={{ minWidth: 48, minHeight: 48, justifyContent: "center", paddingHorizontal: 8 }}
						>
							<Ionicons name="chevron-back" size={RFValue(20)} color="#000" />
						</TouchableOpacity>
					),
				}}
			/>
			<Stack.Screen
				name="info"
				options={{
					title: i18n.t("aboutTeam"),
					headerShown: true,
					headerLeft: renderBackButton,
				}}
			/>
		</Stack>
	);
}
