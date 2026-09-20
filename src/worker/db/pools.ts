import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { codePools } from './schema.ts';
import { ApiException } from '../errors.ts';
export const poolColumns = {
  id: codePools.id,
  name: codePools.name,
  description: codePools.description,
  claimKey: codePools.claimKey,
  status: codePools.status,
  createdAt: codePools.createdAt,
  total: codePools.totalCount,
  claimed: codePools.claimedTotalCount,
  redeemed: codePools.redeemedCount,
  remaining: codePools.unclaimedCount,
};
export async function findOwnedPool(database: D1Database, spaceId: number, id: number) {
  const pool = await drizzle(database)
    .select()
    .from(codePools)
    .where(and(eq(codePools.id, id), eq(codePools.spaceId, spaceId)))
    .get();
  if (!pool) throw new ApiException(404, 'POOL_NOT_FOUND');
  return pool;
}
export async function publicPool(database: D1Database, key: string) {
  const pool = await drizzle(database)
    .select({
      id: codePools.id,
      name: codePools.name,
      description: codePools.description,
      status: codePools.status,
      remaining: poolColumns.remaining,
    })
    .from(codePools)
    .where(eq(codePools.claimKey, key))
    .get();
  if (!pool) throw new ApiException(404, 'CLAIM_KEY_NOT_FOUND');
  return pool;
}
