import React, { useContext } from "react";
import { StyleSheet, View, ScrollView, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { showAlert } from "../../../utils/alert";
import { useUsageBack } from "../../../hooks/useUsageBack";

const Questionnaire = () => {
	useUsageBack("/(tabs)/risk", true);
	const { i18n } = useContext(LocaleContext);
	return (
		<SafeAreaView style={styles.container}>
			<Text style={styles.title}>{i18n.t("parq")}</Text>
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollViewContent}>
				<Text style={styles.text}>{i18n.t("questionnaireInfo")}</Text>
			</ScrollView>
			<View style={styles.buttonContainer}>
				<TouchableOpacity
					style={styles.button}
					onPress={() => {
						showAlert("", i18n.t("questionnaireNo"));
					}}
				>
					<Text style={styles.buttonText}>{i18n.t("yes")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={[styles.button, { backgroundColor: "#AAA" }]} //gray button
					onPress={() => {
						showAlert(i18n.t("warning"), i18n.t("questionnaireYes"));
					}}
				>
					<Text style={styles.buttonText}>{i18n.t("no")}</Text>
				</TouchableOpacity>
			</View>
		</SafeAreaView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	title: {
		fontSize: RFValue(20),
		fontWeight: "bold",
		color: "#007BFF",
		padding: 20,
		textAlign: "center",
		backgroundColor: "#f8f9fa",
	},
	scrollView: {
		flex: 1,
		padding: 12,
	},
	scrollViewContent: {
		paddingBottom: 20,
	},
	text: {
		fontSize: RFValue(18),
		lineHeight: 32,
		color: "#333",
		textAlign: "left",
	},
	buttonContainer: {
		flexDirection: "column",
		justifyContent: "space-between",
		padding: wp("2%"),
	},
	button: {
		backgroundColor: "#007BFF",
		paddingVertical: hp("2%"),
		borderRadius: 8,
		marginVertical: hp("1%"),
		alignItems: "center",
	},
	buttonText: {
		color: "#fff",
		fontSize: RFValue(18),
		fontWeight: "bold",
	},
});

export default Questionnaire;
