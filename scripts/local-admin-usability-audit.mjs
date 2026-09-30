// Isolated, loopback-only visual QA. All identities/content below are fictional.
// Usage: node scripts/local-admin-usability-audit.mjs <fresh-Web-directory>
// Never import server/index.js, dotenv, credentials or an existing database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';
import { hashPassword } from '../server/src/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { webInventory } = createRequire(import.meta.url)('./verify-admin-usability-release.cjs');
export const QA_HOST = '127.0.0.1';
export const QA_PORT = 4193;
export const QA_ACCOUNTS = Object.freeze([
  { id: 'qa-usability-admin', name: '本地测试管理员（虚构）', phone: '69990301', role: 'super_admin', permissions: [] },
  { id: 'qa-usability-operator', name: '本地受限操作员（虚构）', phone: '69990302', role: 'operator', permissions: ['app_maintenance.equipment.manage', 'feedback.read'] },
]);
export const QA_PASSWORD = 'Local-QA-2026!';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// createApp uses the injected AI client below. Also reject unrelated outbound
// fetch calls (e.g. clicking the facility-source sync button during visual QA).
// Only this standalone QA process installs the guard, not the production app.
export function installQaFetchGuard() {
  const original = globalThis.fetch;
  const guarded = async (input, options) => {
    const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (address.protocol !== 'http:' || address.hostname !== QA_HOST || address.port !== String(QA_PORT)) {
      throw new Error('External requests are disabled in local admin visual QA');
    }
    return original(input, options);
  };
  globalThis.fetch = guarded;
  return () => { if (globalThis.fetch === guarded) globalThis.fetch = original; };
}

