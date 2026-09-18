import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import app from '../src/worker/index.ts';
import { hc } from 'hono/client';
import { digest, SESSION_MS } from '../src/worker/auth.ts';

let proxy;
let env;
const realFetch = globalThis.fetch;
const successfulVerification = async () =>
  Response.json({ success: true, hostname: 'famala.example', action: 'claim' });
let verification = successfulVerification;
let verificationCalls = 0;
beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: false });
  env = {
    ...proxy.env,
    ENVIRONMENT: 'production',
    TURNSTILE_SITE_KEY: 'production-site-key',
    TURNSTILE_SECRET_KEY: 'production-secret-key',
    TURNSTILE_HOSTNAMES: 'famala.example',
  };
  for (const name of (await readdir('drizzle')).filter((n) => n.endsWith('.sql')).sort()) {
    const migration = await readFile(`drizzle/${name}`, 'utf8');
    const statements = migration
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }
});
beforeEach(() => {
  verification = successfulVerification;
  verificationCalls = 0;
  vi.stubGlobal('fetch', async (input, init) => {
    if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      verificationCalls++;
      return verification(input, init);
    }
    return realFetch(input, init);
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await proxy?.dispose();
});
async function request(
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
async function space() {
  const response = await request('/api/spaces', {});
  assert.equal(response.status, 201);
  return response;
}
async function pool(cookie, name = crypto.randomUUID()) {
  const response = await request('/api/manage/pools', { name }, cookie);
  assert.equal(response.status, 201);
  const listing = await request('/api/manage/pools', undefined, cookie);
  return listing.body.items.find((p) => p.id === response.body.id);
}
const imported = (p, cookie, text) => request(`/api/manage/pools/${p.id}/import`, { text }, cookie);
const deleted = (p, cookie) => request(`/api/manage/pools/${p.id}`, {}, cookie, env, {}, 'DELETE');
const claim = (p, overrides = {}, bindings = env) =>
  request(
    '/api/claim',
    { claimKey: p.claimKey, turnstileToken: crypto.randomUUID(), ...overrides },
    undefined,
    bindings,
  );

test('deleting a pool removes all its codes, invalidates sharing, and preserves other pools', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-CLAIMED\nDELETE-UNCLAIMED');
  await imported(other, owner.cookie, 'KEEP');
  const claimed = await claim(p);
  assert.equal(claimed.status, 200);
  assert.deepEqual((await deleted(p, owner.cookie)).body, { ok: true });
  assert.equal(
    (
      await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
        .bind(p.id)
        .first()
    ).total,
    0,
  );
  assert.deepEqual(
    (await request('/api/manage/pools', undefined, owner.cookie)).body.items.map((item) => item.id),
    [other.id],
  );
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).status,
    404,
  );
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).status, 404);
  assert.equal((await claim(p)).status, 404);
  assert.equal(
    (await request('/api/claim/used', { claimKey: p.claimKey, code: claimed.body.code })).status,
    404,
  );
  assert.equal((await deleted(p, owner.cookie)).status, 404);
  assert.equal((await claim(other)).body.code, 'KEEP');
  const replacement = await pool(owner.cookie, p.name);
  assert.ok(replacement.id > p.id);
  assert.notEqual(replacement.claimKey, p.claimKey);
  assert.equal((await deleted(replacement, owner.cookie)).status, 200);
  assert.deepEqual((await env.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('deletion enforces sessions, ownership, valid IDs and same-origin JSON requests', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'PROTECTED');
  assert.equal((await deleted(p)).status, 401);
  assert.equal((await deleted(p, outsider.cookie)).status, 404);
  for (const id of ['0', '-1', '1e0', `${p.id}oops`, '9007199254740992']) {
    assert.equal((await deleted({ id }, owner.cookie)).status, 404);
  }
  for (const [headers, status] of [
    [{ Origin: 'https://evil.example' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415],
  ]) {
    assert.equal(
      (await request(`/api/manage/pools/${p.id}`, {}, owner.cookie, env, headers, 'DELETE')).status,
      status,
    );
  }
  assert.equal((await claim(p)).body.code, 'PROTECTED');
});

test('failed parent deletion rolls back deletion of all codes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'ROLLBACK');
  await env.DB.prepare(
    "CREATE TRIGGER reject_test_delete BEFORE DELETE ON code_pools BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    assert.equal((await deleted(p, owner.cookie)).status, 500);
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.items[0]
        .code,
      'ROLLBACK',
    );
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_test_delete').run();
    log.mockRestore();
  }
  assert.equal((await claim(p)).body.code, 'ROLLBACK');
});

