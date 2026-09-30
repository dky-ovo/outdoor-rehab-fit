import React, { useContext } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { physicalActivityAdvice } from "../../../constants/PhysicalActivityAdvice";
import { applyAppTextOverrides } from "../../../utils/appText";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

function AdviceSection({ section }) {
	return <View style={styles.card}>
		<Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
		{section.paragraphs.map((paragraph, index) => <Text key={index} style={styles.paragraph}>{paragraph}</Text>)}
	</View>;
}

function AdviceReferences({ title, references, firstIndex = 0, i18n, onOpen }) {
	return <View style={styles.card}>
		<Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
		{references.map((reference, index) => <View key={`${firstIndex + index}:${reference.url}`} style={styles.reference}>
			<Text style={styles.paragraph}>{reference.text}</Text>
			<TouchableOpacity
				onPress={() => onOpen(reference.url)}
				accessibilityRole="link"
				accessibilityLabel={`${i18n.t("physicalActivityAdviceReference")} ${firstIndex + index + 1}`}
				style={styles.referenceButton}
			>
				<Text style={styles.referenceLabel}>{i18n.t("physicalActivityAdviceReference")} ↗</Text>
			</TouchableOpacity>
		</View>)}
	</View>;
}

export default function ActivityAdviceScreen() {
	useAndroidBackTarget("/(tabs)/other");
	const { i18n, locale } = useContext(LocaleContext);
	const insets = useSafeAreaInsets();
	const language = String(locale || i18n.locale).startsWith("en") ? "en" : "zh";
	const content = applyAppTextOverrides('activity', physicalActivityAdvice[language], language);
	const openReference = async (url) => {
		try { await Linking.openURL(url); }
		catch { Alert.alert(i18n.t("physicalActivityAdviceReference"), i18n.t("physicalActivityAdviceLinkError")); }
	};

	return <ScrollView
		style={styles.screen}
		contentContainerStyle={[styles.page, { paddingBottom: 110 + insets.bottom }]}
	>
		<View style={styles.body}>
			<Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
			<Text style={styles.sourceNote}>{i18n.t("physicalActivityAdviceSource")}</Text>
			<View style={styles.card}>
				<Text accessibilityRole="header" style={styles.sectionTitle}>{content.subtitle}</Text>
				{content.introduction.map((paragraph, index) => <Text key={index} style={styles.paragraph}>{paragraph}</Text>)}
			</View>
			{content.sections.map((section) => <AdviceSection key={section.title} section={section} />)}
			{/* Keep the existing reference indexes stable for saved admin edits. */}
			<AdviceReferences title={content.activityReferencesTitle} references={content.references.slice(0, 1)} i18n={i18n} onOpen={openReference} />
			<Text accessibilityRole="header" style={styles.groupTitle}>{content.tcmTitle}</Text>
			{content.tcmSections.map((section) => <AdviceSection key={section.title} section={section} />)}
			<AdviceReferences title={content.referencesTitle} references={content.references.slice(1)} firstIndex={1} i18n={i18n} onOpen={openReference} />
		</View>
	</ScrollView>;
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: "#F7F7F7" },
	page: { flexGrow: 1, padding: 18 },
	body: { width: "100%", maxWidth: 860, alignSelf: "center" },
	title: { fontSize: RFValue(23), fontWeight: "800", color: "#292929", marginTop: 4 },
	sourceNote: { fontSize: RFValue(13), lineHeight: RFValue(21), color: "#696969", marginTop: 10, marginBottom: 22 },
	card: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#E7E7E7", padding: 18, marginBottom: 18, flexShrink: 0 },
	sectionTitle: { fontSize: RFValue(18), lineHeight: RFValue(27), fontWeight: "800", color: "#840B1C" },
	paragraph: { fontSize: RFValue(16), lineHeight: RFValue(26), color: "#333", marginTop: 14, flexShrink: 1 },
	groupTitle: { fontSize: RFValue(22), lineHeight: RFValue(31), fontWeight: "800", color: "#292929", marginTop: 10, marginBottom: 16 },
	reference: { marginBottom: 8 },
	referenceButton: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, marginTop: 12, borderRadius: 12, backgroundColor: "#F8EAED", alignSelf: "flex-start", maxWidth: "100%" },
	referenceLabel: { fontSize: RFValue(15), fontWeight: "700", color: "#840B1C", flexShrink: 1 },
});
