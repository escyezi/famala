import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

export function parseArguments(args) {
  const [operation, ...flags] = args;
  if (
    !['check', 'rebuild'].includes(operation) ||
    flags.some((flag) => !['--local', '--remote', '--writes-paused'].includes(flag)) ||
    flags.filter((flag) => flag === '--local' || flag === '--remote').length !== 1 ||
    (operation === 'rebuild' && !flags.includes('--writes-paused'))
  )
    throw new Error(
      'Usage: npm run db:counters:check -- --local|--remote\n' +
        '       npm run db:counters:rebuild -- --local|--remote --writes-paused\n' +
        'Rebuild only after pausing API requests and external writers and draining in-flight requests.',
    );
  return { operation, target: flags.includes('--remote') ? '--remote' : '--local' };
}

export function runCounters(args, execute = execFileSync) {
  const { operation, target } = parseArguments(args);
  const run = (file) => {
    const output = execute(
      process.execPath,
      [
        wrangler,
        'd1',
        'execute',
        'DB',
        '--config',
        resolve(root, 'wrangler.jsonc'),
        target,
        // Remote --file uses the import API and returns ingestion statistics,
        // not SELECT rows. --command preserves the validation query's results.
        '--command',
        readFileSync(resolve(root, 'scripts/sql', file), 'utf8'),
        '--json',
        '--yes',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const results = JSON.parse(output);
    if (
      !Array.isArray(results) ||
      !results.length ||
      results.some((r) => !r.success || !Array.isArray(r.results))
    )
      throw new Error('D1 returned an unsuccessful or invalid result.');
    return results;
  };
  if (operation === 'rebuild') run('rebuild-counters.sql');
  const results = run('check-counters.sql');
  const mismatches = results.flatMap((r) => r.results);
  if (mismatches.length) {
    console.error(JSON.stringify(mismatches, null, 2));
    throw new Error(
      `Counter mismatch in ${mismatches.length} pool(s). Keep maintenance enabled until repaired.`,
    );
  }
  console.log(`Counters verified (${target.slice(2)}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCounters(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
