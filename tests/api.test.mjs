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
const markRedeemed = (p, cookie, text, bindings = env) =>
  request(`/api/manage/pools/${p.id}/redeemed/import`, { text }, cookie, bindings);
const deleted = (p, cookie) => request(`/api/manage/pools/${p.id}`, {}, cookie, env, {}, 'DELETE');
const claim = (p, overrides = {}, bindings = env) =>
  request(
    '/api/claim',
    { claimKey: p.claimKey, turnstileToken: crypto.randomUUID(), ...overrides },
    undefined,
    bindings,
  );

test('claim timing reports only executed stages on success and failures', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const stages = (response) => {
    const header = response.headers.get('Server-Timing');
    assert.ok(header);
    return header.split(', ').map((entry) => {
      assert.match(entry, /^[a-z_]+;dur=\d+\.\d{2}$/);
      return entry.split(';')[0];
    });
  };
  const empty = await claim(p);
  assert.equal(empty.status, 409);
  assert.deepEqual(stages(empty), ['pool_lookup', 'total']);
  await imported(p, owner.cookie, 'TIMING-TEST');
  verification = async () => Response.json({ success: false });
  const rejected = await claim(p);
  assert.equal(rejected.status, 400);
  assert.deepEqual(stages(rejected), ['pool_lookup', 'turnstile', 'total']);
  verification = successfulVerification;
  const success = await claim(p);
  assert.equal(success.status, 200);
  assert.deepEqual(stages(success), ['pool_lookup', 'turnstile', 'code_allocate', 'total']);
});

test('workspace pool limit is atomic, includes stopped pools and frees capacity after deletion', async () => {
  const owner = await space();
  await env.DB.prepare(
    `
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 49)
    INSERT INTO code_pools (space_id, name, claim_key, status, created_at)
    SELECT ?, 'seed-' || n, ? || n, 'stopped', 1 FROM numbers
  `,
  )
    .bind(owner.body.spaceId, crypto.randomUUID())
    .run();
  const attempts = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      request('/api/manage/pools', { name: `new-${i}` }, owner.cookie),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1);
  for (const response of attempts.filter((r) => r.status !== 201)) {
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { code: 'SPACE_POOL_LIMIT', params: { limit: 50 } });
  }
  assert.equal((await request('/api/manage/pools', undefined, owner.cookie)).body.items.length, 50);
  assert.equal(
    (await request('/api/manage/pools', { name: 'seed-1' }, owner.cookie)).body.code,
    'POOL_NAME_EXISTS',
  );
  const outsider = await space();
  await pool(outsider.cookie, 'seed-1');
  const created = attempts.find((r) => r.status === 201);
  assert.equal((await deleted({ id: created.body.id }, owner.cookie)).status, 200);
  await pool(owner.cookie, 'replacement');
  assert.equal(
    (await request('/api/manage/pools', { name: 'overflow' }, owner.cookie)).body.code,
    'SPACE_POOL_LIMIT',
  );
});

async function seedCodes(p, count) {
  await env.DB.prepare(
    `
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
    INSERT INTO redemption_codes (pool_id, code, created_at)
    SELECT ?, 'seed-' || n, 1 FROM numbers
  `,
  )
    .bind(count, p.id)
    .run();
}

