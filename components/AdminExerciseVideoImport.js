import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminMediaLibrary from './AdminMediaLibrary';
import AdminExerciseVideoMetadata, { ExerciseVideoCategoryChoices, useExerciseVideoCatalog } from './AdminExerciseVideoMetadata';
import { createAdminContent, getAdminContent } from '../utils/api';
import { appendExerciseVideoDrafts, applyExerciseVideoDraftCategory, exerciseVideoDraftReady, publishExerciseVideoDrafts } from '../utils/adminExerciseVideoImport';

export default function AdminExerciseVideoImport({ visible, token, permissions, existing = [], locale = 'zh-CN', onClose, onSaved }) {
  const [drafts, setDrafts] = useState([]), [picking, setPicking] = useState(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [batchCategory, setBatchCategory] = useState('');
  const catalog = useExerciseVideoCatalog(Boolean(visible && token));
  const operation = useRef(null), mounted = useRef(true), currentToken = useRef(token);
  currentToken.current = token;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { operation.current = null; setDrafts([]); setPicking(true); setBusy(false); setNotice(''); setBatchCategory(''); }, [token]);
  const pending = drafts.filter(item => !['saved', 'skipped'].includes(item.status));
  const invalidSelection = pending.some(item => !exerciseVideoDraftReady(item) || (!item.payload && item.equipmentIds?.length &&
    (catalog.status !== 'ready' || item.equipmentIds.some(id => !catalog.items.some(equipment => String(equipment.id) === id)))));
  const select = files => {
    const next = appendExerciseVideoDrafts(drafts, files, existing, undefined, { videoCategory: batchCategory });
    setNotice(next.length === drafts.length ? '所选影片已在列表或本次清单中，无需重复添加。' : '标题已按文件名填写。请核对分类及关联器材，可逐项修改。');
    setDrafts(next); setPicking(false);
  };
  const save = async () => {
    if (operation.current || !token || !pending.length || invalidSelection) return;
    const op = {}, auth = token; operation.current = op; setBusy(true); setNotice('');
    const isCurrent = () => mounted.current && operation.current === op && currentToken.current === auth;
    try {
      const result = await publishExerciseVideoDrafts({ drafts, listContent: () => getAdminContent(auth),
        createContent: data => createAdminContent(auth, data), isCurrent, onChange: setDrafts });
      if (!isCurrent()) return;
      const saved = result.filter(item => item.status === 'saved').length;
      setNotice(result.some(item => item.status === 'failed')
        ? `已发布 ${saved} 个影片。其余未完成，请检查网络或权限后重试；已发布的不会重复添加。`
        : `已发布 ${saved} 个影片。列表中已有的影片已跳过，原有标题保持不变。`);
      if (saved) onSaved?.();
    } catch { if (isCurrent()) setNotice('暂时无法读取影片列表，请检查网络或权限后重试。'); }
    finally { if (isCurrent()) { operation.current = null; setBusy(false); } }
  };
  const label = status => ({ pending: '待发布', saving: '正在发布…', saved: '已发布', skipped: '列表中已有，已跳过', failed: '尚未确认发布，请重试' }[status]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={styles.overlay}><View style={styles.dialog}>
      <View style={styles.header}><Text style={styles.title}>从文件存储批量添加运动影片</Text>
        <TouchableOpacity testID="exercise-video-import-close" disabled={busy} onPress={onClose} style={styles.button}><Text>关闭</Text></TouchableOpacity></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.note}>可一次选择多个影片，按选择顺序添加到现有影片后面。请先在「文件存储」上传文件。</Text>
        <Text style={styles.note}>本次统一分类（只应用到尚未提交的影片；每项仍可单独修改）</Text>
        <ExerciseVideoCategoryChoices value={batchCategory} locale={locale} disabled={busy} testID="exercise-video-batch-category"
          onChange={videoCategory => { setBatchCategory(videoCategory); setDrafts(values => applyExerciseVideoDraftCategory(values, videoCategory)); }} />
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.note}>{notice}</Text>}
        {picking && visible && !busy && <AdminMediaLibrary token={token} permissions={permissions} kind="video" multiple onSelect={select} />}
        {!picking && <TouchableOpacity testID="exercise-video-import-add" style={styles.button} disabled={busy} onPress={() => setPicking(true)}><Text>继续从文件存储选择影片</Text></TouchableOpacity>}
        {drafts.map((item, index) => <View key={item.clientRequestId} style={styles.row}>
          <Text style={styles.note}>{index + 1}. {item.name}</Text>
          <TextInput testID={`exercise-video-title-${item.mediaId}`} accessibilityLabel={`影片 ${index + 1} 标题`}
            style={styles.input} value={item.title} editable={!busy && !item.payload} maxLength={200}
            onChangeText={title => setDrafts(values => values.map(value => value.clientRequestId === item.clientRequestId && !value.payload ? { ...value, title } : value))} />
          {item.metadataSuggested && <Text style={styles.note}>已按文件名建议室内分类及关联器材，请核对后发布。</Text>}
          <AdminExerciseVideoMetadata value={item} catalog={catalog} locale={locale} disabled={busy || Boolean(item.payload)} testID={`exercise-video-${item.mediaId}`}
            onChange={updated => setDrafts(values => values.map(value => value.clientRequestId === item.clientRequestId && !value.payload ? { ...updated, metadataSuggested: false } : value))} />
          <Text style={styles.note}>{label(item.status)}{item.errorCode === 'contentRequestConflict' ? '；内容已变更，请关闭后检查影片列表。' : ''}</Text>
          {!item.payload && <TouchableOpacity testID={`exercise-video-remove-${item.mediaId}`} disabled={busy} onPress={() => setDrafts(values => values.filter(value => value.clientRequestId !== item.clientRequestId))}><Text style={styles.remove}>移除此处选择</Text></TouchableOpacity>}
        </View>)}
        {!!drafts.length && <Text style={styles.note}>新影片必须选择分类；室内关联器材可留空。已提交的影片请在列表中编辑标题、分类和关联。</Text>}
      </ScrollView>
      <View style={styles.header}><Text style={styles.note}>待完成 {pending.length} 个</Text>
        <TouchableOpacity testID="exercise-video-import-save" style={styles.primary} onPress={save}
          disabled={busy || !pending.length || invalidSelection}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{drafts.some(item => item.status === 'failed') ? '重试未完成影片' : '保存并发布所选影片'}</Text>}
        </TouchableOpacity></View>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({ overlay: { flex: 1, padding: 12, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 1180, maxHeight: '94%', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  header: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  body: { padding: 16, gap: 12 }, title: { fontSize: 18, fontWeight: '700', color: '#333' }, note: { fontSize: 14, lineHeight: 21, color: '#555' },
  button: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, alignSelf: 'flex-start' },
  row: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 8, gap: 8 }, input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 12, fontSize: 15 },
  remove: { color: '#840B1C', paddingVertical: 6 }, primary: { backgroundColor: '#840B1C', padding: 14, borderRadius: 8 }, primaryText: { color: '#fff', fontWeight: '700' } });
