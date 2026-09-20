import { hc } from 'hono/client';
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { digest, SESSION_MS } from '../../src/worker/auth.ts';
import app from '../../src/worker/index.ts';
import { env, rebuildCountersSQL, verifier } from '../support/api-environment.ts';
import { claim, imported, pool, request, space } from '../support/api-fixtures.mjs';

test('all business tables generate integer IDs without reusing deleted IDs', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  assert.ok(Number.isSafeInteger(owner.body.spaceId) && owner.body.spaceId > 0);
  assert.ok(Number.isSafeInteger(p.id) && p.id > 0);
  const now = Date.now();
  const cases = [
    ['distributor_spaces', ['key_hash', 'created_at'], [crypto.randomUUID(), now]],
    [
      'distributor_sessions',
      ['space_id', 'token_hash', 'created_at', 'expires_at'],
      [owner.body.spaceId, crypto.randomUUID(), now, now + SESSION_MS],
    ],
    [
      'code_pools',
      ['space_id', 'name', 'claim_key', 'created_at'],
      [owner.body.spaceId, 'autoincrement', crypto.randomUUID(), now],
    ],
    ['redemption_codes', ['pool_id', 'code', 'created_at'], [p.id, 'AUTO-ID', now]],
  ];
  for (const [table, columns, values] of cases) {
    const insert = () =>
      env.DB.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.map(() => '?').join(', ')}) RETURNING id`,
      )
        .bind(...values)
        .first();
    const first = await insert();
    assert.ok(Number.isSafeInteger(first.id) && first.id > 0, table);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(first.id).run();
    const second = await insert();
    assert.ok(second.id > first.id, `${table} must not reuse its deleted maximum ID`);
  }
  await env.DB.prepare(rebuildCountersSQL).run(); // This test intentionally seeds tables directly.
  assert.deepEqual((await env.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('concurrent space creation links each generated ID to its own session and key', async () => {
  const owners = await Promise.all(Array.from({ length: 8 }, () => space()));
  assert.equal(new Set(owners.map((owner) => owner.body.spaceId)).size, owners.length);
  for (const owner of owners) {
    const session = await request('/api/manage/session', undefined, owner.cookie);
    const login = await request('/api/login', { key: owner.body.key });
    assert.equal(session.body.spaceId, owner.body.spaceId);
    assert.equal(login.body.spaceId, owner.body.spaceId);
  }
});

test('failed session insertion rolls back the new space', async () => {
  const before = await env.DB.prepare('SELECT count(*) AS total FROM distributor_spaces').first();
  await env.DB.prepare(
    "CREATE TRIGGER reject_test_session BEFORE INSERT ON distributor_sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await request('/api/spaces', {});
    assert.equal(result.status, 500);
    assert.equal(result.cookie, undefined);
    assert.deepEqual(
      await env.DB.prepare('SELECT count(*) AS total FROM distributor_spaces').first(),
      before,
    );
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_test_session').run();
    log.mockRestore();
  }
});

test('space keys are hashed; sessions have seven-day cookies, isolate spaces, expire and revoke', async () => {
  const a = await space();
  const b = await space();
  assert.match(a.body.key, /^d_[A-Za-z0-9_-]{43}$/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=604800'])
    assert.ok(a.headers.get('set-cookie').includes(flag));
  assert.equal(a.headers.get('cache-control'), 'no-store');
  const stored = await env.DB.prepare('SELECT key_hash FROM distributor_spaces WHERE id = ?')
    .bind(a.body.spaceId)
    .first();
  assert.equal(stored.key_hash, await digest(a.body.key));
  assert.notEqual(stored.key_hash, a.body.key);
  const session = await env.DB.prepare(
    'SELECT created_at, expires_at, token_hash FROM distributor_sessions WHERE space_id = ?',
  )
    .bind(a.body.spaceId)
    .first();
  assert.equal(session.expires_at - session.created_at, SESSION_MS);
  const p = await pool(a.cookie, '独立空间');
  assert.equal((await request('/api/manage/pools', undefined, b.cookie)).body.items.length, 0);
  for (const [suffix, data] of [
    ['/codes', undefined],
    ['/import', { text: 'stolen' }],
    ['/status', { status: 'stopped' }],
    ['/name', { name: 'stolen' }],
  ])
    assert.equal((await request(`/api/manage/pools/${p.id}${suffix}`, data, b.cookie)).status, 404);
  assert.equal((await request('/api/manage/pools', undefined)).status, 401);
  assert.equal(
    (await request('/api/manage/pools', undefined, `famala_session=${p.claimKey}`)).status,
    401,
  );
  const login = await request('/api/login', { key: a.body.key });
  assert.equal(login.status, 200);
  assert.equal((await request('/api/login', { key: 'invalid' }, a.cookie)).cookie, undefined);
  assert.equal((await request('/api/manage/logout', {}, login.cookie)).status, 200);
  assert.equal((await request('/api/manage/session', undefined, login.cookie)).status, 401);
  assert.equal((await request('/api/manage/session', undefined, a.cookie)).status, 200);
  await env.DB.prepare(
    'UPDATE distributor_sessions SET created_at = 1, expires_at = 2 WHERE token_hash = ?',
  )
    .bind(session.token_hash)
    .run();
  assert.equal((await request('/api/manage/session', undefined, a.cookie)).status, 401);
});

test('mutation requests reject cross-site origins, malformed bodies and non-JSON submission', async () => {
  assert.equal(
    (await request('/api/spaces', {}, undefined, env, { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await request('/api/login', {}, undefined, env, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal((await request('/api/login', [])).status, 400);
  const malformed = await app.request(
    'https://famala.example/api/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' },
    env,
  );
  assert.equal(malformed.status, 400);
});

test.each([undefined, 'chunked'])(
  'streamed oversized requests reject before space creation (transfer encoding: %s)',
  async (transferEncoding) => {
    const before = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM distributor_spaces) AS spaces, (SELECT count(*) FROM distributor_sessions) AS sessions',
    ).first();
    const bytes = new TextEncoder().encode(' '.repeat(1024 * 1024 - 1) + '{}');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 512 * 1024));
        controller.enqueue(bytes.subarray(512 * 1024));
        controller.close();
      },
    });
    const streamed = new Request('https://famala.example/api/spaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(transferEncoding ? { 'Transfer-Encoding': transferEncoding } : {}),
      },
      body,
      duplex: 'half',
    });
    assert.equal(streamed.headers.has('Content-Length'), false);
    const response = await app.request(streamed, undefined, env);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { code: 'BODY_TOO_LARGE' });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(
      await env.DB.prepare(
        'SELECT (SELECT count(*) FROM distributor_spaces) AS spaces, (SELECT count(*) FROM distributor_sessions) AS sessions',
      ).first(),
      before,
    );
  },
);

test('Hono RPC client interoperates with actual routes, JSON validators and query parsing', async () => {
  const client = hc('https://famala.example', {
    fetch: (input, init) => app.request(input, init, env),
    headers: { 'Content-Type': 'application/json' },
  });
  const created = await client.api.spaces.$post();
  assert.equal(created.status, 201);
  const { key } = await created.json();
  const login = await client.api.login.$post({ json: { key } });
  assert.equal(login.status, 200);
  const authenticated = hc('https://famala.example', {
    fetch: (input, init) => app.request(input, init, env),
    headers: { Cookie: login.headers.get('set-cookie').split(';')[0] },
  });
  const poolResponse = await authenticated.api.manage.pools.$post({ json: { name: 'RPC pool' } });
  assert.equal(poolResponse.status, 201);
  const param = { id: String((await poolResponse.json()).id) };
  const pool = authenticated.api.manage.pools[':id'];
  const imported = await pool.import.$post({ param, json: { text: 'RPC-1\nRPC-2' } });
  assert.equal((await imported.json()).succeeded, 2);
  const codes = await pool.codes.$get({
    param,
    query: { page: '1', status: 'unclaimed', pageSize: '50' },
  });
  const page = await codes.json();
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 50);
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 2);
  assert.equal((await pool.status.$post({ param, json: { status: 'stopped' } })).status, 200);
});

test('RPC validators reject untyped callers with invalid body and query fields', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  for (const [suffix, data] of [
    ['/name', { name: 42 }],
    ['/status', { status: 'deleted' }],
    ['/import', { text: ['CODE'] }],
  ])
    assert.equal(
      (await request(`/api/manage/pools/${p.id}${suffix}`, data, owner.cookie)).status,
      400,
    );
  for (const query of [
    'page=0',
    'page=1.5',
    'page=1&page=2',
    'pageSize=0',
    'pageSize=100',
    'pageSize=abc',
    'pageSize=20&pageSize=50',
    'status=invalid',
    'status=all&status=claimed',
  ])
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes?${query}`, undefined, owner.cookie)).status,
      400,
    );
  assert.equal((await request('/api/login', { key: 42 })).status, 401);
  assert.equal((await request('/api/claim/validate', { claimKey: 42 })).status, 404);
  assert.equal((await claim(p, { turnstileToken: 42 })).status, 400);
  assert.equal(verifier.calls, 0);
});

