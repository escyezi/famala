import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { CodeFilter } from '../../shared/contracts.ts';
import { EXPORT_BATCH_SIZE } from '../../shared/contracts.ts';
import { ApiException } from '../errors.ts';
import { codePools, redemptionCodes } from './schema.ts';

export async function exportManifest(database: D1Database, spaceId: number, poolId?: number) {
  const startedAt = Date.now();
  const pools = await drizzle(database)
    .select({
      id: codePools.id,
      name: codePools.name,
      // Keep the outer table qualified inside the correlated subquery.
      maxId:
        sql<number>`coalesce((select max(r.id) from redemption_codes r where r.pool_id = code_pools.id), 0)`.mapWith(
          Number,
        ),
    })
    .from(codePools)
    .where(
      and(
        eq(codePools.spaceId, spaceId),
        poolId === undefined ? undefined : eq(codePools.id, poolId),
      ),
    )
    .orderBy(asc(codePools.id));
  if (poolId !== undefined && !pools.length) throw new ApiException(404, 'POOL_NOT_FOUND');
  return { startedAt, pools };
}

export async function exportCodes(
  database: D1Database,
  poolId: number,
  afterId: number,
  maxId: number,
  status: CodeFilter,
) {
  const rows = await drizzle(database)
    .select({
      id: redemptionCodes.id,
      code: redemptionCodes.code,
      status: redemptionCodes.status,
      claimedAt: redemptionCodes.claimedAt,
      remark: redemptionCodes.remark,
      redeemedMarkedAt: redemptionCodes.redeemedMarkedAt,
      createdAt: redemptionCodes.createdAt,
    })
    .from(redemptionCodes)
    .where(
      and(
        eq(redemptionCodes.poolId, poolId),
        gt(redemptionCodes.id, afterId),
        lte(redemptionCodes.id, maxId),
        status === 'all' ? undefined : eq(redemptionCodes.status, status),
      ),
    )
    .orderBy(asc(redemptionCodes.id))
    .limit(EXPORT_BATCH_SIZE + 1);
  const items = rows.slice(0, EXPORT_BATCH_SIZE);
  return { items, nextCursor: rows.length > EXPORT_BATCH_SIZE ? items[items.length - 1].id : null };
}
