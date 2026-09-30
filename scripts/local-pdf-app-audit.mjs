// Local-only regression fixture. Never connects to the production database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';
import { hashPassword } from '../server/src/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.resolve(root, process.argv[2] || 'workspace-artifacts/exports/pdf-app-timer-20260911');
const port = Number(process.argv[3] || 4189);
if (!fs.existsSync(path.join(webRoot, 'index.html'))) throw new Error('Export the reviewed local web build first.');
const auditDir = fs.mkdtempSync(path.join(root, 'workspace-artifacts/pdf-app-browser-'));
const database = createDatabase(':memory:');
const password = await hashPassword('Local-pdf-audit-2026');
const now = new Date().toISOString();
for (const [id, name, phone, role] of [
  ['pdf-audit-admin', '本地后台测试员', '+85269991100', 'staff'],
  ['pdf-audit-participant', '本地参与者', '+85269991101', 'participant'],
]) database.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(id, name, phone, role, password.salt, password.hash, now, now);
database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES('pdf-audit-admin','super_admin','[]',1,?,?)").run(now, now);
const app = createApp({ database, jwtSecret: 'isolated-pdf-app-audit-not-production', smsMode: 'mock',
  equipmentUploadDir: path.join(auditDir, 'equipment'), mediaUploadDir: path.join(auditDir, 'media'),
  mediaSeedDir: path.join(auditDir, 'no-media-seed') });
app.use(express.static(webRoot));
app.get(/.*/, (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
const server = app.listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}`, admin: '69991100', participant: '69991101', password: 'Local-pdf-audit-2026', storage: auditDir }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.closeAllConnections(); server.close(() => { database.close(); process.exit(0); });
});