test('controlled errors expose only stable codes and parameters', async () => {
  const owner = await space();
  const p = await pool(owner.cookie, 'I18N contract');
  const cases = [
    [await request('/api/login', { key: 'invalid' }), 401, 'INVALID_DISTRIBUTOR_KEY'],
    [await request('/api/manage/session'), 401, 'UNAUTHORIZED'],
    [await request('/api/manage/pools', { name: '' }, owner.cookie), 400, 'POOL_NAME_REQUIRED'],
    [
      await request('/api/manage/pools', { name: 'I18N contract' }, owner.cookie),
      409,
      'POOL_NAME_EXISTS',
    ],
    [await request('/api/claim/validate', { claimKey: 'invalid' }), 404, 'INVALID_CLAIM_KEY'],
    [await imported(p, owner.cookie, ''), 400, 'IMPORT_EMPTY'],
    [
      await imported(p, owner.cookie, Array.from({ length: 501 }, () => 'X').join('\n')),
      400,
      'IMPORT_LIMIT',
    ],
    [
      await request(`/api/manage/pools/${p.id}/codes?page=0`, undefined, owner.cookie),
      400,
      'INVALID_PAGE',
    ],
    [await request('/api/no-such-route'), 404, 'NOT_FOUND'],
    [
      await request('/api/spaces', {}, undefined, env, { Origin: 'https://other.example' }),
      403,
      'CROSS_SITE_REQUEST',
    ],
    [
      await request('/api/spaces', {}, undefined, env, { 'Content-Type': 'text/plain' }),
      415,
      'JSON_REQUIRED',
    ],
    [
      await request('/api/spaces', { text: 'x'.repeat(1024 * 1024) }, undefined, env, {
        'Content-Length': String(1024 * 1024 + 11),
      }),
      413,
      'BODY_TOO_LARGE',
    ],
  ];
  for (const [result, status, code] of cases) {
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { code });
  }
  const malformed = await app.request(
    'https://famala.example/api/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    },
    env,
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { code: 'INVALID_JSON' });
  const unavailable = await request('/api/manage/pools', undefined, owner.cookie, {
    ...env,
    DB: null,
  });
  assert.equal(unavailable.status, 500);
  assert.deepEqual(unavailable.body, { code: 'SERVICE_UNAVAILABLE' });
});

