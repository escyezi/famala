import type { CodeFilter, ExportPage, ExportPool } from '../../shared/api-types.ts';
import type { zh } from '../i18n/zh-CN.ts';

export type ExportLabels = { [K in keyof typeof zh.exports]: string };
export type ExportOptions = {
  status: CodeFilter;
  allPools: boolean;
  startedAt: number;
  labels: ExportLabels;
};
export type ExportResult = { blob: Blob; filename: string };
export type ExportProgress = {
  stage: 'reading' | 'generating' | 'packing' | 'done';
  completed: number;
  total: number;
  rows: number;
};
export type ExportCommand =
  | { type: 'init'; options: ExportOptions }
  | { type: 'pool'; pool: ExportPool }
  | { type: 'rows'; rows: ExportPage['items'] }
  | { type: 'endPool'; endedAt: number }
  | { type: 'finish'; endedAt: number };
export type ExportReply = { id: number; error?: boolean; result?: ExportResult };
