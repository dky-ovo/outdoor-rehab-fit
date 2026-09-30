import React, { useContext, useEffect, useState } from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { LocaleContext } from '../contexts/LocaleContext';
import { getOwnerKey } from '../utils/userStorage';
import { getAccountSyncStatus, subscribeAccountSyncStatus, retryAccountSync } from '../utils/accountSyncStatus';

export default function AccountSyncStatus() {
  const { user, isGuest } = useAuth(), { locale } = useContext(LocaleContext);
  const owner = user && getOwnerKey(user);
  const [, render] = useState(0);
  useEffect(() => subscribeAccountSyncStatus(value => { if (value === owner) render(n => n + 1); }), [owner]);
  if (!owner || !user?.token || isGuest) return null;
  const status = getAccountSyncStatus(owner), en = locale === 'en';
  const labels = en ? { syncing: 'Syncing account records…', synced: 'Account records synced', pending: 'Some records are waiting to sync' }
    : { syncing: '正在同步帳戶記錄…', synced: '帳戶記錄已同步', pending: '部分記錄等待同步' };
  return <View style={styles.card}>
    <Text style={styles.title}>{labels[status.state]}</Text>
    <Text style={styles.hint}>{en ? 'AI history, goals, exercise records and learning progress. Local data remains available offline.' : 'AI 歷史、目標、運動記錄及學習進度。離線時仍可使用本機資料。'}</Text>
    <Pressable accessibilityRole="button" disabled={status.state === 'syncing'} onPress={() => retryAccountSync(owner)}>
      <Text style={styles.action}>{en ? 'Sync now' : '立即同步'}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 16, marginBottom: 18, backgroundColor: '#fff', borderRadius: 16 }, title: { color: '#333', fontWeight: '600', fontSize: 15 }, hint: { color: '#666', fontSize: 13, lineHeight: 20, marginTop: 5 }, action: { color: '#840B1C', fontWeight: '600', paddingVertical: 10 } });
