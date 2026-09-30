import React, { useCallback, useContext, useRef } from "react";
import { StyleSheet, View, ScrollView, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { LocaleContext } from "../contexts/LocaleContext";
import { router, useFocusEffect } from "expo-router";
import { showAlert } from "../utils/alert";

const FirstQuestionnaire = () => {
	const { i18n } = useContext(LocaleContext);
	const activeRef = useRef(false);
	const answeringRef = useRef(false);
	useFocusEffect(useCallback(() => {
		activeRef.current = true; answeringRef.current = false;
		return () => { activeRef.current = false; };
	}, []));
	const answer = (hasPositiveAnswer) => {
		if (answeringRef.current) return;
		answeringRef.current = true;
		showAlert(hasPositiveAnswer ? i18n.t("warning") : "", i18n.t(hasPositiveAnswer ? "questionnaireYes" : "questionnaireNo"), [
			{ text: "OK", onPress: () => { if (activeRef.current) router.replace("/firstsafety"); } },
		]);
	};
	return (
		<SafeAreaView style={styles.container}>
			<Text style={styles.title}>{i18n.t("parq")}</Text>
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollViewContent}>
				<Text style={styles.text}>{i18n.t("questionnaireInfo")}</Text>
			</ScrollView>
			<View style={styles.buttonContainer}>
				<TouchableOpacity
					style={styles.button}
					onPress={() => answer(false)}
				>
					<Text style={styles.buttonText}>{i18n.t("yes")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={[styles.button, { backgroundColor: "#AAA" }]} //gray button
					onPress={() => answer(true)}
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
		fontSize: 24,
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
		fontSize: 24,
		lineHeight: 32,
		color: "#333",
		textAlign: "left",
	},
	buttonContainer: {
		flexDirection: "column",
		justifyContent: "space-between",
		padding: 16,
	},
	button: {
		backgroundColor: "#007BFF",
		paddingVertical: 22,
		paddingHorizontal: 32,
		borderRadius: 8,
		marginVertical: 8,
		alignItems: "center",
	},
	buttonText: {
		color: "#fff",
		fontSize: 22,
		fontWeight: "bold",
	},
});

export default FirstQuestionnaire;
