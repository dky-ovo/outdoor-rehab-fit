// Pure, fail-closed input boundary. No database, filesystem, network or logging.
// This is a conservative screen, not a claim that arbitrary free text can be
// perfectly anonymised. Only explicitly selected public teaching material is
// accepted; detected sensitive text is rejected, never silently redacted/sent.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const RULES = [
  ["email", /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["phoneOrIdentifier", /(?:\+?\d[\s().-]*){8,}/],
  ["identity", /\b[A-Z]{1,2}\d{6}\([0-9A]\)|\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/i],
  ["credentials", /(?:password|passwd|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|jwt|authorization|bearer|private[ _-]?key|client[ _-]?secret|密碼|密码|密鑰|密钥|令牌|推薦碼|推荐码|註冊碼|注册码)["']?\s*[:=：]|\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|-----BEGIN .*PRIVATE KEY-----|\bBearer\s+\S+/i],
  ["personalData", /(?:姓名|名字|電話|电话|手機|手机|電郵|电邮|住址|身份證|身份证|出生日期|用戶編號|用户编号|病歷|病历|姓名|name|phone|mobile|email|address|date\s+of\s+birth|user[_ -]?id)["']?\s*[:=：]\s*\S|(?:我叫|我的名字是|my name is)\s*\S/i],
  ["privateRecords", /(?:查詢|查询|查閱|查阅|讀取|读取|查看|列出|匯出|导出|導出|顯示|显示|read|query|list|export|show)[\s\S]{0,80}(?:用戶資料|用户资料|用戶列表|用户列表|手機號|手机号|電話號|电话号码|密碼|密码|運動紀錄|运动记录|運動日誌|运动日志|回饋|反馈|管理員帳號|管理员账号|users?\b|passwords?\b|tokens?\b|feedback\b|exercise\s+(?:logs|records))/i],
  ["opaqueSecret", /\b[A-Za-z0-9_+\/-]{40,}={0,2}\b/],
  ["databaseOrFileCommand", /\b(?:SELECT\s+.+?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|PRAGMA\s+)\b|(?:^|\s)(?:[A-Z]:\\|\/etc\/|\/proc\/|\/home\/|file:\/\/)|https?:\/\/[^\s/@]+:[^\s/@]+@/i],
];

export function screenAdminAssistantText(value) {
  if (typeof value !== "string" || CONTROL.test(value)) return { ok: false, categories: ["invalidText"] };
  const normalized = value.normalize("NFKC");
  const categories = RULES.filter(([, rule]) => rule.test(normalized)).map(([name]) => name);
  return { ok: categories.length === 0, categories };
}

const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
export function normalizeAdminAssistantInput(body, { allowPreviewToken = false } = {}) {
  if (!exactKeys(body, ["message", "history", "locale", "documentText", ...(allowPreviewToken ? ["previewToken"] : [])])) return { ok: false, error: "invalidAdminAssistantRequest" };
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200 || !["zh", "en"].includes(body.locale)) return { ok: false, error: "invalidAdminAssistantRequest" };
  const history = body.history === undefined ? [] : body.history;
  const documentText = body.documentText === undefined ? "" : body.documentText;
  if (!Array.isArray(history) || history.length > 8 || typeof documentText !== "string" || documentText.length > 30000) return { ok: false, error: "invalidAdminAssistantRequest" };
  if (history.some(item => !exactKeys(item, ["role", "content"]) || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 6000)) return { ok: false, error: "invalidAdminAssistantRequest" };
  const input = { message: body.message.trim(), history: history.map(({ role, content }) => ({ role, content })), locale: body.locale, documentText: documentText.trim() };
  const findings = [input.message, input.documentText, ...input.history.map(item => item.content)].flatMap(text => screenAdminAssistantText(text).categories);
  if (findings.length) return { ok: false, error: "adminAssistantSensitiveContent", categories: [...new Set(findings)] };
  if (allowPreviewToken && (typeof body.previewToken !== "string" || !/^[a-f0-9]{64}$/.test(body.previewToken))) return { ok: false, error: "adminAssistantPreviewRequired" };
  return { ok: true, input };
}

const FIELDS = ["details", "kinesiologyTip", "ptTip", "otTip", "tcmTip", "careTip"];
// Build a new object from explicit text fields, never spread an ORM/database row.
// Sensitive/oversized fields are omitted before a model can search/read them.
export function projectAdminAssistantCatalog(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && item.isActive !== false && !item.deletedAt && !item.deleted_at).flatMap(item => {
    if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 160 || !screenAdminAssistantText(item.name).ok) return [];
    const fields = Object.fromEntries(FIELDS.filter(field => field !== "tcmTip" || item.tcmEnabled === true).filter(field => typeof item[field] === "string" && item[field].length <= 60000 && screenAdminAssistantText(item[field]).ok).map(field => [field, item[field]]));
    return [{ id: item.id, name: item.name, categories: (Array.isArray(item.categories) ? item.categories : []).filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id)), tcmEnabled: item.tcmEnabled === true, ...fields }];
  });
}

export function projectAdminAssistantCategories(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && item.showInGuide !== false && !item.isLocked).flatMap(item => {
    if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id)) return [];
    const nameZh = typeof item.nameZh === "string" ? item.nameZh : "", nameEn = typeof item.nameEn === "string" ? item.nameEn : "";
    if (nameZh.length > 120 || nameEn.length > 120 || !screenAdminAssistantText(nameZh).ok || !screenAdminAssistantText(nameEn).ok) return [];
    return [{ id: item.id, nameZh, nameEn, showInGuide: true, isLocked: false }];
  });
}
