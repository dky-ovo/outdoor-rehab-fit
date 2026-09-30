import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createAdminRegistrationCode, getAdminRegistrationCodes, revokeAdminRegistrationCode } from "../utils/api";
import { showAlert } from "../utils/alert";

const COPY = {
  "zh-CN": {
    title: "用户注册", note: "预先登记手机号和用户类型，再将生成的注册码交给本人。APP 中填写昵称、同一手机号、推荐码和两次一致的密码即可注册，无需短信验证码。",
    roleNote: "治疗师沿用项目人员的 APP 功能，不会因此获得后台管理权限。登记姓名用于核对，APP 昵称由用户填写。",
    name: "用户名称", phone: "手机号码（含区号，例如 +85261234567）", type: "用户类型", participant: "参与者", staff: "治疗师",
    generate: "生成注册码", generating: "正在生成…", once: "请现在复制并安全交给对应用户。完整注册码仅显示这一次，列表只保留末四位。遗失时请先停用，再重新生成。",
    code: "注册码（APP 推荐码）", search: "搜索姓名或手机号", all: "全部", active: "可使用", used: "已使用", revoked: "已停用", revoke: "停用",
    confirm: "确认停用注册码？", confirmNote: "停用后此注册码不可用于注册。已注册账号不会被删除。", cancel: "取消", refresh: "刷新", previous: "上一页", next: "下一页", empty: "暂无注册码", total: "条记录", page: "页", created: "生成时间", hint: "注册码末四位",
    required: "请填写用户名称和有效手机号。", invalidRegistrationInvitation: "请检查姓名、手机号及用户类型。", phoneExists: "该手机号已有账号，请使用登录功能。",
    activeRegistrationCodeExists: "该手机号已有可用注册码。请先停用旧码，再生成新码。", registrationCodeAlreadyUsed: "该注册码已用于注册，无法停用。", registrationCodeNotFound: "该注册码不存在，请刷新。",
    denied: "当前账号无权执行此操作。", error: "操作未完成，请重试。如果生成结果未返回，请刷新检查，避免重复生成。", unavailable: "服务器尚未支持注册码，请先部署后台更新。",
  },
  "zh-HK": {
    title: "用戶註冊", note: "預先登記手機號碼和用戶類型，再將產生的註冊碼交給本人。APP 中填寫暱稱、相同手機號碼、推薦碼和兩次一致的密碼即可註冊，無需短訊驗證碼。",
    roleNote: "治療師沿用項目人員的 APP 功能，不會因此獲得後台管理權限。登記姓名用於核對，APP 暱稱由用戶填寫。",
    name: "用戶名稱", phone: "手機號碼（含區號，例如 +85261234567）", type: "用戶類型", participant: "參與者", staff: "治療師",
    generate: "產生註冊碼", generating: "正在產生…", once: "請現在複製並安全交給對應用戶。完整註冊碼只顯示這一次，列表只保留末四位。遺失時請先停用，再重新產生。",
    code: "註冊碼（APP 推薦碼）", search: "搜尋姓名或手機號碼", all: "全部", active: "可使用", used: "已使用", revoked: "已停用", revoke: "停用",
    confirm: "確認停用註冊碼？", confirmNote: "停用後此註冊碼不可用於註冊。已註冊帳號不會被刪除。", cancel: "取消", refresh: "重新整理", previous: "上一頁", next: "下一頁", empty: "暫無註冊碼", total: "條記錄", page: "頁", created: "產生時間", hint: "註冊碼末四位",
    required: "請填寫用戶名稱和有效手機號碼。", invalidRegistrationInvitation: "請檢查姓名、手機號碼及用戶類型。", phoneExists: "該手機號碼已有帳號，請使用登入功能。",
    activeRegistrationCodeExists: "該手機號碼已有可用註冊碼。請先停用舊碼，再產生新碼。", registrationCodeAlreadyUsed: "該註冊碼已用於註冊，無法停用。", registrationCodeNotFound: "該註冊碼不存在，請重新整理。",
    denied: "目前帳號無權執行此操作。", error: "操作未完成，請重試。如未收到產生結果，請重新整理檢查，避免重複產生。", unavailable: "伺服器尚未支援註冊碼，請先部署後台更新。",
  },
  en: {
    title: "User registration", note: "Register the phone number and user type first, then give the generated code to that person. In the APP, enter a nickname, the same phone number, referral code and matching passwords. No SMS verification is required.",
    roleNote: "Therapists have the existing project-staff APP features, not administration access. The registered name is for verification; users choose their own APP nickname.",
    name: "User name", phone: "Phone number (including country code, e.g. +85261234567)", type: "User type", participant: "Participant", staff: "Therapist",
    generate: "Generate registration code", generating: "Generating…", once: "Copy now and share securely with the intended person. The full code is shown only once; lists show its last four characters. Revoke and generate a new code if it is lost.",
    code: "Registration code (APP referral code)", search: "Search name or phone", all: "All", active: "Available", used: "Used", revoked: "Revoked", revoke: "Revoke",
    confirm: "Revoke this registration code?", confirmNote: "This code will no longer allow registration. Existing accounts will not be deleted.", cancel: "Cancel", refresh: "Refresh", previous: "Previous", next: "Next", empty: "No registration codes", total: "records", page: "Page", created: "Created", hint: "Last four characters",
    required: "Enter a user name and valid phone number.", invalidRegistrationInvitation: "Check the name, phone number and user type.", phoneExists: "This phone number already has an account. Please log in.",
    activeRegistrationCodeExists: "This phone number already has an available code. Revoke it before generating another.", registrationCodeAlreadyUsed: "This code has already been used and cannot be revoked.", registrationCodeNotFound: "This code no longer exists. Please refresh.",
    denied: "This account is not permitted to perform this action.", error: "The operation did not finish. Please retry. If a generated code was not returned, refresh the list before trying again.", unavailable: "The server does not support registration codes yet. Deploy the backend update first.",
  },
};

