// Loopback-only visual QA. Uses synthetic identity, an in-memory DB and a mock
// provider. Never load production credentials, personal data or recording files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';
import { hashPassword } from '../server/src/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.resolve(root, process.argv[2] || 'workspace-artifacts/admin-microphone-ui-20260921/web');
if (!fs.existsSync(path.join(webRoot, 'index.html'))) throw new Error('Export the Web application first');
const scratch = fs.mkdtempSync(path.join(root, 'workspace-artifacts', 'admin-ui-audit-'));
const database = createDatabase(':memory:');
const password = await hashPassword('Local-admin-ui-2026');
const now = new Date().toISOString();
database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES('local-ui-operator','本地界面测试员','+85269990021','staff',?,?,?,?)").run(password.salt, password.hash, now, now);
database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES('local-ui-operator','operator',?,1,?,?)").run(JSON.stringify(['app_maintenance.equipment.manage', 'admin_assistant.use']), now, now);
database.prepare("UPDATE ai_configuration SET model='deepseek-v4-flash',api_key='local-mock-not-a-real-key' WHERE id='default'").run();
const app = createApp({ database, jwtSecret: 'local-ui-audit-secret-never-for-production', smsMode: 'mock',
  equipmentUploadDir: path.join(scratch, 'equipment'), mediaUploadDir: path.join(scratch, 'media'), mediaSeedDir: null,
  deepSeekClientFactory: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({
    reply: '这是本地模拟结果，未调用外部 AI。请审阅下方草稿。', draft: '双脚站稳，保持姿势良好。', guideReferences: [],
  }) } }] }) } } }),
});
app.use(express.static(webRoot));
app.get(/.*/, (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
const server = app.listen(4191, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
console.log(JSON.stringify({ url: 'http://127.0.0.1:4191/admin', phone: '69990021', password: 'Local-admin-ui-2026', database: 'memory', externalAiCalls: 0 }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => { database.close(); process.exit(0); }); });
