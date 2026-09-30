import fs from 'node:fs';
import { adminPagination } from './adminPagination.js';
import { revalidateAdmin as defaultRevalidateAdmin } from './adminAuthorization.js';
import { AppTextConflictError, createAppTextsRepository } from './appTextsRepository.js';

export const APP_TEXT_SCHEMA = `CREATE TABLE IF NOT EXISTS app_text_overrides (
  text_key TEXT PRIMARY KEY, zh TEXT, en TEXT, revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, updated_by TEXT
);`;
const catalog = JSON.parse(fs.readFileSync(new URL('./appTextCatalog.json', import.meta.url), 'utf8'));
const entries = new Map(catalog.items.map(item => [item.key, item]));
const tokens = value => (String(value).match(/%\{[^}]+\}/g) || []).sort().join('|');
function valid(value, original, kind) {
  if (value === null) return true;
  if (typeof original !== 'string' || typeof value !== 'string' || !value.trim() || value.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || tokens(value) !== tokens(original)) return false;
  if (kind === 'url') { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048) return false; } catch { return false; } }
  return true;
}
export function registerAppTexts({ app, database, requirePermission, writeSystemLog, revalidateAdmin = defaultRevalidateAdmin }) {
  const repository = createAppTextsRepository(database);
  function item(entry, row) {
    return { ...entry, defaultZh: entry.zh, defaultEn: entry.en, zh: row?.zh ?? entry.zh, en: row?.en ?? entry.en,
      customZh: row?.zh != null, customEn: row?.en != null, revision: row?.revision || 0, updatedAt: row?.updated_at || null };
  }
  app.get('/api/app-texts', async (_request, response) => {
    const overrides = Object.create(null);
    for (const row of await repository.listPublic()) {
      if (!entries.has(row.text_key)) continue;
      if (row.zh !== null || row.en !== null) overrides[row.text_key] = { ...(row.zh !== null ? { zh: row.zh } : {}), ...(row.en !== null ? { en: row.en } : {}) };
    }
    response.set('Cache-Control', 'no-store').json({ version: 1, overrides });
  });
  app.get('/api/admin/app-texts', requirePermission('app_maintenance.text.manage'), async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const search = String(request.query.search || '').trim().toLocaleLowerCase();
    const group = String(request.query.group || '');
    const rows = new Map((await repository.listAll()).map(row => [row.text_key, row]));
    const filtered = catalog.items.map(entry => item(entry, rows.get(entry.key))).filter(entry => (!group || entry.group === group)
      && (request.query.modified !== '1' || entry.customZh || entry.customEn)
      && (!search || [entry.key, entry.group, entry.zh, entry.en].join(' ').toLocaleLowerCase().includes(search)));
    const parsed = adminPagination(request.query, filtered.length);
    const pagination = parsed.pageSize > 50 ? adminPagination({ ...request.query, pageSize: 50 }, filtered.length) : parsed;
    const offset = (pagination.page - 1) * pagination.pageSize;
    response.json({ items: filtered.slice(offset, offset + pagination.pageSize), ...pagination,
      groups: [...new Set(catalog.items.map(entry => entry.group))] });
  });
  app.patch('/api/admin/app-texts/:key', requirePermission('app_maintenance.text.manage'), async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const entry = entries.get(request.params.key), body = request.body;
    if (!entry) return response.status(404).json({ error: 'appTextNotFound' });
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER || !valid(body.zh, entry.zh, entry.kind) || !valid(body.en, entry.en, entry.kind)
      || Object.keys(body).some(key => !['revision', 'zh', 'en'].includes(key))) return response.status(400).json({ error: 'invalidAppText' });
    try {
      const outcome = await repository.update({ key: entry.key, zh: body.zh, en: body.en, revision: body.revision,
        updatedAt: new Date().toISOString(), updatedBy: request.admin.user.id }, {
        authorize: () => revalidateAdmin(database, request, 'app_maintenance.text.manage'),
        audit: () => writeSystemLog(database, request, 'app_text.update', 'app_text', entry.key,
          { revision: body.revision + 1, restored: body.zh === null && body.en === null }),
      });
      return response.json({ item: item(entry, outcome) });
    } catch (error) {
      if (error instanceof AppTextConflictError) return response.status(409).json({ error: 'appTextConflict' });
      throw error;
    }
  });
}
