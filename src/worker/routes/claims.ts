import { Hono } from 'hono';
import type { ClaimRecord } from '../../shared/contracts.ts';
import { errorBody } from '../../shared/messages.ts';
import { allocateCode } from '../operations/codes.ts';
import { withServerTiming } from '../timing.ts';
import { verifyTurnstile } from '../turnstile.ts';
import type { AppEnv } from '../types.ts';
import { claimInput, claimKeyInput } from '../validation.ts';

import { publicPool } from '../db/pools.ts';

export const claimsRoutes = new Hono<AppEnv>()
  .post('/api/claim/validate', claimKeyInput, async (c) => {
    const data = c.req.valid('json');
    const pool = await publicPool(c.env.DB, data.claimKey);
    return c.json(
      {
        name: pool.name,
        description: pool.description,
        status: pool.status,
        remaining: pool.remaining,
      },
      200,
    );
  })
  .post('/api/claim', claimInput, (c) =>
    withServerTiming(c, async (measure) => {
      const data = c.req.valid('json');
      const key = data.claimKey;
      const pool = await measure('pool_lookup', () => publicPool(c.env.DB, key));
      if (pool.status === 'stopped') return c.json(errorBody('POOL_STOPPED'), 409);
      const remark = data.remark ?? null;
      if (!pool.remaining) return c.json(errorBody('POOL_EMPTY'), 409);
      const verification = await measure('turnstile', () =>
        verifyTurnstile(c.env, c.req.url, data.turnstileToken),
      );
      if (!verification.ok)
        return c.json(errorBody('TURNSTILE_FAILED'), verification.unavailable ? 503 : 400);
      // One statement rechecks active status and availability after verification.
      const row = await measure('code_allocate', () => allocateCode(c.env.DB, pool.id, remark));
      if (!row) {
        const current = await measure('pool_recheck', () => publicPool(c.env.DB, key));
        return c.json(errorBody(current.status === 'stopped' ? 'POOL_STOPPED' : 'POOL_EMPTY'), 409);
      }
      return c.json(
        {
          poolName: pool.name,
          claimKey: key,
          code: row.code,
          claimedAt: row.claimedAt,
        } satisfies ClaimRecord,
        200,
      );
    }),
  );