test('pool capacity imports valid new codes in order and counts claimed and redeemed codes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await seedCodes(p, 4980);
  const result = await imported(
    p,
    owner.cookie,
    ['seed-1', 'X'.repeat(101), ...Array.from({ length: 25 }, (_, i) => `NEW-${i}`)].join('\n'),
  );
  assert.equal(result.body.succeeded, 20);
  assert.equal(result.body.failed, 7);
  assert.deepEqual(
    result.body.failures.map((r) => [r.line, r.reasonCode]),
    [
      [1, 'DUPLICATE_IN_POOL'],
      [2, 'CODE_TOO_LONG'],
      ...Array.from({ length: 5 }, (_, i) => [23 + i, 'POOL_CODE_LIMIT']),
    ],
  );
  assert.ok(result.body.failures.slice(2).every((r) => r.params.limit === 5000));
  assert.equal((await claim(p)).status, 200);
  assert.equal((await markRedeemed(p, owner.cookie, 'seed-2')).body.marked, 1);
  const full = await imported(p, owner.cookie, 'seed-1\nOVERFLOW');
  assert.equal(full.body.succeeded, 0);
  assert.deepEqual(
    full.body.failures.map((r) => r.reasonCode),
    ['DUPLICATE_IN_POOL', 'POOL_CODE_LIMIT'],
  );
  const stats = await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(stats.body.summary, { total: 5000, remaining: 4998, claimed: 1, redeemed: 1 });
  const removable = await env.DB.prepare(
    "SELECT id FROM redemption_codes WHERE pool_id = ? AND code = 'NEW-0'",
  )
    .bind(p.id)
    .first();
  assert.equal(
    (
      await request(
        `/api/manage/pools/${p.id}/codes/${removable.id}`,
        {},
        owner.cookie,
        env,
        {},
        'DELETE',
      )
    ).status,
    200,
  );
  assert.equal((await imported(p, owner.cookie, 'REPLACEMENT\nOVERFLOW')).body.succeeded, 1);
  const other = await pool(owner.cookie);
  assert.equal((await imported(other, owner.cookie, 'OVERFLOW')).body.succeeded, 1);
});

test('concurrent imports cannot exceed 5000 codes per pool', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await seedCodes(p, 4989);
  const attempts = await Promise.all(
    Array.from({ length: 4 }, (_, batch) =>
      imported(p, owner.cookie, Array.from({ length: 25 }, (_, i) => `${batch}-${i}`).join('\n')),
    ),
  );
  assert.ok(attempts.every((r) => r.status === 200));
  assert.equal(
    attempts.reduce((sum, r) => sum + r.body.succeeded, 0),
    11,
  );
  assert.equal(
    attempts.reduce((sum, r) => sum + r.body.failed, 0),
    89,
  );
  assert.ok(
    attempts.every((r) => r.body.failures.every((f) => f.reasonCode === 'POOL_CODE_LIMIT')),
  );
  assert.equal(
    (
      await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
        .bind(p.id)
        .first()
    ).total,
    5000,
  );
});

// Enforce production SQL budgets even though local D1 does not enforce invocation quotas.
// afterWrite simulates another request running as soon as an import transaction commits.
function importTestDB(afterWrite = async () => {}) {
  let queries = 0;
  let maxParameters = 0;
  const statements = new WeakMap();
  const countQueries = (count) => {
    queries += count;
    assert.ok(queries <= 50, `D1 query budget exceeded: ${queries}`);
  };
  function wrap(statement, query) {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...params) => {
            maxParameters = Math.max(maxParameters, params.length);
            assert.ok(params.length <= 100, `D1 parameter limit exceeded: ${params.length}`);
            return wrap(target.bind(...params), query);
          };
        if (['all', 'raw', 'first', 'run'].includes(key))
          return async (...args) => {
            countQueries(1);
            const result = await target[key](...args);
            if (/WITH incoming/.test(query)) await afterWrite();
            return result;
          };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, { statement, query });
    return wrapped;
  }
  return {
    db: {
      prepare: (query) => wrap(env.DB.prepare(query), query),
      async batch(batch) {
        countQueries(batch.length);
        const entries = batch.map((statement) => statements.get(statement));
        const results = await env.DB.batch(entries.map((entry) => entry.statement));
        if (entries.some((entry) => /WITH incoming/.test(entry.query))) await afterWrite();
        return results;
      },
    },
    stats: () => ({ queries, maxParameters }),
  };
}

