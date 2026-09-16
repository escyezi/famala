import type { hc, InferRequestType, InferResponseType } from 'hono/client';
import type { AppType } from '../worker/index.ts';

// Derive wire types from the route implementation, not parallel interfaces.
type Api = ReturnType<typeof hc<AppType>>['api'];
type PoolApi = Api['manage']['pools'][':id'];
export type Session = InferResponseType<Api['manage']['session']['$get'], 200>;
export type Pool = InferResponseType<Api['manage']['pools']['$get'], 200>['items'][number];
export type CodePage = InferResponseType<PoolApi['codes']['$get'], 200>;
export type CodeRow = CodePage['items'][number];
export type CodeFilter = NonNullable<InferRequestType<PoolApi['codes']['$get']>['query']['status']>;
export type ImportResult = InferResponseType<PoolApi['import']['$post'], 200>;
export type PublicPool = InferResponseType<Api['claim']['validate']['$post'], 200>;
export type PublicConfig = InferResponseType<Api['config']['$get'], 200>;
