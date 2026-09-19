import { Zip, ZipDeflate } from 'fflate';
import type { ExportPage, ExportPool } from '../../shared/api-types.ts';
import type { ExportOptions, ExportResult } from './types.ts';

const encoder = new TextEncoder();
const stamp = (time: number) => new Date(time).toISOString().replace(/[:.]/g, '-');
const iso = (time: number | null) => (time === null ? '' : new Date(time).toISOString());
export function safeName(name: string) {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- File names must exclude control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_');
  let result = '';
  let bytes = 0;
  // Reserve room below 255 bytes for the pool ID, status, UTC stamp and extension.
  for (const char of Array.from(cleaned).slice(0, 60)) {
    const size = encoder.encode(char).length;
    if (bytes + size > 180) break;
    result += char;
    bytes += size;
  }
  return result.replace(/[. ]+$/g, '') || 'pool';
}
// Quoting protects CSV structure, not spreadsheet interpretation. Preserve raw values.
export function csvLine(values: (string | number)[]) {
  return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',') + '\r\n';
}

type Counts = { all: number; unclaimed: number; claimed: number; redeemed: number };
type Summary = { pool: ExportPool; filename: string; counts: Counts; endedAt: number };

export class ExportWriter {
  private parts: BlobPart[] = [];
  private zip?: Zip;
  private zipError?: Error;
  private zipDone = false;
  private csv?: ZipDeflate;
  private current?: Summary;
  private summaries: Summary[] = [];
  private singleFilename = '';

  constructor(private options: ExportOptions) {
    if (options.allPools) {
      this.zip = new Zip((error, data, final) => {
        if (error) this.zipError = error;
        else this.parts.push(new Uint8Array(data));
        if (final) this.zipDone = true;
      });
    }
  }
  private check() {
    if (this.zipError) throw this.zipError;
  }
  private headers() {
    const l = this.options.labels;
    return [
      l.poolId,
      l.poolName,
      l.code,
      l.status,
      l.createdAt,
      l.claimedAt,
      l.remark,
      l.redeemedMarkedAt,
    ];
  }
  private csvChunk(text: string, final = false) {
    const bytes = encoder.encode(text);
    if (this.csv) this.csv.push(bytes, final);
    else this.parts.push(bytes);
    this.check();
  }
  startPool(pool: ExportPool) {
    if (this.current) throw new Error('Previous pool is unfinished');
    const filename = `pool-${pool.id}-${safeName(pool.name)}-${this.options.status}-${stamp(this.options.startedAt)}.csv`;
    this.current = {
      pool,
      filename,
      counts: { all: 0, unclaimed: 0, claimed: 0, redeemed: 0 },
      endedAt: 0,
    };
    this.singleFilename = filename;
    if (this.zip) {
      this.csv = new ZipDeflate(filename, { level: 6 });
      this.zip.add(this.csv);
    }
    this.csvChunk('\uFEFF' + csvLine(this.headers()));
  }
  addRows(rows: ExportPage['items']) {
    if (!this.current) throw new Error('No pool');
    const { pool, counts } = this.current;
    const l = this.options.labels;
    let csv = '';
    for (const row of rows) {
      const values = [
        String(pool.id),
        pool.name,
        row.code,
        l[row.status],
        iso(row.createdAt),
        iso(row.claimedAt),
        row.remark ?? '',
        iso(row.redeemedMarkedAt),
      ];
      csv += csvLine(values);
      counts.all++;
      counts[row.status]++;
    }
    this.csvChunk(csv);
  }
  private addZipFile(name: string, bytes: Uint8Array) {
    if (!this.zip) throw new Error('No archive');
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    entry.push(bytes, true);
    this.check();
  }
  endPool(endedAt: number) {
    if (!this.current) throw new Error('No pool');
    const summary = this.current;
    summary.endedAt = endedAt;
    this.csvChunk('', true);
    this.summaries.push(summary);
    this.current = undefined;
    this.csv = undefined;
    this.check();
  }
  finish(endedAt: number): ExportResult {
    if (this.current || !this.summaries.length) throw new Error('Unfinished export');
    const l = this.options.labels;
    if (this.zip) {
      let summary =
        '\uFEFF' +
        csvLine([
          l.poolId,
          l.poolName,
          l.filename,
          l.filter,
          l.actualTotal,
          l.unclaimed,
          l.claimed,
          l.redeemed,
          l.startedAt,
          l.endedAt,
        ]);
      for (const item of this.summaries)
        summary += csvLine([
          item.pool.id,
          item.pool.name,
          item.filename,
          l[this.options.status],
          item.counts.all,
          item.counts.unclaimed,
          item.counts.claimed,
          item.counts.redeemed,
          iso(this.options.startedAt),
          iso(item.endedAt),
        ]);
      this.addZipFile('summary.csv', encoder.encode(summary));
      this.addZipFile(
        'README.txt',
        encoder.encode(
          [
            'Famala',
            l.consistency,
            l.timeHelp,
            l.csvHelp,
            `${l.filter}: ${l[this.options.status]}`,
            `${l.startedAt}: ${iso(this.options.startedAt)}`,
            `${l.endedAt}: ${iso(endedAt)}`,
            `${l.actualTotal}: ${this.summaries.reduce((n, item) => n + item.counts.all, 0)}`,
            `${l.summary}: summary.csv`,
          ].join('\r\n'),
        ),
      );
      this.zip.end();
      this.check();
      if (!this.zipDone) throw new Error('Incomplete archive');
    }
    const type = this.zip ? 'application/zip' : 'text/csv;charset=utf-8';
    const blob = new Blob(this.parts, { type });
    this.parts = [];
    return {
      blob,
      filename: this.zip
        ? `famala-pools-${this.options.status}-${stamp(this.options.startedAt)}.zip`
        : this.singleFilename,
    };
  }
}