test.each(['new', 'duplicate', 'full', 'partial'])(
  '500-code %s import fits D1 query and parameter budgets',
  async (scenario) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    if (scenario !== 'new')
      await seedCodes(p, scenario === 'duplicate' ? 500 : scenario === 'full' ? 5000 : 4985);
    const text = Array.from({ length: 500 }, (_, i) =>
      scenario === 'duplicate' ? `seed-${i + 1}` : `NEW-${i}`,
    ).join('\n');
    const measured = importTestDB();
    const result = await request(`/api/manage/pools/${p.id}/import`, { text }, owner.cookie, {
      ...env,
      DB: measured.db,
    });
    assert.equal(result.status, 200);
    const expected = scenario === 'new' ? 500 : scenario === 'partial' ? 15 : 0;
    assert.equal(result.body.succeeded, expected);
    assert.equal(result.body.failed, 500 - expected);
    assert.ok(
      result.body.failures.every(
        (failure) =>
          failure.reasonCode ===
          (scenario === 'duplicate' ? 'DUPLICATE_IN_POOL' : 'POOL_CODE_LIMIT'),
      ),
    );
    assert.ok(measured.stats().queries <= 50);
    assert.ok(measured.stats().maxParameters <= 100);
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      scenario === 'new' || scenario === 'duplicate' ? 500 : 5000,
    );
  },
);

