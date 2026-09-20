import { Hono } from 'hono';
import { parseImport } from '../../shared/contracts.ts';
import { errorBody } from '../../shared/messages.ts';
import { listCodes } from '../db/records.ts';
import { validationError } from '../errors.ts';
import { deleteCode, deleteCodes, importCodes, importRedeemed } from '../operations/codes.ts';
import type { AppEnv } from '../types.ts';
import { codesQuery, deleteCodesInput, importInput } from '../validation.ts';

import { ownedPool } from './pools-context.ts';

export const codesRoutes = new Hono<AppEnv>()
  .post('/api/manage/pools/:id/import', importInput, async (c) => {
    const pool = await ownedPool(c);
    const { text } = c.req.valid('json');
    let parsed;
    try {
      parsed = parseImport(text);
    } catch (error) {
      return c.json(validationError(error), 400);
    }
    const result = await importCodes(c.env.DB, pool.id, c.get('spaceId'), parsed);
    return c.json(result, 200);
  })
  .post('/api/manage/pools/:id/redeemed/import', importInput, async (c) => {
    const pool = await ownedPool(c);
    let parsed;
    try {
      parsed = parseImport(c.req.valid('json').text);
    } catch (error) {
      return c.json(validationError(error), 400);
    }
    return c.json(await importRedeemed(c.env.DB, pool.id, c.get('spaceId'), parsed), 200);
  })
  .get('/api/manage/pools/:id/codes', codesQuery, async (c) => {
    const pool = await ownedPool(c);
    const { page, status: filter, pageSize } = c.req.valid('query');
    return c.json(
      await listCodes(c.env.DB, pool.id, c.get('spaceId'), page, filter, pageSize),
      200,
    );
  })
  .delete('/api/manage/pools/:id/codes', deleteCodesInput, async (c) => {
    const pool = await ownedPool(c);
    const { ids } = c.req.valid('json');
    return c.json(await deleteCodes(c.env.DB, pool.id, ids), 200);
  })
  .delete('/api/manage/pools/:id/codes/:codeId', async (c) => {
    const pool = await ownedPool(c);
    const rawId = c.req.param('codeId');
    const codeId = Number(rawId);
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(codeId))
      return c.json(errorBody('CODE_NOT_FOUND'), 404);
    const result = await deleteCode(c.env.DB, pool.id, codeId);
    if (result === 'deleted') return c.json({ ok: true }, 200);
    return result === 'unavailable'
      ? c.json(errorBody('CODE_NOT_AVAILABLE'), 409)
      : c.json(errorBody('CODE_NOT_FOUND'), 404);
  });
