export interface ClaimRecord {
  poolName: string;
  claimKey: string;
  code: string;
  claimedAt: number;
  userMarkedUsed: boolean;
  userMarkedUsedAt: number | null;
}
export interface ImportFailure {
  line: number;
  code: string;
  reason: string;
}
export interface UsedResult {
  userMarkedUsed: true;
  userMarkedUsedAt: number;
}
export const codePointLength = (value: string) => Array.from(value).length;

export function parseImport(text: string) {
  const rows = text
    .split(/\r\n|\n|\r/)
    .map((code, i) => ({ code: code.trim(), line: i + 1 }))
    .filter((row) => row.code.length > 0);
  if (rows.length > 500) throw new Error('单次最多导入 500 条，请拆分后重试');
  if (!rows.length) throw new Error('请输入兑换码');
  const seen = new Map<string, number>();
  const valid: { code: string; line: number }[] = [];
  const failures: ImportFailure[] = [];
  for (const row of rows) {
    const firstLine = seen.get(row.code);
    if (codePointLength(row.code) > 100) failures.push({ ...row, reason: '超过 100 字' });
    else if (row.code.includes('\0')) failures.push({ ...row, reason: '包含不支持的空字符' });
    else if (firstLine !== undefined)
      failures.push({ ...row, reason: `与本批第 ${firstLine} 行重复` });
    else {
      seen.set(row.code, row.line);
      valid.push(row);
    }
  }
  return { valid, failures };
}

export function normalizeRemark(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('备注必须为纯文本');
  const remark = value.trim();
  if (codePointLength(remark) > 500) throw new Error('备注最多 500 字');
  if (remark.includes('\0')) throw new Error('备注包含不支持的空字符');
  return remark || null;
}
