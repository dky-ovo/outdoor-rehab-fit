import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, View, Text, TouchableOpacity, Image, ScrollView, Platform } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import CustomBackButton from "../../../components/CustomBackButton";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { RFValue } from "react-native-responsive-fontsize";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { showAlert } from "../../../utils/alert";
import { getEquipmentCategories } from "../../../utils/api";
import { equipmentCategoryLabel, mergeEquipmentCategories } from "../../../utils/equipmentCatalog";
import useFacilityScrollInsets from "../../../hooks/useFacilityScrollInsets";

export default function Outdoor() {
	const scrollInsets = useFacilityScrollInsets(hp("15%"));
	useAndroidBackTarget("/(tabs)");
	const { i18n, locale } = useContext(LocaleContext);
	const [categories, setCategories] = useState(() => mergeEquipmentCategories());
	useFocusEffect(useCallback(() => {
		let active = true;
		getEquipmentCategories().then((result) => { if (active) setCategories(mergeEquipmentCategories(result.categories)); }).catch(() => {});
		return () => { active = false; };
	}, []));

	const builtInButtons = [
		{ icon: require("@/assets/icons/outdoor/list.png"), text: i18n.t("all"), category: "all" },
		{ icon: require("@/assets/icons/outdoor/muscle.png"), text: i18n.t("muscle"), category: "muscle" },
		{ icon: require("@/assets/icons/outdoor/flexibility.png"), text: i18n.t("mobility"), category: "mobility" },
		{ icon: require("@/assets/icons/outdoor/balance.png"), text: i18n.t("balance"), category: "balance" },
		{ icon: require("@/assets/icons/outdoor/aerobic.png"), text: i18n.t("aerobic"), category: "aerobic" },
		{ icon: require("@/assets/icons/outdoor/wheelchair.png"), text: i18n.t("wheelchair"), category: "wheelchair" },
		{ icon: require("@/assets/icons/outdoor/multi.png"), text: i18n.t("multifunctional"), category: "multifunctional" },
		{ icon: require("@/assets/icons/outdoor/relax.png"), text: i18n.t("relaxation"), category: "relaxation" },
		{ icon: require("@/assets/icons/outdoor/upper.png"), text: i18n.t("upper"), category: "upper" },
		{ icon: require("@/assets/icons/outdoor/lower.png"), text: i18n.t("lower"), category: "lower" },
		{ iconName: "shape-plus-outline", category: "alternative" },
		{ iconName: "human-cane", text: appText(locale, "inline.facilityGuide.specialPopulation", {"zh":"特殊人群","en":"Special Population"}), category: "special_population", locked: true },
		{ iconName: "human-handsup", text: appText(locale, "inline.facilityGuide.chronicStrokeSurvivor", {"zh":"中風人士","en":"Chronic Stroke Survivor"}), category: "warmup", locked: true },
	];
	const buttons = [builtInButtons[0], ...categories.filter((category) => category.showInGuide).map((category) => ({
		...(builtInButtons.find((button) => button.category === category.id) || { iconName: "shape-outline" }),
		text: equipmentCategoryLabel(category, locale), category: category.id, locked: category.isLocked,
	}))];

	return (
		<SafeAreaView edges={Platform.OS === "ios" ? ["top", "left", "right"] : undefined} style={styles.container}>
			<CustomBackButton text={i18n.t("back")} onPress={() => router.replace("/(tabs)")} />
			<ScrollView testID="facility-category-scroll" {...scrollInsets} style={{ flex: 1 }} contentContainerStyle={[styles.scrollViewContent, scrollInsets.contentContainerStyle]}>
				<View style={styles.buttonsContainer}>
					{buttons.map((button, index) => (
						<View key={button.category} style={styles.buttonWrapper}>
							<TouchableOpacity
								onPress={() => {
									if (button.locked) {
										showAlert("", appText(locale, "inline.facilityGuide.thisContentIsBeingPreparedAndWillBe", {"zh":"內容正在準備中，稍後開放。","en":"This content is being prepared and will be available later."}));
										return;
									}
									router.push({
										pathname: "/outdoor/list",
										params: { categoryName: button.text, categoryId: button.category },
									});
								}}
								style={[styles.button, button.locked && styles.lockedButton]}
							>
								{button.icon ? <Image source={button.icon} style={[styles.icon, button.locked && styles.lockedIcon]} /> : <MaterialCommunityIcons name={button.iconName} size={RFValue(46)} color={button.locked ? "#999" : "#555"} />}
								{button.locked && <View style={styles.lockBadge}><Ionicons name="lock-closed" size={RFValue(15)} color="#fff" /></View>}
							</TouchableOpacity>
							<Text style={styles.buttonText}>{button.text}</Text>
						</View>
					))}
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
	},
	scrollViewContent: {
		flexGrow: 1,
		alignItems: "center",
	},
	buttonsContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
		paddingHorizontal: 25,
	},
	buttonWrapper: {
		width: wp("40%"), // Adjust width to fit two buttons per row
		alignItems: "center",
		marginVertical: 10,
	},
	button: {
		width: wp("30%"),
		height: wp("30%"),
		borderRadius: wp("15%"),
		borderWidth: wp("2%"),
		borderColor: "#EB9481",
		backgroundColor: "#FFF",
		justifyContent: "center",
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 5,
	},
	icon: {
		width: wp("13%"),
		height: wp("13%"),
		resizeMode: "contain",
	},
	buttonText: {
		color: "#000",
		fontSize: RFValue(16),
		textAlign: "center",
		marginTop: 5,
		fontWeight: "bold",
	},
	lockedButton: {
		backgroundColor: "#E6E6E6",
		borderColor: "#B7B7B7",
	},
	lockedIcon: { opacity: 0.5 },
	lockBadge: {
		position: "absolute",
		top: 9,
		right: 9,
		width: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: "#777",
		alignItems: "center",
		justifyContent: "center",
	},
});