test.each(['duplicate deleted', 'overflow inserted'])(
  'import failure reason uses transaction state when %s after commit',
  async (scenario) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    await seedCodes(p, scenario === 'duplicate deleted' ? 1 : 5000);
    const code = scenario === 'duplicate deleted' ? 'seed-1' : 'OVERFLOW';
    let changes = 0;
    const measured = importTestDB(async () => {
      changes++;
      const statements = [
        env.DB.prepare("DELETE FROM redemption_codes WHERE pool_id = ? AND code = 'seed-1'").bind(
          p.id,
        ),
      ];
      if (scenario === 'overflow inserted')
        statements.push(
          env.DB.prepare(
            "INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (?, 'OVERFLOW', 1)",
          ).bind(p.id),
        );
      await env.DB.batch(statements);
    });
    const result = await request(`/api/manage/pools/${p.id}/import`, { text: code }, owner.cookie, {
      ...env,
      DB: measured.db,
    });
    assert.equal(result.status, 200);
    assert.equal(changes, 1);
    assert.equal(result.body.succeeded, 0);
    assert.equal(result.body.failed, 1);
    assert.equal(
      result.body.failures[0].reasonCode,
      scenario === 'duplicate deleted' ? 'DUPLICATE_IN_POOL' : 'POOL_CODE_LIMIT',
    );
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      scenario === 'duplicate deleted' ? 0 : 5000,
    );
  },
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
    { text: Array.from({ length: 31 }, (_, i) => `RACE-${i}`).join('\n') },
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
        async batch(statements) {
          if (++calls === deleteAt) assert.equal((await deleted(p, owner.cookie)).status, 200);
          return env.DB.batch(statements);
        },
        prepare(query) {
          const statement = env.DB.prepare(query);
          if (suffix === 'import' || !pattern.test(query)) return statement;
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
  assert.deepEqual(Object.keys(validation.body).sort(), [
    'description',
    'name',
    'remaining',
    'status',
  ]);
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

test('concurrent claims allocate unique codes; recipient marking endpoint is removed', async () => {
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
  assert.equal((await markRedeemed(p, owner.cookie, first.body.code)).status, 200);
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
  await markRedeemed(p, owner.cookie, record.body.code);
  await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
  const before = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  const rename = (id, name) => request(`/api/manage/pools/${id}/name`, { name }, owner.cookie);
  assert.equal((await rename(p.id, '  ')).status, 400);
  assert.equal((await rename(p.id, other.name)).status, 409);
  assert.equal((await rename(p.id, p.name)).status, 200);
  const result = await rename(p.id, '  新名称  ');
  assert.deepEqual(result.body, { id: p.id, name: '新名称' });
  const validation = await request('/api/claim/validate', { claimKey: p.claimKey });
  assert.deepEqual(validation.body, {
    name: '新名称',
    description: null,
    status: 'stopped',
    remaining: 1,
  });
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

test('pool descriptions are optional, editable, public, and protected with the pool', async () => {
  const owner = await space();
  const outsider = await space();
  const created = await request(
    '/api/manage/pools',
    {
      name: '说明测试',
      description: '  第一行\n第二行 😀  ',
    },
    owner.cookie,
  );
  assert.equal(created.status, 201);
  const readPool = async () =>
    (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
      (item) => item.id === created.body.id,
    );
  const p = await readPool();
  assert.equal(p.description, '第一行\n第二行 😀');
  const readDescription = async () =>
    (await request('/api/claim/validate', { claimKey: p.claimKey })).body.description;
  assert.equal(await readDescription(), p.description);
  const path = `/api/manage/pools/${p.id}/name`;
  assert.equal(
    (await request(path, { name: p.name, description: '篡改' }, outsider.cookie)).status,
    404,
  );
  assert.equal((await request(path, { name: p.name, description: '篡改' })).status, 401);
  assert.equal(await readDescription(), p.description);
  await request(path, { name: '改名' }, owner.cookie);
  assert.equal(await readDescription(), p.description);
  for (const description of [42, {}, ['text'], 'bad\0text']) {
    assert.equal((await request(path, { name: '改名', description }, owner.cookie)).status, 400);
    assert.equal(
      (await request('/api/manage/pools', { name: '无效说明', description }, owner.cookie)).status,
      400,
    );
  }
  const other = await pool(owner.cookie);
  assert.equal(other.description, null);
  assert.equal(
    (await request(path, { name: other.name, description: '不应保存' }, owner.cookie)).status,
    409,
  );
  assert.equal(await readDescription(), p.description);
  await request(path, { name: '改名', description: '更新说明' }, owner.cookie);
  assert.equal(await readDescription(), '更新说明');
  for (const description of [' \n ', null]) {
    await request(path, { name: '改名', description }, owner.cookie);
    assert.equal(await readDescription(), null);
    assert.equal((await readPool()).description, null);
  }
  assert.equal((await readPool()).claimKey, p.claimKey);
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
    'status=invalid',
    'status=all&status=claimed',
  ])
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes?${query}`, undefined, owner.cookie)).status,
      400,
    );
  assert.equal((await request('/api/login', { key: 42 })).status, 401);
  assert.equal((await request('/api/claim/validate', { claimKey: 42 })).status, 404);
  assert.equal((await request('/api/claim/used', { claimKey: p.claimKey, code: 42 })).status, 404);
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

test('code filters partition inventory into unclaimed, claimed and redeemed with matching page totals', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, Array.from({ length: 25 }, (_, i) => `STATE-${i}`).join('\n'));
  const first = await claim(p);
  const second = await claim(p);
  await markRedeemed(p, owner.cookie, first.body.code);
  const list = async (status, page = 1) => {
    const response = await request(
      `/api/manage/pools/${p.id}/codes?status=${status}&page=${page}&pageSize=20`,
      undefined,
      owner.cookie,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.counts, { all: 25, unclaimed: 23, claimed: 1, redeemed: 1 });
    return response.body;
  };
  const claimed = await list('claimed');
  assert.equal(claimed.total, 1);
  assert.equal(claimed.items[0].code, second.body.code);
  const redeemed = await list('redeemed');
  assert.equal(redeemed.total, 1);
  assert.equal(redeemed.items[0].code, first.body.code);
  assert.ok(redeemed.items[0].redeemedMarkedAt);
  const unclaimed = await list('unclaimed');
  assert.equal(unclaimed.total, 23);
  assert.equal(unclaimed.items.length, 20);
  assert.ok(unclaimed.items.every((row) => row.status === 'unclaimed'));
  const last = await list('unclaimed', 2);
  assert.equal(last.total, 23);
  assert.equal(last.items.length, 3);
  assert.equal((await list('all')).total, 25);
  assert.deepEqual((await list('all')).summary, {
    total: 25,
    remaining: 23,
    claimed: 2,
    redeemed: 1,
  });
  for (const status of ['unused', 'used']) {
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes?status=${status}`, undefined, owner.cookie))
        .status,
      400,
    );
  }
});

