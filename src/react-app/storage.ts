import type { ClaimRecord, UsedResult } from '../shared/contracts.ts';
export const STORAGE_KEY = 'famala.claimedCodes';
const CHANGE = 'famala:records';

function isRecord(value: unknown): value is ClaimRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ClaimRecord>;
  return (
    typeof r.claimKey === 'string' &&
    /^c_[A-Za-z0-9_-]{43}$/.test(r.claimKey) &&
    typeof r.poolName === 'string' &&
    typeof r.code === 'string' &&
    r.code.length > 0 &&
    typeof r.claimedAt === 'number' &&
    Number.isFinite(r.claimedAt) &&
    typeof r.userMarkedUsed === 'boolean' &&
    (r.userMarkedUsed
      ? typeof r.userMarkedUsedAt === 'number' && Number.isFinite(r.userMarkedUsedAt)
      : r.userMarkedUsedAt === null)
  );
}
export function readRecords(): { records: ClaimRecord[]; warning: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], warning: '' };
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isRecord) ||
      new Set(parsed.map((r) => r.claimKey)).size !== parsed.length
    )
      throw new Error();
    return { records: parsed, warning: '' };
  } catch {
    return {
      records: [],
      warning: '本地领取记录无法读取，可能被损坏或浏览器禁止了存储。请妥善保存已复制的兑换码。',
    };
  }
}
async function mutate(update: (records: ClaimRecord[]) => string): Promise<string> {
  if (!navigator.locks) return '浏览器不支持安全保存领取记录，请复制保存兑换码。';
  try {
    return await navigator.locks.request(STORAGE_KEY, () => {
      const current = readRecords();
      if (current.warning) return current.warning + ' 本次结果请复制保存。';
      const warning = update(current.records);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.records));
      window.dispatchEvent(new Event(CHANGE));
      return warning;
    });
  } catch {
    return '本地保存失败，请复制保存兑换码。刷新后可能无法查看本次结果。';
  }
}
export function saveClaim(record: ClaimRecord) {
  return mutate((records) => {
    const existing = records.find((r) => r.claimKey === record.claimKey);
    if (existing && existing.code !== record.code)
      return '本地已保存该码池的另一个兑换码，本次兑换码未存入领取记录，请复制保存。';
    if (!existing) records.push(record);
    return '';
  });
}
export function saveUsed(record: ClaimRecord, used: UsedResult) {
  return mutate((records) => {
    const existing = records.find((r) => r.claimKey === record.claimKey && r.code === record.code);
    if (existing) Object.assign(existing, used);
    return '';
  });
}
export function subscribeRecords(listener: () => void) {
  const storage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(CHANGE, listener);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(CHANGE, listener);
  };
}
