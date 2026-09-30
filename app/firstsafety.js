import React, { useCallback, useContext, useRef } from "react";
import { StyleSheet, View, ScrollView, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { LocaleContext } from "../contexts/LocaleContext";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { showAlert } from "../utils/alert";

const FirstSafety = () => {
	const { i18n } = useContext(LocaleContext);
	const activeRef = useRef(false);
	const savingRef = useRef(false);
	useFocusEffect(useCallback(() => {
		activeRef.current = true; savingRef.current = false;
		return () => { activeRef.current = false; };
	}, []));
	// Note: no auto-skip here; the first-launch gating is handled in app/index.js
	// so this page is always shown during the onboarding flow.

	const handleNo = async () => {
		if (savingRef.current) return;
		savingRef.current = true;
		try {
			await AsyncStorage.setItem("safetyResponse", "no");
			if (activeRef.current) showAlert("", i18n.t("agreeQuestionnaire"), [{ text: "OK", onPress: () => { if (activeRef.current) router.replace("/login"); } }]);
		} catch (error) {
			savingRef.current = false;
			console.error("Error saving safety response status", error);
			if (activeRef.current) showAlert(i18n.t("warning"), i18n.t("serverError"));
		}
	};

	return (
		<SafeAreaView style={styles.container}>
			<Text style={styles.title}>{i18n.t("sprm")}</Text>
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollViewContent}>
				<Text style={styles.text}>{i18n.t("safety")}</Text>
			</ScrollView>
			<View style={styles.buttonContainer}>
				<TouchableOpacity style={styles.button} onPress={handleNo}>
					<Text style={styles.buttonText}>{i18n.t("agreeSafety")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={[styles.button, { backgroundColor: "#dc3545" }]}
					onPress={() => {
						showAlert(i18n.t("warning"), i18n.t("questionnaireYes"));
					}}
				>
					<Text style={styles.buttonText}>{i18n.t("disagreeSafety")}</Text>
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
		marginBottom: 16,
		padding: 20,
		textAlign: "center",
		backgroundColor: "#f8f9fa",
	},
	scrollView: {
		flex: 1,
		padding: 12,
		backgroundColor: "#f8f9fa",
	},
	scrollViewContent: {
		paddingBottom: 20,
	},
	text: {
		fontSize: 24,
		lineHeight: 32,
		color: "#333",
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

export default FirstSafety;