test('deletion while Siteverify is pending prevents issuing a code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-RACE');
  verification = async () => {
    assert.equal((await deleted(p, owner.cookie)).status, 200);
    return successfulVerification();
  };
  assert.equal((await claim(p)).status, 404);
});

test.each([
  [
    'import',
    /WITH incoming/,
    { text: Array.from({ length: 21 }, (_, i) => `RACE-${i}`).join('\n') },
    2,
  ],
  ['name', /UPDATE OR IGNORE/, { name: 'renamed' }, 1],
  ['status', /update "code_pools" set "status"/i, { status: 'stopped' }, 1],
])(
  'deletion during %s returns 404 instead of stale success or a database error',
  async (suffix, pattern, data, deleteAt) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    let calls = 0;
    const bindings = {
      ...env,
      DB: {
        prepare(query) {
          const statement = env.DB.prepare(query);
          if (!pattern.test(query)) return statement;
          return {
            bind(...params) {
              const bound = statement.bind(...params);
              const execute = async (method) => {
                if (++calls === deleteAt)
                  assert.equal((await deleted(p, owner.cookie)).status, 200);
                return bound[method]();
              };
              return { all: () => execute('all'), raw: () => execute('raw') };
            },
          };
        },
      },
    };
    const result = await request(
      `/api/manage/pools/${p.id}/${suffix}`,
      data,
      owner.cookie,
      bindings,
    );
    assert.equal(calls, deleteAt);
    assert.equal(result.status, 404);
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      0,
    );
  },
);

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

test('pool paths reject malformed and unsafe integer IDs without aliasing another pool', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  for (const id of [
    '0',
    '-1',
    `0${p.id}`,
    `${p.id}.0`,
    `${p.id}e0`,
    `${p.id}x`,
    `+${p.id}`,
    '9007199254740992',
    crypto.randomUUID(),
  ]) {
    const result = await request(`/api/manage/pools/${id}/codes`, undefined, owner.cookie);
    assert.equal(result.status, 404, id);
  }
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).status,
    200,
  );
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

test('empty pools and partial import: names, original line numbers, Unicode, duplicates, 500-row boundary', async () => {
  const owner = await space();
  const p = await pool(owner.cookie, '  九月福利  ');
  assert.equal(p.name, '九月福利');
  assert.equal(p.total, 0);
  assert.equal(p.status, 'active');
  assert.equal(
    (await request('/api/manage/pools', { name: '九月福利' }, owner.cookie)).status,
    409,
  );
  assert.equal((await request('/api/manage/pools', { name: ' \n ' }, owner.cookie)).status, 400);
  const other = await space();
  await pool(other.cookie, '九月福利');
  const result = await imported(
    p,
    owner.cookie,
    ` A \n\nA\r\n${'x'.repeat(101)}\n${'😀'.repeat(100)}\na`,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.succeeded, 3);
  assert.deepEqual(result.body.failures, [
    { line: 3, code: 'A', reasonCode: 'DUPLICATE_IN_BATCH', params: { firstLine: 1 } },
    { line: 4, code: 'x'.repeat(101), reasonCode: 'CODE_TOO_LONG' },
  ]);
  const again = await imported(p, owner.cookie, 'A\nB');
  assert.equal(again.body.failures[0].reasonCode, 'DUPLICATE_IN_POOL');
  assert.equal(again.body.succeeded, 1);
  assert.equal(again.body.failed, 1);
  const excessive = await imported(
    p,
    owner.cookie,
    Array.from({ length: 501 }, (_, i) => `large-${i}`).join('\n'),
  );
  assert.equal(excessive.status, 400);
  assert.equal((await imported(p, owner.cookie, '\n \r\n')).status, 400);
  const batch = await imported(
    p,
    owner.cookie,
    Array.from({ length: 500 }, (_, i) => `large-${i}`).join('\n'),
  );
  assert.equal(batch.status, 200);
  assert.equal(batch.body.succeeded, 500);
  const codes = await request(`/api/manage/pools/${p.id}/codes?page=1`, undefined, owner.cookie);
  assert.equal(codes.body.items.length, 50);
  assert.equal(codes.body.total, 504);
  const smaller = await request(
    `/api/manage/pools/${p.id}/codes?page=2&pageSize=20`,
    undefined,
    owner.cookie,
  );
  assert.equal(smaller.body.pageSize, 20);
  assert.equal(smaller.body.total, 504);
  assert.deepEqual(smaller.body.items, codes.body.items.slice(20, 40));
  const smallerLast = await request(
    `/api/manage/pools/${p.id}/codes?page=26&pageSize=20`,
    undefined,
    owner.cookie,
  );
  assert.equal(smallerLast.body.items.length, 4);
  const last = await request(`/api/manage/pools/${p.id}/codes?page=11`, undefined, owner.cookie);
  assert.equal(last.body.items.length, 4);
  const validation = await request('/api/claim/validate', { claimKey: p.claimKey });
  assert.deepEqual(Object.keys(validation.body).sort(), ['name', 'remaining', 'status']);
  assert.equal(validation.body.remaining, 504);
});

