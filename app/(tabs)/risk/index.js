import React, { useContext, useEffect } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { AntDesign } from "@expo/vector-icons"; // Make sure to install this package
import { LocaleContext } from "../../../contexts/LocaleContext";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { RFValue } from "react-native-responsive-fontsize";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

const Index = () => {
	useAndroidBackTarget("/(tabs)/other");
	const { i18n } = useContext(LocaleContext);
	return (
		<View style={styles.container}>
			<TouchableOpacity style={styles.button} onPress={() => router.navigate(`/risk/questionnaire`)}>
				<AntDesign name="form" size={80} color="white" />
				<Text style={styles.buttonText}>{i18n.t("parq")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				onPress={() => {
					router.navigate(`/risk/safety`);
				}}
			>
					<AntDesign name="safety" size={80} color="white" />
				<Text style={styles.buttonText}>{i18n.t("sprm")}</Text>
			</TouchableOpacity>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	button: {
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#007BFF",
		borderRadius: 10,
		padding: 20,
		margin: 10,
		width: wp("80%"),
		height: hp("25%"),
	},
	buttonText: {
		color: "white",
		marginTop: 10,
		fontSize: RFValue(16),
		fontWeight: "bold",
		textAlign: "center",
	},
});

export default Index;
