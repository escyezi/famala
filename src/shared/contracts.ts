import { BusinessError } from './messages.ts';
import type { MessageParams } from './messages.ts';
export interface ClaimRecord {
  poolName: string;
  claimKey: string;
  code: string;
  claimedAt: number;
}
export const MAX_POOLS_PER_SPACE = 50;
export const MAX_POOL_NAME_LENGTH = 50;
export const MAX_POOL_DESCRIPTION_LENGTH = 500;
export const MAX_CODES_PER_POOL = 5000;
export const EXPORT_BATCH_SIZE = 500;
export type ImportReason =
  | 'CODE_TOO_LONG'
  | 'CODE_NULL'
  | 'DUPLICATE_IN_BATCH'
  | 'DUPLICATE_IN_POOL'
  | 'CODE_NOT_IN_POOL'
  | 'POOL_CODE_LIMIT';
export function importFailure(
  row: { line: number; code: string },
  reasonCode: ImportReason,
  params?: MessageParams,
): ImportFailure {
  return {
    ...row,
    reasonCode,
    ...(params ? { params } : {}),
  };
}
export interface ImportFailure {
  line: number;
  code: string;
  reasonCode: ImportReason;
  params?: MessageParams;
}
export const codePointLength = (value: string) => Array.from(value).length;

export function parseImport(text: string) {
  const rows = text
    .split(/\r\n|\n|\r/)
    .map((code, i) => ({ code: code.trim(), line: i + 1 }))
    .filter((row) => row.code.length > 0);
  if (rows.length > 500) throw new BusinessError('IMPORT_LIMIT');
  if (!rows.length) throw new BusinessError('IMPORT_EMPTY');
  const seen = new Map<string, number>();
  const valid: { code: string; line: number }[] = [];
  const failures: ImportFailure[] = [];
  for (const row of rows) {
    const firstLine = seen.get(row.code);
    if (codePointLength(row.code) > 100) failures.push(importFailure(row, 'CODE_TOO_LONG'));
    else if (row.code.includes('\0')) failures.push(importFailure(row, 'CODE_NULL'));
    else if (firstLine !== undefined)
      failures.push(importFailure(row, 'DUPLICATE_IN_BATCH', { firstLine }));
    else {
      seen.set(row.code, row.line);
      valid.push(row);
    }
  }
  return { valid, failures };
}

export function normalizeRemark(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BusinessError('REMARK_TEXT_REQUIRED');
  const remark = value.trim();
  if (codePointLength(remark) > 500) throw new BusinessError('REMARK_TOO_LONG');
  if (remark.includes('\0')) throw new BusinessError('REMARK_NULL');
  return remark || null;
}
