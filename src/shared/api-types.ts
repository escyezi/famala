import type { hc, InferRequestType, InferResponseType } from 'hono/client';
import type { AppType } from '../worker/index.ts';

// Derive wire types from the route implementation, not parallel interfaces.
type Api = ReturnType<typeof hc<AppType>>['api'];
type PoolApi = Api['manage']['pools'][':id'];
export type Session = InferResponseType<Api['manage']['session']['$get'], 200>;
export type Pool = InferResponseType<Api['manage']['pools']['$get'], 200>['items'][number];
export type CodePage = InferResponseType<PoolApi['codes']['$get'], 200>;
export type CodeRow = CodePage['items'][number];
export type ExportManifest = InferResponseType<Api['manage']['exports']['manifest']['$get'], 200>;
export type ExportPool = ExportManifest['pools'][number];
export type ExportPage = InferResponseType<PoolApi['codes']['export']['$get'], 200>;
export type DeleteCodesResult = InferResponseType<PoolApi['codes']['$delete'], 200>;
export type CodeFilter = NonNullable<InferRequestType<PoolApi['codes']['$get']>['query']['status']>;
export type CodePageSize = NonNullable<
  InferRequestType<PoolApi['codes']['$get']>['query']['pageSize']
>;
export type ImportResult = InferResponseType<PoolApi['import']['$post'], 200>;
export type PublicPool = InferResponseType<Api['claim']['validate']['$post'], 200>;
export type PublicConfig = InferResponseType<Api['config']['$get'], 200>;

export type RedeemedImportResult = InferResponseType<PoolApi['redeemed']['import']['$post'], 200>;
