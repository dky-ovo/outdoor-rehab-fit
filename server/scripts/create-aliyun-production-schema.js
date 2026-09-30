import { parseArgs } from 'node:util';
import { runProductionMigration } from './productionMigrationCli.js';

try {
  const { values } = parseArgs({ options: {
    audit: { type: 'string' }, report: { type: 'string' },
    apply: { type: 'boolean' }, 'verify-only': { type: 'boolean' },
  } });
  process.exitCode = await runProductionMigration(values['verify-only'] ? 'verify' : 'schema', {
    ...values, verifyOnly: values['verify-only'],
  });
} catch {
  console.log('PRODUCTION_SCHEMA FAIL\nERROR_CODE PRODUCTION_ARGUMENTS_INVALID');
  process.exitCode = 1;
}
