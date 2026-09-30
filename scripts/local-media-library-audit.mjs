// Disposable, loopback-only QA. No production users, credentials, or storage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';
import { hashPassword } from '../server/src/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDir = fs.mkdtempSync(path.join(root, 'workspace-artifacts', 'media-browser-audit-'));
const database = createDatabase(':memory:');
const password = await hashPassword('Media-local-test-2026');
const now = new Date().toISOString();
database.prepare("INSERT INTO users (id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES ('local-media-admin','本地测试管理员','+85269990009','staff',?,?,?,?)").run(password.salt,password.hash,now,now);
database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES ('local-media-admin','operator',?,1,?,?)").run(JSON.stringify(['app_maintenance.home.manage','app_maintenance.equipment.manage','app_maintenance.files.manage']),now,now);
const app = createApp({ database, jwtSecret: 'local-media-test-secret-not-for-production', smsMode: 'mock',
  equipmentUploadDir: path.join(auditDir, 'equipment-images'), mediaUploadDir: path.join(auditDir, 'media-library'),
  mediaSeedDir: path.join(root, 'workspace-artifacts/media-seed-20260909-v2') });
const webRoot = path.join(root, process.argv[2] || 'workspace-artifacts/exports/timer-media-library-20260909');
app.use(express.static(webRoot));
app.get(/.*/, (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
const server = app.listen(4185, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
console.log(`Local-only media audit ready at http://127.0.0.1:4185/admin; storage ${auditDir}`);
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => { database.close(); process.exit(0); }); });