test('session cleanup is bounded, uses the expiry index, and preserves live sessions', async () => {
  const { cleanupSQL } = await import('../../scripts/sessions.ts');
  const owner = await space();
  await env.DB.prepare(
    `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 1005)
    INSERT INTO distributor_sessions (space_id, token_hash, created_at, expires_at)
    SELECT ?, 'expired-' || n, 1, 2 FROM numbers`,
  )
    .bind(owner.body.spaceId)
    .run();
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${cleanupSQL(2)}`).all();
  assert.ok(plan.results.some((row) => row.detail.includes('sessions_expiry_idx')));
  const first = await env.DB.prepare(cleanupSQL(2)).run();
  assert.equal(first.meta.changes, 1000);
  assert.equal((await env.DB.prepare(cleanupSQL(2)).run()).meta.changes, 5);
  assert.equal((await request('/api/manage/session', undefined, owner.cookie)).status, 200);
  assert.equal((await env.DB.prepare(cleanupSQL(2)).run()).meta.changes, 0);
});

test('unexpected failures log only safe operation metadata and return a correlation ID', async () => {
  const owner = await space();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await request(
    '/api/manage/pools?key=DO-NOT-LOG',
    undefined,
    owner.cookie,
    { ...env, DB: null },
    { 'X-Request-ID': 'DO-NOT-TRUST' },
  );
  assert.equal(result.status, 500);
  const record = JSON.parse(error.mock.calls[0][0]);
  assert.deepEqual(
    Object.keys(record).sort(),
    ['category', 'durationMs', 'event', 'operation', 'requestId', 'stage'].sort(),
  );
  assert.equal(record.operation, 'pool_list');
  assert.equal(record.requestId, result.headers.get('X-Request-ID'));
  assert.ok(record.durationMs >= 0);
  assert.ok(!JSON.stringify(error.mock.calls).includes('DO-NOT'));
  assert.ok(!JSON.stringify(error.mock.calls).includes(owner.cookie));
});
