import React, { useContext } from "react";
import { View, StyleSheet, Text } from "react-native";
import { LocaleContext } from "../../contexts/LocaleContext";
import ManagedContent from "../../components/ManagedContent";
import useFacilityScrollInsets from '../../hooks/useFacilityScrollInsets';

export default function ExerciseVideos() {
  const { i18n } = useContext(LocaleContext);
  const scrollInsets = useFacilityScrollInsets();
  // iOS tabs overlay this screen. Bound the entire library above them so its
  // last card, filters and empty/error controls remain reachable.
  return <View testID="exercise-videos-page" style={[styles.page, { paddingBottom: scrollInsets.scrollIndicatorInsets.bottom }]}>
    <Text style={styles.title}>{i18n.t("exerciseVideos")}</Text>
    <ManagedContent pageKey="exercise_videos" showStatus />
  </View>;
}
const styles = StyleSheet.create({ page: { flex: 1, paddingTop: 20, backgroundColor: "#F5F7F6" }, title: { fontSize: 25, fontWeight: "800", color: "#25382D", paddingHorizontal: 20 } });
