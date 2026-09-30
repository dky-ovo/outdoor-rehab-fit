import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { readMysqlConfig } from '../src/mysqlConfig.js';
import { initializeMysqlSession } from '../src/mysqlDatabase.js';
let c;
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const cfg = readMysqlConfig({ ...process.env, MYSQL_USER: 'outdoor_fit_migrator', MYSQL_PASSWORD: input.password });
  if (cfg.database !== 'outdoor_fit_prod') throw Error('WRONG_DATABASE');
  c = await mysql.createConnection(cfg); await initializeMysqlSession(c);
  const [[row]] = await c.query('SELECT DATABASE() AS db, CURRENT_USER() AS account');
  if (row.db !== 'outdoor_fit_prod' || !row.account.startsWith('outdoor_fit_migrator@')) throw Error('WRONG_ACCOUNT');
  const [[lock]] = await c.query("SELECT GET_LOCK('outdoor-fit-account-continuity-v8', 10) AS acquired");
  if (Number(lock.acquired) !== 1) throw Error('MIGRATION_LOCK');
  for (const sql of fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').split(';').map(x => x.trim()).filter(Boolean)) await c.query(sql);
  const expected = {
    account_bookmarks: ['user_id','equipment_id','selected','version','last_operation'],
    assistant_jobs: ['id','user_id','status','request_json','result_json','error_code','created_at','completed_at'],
  };
  for (const [name, columns] of Object.entries(expected)) {
    const [found] = await c.execute('SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION', [name]);
    if (JSON.stringify(found.map(x => x.name)) !== JSON.stringify(columns)) throw Error('MIGRATION_SCHEMA_MISMATCH');
  }
  console.log('ACCOUNT_CONTINUITY_SCHEMA=PASS');
} catch (error) {
  console.error('ACCOUNT_CONTINUITY_SCHEMA=FAIL');
  console.error('ERROR_CODE=' + (/^[A-Z0-9_]{1,80}$/.test(error?.code || error?.message || '') ? error.code || error.message : 'MIGRATION_FAILED'));
  process.exitCode = 1;
} finally { await c?.end(); }
