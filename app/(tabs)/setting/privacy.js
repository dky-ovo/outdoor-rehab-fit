import React, { useContext } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { privacyPolicy } from "../../../constants/PrivacyPolicy";
import { applyAppTextOverrides } from "../../../utils/appText";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

export default function PrivacyPolicyScreen() {
  useAndroidBackTarget("/(tabs)/setting");
  const { i18n, locale } = useContext(LocaleContext);
  const insets = useSafeAreaInsets();
  const language = String(locale || i18n.locale).startsWith("en") ? "en" : "zh";
  const content = applyAppTextOverrides("privacy", privacyPolicy[language], language);

  return (
    <ScrollView
      testID="privacy-policy-scroll"
      style={styles.screen}
      contentContainerStyle={[styles.page, { paddingBottom: 110 + insets.bottom }]}
      showsVerticalScrollIndicator
    >
      <View style={styles.article}>
        <Text selectable accessibilityRole="header" style={styles.title}>{content.title}</Text>
        {content.sections.map((section, sectionIndex) => (
          <View key={sectionIndex} testID={`privacy-section-${sectionIndex}`} style={styles.section}>
            <Text selectable accessibilityRole="header" style={styles.heading}>{section.title}</Text>
            {section.blocks.map((block, blockIndex) => (
              <View key={blockIndex} style={block.bullet ? styles.bulletRow : styles.paragraphRow}>
                {block.bullet ? <Text accessible={false} style={styles.bullet}>•</Text> : null}
                <Text selectable style={[styles.paragraph, block.bullet && styles.bulletText]}>{block.text}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  page: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24 },
  article: { width: "100%", maxWidth: 860, alignSelf: "center" },
  title: { fontSize: RFValue(23), lineHeight: RFValue(33), fontWeight: "800", color: "#292929", marginBottom: 8 },
  section: { marginTop: 24 },
  heading: { fontSize: RFValue(18), lineHeight: RFValue(28), fontWeight: "700", color: "#840B1C" },
  paragraphRow: { marginTop: 14 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 14 },
  bullet: { width: 22, fontSize: RFValue(16), lineHeight: RFValue(27), color: "#333" },
  paragraph: { fontSize: RFValue(16), lineHeight: RFValue(27), color: "#333", textAlign: "left" },
  bulletText: { flex: 1, minWidth: 0 },
});
