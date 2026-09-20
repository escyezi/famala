import type { Context } from 'hono';
import { findOwnedPool } from '../db/pools.ts';
import { setStage } from '../diagnostics.ts';
import { ApiException } from '../errors.ts';
import type { AppEnv } from '../types.ts';
export async function ownedPool(c: Context<AppEnv>) {
  setStage(c, 'ownership');
  const rawId = c.req.param('id') ?? '';
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id))
    throw new ApiException(404, 'POOL_NOT_FOUND');
  const pool = await findOwnedPool(c.env.DB, c.get('spaceId'), id);
  setStage(c, 'operation');
  return pool;
}
