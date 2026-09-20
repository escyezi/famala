import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { MAX_POOLS_PER_SPACE } from '../../shared/contracts.ts';
import { randomKey } from '../auth.ts';
import { poolColumns } from '../db/pools.ts';
import { codePools } from '../db/schema.ts';

export async function listPools(database: D1Database, spaceId: number) {
  const items = await drizzle(database)
    .select(poolColumns)
    .from(codePools)
    .where(eq(codePools.spaceId, spaceId))
    .orderBy(desc(codePools.createdAt), desc(codePools.id));
  return items;
}
export async function createPool(
  database: D1Database,
  spaceId: number,
  name: string,
  description: string | null | undefined,
) {
  const db = drizzle(database);
  // Check capacity in the insert itself so concurrent creates cannot exceed the limit.
  const [pool] = await db.all<{ id: number }>(sql`
      INSERT INTO code_pools (space_id, name, description, claim_key, created_at)
      SELECT ${spaceId}, ${name}, ${description ?? null}, ${randomKey('c_')}, ${Date.now()}
      WHERE (SELECT count(*) FROM code_pools WHERE space_id = ${spaceId}) < ${MAX_POOLS_PER_SPACE}
      ON CONFLICT (space_id, name) DO NOTHING RETURNING id
    `);
  if (!pool) {
    const duplicate = await db
      .select({ id: codePools.id })
      .from(codePools)
      .where(and(eq(codePools.spaceId, spaceId), eq(codePools.name, name)))
      .get();
    return { error: duplicate ? ('POOL_NAME_EXISTS' as const) : ('SPACE_POOL_LIMIT' as const) };
  }
  return { id: pool.id };
}
export async function renamePool(
  database: D1Database,
  spaceId: number,
  poolId: number,
  name: string,
  description: string | null | undefined,
) {
  // Keep the existing endpoint compatible with name-only clients. Update the
  // description atomically with the name, preserving it when omitted.
  const descriptionUpdate = description === undefined ? sql`` : sql`, description = ${description}`;
  const renamed = await drizzle(database).get<{ id: number; name: string }>(sql`
    UPDATE OR IGNORE code_pools SET name = ${name.trim()}${descriptionUpdate}
    WHERE id = ${poolId} AND space_id = ${spaceId}
    RETURNING id, name
  `);
  return renamed;
}
export async function setPoolStatus(
  database: D1Database,
  spaceId: number,
  poolId: number,
  status: 'active' | 'stopped',
) {
  const updated = await drizzle(database)
    .update(codePools)
    .set({ status })
    .where(and(eq(codePools.id, poolId), eq(codePools.spaceId, spaceId)))
    .returning({ id: codePools.id });
  return updated.length > 0;
}
