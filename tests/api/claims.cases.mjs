import assert from 'node:assert/strict';
import { test } from 'vitest';
import { env, successfulVerification, verifier } from '../support/api-environment.ts';
import {
  claim,
  deleted,
  imported,
  markRedeemed,
  pool,
  request,
  space,
} from '../support/api-fixtures.mjs';

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
  verifier.respond = async () => Response.json({ success: false });
  const rejected = await claim(p);
  assert.equal(rejected.status, 400);
  assert.deepEqual(stages(rejected), ['pool_lookup', 'turnstile', 'total']);
  verifier.respond = successfulVerification;
  const success = await claim(p);
  assert.equal(success.status, 200);
  assert.deepEqual(stages(success), ['pool_lookup', 'turnstile', 'code_allocate', 'total']);
});

test('deletion while Siteverify is pending prevents issuing a code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-RACE');
  verifier.respond = async () => {
    assert.equal((await deleted(p, owner.cookie)).status, 200);
    return successfulVerification();
  };
  assert.equal((await claim(p)).status, 404);
});

test('concurrent claims allocate unique codes and reject claims once the pool is empty', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(
    p,
    owner.cookie,
    Array.from({ length: 12 }, (_, i) => `CONCURRENT-${i}`).join('\n'),
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
  const normal = verifier.respond;
  verifier.respond = async () => {
    await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
    return Response.json({ success: true, hostname: 'famala.example', action: 'claim' });
  };
  try {
    const result = await claim(p);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'POOL_STOPPED');
  } finally {
    verifier.respond = normal;
  }
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).body.remaining, 1);
});

test('validation fails closed: missing, invalid, mismatched metadata, service errors, production test keys', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'SAFE');
  const beforeCalls = verifier.calls;
  assert.equal((await claim(p, { remark: '😀'.repeat(501) })).status, 400);
  assert.equal((await claim(p, { remark: 123 })).status, 400);
  assert.equal((await claim(p, { turnstileToken: '' })).status, 400);
  assert.equal(verifier.calls, beforeCalls);
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
  const normal = verifier.respond;
  try {
    for (const value of [
      { success: false },
      { success: true, hostname: 'evil.example', action: 'claim' },
      { success: true, hostname: 'famala.example', action: 'login' },
      {},
    ]) {
      verifier.respond = async () => Response.json(value);
      assert.equal((await claim(p)).status, 400);
    }
    verifier.respond = async () => new Response('unavailable', { status: 503 });
    assert.equal((await claim(p)).status, 503);
    verifier.respond = async () => {
      throw new Error('timeout');
    };
    assert.equal((await claim(p)).status, 503);
  } finally {
    verifier.respond = normal;
  }
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).body.remaining, 1);
  assert.equal((await claim(p, { remark: '  ' })).status, 200);
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.items[0]
      .remark,
    null,
  );
});

test('individual deletion during Siteverify prevents a pending claim from issuing the removed code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-FIRST');
  const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items[0];
  verifier.respond = async () => {
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
  assert.equal(verifier.calls, 1);
  assert.equal(issued.status, 409);
  assert.equal(issued.body.code, 'POOL_EMPTY');
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.total,
    0,
  );
});
