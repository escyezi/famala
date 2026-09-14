import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, sql } from 'drizzle-orm';
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
import { normalizeRemark, parseImport, codePointLength } from '../shared/contracts.ts';
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
      return c.json({ error: '不允许跨站提交请求' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return c.json({ error: '请使用 JSON 提交请求' }, 415);
  }
  await next();
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: '提交内容过大，请拆分后重试' }, 413),
  }),
);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: '请求内容不是有效的 JSON 对象' });
  }
}
function claimKey(value: unknown) {
  if (typeof value !== 'string' || !/^c_[A-Za-z0-9_-]{43}$/.test(value.trim()))
    throw new HTTPException(404, { message: '领码 Key 无效，请检查后重试' });
  return value.trim();
}
const poolColumns = {
  id: codePools.id,
  name: codePools.name,
  claimKey: codePools.claimKey,
  status: codePools.status,
  createdAt: codePools.createdAt,
  total: sql<number>`count(${redemptionCodes.id})`.mapWith(Number),
  claimed:
    sql<number>`coalesce(sum(case when ${redemptionCodes.claimStatus} = 'claimed' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
  remaining:
    sql<number>`coalesce(sum(case when ${redemptionCodes.claimStatus} = 'unclaimed' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
};
async function ownedPool(c: Context<AppEnv>) {
  const pool = await drizzle(c.env.DB)
    .select()
    .from(codePools)
    .where(and(eq(codePools.id, c.req.param('id') ?? ''), eq(codePools.spaceId, c.get('spaceId'))))
    .get();
  if (!pool) throw new HTTPException(404, { message: '兑换码池不存在' });
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
  if (!pool) throw new HTTPException(404, { message: '领码 Key 无效，请检查后重试' });
  return pool;
}
app.get('/api/config', (c) => {
  const config = turnstileConfig(c.env, c.req.url);
  return c.json({ turnstileSiteKey: config?.siteKey ?? null, testMode: config?.testMode ?? false });
});
app.post('/api/spaces', async (c) => {
  const db = drizzle(c.env.DB);
  const key = randomKey('d_');
  const token = randomKey('s_');
  const spaceId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await db.batch([
    db
      .insert(distributorSpaces)
      .values({ id: spaceId, keyHash: await digest(key), createdAt: now }),
    db.insert(distributorSessions).values({
      id: crypto.randomUUID(),
      spaceId,
      tokenHash: await digest(token),
      createdAt: now,
      expiresAt,
    }),
  ]);
  sessionCookie(c, token, expiresAt);
  return c.json({ key, spaceId, expiresAt }, 201);
});
app.post('/api/login', async (c) => {
  const { key } = await body(c);
  if (typeof key !== 'string' || !/^d_[A-Za-z0-9_-]{43}$/.test(key.trim()))
    return c.json({ error: '发码 Key 无效，请检查后重试' }, 401);
  const db = drizzle(c.env.DB);
  const space = await db
    .select({ id: distributorSpaces.id })
    .from(distributorSpaces)
    .where(eq(distributorSpaces.keyHash, await digest(key.trim())))
    .get();
  if (!space) return c.json({ error: '发码 Key 无效，请检查后重试' }, 401);
  const token = randomKey('s_');
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await db.insert(distributorSessions).values({
    id: crypto.randomUUID(),
    spaceId: space.id,
    tokenHash: await digest(token),
    createdAt: now,
    expiresAt,
  });
  sessionCookie(c, token, expiresAt);
  return c.json({ spaceId: space.id, expiresAt });
});
app.use('/api/manage/*', requireSession);
app.get('/api/manage/session', (c) =>
  c.json({ spaceId: c.get('spaceId'), expiresAt: c.get('expiresAt') }),
);
app.post('/api/manage/logout', async (c) => {
  await drizzle(c.env.DB)
    .delete(distributorSessions)
    .where(eq(distributorSessions.id, c.get('sessionId')));
  clearSession(c);
  return c.json({ ok: true });
});
app.get('/api/manage/pools', async (c) => {
  const items = await drizzle(c.env.DB)
    .select(poolColumns)
    .from(codePools)
    .leftJoin(redemptionCodes, eq(codePools.id, redemptionCodes.poolId))
    .where(eq(codePools.spaceId, c.get('spaceId')))
    .groupBy(codePools.id)
    .orderBy(desc(codePools.createdAt), desc(codePools.id));
  return c.json({ items });
});
app.post('/api/manage/pools', async (c) => {
  const { name } = await body(c);
  if (typeof name !== 'string' || !name.trim()) return c.json({ error: '码池名称不能为空' }, 400);
  if (name.includes('\0')) return c.json({ error: '码池名称包含不支持的空字符' }, 400);
  const pool = await drizzle(c.env.DB)
    .insert(codePools)
    .values({
      id: crypto.randomUUID(),
      spaceId: c.get('spaceId'),
      name: name.trim(),
      claimKey: randomKey('c_'),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: [codePools.spaceId, codePools.name] })
    .returning()
    .get();
  if (!pool) return c.json({ error: '当前空间已有同名码池，请更换名称' }, 409);
  return c.json({ id: pool.id }, 201);
});
app.post('/api/manage/pools/:id/name', async (c) => {
  const pool = await ownedPool(c);
  const { name } = await body(c);
  if (typeof name !== 'string' || !name.trim()) return c.json({ error: '码池名称不能为空' }, 400);
  if (name.includes('\0')) return c.json({ error: '码池名称包含不支持的空字符' }, 400);
  // Only the name changes. The existing unique constraint also protects against
  // two pools being renamed to the same name concurrently.
  const renamed = await drizzle(c.env.DB).get<{ id: string; name: string }>(sql`
    UPDATE OR IGNORE code_pools SET name = ${name.trim()}
    WHERE id = ${pool.id} AND space_id = ${c.get('spaceId')}
    RETURNING id, name
  `);
  if (!renamed) return c.json({ error: '当前空间已有同名码池，请更换名称' }, 409);
  return c.json(renamed);
});
app.post('/api/manage/pools/:id/status', async (c) => {
  const pool = await ownedPool(c);
  const { status } = await body(c);
  if (status !== 'active' && status !== 'stopped') return c.json({ error: '无效的码池状态' }, 400);
  await drizzle(c.env.DB)
    .update(codePools)
    .set({ status })
    .where(and(eq(codePools.id, pool.id), eq(codePools.spaceId, c.get('spaceId'))));
  return c.json({ status });
});
app.post('/api/manage/pools/:id/import', async (c) => {
  const pool = await ownedPool(c);
  const { text } = await body(c);
  if (typeof text !== 'string') return c.json({ error: '请提交每行一个的兑换码文本' }, 400);
  let parsed;
  try {
    parsed = parseImport(text);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  const { valid, failures } = parsed;
  const now = Date.now();
  let succeeded = 0;
  // 20 rows × 4 bound values stays below D1's 100-parameter limit. The unique
  // constraint handles concurrent imports; only duplicate codes are skipped.
  for (let offset = 0; offset < valid.length; offset += 20) {
    const chunk = valid.slice(offset, offset + 20);
    const tuples = chunk.map(
      (row) => sql`(${crypto.randomUUID()}, ${pool.id}, ${row.code}, ${now})`,
    );
    const inserted = await drizzle(c.env.DB).all<{ code: string }>(sql`
      INSERT INTO redemption_codes (id, pool_id, code, created_at) VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (pool_id, code) DO NOTHING RETURNING code
    `);
    const saved = new Set(inserted.map((row) => row.code));
    succeeded += saved.size;
    for (const row of chunk)
      if (!saved.has(row.code)) failures.push({ ...row, reason: '码池中已存在该兑换码' });
  }
  failures.sort((a, b) => a.line - b.line);
  return c.json({ succeeded, failed: failures.length, failures });
});
app.get('/api/manage/pools/:id/codes', async (c) => {
  const pool = await ownedPool(c);
  const page = Number(c.req.query('page') ?? '1');
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    return c.json({ error: '无效的页码' }, 400);
  const filter = c.req.query('status');
  if (filter && filter !== 'all' && filter !== 'claimed' && filter !== 'unclaimed')
    return c.json({ error: '无效的领取状态' }, 400);
  const where = and(
    eq(redemptionCodes.poolId, pool.id),
    filter === 'claimed' || filter === 'unclaimed'
      ? eq(redemptionCodes.claimStatus, filter)
      : undefined,
  );
  const db = drizzle(c.env.DB);
  const [items, totals] = await db.batch([
    db
      .select({
        id: redemptionCodes.id,
        code: redemptionCodes.code,
        claimStatus: redemptionCodes.claimStatus,
        claimedAt: redemptionCodes.claimedAt,
        remark: redemptionCodes.remark,
        userMarkedUsed: redemptionCodes.userMarkedUsed,
        userMarkedUsedAt: redemptionCodes.userMarkedUsedAt,
        createdAt: redemptionCodes.createdAt,
      })
      .from(redemptionCodes)
      .where(where)
      .orderBy(desc(redemptionCodes.createdAt), desc(redemptionCodes.id))
      .limit(50)
      .offset((page - 1) * 50),
    db.select({ total: count() }).from(redemptionCodes).where(where),
  ]);
  return c.json({ items, total: totals[0].total, page, pageSize: 50 });
});
app.post('/api/claim/validate', async (c) => {
  const data = await body(c);
  const pool = await publicPool(c, claimKey(data.claimKey));
  return c.json({ name: pool.name, status: pool.status, remaining: pool.remaining });
});
app.post('/api/claim', async (c) => {
  const data = await body(c);
  const key = claimKey(data.claimKey);
  const pool = await publicPool(c, key);
  if (pool.status === 'stopped')
    return c.json({ error: '该兑换码池已停止发放', code: 'POOL_STOPPED' }, 409);
  let remark;
  try {
    remark = normalizeRemark(data.remark);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  if (!pool.remaining) return c.json({ error: '兑换码已领完', code: 'POOL_EMPTY' }, 409);
  const verification = await verifyTurnstile(c.env, c.req.url, data.turnstileToken);
  if (!verification.ok)
    return c.json(
      {
        error: verification.unavailable
          ? '人机验证暂时不可用，请稍后重新验证'
          : '人机验证失败或已过期，请重新验证',
        code: 'TURNSTILE_FAILED',
      },
      verification.unavailable ? 503 : 400,
    );
  // One statement rechecks active status and availability after verification.
  const row = await drizzle(c.env.DB).get<{ code: string; claimedAt: number }>(sql`
    UPDATE redemption_codes SET claim_status = 'claimed', claimed_at = ${Date.now()}, remark = ${remark}
    WHERE id = (
      SELECT r.id FROM redemption_codes r JOIN code_pools p ON p.id = r.pool_id
      WHERE p.id = ${pool.id} AND p.status = 'active' AND r.claim_status = 'unclaimed'
      ORDER BY r.created_at, r.id LIMIT 1
    ) AND claim_status = 'unclaimed'
    RETURNING code, claimed_at AS claimedAt
  `);
  if (!row) {
    const current = await publicPool(c, key);
    return c.json(
      {
        error: current.status === 'stopped' ? '该兑换码池已停止发放' : '兑换码已领完',
        code: current.status === 'stopped' ? 'POOL_STOPPED' : 'POOL_EMPTY',
      },
      409,
    );
  }
  return c.json({
    poolName: pool.name,
    claimKey: key,
    code: row.code,
    claimedAt: row.claimedAt,
    userMarkedUsed: false,
    userMarkedUsedAt: null,
  });
});
app.post('/api/claim/used', async (c) => {
  const data = await body(c);
  const key = claimKey(data.claimKey);
  if (typeof data.code !== 'string' || !data.code || codePointLength(data.code) > 100)
    return c.json({ error: '兑换码无效' }, 400);
  const row = await drizzle(c.env.DB).get<{ userMarkedUsedAt: number }>(sql`
    UPDATE redemption_codes SET user_marked_used = 1, user_marked_used_at = coalesce(user_marked_used_at, ${Date.now()})
    WHERE pool_id = (SELECT id FROM code_pools WHERE claim_key = ${key}) AND code = ${data.code} AND claim_status = 'claimed'
    RETURNING user_marked_used_at AS userMarkedUsedAt
  `);
  if (!row) return c.json({ error: '找不到对应的已领取兑换码' }, 404);
  return c.json({ userMarkedUsed: true, userMarkedUsedAt: row.userMarkedUsedAt });
});
app.notFound((c) => c.json({ error: '接口不存在' }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  // Database errors may contain bound secrets or codes: don't log their payloads.
  console.error('Famala request failed', c.req.method, c.req.path);
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});
export default app;
