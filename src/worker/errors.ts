import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { errorBody, BusinessError } from '../shared/messages.ts';
import type { MessageCode, MessageParams } from '../shared/messages.ts';
export class ApiException extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public code: MessageCode,
    public params?: MessageParams,
  ) {
    super(status, { message: code });
  }
}
export function validationError(error: unknown) {
  return error instanceof BusinessError
    ? errorBody(error.code, error.params)
    : errorBody('REQUEST_FAILED');
}
