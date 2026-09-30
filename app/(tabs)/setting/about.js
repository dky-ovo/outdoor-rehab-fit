import React, { useContext } from "react";
import { Platform, StyleSheet, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { RFValue } from "react-native-responsive-fontsize";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

const TAB_BAR_HEIGHT = 100;

export default function About() {
	useAndroidBackTarget("/(tabs)/setting");
	const { i18n } = useContext(LocaleContext);
	const insets = useSafeAreaInsets();
	const bottomPad =
		Platform.OS === "ios" ? TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) : TAB_BAR_HEIGHT + Math.max(insets.bottom, 16);

	return (
		<ScrollView
			testID="about-app-scroll"
			style={styles.scroll}
			contentContainerStyle={[styles.container, { paddingBottom: bottomPad }]}
			showsVerticalScrollIndicator
		>
			<View style={styles.articleContainer}>
				<Text selectable style={styles.articleText}>{i18n.t("intro")}</Text>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	scroll: {
		flex: 1,
		backgroundColor: "#ffffff",
	},
	container: {
		flexGrow: 1,
		padding: 20,
	},
	articleContainer: {
		width: "100%",
	},
	articleText: {
		fontSize: RFValue(16),
		lineHeight: RFValue(26),
		fontWeight: "600",
		color: "#333333",
		textAlign: "left",
	},
});
