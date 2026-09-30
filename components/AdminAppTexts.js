import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getAdminAppTexts, updateAdminAppText } from '../utils/api';
import AdminPagination from './AdminPagination';

export default function AdminAppTexts({ token, locale = 'zh-CN' }) {
  return <TextManager key={token} token={token} locale={locale} />;
}
function TextManager({ token, locale }) {
  const [result, setResult] = useState({ items: [], groups: [], total: 0, page: 1, pageSize: 20 });
  const [search, setSearch] = useState(''), [query, setQuery] = useState({ page: 1, search: '', group: '', modified: false });
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false), [editorError, setEditorError] = useState(''), [confirmExit, setConfirmExit] = useState(false);
  const sequence = useRef(0), mounted = useRef(true), savingLock = useRef(false), baseline = useRef('');
  const en = locale === 'en';
  const words = (zh, english) => en ? english : zh;
  const load = async () => {
    const request = ++sequence.current; setLoading(true); setError('');
    try { const data = await getAdminAppTexts(token, query); if (mounted.current && sequence.current === request) setResult(data); }
    catch { if (mounted.current && sequence.current === request) setError(words('文字列表暂时无法载入，请重试。', 'Unable to load text. Please retry.')); }
    finally { if (mounted.current && sequence.current === request) setLoading(false); }
  };
  useEffect(() => { load(); }, [token, query]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  const signature = value => JSON.stringify([value?.zh, value?.en, value?.customZh, value?.customEn]);
  const open = item => { baseline.current = signature(item); setDraft({ ...item }); setEditorError(''); setConfirmExit(false); setNotice(''); };
  const close = () => { if (savingLock.current) return; if (signature(draft) !== baseline.current) setConfirmExit(true); else setDraft(null); };
  const save = async () => {
    if (savingLock.current || !draft) return;
    savingLock.current = true; setSaving(true); setEditorError('');
    try {
      const response = await updateAdminAppText(token, draft.key, { revision: draft.revision, zh: draft.customZh ? draft.zh : null, en: draft.customEn ? draft.en : null });
      if (!mounted.current) return;
      setResult(current => ({ ...current, items: current.items.map(item => item.key === response.item.key ? response.item : item) }));
      setDraft(null); setNotice(words('已保存。新版 APP 重新打开或回到前台时会同步；旧版本需先完成本轮 OTA。', 'Saved. Updated apps sync when reopened or resumed. Older apps first need this OTA.'));
      load();
    } catch (failure) {
      if (mounted.current) setEditorError(failure?.status === 409 ? words('其他管理员已修改这条文字。请复制并保留您的草稿，关闭后刷新列表再核对，避免覆盖。', 'Another administrator changed this text. Copy your draft, close and refresh before editing again.')
        : failure?.status === 400 ? words('请勿留空、删除 %{…} 占位符或输入非 HTTPS 链接；最长 20,000 字。', 'Keep text non-empty and preserve %{…} placeholders. Links must use HTTPS; maximum 20,000 characters.')
        : words('未能确认保存，请重试。草稿仍保留；如提示冲突，请先刷新核对。', 'Could not confirm the save. Your draft is retained; retry or refresh if a conflict is reported.'));
    } finally { savingLock.current = false; if (mounted.current) setSaving(false); }
  };
  const button = (label, onPress, disabled = false, primary = false, testID) => <TouchableOpacity testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, primary && styles.primary, disabled && styles.disabled]}><Text style={[styles.buttonText, primary && styles.white]}>{label}</Text></TouchableOpacity>;
  return <View style={styles.panel} testID="admin-app-texts">
    <Text style={styles.heading}>{words('APP 文字与说明', 'APP text and descriptions')}</Text>
    <Text style={styles.hint}>{words('按页面分类维护标题、按钮、提示、中英文说明及文献。设施名称与教学正文请在「设施教学」编辑，首页附加卡片在「APP首页内容」编辑。这里不修改用户记录、权限、计时逻辑或 AI 生成的回答。', 'Edit titles, buttons, bilingual descriptions and references by section. Equipment text is managed in Facility Guide; added home cards in Home content. User records, permissions, timer logic and generated AI replies are not changed here.')}</Text>
    <Text style={styles.warning}>{words('风险问卷、免责声明及健康建议请由项目负责人审核后发布。修改文字不会改变问卷判定或功能规则；%{…} 为系统填入的数据，不要删改。', 'Have the project lead review safety, consent and health wording before publishing. Editing text does not change logic. Preserve %{…} data placeholders.')}</Text>
    <View style={styles.row}><TextInput accessibilityLabel={words('搜索 APP 文字', 'Search APP text')} style={styles.search} placeholder={words('搜索中文、英文或文字编号', 'Search Chinese, English or key')} value={search} onChangeText={setSearch} onSubmitEditing={() => setQuery(q => ({ ...q, search, page: 1 }))} />{button(words('搜索', 'Search'), () => setQuery(q => ({ ...q, search, page: 1 })), loading)}{button(words('刷新', 'Refresh'), load, loading)}</View>
    <View style={styles.row}>{button(words('全部页面', 'All sections'), () => setQuery(q => ({ ...q, group: '', page: 1 })), loading, !query.group)}{result.groups.map(group => <React.Fragment key={group}>{button(group, () => setQuery(q => ({ ...q, group, page: 1 })), loading, query.group === group)}</React.Fragment>)}</View>
    <View style={styles.row}>{button(words(query.modified ? '只看已修改 ✓' : '只看已修改', query.modified ? 'Customized only ✓' : 'Customized only'), () => setQuery(q => ({ ...q, modified: !q.modified, page: 1 })), loading, query.modified)}{button(words('清除筛选', 'Reset filters'), () => { setSearch(''); setQuery({ page: 1, search: '', group: '', modified: false }); }, loading)}</View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {loading ? <ActivityIndicator /> : !error && result.items.length === 0 ? <Text style={styles.hint}>{words('没有符合筛选的文字。', 'No matching text.')}</Text> : !error && result.items.map(item => <View key={item.key} style={styles.item}>
      <View style={styles.main}><Text style={styles.title}>{item.label}</Text><Text style={styles.meta}>{item.group} · {item.customZh || item.customEn ? words('已修改', 'Customized') : words('默认文字', 'Default')}</Text><Text numberOfLines={2} style={styles.preview}>{item.zh}</Text><Text numberOfLines={2} style={styles.preview}>{item.en}</Text><Text selectable style={styles.meta}>{item.key}</Text></View>
      {button(words('编辑', 'Edit'), () => open(item), false, false, `edit-text-${item.key}`)}
    </View>)}
    <AdminPagination {...result} onPageChange={page => setQuery(q => ({ ...q, page }))} disabled={loading || !!error} locale={locale} testID="admin-app-texts-pages" />
    <Modal visible={!!draft} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}><View style={styles.dialog}>
        <Text style={styles.heading}>{words('编辑 APP 文字', 'Edit APP text')}</Text>
        <Text style={styles.meta}>{draft?.group} · {draft?.key}</Text>
        <ScrollView style={styles.editorBody} keyboardShouldPersistTaps="handled">
          {['zh', 'en'].map(language => <View key={language}>
            <Text style={styles.title}>{language === 'zh' ? '繁体中文' : 'English'}</Text>
            {draft?.[language] === null ? <Text style={styles.hint}>{words('此项目没有此语言字段。', 'This entry has no field in this language.')}</Text> : <TextInput testID={`app-text-${language}`} accessibilityLabel={language === 'zh' ? '繁体中文内容' : 'English content'} editable={!saving} multiline maxLength={20000} style={styles.input} value={draft?.[language] || ''} onChangeText={value => setDraft(current => ({ ...current, [language]: value, [language === 'zh' ? 'customZh' : 'customEn']: true }))} />}
            <Text style={styles.meta}>{words('预览与默认值：', 'Default text:')}</Text><Text selectable style={styles.preview}>{draft?.[language === 'zh' ? 'defaultZh' : 'defaultEn']}</Text>
          </View>)}
          <Text style={styles.meta}>{draft?.sources?.join(' · ')}</Text>
        </ScrollView>
        {!!editorError && <Text accessibilityRole="alert" style={styles.error}>{editorError}</Text>}
        {confirmExit ? <View><Text style={styles.warning}>{words('有尚未保存的修改，确定放弃吗？', 'Discard unsaved changes?')}</Text><View style={styles.row}>{button(words('继续编辑', 'Keep editing'), () => setConfirmExit(false))}{button(words('放弃修改', 'Discard'), () => { setConfirmExit(false); setDraft(null); })}</View></View> : <View style={styles.row}>
          {button(words('恢复默认（保存后生效）', 'Restore defaults (save to apply)'), () => setDraft(current => ({ ...current, zh: current.defaultZh, en: current.defaultEn, customZh: false, customEn: false })), saving)}
          {button(words('取消', 'Cancel'), close, saving)}{button(words(saving ? '保存中…' : '保存并发布', saving ? 'Saving…' : 'Save and publish'), save, saving, true, 'app-text-save')}
        </View>}
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: '#fff', padding: 20, borderRadius: 16, minWidth: 0, width: '100%' }, heading: { fontSize: 22, fontWeight: '800', color: '#20242B', marginBottom: 10 },
  hint: { color: '#536174', fontSize: 14, lineHeight: 22, marginBottom: 14 }, warning: { color: '#75571B', backgroundColor: '#FFF7E6', padding: 12, lineHeight: 21, marginBottom: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }, search: { minWidth: 170, flexGrow: 1, flexShrink: 1, borderWidth: 1, borderColor: '#CCD2DC', padding: 12, borderRadius: 8 },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#D5DAE2', backgroundColor: '#fff', maxWidth: '100%' }, buttonText: { color: '#840B1C', fontWeight: '700', flexShrink: 1 }, primary: { backgroundColor: '#840B1C' }, white: { color: '#fff' }, disabled: { opacity: 0.5 },
  item: { borderWidth: 1, borderColor: '#E1E5EB', borderRadius: 10, padding: 14, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, main: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: '#242A33', marginVertical: 7 }, meta: { color: '#667085', fontSize: 12, lineHeight: 19 }, preview: { color: '#414B59', fontSize: 14, lineHeight: 22, marginVertical: 5 },
  success: { color: '#176543', backgroundColor: '#EAF7F0', padding: 12, lineHeight: 21 }, error: { color: '#A31328', backgroundColor: '#FFF0F2', padding: 12, lineHeight: 21, marginBottom: 10 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', padding: 16, justifyContent: 'center', alignItems: 'center' }, dialog: { backgroundColor: '#fff', padding: 20, borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '92%' }, editorBody: { flexShrink: 1, marginVertical: 12 }, input: { borderWidth: 1, borderColor: '#C7CFDC', borderRadius: 8, minHeight: 110, padding: 12, fontSize: 16, lineHeight: 24, color: '#20242B', textAlignVertical: 'top', marginBottom: 8 },
});
