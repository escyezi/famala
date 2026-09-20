import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { CodeStatus, parseImport } from '../../shared/contracts.ts';
import { importFailure, MAX_CODES_PER_POOL } from '../../shared/contracts.ts';
import { withCounterUpdate } from '../db/counters.ts';
import { findOwnedPool } from '../db/pools.ts';
import { codePools, redemptionCodes } from '../db/schema.ts';
import { ApiException } from '../errors.ts';

export async function importCodes(
  database: D1Database,
  poolId: number,
  spaceId: number,
  parsed: ReturnType<typeof parseImport>,
) {
  const { valid, failures } = parsed;
  const now = Date.now();
  let succeeded = 0;
  // Read duplicates and insert in one transaction so deletion cannot change failure reasons.
  // 45 rows × 2 values + 5 fixed parameters = 95 (D1 allows 100 per statement).
  // At most 12 chunks × 3 statements + 3 session/ownership checks = 39 queries.
  const chunkSize = 45;
  for (let offset = 0; offset < valid.length; offset += chunkSize) {
    const chunk = valid.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const tuples = chunk.map(() => '(?, ?)').join(',');
    const [previous, inserted] = await database.batch<{ code: string }>([
      database
        .prepare(
          `SELECT code FROM redemption_codes WHERE pool_id = ? AND code IN (${placeholders})`,
        )
        .bind(poolId, ...chunk.map((row) => row.code)),
      ...withCounterUpdate(
        database,
        poolId,
        'insert',
        database
          .prepare(
            `
          WITH incoming(code, line) AS (VALUES ${tuples})
          INSERT INTO redemption_codes (pool_id, code, created_at)
          SELECT p.id, incoming.code, ? FROM incoming CROSS JOIN code_pools p
          WHERE p.id = ? AND p.space_id = ?
            AND NOT EXISTS (SELECT 1 FROM redemption_codes r WHERE r.pool_id = p.id AND r.code = incoming.code)
          ORDER BY incoming.line
          LIMIT max(0, ? - coalesce((SELECT total_count FROM code_pools WHERE id = ?), 0))
          ON CONFLICT (pool_id, code) DO NOTHING RETURNING code
        `,
          )
          .bind(
            ...chunk.flatMap((row) => [row.code, row.line]),
            now,
            poolId,
            spaceId,
            MAX_CODES_PER_POOL,
            poolId,
          ),
      ),
    ]);
    const existing = new Set(previous.results.map((row) => row.code));
    const saved = new Set(inserted.results.map((row) => row.code));
    succeeded += saved.size;
    for (const row of chunk) {
      if (!saved.has(row.code)) {
        failures.push(
          existing.has(row.code)
            ? importFailure(row, 'DUPLICATE_IN_POOL')
            : importFailure(row, 'POOL_CODE_LIMIT', { limit: MAX_CODES_PER_POOL }),
        );
      }
    }
  }
  // A deletion between committed chunks must not report success or duplicates.
  await findOwnedPool(database, spaceId, poolId);
  failures.sort((a, b) => a.line - b.line);
  return { succeeded, failed: failures.length, failures };
}

