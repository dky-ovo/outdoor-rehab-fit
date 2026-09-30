import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readMysqlConfig } from '../src/mysqlConfig.js';
import { createMysqlDatabase } from '../src/mysqlDatabase.js';
import { buildMysqlSchema } from '../src/mysqlSchema.js';
import { verifyMysqlSchema } from '../src/mysqlSchemaApply.js';
import { saveLearningProgress, participantLearningProgress } from '../src/learningProgress.js';
import { createAppTextsRepository } from '../src/appTextsRepository.js';
import { createRegistrationRepository } from '../src/registrationRepository.js';
import { revalidateAdmin } from '../src/adminAuthorization.js';
import { writeSystemLog } from '../src/systemLog.js';

const DATABASE = 'outdoor_fit_test';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function requireCondition(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function safeCode(error, fallback) {
  return /^(?:(?:BUSINESS|MYSQL|SCHEMA|ER|PROTOCOL|HANDSHAKE|ERR_TLS|APP_TEXT|REGISTRATION|SYSTEM_LOG)_[A-Z0-9_]+|EACCES|ENOENT|EEXIST|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)$/.test(error?.code || '') ? error.code : fallback;
}
const unknownCommit = error => error?.code === 'MYSQL_COMMIT_OUTCOME_UNKNOWN';
function count(value) {
  requireCondition((typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') && /^\d+$/.test(String(value)), 'BUSINESS_COUNT_INVALID');
  const result = Number(value);
  requireCondition(Number.isSafeInteger(result), 'BUSINESS_COUNT_INVALID');
  return result;
}
function writeResult(result, expected = 1) {
  requireCondition(result?.warningStatus === 0 && result.affectedRows === expected, 'BUSINESS_WRITE_INVALID');
}
function fixtures(runId) {
  return {
    ids: { adminUserIds: [randomUUID(), randomUUID()], learningUserId: randomUUID(), equipmentId: randomUUID(), invitationId: randomUUID(),
      appTextKey: 'migration_probe_' + runId, registrationPhone: 'probe:' + runId + ':register', registeredUserIds: [] },
    runId, date: new Date().toISOString().slice(0, 10),
    phones: ['admin-a', 'admin-b', 'learning'].map(label => 'probe:' + runId + ':' + label),
    codeHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    passwordRecord: { salt: randomBytes(16).toString('hex'), hash: randomBytes(64).toString('hex') },
  };
}

async function verifyDatabaseSchema(database, schema) {
  return database.transaction(async tx => verifyMysqlSchema({ query: async (sql, values = []) => [await tx.all(sql, values), []] }, schema, { write() {} }));
}

async function createFixtures(database, fixture) {
  const { ids, phones, passwordRecord } = fixture;
  const users = [...ids.adminUserIds, ids.learningUserId], now = new Date().toISOString();
  return database.transaction(async tx => {
    const checks = [
      ['SELECT COUNT(*) AS count FROM users WHERE id IN (?,?,?) OR phone IN (?,?,?,?)', [...users, ...phones, ids.registrationPhone]],
      ['SELECT COUNT(*) AS count FROM app_equipment_items WHERE id=?', [ids.equipmentId]],
      ['SELECT COUNT(*) AS count FROM registration_codes WHERE id=? OR code_hash=? OR phone=?', [ids.invitationId, fixture.codeHash, ids.registrationPhone]],
      ['SELECT COUNT(*) AS count FROM app_text_overrides WHERE text_key=?', [ids.appTextKey]],
      ['SELECT COUNT(*) AS count FROM system_logs WHERE target_type=? AND target_id=?', ['migration_probe', fixture.runId]],
    ];
    for (const [sql, values] of checks) requireCondition(count((await tx.get(sql, values))?.count) === 0, 'BUSINESS_FIXTURE_COLLISION');
    for (const [index, id] of users.entries()) {
      writeResult(await tx.run('INSERT INTO users (id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, 'Migration probe', phones[index], null, index < 2 ? 'staff' : 'participant', passwordRecord.salt, passwordRecord.hash, now, now]));
    }
    for (const id of ids.adminUserIds) writeResult(await tx.run('INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, 'admin', '[]', '1', null, now, now]));
    writeResult(await tx.run('INSERT INTO app_equipment_items (id,is_custom,name_zh,name_en,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [ids.equipmentId, '1', 'Migration probe', 'Migration probe', ids.adminUserIds[0], now, now]));
    writeResult(await tx.run('INSERT INTO registration_codes (id,code_hash,code_hint,name,phone,profile_role,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [ids.invitationId, fixture.codeHash, 'probe', 'Migration probe', ids.registrationPhone, 'participant', ids.adminUserIds[0], now]));
  });
}

// This is only a start gate around real adapter transactions. No SQL or locks
// are mocked: both operations hold distinct live MySQL connections at release.
async function paired(database, operations) {
  let release, reject, timer, arrived = 0;
  const connectionIds = new Set();
  const gate = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  gate.catch(() => {});
  const parallelDatabase = Object.create(database);
  Object.defineProperty(parallelDatabase, 'transaction', { value: callback => database.transaction(async tx => {
    try {
      const connection = await tx.get('SELECT CONNECTION_ID() AS connectionId');
      connectionIds.add(String(connection?.connectionId));
      if (++arrived === 1) timer = setTimeout(() => reject(Object.assign(new Error('BUSINESS_BARRIER_TIMEOUT'), { code: 'BUSINESS_BARRIER_TIMEOUT' })), 15_000);
      if (arrived === 2) {
        requireCondition(connectionIds.size === 2 && !connectionIds.has('undefined'), 'BUSINESS_CONNECTIONS_NOT_DISTINCT');
        release();
      }
      await gate;
      return callback(tx);
    } catch (error) { reject(error); throw error; }
  }) });
  // Rejections before entering a transaction must also release the other side.
  const pending = operations.map(operation => Promise.resolve().then(() => operation(parallelDatabase)).catch(error => { reject(error); throw error; }));
  try {
    const results = await Promise.allSettled(pending);
    const uncertain = results.find(result => result.status === 'rejected' && unknownCommit(result.reason));
    if (uncertain) throw uncertain.reason;
    requireCondition(arrived === 2 && connectionIds.size === 2, 'BUSINESS_CONCURRENCY_NOT_STARTED');
    return { results, concurrentConnections: connectionIds.size };
  } finally { clearTimeout(timer); }
}

async function runProbes(database, fixture, report, checkpoint) {
  const { ids } = fixture;
  const group = 'migration:' + fixture.runId;
  const entry = (start, end) => ({ version: 2, evidence: { read: { [group]: { parts: [{ key: 'probe', total: 100 }], ranges: { probe: [[start, end]] } } } } });
  const begin = stage => { report.stage = stage; checkpoint(); };
  begin('learning');
  const learning = await paired(database, [[0, 40], [40, 80]].map(([start, end]) => db => saveLearningProgress(db, ids.learningUserId, { records: [{ equipmentId: ids.equipmentId, date: fixture.date, entry: entry(start, end) }] })));
  for (const result of learning.results) {
    if (result.status === 'rejected') throw result.reason;
    requireCondition(result.value?.ok === true && result.value.saved === 1, 'BUSINESS_LEARNING_SAVE_FAILED');
  }
  const learned = await participantLearningProgress(database, ids.learningUserId, { equipmentId: ids.equipmentId, date: fixture.date });
  requireCondition(learned.total === 1 && learned.items.length === 1 && learned.items[0].entry.read === true &&
    JSON.stringify(learned.items[0].entry.evidence.read[group].ranges.probe) === '[[0,80]]', 'BUSINESS_LEARNING_UNION_FAILED');
  report.checks.learning = { status: 'passed', concurrentConnections: learning.concurrentConnections, mergedRecords: 1 };

  begin('app_text');
  const text = await paired(database, ids.adminUserIds.map((actor, index) => async db => {
    const request = { admin: { user: { id: actor } }, ip: null };
    return createAppTextsRepository(db).update({ key: ids.appTextKey, zh: 'probe-' + index, en: 'probe-' + index, revision: 0, updatedAt: new Date().toISOString(), updatedBy: actor }, {
      authorize: () => revalidateAdmin(db, request, 'app_maintenance.text.manage'),
      audit: () => writeSystemLog(db, request, 'migration_probe.app_text', 'migration_probe', fixture.runId, { probe: 'app_text', revision: 1 }),
    });
  }));
  const textSuccess = text.results.filter(result => result.status === 'fulfilled');
  const textFailure = text.results.filter(result => result.status === 'rejected');
  if (textFailure.some(result => result.reason?.code !== 'APP_TEXT_CONFLICT')) throw textFailure.find(result => result.reason?.code !== 'APP_TEXT_CONFLICT').reason;
  requireCondition(textSuccess.length === 1 && textFailure.length === 1, 'BUSINESS_APP_TEXT_RACE_FAILED');
  const savedText = await database.get('SELECT revision,updated_by FROM app_text_overrides WHERE text_key=?', [ids.appTextKey]);
  const logCount = await database.get('SELECT COUNT(*) AS count FROM system_logs WHERE target_type=? AND target_id=?', ['migration_probe', fixture.runId]);
  requireCondition(count(savedText?.revision) === 1 && ids.adminUserIds.includes(savedText?.updated_by) && count(logCount?.count) === 1, 'BUSINESS_APP_TEXT_AUDIT_FAILED');
  report.checks.appText = { status: 'passed', concurrentConnections: text.concurrentConnections, successfulUpdates: 1, conflicts: 1, auditRows: 1 };

  begin('registration');
  const registration = await paired(database, [0, 1].map(() => db => createRegistrationRepository(db, {
    makeInvitation() { throw Object.assign(new Error('BUSINESS_UNEXPECTED_INVITATION_ISSUE'), { code: 'BUSINESS_UNEXPECTED_INVITATION_ISSUE' }); },
    revalidateAdmin, writeSystemLog,
  }).consume({ codeHash: fixture.codeHash, phone: ids.registrationPhone, email: null, name: 'Migration probe', passwordRecord: fixture.passwordRecord })));
  const registered = registration.results.filter(result => result.status === 'fulfilled');
  for (const result of registered) {
    requireCondition(UUID.test(result.value?.id || ''), 'BUSINESS_CREATED_USER_ID_INVALID');
    ids.registeredUserIds.push(result.value.id);
  }
  checkpoint();
  const registrationFailure = registration.results.filter(result => result.status === 'rejected');
  if (registrationFailure.some(result => result.reason?.registrationError !== 'invalidRegistrationCode')) throw registrationFailure.find(result => result.reason?.registrationError !== 'invalidRegistrationCode').reason;
  requireCondition(registered.length === 1 && registrationFailure.length === 1, 'BUSINESS_REGISTRATION_RACE_FAILED');
  const invitation = await database.get('SELECT used_at,used_by FROM registration_codes WHERE id=?', [ids.invitationId]);
  const users = await database.all('SELECT id FROM users WHERE phone=?', [ids.registrationPhone]);
  requireCondition(invitation?.used_at && invitation.used_by === ids.registeredUserIds[0] && users.length === 1 && users[0].id === ids.registeredUserIds[0], 'BUSINESS_REGISTRATION_CONSUME_FAILED');
  report.checks.registration = { status: 'passed', concurrentConnections: registration.concurrentConnections, createdUsers: 1, consumedInvitations: 1, conflicts: 1 };
  checkpoint();
}

async function cleanupFixtures(database, fixture) {
  const { ids, phones } = fixture;
  const users = [...ids.adminUserIds, ids.learningUserId, ...ids.registeredUserIds];
  const placeholders = users.map(() => '?').join(',');
  return database.transaction(async tx => {
    const deletes = [
      ['DELETE FROM system_logs WHERE target_type=? AND target_id=? AND actor_user_id IN (?,?)', ['migration_probe', fixture.runId, ...ids.adminUserIds]],
      ['DELETE FROM app_text_overrides WHERE text_key=? AND updated_by IN (?,?)', [ids.appTextKey, ...ids.adminUserIds]],
      ['DELETE FROM facility_learning_progress WHERE user_id=? AND equipment_id=? AND learning_date=?', [ids.learningUserId, ids.equipmentId, fixture.date]],
      ['DELETE FROM registration_codes WHERE id=?', [ids.invitationId]],
      ['DELETE FROM app_equipment_items WHERE id=?', [ids.equipmentId]],
      ['DELETE FROM admin_accounts WHERE user_id IN (?,?)', ids.adminUserIds],
      [`DELETE FROM users WHERE id IN (${placeholders}) AND phone IN (?,?,?,?)`, [...users, ...phones, ids.registrationPhone]],
    ];
    for (const [sql, values] of deletes) {
      const result = await tx.run(sql, values);
      requireCondition(result?.warningStatus === 0, 'BUSINESS_CLEANUP_WARNING');
    }
    const checks = [
      ['systemLogs', 'SELECT COUNT(*) AS count FROM system_logs WHERE target_type=? AND target_id=?', ['migration_probe', fixture.runId]],
      ['appText', 'SELECT COUNT(*) AS count FROM app_text_overrides WHERE text_key=?', [ids.appTextKey]],
      ['learning', 'SELECT COUNT(*) AS count FROM facility_learning_progress WHERE user_id=? AND equipment_id=?', [ids.learningUserId, ids.equipmentId]],
      ['invitation', 'SELECT COUNT(*) AS count FROM registration_codes WHERE id=?', [ids.invitationId]],
      ['equipment', 'SELECT COUNT(*) AS count FROM app_equipment_items WHERE id=?', [ids.equipmentId]],
      ['admins', 'SELECT COUNT(*) AS count FROM admin_accounts WHERE user_id IN (?,?)', ids.adminUserIds],
      ['users', `SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders}) OR phone=?`, [...users, ids.registrationPhone]],
    ];
    const counts = {};
    for (const [name, sql, values] of checks) counts[name] = count((await tx.get(sql, values))?.count);
    const residualCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
    requireCondition(residualCount === 0, 'BUSINESS_CLEANUP_RESIDUAL');
    return { status: 'cleaned', residualCount, counts };
  });
}

export async function runBusinessCheck(options, {
  readConfig = readMysqlConfig, buildSchema = buildMysqlSchema, makeDatabase = createMysqlDatabase,
  verifySchema = verifyDatabaseSchema, prepareFixtures = createFixtures, probeOperations = runProbes, cleanFixtures = cleanupFixtures,
  write = line => console.log(line),
} = {}) {
  let reportReserved = false, reportFinalized = false, database, failure;
  const fixture = fixtures(randomUUID());
  const report = { formatVersion: 1, mode: 'business-probe', database: DATABASE, generatedAtUtc: new Date().toISOString(),
    runId: fixture.runId, fixtureIDs: fixture.ids, status: 'running', stage: 'input', fixturesCreated: false,
    commitOutcomeUnknown: false, checks: {}, cleanup: { status: 'not_needed', residualCount: 0 } };
  const checkpoint = () => {
    if (!reportReserved) return;
    const temporary = path.join(path.dirname(options.report), '.' + path.basename(options.report) + '.' + randomUUID() + '.partial');
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(report, null, 2) + '\n', 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      // A failed write leaves the preceding complete checkpoint and its recovery IDs intact.
      fs.renameSync(temporary, options.report);
    } finally {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
      try { fs.unlinkSync(temporary); } catch {}
    }
  };
  try {
    requireCondition(options?.apply === true && [options?.audit, options?.report].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value)), 'BUSINESS_INPUT_INVALID');
    const reservation = fs.openSync(options.report, 'wx', 0o600);
    reportReserved = true;
    fs.closeSync(reservation);
    checkpoint();
    report.stage = 'schema_input';
    const schema = buildSchema(JSON.parse(fs.readFileSync(options.audit, 'utf8')));
    requireCondition(schema?.tables?.length === 38, 'BUSINESS_SCHEMA_INVALID');
    report.sourceSchemaHash = schema.sourceSchemaHash;
    report.stage = 'configuration';
    const config = readConfig();
    requireCondition(config.database === DATABASE, 'BUSINESS_WRONG_DATABASE');
    requireCondition(Number.isInteger(config.connectionLimit) && config.connectionLimit >= 2, 'BUSINESS_POOL_TOO_SMALL');
    database = makeDatabase({ ...config, supportBigNumbers: true, bigNumberStrings: true });
    report.stage = 'schema_verification'; checkpoint();
    const verified = await verifySchema(database, schema);
    requireCondition(verified?.status === 'verified' && verified.database === DATABASE && /^[a-f0-9]{64}$/.test(verified.fingerprint || ''), 'BUSINESS_SCHEMA_UNVERIFIED');
    report.schemaFingerprint = verified.fingerprint;
    report.stage = 'fixture_creation'; checkpoint();
    await prepareFixtures(database, fixture);
    report.fixturesCreated = true; checkpoint();
    await probeOperations(database, fixture, report, checkpoint);
    requireCondition(['learning', 'appText', 'registration'].every(name => report.checks[name]?.status === 'passed'), 'BUSINESS_CHECK_INCOMPLETE');
  } catch (error) {
    failure = safeCode(error, 'BUSINESS_OPERATION_FAILED');
    report.commitOutcomeUnknown = unknownCommit(error);
    report.errorStage = report.stage;
  } finally {
    if (report.commitOutcomeUnknown) report.cleanup = { status: 'skipped_unknown_commit', residualCount: null };
    else if (database && report.fixturesCreated) {
      try {
        report.cleanup = await cleanFixtures(database, fixture);
        requireCondition(report.cleanup?.status === 'cleaned' && report.cleanup.residualCount === 0, 'BUSINESS_CLEANUP_FAILED');
      } catch (error) {
        report.cleanup = { status: unknownCommit(error) ? 'unknown_commit' : 'failed', residualCount: null, errorCode: safeCode(error, 'BUSINESS_CLEANUP_FAILED') };
        report.commitOutcomeUnknown ||= unknownCommit(error);
        if (!failure) { failure = report.cleanup.errorCode; report.errorStage = 'cleanup'; }
      }
    }
    if (database) {
      try { await database.close(); }
      catch (error) { if (!failure) { failure = safeCode(error, 'BUSINESS_CLOSE_FAILED'); report.errorStage = 'close'; } }
    }
    report.status = failure ? 'failed' : 'passed';
    report.errorCode = failure || null;
    try { checkpoint(); reportFinalized = reportReserved; }
    catch (error) {
      failure ||= safeCode(error, 'BUSINESS_REPORT_FAILED');
      report.status = 'failed';
      report.errorCode = failure;
      report.errorStage ||= 'report';
    }
  }
  write('BUSINESS_CHECK ' + (failure ? 'FAIL' : 'PASS'));
  write('BUSINESS_RUN_ID ' + report.runId);
  for (const name of ['learning', 'appText', 'registration']) write('BUSINESS_' + name.toUpperCase() + ' ' + (report.checks[name]?.status === 'passed' ? 'PASS' : 'NOT_PASSED'));
  write('BUSINESS_CLEANUP ' + report.cleanup.status);
  write('BUSINESS_RESIDUAL_COUNT ' + (report.cleanup.residualCount ?? 'UNKNOWN'));
  write('BUSINESS_COMMIT_OUTCOME ' + (report.commitOutcomeUnknown ? 'UNKNOWN' : 'KNOWN'));
  if (failure) { write('ERROR_CODE ' + failure); write('ERROR_STAGE ' + (report.errorStage || report.stage)); }
  if (reportReserved) {
    write('REPORT_STATUS ' + (reportFinalized ? 'FINAL' : 'INCOMPLETE'));
    write('REPORT_FILE ' + options.report);
  }
  return failure ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { apply: { type: 'boolean' }, audit: { type: 'string' }, report: { type: 'string' } } });
    process.exitCode = await runBusinessCheck(values);
  } catch {
    console.log('BUSINESS_CHECK FAIL\nERROR_CODE BUSINESS_ARGUMENTS_INVALID');
    process.exitCode = 1;
  }
}
