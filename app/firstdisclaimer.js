import React, { useCallback, useContext, useRef } from "react";
import { StyleSheet, View, ScrollView, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { LocaleContext } from "../contexts/LocaleContext";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { showAlert } from "../utils/alert";

const FirstDisclaimer = () => {
	const { i18n } = useContext(LocaleContext);
	const activeRef = useRef(false);
	const savingRef = useRef(false);
	useFocusEffect(useCallback(() => {
		activeRef.current = true; savingRef.current = false;
		return () => { activeRef.current = false; };
	}, []));
	// Note: the "already agreed -> skip to login" check now lives in app/index.js,
	// so the disclaimer is always shown when the user taps Start on first launch.

	const handleAgree = async () => {
		if (savingRef.current) return;
		savingRef.current = true;
		try {
			await AsyncStorage.setItem("userAgreed", "true");
			if (activeRef.current) router.replace("/firstquestionnaire");
		} catch (error) {
			savingRef.current = false;
			console.error("Error saving agreement status", error);
			if (activeRef.current) showAlert(i18n.t("warning"), i18n.t("serverError"));
		}
	};

	return (
		<SafeAreaView style={styles.container}>
			<Text style={styles.title}>{i18n.t("settingDisclaimer")}</Text>
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollViewContent}>
				<Text style={styles.text}>{i18n.t("disclaimer")}</Text>
			</ScrollView>
			<View style={styles.buttonContainer}>
				<TouchableOpacity style={styles.button} onPress={handleAgree}>
					<Text style={styles.buttonText}>{i18n.t("agree")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={styles.button}
					onPress={() => {
						showAlert(i18n.t("warning"), i18n.t("disagreeDisclaimer"));
					}}
				>
					<Text style={styles.buttonText}>{i18n.t("disagree")}</Text>
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
	},
	scrollViewContent: {
		flexGrow: 1,
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

export default FirstDisclaimer;
