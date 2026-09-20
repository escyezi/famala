import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Bindings } from '../../src/worker/types.ts';
import { migrate } from './database.ts';

export const checkCountersSQL = await readFile('scripts/sql/check-counters.sql', 'utf8');
export const rebuildCountersSQL = await readFile('scripts/sql/rebuild-counters.sql', 'utf8');
export let env: Bindings;
export const successfulVerification = async () =>
  Response.json({ success: true, hostname: 'famala.example', action: 'claim' });
export const verifier: { calls: number; respond: () => Promise<Response> } = {
  calls: 0,
  respond: successfulVerification,
};

export function installApiEnvironment() {
  let dispose: (() => Promise<void>) | undefined;
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    const proxy = await getPlatformProxy<Bindings>({ persist: false });
    dispose = () => proxy.dispose();
    env = {
      ...proxy.env,
      ENVIRONMENT: 'production',
      TURNSTILE_SITE_KEY: 'production-site-key',
      TURNSTILE_SECRET_KEY: 'production-secret-key',
      TURNSTILE_HOSTNAMES: 'famala.example',
    };
    await migrate(env.DB);
  });
  beforeEach(() => {
    verifier.respond = successfulVerification;
    verifier.calls = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        verifier.calls++;
        return verifier.respond();
      }
      return realFetch(input, init);
    });
  });
  afterEach(async () => {
    if (!env) return;
    try {
      assert.deepEqual(
        (await env.DB.prepare(checkCountersSQL).all()).results,
        [],
        'Counters must match the independent aggregate after every API test',
      );
    } finally {
      // Each test creates its own space; remove rows in FK order, keeping schema/indexes.
      await env.DB.batch(
        ['redemption_codes', 'code_pools', 'distributor_sessions', 'distributor_spaces'].map(
          (table) => env.DB.prepare(`DELETE FROM ${table}`),
        ),
      );
    }
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await dispose?.();
  });
}