export async function createAdminUsabilityAudit(webDirectory) {
  if (!webDirectory) throw new Error('Provide the frozen, Web-only export directory explicitly');
  const webRoot = path.resolve(root, webDirectory);
  // Reject accidentally serving the repository, secrets or a mixed native export.
  webInventory(webRoot);
  const artifactRoot = path.join(root, 'workspace-artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  if (fs.lstatSync(artifactRoot).isSymbolicLink()) throw new Error('Unsafe audit scratch root');
  const scratch = fs.mkdtempSync(path.join(artifactRoot, 'admin-usability-audit-'));
  const equipmentUploadDir = path.join(scratch, 'equipment');
  const mediaUploadDir = path.join(scratch, 'media');
  fs.mkdirSync(equipmentUploadDir);
  fs.mkdirSync(mediaUploadDir);
  const uploadSample = path.join(scratch, '本地测试上传文件-无真实资料.txt');
  fs.writeFileSync(uploadSample, 'Synthetic local admin upload test. No personal or production information.\n', { flag: 'wx' });
  const database = createDatabase(':memory:');
  let closed = false;
  const close = () => { if (!closed) { closed = true; database.close(); } };
  try {
    const password = await hashPassword(QA_PASSWORD);
    const now = Date.now();
    const stamp = offset => new Date(now - offset * 60000).toISOString();
    const insertUser = database.prepare(`INSERT INTO users
      (id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const account of QA_ACCOUNTS) {
      insertUser.run(account.id, account.name, `+852${account.phone}`, `${account.id}@example.invalid`, 'staff', password.salt, password.hash, stamp(0), stamp(0));
      database.prepare(`INSERT INTO admin_accounts
        (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`)
        .run(account.id, account.role, JSON.stringify(account.permissions), stamp(0), stamp(0));
    }
    // Twenty-three lightweight rows make the normal 20-item pagination visible.
    for (let index = 1; index <= 23; index++) {
      const id = `qa-person-${index}`;
      insertUser.run(id, index === 1 ? '本地虚构参与者｜用于测试很长姓名时操作按钮与表格的换行展示' : `虚构测试用户 ${index}`,
        `+852${69991000 + index}`, `qa-person-${index}@example.invalid`, index % 5 === 0 ? 'volunteer' : 'participant', password.salt, password.hash, stamp(index), stamp(index));
      database.prepare(`INSERT INTO feedback
        (id,submission_id,content_hash,user_id,submitter_type,name,email,subject,message,locale,status,notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`qa-feedback-${index}`, `qa-feedback-submission-${index}`, sha256(`synthetic-${index}`), id, 'registered',
          `虚构反馈者 ${index}`, `qa-feedback-${index}@example.invalid`, index === 1 ? '这是一条用于检查后台列表布局和查看详情按钮是否被挤出的很长测试标题｜所有内容均为虚构，仅用于本机界面检查' : `后台界面检查反馈 ${index}`,
          index === 1 ? '本条仅检查长段落自动换行、处理状态和内部备注位置。\n'.repeat(12) : '这是本机生成的虚构反馈，不代表任何真实用户意见。',
          index % 2 ? 'zh' : 'en', ['new', 'in_progress', 'resolved'][(index - 1) % 3], index % 3 === 0 ? '虚构处理备注，仅本地可见。' : '', stamp(index), stamp(index));
    }
    const equipment = database.prepare(`INSERT INTO app_equipment_items
      (id,is_custom,name_zh,name_en,categories_json,details_zh,details_en,sort_order,is_active,created_by,created_at,updated_at)
      VALUES (?,1,?,?,?,?,?,?,?,?,?,?)`);
    equipment.run('qa-custom-long-title', '本地测试器材｜长标题自动换行与编辑按钮对齐专用（并非真实设施）',
      'Synthetic local exercise facility with a deliberately long title for administration layout checks', JSON.stringify(['mobility', 'lower']),
      '本地布局测试文字，非真实运动或医疗建议。\n请勿作为正式教学内容发布。', 'Synthetic layout text only. Not exercise or medical advice.', -100, 1, QA_ACCOUNTS[0].id, stamp(0), stamp(0));
    equipment.run('qa-custom-disabled', '本地测试器材（已下架）', 'Synthetic unpublished facility', JSON.stringify(['balance']),
      '仅用于检查已下架状态。', 'Local unpublished-state fixture only.', -99, 0, QA_ACCOUNTS[0].id, stamp(1), stamp(1));
    // Synthetic video research rows verify that names, not numeric IDs, render.
    for (const eventName of ['video.play', 'video.completed']) database.prepare('INSERT INTO research_events(id,participant_id,event_name,event_time,app_version,metadata_json) VALUES(?,?,?,?,?,?)')
      .run(`qa-video-${eventName}`, 'qa-person-1', eventName, stamp(0), 'local-qa', JSON.stringify({ screen: 'outdoor.detail', contentId: '0', equipmentId: '0' }));
    const folders = [['qa-folder-root', '', '本地测试文件夹（虚构内容）'], ['qa-folder-child', 'qa-folder-root', '很长的子文件夹名称｜检查面包屑和文件列表自适应宽度']];
    for (const [id, parent, name] of folders) database.prepare('INSERT INTO media_folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, parent, name, stamp(0), stamp(0));
    const media = database.prepare(`INSERT INTO media_files
      (id,url,name,mime_type,kind,size_bytes,category_id,source,storage_name,sha256,created_by,created_at,updated_at,folder_id)
      VALUES (?,?,?,'text/plain','file',?,'other','upload',?,?,?,?,?,?)`);
    for (let index = 1; index <= 6; index++) {
      const id = `qa-text-${index}`, storageName = `${crypto.randomUUID()}.bin`;
      const bytes = Buffer.from(`Harmless synthetic text fixture ${index}. No real documents or personal information.\n`);
      fs.writeFileSync(path.join(mediaUploadDir, storageName), bytes, { flag: 'wx' });
      media.run(id, `/api/media/${id}/${storageName}`, index === 1 ? '用于检查窄屏下长文件名不会覆盖工具栏以及详情按钮的本地虚构测试文件-20260923.txt' : `本地虚构文本资料-${index}.txt`,
        bytes.length, storageName, sha256(bytes), QA_ACCOUNTS[0].id, stamp(index), stamp(index), index <= 3 ? '' : index <= 5 ? 'qa-folder-root' : 'qa-folder-child');
    }
    database.prepare("UPDATE ai_configuration SET model='deepseek-v4-flash',api_key='local-mock-not-a-real-key' WHERE id='default'").run();
    let mockAiCalls = 0;
    const api = createApp({ database, jwtSecret: crypto.randomBytes(32).toString('hex'), smsMode: 'mock', equipmentUploadDir, mediaUploadDir, mediaSeedDir: null,
      deepSeekClientFactory: () => ({ chat: { completions: { create: async () => {
        mockAiCalls++;
        return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: '这是本地模拟回复，未调用外部 AI。请检查页面布局与按钮。', draft: '这段虚构文字仅用于测试草稿显示，不应发布为教学。', guideReferences: [] }) } }] };
      } } } }),
    });
    const app = express();
    app.disable('x-powered-by');
    app.use((request, response, next) => {
      // Prevent a test browser from loading remote avatars, video players or APIs.
      response.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'");
      response.set('Cache-Control', 'no-store');
      response.set('X-Local-Synthetic-QA', 'admin-usability');
      if (![`${QA_HOST}:${QA_PORT}`, `localhost:${QA_PORT}`].includes(request.headers.host)) return response.status(403).json({ error: 'localQaHostRequired' });
      next();
    });
    app.use(api);
    app.use('/api', (_request, response) => response.status(404).json({ error: 'unknownLocalQaApi' }));
    app.use(express.static(webRoot, { dotfiles: 'deny', etag: false, maxAge: 0 }));
    app.get(/.*/, (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
    return { app, database, close, scratch, uploadSample, webRoot, stats: () => ({ database: 'memory', users: 25, feedback: 23, customEquipment: 2, syntheticFiles: 6, mockAiCalls, externalAiCalls: 0 }) };
  } catch (error) { close(); throw error; }
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/local-admin-usability-audit.mjs <fresh-Web-directory>');
  const restoreFetch = installQaFetchGuard();
  const audit = await createAdminUsabilityAudit(process.argv[2]);
  const server = audit.app.listen(QA_PORT, QA_HOST);
  try { await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); }
  catch (error) { audit.close(); restoreFetch(); throw error; }
  console.log(JSON.stringify({ url: `http://${QA_HOST}:${QA_PORT}/admin`, webRoot: audit.webRoot, scratch: audit.scratch, uploadSample: audit.uploadSample,
    accounts: QA_ACCOUNTS.map(({ name, phone, role, permissions }) => ({ name, phone, password: QA_PASSWORD, role, permissions })), ...audit.stats() }, null, 2));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    server.closeAllConnections();
    server.close(() => { audit.close(); restoreFetch(); console.log(`Synthetic scratch retained for review: ${audit.scratch}`); process.exit(0); });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
