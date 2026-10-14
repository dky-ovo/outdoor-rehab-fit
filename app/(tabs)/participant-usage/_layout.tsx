import { appText } from "../../../utils/appText";
import React, { useContext } from "react";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

export default function ParticipantUsageLayout() {
	const { i18n, locale } = useContext(LocaleContext);
	const back = (target: string | { pathname: string; params: Record<string, unknown> }) => <TouchableOpacity onPress={() => router.replace(target as never)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}><Ionicons name="chevron-back" size={24} color="#111" /></TouchableOpacity>;
	return <Stack screenOptions={getReturnStackOptions()}>
		<Stack.Screen name="index" options={{ title: i18n.t("participantUsage"), headerLeft: () => back("/other") }} />
		<Stack.Screen name="detail" options={{ title: i18n.t("weeklyUsage") }} />
		<Stack.Screen name="day" options={{ title: i18n.t("dailyUsage") }} />
		<Stack.Screen name="learning" options={{ title: appText(locale, "inline.participantNavigation.facilityGuideProgress", {"zh":"設施教學進度","en":"Facility Guide progress"}) }} />
		<Stack.Screen name="learning-detail" options={{ title: appText(locale, "inline.participantNavigation.equipmentLearningDetails", {"zh":"器材學習詳情","en":"Equipment learning details"}) }} />
	</Stack>;
}
