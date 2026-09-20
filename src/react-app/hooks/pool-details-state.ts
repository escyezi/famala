import type { CodeFilter, CodePage, CodePageSize } from '../../shared/api-types.ts';
import type { Message } from '../../shared/messages.ts';

export type RecordsQuery = { page: number; filter: CodeFilter; pageSize: CodePageSize };
export type Snapshot = { query: RecordsQuery; data: CodePage };
export const initialQuery: RecordsQuery = { page: 1, filter: 'all', pageSize: '20' };
export type RecordsState = {
  displayedSnapshot: Snapshot | null;
  requestedQuery: RecordsQuery;
  pending: boolean;
  failedQuery: RecordsQuery | null;
  codesError: Message | null;
  invalidated: boolean;
  selectionRevision: number;
  busy: boolean;
  error: Message | null;
};
export const initialState: RecordsState = {
  displayedSnapshot: null,
  requestedQuery: initialQuery,
  pending: true,
  failedQuery: null,
  codesError: null,
  invalidated: false,
  selectionRevision: 0,
  busy: false,
  error: null,
};
export type RecordsAction =
  | { type: 'reset' }
  | { type: 'load'; query: RecordsQuery; cached?: Snapshot; invalidate: boolean }
  | { type: 'loaded'; snapshot: Snapshot }
  | { type: 'failed'; query: RecordsQuery; error: Message }
  | { type: 'write' }
  | { type: 'writeFailed'; error: Message }
  | { type: 'writeFinished' }
  | { type: 'clearError' };

export function recordsReducer(state: RecordsState, action: RecordsAction): RecordsState {
  switch (action.type) {
    case 'reset':
      return { ...initialState, selectionRevision: state.selectionRevision };
    case 'load':
      return {
        ...state,
        requestedQuery: action.query,
        pending: true,
        failedQuery: null,
        codesError: null,
        busy: false,
        selectionRevision: state.selectionRevision + 1,
        invalidated: state.invalidated || action.invalidate,
        displayedSnapshot: action.cached ?? state.displayedSnapshot,
      };
    case 'loaded':
      return {
        ...state,
        displayedSnapshot: action.snapshot,
        requestedQuery: action.snapshot.query,
        pending: false,
        invalidated: false,
        failedQuery: null,
        codesError: null,
      };
    case 'failed':
      return { ...state, pending: false, failedQuery: action.query, codesError: action.error };
    case 'write':
      return { ...state, busy: true, error: null, selectionRevision: state.selectionRevision + 1 };
    case 'writeFailed':
      return { ...state, error: action.error };
    case 'writeFinished':
      return { ...state, busy: false };
    case 'clearError':
      return { ...state, error: null };
  }
}
