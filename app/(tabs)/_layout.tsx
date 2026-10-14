import React, { useContext } from "react";
import { Platform, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { HapticTab } from "@/components/HapticTab";
import { IconSymbol } from "@/components/ui/IconSymbol";
import TabBarBackground from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";

import { RFValue } from "react-native-responsive-fontsize";

import { LocaleContext } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";

import { Tabs, router, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const renderHomeBackButton = (label: string) => (
	<TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={() => router.replace("/(tabs)")} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

export default function TabLayout() {
	const { i18n } = useContext(LocaleContext);
	const { user, isLoading } = (useContext(AuthContext) as { user?: unknown; isLoading?: boolean } | null) || {};
	const insets = useSafeAreaInsets();
	// Logout/deletion must remove the whole tab subtree, not leave a previous
	// account's local screen state reachable through Android Back or a deep link.
	if (isLoading) return null;
	if (!user) return <Redirect href="/login" />;
	const tabBarSafeInset = Platform.OS === "android" ? Math.max(insets.bottom, 24) : insets.bottom;
	const tabBarHeight = 78 + tabBarSafeInset;
	return (
		<Tabs
			backBehavior="initialRoute"
			screenOptions={{
				tabBarActiveTintColor: Colors["light"].tint,
				headerShown: false,
				tabBarButton: HapticTab,
				tabBarBackground: TabBarBackground,
				tabBarStyle: Platform.select({
					ios: {
						// Use a transparent background on iOS to show the blur effect
						position: "absolute",
						height: tabBarHeight,
						paddingTop: 6,
						paddingBottom: tabBarSafeInset,
					},
					default: {
						height: tabBarHeight,
						paddingTop: 6,
						paddingBottom: tabBarSafeInset,
					},
				}),
				tabBarLabelStyle: {
					fontSize: 18, // Increase font size for better readability
					marginTop: 1,
				},
				tabBarIconStyle: {
					marginTop: 4,
				},
			}}
		>
			<Tabs.Screen
				name="index"
				options={{
					title: i18n.t("home"),
					tabBarIcon: ({ color }) => <IconSymbol size={32} name="house.fill" color={color} />,
				}}
			/>
			<Tabs.Screen
				name="favorite"
				options={{
					title: i18n.t("favorite"),
					headerShown: false,
					tabBarIcon: ({ color }) => <MaterialIcons size={32} name="favorite" color={color} />,
				}}
			/>
			<Tabs.Screen
				name="other"
				options={{
					title: i18n.t("otherTab"),
					headerTitle: i18n.t("otherTab"),
					tabBarIcon: ({ color }) => <MaterialIcons size={32} name="apps" color={color} />,
					headerShown: true,
					headerLeft: () => renderHomeBackButton(i18n.t("back")),
				}}
			/>
			<Tabs.Screen
				name="setting"
				options={{
					title: i18n.t("setting"),
					tabBarIcon: ({ color }) => <MaterialIcons size={32} name="settings" color={color} />,
					// The Settings native stack owns every header, including its index.
					// Toggling a tab header during a push resizes both animated screens.
					headerShown: false,
					tabBarHideOnKeyboard: Platform.OS === "android",
				}}
			/>
			<Tabs.Screen name="risk" options={{ href: null }} />
			<Tabs.Screen name="outdoor" options={{ href: null }} />
			<Tabs.Screen name="exercise-videos" options={{ href: null, headerShown: true, title: i18n.t("exerciseVideos"), headerLeft: () => renderHomeBackButton(i18n.t("back")) }} />
			<Tabs.Screen name="location" options={{ href: null }} />
			<Tabs.Screen name="research" options={{ href: null }} />
			<Tabs.Screen name="activity-advice" options={{ href: null }} />
			<Tabs.Screen name="session" options={{ href: null, tabBarStyle: { display: "none" } }} />
			<Tabs.Screen name="sessionlog" options={{ href: null }} />
			<Tabs.Screen name="goals" options={{ href: null }} />
			<Tabs.Screen name="chat" options={{ href: null, tabBarStyle: { display: "none" } }} />
			<Tabs.Screen name="stats" options={{ href: null }} />
			<Tabs.Screen name="equipmentmap" options={{ href: null }} />
			<Tabs.Screen name="participant-usage" options={{ href: null, tabBarStyle: { display: "none" } }} />
		</Tabs>
	);
}