test('concurrent duplicate imports never insert a duplicate code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => imported(p, owner.cookie, 'ONE\nTWO\nTHREE')),
  );
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(
    responses.reduce((n, r) => n + r.body.succeeded, 0),
    3,
  );
});

test('concurrent claims allocate unique codes; only claimed codes can be marked, idempotently', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(
    p,
    owner.cookie,
    Array.from({ length: 12 }, (_, i) => `CONCURRENT-${i}`).join('\n'),
  );
  assert.equal(
    (await request('/api/claim/used', { claimKey: p.claimKey, code: 'CONCURRENT-0' })).status,
    404,
  );
  const responses = await Promise.all(
    Array.from({ length: 22 }, () => claim(p, { remark: '  领取备注  ' })),
  );
  const successes = responses.filter((r) => r.status === 200);
  assert.equal(successes.length, 12);
  assert.equal(new Set(successes.map((r) => r.body.code)).size, 12);
  assert.ok(
    responses
      .filter((r) => r.status !== 200)
      .every((r) => r.status === 409 && r.body.code === 'POOL_EMPTY'),
  );
  const listing = await request(
    `/api/manage/pools/${p.id}/codes?status=claimed`,
    undefined,
    owner.cookie,
  );
  assert.equal(listing.body.total, 12);
  assert.ok(listing.body.items.every((r) => r.remark === '领取备注'));
  const record = successes[0].body;
  const marked = await request('/api/claim/used', { claimKey: p.claimKey, code: record.code });
  const repeated = await request('/api/claim/used', { claimKey: p.claimKey, code: record.code });
  assert.equal(marked.status, 200);
  assert.deepEqual(marked.body, repeated.body);
  assert.equal(marked.body.userMarkedUsed, true);
  const p2 = await pool(owner.cookie);
  assert.equal(
    (await request('/api/claim/used', { claimKey: p2.claimKey, code: record.code })).status,
    404,
  );
});

test('stopped pool validates, rejects new claims, allows marking and append; resume preserves inventory', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'STOP-1\nSTOP-2');
  const first = await claim(p);
  assert.equal(first.status, 200);
  await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
  assert.equal(
    (await request('/api/claim/validate', { claimKey: p.claimKey })).body.status,
    'stopped',
  );
  assert.equal((await claim(p)).body.code, 'POOL_STOPPED');
  assert.equal(
    (await request('/api/claim/used', { claimKey: p.claimKey, code: first.body.code })).status,
    200,
  );
  await imported(p, owner.cookie, 'STOP-3');
  assert.equal((await claim(p)).body.code, 'POOL_STOPPED');
  await request(`/api/manage/pools/${p.id}/status`, { status: 'active' }, owner.cookie);
  assert.equal((await claim(p)).status, 200);
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).body.remaining, 1);
});

