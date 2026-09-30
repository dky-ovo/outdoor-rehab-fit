import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { confirmAdminEquipmentDocument, getAdminEquipmentImportAudit, getAdminEquipmentImportHistory, pickEquipmentDocument, previewAdminEquipmentDocument } from "../utils/adminEquipmentImportApi";

const PERMISSION = "app_maintenance.equipment.manage";
const PAGE_SIZE = 5;
const selectionKey = (id, field) => `${id}:${field}`;
const canSelect = (field) => field.changed && !field.emptySkipped;
function Button({ title, onPress, disabled, primary = false, testID }) { return <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.button, primary && styles.primary, disabled && styles.disabled]}><Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text></TouchableOpacity>; }

export default function AdminEquipmentImport({ token, permissions = [], onImported, onAssistantDocument }) {
	const allowed = permissions.includes(PERMISSION);
	const [isOpen, setIsOpen] = useState(false); const dialogOpen = useRef(false);
	const [draft, setDraft] = useState(null); const [selected, setSelected] = useState([]); const [page, setPage] = useState(1);
	const [busy, setBusy] = useState(false); const [confirming, setConfirming] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
	const [history, setHistory] = useState(null); const [audit, setAudit] = useState(null); const [auditPage, setAuditPage] = useState(1);
	const active = useRef(null); const current = useRef({ token, allowed }); current.current = { token, allowed };
	const cancelActive = () => { const operation = active.current; active.current = null; operation?.controller.abort(); };
	const resetSession = () => { cancelActive(); setDraft(null); setSelected([]); setPage(1); setConfirming(false); setBusy(false); setError(""); setMessage(""); setHistory(null); setAudit(null); setAuditPage(1); };
	useEffect(() => { dialogOpen.current = false; setIsOpen(false); resetSession(); return () => { dialogOpen.current = false; cancelActive(); }; }, [token, allowed]);
	const valid = (operation) => dialogOpen.current && active.current === operation && current.current.token === operation.token && current.current.allowed && !operation.controller.signal.aborted;
	const start = (kind = "read") => { if (active.current || !dialogOpen.current || !token || !allowed) return null; const operation = { token, kind, controller: new AbortController() }; active.current = operation; setBusy(true); setError(""); setMessage(""); return operation; };
	const finish = (operation) => { if (active.current === operation) { active.current = null; setBusy(false); } };
	const open = () => { if (!token || !allowed || dialogOpen.current) return; resetSession(); dialogOpen.current = true; setIsOpen(true); };
	const close = () => {
		// A submitted update may already be committed on the server. Wait for its
		// response instead of implying that dismissing the window cancels a save.
		if (["confirm", "assistant"].includes(active.current?.kind)) return;
		dialogOpen.current = false; setIsOpen(false); resetSession();
	};
	const upload = async () => {
		const operation = start(); if (!operation) return;
		try {
			const file = await pickEquipmentDocument(); if (!file || !valid(operation)) return;
			setDraft(null); setSelected([]); setConfirming(false);
			const result = await previewAdminEquipmentDocument(token, file, { signal: operation.controller.signal });
			if (!valid(operation)) return; setDraft(result); setPage(1);
		} catch (failure) { if (valid(operation)) setError(failure.message || "无法预览文档。"); }
		finally { finish(operation); }
	};
	const selections = (draft?.entries || []).map((entry) => ({ id: entry.id, fields: entry.fields.filter((field) => selected.includes(selectionKey(entry.id, field.field)) && canSelect(field)).map((field) => field.field) })).filter((entry) => entry.fields.length);
	const totalFields = selections.reduce((sum, entry) => sum + entry.fields.length, 0);
	const expired = Boolean(draft && Date.now() >= draft.expiresAt);
	const apply = async () => {
		if (!draft || !confirming || !draft.canConfirm || expired || !totalFields) return;
		const operation = start("confirm"); if (!operation) return;
		try {
			const result = await confirmAdminEquipmentDocument(token, { previewId: draft.previewId, selections, idempotencyKey: draft.confirmationKey }, { signal: operation.controller.signal });
			if (!valid(operation)) return;
			setMessage(`已更新 ${result.equipmentCount} 项设施、${result.fieldCount} 个文字字段。图片、GIF、视频、分类及上下架状态没有改动。`);
			setConfirming(false); setDraft(null); setSelected([]); setHistory(null); setAudit(null);
			try { await onImported?.(result); } catch { if (valid(operation)) setError("已保存，但列表刷新失败，请刷新页面。请勿重复导入。"); }
		} catch (failure) { if (valid(operation)) { setError(failure.message || "更新未完成。网络不确定时请重试同一确认，不要重复上传。"); if (["importConflict", "importPreviewExpired"].includes(failure.code)) setConfirming(false); } }
		finally { finish(operation); }
	};
	const toggle = (key) => { setConfirming(false); setSelected((old) => old.includes(key) ? old.filter((item) => item !== key) : [...old, key]); };
	const pages = Math.max(1, Math.ceil((draft?.entries.length || 0) / PAGE_SIZE));
	const visible = draft?.entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) || [];
	const loadHistory = async (nextPage = 1) => {
		const operation = start(); if (!operation) return;
		try { const result = await getAdminEquipmentImportHistory(token, nextPage, { signal: operation.controller.signal }); if (valid(operation)) { setHistory(result); setAudit(null); } }
		catch (failure) { if (valid(operation)) setError(failure.message || "无法读取导入记录。"); } finally { finish(operation); }
	};
	const loadAudit = async (previewId) => {
		const operation = start(); if (!operation) return;
		try { const result = await getAdminEquipmentImportAudit(token, previewId, { signal: operation.controller.signal }); if (valid(operation)) { setAudit(result); setAuditPage(1); } }
		catch (failure) { if (valid(operation)) setError(failure.message || "无法读取旧内容。"); } finally { finish(operation); }
	};
	const sendToAssistant = async (entry) => {
		if (!draft?.canConfirm || expired || busy || !allowed || !onAssistantDocument) return;
		const fields = entry.fields.filter((field) => canSelect(field) && selected.includes(selectionKey(entry.id, field.field))).map(({ field, label, after }) => ({ field, label, after }));
		if (!fields.length) return;
		const operation = start("assistant"); if (!operation) return;
		try {
			await onAssistantDocument({ documentSha256: draft.documentSha256, fileName: draft.fileName, entries: [{ id: entry.id, code: entry.code, nameZh: entry.nameZh, nameEn: entry.nameEn, fields }] });
			if (valid(operation)) { finish(operation); close(); }
		} catch { if (valid(operation)) setError("无法打开 AI 文字草稿，未保存任何 AI 修改。请重试。"); }
		finally { finish(operation); }
	};
	const closeLocked = busy && ["confirm", "assistant"].includes(active.current?.kind);
	return <View testID="admin-equipment-import" style={styles.launcher}>
		<Button title="Word 导入设施教学" testID="equipment-import-open" onPress={open} disabled={!allowed || !token} />
		{!allowed && <Text style={styles.hint}>没有户外器材维护权限，不能导入。</Text>}
		{isOpen && <Modal testID="equipment-import-modal" visible transparent animationType="fade" onRequestClose={close} accessibilityLabel="Word 一键导入设施教学">
			<View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal importantForAccessibility="yes">
				<View style={styles.dialogHeader}>
					<Text accessibilityRole="header" style={styles.heading}>Word 一键导入设施教学</Text>
					<Button title="关闭" testID="equipment-import-close" disabled={closeLocked} onPress={close} />
				</View>
				{closeLocked && <Text accessibilityLiveRegion="polite" style={styles.busyNotice}>{active.current?.kind === "confirm" ? "正在确认更新，请等待结果后关闭。" : "正在打开 AI 文字草稿…"}</Text>}
				<ScrollView testID="equipment-import-scroll" style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
		<Text style={styles.hint}>使用 Exercise Machine Code and Content V24 相同格式：编号及中英名称标题，下方为「栏目／Chinese／English」三栏表格。先预览对照，再选择字段确认导入；空白字段不清空旧内容。</Text>
		<Text style={styles.hint}>关闭窗口会放弃尚未导入的预览与选择。</Text>
		<View style={styles.row}><Button title="选择 Word 并预览" testID="equipment-import-upload" onPress={upload} disabled={!allowed || busy} primary /><Button title="查看导入记录及旧内容" disabled={!allowed || busy} onPress={() => loadHistory()} />{busy && <ActivityIndicator color="#840B1C" />}</View>
		{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!message && <Text style={styles.success}>{message}</Text>}
		{draft && <>
			<Text style={styles.subheading}>{draft.fileName} · {draft.entries.length} 项设施</Text>
			<Text style={styles.hint}>预览有效至 {new Date(draft.expiresAt).toLocaleString()}。所有字段默认不勾选，请核对旧内容与新内容。后台在预览后被修改的设施会停止整批导入。</Text>
			{draft.issues.map((issue, index) => <Text key={`${issue.code}:${index}`} style={issue.severity === "error" ? styles.error : styles.hint}>{issue.severity === "error" ? "错误" : "提示"}：{issue.message}</Text>)}
			{draft.skipped.length > 0 && <Text style={styles.hint}>文档未提供正文的 {draft.skipped.length} 项设施保留原样。编号：{draft.skipped.map((entry) => entry.code).join("、")}</Text>}
			<View style={styles.row}><Button title="选择全部变更字段" disabled={busy || !draft.canConfirm} onPress={() => { setConfirming(false); setSelected(draft.entries.flatMap((entry) => entry.fields.filter(canSelect).map((field) => selectionKey(entry.id, field.field)))); }} /><Button title="清空选择" disabled={busy} onPress={() => { setConfirming(false); setSelected([]); }} />
			</View>
			{visible.map((entry) => <View key={entry.id} style={styles.entry}><Text style={styles.subheading}>{entry.sourceCode || entry.code} · {entry.nameZh}</Text><Text style={styles.hint}>{entry.nameEn} · APP ID {entry.id}</Text>
				{entry.fields.map((field) => <View key={field.field} style={styles.field}>
					<TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(selectionKey(entry.id, field.field)), disabled: busy || !canSelect(field) || !draft.canConfirm }} disabled={busy || !canSelect(field) || !draft.canConfirm} onPress={() => toggle(selectionKey(entry.id, field.field))} style={styles.row}><Text style={styles.checkbox}>{selected.includes(selectionKey(entry.id, field.field)) ? "☑" : "☐"}</Text><Text style={styles.label}>{field.label} · {field.emptySkipped ? "空白，保留旧内容" : field.changed ? "有变更" : "内容相同"}</Text></TouchableOpacity>
					{field.changed && <View style={styles.diff}><View style={styles.diffColumn}><Text style={styles.label}>当前内容</Text><Text selectable style={styles.prose}>{field.before || "（无）"}</Text></View><View style={styles.diffColumn}><Text style={styles.label}>文档内容</Text><Text selectable style={styles.prose}>{field.after || "（空白，不导入）"}</Text></View></View>}
				</View>)}
				{onAssistantDocument && <Button title={`AI 辅助核对 ${entry.code} 所选文字（不保存）`} disabled={busy || !draft.canConfirm || expired || !entry.fields.some((field) => canSelect(field) && selected.includes(selectionKey(entry.id, field.field)))} onPress={() => sendToAssistant(entry)} />}
			</View>)}
			<View style={styles.row}><Button title="上一页" disabled={busy || page <= 1} onPress={() => setPage((value) => value - 1)} /><Text style={styles.hint}>第 {page} / {pages} 页 · 每页 {PAGE_SIZE} 项</Text><Button title="下一页" disabled={busy || page >= pages} onPress={() => setPage((value) => value + 1)} /></View>
			<Text style={styles.hint}>已选择 {selections.length} 项设施、{totalFields} 个字段。未选择的字段不会改动。</Text>
			{expired && <Text style={styles.error}>预览已过期，请重新选择文档。</Text>}
			{!confirming ? <Button title="核对并导入所选字段" testID="equipment-import-review" disabled={busy || !draft.canConfirm || expired || !totalFields} onPress={() => setConfirming(true)} primary /> : <View style={styles.confirm}><Text style={styles.label}>确认将以上 {totalFields} 个字段更新到后台并同步 APP？本次操作会保存旧文字供审计。</Text><View style={styles.row}><Button title="取消" disabled={busy} onPress={() => setConfirming(false)} /><Button title="确认更新" testID="equipment-import-confirm" disabled={busy || expired} onPress={apply} primary /></View></View>}
		</>}
		{history && <View style={styles.entry}><Text style={styles.subheading}>导入记录（只读）</Text><Text style={styles.hint}>可查看确认导入时的旧内容，不会自动回滚或覆盖后续修改。</Text>
			{history.items.map((item) => <View key={item.previewId} style={styles.row}><Text style={styles.label}>{item.fileName} · {item.equipmentCount} 项 / {item.fieldCount} 字段 · {new Date(item.createdAt).toLocaleString()}</Text><Button title="查看旧内容" disabled={busy} onPress={() => loadAudit(item.previewId)} /></View>)}
			{!history.total && <Text style={styles.hint}>暂无已确认的导入记录。</Text>}
			<View style={styles.row}><Button title="上一批记录" disabled={busy || history.page <= 1} onPress={() => loadHistory(history.page - 1)} /><Text style={styles.hint}>第 {history.page} / {Math.max(1, Math.ceil(history.total / history.pageSize))} 页 · 每页 {history.pageSize} 条</Text><Button title="下一批记录" disabled={busy || history.page * history.pageSize >= history.total} onPress={() => loadHistory(history.page + 1)} /></View>
		</View>}
		{audit && <View style={styles.entry}><Text style={styles.subheading}>旧内容对照 · {new Date(audit.updatedAt).toLocaleString()}</Text>
			{audit.changes.slice((auditPage - 1) * PAGE_SIZE, auditPage * PAGE_SIZE).map((change) => <View key={`${change.id}:${change.field}`} style={styles.field}><Text style={styles.label}>APP ID {change.id} · {change.label || change.field}</Text><View style={styles.diff}><View style={styles.diffColumn}><Text style={styles.label}>导入前</Text><Text selectable style={styles.prose}>{change.effectiveBefore || change.before || "（无）"}</Text></View><View style={styles.diffColumn}><Text style={styles.label}>当次导入后</Text><Text selectable style={styles.prose}>{change.after}</Text></View></View></View>)}
			<View style={styles.row}><Button title="上一页旧内容" disabled={busy || auditPage <= 1} onPress={() => setAuditPage((value) => value - 1)} /><Text style={styles.hint}>第 {auditPage} / {Math.max(1, Math.ceil(audit.changes.length / PAGE_SIZE))} 页</Text><Button title="下一页旧内容" disabled={busy || auditPage * PAGE_SIZE >= audit.changes.length} onPress={() => setAuditPage((value) => value + 1)} /></View>
		</View>}
				</ScrollView>
			</View></View>
		</Modal>}
	</View>;
}
const styles = StyleSheet.create({ launcher: { alignItems: "flex-start", minWidth: 0, gap: 8 }, overlay: { flex: 1, padding: 12, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)" }, dialog: { width: "100%", maxWidth: 900, maxHeight: "92%", flexShrink: 1, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" }, dialogHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderColor: "#EAECF0" }, scroll: { flexShrink: 1 }, container: { minWidth: 0, padding: 16, gap: 12 }, busyNotice: { paddingHorizontal: 16, paddingVertical: 10, color: "#840B1C", backgroundColor: "#FFF7ED", fontSize: 14, lineHeight: 22 }, heading: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: "800", color: "#333" }, subheading: { fontSize: 17, fontWeight: "700", color: "#333" }, hint: { color: "#667085", fontSize: 14, lineHeight: 22 }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }, button: { minHeight: 44, maxWidth: "100%", flexShrink: 1, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 8, backgroundColor: "#fff" }, primary: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, buttonText: { color: "#840B1C", fontWeight: "700", flexShrink: 1 }, primaryText: { color: "#fff" }, disabled: { opacity: .45 }, error: { color: "#B42318", fontSize: 14, lineHeight: 22 }, success: { color: "#26734D", fontSize: 15, lineHeight: 24 }, entry: { borderWidth: 1, borderColor: "#E0E3E8", borderRadius: 10, padding: 14, gap: 8 }, field: { borderTopWidth: 1, borderColor: "#E8EAED", paddingTop: 10, gap: 8 }, checkbox: { color: "#840B1C", fontSize: 24 }, label: { color: "#344054", fontSize: 14, lineHeight: 22, fontWeight: "700", flexShrink: 1 }, diff: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, diffColumn: { flexBasis: 300, flexGrow: 1, flexShrink: 1, minWidth: 0, backgroundColor: "#F8F9FB", borderRadius: 6, padding: 10 }, prose: { fontSize: 14, color: "#333", lineHeight: 23 }, confirm: { padding: 12, backgroundColor: "#FFF7ED", borderRadius: 8, gap: 10 } });
