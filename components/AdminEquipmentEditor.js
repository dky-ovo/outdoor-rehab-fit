import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import AdminMediaField from "./AdminMediaField";
import AdminPaginatedList from "./AdminPaginatedList";
import { equipmentCategoryLabel } from "../utils/equipmentCatalog";

const TEXT_FIELDS = ["nameZh", "nameEn", "imageUrl", "gifLeftUrl", "gifRightUrl", "videoUrl", "youtubeKey", "videoUrlZh", "videoUrlEn", "detailsZh", "detailsEn", "kinesiologyZh", "kinesiologyEn", "ptTipZh", "ptTipEn", "otTipZh", "otTipEn", "tcmZh", "tcmEn", "careTipZh", "careTipEn"];
const TEACHING = [
  ["details", "使用说明", "Instructions", "使用說明"],
  ["kinesiology", "运动学", "Kinesiology", "運動學"],
  ["ptTip", "物理治疗", "Physiotherapy", "物理治療"],
  ["otTip", "职业治疗", "Occupational therapy", "職業治療"],
  ["tcm", "中医学角度", "Chinese medicine", "中醫學角度"],
  ["careTip", "志愿者提示", "Volunteer tips", "志願者提示"],
];

function draftSignature(value) {
  if (!value) return "";
  return JSON.stringify({ ...Object.fromEntries(TEXT_FIELDS.map(field => [field, String(value[field] ?? "")])),
    additionalVideos: value.additionalVideos || [], teachingSections: value.teachingSections || [],
    categories: Array.isArray(value.categories) ? value.categories : [], sortOrder: String(value.sortOrder ?? 0),
    tcmEnabled: Boolean(value.tcmEnabled), videoLocalesEnabled: Boolean(value.videoLocalesEnabled), isActive: Boolean(value.isActive) });
}

function draftScope(value, token) {
  return value ? JSON.stringify([token, value.id ?? "new", Boolean(value.isNew)]) : null;
}