test('individual deletion requires ownership and unclaimed state and updates available inventory', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'UNUSED\nUSED\nDELETE-ME');
  const claimed = await claim(p);
  const redeemed = await claim(p);
  await markRedeemed(p, owner.cookie, redeemed.body.code);
  const rows = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  const available = rows.find((row) => row.status === 'unclaimed');
  const remove = (poolId, codeId, cookie = owner.cookie) =>
    request(`/api/manage/pools/${poolId}/codes/${codeId}`, {}, cookie, env, {}, 'DELETE');
  assert.equal((await remove(p.id, available.id, '')).status, 401);
  assert.equal((await remove(p.id, available.id, outsider.cookie)).status, 404);
  assert.equal((await remove(other.id, available.id)).status, 404);
  for (const id of ['0', '-1', '1.5', 'bad', '9007199254740992'])
    assert.equal((await remove(p.id, id)).status, 404);
  for (const code of [claimed.body.code, redeemed.body.code]) {
    const row = rows.find((row) => row.code === code);
    const response = await remove(p.id, row.id);
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CODE_NOT_AVAILABLE');
  }
  assert.equal((await remove(p.id, available.id)).status, 200);
  assert.equal((await remove(p.id, available.id)).body.code, 'CODE_NOT_FOUND');
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (row) => row.id === p.id,
  );
  assert.deepEqual([stats.total, stats.claimed, stats.remaining], [2, 2, 0]);
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  assert.equal((await markRedeemed(p, owner.cookie, claimed.body.code)).status, 200);
});

test('individual deletion during Siteverify prevents a pending claim from issuing the removed code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-FIRST');
  const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items[0];
  verification = async () => {
    const removed = await request(
      `/api/manage/pools/${p.id}/codes/${row.id}`,
      {},
      owner.cookie,
      env,
      {},
      'DELETE',
    );
    assert.equal(removed.status, 200);
    return successfulVerification();
  };
  const issued = await claim(p);
  assert.equal(verificationCalls, 1);
  assert.equal(issued.status, 409);
  assert.equal(issued.body.code, 'POOL_EMPTY');
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.total,
    0,
  );
});

test('a code claimed after deletion starts is protected when the DELETE executes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'CLAIM-FIRST');
  const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items[0];
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare(query) {
        const statement = env.DB.prepare(query);
        if (!/^delete from "redemption_codes"/i.test(query)) return statement;
        return {
          bind(...params) {
            const bound = statement.bind(...params);
            const execute = async (method) => {
              // Force the claim to finish after ownership checks, before the DELETE runs.
              issued = await claim(p);
              assert.equal(issued.status, 200);
              return bound[method]();
            };
            return { all: () => execute('all'), raw: () => execute('raw') };
          },
        };
      },
    },
  };
  const removed = await request(
    `/api/manage/pools/${p.id}/codes/${row.id}`,
    {},
    owner.cookie,
    bindings,
    {},
    'DELETE',
  );
  assert.equal(issued?.body.code, 'CLAIM-FIRST');
  assert.equal(removed.status, 409);
  assert.equal(removed.body.code, 'CODE_NOT_AVAILABLE');
  const remaining = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie))
    .body;
  assert.equal(remaining.total, 1);
  assert.equal(remaining.items[0].id, row.id);
  assert.equal(remaining.items[0].status, 'claimed');
});

