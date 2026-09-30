import React, { useContext } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { appText } from "../../../utils/appText";

export default function ResearchWeb() {
	useAndroidBackTarget("/(tabs)/other");
	const { locale, i18n } = useContext(LocaleContext);
	const researchUrl = appText(locale, 'inline.researchUrl', { zh: 'https://sites.google.com/view/rselderly/戶外健體樂應用程式介紹?authuser=0', en: 'https://sites.google.com/view/rselderly/戶外健體樂應用程式介紹?authuser=0' });
	return <View style={styles.container}>
		<Text style={styles.title}>{i18n.t('research')}</Text>
		<Text style={styles.description}>{appText(locale, 'inline.researchWebsiteHint', { zh: '研究網站需要在新的瀏覽器頁面開啟。', en: 'The research website opens in a new browser page.' })}</Text>
		<TouchableOpacity style={styles.button} onPress={() => Linking.openURL(researchUrl)}><Text style={styles.buttonText}>{appText(locale, 'inline.researchWebsiteOpen', { zh: '開啟大學研究網站', en: 'Open research website' })}</Text></TouchableOpacity>
	</View>;
}

const styles = StyleSheet.create({
	container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#F5F6F8" },
	title: { color: "#25272B", fontSize: 26, fontWeight: "800", textAlign: "center" },
	description: { color: "#666", fontSize: 16, lineHeight: 24, textAlign: "center", marginTop: 12, marginBottom: 22 },
	button: { backgroundColor: "#840B1C", borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14 },
	buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
