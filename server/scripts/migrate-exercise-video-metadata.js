import fs from 'node:fs';
import { checkServerIdentity } from 'node:tls';
import mysql from 'mysql2/promise';
import { readMysqlConfig } from '../src/mysqlConfig.js';
import { initializeMysqlSession } from '../src/mysqlDatabase.js';
import { applyExerciseVideoMetadataSchema, inspectExerciseVideoMetadataSchema } from '../src/exerciseVideoMetadataSchema.js';

const fail = code => { throw Object.assign(new Error(code), { code }); };
let connection;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--apply', '--check-only'].includes(args[0])) fail('EXERCISE_VIDEO_SCHEMA_ACTION_REQUIRED');
  const apply = args[0] === '--apply';
  let password;
  if (apply) {
    // The installer sends one private JSON object over stdin. Nothing is echoed.
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8');
      if (input.length > 16384) fail('EXERCISE_VIDEO_SCHEMA_INPUT_INVALID');
    }
    let parsed;
    try { parsed = JSON.parse(input); } catch { fail('EXERCISE_VIDEO_SCHEMA_INPUT_INVALID'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join(',') !== 'password') fail('EXERCISE_VIDEO_SCHEMA_INPUT_INVALID');
    password = parsed.password;
  } else {
    const file = process.env.MYSQL_PASSWORD_FILE;
    if (!file || !fs.lstatSync(file).isFile()) fail('EXERCISE_VIDEO_SCHEMA_SECRET_FILE_REQUIRED');
    password = fs.readFileSync(file, 'utf8');
    if (process.env.MYSQL_USER !== 'outdoor_fit_app') fail('EXERCISE_VIDEO_SCHEMA_ACCOUNT_REFUSED');
  }
  if (typeof password !== 'string' || !password || password.length > 8192 || /[\0\r\n]/.test(password)) fail('EXERCISE_VIDEO_SCHEMA_PASSWORD_INVALID');
  const user = apply ? 'outdoor_fit_migrator' : 'outdoor_fit_app';
  const config = readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password, MYSQL_USER: user });
  password = undefined;
  if (config.database !== 'outdoor_fit_prod') fail('EXERCISE_VIDEO_DATABASE_REFUSED');
  connection = await mysql.createConnection(config);
  const socket = connection.connection.stream;
  if (!socket?.encrypted || !socket.authorized || checkServerIdentity(config.host, socket.getPeerCertificate(true))) fail('EXERCISE_VIDEO_SCHEMA_TLS_REQUIRED');
  await initializeMysqlSession(connection);
  const [[account]] = await connection.query('SELECT CURRENT_USER() AS account');
  const accountName = Buffer.isBuffer(account?.account) ? account.account.toString('utf8') : String(account?.account || '');
  if (accountName.split('@')[0] !== user) fail('EXERCISE_VIDEO_SCHEMA_ACCOUNT_REFUSED');
  const result = await (apply ? applyExerciseVideoMetadataSchema(connection) : inspectExerciseVideoMetadataSchema(connection));
  await connection.end(); connection = undefined;
  console.log(JSON.stringify(result));
} catch (error) {
  // Never print driver SQL, supplied JSON, certificates or credentials.
  const code = /^EXERCISE_VIDEO_[A-Z_]+$/.test(error?.code || '') ? error.code : 'EXERCISE_VIDEO_SCHEMA_OPERATION_FAILED';
  console.error('ERROR_CODE=' + code);
  process.exitCode = 1;
} finally {
  if (connection) { try { await connection.end(); } catch { connection.destroy(); } }
}
