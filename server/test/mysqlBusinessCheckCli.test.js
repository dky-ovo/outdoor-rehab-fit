import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runBusinessCheck } from '../scripts/check-aliyun-business.js';

const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const createdUserId = '00000000-0000-4000-8000-000000000001';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(workspace, '.mysql-business-cli-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), workspace);
    assert.ok(path.basename(directory).startsWith('.mysql-business-cli-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const options = { apply: true, audit: path.join(directory, 'audit.json'), report: path.join(directory, 'report.json') };
  fs.writeFileSync(options.audit, '{}\n');
  const calls = [], output = [];
  const database = { async close() { calls.push('close'); } };
  const dependencies = {
    readConfig: () => ({ database: 'outdoor_fit_test', connectionLimit: 4 }),
    buildSchema: () => ({ sourceSchemaHash: 'a'.repeat(64), tables: Array.from({ length: 38 }, () => ({})) }),
    makeDatabase(config) {
      calls.push('create');
      assert.equal(config.bigNumberStrings, true);
      assert.ok(config.connectionLimit >= 2);
      const initial = JSON.parse(fs.readFileSync(options.report, 'utf8'));
      assert.match(initial.runId, /^[a-f0-9-]{36}$/);
      assert.equal(initial.fixtureIDs.adminUserIds.length, 2);
      assert.equal(initial.fixturesCreated, false);
      return database;
    },
    async verifySchema() { calls.push('verify'); return { status: 'verified', database: 'outdoor_fit_test', fingerprint: 'b'.repeat(64) }; },
    async prepareFixtures(_database, fixtures) {
      calls.push('prepare');
      const beforeWrite = JSON.parse(fs.readFileSync(options.report, 'utf8'));
      assert.equal(beforeWrite.stage, 'fixture_creation');
      assert.deepEqual(beforeWrite.fixtureIDs, fixtures.ids);
    },
    async probeOperations(_database, fixtures, report, checkpoint) {
      calls.push('probes');
      fixtures.ids.registeredUserIds.push(createdUserId);
      report.checks = Object.fromEntries(['learning', 'appText', 'registration'].map(name => [name, { status: 'passed', concurrentConnections: 2 }]));
      checkpoint();
    },
    async cleanFixtures() { calls.push('cleanup'); return { status: 'cleaned', residualCount: 0 }; },
    write: line => output.push(line),
  };
  return { options, dependencies, database, calls, output, read: () => JSON.parse(fs.readFileSync(options.report, 'utf8')) };
}

test('CLI reserves a fresh private report before connecting, preserves fixture IDs and closes after cleanup', async t => {
  const f = fixture(t);
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 0);
  assert.deepEqual(f.calls, ['create', 'verify', 'prepare', 'probes', 'cleanup', 'close']);
  const report = f.read();
  assert.equal(report.status, 'passed');
  assert.equal(report.fixturesCreated, true);
  assert.equal(report.fixtureIDs.registeredUserIds[0], createdUserId);
  assert.deepEqual(report.cleanup, { status: 'cleaned', residualCount: 0 });
  assert.equal(report.commitOutcomeUnknown, false);
  assert.ok(f.output.includes('BUSINESS_CHECK PASS'));
  assert.ok(f.output.includes('BUSINESS_RESIDUAL_COUNT 0'));
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8'), /passwordRecord|codeHash|password_salt|password_hash/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.options.report).mode & 0o777, 0o600);
});

test('apply, absolute paths, unused report and rehearsal database are mandatory before any connection', async t => {
  const f = fixture(t);
  for (const options of [{ ...f.options, apply: false }, { ...f.options, audit: 'relative.json' }, { ...f.options, report: 'relative.json' }]) {
    assert.equal(await runBusinessCheck(options, f.dependencies), 1);
    assert.deepEqual(f.calls, []);
  }
  fs.writeFileSync(f.options.report, 'retain original');
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.equal(fs.readFileSync(f.options.report, 'utf8'), 'retain original');
  for (const [label, config] of [['production', { database: 'outdoor_fit_prod', connectionLimit: 4 }], ['pool', { database: 'outdoor_fit_test', connectionLimit: 1 }]]) {
    f.options.report = path.join(path.dirname(f.options.report), label + '.json');
    f.dependencies.readConfig = () => config;
    assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
    assert.deepEqual(f.calls, []);
  }
});

test('schema failure cannot create fixtures and error text, SQL and credentials stay out of reports', async t => {
  const f = fixture(t);
  f.dependencies.verifySchema = async () => {
    f.calls.push('verify');
    throw Object.assign(new Error('private_password private_SQL private_business_row'), { code: 'SCHEMA_METADATA_MISMATCH', sql: 'private_SQL', report: { secret: 'private_business_row' } });
  };
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.deepEqual(f.calls, ['create', 'verify', 'close']);
  assert.equal(f.read().errorCode, 'SCHEMA_METADATA_MISMATCH');
  assert.equal(f.read().cleanup.status, 'not_needed');
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_/);
});

test('failure cleanup starts only after the probe has awaited every in-flight operation', async t => {
  const f = fixture(t);
  f.dependencies.probeOperations = async (_database, _fixtures, report) => {
    report.stage = 'learning';
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => { f.calls.push('first-settled'); throw Object.assign(new Error('private_parameters'), { code: 'ER_LOCK_DEADLOCK' }); }),
      new Promise(resolve => setImmediate(() => { f.calls.push('second-settled'); resolve(); })),
    ]);
    throw outcomes[0].reason;
  };
  f.dependencies.cleanFixtures = async () => {
    assert.ok(f.calls.includes('first-settled') && f.calls.includes('second-settled'));
    f.calls.push('cleanup');
    return { status: 'cleaned', residualCount: 0 };
  };
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.deepEqual(f.calls.slice(-3), ['second-settled', 'cleanup', 'close']);
  assert.equal(f.read().cleanup.status, 'cleaned');
  assert.equal(f.read().errorStage, 'learning');
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_parameters/);
});

