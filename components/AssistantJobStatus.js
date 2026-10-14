import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { assistantJobStage } from '../utils/assistantJobs';

// An uncertain network result is still the same request. Keep it resumable,
// but do not present a permanent spinner as evidence that AI is working.
export default function AssistantJobStatus({ task, locale, thinkingLabel, onRecheck, onLogin }) {
  const [now, setNow] = useState(Date.now), [checking, setChecking] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const stage = task ? assistantJobStage(task, now) : 'submitting';
  const en = locale === 'en';
  const labels = en ? {
    waiting: 'This is taking longer than expected. Check for your reply; you can leave this page meanwhile.',
    reconnecting: 'Connection interrupted. Your question is saved; checking for the reply will not send it again.',
    authentication_required: 'Sign in again to retrieve your reply. Your saved question is retained.',
    save_failed: 'Your reply has arrived but could not be saved. Retry saving it.',
    saving: 'Saving your reply…', queued: 'Your question is queued…',
  } : {
    waiting: '等候時間較長，可重新查閱回覆，亦可先離開此頁。',
    reconnecting: '連線暫時中斷，問題已保留。重新查閱不會重複發送問題。',
    authentication_required: '請重新登入以取得回覆，已儲存的問題仍會保留。',
    save_failed: '已收到回覆，但暫未能儲存，請重試儲存。',
    saving: '正在儲存回覆…', queued: '問題正在排隊處理…',
  };
  const needsAction = ['waiting', 'reconnecting', 'authentication_required', 'save_failed'].includes(stage);
  const retry = async () => { if (checking) return; setChecking(true); try { await onRecheck(); } catch { /* Durable status remains available for another retry. */ } finally { setChecking(false); } };
  return <View testID="assistant-job-status" accessibilityLiveRegion="polite" style={styles.card}>
    {!needsAction && <ActivityIndicator color="#840B1C" />}
    <Text style={styles.text}>{labels[stage] || thinkingLabel}</Text>
    {needsAction && <Pressable testID="assistant-job-recheck" accessibilityRole="button" disabled={checking}
      onPress={stage === 'authentication_required' ? onLogin : retry} style={styles.button}>
      <Text style={styles.action}>{stage === 'authentication_required' ? (en ? 'Sign in' : '重新登入') : checking ? (en ? 'Checking…' : '查閱中…') : stage === 'save_failed' ? (en ? 'Retry saving' : '重試儲存') : (en ? 'Check for reply' : '重新查閱回覆')}</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({ card: { gap: 8, padding: 12 }, text: { fontSize: 15, lineHeight: 22, color: '#666' }, button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 10 }, action: { color: '#840B1C', fontSize: 16, fontWeight: '600' } });
