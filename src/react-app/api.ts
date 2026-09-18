import type { MessageParams } from '../shared/messages.ts';
import { hc, parseResponse } from 'hono/client';
import type { ClientResponse } from 'hono/client';
import type { AppType } from '../worker/index.ts';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public params?: MessageParams,
  ) {
    super(code);
  }
}

function isAbortError(error: unknown) {
  return (
    error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
  );
}

async function fetchApi(input: RequestInfo | URL, init?: RequestInit, notifyUnauthorized = true) {
  const path = new URL(input instanceof Request ? input.url : String(input), location.origin)
    .pathname;
  const headers = new Headers(init?.headers);
  if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  const started = performance.now();
  try {
    response = await fetch(input, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
    });
    if (import.meta.env.DEV && path === '/api/claim') {
      console.debug(
        '[claim timing]',
        JSON.stringify({
          status: response.status,
          requestMs: Number((performance.now() - started).toFixed(2)),
          serverTiming: response.headers.get('Server-Timing'),
        }),
      );
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(path === '/api/claim' ? 'CLAIM_NETWORK_ERROR' : 'NETWORK_ERROR', 0);
  }
  if (
    notifyUnauthorized &&
    !init?.signal?.aborted &&
    response.status === 401 &&
    path.startsWith('/api/manage/')
  )
    window.dispatchEvent(new Event('famala:unauthorized'));
  return response;
}

// Only AppType crosses the server boundary; no Worker code enters the browser bundle.
export const rpc = hc<AppType>('/', { fetch: fetchApi });

// The response type is inferred from the actual RPC call, never supplied by callers.
// Middleware and onError responses are handled at runtime too, even when Hono
// cannot include them in the route's inferred response union.
export async function api<T extends ClientResponse<unknown>>(request: Promise<T>) {
  const response = await request;
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);
    const code = result && typeof result === 'object' && 'code' in result ? result.code : null;
    const rawParams =
      result && typeof result === 'object' && 'params' in result ? result.params : null;
    const params =
      rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? Object.fromEntries(
            Object.entries(rawParams).filter(
              (entry): entry is [string, string | number] =>
                typeof entry[1] === 'string' ||
                (typeof entry[1] === 'number' && Number.isFinite(entry[1])),
            ),
          )
        : undefined;
    throw new ApiError(typeof code === 'string' ? code : 'REQUEST_FAILED', response.status, params);
  }
  try {
    if (
      !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new Error('Expected a JSON response');
    const result = await parseResponse<T>(response);
    if (!result) throw new Error('Invalid JSON response');
    return result;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('INVALID_RESPONSE', 500);
  }
}

// Checking a public page's session must not open the login dialog on 401.
export function readSession(signal: AbortSignal) {
  return api(
    rpc.api.manage.session.$get(undefined, {
      init: { signal },
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchApi(input, init, false),
    }),
  );
}
