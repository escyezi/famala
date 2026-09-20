import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export const SESSION_CLEANUP_BATCH_SIZE = 1000;
export const SESSION_CLEANUP_MAX_BATCHES = 10;

export function cleanupSQL(cutoff: number) {
  if (!Number.isSafeInteger(cutoff) || cutoff < 0) throw new Error('Invalid cleanup cutoff.');
  // The expiry index bounds the read. No COUNT(*) scan and no returned session IDs.
  return `DELETE FROM distributor_sessions WHERE id IN (
    SELECT id FROM distributor_sessions WHERE expires_at <= ${cutoff}
    ORDER BY expires_at LIMIT ${SESSION_CLEANUP_BATCH_SIZE}
  )`;
}
export function parseCleanupArguments(args: string[]) {
  const targets = args.filter((arg) => arg === '--local' || arg === '--remote');
  const batchFlags = args.filter((arg) => /^--batches=[1-9]\d*$/.test(arg));
  const batches = batchFlags.length ? Number(batchFlags[0].split('=')[1]) : 1;
  if (
    targets.length !== 1 ||
    batchFlags.length > 1 ||
    args.length !== targets.length + batchFlags.length ||
    batches > SESSION_CLEANUP_MAX_BATCHES
  )
    throw new Error('Usage: npm run db:sessions:cleanup -- --local|--remote [--batches=1..10]');
  return { target: targets[0], batches };
}

type Execute = (
  binary: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe'] },
) => string;
export function runSessionCleanup(
  args: string[],
  execute: Execute = execFileSync,
  now = Date.now(),
) {
  const { target, batches } = parseCleanupArguments(args);
  const sql = cleanupSQL(now);
  const startedAt = performance.now();
  let deleted = 0;
  let queries = 0;
  let lastDeleted = 0;
  for (let batch = 0; batch < batches; batch++) {
    const output = execute(
      process.execPath,
      [
        resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
        'd1',
        'execute',
        'DB',
        '--config',
        resolve(root, 'wrangler.jsonc'),
        target,
        '--command',
        sql,
        '--json',
        '--yes',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const result: unknown = JSON.parse(output);
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      result[0]?.success !== true ||
      !Number.isInteger(result[0]?.meta?.changes) ||
      result[0].meta.changes < 0 ||
      result[0].meta.changes > SESSION_CLEANUP_BATCH_SIZE
    )
      throw new Error('D1 returned an unsuccessful or invalid cleanup result.');
    lastDeleted = result[0].meta.changes;
    deleted += lastDeleted;
    queries++;
    if (lastDeleted < SESSION_CLEANUP_BATCH_SIZE) break;
  }
  const summary = {
    event: 'sessions_cleaned',
    target: target.slice(2),
    cutoff: now,
    deleted,
    queries,
    limitReached: lastDeleted === SESSION_CLEANUP_BATCH_SIZE && queries === batches,
    durationMs: Math.round(performance.now() - startedAt),
  };
  console.log(JSON.stringify(summary));
  return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runSessionCleanup(process.argv.slice(2));
  } catch {
    // Subprocess errors may include command output; never print the raw exception.
    console.error(
      'Session cleanup failed. Use --local|--remote and --batches=1..10; check D1 access and schema. Earlier batches may have committed.',
    );
    process.exitCode = 1;
  }
}
