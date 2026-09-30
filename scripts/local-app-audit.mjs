// Isolated local browser audit: in-memory users/data, no production connection.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = createDatabase(':memory:');
const app = createApp({ database, jwtSecret: 'isolated-local-audit-secret-not-for-production', smsMode: 'mock' });
const webRoot = path.join(root, process.argv[2] || 'dist-ai-app-content-web');
app.use(express.static(webRoot));
app.get(/.*/, (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
const server = app.listen(4180, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
for (const [phone, name, role] of [
  ['69990001', '本地测试参与者', 'participant'],
  ['69990002', '本地测试志愿者', 'volunteer'],
  ['69990003', '本地测试项目人员', 'staff'],
]) {
  const response = await fetch('http://127.0.0.1:4180/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phone, countryCode: '+852', password: 'Audit-local-2026' }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Audit fixture registration failed: ${response.status}`);
  database.prepare('UPDATE users SET profile_role = ? WHERE id = ?').run(role, result.user.id);
}
console.log('Isolated audit APP ready at http://127.0.0.1:4180 (in-memory data)');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { database.close(); process.exit(0); }));
