import type { Message } from '../shared/messages.ts';
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
export function readRecords(): { records: ClaimRecord[]; warning: Message | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], warning: null };
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isRecord) ||
      new Set(parsed.map((r) => r.claimKey)).size !== parsed.length
    )
      throw new Error();
    return { records: parsed, warning: null };
  } catch {
    return {
      records: [],
      warning: { code: 'STORAGE_READ_FAILED' },
    };
  }
}
async function mutate(update: (records: ClaimRecord[]) => Message | null): Promise<Message | null> {
  if (!navigator.locks) return { code: 'STORAGE_UNSUPPORTED' };
  try {
    return await navigator.locks.request(STORAGE_KEY, () => {
      const current = readRecords();
      if (current.warning) return { code: 'STORAGE_READ_ON_SAVE' };
      const warning = update(current.records);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.records));
      window.dispatchEvent(new Event(CHANGE));
      return warning;
    });
  } catch {
    return { code: 'STORAGE_WRITE_FAILED' };
  }
}
export function saveClaim(record: ClaimRecord) {
  return mutate((records) => {
    const existing = records.find((r) => r.claimKey === record.claimKey);
    if (existing && existing.code !== record.code) return { code: 'STORAGE_CONFLICT' };
    if (!existing) records.push(record);
    return null;
  });
}
export function saveUsed(record: ClaimRecord, used: UsedResult) {
  return mutate((records) => {
    const existing = records.find((r) => r.claimKey === record.claimKey && r.code === record.code);
    if (existing) Object.assign(existing, used);
    return null;
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