export default function AdminRegistrationCodes({ token, locale = "zh-CN", canEdit = false, refreshKey = 0 }) {
  const labels = COPY[locale] || COPY[locale === "zh" ? "zh-HK" : "zh-CN"];
  const [query, setQuery] = useState({ page: 1, search: "", status: "" });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", profileRole: "participant" });
  const [issued, setIssued] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const active = useRef({ token, canEdit, mounted: true });
  active.current.token = token; active.current.canEdit = canEdit;
  useEffect(() => { active.current.mounted = true; return () => { active.current.mounted = false; }; }, []);
  useEffect(() => {
    setForm({ name: "", phone: "", profileRole: "participant" }); setIssued(null); setMutationError(null);
  }, [token]);
  const requestKey = JSON.stringify([token, query, refreshKey, revision]);
  useEffect(() => {
    let current = true;
    if (token) getAdminRegistrationCodes(token, { ...query, pageSize: 20 }).then((data) => {
      if (current) setResult({ key: requestKey, data });
    }).catch((error) => { if (current) setResult({ key: requestKey, error }); });
    return () => { current = false; };
  }, [requestKey, token, query]);
  const latest = result?.key === requestKey ? result : null;
  const loading = Boolean(token) && !latest;
  const data = latest?.data;
  const issuedCode = issued?.token === token && canEdit ? issued : null;
  function errorLabel(error) {
    return labels[error?.code] || labels[error?.status === 401 || error?.status === 403 ? "denied" : error?.status === 404 ? "unavailable" : "error"];
  }
  async function mutate(action) {
    if (busyRef.current || !token || !canEdit) return;
    busyRef.current = true; setBusy(true); setMutationError(null);
    try {
      const value = await action();
      if (!active.current.mounted || active.current.token !== token || !active.current.canEdit) return;
      if (value.code) setIssued({ ...value, token });
      else setIssued(null);
      setQuery((previous) => ({ ...previous, page: 1 })); setRevision((previous) => previous + 1);
    } catch (error) {
      if (active.current.mounted && active.current.token === token) setMutationError(error);
    } finally {
      busyRef.current = false;
      if (active.current.mounted) setBusy(false);
    }
  }
  const generate = () => {
    if (!form.name.trim() || !/^\+?[\d\s()-]{8,25}$/.test(form.phone.trim())) {
      setMutationError({ code: "required" }); return;
    }
    return mutate(() => createAdminRegistrationCode(token, form));
  };
  const revoke = (id) => showAlert(labels.confirm, labels.confirmNote, [
    { text: labels.cancel, style: "cancel" },
    { text: labels.revoke, style: "destructive", onPress: () => {
      if (active.current.token === token && active.current.canEdit && active.current.mounted) return mutate(() => revokeAdminRegistrationCode(token, id));
    } },
  ]);
  const option = (id, label, onPress, disabled = false, selected = false) => <TouchableOpacity key={id} testID={id} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, selected && styles.selectedText]}>{label}</Text></TouchableOpacity>;
  return <View testID="admin-registration-codes">
    <View style={styles.row}><Text style={styles.title}>{labels.title}</Text>{option("registration-refresh", labels.refresh, () => setRevision((value) => value + 1), loading)}</View>
    <Text style={styles.note}>{labels.note}</Text><Text style={styles.note}>{labels.roleNote}</Text>
    {canEdit && token && <View style={styles.card}>
      <Text style={styles.label}>{labels.name}</Text><TextInput testID="registration-name" style={styles.input} value={form.name} maxLength={50} editable={!busy} onChangeText={(name) => setForm((value) => ({ ...value, name }))} />
      <Text style={styles.label}>{labels.phone}</Text><TextInput testID="registration-phone" style={styles.input} value={form.phone} maxLength={25} editable={!busy} keyboardType="phone-pad" onChangeText={(phone) => setForm((value) => ({ ...value, phone }))} />
      <Text style={styles.label}>{labels.type}</Text><View style={styles.row}>{["participant", "staff"].map((role) => option(`registration-role-${role}`, labels[role], () => setForm((value) => ({ ...value, profileRole: role })), busy, form.profileRole === role))}</View>
      {option("registration-generate", busy ? labels.generating : labels.generate, generate, busy, true)}
    </View>}
    {issuedCode && <View style={styles.success} testID="registration-issued"><Text style={styles.label}>{labels.code}</Text><Text selectable style={styles.code}>{issuedCode.code}</Text><Text style={styles.value}>{issuedCode.invitation.name} · {issuedCode.invitation.phone} · {labels[issuedCode.invitation.profileRole]}</Text><Text style={styles.note}>{labels.once}</Text></View>}
    {mutationError && <Text accessibilityRole="alert" style={styles.error}>{errorLabel(mutationError)}</Text>}
    <TextInput testID="registration-search" style={styles.input} placeholder={labels.search} value={query.search} maxLength={100} onChangeText={(search) => setQuery((value) => ({ ...value, search, page: 1 }))} />
    <View style={styles.row}>{["", "active", "used", "revoked"].map((status) => option(`registration-status-${status || "all"}`, labels[status || "all"], () => setQuery((value) => ({ ...value, status, page: 1 })), false, query.status === status))}</View>
    {loading && <ActivityIndicator color="#840B1C" />}
    {(!token || latest?.error) && <Text accessibilityRole="alert" style={styles.error}>{!token ? labels.denied : errorLabel(latest.error)}</Text>}
    {data && <><Text style={styles.note}>{data.total} {labels.total}</Text>
      {!data.codes.length && <Text style={styles.note}>{labels.empty}</Text>}
      {data.codes.map((item) => <View key={item.id} style={styles.card} testID="registration-row">
        <Text selectable style={styles.value}>{item.name} · {item.phone}</Text><Text style={styles.note}>{labels[item.profileRole]} · {labels[item.status]}</Text>
        <Text selectable style={styles.note}>{labels.hint}：{item.codeHint}</Text><Text style={styles.note}>{labels.created}：{new Date(item.createdAt).toLocaleString(locale === "en" ? "en-GB" : "zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })}</Text>
        {canEdit && item.status === "active" && option(`registration-revoke-${item.id}`, labels.revoke, () => revoke(item.id), busy)}
      </View>)}
      <View style={styles.pagination}>{option("registration-previous", labels.previous, () => setQuery((value) => ({ ...value, page: data.page - 1 })), data.page <= 1 || busy)}<Text style={styles.note}>{labels.page} {data.page} / {data.totalPages}</Text>{option("registration-next", labels.next, () => setQuery((value) => ({ ...value, page: data.page + 1 })), data.page >= data.totalPages || busy)}</View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: "#222", flex: 1 }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 },
  note: { fontSize: 14, lineHeight: 22, color: "#626772", marginBottom: 8 }, label: { fontSize: 14, color: "#444", fontWeight: "600", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D5D9DF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46, marginBottom: 14, color: "#222", backgroundColor: "#fff", fontSize: 16 },
  card: { padding: 18, marginBottom: 14, borderWidth: 1, borderColor: "#E4E7EC", backgroundColor: "#fff", borderRadius: 12 },
  button: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: "#D9DDE3", alignSelf: "flex-start", justifyContent: "center", flexShrink: 1, backgroundColor: "#fff" },
  buttonText: { color: "#840B1C", fontSize: 14, fontWeight: "700", flexShrink: 1 }, selected: { backgroundColor: "#840B1C", borderColor: "#840B1C" }, selectedText: { color: "#fff" }, disabled: { opacity: 0.45 },
  success: { borderWidth: 1, borderColor: "#81BB9D", borderRadius: 10, padding: 18, backgroundColor: "#EDF8F1", marginBottom: 16 }, code: { fontSize: 23, lineHeight: 34, fontWeight: "800", color: "#145C36", marginBottom: 10 },
  value: { fontSize: 16, lineHeight: 25, color: "#222", marginBottom: 8 }, error: { padding: 14, color: "#B42318", backgroundColor: "#FDECEC", lineHeight: 23, marginBottom: 14, borderRadius: 8 },
  pagination: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 12, marginVertical: 12 },
});
