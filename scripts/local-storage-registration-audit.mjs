// Local-only QA server: never reads production users, tokens or database files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';
import { hashPassword } from '../server/src/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDir = fs.mkdtempSync(path.join(root, 'workspace-artifacts', 'storage-registration-browser-'));
const database = createDatabase(':memory:');
const password = await hashPassword('Local-storage-test-2026');
const now = new Date().toISOString();
for (let index = 0; index < 43; index++) {
	const id = index === 0 ? 'local-storage-admin' : `local-participant-${index}`;
	database.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,index===0?'本地测试管理员':`本地测试参与者${index}`,`+8526999${String(index).padStart(4,'0')}`,index===0?'staff':'participant',password.salt,password.hash,now,now);
}
database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES('local-storage-admin','super_admin','[]',1,?,?)").run(now,now);
const app = createApp({ database,jwtSecret:'local-storage-test-secret-not-used-in-production',smsMode:'mock',equipmentUploadDir:path.join(auditDir,'equipment-images'),mediaUploadDir:path.join(auditDir,'media-library'),mediaSeedDir:path.join(root,'workspace-artifacts/education-video-seed-20260910') });
const webRoot = path.join(root,'workspace-artifacts/exports/file-storage-bilingual-registration-20260910');
app.use(express.static(webRoot));
app.get(/.*/,(_request,response)=>response.sendFile(path.join(webRoot,'index.html')));
const server=app.listen(4186,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
console.log(JSON.stringify({url:'http://127.0.0.1:4186/admin',phone:'69990000',password:'Local-storage-test-2026',storage:auditDir,seed:app.locals.educationVideoImport}));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.closeAllConnections();server.close(()=>{database.close();process.exit(0);});});