test('a pool stopped while Siteverify is pending cannot issue a code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'RACE');
  const normal = verification;
  verification = async () => {
    await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
    return Response.json({ success: true, hostname: 'famala.example', action: 'claim' });
  };
  try {
    const result = await claim(p);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'POOL_STOPPED');
  } finally {
    verification = normal;
  }
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).body.remaining, 1);
});

test('validation fails closed: missing, invalid, mismatched metadata, service errors, production test keys', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'SAFE');
  const beforeCalls = verificationCalls;
  assert.equal((await claim(p, { remark: '😀'.repeat(501) })).status, 400);
  assert.equal((await claim(p, { remark: 123 })).status, 400);
  assert.equal((await claim(p, { turnstileToken: '' })).status, 400);
  assert.equal(verificationCalls, beforeCalls);
  assert.equal((await claim(p, {}, { ...env, TURNSTILE_SECRET_KEY: undefined })).status, 503);
  assert.equal(
    (await claim(p, {}, { ...env, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).status,
    503,
  );
  assert.equal(
    (
      await claim(
        p,
        {},
        {
          ...env,
          ENVIRONMENT: 'development',
          TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
        },
      )
    ).status,
    503,
  );
  const normal = verification;
  try {
    for (const value of [
      { success: false },
      { success: true, hostname: 'evil.example', action: 'claim' },
      { success: true, hostname: 'famala.example', action: 'login' },
      {},
    ]) {
      verification = async () => Response.json(value);
      assert.equal((await claim(p)).status, 400);
    }
    verification = async () => new Response('unavailable', { status: 503 });
    assert.equal((await claim(p)).status, 503);
    verification = async () => {
      throw new Error('timeout');
    };
    assert.equal((await claim(p)).status, 503);
  } finally {
    verification = normal;
  }
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).body.remaining, 1);
  assert.equal((await claim(p, { remark: '  ' })).status, 200);
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.items[0]
      .remark,
    null,
  );
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

test('renaming preserves claims and sharing keys; duplicate and concurrent names remain unique', async () => {
  const owner = await space();
  const p = await pool(owner.cookie, '原名称');
  const other = await pool(owner.cookie, '已占用名称');
  await imported(p, owner.cookie, 'RENAME-1\nRENAME-2');
  const record = await claim(p);
  await request('/api/claim/used', { claimKey: p.claimKey, code: record.body.code });
  await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
  const before = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  const rename = (id, name) => request(`/api/manage/pools/${id}/name`, { name }, owner.cookie);
  assert.equal((await rename(p.id, '  ')).status, 400);
  assert.equal((await rename(p.id, other.name)).status, 409);
  assert.equal((await rename(p.id, p.name)).status, 200);
  const result = await rename(p.id, '  新名称  ');
  assert.deepEqual(result.body, { id: p.id, name: '新名称' });
  const validation = await request('/api/claim/validate', { claimKey: p.claimKey });
  assert.deepEqual(validation.body, { name: '新名称', status: 'stopped', remaining: 1 });
  const after = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  assert.deepEqual(after, before);
  const updated = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (item) => item.id === p.id,
  );
  assert.equal(updated.claimKey, p.claimKey);
  assert.equal(updated.createdAt, p.createdAt);
  const races = await Promise.all([rename(p.id, '同一个名字'), rename(other.id, '同一个名字')]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
});

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
    'status=used',
    'status=all&status=claimed',
  ])
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes?${query}`, undefined, owner.cookie)).status,
      400,
    );
  assert.equal((await request('/api/login', { key: 42 })).status, 401);
  assert.equal((await request('/api/claim/validate', { claimKey: 42 })).status, 404);
  assert.equal((await request('/api/claim/used', { claimKey: p.claimKey, code: 42 })).status, 400);
  assert.equal((await claim(p, { turnstileToken: 42 })).status, 400);
  assert.equal(verificationCalls, 0);
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
