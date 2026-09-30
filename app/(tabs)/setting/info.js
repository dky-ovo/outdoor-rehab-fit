import React, { useContext } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { ourTeam } from "../../../constants/OurTeam";
import { applyAppTextOverrides } from "../../../utils/appText";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

export default function Info() {
  useAndroidBackTarget("/(tabs)/setting");
  const { i18n, locale } = useContext(LocaleContext);
  const insets = useSafeAreaInsets();
  const language = String(locale || i18n.locale).startsWith("en") ? "en" : "zh";
  // Do not let a cached, old copy.team override replace the new roster.
  const content = applyAppTextOverrides("teamInfo", ourTeam[language], language);

  return (
    <ScrollView
      testID="about-team-scroll"
      style={styles.screen}
      contentContainerStyle={[styles.page, { paddingBottom: 110 + insets.bottom }]}
      showsVerticalScrollIndicator
    >
      <View style={styles.article}>
        <Text selectable accessibilityRole="header" style={styles.title}>{content.title}</Text>
        {content.sections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section} testID={`team-section-${sectionIndex}`}>
            <Text selectable accessibilityRole="header" style={styles.heading}>{section.title}</Text>
            {section.members.map((member, memberIndex) => (
              <View key={memberIndex} style={styles.member} testID={`team-member-${sectionIndex}-${memberIndex}`}>
                {member.role ? <Text selectable style={styles.role}>{member.role}</Text> : null}
                {member.responsibility ? <Text selectable style={styles.detail}>{member.responsibility}</Text> : null}
                <Text selectable style={styles.name}>{member.name}</Text>
                {member.position ? <Text selectable style={styles.detail}>{member.position}</Text> : null}
                {member.affiliation ? <Text selectable style={styles.detail}>{member.affiliation}</Text> : null}
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
  title: { fontSize: RFValue(23), lineHeight: RFValue(33), fontWeight: "800", color: "#292929" },
  section: { marginTop: 28 },
  heading: { fontSize: RFValue(19), lineHeight: RFValue(29), fontWeight: "700", color: "#840B1C" },
  member: { marginTop: 22 },
  role: { fontSize: RFValue(17), lineHeight: RFValue(27), fontWeight: "700", color: "#333", marginBottom: 6 },
  name: { fontSize: RFValue(17), lineHeight: RFValue(27), fontWeight: "700", color: "#292929", marginTop: 4 },
  detail: { fontSize: RFValue(16), lineHeight: RFValue(26), color: "#444", marginTop: 4 },
});
