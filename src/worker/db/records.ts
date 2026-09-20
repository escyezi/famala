import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { codePools, redemptionCodes } from './schema.ts';
import { poolColumns } from './pools.ts';
import type { CodeFilter } from '../../shared/contracts.ts';
import { ApiException } from '../errors.ts';
export async function listCodes(
  database: D1Database,
  poolId: number,
  spaceId: number,
  page: number,
  filter: CodeFilter,
  pageSize: number,
) {
  const where = and(
    eq(redemptionCodes.poolId, poolId),
    filter === 'all' ? undefined : eq(redemptionCodes.status, filter),
  );
  const db = drizzle(database);
  const [items, statistics] = await db.batch([
    db
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
      .where(where)
      .orderBy(desc(redemptionCodes.createdAt), desc(redemptionCodes.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        all: codePools.totalCount,
        unclaimed: poolColumns.remaining,
        claimed:
          sql<number>`${codePools.totalCount} - ${codePools.unclaimedCount} - ${codePools.redeemedCount}`.mapWith(
            Number,
          ),
        redeemed: poolColumns.redeemed,
        claimedTotal: poolColumns.claimed,
      })
      .from(codePools)
      .where(and(eq(codePools.id, poolId), eq(codePools.spaceId, spaceId))),
  ]);
  if (!statistics.length) throw new ApiException(404, 'POOL_DELETED');
  const { claimedTotal, ...counts } = statistics[0];
  return {
    items,
    total: counts[filter],
    page,
    pageSize,
    counts,
    summary: {
      total: counts.all,
      remaining: counts.unclaimed,
      claimed: claimedTotal,
      redeemed: counts.redeemed,
    },
  };
}