test('bulk deletion validates selection, enforces ownership and only removes selected unclaimed codes', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'BULK-UNUSED\nBULK-USED\nBULK-DELETE\nBULK-KEEP');
  await imported(other, owner.cookie, 'OTHER-POOL');
  await claim(p);
  const redeemed = await claim(p);
  await markRedeemed(p, owner.cookie, redeemed.body.code);
  const list = async (target) =>
    (await request(`/api/manage/pools/${target.id}/codes`, undefined, owner.cookie)).body.items;
  const rows = await list(p);
  const otherId = (await list(other))[0].id;
  const removable = rows.find((r) => r.code === 'BULK-DELETE');
  const remove = (json, cookie = owner.cookie) =>
    request(`/api/manage/pools/${p.id}/codes`, json, cookie, env, {}, 'DELETE');
  assert.equal((await remove({ ids: [removable.id] }, '')).status, 401);
  assert.equal((await remove({ ids: [removable.id] }, outsider.cookie)).status, 404);
  for (const ids of [
    undefined,
    [],
    '1',
    [null],
    [true],
    ['1'],
    [0],
    [-1],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
    Array.from({ length: 51 }, (_, i) => i + 1),
  ]) {
    const response = await remove({ ids });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_CODE_SELECTION');
  }
  const selected = rows.filter((r) => r.code !== 'BULK-KEEP').map((r) => r.id);
  const response = await remove({
    ids: [...selected, removable.id, otherId, Number.MAX_SAFE_INTEGER],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { deleted: 1, skipped: 4 });
  assert.deepEqual(
    new Set((await list(p)).map((r) => r.code)),
    new Set(['BULK-UNUSED', 'BULK-USED', 'BULK-KEEP']),
  );
  assert.equal((await list(other)).length, 1);
  assert.deepEqual((await remove({ ids: [removable.id] })).body, { deleted: 0, skipped: 1 });
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (r) => r.id === p.id,
  );
  assert.deepEqual([stats.total, stats.claimed, stats.remaining], [3, 2, 1]);
});

test('bulk deletion supports a full 50-row page in one request', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, Array.from({ length: 51 }, (_, i) => `BULK-${i}`).join('\n'));
  const page = (
    await request(`/api/manage/pools/${p.id}/codes?pageSize=50`, undefined, owner.cookie)
  ).body;
  const result = await request(
    `/api/manage/pools/${p.id}/codes`,
    { ids: page.items.map((r) => r.id) },
    owner.cookie,
    env,
    {},
    'DELETE',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { deleted: 50, skipped: 0 });
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.total,
    1,
  );
});

test('bulk deletion skips a code claimed just before the delete statement executes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'BULK-RACE-CLAIM\nBULK-RACE-DELETE');
  const rows = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare(query) {
        const statement = env.DB.prepare(query);
        if (!/^delete from "redemption_codes"/i.test(query)) return statement;
        return {
          bind(...params) {
            const bound = statement.bind(...params);
            const execute = async (method) => {
              issued = await claim(p);
              assert.equal(issued.status, 200);
              return bound[method]();
            };
            return { all: () => execute('all'), raw: () => execute('raw') };
          },
        };
      },
    },
  };
  const result = await request(
    `/api/manage/pools/${p.id}/codes`,
    { ids: rows.map((r) => r.id) },
    owner.cookie,
    bindings,
    {},
    'DELETE',
  );
  assert.equal(issued?.body.code, 'BULK-RACE-CLAIM');
  assert.deepEqual(result.body, { deleted: 1, skipped: 1 });
  const remaining = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].code, issued.body.code);
  assert.equal(remaining[0].status, 'claimed');
});

