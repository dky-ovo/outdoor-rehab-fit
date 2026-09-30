import React, { useContext } from "react";
import { Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { equipmentLocationReturnTarget } from "../../../utils/equipmentLocationRoutes";
import { getReturnStackOptions } from "../../../utils/stackNavigationOptions";

const renderBackButton = (params: any) => (
	<TouchableOpacity onPress={() => router.replace(equipmentLocationReturnTarget(params || {}) as any)} style={{ paddingHorizontal: 8 }}>
		<Ionicons name="chevron-back" size={RFValue(18)} color={"#000"} />
	</TouchableOpacity>
);

export default function EquipmentMapLayout() {
	const { i18n } = useContext(LocaleContext) as any;
	return (
		<Stack screenOptions={getReturnStackOptions()}>
			<Stack.Screen name="index" options={({ route }) => ({ headerShown: true, title: i18n.t("equipmentMap"), gestureEnabled: false, headerLeft: () => renderBackButton(route.params) })} />
		</Stack>
	);
}
