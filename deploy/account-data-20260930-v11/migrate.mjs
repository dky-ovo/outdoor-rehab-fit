import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { readMysqlConfig } from '../src/mysqlConfig.js';
import { initializeMysqlSession } from '../src/mysqlDatabase.js';
let c;
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : value;
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const cfg = readMysqlConfig({ ...process.env, MYSQL_USER: 'outdoor_fit_migrator', MYSQL_PASSWORD: input.password });
  if (cfg.database !== 'outdoor_fit_prod') throw Error('WRONG_DATABASE');
  c = await mysql.createConnection(cfg); await initializeMysqlSession(c);
  const [[row]] = await c.query('SELECT DATABASE() AS db, CURRENT_USER() AS account');
  if (text(row.db) !== 'outdoor_fit_prod' || !text(row.account).startsWith('outdoor_fit_migrator@')) throw Error('WRONG_ACCOUNT');
  const [[lock]] = await c.query("SELECT GET_LOCK('outdoor-fit-account-data-v11', 10) AS acquired");
  if (Number(lock.acquired) !== 1) throw Error('MIGRATION_LOCK');
  const [[count]] = await c.query("SELECT COUNT(*) AS n, COALESCE(SUM(TABLE_NAME = 'account_documents'), 0) AS documents FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'");
  if (!(Number(count.n) === 40 && Number(count.documents) === 0 || Number(count.n) === 41 && Number(count.documents) === 1)) throw Error('MIGRATION_BASELINE_TABLES');
  await c.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const [columns] = await c.execute("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, EXTRA AS extra FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='account_documents' ORDER BY ORDINAL_POSITION");
  const found=columns.map(x=>[text(x.name),text(x.type),text(x.nullable),text(x.extra)]);
  const expected=[['user_id','varchar(64)','NO',''],['collection','varchar(32)','NO',''],['record_id','varchar(256)','NO',''],['value_json','mediumtext','YES',''],['deleted','tinyint','NO',''],['revision','bigint','NO',''],['last_operation','varchar(160)','NO','']];
  if (JSON.stringify(found)!==JSON.stringify(expected)) throw Error('MIGRATION_COLUMNS_MISMATCH');
  const [indexes] = await c.execute("SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS nonUnique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='account_documents' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
  const keys=Object.fromEntries(['PRIMARY','account_documents_cursor'].map(name=>[name,indexes.filter(x=>text(x.name)===name).map(x=>[text(x.col),Number(x.nonUnique)])]));
  if (JSON.stringify(keys)!==JSON.stringify({PRIMARY:[['user_id',0],['collection',0],['record_id',0]],account_documents_cursor:[['user_id',0],['collection',0],['revision',0]]})) throw Error('MIGRATION_INDEXES_MISMATCH');
  const [[table]]=await c.execute("SELECT ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='account_documents'");
  if (text(table.engine)!=='InnoDB' || text(table.collation)!=='utf8mb4_0900_bin') throw Error('MIGRATION_STORAGE_MISMATCH');
  console.log('ACCOUNT_DATA_SCHEMA=PASS');
} catch (error) {
  console.error('ACCOUNT_DATA_SCHEMA=FAIL');
  console.error('ERROR_CODE=' + (/^[A-Z0-9_]{1,80}$/.test(error?.code || error?.message || '') ? error.code || error.message : 'MIGRATION_FAILED'));
  process.exitCode = 1;
} finally { await c?.end(); }
