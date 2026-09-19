export type MessageParams = Record<string, string | number>;
export interface Message {
  code: string;
  params?: MessageParams;
  status?: number;
}
export type MessageCode =
  | 'REQUEST_FAILED'
  | 'NETWORK_ERROR'
  | 'CLAIM_NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'CROSS_SITE_REQUEST'
  | 'JSON_REQUIRED'
  | 'BODY_TOO_LARGE'
  | 'POOL_NOT_FOUND'
  | 'POOL_DELETED'
  | 'CLAIM_KEY_NOT_FOUND'
  | 'INVALID_CLAIM_KEY'
  | 'INVALID_DISTRIBUTOR_KEY'
  | 'POOL_NAME_EXISTS'
  | 'SPACE_POOL_LIMIT'
  | 'POOL_CODE_LIMIT'
  | 'POOL_STOPPED'
  | 'POOL_EMPTY'
  | 'TURNSTILE_FAILED'
  | 'TURNSTILE_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_JSON'
  | 'POOL_NAME_REQUIRED'
  | 'POOL_NAME_NULL'
  | 'POOL_NAME_TOO_LONG'
  | 'POOL_DESCRIPTION_TOO_LONG'
  | 'INVALID_POOL_DESCRIPTION'
  | 'INVALID_POOL_STATUS'
  | 'IMPORT_TEXT_REQUIRED'
  | 'INVALID_CODE_SELECTION'
  | 'CODE_NOT_FOUND'
  | 'CODE_NOT_AVAILABLE'
  | 'CODE_NOT_IN_POOL'
  | 'INVALID_PAGE'
  | 'INVALID_FILTER'
  | 'INVALID_PAGE_SIZE'
  | 'INVALID_EXPORT_QUERY'
  | 'EXPORT_FAILED'
  | 'EXPORT_EMPTY'
  | 'UNAUTHORIZED'
  | 'IMPORT_LIMIT'
  | 'IMPORT_EMPTY'
  | 'CODE_TOO_LONG'
  | 'CODE_NULL'
  | 'DUPLICATE_IN_BATCH'
  | 'DUPLICATE_IN_POOL'
  | 'REMARK_TEXT_REQUIRED'
  | 'REMARK_TOO_LONG'
  | 'REMARK_NULL'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_READ_ON_SAVE'
  | 'STORAGE_UNSUPPORTED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_CONFLICT'
  | 'WIDGET_LOAD_TIMEOUT'
  | 'WIDGET_LOAD_FAILED'
  | 'WIDGET_WAIT_TIMEOUT'
  | 'WIDGET_NOT_READY'
  | 'WIDGET_EXPIRED'
  | 'WIDGET_FAILED'
  | 'WIDGET_TIMEOUT'
  | 'WIDGET_UNSUPPORTED';
export function errorBody<C extends MessageCode>(code: C, params?: MessageParams) {
  return { code, ...(params ? { params } : {}) };
}
export class BusinessError extends Error implements Message {
  constructor(
    public code: MessageCode,
    public params?: MessageParams,
  ) {
    super(code);
  }
}
export function toMessage(error: unknown): Message {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const candidate = error as Message;
    return {
      code: candidate.code,
      ...(candidate.params ? { params: candidate.params } : {}),
      ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
    };
  }
  return { code: 'REQUEST_FAILED' };
}
