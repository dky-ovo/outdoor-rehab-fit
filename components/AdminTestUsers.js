import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createAdminTestUsers, disableAdminTestUsers, getAdminTestUsers } from "../utils/api";
import { newTestUserBatch, testUsersCsv } from "../utils/adminTestUsers";

export default function AdminTestUsers(props) { return <TestUsersSession key={props.token} {...props} />; }

function TestUsersSession({ token, onChanged }) {
 const [enabled, setEnabled] = useState(false), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
 const [batches, setBatches] = useState([]), [result, setResult] = useState(null), [error, setError] = useState(""), [confirm, setConfirm] = useState(null);
 const draft = useRef(null), lock = useRef(false), alive = useRef(true);
 useEffect(() => { alive.current = true; return () => { alive.current = false; draft.current = null; }; }, []);
 useEffect(() => { let current = true; getAdminTestUsers?.(token)?.then(data => { if (current) { setEnabled(Boolean(data.enabled)); setBatches(data.batches || []); } }).catch(() => {}); return () => { current = false; }; }, [token]);
 const action = async fn => { if (lock.current) return; lock.current = true; setBusy(true); setError(""); try { await fn(); } catch (failure) { if (alive.current) setError(({ secureRandomUnavailable: "请使用 HTTPS 或本机安全浏览器打开后台。", testUserCapacityExceeded: "测试号码范围已满，请先停用不再需要的测试批次。", testUserBatchChanged: "此批次有账号资料或权限已改变，已阻止整批停用，请由管理员核对。", testUserBatchConflict: "批次标识或凭据不一致，未创建新账号。", testUserBatchDisabled: "此批次已停用。", testUsersDisabled: "服务器已关闭临时测试用户功能。" })[failure.code || failure.message] || "未能确认操作结果。请保留本页并重试同一批次，避免重复创建。"); } finally { lock.current = false; if (alive.current) setBusy(false); } };
 const create = () => action(async () => {
  draft.current ||= newTestUserBatch();
  const created = await createAdminTestUsers(token, draft.current);
  if (!alive.current) return;
  setResult(created); setBatches(items => [created, ...items.filter(item => item.batchId !== created.batchId)]); onChanged?.();
 });
 const download = () => {
  try {
   if (Platform.OS !== "web") throw new Error("secureRandomUnavailable");
   const blob = new Blob([testUsersCsv(result, draft.current)], { type: "text/csv;charset=utf-8" });
   const url = URL.createObjectURL(blob), anchor = document.createElement("a");
   anchor.href = url; anchor.download = `outdoorfit-test-users-${result.batchId}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { setError("无法导出。请在创建批次的同一浏览器页面导出，刷新或离开后密码无法恢复。"); }
 };
 const disable = () => action(async () => {
  const disabled = await disableAdminTestUsers(token, confirm.batchId);
  if (!alive.current) return;
  setBatches(items => items.map(item => item.batchId === disabled.batchId ? disabled : item)); setConfirm(null);
  if (result?.batchId === disabled.batchId) { setResult(null); draft.current = null; }
  onChanged?.();
 });
 const button = (label, onPress, disabled = false, id) => <TouchableOpacity testID={id} accessibilityRole="button" style={[styles.button, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
 if (!enabled) return null;
 return <View>{button("测试用户（临时）", () => setOpen(true), false, "admin-test-users-open")}<Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!busy) setOpen(false); }}><View style={styles.overlay}><View style={styles.dialog}>
  <Text style={styles.heading}>临时测试用户</Text><Text style={styles.note}>每批 50 个参与者账号，使用保留测试号码及测试电邮。以 CSV 中的电邮和密码登录；不会发送短信或邮件。</Text>
  <Text style={styles.warning}>密码只保留在当前页面内存，离开页面或刷新后无法恢复。创建后请立即导出 CSV，并妥善保管。</Text>
  {!!error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
  <View style={styles.row}>{!result ? button(draft.current ? "重试创建同一批次（50）" : "一键创建 50 个测试用户", create, busy, "admin-test-users-create") : <>{button("导出用户名和密码 CSV", download, busy, "admin-test-users-export")}{button("开始下一批", () => { setConfirm({ newBatch: true }); }, busy)}</>}{busy && <ActivityIndicator />}</View>
  {result && <Text style={styles.note}>本批 {result.accounts.length} 个账号已创建。批次：{result.batchId}</Text>}
  <ScrollView style={styles.list}>{batches.map(batch => <View key={batch.batchId} style={styles.batch}><Text style={styles.note}>{batch.createdAt} · {batch.accounts.length} 个账号{batch.disabledAt ? " · 已停用" : " · 使用中"}</Text><Text selectable style={styles.note}>{batch.batchId}</Text>{!batch.disabledAt && button("停用本批测试账号", () => setConfirm(batch), busy, `test-batch-disable-${batch.batchId}`)}</View>)}</ScrollView>
  {confirm && <View style={styles.warning}><Text>{confirm.newBatch ? "请确认已导出本批密码。开始下一批后，本页不能再导出上一批密码。" : `确定停用本批 ${confirm.accounts.length} 个测试账号？这些账号将无法登录，现有登录凭据立即失效，历史记录保留。`}</Text><View style={styles.row}>{button("取消", () => setConfirm(null), busy)}{button(confirm.newBatch ? "已导出，开始下一批" : "确认停用", confirm.newBatch ? () => { draft.current = null; setResult(null); setConfirm(null); } : disable, busy, "admin-test-users-confirm")}</View></View>}
  {button("关闭", () => setOpen(false), busy, "admin-test-users-close")}
 </View></View></Modal></View>;
}
const styles = StyleSheet.create({ button: { padding: 12, borderWidth: 1, borderColor: "#B78790", borderRadius: 8, backgroundColor: "#fff", alignSelf: "flex-start" }, buttonText: { color: "#840B1C", fontWeight: "700" }, disabled: { opacity: 0.45 }, overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 }, dialog: { width: "100%", maxWidth: 850, maxHeight: "94%", padding: 20, backgroundColor: "#fff", borderRadius: 16, gap: 12 }, heading: { fontSize: 23, fontWeight: "800" }, note: { fontSize: 14, lineHeight: 21, color: "#48505B" }, warning: { padding: 12, backgroundColor: "#FFF4DD", color: "#75571B", lineHeight: 22 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }, list: { flexShrink: 1 }, batch: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 12, gap: 8 } });
