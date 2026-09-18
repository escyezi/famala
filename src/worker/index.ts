import { errorBody } from '../shared/messages.ts';
import { ApiException, validationError } from './errors.ts';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { codePools, distributorSessions, distributorSpaces, redemptionCodes } from './db/schema.ts';
import {
  clearSession,
  digest,
  randomKey,
  requireSession,
  SESSION_MS,
  sessionCookie,
} from './auth.ts';
import { turnstileConfig, verifyTurnstile } from './turnstile.ts';
import { parseImport, importFailure } from '../shared/contracts.ts';
import type { ClaimRecord } from '../shared/contracts.ts';
import {
  loginInput,
  poolNameInput,
  poolStatusInput,
  importInput,
  deleteCodesInput,
  codesQuery,
  claimKeyInput,
  claimInput,
} from './validation.ts';
import type { AppEnv } from './types.ts';
import type { Context } from 'hono';

const app = new Hono<AppEnv>();
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      c.req.header('Sec-Fetch-Site') === 'cross-site'
    )
      return c.json(errorBody('CROSS_SITE_REQUEST'), 403);
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return c.json(errorBody('JSON_REQUIRED'), 415);
  }
  await next();
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json(errorBody('BODY_TOO_LARGE'), 413),
  }),
);

const poolColumns = {
  id: codePools.id,
  name: codePools.name,
  claimKey: codePools.claimKey,
  status: codePools.status,
  createdAt: codePools.createdAt,
  total: sql<number>`count(${redemptionCodes.id})`.mapWith(Number),
  claimed:
    sql<number>`coalesce(sum(case when ${redemptionCodes.claimedAt} IS NOT NULL then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
  redeemed:
    sql<number>`coalesce(sum(case when ${redemptionCodes.status} = 'redeemed' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
  remaining:
    sql<number>`coalesce(sum(case when ${redemptionCodes.status} = 'unclaimed' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
};
async function ownedPool(c: Context<AppEnv>) {
  const rawId = c.req.param('id') ?? '';
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id))
    throw new ApiException(404, 'POOL_NOT_FOUND');
  const pool = await drizzle(c.env.DB)
    .select()
    .from(codePools)
    .where(and(eq(codePools.id, id), eq(codePools.spaceId, c.get('spaceId'))))
    .get();
  if (!pool) throw new ApiException(404, 'POOL_NOT_FOUND');
  return pool;
}
async function publicPool(c: Context<AppEnv>, key: string) {
  const pool = await drizzle(c.env.DB)
    .select({
      id: codePools.id,
      name: codePools.name,
      status: codePools.status,
      remaining: poolColumns.remaining,
    })
    .from(codePools)
    .leftJoin(redemptionCodes, eq(codePools.id, redemptionCodes.poolId))
    .where(eq(codePools.claimKey, key))
    .groupBy(codePools.id)
    .get();
  if (!pool) throw new ApiException(404, 'CLAIM_KEY_NOT_FOUND');
  return pool;
}
const routes = app
  .get('/api/config', (c) => {
    const config = turnstileConfig(c.env, c.req.url);
    return c.json(
      { turnstileSiteKey: config?.siteKey ?? null, testMode: config?.testMode ?? false },
      200,
    );
  })
  .post('/api/spaces', async (c) => {
    const db = drizzle(c.env.DB);
    const key = randomKey('d_');
    const token = randomKey('s_');
    const keyHash = await digest(key);
    const now = Date.now();
    const expiresAt = now + SESSION_MS;
    // Resolve the generated ID by its unique key hash inside the same transaction.
    // If session creation fails, the space insert is rolled back as well.
    const [spaces] = await db.batch([
      db
        .insert(distributorSpaces)
        .values({ keyHash, createdAt: now })
        .returning({ id: distributorSpaces.id }),
      db.insert(distributorSessions).values({
        spaceId: sql`(SELECT ${distributorSpaces.id} FROM ${distributorSpaces} WHERE ${distributorSpaces.keyHash} = ${keyHash})`,
        tokenHash: await digest(token),
        createdAt: now,
        expiresAt,
      }),
    ]);
    sessionCookie(c, token, expiresAt);
    return c.json({ key, spaceId: spaces[0].id, expiresAt }, 201);
  })
  .post('/api/login', loginInput, async (c) => {
    const { key } = c.req.valid('json');
    const db = drizzle(c.env.DB);
    const space = await db
      .select({ id: distributorSpaces.id })
      .from(distributorSpaces)
      .where(eq(distributorSpaces.keyHash, await digest(key.trim())))
      .get();
    if (!space) return c.json(errorBody('INVALID_DISTRIBUTOR_KEY'), 401);
    const token = randomKey('s_');
    const now = Date.now();
    const expiresAt = now + SESSION_MS;
    await db.insert(distributorSessions).values({
      spaceId: space.id,
      tokenHash: await digest(token),
      createdAt: now,
      expiresAt,
    });
    sessionCookie(c, token, expiresAt);
    return c.json({ spaceId: space.id, expiresAt }, 200);
  })
  .use('/api/manage/*', requireSession)
  .get('/api/manage/session', (c) =>
    c.json({ spaceId: c.get('spaceId'), expiresAt: c.get('expiresAt') }, 200),
  )
  .post('/api/manage/logout', async (c) => {
    await drizzle(c.env.DB)
      .delete(distributorSessions)
      .where(eq(distributorSessions.id, c.get('sessionId')));
    clearSession(c);
    return c.json({ ok: true }, 200);
  })
  .get('/api/manage/pools', async (c) => {
    const items = await drizzle(c.env.DB)
      .select(poolColumns)
      .from(codePools)
      .leftJoin(redemptionCodes, eq(codePools.id, redemptionCodes.poolId))
      .where(eq(codePools.spaceId, c.get('spaceId')))
      .groupBy(codePools.id)
      .orderBy(desc(codePools.createdAt), desc(codePools.id));
    return c.json({ items }, 200);
  })
  .post('/api/manage/pools', poolNameInput, async (c) => {
    const { name } = c.req.valid('json');
    const pool = await drizzle(c.env.DB)
      .insert(codePools)
      .values({
        spaceId: c.get('spaceId'),
        name: name.trim(),
        claimKey: randomKey('c_'),
        createdAt: Date.now(),
      })
      .onConflictDoNothing({ target: [codePools.spaceId, codePools.name] })
      .returning()
      .get();
    if (!pool) return c.json(errorBody('POOL_NAME_EXISTS'), 409);
    return c.json({ id: pool.id }, 201);
  })
  .delete('/api/manage/pools/:id', async (c) => {
    const pool = await ownedPool(c);
    const db = drizzle(c.env.DB);
    // Foreign keys do not cascade: remove children and parent atomically.
    const [, deleted] = await db.batch([
      db.delete(redemptionCodes).where(eq(redemptionCodes.poolId, pool.id)),
      db
        .delete(codePools)
        .where(and(eq(codePools.id, pool.id), eq(codePools.spaceId, c.get('spaceId'))))
        .returning({ id: codePools.id }),
    ]);
    if (!deleted.length) return c.json(errorBody('POOL_DELETED'), 404);
    return c.json({ ok: true }, 200);
  })
  .post('/api/manage/pools/:id/name', poolNameInput, async (c) => {
    const pool = await ownedPool(c);
    const { name } = c.req.valid('json');
    // Only the name changes. The existing unique constraint also protects against
    // two pools being renamed to the same name concurrently.
    const renamed = await drizzle(c.env.DB).get<{ id: number; name: string }>(sql`
    UPDATE OR IGNORE code_pools SET name = ${name.trim()}
    WHERE id = ${pool.id} AND space_id = ${c.get('spaceId')}
    RETURNING id, name
  `);
    if (!renamed) {
      await ownedPool(c);
      return c.json(errorBody('POOL_NAME_EXISTS'), 409);
    }
    return c.json(renamed, 200);
  })
  .post('/api/manage/pools/:id/status', poolStatusInput, async (c) => {
    const pool = await ownedPool(c);
    const { status } = c.req.valid('json');
    const updated = await drizzle(c.env.DB)
      .update(codePools)
      .set({ status })
      .where(and(eq(codePools.id, pool.id), eq(codePools.spaceId, c.get('spaceId'))))
      .returning({ id: codePools.id });
    if (!updated.length) return c.json(errorBody('POOL_DELETED'), 404);
    return c.json({ status }, 200);
  })
  .post('/api/manage/pools/:id/import', importInput, async (c) => {
    const pool = await ownedPool(c);
    const { text } = c.req.valid('json');
    let parsed;
    try {
      parsed = parseImport(text);
    } catch (error) {
      return c.json(validationError(error), 400);
    }
    const { valid, failures } = parsed;
    const now = Date.now();
    let succeeded = 0;
    // 20 rows × 2 values + pool/space IDs stays below D1's 100-parameter limit. The unique
    // constraint handles concurrent imports; only duplicate codes are skipped.
    for (let offset = 0; offset < valid.length; offset += 20) {
      const chunk = valid.slice(offset, offset + 20);
      const tuples = chunk.map((row) => sql`(${row.code}, ${now})`);
      const inserted = await drizzle(c.env.DB).all<{ code: string }>(sql`
      WITH incoming(code, created_at) AS (VALUES ${sql.join(tuples, sql`, `)})
      INSERT INTO redemption_codes (pool_id, code, created_at)
      SELECT p.id, incoming.code, incoming.created_at FROM incoming CROSS JOIN code_pools p
      WHERE p.id = ${pool.id} AND p.space_id = ${c.get('spaceId')}
      ON CONFLICT (pool_id, code) DO NOTHING RETURNING code
    `);
      const saved = new Set(inserted.map((row) => row.code));
      succeeded += saved.size;
      for (const row of chunk)
        if (!saved.has(row.code)) failures.push(importFailure(row, 'DUPLICATE_IN_POOL'));
    }
    // Deletion between import chunks must not report success or duplicate codes.
    await ownedPool(c);
    failures.sort((a, b) => a.line - b.line);
    return c.json({ succeeded, failed: failures.length, failures }, 200);
  })
  .post('/api/manage/pools/:id/redeemed/import', importInput, async (c) => {
    const pool = await ownedPool(c);
    let parsed;
    try {
      parsed = parseImport(c.req.valid('json').text);
    } catch (error) {
      return c.json(validationError(error), 400);
    }
    const { valid, failures } = parsed;
    const now = Date.now();
    const statements = [
      c.env.DB.prepare('SELECT id FROM code_pools WHERE id = ? AND space_id = ?').bind(
        pool.id,
        c.get('spaceId'),
      ),
    ];
    // D1 batch is a transaction: each SELECT captures the state immediately before
    // its UPDATE, so concurrent claims/imports cannot corrupt the result counts.
    for (let offset = 0; offset < valid.length; offset += 50) {
      const codes = valid.slice(offset, offset + 50).map((row) => row.code);
      const placeholders = codes.map(() => '?').join(',');
      statements.push(
        c.env.DB.prepare(
          `SELECT code, status FROM redemption_codes WHERE pool_id = ? AND code IN (${placeholders})`,
        ).bind(pool.id, ...codes),
        c.env.DB.prepare(
          `UPDATE redemption_codes SET status = 'redeemed', redeemed_marked_at = ? WHERE pool_id = ? AND code IN (${placeholders}) AND status != 'redeemed'`,
        ).bind(now, pool.id, ...codes),
      );
    }
    const results = await c.env.DB.batch<{
      code: string;
      status: 'unclaimed' | 'claimed' | 'redeemed';
    }>(statements);
    if (!results[0].results.length) return c.json(errorBody('POOL_DELETED'), 404);
    const previous = new Map(
      results
        .filter((_, index) => index % 2 === 1)
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
    return c.json(
      { marked, alreadyRedeemed, removedFromAvailable, failed: failures.length, failures },
      200,
    );
  })
  .get('/api/manage/pools/:id/codes', codesQuery, async (c) => {
    const pool = await ownedPool(c);
    const { page, status: filter, pageSize } = c.req.valid('query');
    const where = and(
      eq(redemptionCodes.poolId, pool.id),
      filter === 'all' ? undefined : eq(redemptionCodes.status, filter),
    );
    const db = drizzle(c.env.DB);
    const [items, totals, statistics] = await db.batch([
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
      db.select({ total: count() }).from(redemptionCodes).where(where),
      db
        .select({
          all: count(),
          unclaimed: poolColumns.remaining,
          claimed:
            sql<number>`coalesce(sum(case when ${redemptionCodes.status} = 'claimed' then 1 else 0 end), 0)`.mapWith(
              Number,
            ),
          redeemed: poolColumns.redeemed,
          claimedTotal: poolColumns.claimed,
        })
        .from(redemptionCodes)
        .where(eq(redemptionCodes.poolId, pool.id)),
    ]);
    const { claimedTotal, ...counts } = statistics[0];
    return c.json(
      {
        items,
        total: totals[0].total,
        page,
        pageSize,
        counts,
        summary: {
          total: counts.all,
          remaining: counts.unclaimed,
          claimed: claimedTotal,
          redeemed: counts.redeemed,
        },
      },
      200,
    );
  })
  .delete('/api/manage/pools/:id/codes', deleteCodesInput, async (c) => {
    const pool = await ownedPool(c);
    const { ids } = c.req.valid('json');
    // One atomic statement protects codes claimed after selection and scopes every ID to this pool.
    const deleted = await drizzle(c.env.DB)
      .delete(redemptionCodes)
      .where(
        and(
          eq(redemptionCodes.poolId, pool.id),
          inArray(redemptionCodes.id, ids),
          eq(redemptionCodes.status, 'unclaimed'),
        ),
      )
      .returning({ id: redemptionCodes.id });
    return c.json({ deleted: deleted.length, skipped: ids.length - deleted.length }, 200);
  })
  .delete('/api/manage/pools/:id/codes/:codeId', async (c) => {
    const pool = await ownedPool(c);
    const rawId = c.req.param('codeId');
    const codeId = Number(rawId);
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(codeId))
      return c.json(errorBody('CODE_NOT_FOUND'), 404);
    const db = drizzle(c.env.DB);
    const where = and(eq(redemptionCodes.poolId, pool.id), eq(redemptionCodes.id, codeId));
    // Check the claim state in the DELETE itself, so a concurrent claim cannot be removed.
    const deleted = await db
      .delete(redemptionCodes)
      .where(and(where, eq(redemptionCodes.status, 'unclaimed')))
      .returning({ id: redemptionCodes.id });
    if (deleted.length) return c.json({ ok: true }, 200);
    const existing = await db
      .select({ id: redemptionCodes.id })
      .from(redemptionCodes)
      .where(where)
      .get();
    return existing
      ? c.json(errorBody('CODE_NOT_AVAILABLE'), 409)
      : c.json(errorBody('CODE_NOT_FOUND'), 404);
  })
  .post('/api/claim/validate', claimKeyInput, async (c) => {
    const data = c.req.valid('json');
    const pool = await publicPool(c, data.claimKey);
    return c.json({ name: pool.name, status: pool.status, remaining: pool.remaining }, 200);
  })
  .post('/api/claim', claimInput, async (c) => {
    const data = c.req.valid('json');
    const key = data.claimKey;
    const pool = await publicPool(c, key);
    if (pool.status === 'stopped') return c.json(errorBody('POOL_STOPPED'), 409);
    const remark = data.remark ?? null;
    if (!pool.remaining) return c.json(errorBody('POOL_EMPTY'), 409);
    const verification = await verifyTurnstile(c.env, c.req.url, data.turnstileToken);
    if (!verification.ok)
      return c.json(errorBody('TURNSTILE_FAILED'), verification.unavailable ? 503 : 400);
    // One statement rechecks active status and availability after verification.
    const row = await drizzle(c.env.DB).get<{ code: string; claimedAt: number }>(sql`
    UPDATE redemption_codes SET status = 'claimed', claimed_at = ${Date.now()}, remark = ${remark}
    WHERE id = (
      SELECT r.id FROM redemption_codes r JOIN code_pools p ON p.id = r.pool_id
      WHERE p.id = ${pool.id} AND p.status = 'active' AND r.status = 'unclaimed'
      ORDER BY r.created_at, r.id LIMIT 1
    ) AND status = 'unclaimed'
    RETURNING code, claimed_at AS claimedAt
  `);
    if (!row) {
      const current = await publicPool(c, key);
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
  });
app.notFound((c) => c.json(errorBody('NOT_FOUND'), 404));
app.onError((error, c) => {
  if (error instanceof ApiException)
    return c.json(errorBody(error.code, error.params), error.status);
  if (error instanceof HTTPException)
    return c.json(
      errorBody(error.status === 400 ? 'INVALID_JSON' : 'REQUEST_FAILED'),
      error.status,
    );
  // Database errors may contain bound secrets or codes: don't log their payloads.
  console.error('Famala request failed', c.req.method, c.req.path);
  return c.json(errorBody('SERVICE_UNAVAILABLE'), 500);
});
export type AppType = typeof routes;
export default routes;