export async function importRedeemed(
  database: D1Database,
  poolId: number,
  spaceId: number,
  parsed: ReturnType<typeof parseImport>,
) {
  const { valid, failures } = parsed;
  const now = Date.now();
  const statements = [
    database
      .prepare('SELECT id FROM code_pools WHERE id = ? AND space_id = ?')
      .bind(poolId, spaceId),
  ];
  const previousStateSlots: number[] = [];
  // D1 batch is a transaction: each SELECT captures the state immediately before
  // its UPDATE, so concurrent claims/imports cannot corrupt the result counts.
  // 9 chunks × 5 statements + 3 session/ownership checks = 48 queries.
  // Each state transition and its counter update must remain adjacent.
  for (let offset = 0; offset < valid.length; offset += 60) {
    const codes = valid.slice(offset, offset + 60).map((row) => row.code);
    const placeholders = codes.map(() => '?').join(',');
    previousStateSlots.push(statements.length);
    statements.push(
      database
        .prepare(
          `SELECT code, status FROM redemption_codes WHERE pool_id = ? AND code IN (${placeholders})`,
        )
        .bind(poolId, ...codes),
      ...withCounterUpdate(
        database,
        poolId,
        'redeemUnclaimed',
        database
          .prepare(
            `UPDATE redemption_codes SET status = 'redeemed', redeemed_marked_at = ? WHERE pool_id = ? AND code IN (${placeholders}) AND status = 'unclaimed'`,
          )
          .bind(now, poolId, ...codes),
      ),
      ...withCounterUpdate(
        database,
        poolId,
        'redeemClaimed',
        database
          .prepare(
            `UPDATE redemption_codes SET status = 'redeemed', redeemed_marked_at = ? WHERE pool_id = ? AND code IN (${placeholders}) AND status = 'claimed'`,
          )
          .bind(now, poolId, ...codes),
      ),
    );
  }
  const results = await database.batch<{
    code: string;
    status: CodeStatus;
  }>(statements);
  if (!results[0].results.length) throw new ApiException(404, 'POOL_DELETED');
  const previous = new Map(
    previousStateSlots
      .map((index) => results[index])
      .flatMap((result) => result.results)
      .map((row) => [row.code, row.status]),
  );
  let marked = 0;
  let alreadyRedeemed = 0;
  let removedFromAvailable = 0;
  for (const row of valid) {
    const status = previous.get(row.code);
    if (!status) failures.push(importFailure(row, 'CODE_NOT_IN_POOL'));
    else if (status === 'redeemed') alreadyRedeemed++;
    else {
      marked++;
      if (status === 'unclaimed') removedFromAvailable++;
    }
  }
  failures.sort((a, b) => a.line - b.line);
  return { marked, alreadyRedeemed, removedFromAvailable, failed: failures.length, failures };
}

export async function deletePool(database: D1Database, poolId: number, spaceId: number) {
  const db = drizzle(database);
  // Foreign keys do not cascade: remove children and parent atomically.
  const [, deleted] = await db.batch([
    db.delete(redemptionCodes).where(eq(redemptionCodes.poolId, poolId)),
    db
      .delete(codePools)
      .where(and(eq(codePools.id, poolId), eq(codePools.spaceId, spaceId)))
      .returning({ id: codePools.id }),
  ]);
  return deleted.length > 0;
}

export async function deleteCodes(database: D1Database, poolId: number, ids: number[]) {
  // One atomic statement protects codes claimed after selection and scopes every ID to this pool.
  const [deleted] = await database.batch<{ id: number }>(
    withCounterUpdate(
      database,
      poolId,
      'deleteUnclaimed',
      database
        .prepare(
          `DELETE FROM redemption_codes WHERE pool_id = ? AND id IN (${ids.map(() => '?').join(',')}) AND status = 'unclaimed' RETURNING id`,
        )
        .bind(poolId, ...ids),
    ),
  );
  return { deleted: deleted.results.length, skipped: ids.length - deleted.results.length };
}

export async function deleteCode(database: D1Database, poolId: number, codeId: number) {
  const db = drizzle(database);
  const where = and(eq(redemptionCodes.poolId, poolId), eq(redemptionCodes.id, codeId));
  // Check the claim state in the DELETE itself, so a concurrent claim cannot be removed.
  const [deleted] = await database.batch<{ id: number }>(
    withCounterUpdate(
      database,
      poolId,
      'deleteUnclaimed',
      database
        .prepare(
          "DELETE FROM redemption_codes WHERE pool_id = ? AND id = ? AND status = 'unclaimed' RETURNING id",
        )
        .bind(poolId, codeId),
    ),
  );
  if (deleted.results.length) return 'deleted' as const;
  const existing = await db
    .select({ id: redemptionCodes.id })
    .from(redemptionCodes)
    .where(where)
    .get();
  return existing ? ('unavailable' as const) : ('missing' as const);
}

export async function allocateCode(database: D1Database, poolId: number, remark: string | null) {
  const [allocated] = await database.batch<{ code: string; claimedAt: number }>(
    withCounterUpdate(
      database,
      poolId,
      'claim',
      database
        .prepare(
          `
    UPDATE redemption_codes SET status = 'claimed', claimed_at = ?, remark = ?
    WHERE id = (
      SELECT r.id FROM redemption_codes r JOIN code_pools p ON p.id = r.pool_id
      WHERE p.id = ? AND p.status = 'active' AND r.status = 'unclaimed'
      ORDER BY r.created_at, r.id LIMIT 1
    ) AND status = 'unclaimed'
    RETURNING code, claimed_at AS claimedAt
  `,
        )
        .bind(Date.now(), remark, poolId),
    ),
  );
  return allocated.results[0];
}