test('record counts include an empty pool and exclude every other pool and space', async () => {
  const owner = await space();
  const outsider = await space();
  const empty = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  const foreign = await pool(outsider.cookie);
  await imported(other, owner.cookie, 'OTHER-A\nOTHER-B');
  await imported(foreign, outsider.cookie, 'FOREIGN');
  const result = await request(`/api/manage/pools/${empty.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(result.body.counts, { all: 0, unclaimed: 0, claimed: 0, redeemed: 0 });
  assert.equal(
    (await request(`/api/manage/pools/${other.id}/codes`, undefined, outsider.cookie)).status,
    404,
  );
  const own = await request(`/api/manage/pools/${other.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(own.body.counts, { all: 2, unclaimed: 2, claimed: 0, redeemed: 0 });
});

test('redeemed import partitions results, preserves claims and changes inventory without inventing claims', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'A\nB\nC');
  await imported(other, owner.cookie, 'OTHER');
  const issued = await claim(p, { remark: 'preserved' });
  assert.equal(issued.body.code, 'A');
  const result = await markRedeemed(
    p,
    owner.cookie,
    ' A \r\n\nB\nB\nOTHER\nb\n' + 'X'.repeat(101) + '\nBAD\0CODE',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(
    [
      result.body.marked,
      result.body.alreadyRedeemed,
      result.body.removedFromAvailable,
      result.body.failed,
    ],
    [2, 0, 1, 5],
  );
  assert.deepEqual(
    result.body.failures.map((r) => [r.line, r.reasonCode]),
    [
      [4, 'DUPLICATE_IN_BATCH'],
      [5, 'CODE_NOT_IN_POOL'],
      [6, 'CODE_NOT_IN_POOL'],
      [7, 'CODE_TOO_LONG'],
      [8, 'CODE_NULL'],
    ],
  );
  const list = async () =>
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  const before = await list();
  assert.deepEqual(before.counts, { all: 3, unclaimed: 1, claimed: 0, redeemed: 2 });
  assert.deepEqual(before.summary, { total: 3, remaining: 1, claimed: 1, redeemed: 2 });
  const a = before.items.find((row) => row.code === 'A');
  const b = before.items.find((row) => row.code === 'B');
  assert.equal(a.claimedAt, issued.body.claimedAt);
  assert.equal(a.remark, 'preserved');
  assert.equal(b.claimedAt, null);
  assert.equal(b.remark, null);
  assert.ok(a.redeemedMarkedAt);
  assert.equal(a.redeemedMarkedAt, b.redeemedMarkedAt);
  const again = await markRedeemed(p, owner.cookie, 'A\nB');
  assert.deepEqual(again.body, {
    marked: 0,
    alreadyRedeemed: 2,
    removedFromAvailable: 0,
    failed: 0,
    failures: [],
  });
  assert.deepEqual(await list(), before);
  for (const row of [a, b]) {
    assert.equal(
      (
        await request(
          `/api/manage/pools/${p.id}/codes/${row.id}`,
          {},
          owner.cookie,
          env,
          {},
          'DELETE',
        )
      ).status,
      409,
    );
  }
  assert.deepEqual(
    (
      await request(
        `/api/manage/pools/${p.id}/codes`,
        { ids: [a.id, b.id] },
        owner.cookie,
        env,
        {},
        'DELETE',
      )
    ).body,
    { deleted: 0, skipped: 2 },
  );
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (row) => row.id === p.id,
  );
  assert.deepEqual([stats.total, stats.remaining, stats.claimed, stats.redeemed], [3, 1, 1, 2]);
  assert.equal((await claim(p)).body.code, 'C');
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  assert.equal(
    (await request('/api/claim/validate', { claimKey: other.claimKey })).body.remaining,
    1,
  );
});

test('redeemed import validates ownership, text and limits and supports 500 Unicode codes', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  assert.equal((await markRedeemed(p, undefined, 'A')).status, 401);
  assert.equal((await markRedeemed(p, outsider.cookie, 'A')).status, 404);
  assert.equal((await markRedeemed({ id: 999999 }, owner.cookie, 'A')).status, 404);
  for (const [text, reason] of [
    [null, 'IMPORT_TEXT_REQUIRED'],
    [' \n', 'IMPORT_EMPTY'],
    [Array(501).fill('A').join('\n'), 'IMPORT_LIMIT'],
  ]) {
    const result = await markRedeemed(p, owner.cookie, text);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, reason);
  }
  const missing = await markRedeemed(p, owner.cookie, 'MISSING');
  assert.deepEqual([missing.body.marked, missing.body.failed], [0, 1]);
  const codes = Array.from({ length: 500 }, (_, i) => (i === 0 ? '😀'.repeat(100) : `BATCH-${i}`));
  await imported(p, owner.cookie, codes.join('\n'));
  const result = await markRedeemed(p, owner.cookie, codes.join('\n'));
  assert.deepEqual(result.body, {
    marked: 500,
    alreadyRedeemed: 0,
    removedFromAvailable: 500,
    failed: 0,
    failures: [],
  });
  const stats = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  assert.deepEqual(stats.summary, { total: 500, remaining: 0, claimed: 0, redeemed: 500 });
});

