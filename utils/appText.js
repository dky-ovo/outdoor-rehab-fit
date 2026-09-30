import catalog from '../constants/AppTextCatalog.json';

const entries = new Map(catalog.items.map(item => [item.key, item]));
let activeOverrides = Object.create(null);
const tokens = value => (String(value).match(/%\{[^}]+\}/g) || []).sort().join('|');
export function validAppText(value, original, kind = 'text') {
  if (typeof original !== 'string' || typeof value !== 'string' || !value.trim() || value.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
  if (tokens(value) !== tokens(original)) return false;
  if (kind === 'url') { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048) return false; } catch { return false; } }
  return true;
}
export function normalizeAppTextOverrides(payload) {
  if (payload?.version !== 1 || !payload.overrides || typeof payload.overrides !== 'object' || Array.isArray(payload.overrides)) throw new Error('invalidAppTexts');
  const clean = Object.create(null);
  for (const [key, values] of Object.entries(payload.overrides)) {
    const entry = entries.get(key);
    if (!entry || !values || typeof values !== 'object') continue;
    for (const locale of ['zh', 'en']) if (validAppText(values[locale], entry[locale], entry.kind)) (clean[key] ||= {})[locale] = values[locale];
  }
  return clean;
}
export function setAppTextOverrides(overrides) { activeOverrides = overrides || Object.create(null); }
export function appText(locale, key, defaults, parameters = {}) {
  const language = String(locale || '').startsWith('en') ? 'en' : 'zh';
  const text = activeOverrides[key]?.[language] ?? defaults[language] ?? defaults.zh ?? defaults.en ?? '';
  return String(text).replace(/%\{([^}]+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match);
}
export function applyAppTextOverrides(prefix, value, locale, overrides = activeOverrides) {
  const language = String(locale || '').startsWith('en') ? 'en' : 'zh';
  if (typeof value === 'string') return overrides[prefix]?.[language] ?? value;
  if (Array.isArray(value)) return value.map((child, index) => applyAppTextOverrides(`${prefix}.${index}`, child, language, overrides));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, applyAppTextOverrides(prefix ? `${prefix}.${key}` : key, child, language, overrides)]));
}
