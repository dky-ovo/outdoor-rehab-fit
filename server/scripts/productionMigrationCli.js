import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { readMysqlConfig } from '../src/mysqlConfig.js';
import { initializeMysqlSession } from '../src/mysqlDatabase.js';
import { buildMysqlSchema } from '../src/mysqlSchema.js';
import { applyMysqlSchema, verifyMysqlSchema } from '../src/mysqlSchemaApply.js';
import { loadSqliteExport } from '../src/sqliteExportReader.js';
import { importMysqlData } from '../src/mysqlDataImport.js';

const DATABASE = 'outdoor_fit_prod';
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function safeCode(error, fallback) {
  return /^(?:(?:PRODUCTION|IMPORT|SQLITE_EXPORT|SCHEMA|MYSQL|ER|PROTOCOL|HANDSHAKE|ERR_TLS)_[A-Z0-9_]+|EACCES|ENOENT|EEXIST|ENOSPC|EIO|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)$/.test(error?.code || '') ? error.code : fallback;
}

// No target-database override is exposed here. The original rehearsal CLIs
// remain separate and still reject outdoor_fit_prod before connecting.
export async function runProductionMigration(mode, options) {
  let connection, reserved = false, finalized = false, failure, dataset, schema, result;
  const report = { formatVersion: 1, database: DATABASE, mode, status: 'running', stage: 'input',
    generatedAtUtc: new Date().toISOString(), expectedSourceSha256: null, result: null };
  const checkpoint = () => {
    if (!reserved) return;
    const temporary = path.join(path.dirname(options.report), '.' + path.basename(options.report) + '.' + randomUUID() + '.partial');
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(report, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, options.report);
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(temporary); } catch {}
    }
  };
  try {
    if (!['schema', 'verify', 'import'].includes(mode) || !absolute(options?.audit) || !absolute(options?.report)) fail('PRODUCTION_INPUT_INVALID');
    if ((mode === 'verify' && (options.verifyOnly !== true || options.apply === true)) ||
      (mode !== 'verify' && (options.apply !== true || options.verifyOnly === true))) fail('PRODUCTION_ACTION_REQUIRED');
    if (mode === 'import' && (!absolute(options.input) || !/^[a-f0-9]{64}$/.test(options.sourceSha256 || ''))) fail('PRODUCTION_SOURCE_REQUIRED');
    report.expectedSourceSha256 = mode === 'import' ? options.sourceSha256 : null;
    const fd = fs.openSync(options.report, 'wx', 0o600);
    reserved = true;
    fs.closeSync(fd);
    checkpoint();
    report.stage = 'source_validation';
    const audit = JSON.parse(fs.readFileSync(options.audit, 'utf8'));
    if (mode === 'import') {
      dataset = loadSqliteExport(options.input, { expectedSourceSha256: options.sourceSha256, audit });
      schema = dataset.schema;
      report.sourceSha256 = dataset.sourceSha256;
      report.exportSha256 = dataset.exportSha256;
      report.rowCount = dataset.rowCount;
    } else schema = buildMysqlSchema(audit);
    report.sourceSchemaHash = schema.sourceSchemaHash;
    report.stage = 'configuration';
    const config = readMysqlConfig();
    if (config.database !== DATABASE) fail('PRODUCTION_DATABASE_REFUSED');
    report.stage = 'connection'; checkpoint();
    connection = await mysql.createConnection({ ...config, supportBigNumbers: true, bigNumberStrings: true });
    await initializeMysqlSession(connection);
    report.stage = mode; checkpoint();
    if (mode === 'import') result = await importMysqlData(connection, dataset, { expectedDatabase: DATABASE });
    else if (mode === 'verify') result = await verifyMysqlSchema(connection, schema, { expectedDatabase: DATABASE });
    else result = await applyMysqlSchema(connection, schema, { expectedDatabase: DATABASE });
  } catch (error) {
    failure = safeCode(error, 'PRODUCTION_OPERATION_FAILED');
    if (['MysqlSchemaApplyError', 'MysqlSchemaVerifyError', 'MysqlDataImportError'].includes(error?.name) && error.report?.database === DATABASE) result = error.report;
    report.errorStage = report.stage;
  } finally {
    if (connection && !result?.connectionDestroyed) {
      try { await connection.end(); }
      catch (error) {
        try { connection.destroy(); } catch {}
        if (!failure) { failure = safeCode(error, 'PRODUCTION_CLOSE_FAILED'); report.errorStage = 'close'; }
      }
    }
    report.result = result || null;
    report.status = failure ? 'failed' : ({ schema: 'applied', verify: 'verified', import: 'imported' })[mode];
    report.errorCode = failure || null;
    try { checkpoint(); finalized = reserved; }
    catch (error) {
      failure ||= safeCode(error, 'PRODUCTION_REPORT_FAILED');
      report.errorStage ||= 'report';
    }
  }
  console.log('PRODUCTION_' + String(mode).toUpperCase() + ' ' + (failure ? 'FAIL' : 'PASS'));
  console.log('TARGET_DATABASE ' + DATABASE);
  if (result?.commitStatus) console.log('DATA_COMMIT_STATUS ' + result.commitStatus);
  if (result?.rollbackStatus) console.log('DATA_ROLLBACK_STATUS ' + result.rollbackStatus);
  if (result?.fingerprint || result?.schemaFingerprint) console.log('SCHEMA_FINGERPRINT ' + (result.fingerprint || result.schemaFingerprint));
  if (dataset) {
    console.log('SOURCE_SHA256 ' + dataset.sourceSha256);
    console.log('EXPORT_SHA256 ' + dataset.exportSha256);
    console.log('ROW_COUNT ' + dataset.rowCount);
  }
  if (failure) {
    console.log('ERROR_CODE ' + failure);
    console.log('ERROR_STAGE ' + (report.errorStage || report.stage));
  }
  if (reserved) {
    console.log('REPORT_STATUS ' + (finalized ? 'FINAL' : 'INCOMPLETE'));
    console.log('REPORT_FILE ' + options.report);
  }
  return failure ? 1 : 0;
}
