import { act, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { ClaimRecord } from '../../src/shared/contracts.ts';
import type { Pool, Session } from '../../src/shared/api-types.ts';
import type { InferResponseType } from 'hono/client';
import type { rpc } from '../../src/react-app/api.ts';

// Successful fixtures follow the actual route/status; malformed-response tests
// deliberately keep using the unconstrained json() helper below.
type Api = typeof rpc.api;
type PoolApi = Api['manage']['pools'][':id'];
export type ApiResponses = {
  session: InferResponseType<Api['manage']['session']['$get'], 200>;
  login: InferResponseType<Api['login']['$post'], 200>;
  createSpace: InferResponseType<Api['spaces']['$post'], 201>;
  logout: InferResponseType<Api['manage']['logout']['$post'], 200>;
  pools: InferResponseType<Api['manage']['pools']['$get'], 200>;
  createPool: InferResponseType<Api['manage']['pools']['$post'], 201>;
  renamePool: InferResponseType<PoolApi['name']['$post'], 200>;
  poolStatus: InferResponseType<PoolApi['status']['$post'], 200>;
  importCodes: InferResponseType<PoolApi['import']['$post'], 200>;
  codes: InferResponseType<PoolApi['codes']['$get'], 200>;
  validateClaim: InferResponseType<Api['claim']['validate']['$post'], 200>;
  config: InferResponseType<Api['config']['$get'], 200>;
  claim: InferResponseType<Api['claim']['$post'], 200>;
  markUsed: InferResponseType<Api['claim']['used']['$post'], 200>;
};

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

export const claimRecord = {
  claimKey: `c_${'a'.repeat(43)}`,
  poolName: '九月福利',
  code: 'WELCOME-001',
  claimedAt: 1_800_000_000_000,
  userMarkedUsed: false,
  userMarkedUsedAt: null,
} satisfies ClaimRecord & ApiResponses['claim'];

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

export const session = {
  spaceId: '12345678-1234-4000-8000-123456789abc',
  expiresAt: 1_900_000_000_000,
} satisfies Session & Pick<ApiResponses['createSpace'], 'spaceId' | 'expiresAt'>;

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
