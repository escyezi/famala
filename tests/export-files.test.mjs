import { test, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { ExportWriter, csvLine, safeName } from '../src/react-app/export/writer.ts';
import { zh } from '../src/react-app/i18n/zh-CN.ts';
import { en } from '../src/react-app/i18n/en.ts';

const startedAt = Date.UTC(2026, 8, 19, 1, 2, 3);
const rows = [
  '0000123',
  '12345678901234567890',
  '=1+1',
  '+1',
  '-2',
  '@SUM(A1)',
  '中文😀,"\nline',
  '_x000A_',
  'AB_X0041_CD',
  'a\u0001b',
].map((code, i) => ({
  id: i + 1,
  code,
  status: i % 2 ? 'redeemed' : 'claimed',
  createdAt: startedAt,
  claimedAt: i % 2 ? null : startedAt,
  redeemedMarkedAt: i % 2 ? startedAt + 1000 : null,
  remark: i % 2 ? null : '=memo,"\r\n第二行😀',
}));
function parseCSV(text) {
  const result = [];
  let row = [];
  let cell = '';
  let quote = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n' && !quote) {
      row.push(cell);
      result.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return result;
}
test('single pool CSV preserves text, statuses, UTC and no secret fields', async () => {
  const writer = new ExportWriter({
    status: 'all',
    allPools: false,
    startedAt,
    labels: zh.exports,
  });
  writer.startPool({ id: 1, name: 'Pool/测试', maxId: rows.length });
  writer.addRows(rows.slice(0, 3));
  writer.addRows(rows.slice(3));
  writer.endPool(startedAt + 2000);
  const file = writer.finish(startedAt + 3000);
  expect(file.filename).toMatch(/^pool-1-Pool_测试-all-.*\.csv$/);
  expect(file.blob.type).toBe('text/csv;charset=utf-8');
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  const parsed = parseCSV(strFromU8(bytes));
  expect(parsed).toHaveLength(rows.length + 1);
  expect(parsed[0]).toHaveLength(8);
  expect(parsed[0]).not.toContain('记录 ID');
  expect(parsed.slice(1).map((row) => row[2])).toEqual(rows.map((row) => row.code));
  expect(parsed[1][6]).toBe(rows[0].remark);
  expect(parsed[1][4]).toBe(new Date(startedAt).toISOString());
  expect(parsed[2][5]).toBe('');
});

test('all pools CSV includes separate files, empty pools and accurate summary', async () => {
  const writer = new ExportWriter({
    status: 'all',
    allPools: true,
    startedAt,
    labels: en.exports,
  });
  for (const id of [1, 2]) {
    writer.startPool({ id, name: '../same\\name', maxId: id === 1 ? rows.length : 0 });
    if (id === 1) writer.addRows(rows);
    writer.endPool(startedAt + id * 1000);
  }
  const file = writer.finish(startedAt + 5000);
  expect(file.filename).toMatch(/\.zip$/);
  expect(file.blob.type).toBe('application/zip');
  const zip = unzipSync(new Uint8Array(await file.blob.arrayBuffer()));
  expect(Object.keys(zip)).toHaveLength(4);
  const names = Object.keys(zip).filter((n) => n.startsWith('pool-'));
  expect(names).toHaveLength(2);
  expect(names.every((name) => name.endsWith('.csv'))).toBe(true);
  expect(names.every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true);
  const records = parseCSV(strFromU8(zip[names[0]]));
  expect(records[0]).toHaveLength(8);
  expect(records[0]).not.toContain('Record ID');
  expect(records.slice(1).map((row) => row[2])).toEqual(rows.map((row) => row.code));
  const summary = parseCSV(strFromU8(zip['summary.csv']));
  expect(summary[1].slice(4, 8)).toEqual(['10', '0', '5', '5']);
  expect(summary[2].slice(4, 8)).toEqual(['0', '0', '0', '0']);
  expect(summary[1][2]).toBe(names[0]);
  expect(strFromU8(zip['README.txt'])).toContain(new Date(startedAt + 5000).toISOString());
  expect(strFromU8(zip['README.txt'])).toContain(en.exports.csvHelp);
  expect(parseCSV(strFromU8(zip[names[1]]))).toHaveLength(1);
});

test('CSV escaping and safe file names preserve values without protecting formulas', () => {
  expect(parseCSV(csvLine(['=1+1', '01', 'a,"\r\nb']))).toEqual([['=1+1', '01', 'a,"\r\nb']]);
  expect(safeName('a/b\\c:*. ')).toBe('a_b_c__');
});

test.each([false, true])(
  'CSV filenames fit UTF-8 byte limits without changing pool names (ZIP: %s)',
  async (allPools) => {
    const name = '😀'.repeat(60);
    const writer = new ExportWriter({
      status: 'unclaimed',
      allPools,
      startedAt,
      labels: zh.exports,
    });
    writer.startPool({ id: Number.MAX_SAFE_INTEGER, name, maxId: 1 });
    writer.addRows([{ ...rows[0], status: 'unclaimed' }]);
    writer.endPool(startedAt + 1000);
    const result = writer.finish(startedAt + 2000);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const files = allPools ? unzipSync(bytes) : { [result.filename]: bytes };
    const filename = Object.keys(files).find((entry) => entry.startsWith('pool-'));
    expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255);
    expect(filename).not.toContain('\uFFFD');
    expect(parseCSV(strFromU8(files[filename]))[1][1]).toBe(name);
  },
);