test('uncertain fixture or business commits retain recovery IDs and skip automatic cleanup', async t => {
  for (const phase of ['prepareFixtures', 'probeOperations']) {
    const f = fixture(t);
    f.dependencies[phase] = async () => { f.calls.push('uncertain'); throw Object.assign(new Error('private_commit_response'), { code: 'MYSQL_COMMIT_OUTCOME_UNKNOWN' }); };
    assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
    const report = f.read();
    assert.equal(report.commitOutcomeUnknown, true);
    assert.deepEqual(report.cleanup, { status: 'skipped_unknown_commit', residualCount: null });
    assert.match(report.fixtureIDs.invitationId, /^[a-f0-9-]{36}$/);
    assert.equal(report.fixtureIDs.registrationPhone, 'probe:' + report.runId + ':register');
    assert.equal(f.calls.includes('cleanup'), false);
    assert.equal(f.calls.at(-1), 'close');
    assert.ok(f.output.includes('BUSINESS_COMMIT_OUTCOME UNKNOWN'));
    assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_commit_response/);
  }
});

test('cleanup failure or uncertain cleanup commit never claims zero residuals or retries', async t => {
  for (const code of ['ER_LOCK_WAIT_TIMEOUT', 'MYSQL_COMMIT_OUTCOME_UNKNOWN']) {
    const f = fixture(t);
    f.dependencies.cleanFixtures = async () => { f.calls.push('cleanup'); throw Object.assign(new Error('private_cleanup'), { code }); };
    assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
    const report = f.read();
    assert.equal(report.cleanup.residualCount, null);
    assert.equal(report.cleanup.status, code === 'MYSQL_COMMIT_OUTCOME_UNKNOWN' ? 'unknown_commit' : 'failed');
    assert.equal(f.calls.filter(call => call === 'cleanup').length, 1);
    assert.ok(f.output.includes('BUSINESS_RESIDUAL_COUNT UNKNOWN'));
    assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_cleanup/);
  }
});

test('unknown error codes and close failures are reported without original messages', async t => {
  const f = fixture(t);
  f.dependencies.probeOperations = async () => { throw Object.assign(new Error('private_token'), { code: 'private_raw_code', report: { password: 'private_password' } }); };
  f.database.close = async () => { throw new Error('private_close_details'); };
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.equal(f.read().errorCode, 'BUSINESS_OPERATION_FAILED');
  assert.equal(f.read().cleanup.status, 'cleaned');
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_|password/);
});

test('a partial checkpoint write preserves the preceding complete recovery IDs and still cleans confirmed fixtures', async t => {
  const f = fixture(t), originalWrite = fs.writeFileSync;
  let failed = false, preserved;
  t.mock.method(fs, 'writeFileSync', function (target, data, ...rest) {
    if (!failed && typeof target === 'number' && JSON.parse(data).fixturesCreated) {
      failed = true;
      preserved = fs.readFileSync(f.options.report, 'utf8');
      fs.writeSync(target, '{"partial');
      assert.equal(fs.readFileSync(f.options.report, 'utf8'), preserved);
      throw Object.assign(new Error('private_disk_details'), { code: 'EIO' });
    }
    return originalWrite.call(this, target, data, ...rest);
  });
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.equal(failed, true);
  const before = JSON.parse(preserved), after = f.read();
  assert.equal(before.stage, 'fixture_creation');
  assert.equal(before.fixturesCreated, false);
  assert.deepEqual(after.fixtureIDs, before.fixtureIDs);
  assert.equal(after.fixturesCreated, true);
  assert.equal(after.cleanup.status, 'cleaned');
  assert.equal(after.status, 'failed');
  assert.equal(after.errorCode, 'BUSINESS_OPERATION_FAILED');
  assert.deepEqual(f.calls.slice(-2), ['cleanup', 'close']);
  assert.ok(f.output.includes('REPORT_STATUS FINAL'));
  assert.equal(fs.readdirSync(path.dirname(f.options.report)).some(name => name.endsWith('.partial')), false);
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_disk_details/);
});

test('a final atomic rename failure leaves a complete running checkpoint and reports incomplete status', async t => {
  const f = fixture(t), originalRename = fs.renameSync;
  let failed = false;
  t.mock.method(fs, 'renameSync', function (source, target) {
    if (target === f.options.report && JSON.parse(fs.readFileSync(source, 'utf8')).status === 'passed') {
      failed = true;
      throw Object.assign(new Error('private_rename_details'), { code: 'EIO' });
    }
    return originalRename.call(this, source, target);
  });
  assert.equal(await runBusinessCheck(f.options, f.dependencies), 1);
  assert.equal(failed, true);
  const saved = f.read();
  assert.equal(saved.status, 'running');
  assert.equal(saved.fixtureIDs.registeredUserIds[0], createdUserId);
  assert.deepEqual(f.calls.slice(-2), ['cleanup', 'close']);
  assert.ok(f.output.includes('BUSINESS_CHECK FAIL'));
  assert.ok(f.output.includes('ERROR_CODE BUSINESS_REPORT_FAILED'));
  assert.ok(f.output.includes('ERROR_STAGE report'));
  assert.ok(f.output.includes('REPORT_STATUS INCOMPLETE'));
  assert.equal(fs.readdirSync(path.dirname(f.options.report)).some(name => name.endsWith('.partial')), false);
  assert.doesNotMatch(fs.readFileSync(f.options.report, 'utf8') + f.output.join('\n'), /private_rename_details/);
});
