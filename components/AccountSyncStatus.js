import React, { useContext, useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { LocaleContext } from '../contexts/LocaleContext';
import { getOwnerKey } from '../utils/userStorage';
import { getAccountSyncStatus, subscribeAccountSyncStatus } from '../utils/accountSyncStatus';

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
    <Text style={styles.hint}>{en ? 'Favorites, AI history, goals, exercise records and learning progress update automatically after each login. Offline changes stay on this device and retry when connected.' : '每次登入後會自動更新收藏、AI 歷史、目標、運動記錄及學習進度。離線變更保留在本機，連線後會自動重試。'}</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 16, marginBottom: 18, backgroundColor: '#fff', borderRadius: 16 }, title: { color: '#333', fontWeight: '600', fontSize: 15 }, hint: { color: '#666', fontSize: 13, lineHeight: 20, marginTop: 5 } });
