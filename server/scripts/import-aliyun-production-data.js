import { parseArgs } from 'node:util';
import { runProductionMigration } from './productionMigrationCli.js';

try {
  const { values } = parseArgs({ options: {
    audit: { type: 'string' }, input: { type: 'string' }, report: { type: 'string' },
    'source-sha256': { type: 'string' }, apply: { type: 'boolean' },
  } });
  process.exitCode = await runProductionMigration('import', { ...values, sourceSha256: values['source-sha256'] });
} catch {
  console.log('PRODUCTION_IMPORT FAIL\nERROR_CODE PRODUCTION_ARGUMENTS_INVALID');
  process.exitCode = 1;
}
