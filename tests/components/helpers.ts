import { act, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { ClaimRecord } from '../../src/shared/contracts.ts';
import type { Pool } from '../../src/shared/api-types.ts';

type Handler = (init: RequestInit) => Response | Promise<Response>;
export const unexpectedRequests: string[] = [];

// Mock only the network boundary: components still use the real api() wrapper.
export function mockApi(routes: Record<string, Handler>) {
  unexpectedRequests.length = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input)}`;
    const handler = routes[key];
    if (!handler) {
      unexpectedRequests.push(key);
      throw new Error(`Unexpected request: ${key}`);
    }
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const claimRecord: ClaimRecord = {
  claimKey: `c_${'a'.repeat(43)}`,
  poolName: '九月福利',
  code: 'WELCOME-001',
  claimedAt: 1_800_000_000_000,
  userMarkedUsed: false,
  userMarkedUsedAt: null,
};

export const pool: Pool = {
  id: 'pool-1',
  name: claimRecord.poolName,
  claimKey: claimRecord.claimKey,
  status: 'active',
  createdAt: claimRecord.claimedAt,
  total: 2,
  claimed: 0,
  remaining: 2,
};

export const session = { spaceId: 'space-12345678', expiresAt: 1_900_000_000_000 };

// Exercise our real Turnstile component without loading Cloudflare's remote script.
export function mockTurnstile() {
  const render = vi.fn<NonNullable<Window['turnstile']>['render']>().mockReturnValue('widget-1');
  const remove = vi.fn();
  vi.stubGlobal('turnstile', { render, remove });
  async function trigger(name: string, token?: string) {
    await waitFor(() => expect(render).toHaveBeenCalled());
    const options = render.mock.lastCall![1];
    await act(async () => {
      (options[name] as (token?: string) => void)(token);
    });
  }
  return { render, remove, trigger };
}
