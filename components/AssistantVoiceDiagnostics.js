import { appText } from "../utils/appText";
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const fields = locale => [
  ['installedVersion', appText(locale, 'inline.assistantDiagnostics.installedVersion', { zh: '安裝版本', en: 'Installed version' })],
  ['installedBuild', appText(locale, 'inline.assistantDiagnostics.installedBuild', { zh: 'Build', en: 'Build' })],
  ['platform', appText(locale, 'inline.assistantDiagnostics.platform', { zh: '系統', en: 'Platform' })],
  ['osVersion', appText(locale, 'inline.assistantDiagnostics.osVersion', { zh: '系統 / API', en: 'OS / API' })],
  ['nativeRevision', appText(locale, 'inline.assistantDiagnostics.nativeRevision', { zh: '語音修訂版', en: 'Voice revision' })],
  ['recognitionService', appText(locale, 'inline.assistantDiagnostics.recognitionService', { zh: '識別引擎', en: 'Recognition engine' })],
  ['lastStage', appText(locale, 'inline.assistantDiagnostics.lastStage', { zh: '目前階段', en: 'Current stage' })],
  ['previousStage', appText(locale, 'inline.assistantDiagnostics.previousStage', { zh: '上次階段', en: 'Previous stage' })],
  ['lastExitReason', appText(locale, 'inline.assistantDiagnostics.lastExitReason', { zh: '上次退出原因', en: 'Last exit reason' })],
  ['lastExitAt', appText(locale, 'inline.assistantDiagnostics.lastExitAt', { zh: '上次退出時間', en: 'Last exit time' })],
  ['defaultEngine', appText(locale, 'inline.assistantDiagnostics.defaultEngine', { zh: '朗讀引擎', en: 'Speech engine' })],
  ['requestedLanguage', appText(locale, 'inline.assistantDiagnostics.requestedLanguage', { zh: '要求語言', en: 'Requested language' })],
  ['selectedVoice', appText(locale, 'inline.assistantDiagnostics.selectedVoice', { zh: '已選聲音', en: 'Selected voice' })],
  ['selectedLocale', appText(locale, 'inline.assistantDiagnostics.selectedLocale', { zh: '聲音語言', en: 'Voice language' })],
  ['voiceConfirmed', appText(locale, 'inline.assistantDiagnostics.voiceConfirmed', { zh: '聲音已核對', en: 'Voice confirmed' })],
];

export function voiceDiagnosticText(diagnostics, locale) {
  return fields(locale).map(([key, label]) => {
    const value = diagnostics?.[key];
    const printable = ['string', 'number', 'boolean'].includes(typeof value) ? String(value).slice(0, 160) : '—';
    return `${label}: ${printable}`;
  }).join('\n');
}

export default function AssistantVoiceDiagnostics({ locale, diagnostics, readDiagnostics }) {
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState({});
  const en = locale === 'en';
  const refresh = () => { try { setNative(readDiagnostics?.() || {}); } catch { setNative({}); } };
  return <View style={styles.box}>
    <TouchableOpacity testID="assistant-voice-health" accessibilityRole="button" accessibilityState={{ expanded: open }}
      style={styles.button} onPress={() => { if (!open) refresh(); setOpen(value => !value); }}>
      <Text style={styles.link}>{open ? (appText(en ? "en" : "zh", "inline.assistantDiagnostics.hideVoiceDiagnostics", {"zh":"收起語音診斷","en":"Hide voice diagnostics"})) : (appText(en ? "en" : "zh", "inline.assistantDiagnostics.voiceDiagnostics", {"zh":"查看語音診斷","en":"Voice diagnostics"}))}</Text>
    </TouchableOpacity>
    {open && <ScrollView testID="assistant-voice-health-panel" style={styles.panel} nestedScrollEnabled>
      <Text selectable testID="assistant-voice-health-text" style={styles.text}>{voiceDiagnosticText({ ...diagnostics, ...native }, locale)}</Text>
      <Text style={styles.notice}>{appText(en ? "en" : "zh", "inline.assistantDiagnostics.versionEngineAndRunningStagesOnlyNoQuestions", {"zh":"僅顯示版本、引擎及運行階段，不含提問或錄音。可截圖提供此資料。","en":"Version, engine and running stages only. No questions or recordings. You can screenshot this panel."})}</Text>
      <TouchableOpacity testID="assistant-voice-health-refresh" accessibilityRole="button" style={styles.button} onPress={refresh}>
        <Text style={styles.link}>{appText(en ? "en" : "zh", "inline.assistantDiagnostics.refreshDiagnostics", {"zh":"更新診斷資料","en":"Refresh diagnostics"})}</Text>
      </TouchableOpacity>
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#fff', paddingHorizontal: 14 },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { fontSize: 14, color: '#840B1C' },
  panel: { maxHeight: 180, backgroundColor: '#FFF8F8', paddingHorizontal: 10 },
  text: { fontSize: 14, lineHeight: 21, color: '#444', paddingTop: 8 },
  notice: { fontSize: 13, lineHeight: 20, color: '#666', marginTop: 6 },
});