test('redeemed import rolls back earlier chunks when a later update fails', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const codes = Array.from({ length: 60 }, (_, i) => `ROLLBACK-${i}`);
  await imported(p, owner.cookie, codes.join('\n'));
  await env.DB.prepare(
    `CREATE TRIGGER reject_redemption BEFORE UPDATE ON redemption_codes WHEN NEW.pool_id = ${p.id} AND NEW.code = 'ROLLBACK-59' BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
  ).run();
  try {
    assert.equal((await markRedeemed(p, owner.cookie, codes.join('\n'))).status, 500);
    const stats = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
    assert.deepEqual(stats.summary, { total: 60, remaining: 60, claimed: 0, redeemed: 0 });
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_redemption').run();
  }
  assert.equal((await markRedeemed(p, owner.cookie, codes.join('\n'))).body.marked, 60);
});

test('concurrent redeemed imports count each transition once', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'ONE\nTWO');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => markRedeemed(p, owner.cookie, 'ONE\nTWO')),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(
    results.reduce((n, r) => n + r.body.marked, 0),
    2,
  );
  assert.equal(
    results.reduce((n, r) => n + r.body.removedFromAvailable, 0),
    2,
  );
  assert.equal(
    results.reduce((n, r) => n + r.body.alreadyRedeemed, 0),
    8,
  );
});

test('redeeming during Siteverify prevents issuance; claiming before redemption preserves the claim', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'REDEEM-FIRST');
  verification = async () => {
    assert.equal(
      (await markRedeemed(p, owner.cookie, 'REDEEM-FIRST')).body.removedFromAvailable,
      1,
    );
    return successfulVerification();
  };
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  verification = successfulVerification;
  await imported(p, owner.cookie, 'CLAIM-FIRST');
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare: (query) => env.DB.prepare(query),
      batch: async (statements) => {
        issued = await claim(p, { remark: 'race preserved' });
        return env.DB.batch(statements);
      },
    },
  };
  const result = await markRedeemed(p, owner.cookie, 'CLAIM-FIRST', bindings);
  assert.equal(issued.status, 200);
  assert.deepEqual([result.body.marked, result.body.removedFromAvailable], [1, 0]);
  const row = (
    await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)
  ).body.items.find((r) => r.code === 'CLAIM-FIRST');
  assert.equal(row.status, 'redeemed');
  assert.equal(row.claimedAt, issued.body.claimedAt);
  assert.equal(row.remark, 'race preserved');
});

test('redeemed import rechecks records and pool existence inside the transaction', async () => {
  const owner = await space();
  for (const deletePool of [false, true]) {
    const p = await pool(owner.cookie);
    await imported(p, owner.cookie, 'DELETE-RACE');
    const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
      .items[0];
    const bindings = {
      ...env,
      DB: {
        prepare: (query) => env.DB.prepare(query),
        batch: async (statements) => {
          if (deletePool) await deleted(p, owner.cookie);
          else
            await request(
              `/api/manage/pools/${p.id}/codes/${row.id}`,
              {},
              owner.cookie,
              env,
              {},
              'DELETE',
            );
          return env.DB.batch(statements);
        },
      },
    };
    const result = await markRedeemed(p, owner.cookie, 'DELETE-RACE', bindings);
    assert.equal(result.status, deletePool ? 404 : 200);
    if (!deletePool) {
      assert.equal(result.body.marked, 0);
      assert.equal(result.body.failures[0].reasonCode, 'CODE_NOT_IN_POOL');
    }
  }
});
