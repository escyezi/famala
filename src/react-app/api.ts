export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(
      path === '/api/claim'
        ? '网络连接失败，本次兑换码可能已经发出且无法找回。请确认网络后重新验证。'
        : '网络连接失败，请检查网络后重试。',
      0,
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/manage/'))
      window.dispatchEvent(new Event('famala:unauthorized'));
    throw new ApiError(result?.error ?? '请求失败，请稍后重试', response.status, result?.code);
  }
  if (!result) throw new ApiError('服务返回异常，请稍后重试', 500);
  return result as T;
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
