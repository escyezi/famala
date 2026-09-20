import { Hono } from 'hono';
import { MAX_POOLS_PER_SPACE } from '../../shared/contracts.ts';
import { errorBody } from '../../shared/messages.ts';
import { deletePool } from '../operations/codes.ts';
import { createPool, listPools, renamePool, setPoolStatus } from '../operations/pools.ts';
import type { AppEnv } from '../types.ts';
import { poolNameInput, poolStatusInput } from '../validation.ts';

import { ownedPool } from './pools-context.ts';

export const poolsRoutes = new Hono<AppEnv>()
  .get('/api/manage/pools', async (c) => {
    const items = await listPools(c.env.DB, c.get('spaceId'));
    return c.json({ items }, 200);
  })
  .post('/api/manage/pools', poolNameInput, async (c) => {
    const { name, description } = c.req.valid('json');
    const result = await createPool(c.env.DB, c.get('spaceId'), name, description);
    if (result.error)
      return c.json(
        errorBody(
          result.error,
          result.error === 'SPACE_POOL_LIMIT' ? { limit: MAX_POOLS_PER_SPACE } : undefined,
        ),
        409,
      );
    return c.json({ id: result.id }, 201);
  })
  .delete('/api/manage/pools/:id', async (c) => {
    const pool = await ownedPool(c);
    const deleted = await deletePool(c.env.DB, pool.id, c.get('spaceId'));
    if (!deleted) return c.json(errorBody('POOL_DELETED'), 404);
    return c.json({ ok: true }, 200);
  })
  .post('/api/manage/pools/:id/name', poolNameInput, async (c) => {
    const pool = await ownedPool(c);
    const { name, description } = c.req.valid('json');
    const renamed = await renamePool(c.env.DB, c.get('spaceId'), pool.id, name, description);
    if (!renamed) {
      await ownedPool(c);
      return c.json(errorBody('POOL_NAME_EXISTS'), 409);
    }
    return c.json(renamed, 200);
  })
  .post('/api/manage/pools/:id/status', poolStatusInput, async (c) => {
    const pool = await ownedPool(c);
    const { status } = c.req.valid('json');
    const updated = await setPoolStatus(c.env.DB, c.get('spaceId'), pool.id, status);
    if (!updated) return c.json(errorBody('POOL_DELETED'), 404);
    return c.json({ status }, 200);
  });
