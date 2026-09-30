import React, { useContext } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { appText } from "../../../utils/appText";

const Research = () => {
	useAndroidBackTarget("/(tabs)/other");
	const { locale } = useContext(LocaleContext);
	return <WebView style={styles.container} source={{ uri: appText(locale, 'inline.researchUrl', { zh: 'https://sites.google.com/view/rselderly/戶外健體樂應用程式介紹?authuser=0', en: 'https://sites.google.com/view/rselderly/戶外健體樂應用程式介紹?authuser=0' }) }} />;
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});

export default Research;
