import assert from 'node:assert/strict';
import app from '../../src/worker/index.ts';
import { withCounterUpdate } from '../../src/worker/db/counters.ts';
import { env, rebuildCountersSQL } from './api-environment.ts';
export async function request(
  path,
  data,
  cookie,
  bindings = env,
  headers = {},
  method = data === undefined ? 'GET' : 'POST',
) {
  const response = await app.request(
    `https://famala.example${path}`,
    {
      method,
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    bindings,
  );
  const body = await response.json();
  if (!response.ok) {
    assert.equal(typeof body.code, 'string', `${method} ${path} needs an error code`);
    assert.equal(Object.hasOwn(body, 'error'), false);
    assert.ok(Object.keys(body).every((key) => key === 'code' || key === 'params'));
  }
  if (Array.isArray(body.failures)) {
    for (const failure of body.failures) assert.equal(Object.hasOwn(failure, 'reason'), false);
  }
  return {
    status: response.status,
    body,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    headers: response.headers,
  };
}
export async function space() {
  const response = await request('/api/spaces', {});
  assert.equal(response.status, 201);
  return response;
}
export async function pool(cookie, name = crypto.randomUUID()) {
  const response = await request('/api/manage/pools', { name }, cookie);
  assert.equal(response.status, 201);
  const listing = await request('/api/manage/pools', undefined, cookie);
  return listing.body.items.find((p) => p.id === response.body.id);
}
export const imported = (p, cookie, text) =>
  request(`/api/manage/pools/${p.id}/import`, { text }, cookie);
export const markRedeemed = (p, cookie, text, bindings = env) =>
  request(`/api/manage/pools/${p.id}/redeemed/import`, { text }, cookie, bindings);
export const deleted = (p, cookie) =>
  request(`/api/manage/pools/${p.id}`, {}, cookie, env, {}, 'DELETE');
export const claim = (p, overrides = {}, bindings = env) =>
  request(
    '/api/claim',
    { claimKey: p.claimKey, turnstileToken: crypto.randomUUID(), ...overrides },
    undefined,
    bindings,
  );

export async function seedCodes(p, count) {
  await env.DB.batch(
    withCounterUpdate(
      env.DB,
      p.id,
      'insert',
      env.DB.prepare(
        `
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
    INSERT INTO redemption_codes (pool_id, code, created_at)
    SELECT ?, 'seed-' || n, 1 FROM numbers
  `,
      ).bind(count, p.id),
    ),
  );
}

export async function seedOrderedCodes(p, count) {
  await seedCodes(p, count);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE redemption_codes SET
        status = CASE id % 3 WHEN 0 THEN 'unclaimed' WHEN 1 THEN 'claimed' ELSE 'redeemed' END,
        claimed_at = CASE WHEN id % 3 = 1 THEN 100 END,
        redeemed_marked_at = CASE WHEN id % 3 = 2 THEN 100 END,
        created_at = id % 7
       WHERE pool_id = ?`,
    ).bind(p.id),
    env.DB.prepare(rebuildCountersSQL),
  ]);
}
