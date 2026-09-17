import { hc, parseResponse } from 'hono/client';
import type { ClientResponse } from 'hono/client';
import type { AppType } from '../worker/index.ts';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  try {
    response = await fetch(input, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      path === '/api/claim'
        ? '网络连接失败，本次兑换码可能已经发出且无法找回。请确认网络后重新验证。'
        : '网络连接失败，请检查网络后重试。',
      0,
    );
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
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null;
    const code = result && typeof result === 'object' && 'code' in result ? result.code : null;
    throw new ApiError(
      typeof error === 'string' ? error : '请求失败，请稍后重试',
      response.status,
      typeof code === 'string' ? code : undefined,
    );
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
    throw new ApiError('服务返回异常，请稍后重试', 500);
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

export const dateTime = (time: number | null) =>
  time === null
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(time);