// Controlled editor: all server fields stay on the parent's original draft.
// Only the displayed field is patched; permissions and API mutations stay with
// their existing owners. No URLs are rewritten and no media file is deleted here.
export default function AdminEquipmentEditor({ value, onChange, categories = [], token, permissions = [], locale = "zh-CN", saving = false, error = "", onSave, onClose, onDelete }) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState("basic");
  const [teaching, setTeaching] = useState("details");
  const [confirmExit, setConfirmExit] = useState(false);
  const scope = draftScope(value, token);
  const currentContext = useRef({ scope, saving });
  currentContext.current = { scope, saving };
  const baseline = useRef({ scope: null, signature: "" });
  // A field edit must never reset the original baseline. Reopening a modal or
  // changing the record/account does establish a fresh original snapshot.
  if (baseline.current.scope !== scope) baseline.current = { scope, signature: draftSignature(value) };
  useEffect(() => { setTab("basic"); setTeaching("details"); setConfirmExit(false); }, [scope]);
  if (!value) return null;
  const en = locale === "en", traditional = locale === "zh-HK";
  const pick = (zh, english, hk = zh) => en ? english : traditional ? hk : zh;
  const wide = width >= 820;
  const changed = baseline.current.signature !== draftSignature(value);
  const update = patch => {
    // A file picker/upload can finish after the editor has changed record,
    // signed out, or begun saving. Never write that result into another draft.
    if (currentContext.current.saving || currentContext.current.scope !== scope) return;
    onChange?.(current => {
      if (currentContext.current.saving || currentContext.current.scope !== scope || draftScope(current, token) !== scope) return current;
      return { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    });
  };
  const close = () => {
    if (saving) return;
    if (changed) setConfirmExit(true); else onClose?.();
  };
  const switchTab = next => { setTab(next); setConfirmExit(false); };
  const field = (name, label, { long = false, enabled = true, numeric = false } = {}) => <View key={name} style={[styles.field, wide && long && styles.half]}>
    <View style={styles.fieldHeading}><Text style={styles.label}>{label}</Text>{long && <Text style={styles.count}>{String(value[name] || "").length} {pick("字", "characters")}</Text>}</View>
    <TextInput testID={`equipment-editor-${name}`} accessibilityLabel={label} style={[styles.input, long && styles.longInput, (!enabled || saving) && styles.readOnly]} multiline={long} textAlignVertical={long ? "top" : "center"} keyboardType={numeric ? "numeric" : "default"} editable={!saving && enabled} value={String(value[name] ?? (numeric ? 0 : ""))} onChangeText={text => { if (enabled) update({ [name]: text }); }} />
  </View>;
  const selectedCategories = Array.isArray(value.categories) ? value.categories : [];
  const legacyVideo = !value.videoLocalesEnabled ? value.videoUrl || value.youtubeKey || "" : "";
  const media = (name, label, kind, localized = false) => <View key={name} style={[styles.mediaCard, wide && name !== "imageUrl" && styles.half, name.startsWith("gif") && styles.gifHalf]}><AdminMediaField key={`${scope}:${name}`} label={label} kind={kind} token={token} permissions={permissions} disabled={saving} value={value[name] || ""} legacyValue={localized ? legacyVideo : ""} onChange={url => update({ [name]: url, ...(localized ? { videoLocalesEnabled: true } : {}) })} /></View>;
  const additionalVideos = value.additionalVideos || [];
  const teachingSections = value.teachingSections || [];
  const customSection = teachingSections.find(item => item.id === teaching);
  const sectionLabel = TEACHING.find(item => item[0] === teaching);
  const addId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const updateEntry = (collection, id, patch) => update(current => ({ [collection]: (current[collection] || []).map(item => item.id === id ? { ...item, ...patch } : item) }));
  const entryField = (collection, entry, name, label, long = false) => <View style={[styles.field, collection === "teachingSections" && wide && styles.half]}><Text style={styles.label}>{label}</Text><TextInput testID={`equipment-editor-${entry.id}-${name}`} accessibilityLabel={label} style={[styles.input, long && styles.longInput]} multiline={long} editable={!saving} value={entry[name] || ""} onChangeText={text => updateEntry(collection, entry.id, { [name]: text })} /></View>;
  const addVideo = () => update(current => ({ additionalVideos: [...(current.additionalVideos || []), { id: addId("video"), titleZh: "", titleEn: "", videoUrlZh: "", videoUrlEn: "" }] }));
  const addSection = () => { const id = addId("section"); update(current => ({ teachingSections: [...(current.teachingSections || []), { id, titleZh: "", titleEn: "", bodyZh: "", bodyEn: "" }] })); setTeaching(id); };
  const fullTeachingLabels = {
    details: ["使用说明", "instructions", "使用說明"], kinesiology: ["运动学说明", "kinesiology notes", "運動學說明"],
    ptTip: ["物理治疗提示", "physiotherapy tips", "物理治療提示"], otTip: ["职业治疗提示", "occupational therapy tips", "職業治療提示"],
    tcm: ["中医学说明", "Chinese medicine notes", "中醫學說明"], careTip: ["志愿者提示", "volunteer tips", "志願者提示"],
  }[teaching];
  const title = value.isNew ? pick("添加设施教学", "Add facility guide", "添加設施教學") : pick("编辑设施教学", "Edit facility guide", "編輯設施教學");
  const errorText = typeof error === "string" ? error : pick("操作未完成，请检查后重试。", "The operation failed. Review the details and try again.", "操作未完成，請檢查後重試。");
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.overlay, width < 600 && styles.compactOverlay]}>
      <View testID="equipment-editor-dialog" accessibilityViewIsModal style={styles.dialog}>
        <View style={styles.header}>
          <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.subtitle}>{value.code ? `${value.code} · ` : ""}{value.id != null ? `ID ${value.id}` : pick("新增器材", "New equipment", "新增器材")}{changed ? pick(" · 有未保存更改", " · Unsaved changes", " · 有未儲存更改") : ""}</Text></View>
          <TouchableOpacity testID="equipment-editor-close" accessibilityRole="button" accessibilityLabel={pick("关闭编辑器", "Close editor", "關閉編輯器")} disabled={saving} style={[styles.close, saving && styles.disabled]} onPress={close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
        </View>
        {!confirmExit && <View style={styles.tabs}>{[["basic", "基本信息", "Basics", "基本資料"], ["media", "图片 / GIF / 视频", "Images / GIFs / videos", "圖片 / GIF / 影片"], ["teaching", "双语教学", "Bilingual teaching", "雙語教學"]].map(([id, zh, english, hk]) => <TouchableOpacity key={id} testID={`equipment-editor-tab-${id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[styles.tab, tab === id && styles.tabActive]} onPress={() => switchTab(id)}><Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{pick(zh, english, hk)}</Text></TouchableOpacity>)}</View>}
        {!!error && <View testID="equipment-editor-error" style={styles.errorBox}><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>{errorText}</Text></View>}
        <ScrollView key={confirmExit ? "exit" : `${tab}:${teaching}`} testID="equipment-editor-body" style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          {confirmExit ? <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{pick("有尚未保存的更改", "You have unsaved changes", "有尚未儲存的更改")}</Text>
            <Text style={styles.explanation}>{pick("退出将放弃本次表单修改。已上传到文件存储的文件不会被删除，APP 中已保存的器材资料不会改变。", "Leaving discards this form's changes. Files already uploaded to storage will not be deleted, and saved facility content in the APP will not change.", "退出將放棄本次表單修改。已上傳到文件儲存的檔案不會被刪除，APP 中已儲存的器材資料不會改變。")}</Text>
          </View> : tab === "basic" ? <>
            <View style={styles.section}><Text style={styles.sectionTitle}>{pick("名称与发布状态", "Names and publishing", "名稱與發布狀態")}</Text>{field("nameZh", pick("中文名称", "Chinese name", "中文名稱"))}{field("nameEn", pick("英文名称", "English name", "英文名稱"))}
              {field("sortOrder", pick("显示顺序", "Display order", "顯示順序"), { numeric: true })}
              <TouchableOpacity testID="equipment-editor-active" accessibilityRole="switch" accessibilityState={{ checked: Boolean(value.isActive), disabled: saving }} disabled={saving} style={[styles.status, !value.isActive && styles.statusInactive, saving && styles.disabled]} onPress={() => update({ isActive: !value.isActive })}><Text style={styles.statusText}>{value.isActive ? pick("已上架（点击下架）", "Published — click to unpublish", "已上架（點擊下架）") : pick("已下架（点击上架）", "Unpublished — click to publish", "已下架（點擊上架）")}</Text></TouchableOpacity>
            </View>
            <View style={styles.section}><Text style={styles.sectionTitle}>{pick("器材分类 / AI 推荐分类", "Equipment / AI recommendation categories", "器材分類 / AI 推薦分類")}</Text><Text style={styles.explanation}>{pick("可多选，至少选择 1 个、最多 32 个准确分类。AI 会据此检索器材；分类名称可在设施教学的「分类管理」中维护。", "Select 1–32 accurate categories for AI retrieval. Category names can be maintained in Category management.", "可多選，至少選擇 1 個、最多 32 個準確分類。AI 會據此檢索器材；分類名稱可在設施教學的「分類管理」中維護。")}</Text><Text style={styles.selectionCount}>{pick(`已选择 ${selectedCategories.length} / 32`, `${selectedCategories.length} / 32 selected`, `已選擇 ${selectedCategories.length} / 32`)}</Text>
              <AdminPaginatedList items={categories} pageSize={20} locale={locale} resetKey={scope} testID="equipment-category-options">{category => { const selected = selectedCategories.includes(category.id), disabled = saving || (!selected && selectedCategories.length >= 32); return <TouchableOpacity key={category.id} testID={`equipment-editor-category-${category.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} style={[styles.category, selected && styles.categoryActive, disabled && styles.disabled]} onPress={() => { if (!disabled) update(current => { const selectedIds = current.categories || []; return { categories: selectedIds.includes(category.id) ? selectedIds.filter(id => id !== category.id) : selectedIds.length < 32 ? [...selectedIds, category.id] : selectedIds }; }); }}><Text style={[styles.categoryText, selected && styles.categoryTextActive]}>{selected ? "✓ " : ""}{equipmentCategoryLabel(category, locale)}</Text></TouchableOpacity>; }}</AdminPaginatedList>
            </View>
          </> : tab === "media" ? <>
            <View style={styles.section}><Text style={styles.sectionTitle}>{pick("图片与动作示范", "Images and movement demonstrations", "圖片與動作示範")}</Text><Text style={styles.explanation}>{pick("先上传至「文件存储」，再选择文件；保存后才会同步到 APP。移除此处选择不会删除存储文件。", "Upload in File Storage first, then select the stored file. Changes reach the APP only after saving. Clearing a selection does not delete its stored file.", "先上傳至「文件儲存」，再選擇檔案；儲存後才會同步到 APP。移除此處選擇不會刪除儲存檔案。")}</Text>
              {!value.imageUrl && value.previewSource && <View style={styles.previewReference}><Text style={styles.hint}>{pick("保存前的器材图片（参考）", "Existing facility image (reference)", "儲存前的器材圖片（參考）")}</Text><Image testID="equipment-editor-existing-image" source={value.previewSource} resizeMode="contain" style={styles.preview} /></View>}
              <View testID="equipment-image-row">{media("imageUrl", pick("器材图片", "Equipment image", "器材圖片"), "image")}</View><View testID="equipment-gif-row" style={styles.gifRow}>{media("gifLeftUrl", pick("左侧动作 GIF", "Left movement GIF", "左側動作 GIF"), "gif")}{media("gifRightUrl", pick("右侧动作 GIF", "Right movement GIF", "右側動作 GIF"), "gif")}</View>
            </View>
            <View style={styles.section}><View style={styles.fieldHeading}><Text style={[styles.sectionTitle, { flex: 1 }]}>{pick("中文及英文教学视频", "Chinese and English teaching videos", "中文及英文教學影片")}</Text><TouchableOpacity testID="equipment-editor-add-video" disabled={saving || additionalVideos.length >= 40} style={styles.secondaryButton} onPress={addVideo}><Text style={styles.buttonText}>{pick("添加视频", "Add video", "添加影片")}</Text></TouchableOpacity></View><Text style={styles.explanation}>{pick("请核对设施编号和视频语言。两个语言分别保存，不会互相覆盖。旧共用视频在首次语言替换前保持兼容；启用分语言视频后，空白语言不会回退到旧视频。", "Check the equipment code and video language. Chinese and English are saved separately. A legacy shared video remains compatible until language-specific videos are enabled; an empty language then stays empty.", "請核對設施編號和影片語言。兩個語言分別儲存，不會互相覆蓋。舊共用影片在首次語言替換前保持相容；啟用分語言影片後，空白語言不會回退到舊影片。")}</Text><View style={styles.fieldGrid}>{media("videoUrlZh", pick("中文设施教学视频", "Chinese facility teaching video", "中文設施教學影片"), "video", true)}{media("videoUrlEn", pick("英文设施教学视频", "English facility teaching video", "英文設施教學影片"), "video", true)}</View></View>
            {additionalVideos.map((entry, index) => <View key={entry.id} testID={`equipment-editor-additional-video-${index}`} style={styles.section}>
              <Text style={styles.sectionTitle}>{pick(`附加视频 ${index + 1}`, `Additional video ${index + 1}`, `附加影片 ${index + 1}`)}</Text>
              <View style={styles.fieldGrid}>{["Zh", "En"].map(language => <View key={language} style={[styles.mediaCard, wide && styles.half]}>
                {entryField("additionalVideos", entry, `title${language}`, language === "Zh" ? "中文标题" : "English title")}
                <AdminMediaField key={`${scope}:${entry.id}:${language}`} label={language === "Zh" ? "中文影片" : "English video"} kind="video" token={token} permissions={permissions} disabled={saving} value={entry[`videoUrl${language}`]} onChange={url => updateEntry("additionalVideos", entry.id, { [`videoUrl${language}`]: url })} />
              </View>)}</View><TouchableOpacity disabled={saving} style={styles.deleteButton} onPress={() => update(current => ({ additionalVideos: current.additionalVideos.filter(item => item.id !== entry.id) }))}><Text style={styles.dangerText}>{pick("移除此视频", "Remove this video", "移除此影片")}</Text></TouchableOpacity>
            </View>)}
          </> : <>
            <View style={styles.section}><View style={styles.fieldHeading}><Text style={[styles.sectionTitle, { flex: 1 }]}>{pick("选择教学栏目", "Choose a teaching section", "選擇教學欄目")}</Text><TouchableOpacity testID="equipment-editor-add-section" disabled={saving || teachingSections.length >= 32} style={styles.secondaryButton} onPress={addSection}><Text style={styles.buttonText}>{pick("新增栏目", "Add section", "新增欄目")}</Text></TouchableOpacity></View><Text style={styles.explanation}>{pick("每次编辑一个栏目，可并排核对中英文。切换栏目不会丢失修改；最后统一保存。", "Edit one section at a time and compare both languages. Switching sections keeps your changes; save them together when finished.", "每次編輯一個欄目，可並排核對中英文。切換欄目不會丟失修改；最後統一儲存。")}</Text><View style={styles.teachingTabs}>{TEACHING.map(([id, zh, english, hk]) => <TouchableOpacity key={id} testID={`equipment-editor-teaching-${id}`} accessibilityRole="tab" accessibilityState={{ selected: teaching === id }} style={[styles.teachingTab, teaching === id && styles.tabActive]} onPress={() => setTeaching(id)}><Text style={[styles.tabText, teaching === id && styles.tabTextActive]}>{pick(zh, english, hk)}</Text></TouchableOpacity>)}{teachingSections.map((entry, index) => <TouchableOpacity key={entry.id} accessibilityRole="tab" testID={`equipment-editor-teaching-${entry.id}`} style={[styles.teachingTab, teaching === entry.id && styles.tabActive]} onPress={() => setTeaching(entry.id)}><Text style={[styles.tabText, teaching === entry.id && styles.tabTextActive]}>{(en ? entry.titleEn : entry.titleZh) || pick(`新增栏目 ${index + 1}`, `New section ${index + 1}`, `新增欄目 ${index + 1}`)}</Text></TouchableOpacity>)}</View></View>
            {customSection ? <View style={styles.section}><View style={styles.fieldGrid}>{["Zh", "En"].map(language => <React.Fragment key={language}>{entryField("teachingSections", customSection, `title${language}`, language === "Zh" ? "中文栏目名称" : "English section title")}{entryField("teachingSections", customSection, `body${language}`, language === "Zh" ? "中文教学内容" : "English teaching content", true)}</React.Fragment>)}</View><TouchableOpacity disabled={saving} style={styles.deleteButton} onPress={() => { update(current => ({ teachingSections: current.teachingSections.filter(item => item.id !== teaching) })); setTeaching("details"); }}><Text style={styles.dangerText}>{pick("移除此栏目", "Remove this section", "移除此欄目")}</Text></TouchableOpacity></View> : <View style={styles.section}><Text style={styles.sectionTitle}>{pick(sectionLabel[1], sectionLabel[2], sectionLabel[3])}</Text>
              {teaching === "tcm" && <View style={styles.tcmRow}><Text style={[styles.explanation, { flex: 1 }]}>{pick("只有开启后，APP 器材详情页才显示中医学栏目。关闭不会删除已填写文字。", "Only enabled Chinese medicine sections appear in the APP. Turning this off keeps the written content.", "只有開啟後，APP 器材詳情頁才顯示中醫學欄目。關閉不會刪除已填寫文字。")}</Text><TouchableOpacity testID="equipment-editor-tcmEnabled" accessibilityRole="switch" accessibilityLabel={pick("显示中医学角度", "Show Chinese medicine section", "顯示中醫學角度")} accessibilityState={{ checked: Boolean(value.tcmEnabled), disabled: saving }} disabled={saving} style={[styles.tcmToggle, value.tcmEnabled && styles.tabActive, saving && styles.disabled]} onPress={() => update({ tcmEnabled: !value.tcmEnabled })}><Text style={[styles.tabText, value.tcmEnabled && styles.tabTextActive]}>{value.tcmEnabled ? pick("已开启", "Enabled", "已開啟") : pick("已关闭", "Disabled", "已關閉")}</Text></TouchableOpacity></View>}
              <View style={styles.fieldGrid}>{["Zh", "En"].map(language => field(`${teaching}${language}`, pick(`${language === "Zh" ? "中文" : "英文"}${fullTeachingLabels[0]}`, `${language === "Zh" ? "Chinese" : "English"} ${fullTeachingLabels[1]}`, `${language === "Zh" ? "中文" : "英文"}${fullTeachingLabels[2]}`), { long: true, enabled: teaching !== "tcm" || Boolean(value.tcmEnabled) }))}</View>
            </View>}
          </>}
        </ScrollView>
        <View testID="equipment-editor-footer" style={styles.footer}>
          {confirmExit ? <><TouchableOpacity testID="equipment-editor-continue" disabled={saving} style={[styles.secondaryButton, saving && styles.disabled]} onPress={() => { if (!saving) setConfirmExit(false); }}><Text style={styles.buttonText}>{pick("继续编辑", "Continue editing", "繼續編輯")}</Text></TouchableOpacity><TouchableOpacity testID="equipment-editor-discard" disabled={saving} style={[styles.dangerButton, saving && styles.disabled]} onPress={() => { if (!saving) onClose?.(); }}><Text style={styles.dangerText}>{pick("放弃更改并退出", "Discard changes and close", "放棄更改並退出")}</Text></TouchableOpacity></> : <>
            {!value.isNew && <TouchableOpacity testID="equipment-editor-delete" disabled={saving || !onDelete} style={[styles.deleteButton, saving && styles.disabled]} onPress={() => { if (!saving) onDelete?.(); }}><Text style={styles.dangerText}>{pick("删除器材", "Delete equipment", "刪除器材")}</Text></TouchableOpacity>}
            <View style={styles.footerActions}><TouchableOpacity testID="equipment-editor-cancel" disabled={saving} style={[styles.secondaryButton, saving && styles.disabled]} onPress={close}><Text style={styles.buttonText}>{pick("取消", "Cancel")}</Text></TouchableOpacity><TouchableOpacity testID="equipment-editor-save" disabled={saving || !onSave} style={[styles.saveButton, saving && styles.disabled]} onPress={() => { if (!saving) onSave?.(); }}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{pick("保存并同步 APP", "Save and sync APP", "儲存並同步 APP")}</Text>}</TouchableOpacity></View>
          </>}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  gifHalf: { flex: 1, width: 0 },
  gifRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  overlay: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,27,38,0.5)" }, compactOverlay: { padding: 8 },
  dialog: { width: "100%", maxWidth: 1120, height: "96%", maxHeight: 980, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", minHeight: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E5E8EC" },
  heading: { flex: 1, minWidth: 0 }, title: { fontSize: 22, fontWeight: "800", color: "#1F2937" }, subtitle: { fontSize: 13, lineHeight: 20, color: "#667085", marginTop: 5 },
  close: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#F2F4F7" }, closeText: { fontSize: 30, color: "#475467", lineHeight: 32 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, backgroundColor: "#F8FAFC", borderBottomWidth: 1, borderBottomColor: "#E5E8EC" },
  tab: { flexGrow: 1, flexBasis: 150, minHeight: 44, alignItems: "center", justifyContent: "center", padding: 10, borderRadius: 9, borderWidth: 1, borderColor: "#D8DEE7", backgroundColor: "#fff" },
  tabActive: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, tabText: { fontSize: 14, fontWeight: "700", color: "#475467", textAlign: "center", flexShrink: 1 }, tabTextActive: { color: "#fff" },
  errorBox: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#FFF1F0", borderBottomWidth: 1, borderBottomColor: "#FECACA" }, errorText: { fontSize: 14, lineHeight: 22, color: "#9B1C1C" },
  body: { flex: 1, minHeight: 0, backgroundColor: "#F5F7FA" }, bodyContent: { padding: 16, gap: 16 },
  section: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E7ED", borderRadius: 12, padding: 16, minWidth: 0 }, sectionTitle: { fontSize: 17, lineHeight: 25, color: "#263445", fontWeight: "800", marginBottom: 8 },
  explanation: { fontSize: 14, lineHeight: 23, color: "#667085", marginBottom: 10 }, hint: { fontSize: 13, lineHeight: 21, color: "#667085" }, selectionCount: { fontSize: 13, color: "#840B1C", fontWeight: "700", marginBottom: 12 },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 10 }, field: { width: "100%", minWidth: 0, marginTop: 12 }, half: { width: "48.5%", flexGrow: 1 },
  fieldHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }, label: { fontSize: 15, color: "#344054", fontWeight: "700", flexShrink: 1 }, count: { fontSize: 12, color: "#98A2B3" },
  input: { width: "100%", minHeight: 46, borderWidth: 1, borderColor: "#CCD4DF", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, lineHeight: 23, color: "#243247", backgroundColor: "#fff" }, longInput: { minHeight: 300, maxHeight: 620 }, readOnly: { backgroundColor: "#F4F5F7", color: "#667085" },
  status: { minHeight: 44, padding: 12, borderRadius: 9, backgroundColor: "#EAF6EE", alignItems: "center", marginTop: 14 }, statusInactive: { backgroundColor: "#F2F4F7" }, statusText: { color: "#345448", fontWeight: "700", fontSize: 14 },
  category: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: "#D8DEE7", borderRadius: 8, marginBottom: 8, backgroundColor: "#fff" }, categoryActive: { borderColor: "#A73649", backgroundColor: "#F9EAED" }, categoryText: { fontSize: 14, lineHeight: 21, color: "#475467" }, categoryTextActive: { color: "#840B1C", fontWeight: "700" },
  mediaCard: { width: "100%", minWidth: 0, borderWidth: 1, borderColor: "#E6EAF0", borderRadius: 10, paddingHorizontal: 14, paddingBottom: 14, backgroundColor: "#FCFDFE" }, previewReference: { marginVertical: 10 }, preview: { width: "100%", height: 150, backgroundColor: "#F5F7FA", marginTop: 8, borderRadius: 9 },
  teachingTabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, teachingTab: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderColor: "#D8DEE7", borderRadius: 9, backgroundColor: "#fff", justifyContent: "center" },
  tcmRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }, tcmToggle: { minHeight: 44, minWidth: 96, padding: 12, borderWidth: 1, borderColor: "#D8DEE7", borderRadius: 9, justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#DFE5ED" }, footerActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginLeft: "auto" },
  secondaryButton: { minHeight: 46, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 9, alignItems: "center", justifyContent: "center" }, buttonText: { fontSize: 14, fontWeight: "700", color: "#475467" },
  saveButton: { minHeight: 46, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 9, backgroundColor: "#840B1C", alignItems: "center", justifyContent: "center" }, saveText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  deleteButton: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 10, justifyContent: "center" }, dangerButton: { minHeight: 46, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: "#CF7C7C", borderRadius: 9, justifyContent: "center" }, dangerText: { fontSize: 14, fontWeight: "700", color: "#B42318" }, disabled: { opacity: 0.45 },
});
