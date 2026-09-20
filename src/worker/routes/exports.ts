import { Hono } from 'hono';
import { exportCodes, exportManifest } from '../db/exports.ts';
import type { AppEnv } from '../types.ts';
import { exportCodesQuery, exportManifestQuery } from '../validation.ts';

import { ownedPool } from './pools-context.ts';

export const exportsRoutes = new Hono<AppEnv>()
  .get('/api/manage/exports/manifest', exportManifestQuery, async (c) => {
    const { poolId } = c.req.valid('query');
    return c.json(await exportManifest(c.env.DB, c.get('spaceId'), poolId), 200);
  })
  .get('/api/manage/pools/:id/codes/export', exportCodesQuery, async (c) => {
    const pool = await ownedPool(c);
    const { afterId, maxId, status } = c.req.valid('query');
    return c.json(await exportCodes(c.env.DB, pool.id, afterId, maxId, status), 200);
  });
